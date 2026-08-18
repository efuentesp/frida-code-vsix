// frida-tea — tests de los patrones tea-* (validación de args + forma del
// script generado). Issue #41, ADR-0053 Lote 1.

import { describe, it, expect } from "vitest";

import {
	TEA_AUTOMATE_PATTERN,
	TEA_FRAMEWORK_PATTERN,
	TEA_TEST_DESIGN_PATTERN,
	TEA_TEST_REVIEW_PATTERN,
} from "../../src/tools/frida-tea";
import { MURAT_PREAMBLE } from "../../src/tools/frida-tea/skills";

const cwd = process.cwd();

describe("frida-tea · patrones (#41)", () => {
	it("los 4 patrones están nombrados tea-* con args y descripción", () => {
		for (const p of [
			TEA_TEST_DESIGN_PATTERN,
			TEA_FRAMEWORK_PATTERN,
			TEA_AUTOMATE_PATTERN,
			TEA_TEST_REVIEW_PATTERN,
		]) {
			expect(p.name.startsWith("tea-")).toBe(true);
			expect(p.args.length).toBeGreaterThan(10);
			expect(p.description.length).toBeGreaterThan(40);
		}
	});

	it("tea-test-design exige subject no vacío", () => {
		expect(() => TEA_TEST_DESIGN_PATTERN.resolve({}, { cwd })).toThrow(
			/subject/,
		);
		expect(() => TEA_TEST_DESIGN_PATTERN.resolve({ subject: "  " }, { cwd })).toThrow(
			/subject/,
		);
	});

	it("tea-test-design interpola subject y prompts resueltos (con MURAT)", () => {
		const script = TEA_TEST_DESIGN_PATTERN.resolve(
			{ subject: "epic de checkout" },
			{ cwd },
		);
		expect(script).toContain("epic de checkout");
		expect(script).toContain("MURAT");
		expect(script).toContain('phase("plan")');
		expect(script).toContain('phase("extract targets")');
		expect(script).toContain('phase("gate")');
		expect(script).toContain('checkpoint({ name: "plan-gate"');
	});

	it("review inválido se rechaza en los 4 patrones", () => {
		expect(() =>
			TEA_TEST_DESIGN_PATTERN.resolve(
				{ subject: "x", review: "sometimes" },
				{ cwd },
			),
		).toThrow(/review/);
		expect(() =>
			TEA_FRAMEWORK_PATTERN.resolve({ review: 1 }, { cwd }),
		).toThrow(/review/);
		expect(() =>
			TEA_AUTOMATE_PATTERN.resolve({ review: null }, { cwd }),
		).toThrow(/review/);
		expect(() =>
			TEA_TEST_REVIEW_PATTERN.resolve({ scope: "s", review: "x" }, { cwd }),
		).toThrow(/review/);
	});

	it("tea-framework acepta defaults y normaliza", () => {
		const script = TEA_FRAMEWORK_PATTERN.resolve({}, { cwd });
		expect(script).toContain('"auto"');
		expect(script).toContain('phase("survey")');
		expect(script).toContain('phase("setup")');
		// typescript default true
		expect(script).toMatch(/\(args && args\.typescript\) \|\| true/);
	});

	it("tea-framework rechaza typescript no-boolean", () => {
		expect(() =>
			TEA_FRAMEWORK_PATTERN.resolve({ typescript: "sí" }, { cwd }),
		).toThrow(/typescript/);
	});

	it("tea-automate valida maxTargets 1-8 y normaliza el default del plan", () => {
		expect(() =>
			TEA_AUTOMATE_PATTERN.resolve({ maxTargets: 0 }, { cwd }),
		).toThrow(/maxTargets/);
		expect(() =>
			TEA_AUTOMATE_PATTERN.resolve({ maxTargets: 9 }, { cwd }),
		).toThrow(/maxTargets/);
		expect(() =>
			TEA_AUTOMATE_PATTERN.resolve({ maxTargets: 2.5 }, { cwd }),
		).toThrow(/maxTargets/);
		const script = TEA_AUTOMATE_PATTERN.resolve({}, { cwd });
		expect(script).toContain("docs/tea/test-design.md");
		expect(script).toContain("parallel(\"targets\"");
		expect(script).toContain('phase("automate (fan-out por target)")');
	});

	it("tea-test-review exige scope no vacío", () => {
		expect(() => TEA_TEST_REVIEW_PATTERN.resolve({}, { cwd })).toThrow(
			/scope/,
		);
		const script = TEA_TEST_REVIEW_PATTERN.resolve(
			{ scope: "test/" },
			{ cwd },
		);
		expect(script).toContain("test/");
		expect(script).toContain("parallel(\"files\"");
		expect(script).toContain("unscorable");
	});

	it("el preamble Murat viaja en todos los scripts", () => {
		expect(MURAT_PREAMBLE).toContain("Murat");
		for (const p of [
			TEA_TEST_DESIGN_PATTERN,
			TEA_FRAMEWORK_PATTERN,
			TEA_AUTOMATE_PATTERN,
			TEA_TEST_REVIEW_PATTERN,
		]) {
			const script = p.resolve(
				p === TEA_TEST_DESIGN_PATTERN
					? { subject: "x" }
					: p === TEA_TEST_REVIEW_PATTERN
						? { scope: "s" }
						: {},
				{ cwd },
			);
			expect(script).toContain("Master Test Architect");
		}
	});
});
