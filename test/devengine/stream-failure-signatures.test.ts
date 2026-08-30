// INCIDENTE 2026-08-29/30 — Firmas de fallo del gateway DevEngine en streaming.
//
// Reproduce DETERMINISTAMENTE (servidor SSE local, sin red) las dos firmas con
// las que el gateway falló ~19 veces durante la sesión SELE-DEV del 29-ago
// (ver reporte-incidente-2-devengine.md):
//
//  FIRMA A — "Error procesando la respuesta del proveedor"
//    El gateway responde 200 + text/event-stream, streamea unos chunks y
//    luego emite un evento SSE `data: {"error": {...}}` SIN status HTTP, con
//    un mensaje en español propio del gateway. Cualquier cliente OpenAI-compat
//    (SDK openai-node core/streaming.js:50 → APIError(undefined, data.error))
//    lo recibe como stopReason=error con el mensaje VERBATIM y sin status →
//    error opaco e inaccionable. En producción ocurrió ~61-68s tras el request.
//
//  FIRMA B — "Request timed out."
//    El gateway acepta la conexión pero NUNCA devuelve ni los headers de la
//    respuesta. El timeout del cliente (efectivo ~60s en el host; aquí 1.5s
//    para el test) aborta → APIConnectionTimeoutError → "Request timed out.".
//    En producción ocurrió a los 71-85s del request.
//
// El caso CONTROL demuestra que el mismo harness con un stream correcto
// termina bien — las firmas A/B son causadas por el comportamiento del
// gateway, no por el cliente.
//
// Ejecutar: npx vitest run test/devengine/stream-failure-signatures.test.ts

import { describe, expect, it, afterEach } from "vitest";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { findInNodeModules } from "./e2e/harness";

const PACA = "@earendil-works/pi-coding-agent";

// ─── Adapter pi-ai (mismo mecanismo que el harness e2e) ─────────────────────

async function loadStream(): Promise<any> {
	const apiPath = findInNodeModules(
		`${PACA}/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`,
	);
	if (!apiPath)
		throw new Error("openai-completions.js de pi-ai no encontrado");
	const mod = await import(pathToFileURL(apiPath).href);
	return mod.stream;
}

/** Config del modelo idéntica al harness e2e (paridad con el host). */
function makeModel(baseUrl: string) {
	return {
		id: "gpt-5.6-sol",
		provider: "softtek-devengine",
		api: "openai-completions",
		baseUrl,
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		compat: {
			supportsReasoningEffort: true,
			requiresThinkingAsText: true,
			requiresAssistantAfterToolResult: true,
		},
	};
}

// ─── Servidor SSE local que emula el comportamiento observado ───────────────

interface FakeServerHandle {
	server: Server;
	url: string;
	/** Último body recibido (para verificar el wiring del request). */
	lastRequestBody: any;
}

type FakeHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	writeHead: () => void,
) => void;

function startServer(handler: FakeHandler): Promise<FakeServerHandle> {
	const handle: FakeServerHandle = {
		server: null as unknown as Server,
		url: "",
		lastRequestBody: null,
	};
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			let body = "";
			req.on("data", (c) => (body += c));
			req.on("end", () => {
				try {
					handle.lastRequestBody = JSON.parse(body);
				} catch {
					handle.lastRequestBody = null;
				}
				const writeHead = () => {
					res.writeHead(200, {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
					});
				};
				handler(req, res, writeHead);
			});
		});
		handle.server = server;
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as { port: number };
			handle.url = `http://127.0.0.1:${addr.port}/v1`;
			resolve(handle);
		});
	});
}

function closeServer(handle?: FakeServerHandle) {
	return new Promise<void>((resolve) => {
		if (!handle) return resolve();
		// closeAllConnections mata sockets colgados (firma B); Node >= 18.2.
		(handle.server as unknown as { closeAllConnections?: () => void })
			.closeAllConnections?.();
		handle.server.close(() => resolve());
	});
}

/** Chunk SSE formato OpenAI chat.completion.chunk. */
function chunk(delta: Record<string, unknown>, finishReason: string | null) {
	return `data: ${JSON.stringify({
		id: "chatcmpl-firma",
		object: "chat.completion.chunk",
		created: 1,
		model: "gpt-5.6-sol",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	})}\n\n`;
}

/** Evento de error SSE tal como lo emite el gateway DevEngine (firma A):
 *  JSON con campo `error` SIN status HTTP asociado (el status fue 200).
 *  Shape idéntico al body del 500 del probe 2026-08-26
 *  (devengine-gateway-diagnosis.json). */
const GATEWAY_SPANISH_ERROR_EVENT = `data: ${JSON.stringify({
	error: {
		message: "Error procesando la respuesta del proveedor",
		type: "server_error",
		param: null,
		code: "internal_error",
	},
})}\n\n`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Colección de eventos del stream ────────────────────────────────────────

