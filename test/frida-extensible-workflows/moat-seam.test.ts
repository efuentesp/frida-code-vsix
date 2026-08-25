// frida-extensible-workflows — tests del seam del moat (M1 #134, design D4).
//
// Slice 5 del design 2026-08-24_20-01-44: patternMeta persistido en
// snapshot.metadata por launch, recuperado por loadPatternMeta, heredado por
// la run HIJA de retryWorkflow (la cadena retry-de-retry conserva el moat) y
// backwards-compatible con runs viejas sin el campo (→ sin moat → lista base
// de factories). La composición flag→factory y el registro real contra un pi
// falso viven en moat-factories.test.ts (Slice 4); el wiring launch→spawner
// real se verifica con el smoke manual (criterio de cierre del issue #134).
//
// Molde: test/frida-extensible-workflows/retry-resume.test.ts (spawn mock +
// RunStore para inspeccionar el snapshot persistido).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	runWorkflowInStore,
	retryWorkflow,
	loadPatternMeta,
} from "../../src/tools/frida-extensible-workflows/frida-host";
import { RunStore } from "../../src/tools/frida-extensible-workflows/core/persistence";
import type { LaunchSnapshot } from "../../src/tools/frida-extensible-workflows/core/types";
import {
	createWorkflowChildFactories,
	type SpawnAgentFn,
} from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { createWorkflowChildFactoriesWithMoat } from "../../src/tools/frida-extensible-workflows/moat-factories";

const CWD = "/tmp/proj-moat-seam";
const SESSION = "sess-moat-seam";

/** Meta del patrón understand-app (design D3/D13): lo que launch shallow-copia
 *  desde builtin.meta hacia runWorkflowInStore.patternMeta. */
const MOAT_META = {
	requiredTools: ["shell"],
	executionHints: { autonomous: true },
	moat: { lens: true, codebaseIndex: true },
};

let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "frida-wf-moat-seam-"));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

const spawn: SpawnAgentFn = async (p) => `R:${p}`;
const OK_SCRIPT = "return await agent('x');";

/** Helper: encuentra el único runId persistido (molde retry-resume.test.ts). */
async function findSingleRunId(): Promise<string | undefined> {
	const { listPersistedSessionIds, runsDirectory } = await import(
		"../../src/tools/frida-extensible-workflows/core/persistence"
	);
	const sessions = await listPersistedSessionIds(CWD, home);
	if (sessions.length !== 1) return undefined;
	const { readdir } = await import("node:fs/promises");
	const dir = runsDirectory(CWD, sessions[0]!, home);
	const entries = await readdir(dir, { withFileTypes: true });
	const runDir = entries.find((e) => e.isDirectory() && !e.name.startsWith("."));
	return runDir?.name;
}

