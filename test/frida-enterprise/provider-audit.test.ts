// #86: provider-audit como extensión del SDK — los hooks
// before_provider_request / after_provider_response son eventos de la
// ExtensionAPI (pi.on), NO del AgentSession (regresión 2026-08-19:
// wireSession llamó session.on → "session.on is not a function" → ninguna
// sesión arrancó). Contrato del factory aquí.

import { describe, expect, it } from "vitest";
import { createProviderAuditHooks } from "../../src/providers/provider-audit";

function fakePi() {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	return {
		on(event: string, handler: (event: any, ctx: any) => any) {
			(handlers[event] ??= []).push(handler);
		},
		fire(event: string, ev: any, ctx: any = {}) {
			for (const h of handlers[event] ?? []) h(ev, ctx);
		},
	};
}

describe("createProviderAuditHooks (#86 provider-audit por extensión)", () => {
	it("REQUEST: loggea provider/model del payload y del ctx en cada llamada al LLM", () => {
		const pi = fakePi();
		const lines: string[] = [];
		createProviderAuditHooks({
			append: (l) => lines.push(l),
			tag: () => "ws-abc1",
		})(pi as any);

		pi.fire("before_provider_request", {
			payload: { model: "glm-5.3", messages: [] },
		}, { model: { provider: "z.ai", id: "glm-5.3" } });

		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(
			/\[ws-abc1\] REQUEST model=z\.ai\/glm-5\.3/,
		);
	});

	it("REQUEST sin payload.model cae al modelo del ctx (nunca muere)", () => {
		const pi = fakePi();
		const lines: string[] = [];
		createProviderAuditHooks({
			append: (l) => lines.push(l),
			tag: () => "t",
		})(pi as any);

		pi.fire("before_provider_request", { payload: {} }, {
			model: { provider: "devengine", id: "gpt-5.4-x" },
		});
		expect(lines[0]).toContain("REQUEST model=devengine/gpt-5.4-x");
	});

	it("HTTP: status ≥400 loggea y notifica onHttpError; <400 no escribe", () => {
		const pi = fakePi();
		const lines: string[] = [];
		const http: Array<{ status: number }> = [];
		createProviderAuditHooks({
			append: (l) => lines.push(l),
			tag: () => "t",
			onHttpError: (status) => http.push({ status }),
		})(pi as any);

		pi.fire("after_provider_response", { status: 200, headers: {} }, {
			model: { provider: "z.ai", id: "m" },
		});
		expect(lines).toHaveLength(0);

		pi.fire("after_provider_response", { status: 500, headers: {} }, {
			model: { provider: "devengine", id: "gpt-5.4" },
		});
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/HTTP status=500 model=devengine\/gpt-5\.4/);
		expect(http).toEqual([{ status: 500 }]);
	});

	it("nunca lanza aunque el appender o el evento vengan rotos (forense best-effort)", () => {
		const pi = fakePi();
		createProviderAuditHooks({
			append: () => {
				throw new Error("disco lleno");
			},
			tag: () => "t",
		})(pi as any);

		expect(() =>
			pi.fire("before_provider_request", { payload: null }, {}),
		).not.toThrow();
		expect(() =>
			pi.fire("after_provider_response", null as any, {}),
		).not.toThrow();
	});
});
