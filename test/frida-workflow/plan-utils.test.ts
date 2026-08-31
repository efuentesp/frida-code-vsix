import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	appendPhaseProgress,
	bootstrapPlanProgressFromRuns,
	countTrailingFailedValidates,
	normalizePhaseId,
	parsePlanPhases,
	progressFilePath,
	readCompletedPhases,
	resolveNextStep,
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
		const fail = {
			name: "validate",
			status: "completed",
			data: { passed: false },
		};
		const pass = {
			name: "validate",
			status: "completed",
			data: { passed: true },
		};
		const imp = { name: "implement", status: "completed" };
		const elab = { name: "elaborate", status: "completed" };

		it("cuenta el tramo fallido final tolerando implement intercalado (flujo sdd-ship real)", () => {
			// Traza real del run 2026-08-30_18-48-21-9bd5 truncada a los 3 primeros ciclos
			const stages = [elab, imp, fail, imp, fail, imp, fail];
			expect(countTrailingFailedValidates(stages)).toBe(3);
		});

		it("corta en un validate PASS", () => {
			expect(countTrailingFailedValidates([imp, fail, imp, pass, imp, fail])).toBe(
				1,
			);
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

	// #157 — el path del plan NUNCA debe confundirse con la fase
	describe("resolveNextStep — fase del input vs ruido del path", () => {
		const plan = [
			"# Plan",
			"## F10c.1 — Identidad y compuertas",
			"## F10c.2 — Snapshot y acuse",
			"## F10c.3 — Saga FIEL",
			"## F10c.4 — Estrategias postfirma",
			"## F10c.5 — Wizard Livewire",
		].join("\n");
		let tmp: string;
		beforeAll(() => {
			tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-utils-157-"));
			fs.mkdirSync(path.join(tmp, ".frida", "artifacts", "plans"), {
				recursive: true,
			});
			// Nombre con trampa: ".frida" y "f10c-wizard" matchean F[\w.]+ si el
			// regex escanea el path (caso real del plan de SELE-DEV).
			fs.writeFileSync(
				path.join(
					tmp,
					".frida",
					"artifacts",
					"plans",
					"2026-08-30_pdle2-f10c-wizard-firma-acuse.md",
				),
				plan,
			);
		});

		it("input real con comillas escapadas y 'Phase F10c.2' → siguiente es F10c.3 (no F10c.2)", () => {
			const input =
				'\\".frida/artifacts/plans/2026-08-30_pdle2-f10c-wizard-firma-acuse.md Phase F10c.2\\"';
			const r = resolveNextStep(input, tmp);
			expect(r).not.toBeNull();
			expect(r!.currentPhase?.id).toBe("F10c.2");
			expect(r!.nextPhase?.id).toBe("F10c.3"); // antes: F10c.2 (match "frida" del path)
			expect(r!.shipCommand).toContain("Phase F10c.3");
		});

		it("fase suelta tras el path sin 'Phase' también resuelve", () => {
			const input =
				'".frida/artifacts/plans/2026-08-30_pdle2-f10c-wizard-firma-acuse.md F10c.4"';
			const r = resolveNextStep(input, tmp);
			expect(r!.currentPhase?.id).toBe("F10c.4");
			expect(r!.nextPhase?.id).toBe("F10c.5");
		});

		it("última fase → isPlanComplete sin shipCommand", () => {
			const input =
				'".frida/artifacts/plans/2026-08-30_pdle2-f10c-wizard-firma-acuse.md Phase F10c.5"';
			const r = resolveNextStep(input, tmp);
			expect(r!.isPlanComplete).toBe(true);
			expect(r!.shipCommand).toBeUndefined();
		});
	});
});

