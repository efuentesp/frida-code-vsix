// Harness compartido para pruebas E2E de DevEngine.
// Provee auth, engine de llamadas, sandbox y helpers.

import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const require_ = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const PACA = "@earendil-works/pi-coding-agent";

/** Busca un módulo dentro de node_modules subiendo desde `here` (patrón FE). */
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

// ─── Configuración ───────────────────────────────────────────────────────────

export const DEVENGINE_BASE_URL =
	process.env.DEVENGINE_BASE_URL ?? "https://mywork.softtek.com/apg/devengine";
// Modelo default = SOFTTEK_MODEL del host (src/providers/softtek-provider.ts).
// NOTA: el gateway rutea cualquier id a gpt-5.6-luna en el backend (ver
// campo model de la respuesta), pero el id debe viajar igual (contrato OpenAI).
export const DEVENGINE_MODEL = process.env.DEVENGINE_MODEL ?? "gpt-5.4-mini";

/** Catálogo completo del gateway (ADR-0056: mini + luna + sol + terra).
 *  Override: DEVENGINE_MODELS="a,b" (csv). Default: los 4 del catálogo. */
export const DEVENGINE_MODELS: string[] = (
	process.env.DEVENGINE_MODELS ??
	"gpt-5.4-mini,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra"
)
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

export const DEVENGINE_TIMEOUT =
	Number(process.env.DEVENGINE_TIMEOUT) || 120_000;

// ─── Credenciales ────────────────────────────────────────────────────────────

export interface Credential {
	access?: string;
}

/** Lee la key de DevEngine desde env var o ~/.frida/auth.json. undefined si no está. */
export async function readCredential(): Promise<Credential | undefined> {
	// Opción 1: variable de entorno
	if (process.env.DEVENGINE_API_KEY) {
		return { access: process.env.DEVENGINE_API_KEY };
	}

	// Opción 2: archivo de auth de Frida
	const authPath = `${process.env.HOME}/.frida/auth.json`;
	if (!existsSync(authPath)) return undefined;

	try {
		const fsp = await import("node:fs/promises");
		const auth = JSON.parse(await fsp.readFile(authPath, "utf8"));
		return auth["softtek-devengine"] ?? undefined;
	} catch {
		return undefined;
	}
}

// ─── Sandbox (fixtures de archivos para tools core) ─────────────────────────

/** Crea un directorio temporal con fixtures para las pruebas de tools core. */
export function makeSandbox(): string {
	const dir = mkdtempSync(join(tmpdir(), "devengine-e2e-"));
	writeFileSync(
		join(dir, "poema.txt"),
		"Rosa rosae.\nEl PIN secreto es 7731.\nFin.\n",
	);
	writeFileSync(join(dir, "config.txt"), "color=rojo\nsize=10\n");
	writeFileSync(join(dir, "alpha.md"), "fruta: aguacate\n");
	writeFileSync(join(dir, "beta.md"), "fruta: sandia\n");
	writeFileSync(join(dir, "gamma.txt"), "sin fruta\n");

	const deepDir = join(dir, "deep", "nested");
	mkdirSync(deepDir, { recursive: true }); // Crea subdirectorios
	writeFileSync(join(deepDir, "tesoro.txt"), "aquí estoy\n");

	return dir;
}

// ─── Tools core (SDK) ────────────────────────────────────────────────────────

/** Carga las tools core del SDK con EXECUTE real y cwd del sandbox.
 *  require de ruta absoluta bypasea el exports map (patrón FE). */
export function createCoreTools(sandboxRoot: string): Record<
	string,
	{
		name: string;
		description: string;
		parameters: unknown;
		execute: (
			sessionId: string,
			args: any,
			...rest: any[]
		) => Promise<string | { content: string }>;
	}
> {
	const toolsPath = findInNodeModules(`${PACA}/dist/core/tools/index.js`);
	if (!toolsPath) throw new Error("tools/index.js de pi-coding-agent no encontrado");
	const { createAllToolDefinitions } = require_(toolsPath);
	return createAllToolDefinitions(sandboxRoot);
}

// ─── Engine de llamadas a DevEngine ──────────────────────────────────────────

export interface FnCall {
	name: string;
	arguments: string;
	call_id: string;
}

export interface TurnResult {
	fnCalls: FnCall[];
	text: string;
	thinkingChars: number;
	reasoningTokens: number;
	stopReason?: string;
}

export interface EngineOpts {
	baseUrl: string;
	key: string;
	model: string;
}