/** Consume el stream de pi-ai y devuelve el mensaje final (done) y el mensaje
 *  del evento "error" — sin lanzar: capturamos la firma exacta. */
async function collect(s: any): Promise<{ done: any; error: any }> {
	let done: any;
	let error: any;
	for await (const ev of s) {
		if (ev.type === "done") done = ev.message ?? ev.partial;
		if (ev.type === "error") error = ev.error ?? ev.partial;
	}
	return { done, error };
}

async function runTurn(handle: FakeServerHandle, timeoutMs?: number) {
	const stream = await loadStream();
	const s = stream(
		makeModel(handle.url),
		{
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Resume en 2 líneas qué es una API REST." },
					],
				},
			],
			tools: [],
		},
		{
			apiKey: "test-key",
			headers: { "X-Api-Key": "test-key", authorization: null },
			maxTokens: 500,
			reasoningEffort: "medium",
			maxRetries: 0,
			...(timeoutMs === undefined ? {} : { timeoutMs }),
		},
	);
	return collect(s);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Firmas de fallo del gateway DevEngine (incidente 29-30/ago, sin red)", () => {
	let handle: FakeServerHandle | undefined;
	afterEach(async () => {
		await closeServer(handle);
		handle = undefined;
	});

	it("FIRMA A: error SSE del gateway sin status → mensaje español VERBATIM como errorMessage (opaco)", async () => {
		handle = await startServer(async (_req, res, writeHead) => {
			writeHead();
			// Streaming normal primero (el gateway SÍ empezó a responder)…
			res.write(chunk({ role: "assistant", content: "" }, null));
			await sleep(25);
			res.write(chunk({ content: "Una API REST expone recursos" }, null));
			await sleep(25);
			// …y LUEGO falla procesando la respuesta de su upstream: evento
			// error SIN status HTTP. El stream muere a mitad.
			res.write(GATEWAY_SPANISH_ERROR_EVENT);
			res.end();
		});

		const { done, error } = await runTurn(handle);

		// El mensaje NUNCA llega a completarse.
		expect(done).toBeUndefined();
		expect(error?.stopReason).toBe("error");
		// La firma textual EXACTA observada en producción: el mensaje del
		// gateway llega VERBATIM (openai SDK: APIError(undefined, data.error)
		// → makeMessage devuelve error.message sin status).
		expect(String(error?.errorMessage)).toBe(
			"Error procesando la respuesta del proveedor",
		);
		// Sin status HTTP en el mensaje → opaco para el usuario (no hay
		// "500 ..." ni código accionable).
		expect(String(error?.errorMessage)).not.toMatch(/^\d{3}\b/);
		// El request viajó completo al "gateway".
		expect(handle.lastRequestBody?.model).toBe("gpt-5.6-sol");
		expect(handle.lastRequestBody?.stream).toBe(true);
	});

	it("FIRMA B: gateway que nunca responde → timeout del cliente → 'Request timed out.'", async () => {
		const t0 = Date.now();
		handle = await startServer((_req, _res, _writeHead) => {
			// NO responde: ni headers ni body. El gateway quedó colgado
			// procesando (upstream atascado) — lo observado en producción.
		});
		const { done, error } = await runTurn(handle, 1500);
		const elapsed = Date.now() - t0;
		expect(done).toBeUndefined();
		expect(error?.stopReason).toBe("error");
		// APIConnectionTimeoutError del SDK openai — la firma textual.
		expect(String(error?.errorMessage)).toMatch(/^Request timed out\.?$/i);
		// El abort ocurrió por el timeout del cliente (≈1.5s), no por otra cosa.
		expect(elapsed).toBeGreaterThanOrEqual(1400);
		expect(elapsed).toBeLessThan(8000);
		// El request sí llegó al servidor (wiring correcto).
		expect(handle.lastRequestBody?.model).toBe("gpt-5.6-sol");
	});

	it("CONTROL: stream correcto (chunks + finish stop + [DONE]) → stopReason 'stop' con texto", async () => {
		handle = await startServer(async (_req, res, writeHead) => {
			writeHead();
			res.write(chunk({ role: "assistant", content: "" }, null));
			await sleep(20);
			res.write(chunk({ content: "Una API REST expone recursos vía HTTP." }, null));
			await sleep(20);
			res.write(chunk({}, "stop"));
			res.write("data: [DONE]\n\n");
			res.end();
		});

		const { done, error } = await runTurn(handle);

		// El mismo harness, con un gateway que se comporta, termina bien:
		// prueba que las firmas A/B son del gateway, no del cliente.
		expect(error).toBeUndefined();
		expect(done?.stopReason).toBe("stop");
		const text = (done?.content ?? [])
			.filter((b: any) => b.type === "text")
			.map((b: any) => b.text)
			.join("");
		expect(text).toContain("API REST");
	});
});