// ── #158 — progreso por plan + primer hueco real ─────────────────────────────
describe("plan-utils — progreso de plan (#158)", () => {
	const PLAN = ".frida/artifacts/plans/plan-demo.md";
	const PLAN5 = [
		"# Plan",
		"## F10c.1 — Identidad",
		"## F10c.2 — Snapshot",
		"## F10c.3 — Saga",
		"## F10c.4 — Estrategias",
		"## F10c.5 — Wizard",
	].join("\n");
	let tmp: string;
	beforeAll(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-utils-158-"));
		fs.mkdirSync(path.join(tmp, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp, PLAN), PLAN5);
	});

	it("normalizePhaseId: F10c.3 ≡ f10c-3 ≡ f10c_3 (mayúsculas/espacios fuera)", () => {
		expect(normalizePhaseId("F10c.3")).toBe(normalizePhaseId("f10c-3"));
		expect(normalizePhaseId("F10c.3")).toBe(normalizePhaseId(" f10c_3 "));
		expect(normalizePhaseId("F10c.3")).not.toBe(normalizePhaseId("F10c.4"));
	});

	it("appendPhaseProgress + readCompletedPhases: roundtrip, dedupe e idempotencia", () => {
		appendPhaseProgress(tmp, PLAN, "F10c.2", "run-a", "2026-08-30T10:00:00Z");
		appendPhaseProgress(tmp, PLAN, "F10c.2", "run-a2", "2026-08-30T11:00:00Z"); // dup → no-op
		appendPhaseProgress(tmp, PLAN, "f10c-3", "run-b", "2026-08-30T12:00:00Z"); // variante normalizada
		expect(fs.existsSync(progressFilePath(tmp, PLAN))).toBe(true);
		const done = readCompletedPhases(tmp, PLAN);
		expect(done).toHaveLength(2);
		expect(done).toContain(normalizePhaseId("F10c.2"));
		expect(done).toContain(normalizePhaseId("F10c.3"));
	});

	it("bootstrapPlanProgressFromRuns: sólo runs con commit completado registran", () => {
		const runsDir = path.join(tmp, "runs");
		fs.mkdirSync(runsDir, { recursive: true });
		const runJsonl = (name: string, phase: string, withCommit: boolean) => {
			const rows = [
				{
					type: "workflow",
					runId: name,
					workflow: "sdd-ship",
					input: `"${PLAN} Phase ${phase}"`,
					ts: "2026-08-30T10:00:00Z",
				},
				{ type: "stage", runId: name, stage: "implement", status: "completed" },
				{ type: "stage", runId: name, stage: "validate", status: "completed" },
			];
			if (withCommit) {
				rows.push({ type: "stage", runId: name, stage: "commit", status: "completed" });
			}
			fs.writeFileSync(
				path.join(runsDir, `${name}.jsonl`),
				rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
			);
		};
		runJsonl("2026-08-30_10-00-00-aaa", "F10c.4", true); // cuenta
		runJsonl("2026-08-30_10-30-00-bbb", "F10c.5", false); // sin commit: NO cuenta

		const registered = bootstrapPlanProgressFromRuns(runsDir, tmp);
		expect(registered).toBe(1);
		const done = readCompletedPhases(tmp, PLAN);
		expect(done).toContain(normalizePhaseId("F10c.4"));
		expect(done).not.toContain(normalizePhaseId("F10c.5"));
	});

	it("resolveNextStep sugiere el PRIMER HUECO real aunque el input sea una fase vieja", () => {
		// Estado real de SELE-DEV: F10c.1 también commiteada (los tests previos
		// registraron F10c.2/F10c.3 por roundtrip y F10c.4 por bootstrap).
		appendPhaseProgress(tmp, PLAN, "F10c.1", "run-0", "2026-08-30T09:00:00Z");
		// Con F10c.1–4 registradas, retomar F10c.2 debe sugerir F10c.5 —
		// no F10c.3 (relativa al run) ni F10c.1 (nunca registrada).
		const r = resolveNextStep(`"${PLAN} Phase F10c.2"`, tmp);
		expect(r!.currentPhase?.id).toBe("F10c.2"); // encabezado del run
		expect(r!.nextPhase?.id).toBe("F10c.5"); // primer hueco real
		expect(r!.shipCommand).toContain("Phase F10c.5");
	});

	it("plan 100% registrado → isPlanComplete", () => {
		appendPhaseProgress(tmp, PLAN, "F10c.5", "run-c", "2026-08-30T13:00:00Z");
		const r = resolveNextStep(`"${PLAN} Phase F10c.5"`, tmp);
		expect(r!.isPlanComplete).toBe(true);
		expect(r!.nextPhase).toBeUndefined();
	});

	it("sin archivo de progreso: degrada a la fase siguiente del input (comportamiento #153/#157)", () => {
		const r = resolveNextStep(`"${PLAN} Phase F10c.2"`, tmp);
		expect(r!.isPlanComplete).toBe(true); // tmp ya tiene TODO registrado en este punto
		// Caso limpio en un cwd sin progreso:
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "plan-utils-158b-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), { recursive: true });
		fs.writeFileSync(path.join(tmp2, PLAN), PLAN5);
		const r2 = resolveNextStep(`"${PLAN} Phase F10c.2"`, tmp2);
		expect(r2!.nextPhase?.id).toBe("F10c.3");
	});
});
