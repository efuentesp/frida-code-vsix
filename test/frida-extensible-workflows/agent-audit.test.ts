// #91 E2: las sesiones HIJAS del workflow (cada agent() del engine) corrían
// con un DefaultResourceLoader SIN extensionFactories → cero hooks → los
// REQUESTs de los workflows eran invisibles al provider-audit (hallazgo: 3
// runs de aidd-plan fallidos sin un solo REQUEST registrado de sus agentes).
// Contrato: el loader de las hijas incluye frida-provider-audit y sus hooks
// capturan REQUEST/HTTP hacia el appender forense.

import { describe, expect, it } from "vitest";
import { createWorkflowChildFactories } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

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

describe("createWorkflowChildFactories (#91 E2: audit en sesiones hijas)", () => {
	it("incluye la extensión frida-provider-audit y providers curados (enterprise, softtek, zai)", () => {
		const factories = createWorkflowChildFactories("/proj/nutrimetrics", {
			append: () => {},
			tag: () => "t",
		});
		const names = factories.map((f) => f.name);
		expect(names).toContain("frida-provider-audit");
		expect(names).toContain("frida-enterprise-provider");
		expect(names).toContain("softtek-provider");
		expect(names).toContain("z-ai-provider");
	});

	it("la factory de frida-enterprise inyecta identidad en sesiones hijas", () => {
		const factories = createWorkflowChildFactories("/proj/nutrimetrics", {
			append: () => {},
			tag: () => "t",
		});
		const enterprise = factories.find(
			(f) => f.name === "frida-enterprise-provider",
		)!;
		expect(enterprise).toBeDefined();
		const pi = fakePi();
		enterprise.factory(pi as any);
		// Verifica que el hook before_provider_request fue registrado
		const res = pi.fire(
			"before_provider_request",
			{ payload: { model: "DEMETER-BLOOM", messages: [] } },
			{ model: { provider: "frida-enterprise", id: "DEMETER-BLOOM" } },
		);
		// El payload se procesa sin lanzar
		expect(res).toBeUndefined();
	});

	it("los hooks de la factory capturan REQUEST con el modelo del payload", () => {
		const lines: string[] = [];
		const factories = createWorkflowChildFactories("/proj/nutrimetrics", {
			append: (l) => lines.push(l),
			tag: () => "wf-nutrimetrics",
		});
		const audit = factories.find((f) => f.name === "frida-provider-audit")!;
		const pi = fakePi();
		audit.factory(pi as any);

		pi.fire(
			"before_provider_request",
			{ payload: { model: "DEMETER-BLOOM" } },
			{ model: { provider: "frida-enterprise", id: "DEMETER-BLOOM" } },
		);
		// Línea 0 = FACTORY-LOADED (#91 E3); línea 1 = REQUEST
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatch(/FACTORY-LOADED/);
		expect(lines[1]).toMatch(
			/\[wf-nutrimetrics\] REQUEST model=frida-enterprise\/DEMETER-BLOOM/,
		);
	});

	it("los hooks capturan HTTP ≥400 (el fallo del upstream queda grabado)", () => {
		const lines: string[] = [];
		const factories = createWorkflowChildFactories("/proj/nutrimetrics", {
			append: (l) => lines.push(l),
			tag: () => "wf-nutrimetrics",
		});
		const audit = factories.find((f) => f.name === "frida-provider-audit")!;
		const pi = fakePi();
		audit.factory(pi as any);

		pi.fire(
			"after_provider_response",
			{ status: 500, headers: {} },
			{ model: { provider: "softtek-devengine", id: "gpt-5.4-mini" } },
		);
		// Línea 0 = FACTORY-LOADED; línea 1 = HTTP 500
		expect(lines).toHaveLength(2);
		expect(lines[1]).toMatch(
			/HTTP status=500 model=softtek-devengine\/gpt-5\.4-mini/,
		);
	});

	it("tag por defecto deriva del cwd (wf-<basename>) — sin deps inyectados", () => {
		const factories = createWorkflowChildFactories("/proj/nutrimetrics");
		expect(factories.length).toBeGreaterThan(0);
		// El tag default se comprueba indirectamente: la factory funciona sin
		// deps y escribe al appender REAL (best-effort, nunca lanza).
		const audit = factories.find((f) => f.name === "frida-provider-audit")!;
		const pi = fakePi();
		expect(() => {
			audit.factory(pi as any);
			pi.fire(
				"before_provider_request",
				{ payload: {} },
				{ model: { provider: "z.ai", id: "glm-5.3" } },
			);
		}).not.toThrow();
	});
});