describe("frida-extensible-workflows · patternMeta en el snapshot (D4)", () => {
	it("launch con patternMeta lo persiste en snapshot.metadata", async () => {
		const { runId } = await runWorkflowInStore({
			name: "understand-app",
			script: OK_SCRIPT,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
			patternMeta: MOAT_META,
		});
		const { snapshot } = await new RunStore(CWD, SESSION, runId, home).load();
		expect(snapshot.metadata.patternMeta).toEqual(MOAT_META);
	}, 15000);

	it("launch sin patternMeta no inventa el campo (runs sin moat)", async () => {
		const { runId } = await runWorkflowInStore({
			name: "wf-clasico",
			script: OK_SCRIPT,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		const { snapshot } = await new RunStore(CWD, SESSION, runId, home).load();
		expect(snapshot.metadata.patternMeta).toBeUndefined();
		expect(loadPatternMeta(snapshot)).toBeUndefined();
	}, 15000);
});

describe("frida-extensible-workflows · loadPatternMeta (D4)", () => {
	it("recupera las flags del moat persistidas", async () => {
		const { runId } = await runWorkflowInStore({
			name: "understand-app",
			script: OK_SCRIPT,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
			patternMeta: MOAT_META,
		});
		const { snapshot } = await new RunStore(CWD, SESSION, runId, home).load();
		expect(loadPatternMeta(snapshot)).toEqual({
			moat: { lens: true, codebaseIndex: true },
		});
	}, 15000);

	it("filtra basura: flags no boolean no pasan (nunca throw)", () => {
		// snapshot hand-edited: el helper valida, no confía.
		const snap = {
			metadata: {
				name: "x",
				patternMeta: { moat: { lens: "sí", codebaseIndex: 1 } },
			},
		} as unknown as LaunchSnapshot;
		expect(loadPatternMeta(snap)).toEqual({ moat: {} });
	});

	it("meta sin moat (patrón futuro sin opt-in) → flags vacías", () => {
		const snap = {
			metadata: { name: "x", patternMeta: { requiredTools: ["shell"] } },
		} as unknown as LaunchSnapshot;
		expect(loadPatternMeta(snap)).toEqual({ moat: {} });
	});
});

describe("frida-extensible-workflows · retry conserva el moat (D4)", () => {
	it("la run HIJA hereda el patternMeta del source", async () => {
		// 1ª run: falla tras un agent() completado → journal con A.
		const calls: string[] = [];
		const failing: SpawnAgentFn = async (p) => {
			calls.push(String(p));
			if (String(p) === "B") throw new Error("B falló");
			return `R:${p}`;
		};
		await runWorkflowInStore({
			name: "understand-app",
			script:
				"const a = await agent('A'); const b = await agent('B'); return [a, b];",
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: failing,
			home,
			patternMeta: MOAT_META,
		}).catch(() => undefined);
		const sourceRunId = await findSingleRunId();
		expect(sourceRunId).toBeDefined();

		// retry: la hija persiste el MISMO patternMeta (retry-de-retry).
		const { runId: childRunId } = await retryWorkflow(sourceRunId!, {
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		const { snapshot } = await new RunStore(
			CWD,
			SESSION,
			childRunId,
			home,
		).load();
		expect(snapshot.metadata.patternMeta).toEqual(MOAT_META);
		expect(loadPatternMeta(snapshot)?.moat).toEqual(MOAT_META.moat);
		// replay intacto: A no se re-ejecutó (molde retry-resume).
		expect(calls.filter((c) => c === "A")).toHaveLength(1);
	}, 20000);

	it("retry de una run VIEJA (sin patternMeta) no lo inventa", async () => {
		const calls: string[] = [];
		const failing: SpawnAgentFn = async (p) => {
			calls.push(String(p));
			if (String(p) === "B") throw new Error("B falló");
			return `R:${p}`;
		};
		await runWorkflowInStore({
			name: "wf-clasico",
			script:
				"const a = await agent('A'); const b = await agent('B'); return [a, b];",
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: failing,
			home,
			// sin patternMeta — run "vieja"
		}).catch(() => undefined);
		const sourceRunId = await findSingleRunId();
		expect(sourceRunId).toBeDefined();
		const { runId: childRunId } = await retryWorkflow(sourceRunId!, {
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		const { snapshot } = await new RunStore(
			CWD,
			SESSION,
			childRunId,
			home,
		).load();
		expect(snapshot.metadata.patternMeta).toBeUndefined();
	}, 20000);
});

describe("frida-extensible-workflows · seam ↔ composición (no-leakage)", () => {
	it("loadPatternMeta de una run sin moat compone exactamente la base", async () => {
		const { runId } = await runWorkflowInStore({
			name: "wf-clasico",
			script: OK_SCRIPT,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		const { snapshot } = await new RunStore(CWD, SESSION, runId, home).load();
		const moat = loadPatternMeta(snapshot)?.moat;
		// La oración completa del seam: runs sin moat → lista base idéntica a
		// createWorkflowChildFactories (los patrones hermanos no ven nada nuevo).
		expect(
			createWorkflowChildFactoriesWithMoat({
				cwd: CWD,
				agentDir: home,
				...(moat ? { moat } : {}),
			}).map((e) => e.name),
		).toEqual(createWorkflowChildFactories(CWD).map((e) => e.name));
	}, 15000);
});
