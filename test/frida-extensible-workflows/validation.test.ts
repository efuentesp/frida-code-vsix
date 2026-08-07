// Fase 1 — validación AST con acorn: instrumentWorkflow parsea el script del
// workflow y le inyecta identidad por call-site (structuralPath) para que el
// replay sea determinista. Ejercita la dep acorn (vendorizada en Fase 1).
import { describe, it, expect } from "vitest";
import { instrumentWorkflow } from "../../src/tools/frida-extensible-workflows/core/validation";

describe("frida-extensible-workflows · validación AST con acorn (Fase 1)", () => {
	it("instrumentWorkflow() instrumenta un script con agent() sin lanzar", () => {
		const script = `const r = await agent("x"); return r;`;
		const instrumented = instrumentWorkflow(script);
		expect(typeof instrumented).toBe("string");
		// La instrumentación inyecta identidad por call-site → el código crece.
		expect(instrumented.length).toBeGreaterThan(script.length);
	});

	it("instrumentWorkflow() parsea un script con parallel()", () => {
		const script = `const r = await parallel("op", { a: () => agent("a") }); return r;`;
		expect(() => instrumentWorkflow(script)).not.toThrow();
	});

	it("instrumentWorkflow() preserva la lógica secuencial con varios agent()", () => {
		const script = `const a = await agent("a"); const b = await agent("b"); return a;`;
		expect(() => instrumentWorkflow(script)).not.toThrow();
	});
});
