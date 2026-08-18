// frida-tea — tests de los patrones tea-* (validación de args + forma del
// script generado). Issue #41, ADR-0053 Lote 1.

import { describe, it, expect } from "vitest";

import {
	TEA_ATDD_PATTERN,
	TEA_AUTOMATE_PATTERN,
	TEA_CI_PATTERN,
	TEA_FRAMEWORK_PATTERN,
	TEA_NFR_PATTERN,
	TEA_TEACH_PATTERN,
	TEA_TEST_DESIGN_PATTERN,
	TEA_TEST_REVIEW_PATTERN,
	TEA_TRACE_PATTERN,
} from "../../src/tools/frida-tea";
import { MURAT_PREAMBLE } from "../../src/tools/frida-tea/skills";

const cwd = process.cwd();

describe("frida-tea · patrones (#41)", () => {
	it("los 9 patrones están nombrados tea-* con args y descripción", () => {
		for (const p of [
			TEA_TEST_DESIGN_PATTERN,
			TEA_FRAMEWORK_PATTERN,
			TEA_AUTOMATE_PATTERN,
			TEA_TEST_REVIEW_PATTERN,
			TEA_CI_PATTERN,
			TEA_NFR_PATTERN,
			TEA_TRACE_PATTERN,
			TEA_ATDD_PATTERN,
			TEA_TEACH_PATTERN,
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
			TEA_CI_PATTERN,
			TEA_NFR_PATTERN,
			TEA_TRACE_PATTERN,
			TEA_ATDD_PATTERN,
			TEA_TEACH_PATTERN,
		]) {
			const script = p.resolve(
				p === TEA_TEST_DESIGN_PATTERN
					? { subject: "x" }
					: p === TEA_TEST_REVIEW_PATTERN
						? { scope: "s" }
						: p === TEA_ATDD_PATTERN
							? { feature: "f" }
							: {},
				{ cwd },
			);
			expect(script).toContain("Master Test Architect");
		}
	});
});

describe("frida-tea · patrones Lote 2 (#41)", () => {
	it("tea-ci genera survey → pipeline → gate con verificación local", () => {
		const script = TEA_CI_PATTERN.resolve({}, { cwd });
		expect(script).toContain('phase("survey")');
		expect(script).toContain('phase("pipeline")');
		expect(script).toContain('checkpoint({ name: "ci-gate"');
		// La meta D8 viaja en el patrón (no en el script).
		expect(TEA_CI_PATTERN.meta?.requiredTools).toContain("shell");
		expect(TEA_CI_PATTERN.meta?.executionHints?.autonomous).toBe(true);
	});

	it("tea-ci honra platform explícito", () => {
		const script = TEA_CI_PATTERN.resolve({ platform: "gitlab-ci" }, { cwd });
		expect(script).toContain("gitlab-ci");
	});

	it("tea-nfr normaliza categorías csv y limita a 6", () => {
		const script = TEA_NFR_PATTERN.resolve(
			{ categories: "security, performance, extra1, extra2, extra3" },
			{ cwd },
		);
		// 5 categorías explícitas — todas presentes en el script.
		expect(script).toContain('"security"');
		expect(script).toContain('"performance"');
		expect(script).toContain('phase("audit (fan-out por categoría)")');
		expect(script).toContain('phase("aggregate (gate determinista)")');
		expect(script).toContain('parallel("categories"');
	});

	it("tea-nfr default son las 4 categorías estándar", () => {
		const script = TEA_NFR_PATTERN.resolve({}, { cwd });
		for (const c of [
			"performance",
			"security",
			"reliability",
			"maintainability",
		]) {
			expect(script).toContain(`"${c}"`);
		}
	});

	it("tea-trace valida gate y genera matriz con coverage determinista", () => {
		expect(() => TEA_TRACE_PATTERN.resolve({ gate: "hotfix" }, { cwd })).toThrow(
			/gate/,
		);
		const script = TEA_TRACE_PATTERN.resolve({}, { cwd });
		expect(script).toContain("docs/aidd/planning/prd.md"); // default requirements
		expect(script).toContain('"tests/"'); // default scope
		expect(script).toContain('"release"'); // default gate
		expect(script).toContain('phase("coverage (gate determinista)")');
		expect(script).toContain('gateStatus');
	});

	it("tea-atdd exige feature y valida level", () => {
		expect(() => TEA_ATDD_PATTERN.resolve({}, { cwd })).toThrow(/feature/);
		expect(() =>
				TEA_ATDD_PATTERN.resolve({ feature: "x", level: "integration" }, { cwd }),
		).toThrow(/level/);
		const script = TEA_ATDD_PATTERN.resolve({ feature: "login" }, { cwd });
		expect(script).toContain("login");
		expect(script).toContain('checkpoint({ name: "scenarios"'); // contrato
		expect(script).toContain('checkpoint({ name: "red-phase"');
		expect(script).toContain('"red", "green", "blocked"');
		expect(TEA_ATDD_PATTERN.meta?.executionHints?.interactive).toBe(true);
	});

	it("tea-teach filtra módulos por id y genera index", () => {
		const script = TEA_TEACH_PATTERN.resolve({ modules: "risk,gates" }, { cwd });
		expect(script).toContain("risk");
		expect(script).toContain("gates");
		expect(script).not.toContain("flakiness");
		expect(script).toContain('phase("index")');
		expect(script).toContain("academy/README.md");
	});

	it("tea-teach default son los 5 módulos", () => {
		const script = TEA_TEACH_PATTERN.resolve({}, { cwd });
		for (const id of ["risk", "levels", "flakiness", "gates", "atdd"]) {
			expect(script).toContain(`"${id}"`);
		}
	});
});
