// ADR-0009 + H-2/H-3 (HALLAZGOS-GATEWAY.md) — TDD del mitigador de errores
// opacos del gateway DevEngine:
//
//  H-2: el gateway valida tools DECLARADAS contra un registro por proyecto
//       (vacío) cuando su clasificador vincula la intención del texto del
//       usuario con una tool → 400 "No existe una tool activa con nombre 'X'".
//  H-3: con stream:true ese 400 se manifiesta como 500 SIN body → el usuario
//       ve "500 Internal Server Error" sin forma de actuar.
//
// Mitigador: al detectar un mensaje de assistant con stopReason "error" y
// status 5xx, se hace UN re-probe del mismo payload con stream:false para
// capturar el error REAL, se clasifica y se expone un mensaje accionable.

import { describe, expect, it, vi } from "vitest";
import {
	classifyGatewayError,
	createSofttekProviderHooks,
	diagnoseOpaque500,
	DEVENGINE_INACTIVE_TOOL_RE,
	type GatewayDiagnosis,
} from "../../src/providers/softtek-provider";

// ─── classifyGatewayError (pura) ─────────────────────────────────────────────

describe("classifyGatewayError", () => {
	const inactiveToolBody = JSON.stringify({
		error: {
			message:
				"No existe una tool activa con nombre 'steer_subagent' para el proyecto 22",
			type: "invalid_request_error",
			code: "invalid_request",
		},
	});

	it("H-2: 400 con 'No existe una tool activa con nombre X' → inactive-tool-validation + toolName", () => {
		const r = classifyGatewayError(400, inactiveToolBody);
		expect(r.kind).toBe("inactive-tool-validation");
		expect(r.toolName).toBe("steer_subagent");
		expect(r.actionableMessage).toMatch(/steer_subagent/);
		expect(r.actionableMessage).toMatch(/DevEngine/i);
	});

	it("H-3: 500 con body genérico → server-error (opaco, requiere re-probe)", () => {
		const r = classifyGatewayError(500, "Internal Server Error");
		expect(r.kind).toBe("server-error");
		expect(r.toolName).toBeUndefined();
	});

	it("400 con otro mensaje → invalid-request (no tool)", () => {
		const r = classifyGatewayError(400, JSON.stringify({ error: { message: "Falta el header X" } }));
		expect(r.kind).toBe("invalid-request");
	});

	it("regex exportada captura el nombre de la tool", () => {
		const m = DEVENGINE_INACTIVE_TOOL_RE.exec(
			"No existe una tool activa con nombre 'read' para el proyecto 22",
		);
		expect(m?.[1]).toBe("read");
	});
});

// ─── diagnoseOpaque500 (re-probe con stream:false) ───────────────────────────

function fakeFetch(status: number, body: string) {
	return vi.fn().mockResolvedValue(
		new Response(body, { status, headers: { "Content-Type": "application/json" } }),
	);
}

describe("diagnoseOpaque500", () => {
	const payload = {
		model: "gpt-5.4-mini",
		stream: true,
		stream_options: { include_usage: true },
		messages: [{ role: "user", content: "Envía el mensaje al sub-agente agent-123." }],
		tools: [{ type: "function", function: { name: "steer_subagent", description: "d", parameters: {} } }],
	};

	it("re-probe con stream:false captura el 400 real y lo clasifica (H-3→H-2)", async () => {
		const fetchFn = fakeFetch(
			400,
			JSON.stringify({
				error: {
					message:
						"No existe una tool activa con nombre 'steer_subagent' para el proyecto 22",
				},
			}),
		);
		const diag = await diagnoseOpaque500(payload, {
			key: "test-key",
			fetchImpl: fetchFn as unknown as typeof fetch,
		});
		// el probe viajó SIN stream y con X-Api-Key
		const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		expect(String(url)).toMatch(/\/chat\/completions$/);
		expect(JSON.parse(String(init.body)).stream).toBe(false);
		expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
		// diagnóstico completo
		expect(diag.probeStatus).toBe(400);
		expect(diag.kind).toBe("inactive-tool-validation");
		expect(diag.toolName).toBe("steer_subagent");
		expect(diag.actionableMessage).toContain("steer_subagent");
		expect(diag.probedAt).toBeTruthy();
	});

	it("nunca lanza: fetch que rechaza → kind unknown con el error capturado", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
		const diag = await diagnoseOpaque500(payload, {
			key: "k",
			fetchImpl: fetchFn as unknown as typeof fetch,
		});
		expect(diag.kind).toBe("unknown");
		expect(diag.probeStatus).toBeNull();
		expect(String(diag.probeBodyText)).toMatch(/network down/);
	});
});

// ─── Wiring del hook: message_end error 5xx → onGatewayDiagnosis ────────────

