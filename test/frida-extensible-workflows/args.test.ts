/**
 * Tolerancia de args string-JSON en la tool workflow (#76).
 *
 * Incidente real (2026-08-18, nutrimetrics + GLM-5.3): el modelo serializó
 * objetos anidados como string JSON — workflow({ name: "aidd-plan", args:
 * '{"idea": "…"}' }) — y el validador del patrón rechazó 4 veces con un
 * mensaje que apuntaba a la capa equivocada («args.idea como string no
 * vacío»), llevando al modelo a bordear el patrón curado generando su
 * propio script por scriptPath. La tool debe decodificar el string.
 */
import { describe, it, expect } from "vitest";
import { normalizeWorkflowArgs } from "../../src/tools/frida-extensible-workflows/args";

describe("frida-extensible-workflows · normalizeWorkflowArgs (#76)", () => {
	it("string JSON de objeto → objeto decodificado (el caso GLM)", () => {
		expect(
			normalizeWorkflowArgs('{"idea": "NutriMetrics", "review": "auto"}'),
		).toEqual({ idea: "NutriMetrics", review: "auto" });
	});

	it("objeto plano → intacto (sin regresión para modelos bien portados)", () => {
		const args = { idea: "x", nested: { a: 1 } };
		expect(normalizeWorkflowArgs(args)).toBe(args);
	});

	it("string que NO es JSON de objeto → intacto (args legítimos escalares)", () => {
		expect(normalizeWorkflowArgs("plain-idea")).toBe("plain-idea");
		expect(normalizeWorkflowArgs('"solo un string"')).toBe('"solo un string"');
		expect(normalizeWorkflowArgs("[1,2]")).toBe("[1,2]");
	});

	it("null/undefined → null (sin args)", () => {
		expect(normalizeWorkflowArgs(null)).toBeNull();
		expect(normalizeWorkflowArgs(undefined)).toBeNull();
	});

	it("string JSON corrupto → intacto (no rompe con payload raro)", () => {
		expect(normalizeWorkflowArgs('{"idea": "sin cerrar')).toBe('{"idea": "sin cerrar');
	});
});