/** Motor de llamadas a /v1/chat/completions con soporte de tools y reasoning. */
export async function makeEngine(opts: EngineOpts) {
	const { stream } = await loadOpenAICompletions();

	const model = {
		id: opts.model,
		provider: "softtek-devengine",
		api: "openai-completions",
		// ⚠️ SIN "/v1": el SDK de OpenAI añade solo /chat/completions al baseUrl
		// (Errata-4). La superficie /v1/* del gateway es OTRA API (pide headers
		// anthropic y rutea distinto) — no es el camino del host.
		baseUrl: opts.baseUrl,
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		// Paridad EXACTA con buildSofttekProviderConfig (src/providers/softtek-
		// provider.ts): sin estos flags, pi-ai envía historial crudo que el
		// gateway rechaza con 500 (ADR-0009). El host los registra al montar
		// el provider — el E2E debe medir la cadena real, no el bug conocido.
		compat: {
			supportsReasoningEffort: true,
			requiresThinkingAsText: true,
			requiresAssistantAfterToolResult: true,
		},
	};

	/** Una vuelta del modelo. Recibe messages formato pi (el adapter los convierte). */
	async function turn(
		messages: unknown[],
		tools: Array<{
			type: "function";
			name: string;
			description: string;
			parameters: any;
		}>,
		turnOpts: { maxTokens?: number; reasoningEffort?: string } = {},
	): Promise<TurnResult> {
		let finalText = "";
		let thinkingChars = 0;
		let reasoningTokens = 0;
		const fnCalls: FnCall[] = [];

		// Dump del último payload (diagnóstico de 500 sin body — patrón ADR-0009)
		let lastPayload: any = null;
		let result: any;
		try {
			const res = await collectStream(
				stream(
					model as any,
					{ messages: messages as any, tools } as any,
					{
						apiKey: opts.key,
						headers: {
							"X-Api-Key": opts.key,
							"authorization": null, // el host lo anula: solo X-Api-Key
						},
						maxTokens: turnOpts.maxTokens ?? 4000,
						reasoningEffort: turnOpts.reasoningEffort ?? "medium",
						onPayload: (p: any) => {
							lastPayload = p;
							return undefined; // sin mutación: el payload viaja tal cual
						},
					},
					),
				);
				result = res;
			} catch (err: any) {
				// Dumpea el último payload para diagnóstico (el 500 del gateway no
				// trae body — mismo problema que motivó el dump del host, ADR-0009).
				if (lastPayload) {
					try {
						const fsp = await import("node:fs/promises");
						await fsp.writeFile(
									"/tmp/devengine-last-failing-payload.json",
									JSON.stringify(lastPayload, null, 2),
						);
					} catch { /* noop */ }
				}
			throw err;
		}

		for (const block of (result?.content ?? []) as any[]) {
			if (block.type === "text") finalText += block.text ?? "";
			if (block.type === "thinking") thinkingChars += (block.thinking ?? "").length;
			if (block.type === "toolCall") {
				fnCalls.push({
					name: block.name,
					arguments:
						typeof block.arguments === "string"
							? block.arguments
							: JSON.stringify(block.arguments ?? {}),
					call_id: block.id ?? `call_${fnCalls.length}`,
				});
			}
		}

		// usage.reasoning (nombre pi-ai; el probe muestra el campo así)
		reasoningTokens = (result as any)?.usage?.reasoning ?? (result as any)?.usage?.reasoning_tokens ?? 0;

		return {
			fnCalls,
			text: finalText,
			thinkingChars,
			reasoningTokens,
			stopReason: result?.stopReason,
		};
	}

	return { turn };
}

// ─── Helpers de stream ───────────────────────────────────────────────────────

/** Carga el adapter openai-completions de pi-ai (stream/streamSimple). */
async function loadOpenAICompletions() {
	const apiPath = findInNodeModules(
		`${PACA}/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`,
	);
	if (!apiPath)
		throw new Error("openai-completions.js de pi-ai no encontrado (¿fuera del repo?)");
	return await import(pathToFileURL(apiPath).href);
}

/** Consume un stream de pi-ai y devuelve el AssistantMessage final
 *  (patrón del harness FE: el evento "done" lleva message; "error" lanza). */
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

// ─── Runner mock (para hooks) ────────────────────────────────────────────────

/** Mock minimalista de ExtensionHooks para registrar los hooks de DevEngine. */
export class MockRunner {
	private hooks: Map<string, Array<(event: any, ctx?: any) => any>> = new Map();

	register(factory: (api: ExtensionAPI) => void) {
		const api: ExtensionAPI = {
			on: (event: string, handler: (event: any, ctx?: any) => any) => {
				if (!this.hooks.has(event)) this.hooks.set(event, []);
				this.hooks.get(event)!.push(handler);
			},
		} as any;
		factory(api);
	}

	trigger(event: string, payload: any, ctx?: any): any {
		const handlers = this.hooks.get(event) ?? [];
		let result = payload;
		for (const h of handlers) {
			const out = h(result, ctx);
			if (out !== undefined) result = out;
		}
		return result;
	}
}

export async function makeRunner(): Promise<MockRunner> {
	return new MockRunner();
}
