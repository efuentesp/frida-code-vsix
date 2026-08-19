// Unitarias de los hooks de sesión (ADR-1002) — instrumentación message_end
// (Errata-11/#2): ante cortes de conversación con modelos frida, el log de
// debug debe registrar stopReason + composición del mensaje para diagnosticar
// si fue "length" (truncado), "error" (fallo) o "stop" conductual del modelo.

import { describe, expect, it, vi } from "vitest";
import {
	createFridaEnterpriseHooks,
	createFridaEnterpriseRuntime,
	reasoningEffortTag,
	summarizeMessageEnd,
} from "../../src/providers/frida-enterprise";

function assistantMessage(overrides: Record<string, unknown> = {}) {
	return {
		role: "assistant",
		provider: "frida-enterprise",
		model: "NIKE-VICTORY",
		stopReason: "stop",
		content: [
			{ type: "thinking", thinking: "pienso…" },
			{ type: "text", text: "hola" },
			{ type: "text", text: "mundo" },
			{ type: "toolCall", id: "c1", name: "bash", arguments: {} },
		],
		...overrides,
	};
}

describe("summarizeMessageEnd (pura)", () => {
	it("resume stopReason + conteo de bloques + largo de texto", () => {
		const s = summarizeMessageEnd(assistantMessage());
		expect(s).toContain("stop=stop");
		expect(s).toContain("thinking:1");
		expect(s).toContain("text:2");
		expect(s).toContain("toolCall:1");
	});

	it("marca stopReason=length explícitamente (el caso del corte)", () => {
		const s = summarizeMessageEnd(assistantMessage({ stopReason: "length" }));
		expect(s).toContain("stop=length");
	});

	it("incluye errorMessage cuando existe", () => {
		const s = summarizeMessageEnd(
			assistantMessage({ stopReason: "error", errorMessage: "422 status code" }),
		);
		expect(s).toContain("stop=error");
		expect(s).toContain("422 status code");
	});

	it("ADR-1003-F3: usage.reasoning>0 → registra tokens razonados (aunque no llegara tarjeta)", () => {
		const s = summarizeMessageEnd(
			assistantMessage({
				usage: { reasoning: 427, input: 10, output: 500 },
				content: [{ type: "text", text: "respuesta" }],
			}),
		);
		expect(s).toContain("reasoning=427");
	});

	it("ADR-1003-F3: sin usage.reasoning no añade el campo (ruido cero)", () => {
		const s = summarizeMessageEnd(
			assistantMessage({ usage: { input: 10, output: 500 } }),
		);
		expect(s).not.toContain("reasoning=");
	});

	it("mensaje malformado → resumen defensivo, sin lanzar", () => {
		expect(() => summarizeMessageEnd(undefined as any)).not.toThrow();
		expect(() => summarizeMessageEnd({} as any)).not.toThrow();
		expect(summarizeMessageEnd(null as any)).toContain("message_end");
	});
});

describe("createFridaEnterpriseHooks: instrumentación message_end", () => {
	function makePi() {
		const handlers: Record<string, Function[]> = {};
		return {
			pi: { on: (ev: string, fn: Function) => (handlers[ev] ??= []).push(fn) },
			handlers,
		};
	}

	it("registra el listener y resume mensajes frida sin lanzar", () => {
		const { pi, handlers } = makePi();
		const hooks = createFridaEnterpriseHooks({
			onUnauthorized: () => {},
			runtime: createFridaEnterpriseRuntime(["NIKE-VICTORY"]),
		});
		hooks(pi as any);
		expect(handlers["message_end"]).toBeDefined();

		// mensaje frida: se procesa (dbg escribe al log; aquí basta no-throw)
		expect(() =>
			handlers["message_end"][0]({ type: "message_end", message: assistantMessage() }),
		).not.toThrow();
	});

	it("ignora (sin procesar) mensajes de otros providers", () => {
		const { pi, handlers } = makePi();
		createFridaEnterpriseHooks({
			onUnauthorized: () => {},
			runtime: createFridaEnterpriseRuntime(),
		})(pi as any);
		const fn = handlers["message_end"][0];
		// glm: NO debe explotar ni procesar — el gate por provider aplica
		expect(() =>
			fn({ type: "message_end", message: assistantMessage({ provider: "zai" }) }),
		).not.toThrow();
	});

	it("mensaje_end con event.message getter roto no rompe (Errata-6)", () => {
		const { pi, handlers } = makePi();
		createFridaEnterpriseHooks({
			onUnauthorized: () => {},
			runtime: createFridaEnterpriseRuntime(),
		})(pi as any);
		const evil: any = {};
		Object.defineProperty(evil, "message", {
			get() {
				throw new Error("boom");
			},
		});
		expect(() => handlers["message_end"][0](evil)).not.toThrow();
	});
});

describe("createFridaEnterpriseHooks: observabilidad del effort (ADR-1003-F2)", () => {
	function makePi() {
		const handlers: Record<string, Function[]> = {};
		return {
			pi: { on: (ev: string, fn: Function) => (handlers[ev] ??= []).push(fn) },
			handlers,
		};
	}

	function wiredRuntime() {
		const runtime = createFridaEnterpriseRuntime(["SELENE-CIPHER", "NIKE-VICTORY"]);
		runtime.rememberToken(
			`x.${Buffer.from(JSON.stringify({ user_id: "u1", email: "a@b.c" })).toString("base64url")}.y`,
		);
		return runtime;
	}

	it("dbg de identidad inyectada incluye el tag del effort (payload con reasoning)", () => {
		// El contenido del tag lo cubren las unitarias de reasoningEffortTag;
		// aquí se garantiza que el hook lo calcula SOBRE EL PAYLOAD SALIENTE
		// (post buildFridaPayload) y que el camino no lanza. dbg escribe a
		// archivo en el exthost real; en vitest es no-op (sin require CJS).
		const { pi, handlers } = makePi();
		createFridaEnterpriseHooks({
			onUnauthorized: () => {},
			runtime: wiredRuntime(),
		})(pi as any);
		const payload = {
			model: "SELENE-CIPHER",
			messages: [{ role: "user", content: "hola" }],
			reasoning_effort: "high",
		};
		const out = handlers["before_provider_request"][0]({ payload }, {});
		expect(out).toBeDefined();
		// el tag sobre el payload TRADUCIDO debe reportar el effort (no ausente)
		expect(reasoningEffortTag(out)).toBe("reasoning=high");
	});

	it("payload sin effort → tag 'ausente' visible en el mismo camino (diagnóstico del default)", () => {
		const { pi, handlers } = makePi();
		createFridaEnterpriseHooks({
			onUnauthorized: () => {},
			runtime: wiredRuntime(),
		})(pi as any);
		const out = handlers["before_provider_request"][0](
			{ payload: { model: "SELENE-CIPHER", messages: [] } },
			{},
		);
		expect(reasoningEffortTag(out)).toBe("reasoning=ausente");
	});
});
