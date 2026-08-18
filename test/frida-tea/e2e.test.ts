// frida-tea — integración end-to-end de los 4 workflows sobre el motor real
// (runWorkflowInStore + RunStore). Issue #41, ADR-0053 Lote 1.
//
// El spawner es un mock con matching por anclas ÚNICAS (encabezados verbatim
// de cada skill), ordenadas de lo más específico a lo más general — mismo
// patrón que los e2e de frida-aidd (#38).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
	runWorkflowInStore,
} from "../../src/tools/frida-extensible-workflows/frida-host";
import {
	resolveCheckpoint,
} from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import {
	TEA_ATDD_PATTERN,
	TEA_AUTOMATE_PATTERN,
	TEA_CI_PATTERN,
	TEA_NFR_PATTERN,
	TEA_TEACH_PATTERN,
	TEA_TEST_DESIGN_PATTERN,
	TEA_TEST_REVIEW_PATTERN,
	TEA_TRACE_PATTERN,
} from "../../src/tools/frida-tea";

const REAL_HOME = process.env.HOME;

let home: string;
let cwd: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "tea-e2e-home-"));
	cwd = mkdtempSync(join(tmpdir(), "tea-e2e-cwd-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

/** Mock del spawner con anclas por encabezado de skill (orden importa). Los
 * extractores de test-design y automate producen texto idéntico en runtime —
 * por eso la respuesta del extractor se inyecta por test (extract). */
const makeSpawn = (seen: string[], extract?: unknown) =>
	(async (prompt: string) => {
		seen.push(prompt);
		// Extractor JSON (outputSchema → objeto parseado); respuesta inyectada.
		if (prompt.includes("return ONLY a JSON object")) {
			return (
				extract ?? {
					targets: [
						{ id: "T1", name: "Checkout", risk: "P0", level: "e2e" },
						{ id: "T2", name: "Filtros", risk: "P2", level: "unit" },
					],
				}
			);
		}
		// Survey de framework.
		if (prompt.includes("choose the test framework")) {
			return {
				framework: "vitest",
				evidence: "package.json tiene vitest",
				rationale: "ya está en el stack",
			};
		}
		// Setup de framework (encabezado del skill framework, específico antes del genérico).
		if (prompt.includes("Test Framework Setup")) {
			return {
				configFiles: ["vitest.config.ts"],
				examplePath: "tests/example.test.ts",
				exampleStatus: "green",
				notes: "ejemplo corriendo",
			};
		}
		// Survey de CI.
		if (prompt.includes("Survey this repository to configure CI")) {
			return {
				platform: "github-actions",
				testCommand: "npm test",
				framework: "vitest",
				packageManager: "npm",
				nodeVersion: "22",
			};
		}
		// Pipeline de CI (encabezado del skill ci).
		if (prompt.includes("CI Pipeline Setup")) {
			return {
				pipelineFile: ".github/workflows/test.yml",
				jobs: ["test"],
				localVerification: "green",
				notes: "npm test pasa localmente",
			};
		}
		// Auditor NFR por categoría.
		if (prompt.includes("## Category to audit")) {
			const cat = prompt.match(/## Category to audit\n(\S+)/)?.[1] ?? "?";
			return {
				category: cat,
				status: cat === "security" ? "FAIL" : "PASS",
				evidence: ["tests/perf.test.ts"],
				gaps: cat === "security" ? [{ severity: "HIGH", gap: "sin escaneo", nextStep: "añadir sast" }] : [],
				summary: cat + " auditado",
			};
		}
		// Extractor de requisitos de trace.
		if (prompt.includes("Extract the verifiable requirements")) {
			return {
				source: "prd",
				requirements: [
					{ id: "R1", text: "Exportar CSV", priority: "P0" },
					{ id: "R2", text: "Filtro por fecha", priority: "P0" },
				],
			};
		}
		// Mapper de trace.
		if (prompt.includes("Traceability Mapping")) {
			return {
				mappings: [
					{ id: "R1", tests: ["tests/export.test.ts"], level: "unit", note: "cubre" },
					{ id: "R2", tests: [], level: "none", note: "sin cobertura" },
				],
			};
		}
		// ATDD — escenarios (role A). Ancla: bloque runtime "## Your role"
		// (NO el texto del skill, que describe ambos roles y colisionaría).
		if (prompt.includes("## Your role\nA — scenarios")) {
			return "escenarios escritos en docs/tea/atdd-scenarios.md";
		}
		// ATDD — fase roja (role B), mismo criterio de ancla.
		if (prompt.includes("## Your role\nB — red phase")) {
			return {
				level: "component",
				files: ["tests/login.atdd.test.ts"],
				testStatus: "red",
				checklistPath: "docs/tea/atdd-checklist.md",
				scenariosCovered: 4,
				notes: "fallando por aserción (correcto)",
			};
		}
		// Lección de teach.
		if (prompt.includes("## Module to write")) {
			const id = prompt.match(/## Module to write\n\d+\. (\S+)/)?.[1] ?? "?";
			return `lección ${id} escrita`;
		}
		// Índice de teach.
		if (prompt.includes("Write the academy index")) {
			return "índice escrito";
		}
		// Reporte de nfr.
		if (prompt.includes("NFR evidence assessment")) {
			return "nfr-assessment.md escrito";
		}
		// Reporte de trace.
		if (prompt.includes("traceability matrix to")) {
			return "traceability-matrix.md escrito";
		}
		// Automate por target.
		if (prompt.includes("## Target to automate")) {
			const id = prompt.match(/## Target to automate\n(\S+):/)?.[1] ?? "?";
			return {
				target: id,
				file: `tests/${id}.test.ts`,
				status: id === "T3" ? "blocked" : "green",
				notes: id === "T3" ? "falta service" : "verde",
			};
		}
		// Reviewer por archivo.
		if (prompt.includes("## File under review")) {
			const file = prompt.match(/## File under review\n(\S+)/)?.[1] ?? "?";
			if (file === "tests/b.test.ts") {
				return { file, unscorable: true, findings: [] };
			}
			return {
				file,
				score: 84,
				findings: [
					{
						criterion: "hard-wait",
						severity: "MEDIUM",
						evidence: "L12 setTimeout",
						fix: "esperar señal",
					},
				],
			};
		}
		// Discover de test-review.
		if (prompt.includes("convention BASELINE")) {
			return {
				files: ["tests/a.test.ts", "tests/b.test.ts"],
				baseline: "naming: established (4/5)",
			};
		}
		// Gate (test-design / framework / automate).
		if (prompt.includes("Release Gate Audit")) {
			return {
				decision: "CONCERNS",
				findings: [
					{
						severity: "MEDIUM",
						evidence: "exclusión sin mitigación",
						fix: "agregar mitigación",
					},
				],
				notes: "plan sólido en general",
			};
		}
		// Plan de test-design.
		if (prompt.includes("Test Design & Risk Assessment")) {
			return "plan escrito en docs/tea/test-design.md";
		}
		// Reporte de test-review.
		if (prompt.includes("test-review report")) {
			return "reporte escrito";
		}
		return `echo: ${prompt.slice(0, 40)}`;
	}) as unknown as SpawnAgentFn;

describe("frida-tea · workflows end-to-end sobre el motor (#41)", () => {
	/** Targets del extractor para los tests de tea-automate (P0/P0/P1/P2). */
	const extract4 = {
		targets: [
			{ id: "T1", name: "Login feliz", risk: "P1", level: "component" },
			{ id: "T2", name: "Doble cargo", risk: "P0", level: "api" },
			{ id: "T3", name: "Tooltips", risk: "P2", level: "unit" },
			{ id: "T4", name: "Idempotencia", risk: "P0", level: "unit" },
		],
	};

	it("tea-test-design corre plan → extract → gate → checkpoint", async () => {
		const script = TEA_TEST_DESIGN_PATTERN.resolve(
			{ subject: "epic de checkout", review: "manual" },
			{ cwd },
		);
		const checkpoints: Array<{ name: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "tea-test-design",
			script,
			args: { subject: "epic de checkout", review: "manual" },
			cwd,
			sessionId: "sess-tea-1",
			spawnAgent: makeSpawn([]),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		await waitUntil(() => checkpoints.length >= 1);
		resolveCheckpoint(runId, "plan-gate", true);

		const { result } = await promise;
		const r = result as {
			targets: Array<{ id: string }>;
			gate: { decision: string };
			planSummary: string;
		};
		expect(r.planSummary).toContain("plan escrito");
		expect(r.targets.map((t) => t.id)).toEqual(["T1", "T2"]);
		expect(r.gate.decision).toBe("CONCERNS");
	}, 30000);

	it("tea-automate ordena por riesgo, hace fan-out y cuenta verdes", async () => {
		const script = TEA_AUTOMATE_PATTERN.resolve({ review: "auto" }, { cwd });

		const { result } = await runWorkflowInStore({
			name: "tea-automate",
			script,
			args: { review: "auto" },
			cwd,
			sessionId: "sess-tea-2",
			spawnAgent: makeSpawn([], extract4),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = result as {
			targets: string[];
			results: Record<string, { status: string }>;
			gate: { decision: string };
		};
		// Orden determinista por riesgo: P0 (T2, T4) antes que P1 (T1) y P2 (T3).
		expect(r.targets).toEqual(["T2", "T4", "T1", "T3"]);
		expect(Object.keys(r.results)).toEqual(["T2", "T4", "T1", "T3"]);
		// 3 de 4 en verde (T3 bloqueado).
		expect(Object.values(r.results).filter((x) => x.status === "green")).toHaveLength(3);
		expect(r.gate.decision).toBe("CONCERNS");
	}, 30000);

	it("tea-automate respeta el filtro de targets y maxTargets", async () => {
		const script = TEA_AUTOMATE_PATTERN.resolve(
			{ targets: "T1,T3", maxTargets: 1, review: "auto" },
			{ cwd },
		);

		const { result } = await runWorkflowInStore({
			name: "tea-automate",
			script,
			args: { targets: "T1,T3", maxTargets: 1, review: "auto" },
			cwd,
			sessionId: "sess-tea-3",
			spawnAgent: makeSpawn([], extract4),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = result as { targets: string[] };
		// Filtro deja T1 (P1) y T3 (P2); el cap 1 se queda con T1.
		expect(r.targets).toEqual(["T1"]);
	}, 30000);

	it("tea-test-review agrega score, unscorable y severidades; checkpoint al final", async () => {
		const script = TEA_TEST_REVIEW_PATTERN.resolve(
			{ scope: "tests/", review: "manual" },
			{ cwd },
		);
		const checkpoints: Array<{ name: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "tea-test-review",
			script,
			args: { scope: "tests/", review: "manual" },
			cwd,
			sessionId: "sess-tea-4",
			spawnAgent: makeSpawn([]),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		await waitUntil(() => checkpoints.length >= 1);
		resolveCheckpoint(runId, "review-report", true);

		const { result } = await promise;
		const r = result as {
			score: number;
			unscorable: string[];
			bySeverity: Record<string, number>;
			reportSummary: string;
		};
		// 1 archivo puntuado (84); b es unscorable → promedio sobre puntuados.
		expect(r.score).toBe(84);
		expect(r.unscorable).toEqual(["tests/b.test.ts"]);
		expect(r.bySeverity).toEqual({ MEDIUM: 1 });
		expect(r.reportSummary).toBe("reporte escrito");
	}, 30000);

	it("tea-ci corre survey → pipeline → gate → checkpoint", async () => {
		const script = TEA_CI_PATTERN.resolve({ review: "manual" }, { cwd });
		const checkpoints: Array<{ name: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "tea-ci",
			script,
			args: { review: "manual" },
			cwd,
			sessionId: "sess-tea-5",
			spawnAgent: makeSpawn([]),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		await waitUntil(() => checkpoints.length >= 1);
		resolveCheckpoint(runId, "ci-gate", true);

		const { result } = await promise;
		const r = result as {
			platform: string;
			setup: { pipelineFile: string; localVerification: string };
			gate: { decision: string };
		};
		expect(r.platform).toBe("github-actions");
		expect(r.setup.pipelineFile).toBe(".github/workflows/test.yml");
		expect(r.setup.localVerification).toBe("green");
		expect(r.gate.decision).toBe("CONCERNS");
	}, 30000);

	it("tea-nfr fan-out por categoría con gate determinista (FAIL gana)", async () => {
		const script = TEA_NFR_PATTERN.resolve(
			{ categories: "performance,security", review: "auto" },
			{ cwd },
		);

		const { result } = await runWorkflowInStore({
			name: "tea-nfr",
			script,
			args: { categories: "performance,security", review: "auto" },
			cwd,
			sessionId: "sess-tea-6",
			spawnAgent: makeSpawn([]),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = result as {
			overall: string;
			byStatus: Record<string, number>;
			audits: Array<{ category: string; status: string }>;
		};
		// performance=PASS, security=FAIL → gate determinista FAIL.
		expect(r.byStatus).toEqual({ PASS: 1, FAIL: 1 });
		expect(r.overall).toBe("FAIL");
		expect(r.audits.map((a) => a.status)).toEqual(["PASS", "FAIL"]);
	}, 30000);

	it("tea-trace mapea requisitos y gatilla FAIL por P0 sin cobertura", async () => {
		const script = TEA_TRACE_PATTERN.resolve({ review: "auto" }, { cwd });

		const { result } = await runWorkflowInStore({
			name: "tea-trace",
			script,
			args: { review: "auto" },
			cwd,
			sessionId: "sess-tea-7",
			spawnAgent: makeSpawn([]),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = result as {
			coverage: { covered: number; total: number; pct: number };
			gateStatus: string;
			uncovered: string[];
		};
		// R1 cubierto, R2 (P0) sin cobertura → 50% y FAIL determinista.
		expect(r.coverage).toEqual({ covered: 1, total: 2, pct: 50 });
		expect(r.gateStatus).toBe("FAIL");
		expect(r.uncovered).toEqual(["R2"]);
	}, 30000);

	it("tea-atdd: checkpoint de escenarios (contrato) → fase roja", async () => {
		const script = TEA_ATDD_PATTERN.resolve(
			{ feature: "login con 2FA", review: "manual" },
			{ cwd },
		);
		const checkpoints: Array<{ name: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "tea-atdd",
			script,
			args: { feature: "login con 2FA", review: "manual" },
			cwd,
			sessionId: "sess-tea-8",
			spawnAgent: makeSpawn([]),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		// El contrato (escenarios) se aprueba antes de la fase roja.
		await waitUntil(() => checkpoints.length >= 1);
		expect(checkpoints[0].name).toBe("scenarios");
		resolveCheckpoint(runId, "scenarios", true);
		await waitUntil(() => checkpoints.length >= 2);
		resolveCheckpoint(runId, "red-phase", true);

		const { result } = await promise;
		const r = result as {
			scenarios: string;
			red: { testStatus: string; level: string; files: string[] };
		};
		expect(r.scenarios).toBe("docs/tea/atdd-scenarios.md");
		expect(r.red.testStatus).toBe("red");
		expect(r.red.level).toBe("component");
		expect(r.red.files).toEqual(["tests/login.atdd.test.ts"]);
	}, 30000);

	it("tea-teach escribe lecciones filtradas + índice", async () => {
		const script = TEA_TEACH_PATTERN.resolve(
			{ modules: "risk,gates", review: "auto" },
			{ cwd },
		);

		const { result } = await runWorkflowInStore({
			name: "tea-teach",
			script,
			args: { modules: "risk,gates", review: "auto" },
			cwd,
			sessionId: "sess-tea-9",
			spawnAgent: makeSpawn([]),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = result as {
			modules: string[];
			lessons: Record<string, string>;
			indexSummary: string;
		};
		expect(r.modules).toEqual(["risk", "gates"]);
		expect(r.lessons.risk).toContain("lección risk");
		expect(r.lessons.gates).toContain("lección gates");
		expect(r.indexSummary).toBe("índice escrito");
	}, 30000);
});

/** waitUntil mínimo sin importar el helper del suite de workflows. */
async function waitUntil(cond: () => boolean, ms = 10000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error("timeout esperando condición");
		await new Promise((r) => setTimeout(r, 20));
	}
}