describe("createSofttekProviderHooks + message_end (wiring del mitigador)", () => {
	function makePi() {
		const handlers = new Map<string, Array<(e: any, ctx?: any) => any>>();
		return {
			on: (ev: string, h: (e: any, ctx?: any) => any) => {
				if (!handlers.has(ev)) handlers.set(ev, []);
				handlers.get(ev)!.push(h);
			},
			emit: (ev: string, e: any, ctx?: any) =>
				(handlers.get(ev) ?? []).forEach((h) => h(e, ctx)),
		};
	}

	it("assistant con stopReason error 500 → dispara diagnóstico y notifica", async () => {
		const pi = makePi();
		const seen: GatewayDiagnosis[] = [];
		const factory = createSofttekProviderHooks({
			getKey: () => "test-key",
			onUnauthorized: () => {},
			onGatewayDiagnosis: (d) => seen.push(d),
			fetchImpl: fakeFetch(
				400,
				JSON.stringify({
					error: { message: "No existe una tool activa con nombre 'read' para el proyecto 22" },
				}),
			) as unknown as typeof fetch,
		});
		factory(pi as any);
		// sembrar lastPayload: request + headers SOFTTEK (el apareo payload↔proveedor
		// vive en before_provider_headers, que sí recibe ctx.model.provider)
		pi.emit("before_provider_request", {
			payload: { model: "gpt-5.4-mini", stream: true, messages: [], tools: [] },
		});
		pi.emit(
			"before_provider_headers",
			{ headers: {} },
			{ model: { provider: "softtek-devengine", modelId: "gpt-5.4-mini" } },
		);
		// error 500 del stream (lo que hoy ve el usuario como opaco)
		pi.emit("message_end", {
			message: {
				role: "assistant",
				provider: "softtek-devengine",
				stopReason: "error",
				errorMessage: "500 Internal Server Error",
			},
		});
		await vi.waitFor(() => expect(seen.length).toBe(1), { timeout: 2000 });
		expect(seen[0].kind).toBe("inactive-tool-validation");
		expect(seen[0].toolName).toBe("read");
	});

	it("mensajes normales y errores NO-5xx NO disparan el probe", async () => {
		const pi = makePi();
		const seen: GatewayDiagnosis[] = [];
		const fetchFn = fakeFetch(400, "{}");
		const factory = createSofttekProviderHooks({
			getKey: () => "test-key",
			onUnauthorized: () => {},
			onGatewayDiagnosis: (d) => seen.push(d),
			fetchImpl: fetchFn as unknown as typeof fetch,
		});
		factory(pi as any);
		pi.emit("before_provider_request", { payload: { model: "m", stream: true } });
		pi.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
		pi.emit("message_end", {
			message: { role: "user", stopReason: "error", errorMessage: "500" },
		});
		pi.emit("message_end", {
			message: {
				role: "assistant",
				provider: "softtek-devengine",
				stopReason: "error",
				errorMessage: "400 Bad Request",
			},
		});
		await new Promise((r) => setTimeout(r, 150));
		expect(seen).toHaveLength(0);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	// #137 — misatribución: un 5xx de ORO proveedor no debe tocarnos
	it("#137: error 500 de zai (u otro proveedor) NO dispara probe ni diagnóstico", async () => {
		const pi = makePi();
		const seen: GatewayDiagnosis[] = [];
		const fetchFn = fakeFetch(500, JSON.stringify({ error: { message: "Error interno" } }));
		const factory = createSofttekProviderHooks({
			getKey: () => "test-key",
			onUnauthorized: () => {},
			onGatewayDiagnosis: (d) => seen.push(d),
			fetchImpl: fetchFn as unknown as typeof fetch,
		});
		factory(pi as any);
		// request de zai (glm-5.3) — el caso real del bug: falla con 500
		pi.emit("before_provider_request", {
			payload: { model: "glm-5.3", stream: true, messages: [], tools: [] },
		});
		pi.emit(
			"before_provider_headers",
			{ headers: {} },
			{ model: { provider: "zai", modelId: "glm-5.3" } },
		);
		pi.emit("message_end", {
			message: {
				role: "assistant",
				provider: "zai",
				stopReason: "error",
				errorMessage:
					'500: {"code":"1234","message":"Network error, error id: 202608262201439fd51da0391645d4"}',
			},
		});
		await new Promise((r) => setTimeout(r, 150));
		expect(seen).toHaveLength(0);
		expect(fetchFn).not.toHaveBeenCalled(); // nada de re-enviar el payload a DevEngine
	});

	it("#137: request de otro proveedor NO captura lastPayload (un 500 real de softtek posterior no hereda payload ajeno)", async () => {
		const pi = makePi();
		const seen: GatewayDiagnosis[] = [];
		const fetchFn = fakeFetch(500, "{}");
		const factory = createSofttekProviderHooks({
			getKey: () => "test-key",
			onUnauthorized: () => {},
			onGatewayDiagnosis: (d) => seen.push(d),
			fetchImpl: fetchFn as unknown as typeof fetch,
		});
		factory(pi as any);
		// sólo request de zai, sin apareo de headers de softtek → lastPayload debe seguir vacío
		pi.emit("before_provider_request", {
			payload: { model: "glm-5.3", stream: true, messages: [], tools: [] },
		});
		pi.emit("message_end", {
			message: {
				role: "assistant",
				provider: "softtek-devengine",
				stopReason: "error",
				errorMessage: "500 Internal Server Error",
			},
		});
		await new Promise((r) => setTimeout(r, 150));
		expect(seen).toHaveLength(0);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
