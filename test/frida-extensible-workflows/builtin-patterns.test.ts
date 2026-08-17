// Issue #19 Lote 1 — patrones curados builtin (multi-perspective,
// codebase-audit) de pi-dynamic-workflows portados a frida-extensible-workflows.
//
// Cubre:
//  1. resolve() valida args eager (falla antes de lanzar el run).
//  2. Los scripts generados EJECUTAN en el sandbox node:vm del runtime (fases,
//     parallel() con record dinámico, retorno) con un bridge mock.
//  3. multi-perspective usa las perspectivas de args o las 5 por defecto.
//  4. codebase-audit fanea un agente por check.
//  5. builtinPatternsCatalog expone ambos patrones para workflow_catalog.
import { describe, it, expect } from "vitest";
import { runWorkflow } from "../../src/tools/frida-extensible-workflows/core/execution";
import {
	BUILTIN_PATTERNS,
	DEFAULT_MULTI_PERSPECTIVES,
	builtinPatternsCatalog,
	findBuiltinPattern,
	generateCodebaseAuditWorkflow,
	generateMultiPerspectiveWorkflow,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import type {
	JsonValue,
	WorkflowBridge,
} from "../../src/tools/frida-extensible-workflows/core/types";

/** Bridge mock: agent(prompt) → `result:<prompt>`; permite inspeccionar llamadas. */
function mockBridge(prompts?: string[]): WorkflowBridge {
	return {
		agent: async (prompt: string) => {
			prompts?.push(prompt);
			return `result:${prompt}`;
		},
	};
}

/** Ejecuta el script de un patrón con args, contra un bridge mock. */
function runPattern(
	generate: () => string,
	args: JsonValue,
	bridge: WorkflowBridge,
) {
	return runWorkflow(generate(), args, bridge);
}

describe("frida-extensible-workflows · builtin-patterns (#19 Lote 1)", () => {
	it("registry: los 4 patrones (Lotes 1+2) registrados con metadata", () => {
		expect(BUILTIN_PATTERNS.map((p) => p.name)).toEqual([
			"multi-perspective",
			"codebase-audit",
			"adversarial-review",
			"code-review",
		]);
		const catalog = builtinPatternsCatalog();
		expect(catalog).toHaveLength(4);
		expect(catalog[0]).toMatchObject({
			name: "multi-perspective",
		});
		expect(catalog[1]).toMatchObject({
			name: "codebase-audit",
		});
		expect(catalog[2]).toMatchObject({ name: "adversarial-review" });
		expect(catalog[3]).toMatchObject({ name: "code-review" });
		expect(findBuiltinPattern("multi-perspective")?.description).toBeTruthy();
		expect(findBuiltinPattern("no-existe")).toBeUndefined();
	});

	it("multi-perspective: valida args eager — topic requerido", () => {
		const mp = findBuiltinPattern("multi-perspective")!;
		expect(() => mp.resolve(undefined)).toThrow(/topic/);
		expect(() => mp.resolve({})).toThrow(/topic/);
		expect(() => mp.resolve({ topic: "  " })).toThrow(/topic/);
		// <2 perspectivas NO es error: fallback a las 5 por defecto (runtime),
		// igual que el upstream. Lo que sí rompe: no-array, vacío o strings vacíos.
		expect(() => mp.resolve({ topic: "x", perspectives: "no-array" })).toThrow(
			/perspectives/,
		);
		expect(() => mp.resolve({ topic: "x", perspectives: [] })).toThrow(
			/perspectives/,
		);
		expect(() => mp.resolve({ topic: "x", perspectives: ["a", " "] })).toThrow(
			/perspectives/,
		);
		expect(() => mp.resolve({ topic: "x", perspectives: ["solo"] })).not.toThrow();
		expect(() =>
			mp.resolve({ topic: "x", perspectives: ["a", "b"] }),
		).not.toThrow();
		expect(() => mp.resolve({ topic: "x" })).not.toThrow();
	});

	it("codebase-audit: valida args eager — scope y checks requeridos", () => {
		const ca = findBuiltinPattern("codebase-audit")!;
		expect(() => ca.resolve({})).toThrow(/scope/);
		expect(() => ca.resolve({ scope: "src/" })).toThrow(/checks/);
		expect(() => ca.resolve({ scope: "src/", checks: [] })).toThrow(/checks/);
		expect(() =>
			ca.resolve({ scope: "src/", checks: ["imports circulares"] }),
		).not.toThrow();
	});

	it("multi-perspective: ejecuta en el sandbox con 5 perspectivas por defecto", async () => {
		const prompts: string[] = [];
		const exec = runPattern(
			generateMultiPerspectiveWorkflow,
			{ topic: "migrar a React 19" },
			mockBridge(prompts),
		);
		const result: any = await exec.result;
		// 5 perspectivas + 1 síntesis.
		expect(prompts).toHaveLength(6);
		expect(result.perspectives).toEqual([...DEFAULT_MULTI_PERSPECTIVES]);
		expect(result.topic).toBe("migrar a React 19");
		// El sintetizador recibe las 5 análisis (result:... por el mock)…
		expect(result.analyses).toHaveProperty("p1", "result:Analyze the following topic strictly from the technical perspective. Provide concrete, actionable insights specific to that perspective; do not cover other angles.\n\nTOPIC: migrar a React 19");
		expect(result.synthesis).toMatch(/^result:Synthesize these independent/);
	}, 20000);

	it("multi-perspective: <2 perspectivas cae a las 5 por defecto en runtime", async () => {
		const prompts: string[] = [];
		const exec = runPattern(
			generateMultiPerspectiveWorkflow,
			{ topic: "T", perspectives: ["solo"] },
			mockBridge(prompts),
		);
		const result: any = await exec.result;
		expect(prompts).toHaveLength(6); // 5 defaults + síntesis
		expect(result.perspectives).toEqual([...DEFAULT_MULTI_PERSPECTIVES]);
	}, 20000);

	it("multi-perspective: perspectivas custom (3) fanean 3 + síntesis", async () => {
		const prompts: string[] = [];
		const exec = runPattern(
			generateMultiPerspectiveWorkflow,
			{ topic: "T", perspectives: ["costo", "riesgo", "esfuerzo"] },
			mockBridge(prompts),
		);
		await exec.result;
		expect(prompts).toHaveLength(4);
		expect(prompts[0]).toContain("costo perspective");
		expect(prompts[2]).toContain("esfuerzo perspective");
	}, 20000);

	it("codebase-audit: ejecuta en el sandbox — check por agente + validator + report", async () => {
		const prompts: string[] = [];
		const exec = runPattern(
			generateCodebaseAuditWorkflow,
			{
				scope: "src/tools/",
				checks: ["imports circulares", "exports muertos"],
			},
			mockBridge(prompts),
		);
		const result: any = await exec.result;
		// 2 checks + 1 cross-validation + 1 reporte.
		expect(prompts).toHaveLength(4);
		expect(prompts[0]).toContain("imports circulares");
		expect(prompts[1]).toContain("exports muertos");
		expect(prompts[2]).toContain("Cross-validate these audit findings");
		expect(prompts[3]).toContain("prioritized audit report");
		expect(result.findings).toHaveProperty("c1");
		expect(result.findings).toHaveProperty("c2");
		expect(result.report).toMatch(/^result:Generate a prioritized/);
	}, 20000);

	it("codebase-audit: args inválidos en runtime (script reanudado) no revienta el sandbox", async () => {
		// Escapatoria defensiva: args.checks=[] (p. ej. un run reanudado con args
		// distintos a los validados eager) → parallel vacío, no crash.
		const exec = runPattern(
			generateCodebaseAuditWorkflow,
			{ scope: "src/" },
			mockBridge(),
		);
		const result: any = await exec.result;
		expect(result.findings).toEqual({});
	}, 20000);
});
