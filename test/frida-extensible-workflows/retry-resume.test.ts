// Fase 6 — workflow_retry (replay paths completados del source en run hija) +
// workflow_resume (continuar budget_exhausted con budget patch).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	runWorkflowInStore,
	retryWorkflow,
	resumeWorkflow,
} from "../../src/tools/frida-extensible-workflows/frida-host";
import { RunStore } from "../../src/tools/frida-extensible-workflows/core/persistence";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

const CWD = "/tmp/proj-retry";
const SESSION = "sess-retry";
let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "frida-wf-retry-"));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("frida-extensible-workflows · workflow_retry (Fase 6)", () => {
	it("replay: la run hija NO re-ejecuta los paths completados del source", async () => {
		const calls = { A: 0, B: 0 };
		let bFail = true;
		const spawn: SpawnAgentFn = async (p) => {
			calls[p as "A" | "B"] += 1;
			if (p === "B" && bFail) {
				bFail = false;
				throw new Error("B falló");
			}
			return `R:${p}`;
		};
		const script =
			"const a = await agent('A'); const b = await agent('B'); return [a, b];";

		// 1ª run: A completa, B falla → run failed. Journal tiene A.
		const source = await runWorkflowInStore({
			name: "wf",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		}).catch((e) => e);
		expect(source).toBeInstanceOf(Error);
		expect(calls.A).toBe(1);
		expect(calls.B).toBe(1); // B se llamó y lanzó

		// Localizar el sourceRunId (la run failed). listPersistedSessionIds → runs.
		// Más simple: la run fallida es la única en este home/session/cwd.
		const sourceRunId = await findSingleRunId();
		expect(sourceRunId).toBeDefined();
		const sourceStatus = await new RunStore(
			CWD,
			SESSION,
			sourceRunId!,
			home,
		).loadStatus();
		expect(sourceStatus.state).toBe("failed");

		// retry: run hija replays A (calls.A sin cambiar), ejecuta B (succeeds ahora).
		const { runId: childRunId, result } = await retryWorkflow(sourceRunId!, {
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		expect(childRunId).not.toBe(sourceRunId);
		expect(result).toEqual(["R:A", "R:B"]);
		expect(calls.A).toBe(1); // ← replay: A NO se re-ejecutó
		expect(calls.B).toBe(2); // B re-intentado (éxito)
	}, 20000);

	it("retry rechaza una run no terminal-fallida", async () => {
		const spawn: SpawnAgentFn = async (p) => `R:${p}`;
		const { runId } = await runWorkflowInStore({
			name: "ok",
			script: "return await agent('x');",
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		await expect(
			retryWorkflow(runId, {
				cwd: CWD,
				sessionId: SESSION,
				spawnAgent: spawn,
				home,
			}),
		).rejects.toMatchObject({ code: "RESUME_INCOMPATIBLE" });
	}, 15000);
});

describe("frida-extensible-workflows · workflow_resume (Fase 6)", () => {
	it("resume continúa budget_exhausted con un budget patch que relaja", async () => {
		const calls = { A: 0, B: 0 };
		const spawn: SpawnAgentFn = async (p) => {
			calls[p as "A" | "B"] += 1;
			return `R:${p}`;
		};
		const script =
			"const a = await agent('A'); const b = await agent('B'); return [a, b];";
		const budget = { agentLaunches: { hard: 1 } };

		// 1ª run: A corre (usage=1), B → BUDGET_EXHAUSTED.
		const exhausted = await runWorkflowInStore({
			name: "bg",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
			budget: budget as never,
		}).catch((e) => e);
		expect(exhausted).toBeInstanceOf(Error);
		expect(calls.A).toBe(1);
		expect(calls.B).toBe(0); // B nunca se llamó (budget bloqueó antes)

		const runId = await findSingleRunId();
		const before = await new RunStore(CWD, SESSION, runId!, home).loadStatus();
		expect(before.state).toBe("budget_exhausted");

		// resume con patch que relaja hard a 3: A replaya, B corre.
		const { result } = await resumeWorkflow(runId!, {
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
			budgetPatch: { agentLaunches: { hard: 3 } },
		});
		expect(result).toEqual(["R:A", "R:B"]);
		expect(calls.A).toBe(1); // ← A replayado (no re-ejecutado)
		expect(calls.B).toBe(1); // B corrió al reanudar

		const after = await new RunStore(CWD, SESSION, runId!, home).loadStatus();
		expect(after.state).toBe("completed");
	}, 20000);

	it("resume sin patch y con el mismo tope vuelve a agotarse", async () => {
		const spawn: SpawnAgentFn = async (p) => `R:${p}`;
		const script =
			"const a = await agent('A'); const b = await agent('B'); return [a, b];";
		const budget = { agentLaunches: { hard: 1 } };
		await runWorkflowInStore({
			name: "bg",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
			budget: budget as never,
		}).catch(() => undefined);
		const runId = await findSingleRunId();
		// Sin patch: usage re-hidratado (1) >= hard(1) → B vuelve a agotarse.
		await expect(
			resumeWorkflow(runId!, {
				cwd: CWD,
				sessionId: SESSION,
				spawnAgent: spawn,
				home,
			}),
		).rejects.toThrow(/budget|BUDGET/i);
	}, 15000);
});

// Helper: encuentra el único runId persistido en este home/session/cwd.
async function findSingleRunId(): Promise<string | undefined> {
	const { listPersistedSessionIds, runsDirectory } = await import(
		"../../src/tools/frida-extensible-workflows/core/persistence"
	);
	const sessions = await listPersistedSessionIds(CWD, home);
	if (sessions.length !== 1) return undefined;
	const { readdir } = await import("node:fs/promises");
	const dir = runsDirectory(CWD, sessions[0]!, home);
	const entries = await readdir(dir, { withFileTypes: true });
	const runDir = entries.find(
		(e) => e.isDirectory() && !e.name.startsWith("."),
	);
	return runDir?.name;
}
