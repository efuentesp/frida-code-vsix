import { describe, expect, it } from "vitest";
import {
	countTrailingFailedValidates,
	parsePlanPhases,
	sanitizeInput,
} from "../../src/tools/frida-workflow/plan-utils";

describe("plan-utils (Detección de fases y Siguiente paso sugerido)", () => {
	it("sanitiza inputs con comillas escapadas o simples", () => {
		expect(sanitizeInput('".frida/plans/plan.md"')).toBe(".frida/plans/plan.md");
		expect(sanitizeInput('\\".frida/plans/plan.md\\"')).toBe(
			".frida/plans/plan.md",
		);
		expect(sanitizeInput("'.frida/plans/plan.md'")).toBe(".frida/plans/plan.md");
	});

	it("extrae fases declaradas en formato Markdown", () => {
		const planMd = `
# Plan Demo
## F10c.1 — Identidad y compuertas
Contenido...
## F10c.2 — Snapshot canónico y acuse
Contenido...
## F10c.3 — Saga FIEL
Contenido...
`;
		const phases = parsePlanPhases(planMd);
		expect(phases).toHaveLength(3);
		expect(phases[0]).toEqual({
			id: "F10c.1",
			title: "Identidad y compuertas",
			fullName: "F10c.1 — Identidad y compuertas",
		});
		expect(phases[1]?.id).toBe("F10c.2");
		expect(phases[2]?.id).toBe("F10c.3");
	});

	// #154 — heurística del banner «pausa (3 ciclos)»
	describe("countTrailingFailedValidates", () => {
		const fail = { name: "validate", status: "completed", data: { passed: false } };
		const pass = { name: "validate", status: "completed", data: { passed: true } };
		const imp = { name: "implement", status: "completed" };
		const elab = { name: "elaborate", status: "completed" };

		it("cuenta el tramo fallido final tolerando implement intercalado (flujo sdd-ship real)", () => {
			// Traza real del run 2026-08-30_18-48-21-9bd5 truncada a los 3 primeros ciclos
			const stages = [elab, imp, fail, imp, fail, imp, fail];
			expect(countTrailingFailedValidates(stages)).toBe(3);
		});

		it("corta en un validate PASS", () => {
			expect(countTrailingFailedValidates([imp, fail, imp, pass, imp, fail])).toBe(1);
		});

		it("dos fails (< 3) no son pausa", () => {
			expect(countTrailingFailedValidates([imp, fail, imp, fail])).toBe(2);
		});

		it("corta en una etapa ajena al ciclo (p. ej. elaborate)", () => {
			expect(countTrailingFailedValidates([elab, fail])).toBe(1);
		});

		it("run sin validates → 0", () => {
			expect(countTrailingFailedValidates([elab, imp])).toBe(0);
			expect(countTrailingFailedValidates([])).toBe(0);
		});

		it("validate running al final no cuenta", () => {
			expect(
				countTrailingFailedValidates([
				imp,
				fail,
				{ name: "validate", status: "running" },
				]),
			).toBe(0);
		});
	});
});
