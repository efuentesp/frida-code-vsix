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
	TEA_AUTOMATE_PATTERN,
	TEA_TEST_DESIGN_PATTERN,
	TEA_TEST_REVIEW_PATTERN,
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
		// Setup de framework.
		if (prompt.includes("Survey decision (honor it)")) {
			return {
				configFiles: ["vitest.config.ts"],
				examplePath: "tests/example.test.ts",
				exampleStatus: "green",
				notes: "ejemplo corriendo",
			};
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
});

/** waitUntil mínimo sin importar el helper del suite de workflows. */
async function waitUntil(cond: () => boolean, ms = 10000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error("timeout esperando condición");
		await new Promise((r) => setTimeout(r, 20));
	}
}
