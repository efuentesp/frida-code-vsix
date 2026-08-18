// Harness E2E (ADR-1002): ejercita el CAMINO REAL de frida code.
//
//   ExtensionRunner REAL (emitBeforeProviderRequest/createContext/getModel)
//     + oauth REAL del provider (getApiKey → runtime de identidad)
//     + adapter openai-completions REAL de pi-ai (buildParams/SDK OpenAI)
//     + servidor HTTP local que GRABA cada request (URL/headers/body)
//
// El orden de eventos replica models.js de pi-ai:
//   auth (getApiKey) → transformHeaders (before_provider_headers)
//   → api.stream → buildParams → onPayload (before_provider_request) → HTTP.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const require_ = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

/** Busca un módulo dentro de node_modules subiendo desde `here` (máx 6 niveles). */
export function findInNodeModules(rel: string): string | null {
	let dir = here;
	for (let i = 0; i < 8; i++) {
		const candidate = join(dir, "node_modules", rel);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

const PACA = "@earendil-works/pi-coding-agent";

/** ExtensionRunner REAL de pi-coding-agent (el que usa frida code). */
export async function loadExtensionRunner() {
	const runnerPath = findInNodeModules(`${PACA}/dist/core/extensions/runner.js`);
	if (!runnerPath) throw new Error("runner.js no encontrado (¿fuera del repo?)");
	const mod: any = await import(pathToFileURL(runnerPath).href);
	return mod.ExtensionRunner as new (
		extensions: any[],
		runtime: any,
		cwd: string,
		sessionManager: any,
		modelRegistry: any,
	) => any;
}

/** adapter openai-completions REAL de pi-ai (stream/streamSimple). */
export async function loadOpenAICompletions() {
	const apiPath = findInNodeModules(
		`${PACA}/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`,
	);
	if (!apiPath)
		throw new Error("openai-completions.js de pi-ai no encontrado (¿fuera del repo?)");
	return await import(pathToFileURL(apiPath).href);
}

/** adapter openai-responses REAL de pi-ai (ADR-1003: modelos con capability
 *  "responses" — el gateway los sirve por /v1/responses). */
export async function loadOpenAIResponses() {
	const apiPath = findInNodeModules(
		`${PACA}/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js`,
	);
	if (!apiPath)
		throw new Error("openai-responses.js de pi-ai no encontrado (¿fuera del repo?)");
	return await import(pathToFileURL(apiPath).href);
}

/** Schemas de las 7 tools core del runtime (read/bash/edit/write/grep/find/ls). */
export function loadRuntimeTools() {
	const toolsPath = findInNodeModules(`${PACA}/dist/core/tools/index.js`);
	if (!toolsPath) return [];
	const { createAllToolDefinitions } = require_(toolsPath);
	const defs = createAllToolDefinitions() as Record<
		string,
		{ name: string; description: string; parameters: unknown }
	>;
	return Object.values(defs);
}

/** Tools core con EXECUTE real y cwd propio (sandbox) — para el ciclo completo
 *  modelo→toolCall→execute→function_call_output→respuesta (live-tools E2E). */
export function createCoreTools(cwd: string): Record<
	string,
	{ name: string; description: string; parameters: any; execute: Function }
> {
	const toolsPath = findInNodeModules(`${PACA}/dist/core/tools/index.js`);
	if (!toolsPath) throw new Error("tools/index.js de pi-coding-agent no encontrado");
	const { createAllToolDefinitions } = require_(toolsPath);
	return createAllToolDefinitions(cwd);
}

export interface RegisteredHooks {
	runner: any;
	/** Registra el factory de hooks igual que extensionFactories del host. */
	register(factory: (pi: ExtensionAPI) => void): void;
	/** getModel que bindCore conectaría en el host real. */
	setModel(model: unknown): void;
	breakModel(): void;
}

/** Runner real con registro vía pi.on(...) (el mismo API que usa hooks.ts). */
export async function makeRunner(cwd = process.cwd()): Promise<RegisteredHooks> {
	const ExtensionRunner = await loadExtensionRunner();
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const ext = { path: "/virtual/e2e/frida-enterprise", handlers };
	const runtimeStub = {
		emitError: () => {},
		getActiveTools: () => [],
	};
	const runner = new ExtensionRunner([ext], runtimeStub, cwd, undefined, undefined);

	const pi: any = {
		on: (name: string, fn: any) => {
			const list = handlers.get(name) ?? [];
			list.push(fn);
			handlers.set(name, list);
		},
	};

	return {
		runner,
		register: (factory) => factory(pi as ExtensionAPI),
		setModel: (model) => {
			runner.getModel = () => model; // lo mismo que bindCore(contextActions.getModel)
		},
		breakModel: () => {
			runner.getModel = () => {
				throw new Error("model getter roto (simulación)");
			};
		},
	};
}

// ─── Servidor grabador + SSE ─────────────────────────────────────────────────

export interface RecordedRequest {
	method: string;
	url: string;
	authorization: string | undefined;
	body: any;
}

export interface RecorderServer {
	url: string;
	requests: RecordedRequest[];
	/** Responde SSE según el body de cada request, en orden. */
	respond(sequence: Array<(body: any) => string> | ((body: any, n: number) => string)): void;
	close(): Promise<void>;
}

export async function startRecorder(): Promise<RecorderServer> {
	const { createServer } = await import("node:http");
	const requests: RecordedRequest[] = [];
	let responder: ((body: any, n: number) => string) | null = null;

	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			let body: any = null;
			try {
				body = JSON.parse(raw);
			} catch {
				body = raw;
			}
			requests.push({
				method: req.method ?? "",
				url: req.url ?? "",
				authorization: req.headers.authorization,
				body,
			});
			const sse = responder
				? responder(body, requests.length - 1)
				: sseText("pong");
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
			});
			res.end(sse);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const addr = server.address();
	if (!addr || typeof addr === "string") throw new Error("sin puerto");
	return {
		url: `http://127.0.0.1:${addr.port}`,
		requests,
		respond: (seq) => {
			responder = Array.isArray(seq)
				? (body, n) => seq[Math.min(n, seq.length - 1)](body)
				: seq;
		},
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

/** SSE mínimo válido para el parser de pi-ai (texto + finish + usage + DONE). */
export function sseText(text: string): string {
	return (
		sseChunk({ choices: [{ index: 0, delta: { role: "assistant" } }] }) +
		sseChunk({ choices: [{ index: 0, delta: { content: text } }] }) +
		sseChunk({
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
		}) +
		"data: [DONE]\n\n"
	);
}

/** SSE que emite un tool_call (id/nombre/arguments) y termina en tool_calls. */
export function sseToolCall(
	id: string,
	name: string,
	args: object,
): string {
	return (
		sseChunk({
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id,
								type: "function",
								function: { name, arguments: "" },
							},
						],
					},
				},
			],
		}) +
		sseChunk({
			choices: [
				{
					index: 0,
					delta: {
						tool_calls: [
							{
								index: 0,
								function: { arguments: JSON.stringify(args) },
							},
						],
					},
				},
			],
		}) +
		sseChunk({
			choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
			usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
		}) +
		"data: [DONE]\n\n"
	);
}

/** Consume el AssistantMessageEventStream real → mensaje final (evento "done"). */
export async function collectStream(s: any): Promise<any> {
	let message: any;
	for await (const ev of s) {
		if (ev.type === "done") message = ev.message ?? ev.partial;
		if (ev.type === "error")
			throw new Error(
				ev.error?.errorMessage ??
					ev.error?.message ??
				ev.partial?.errorMessage ??
				"stream error",
			);
	}
	return message;
}

function sseChunk(payload: object): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}
