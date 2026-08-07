// Fase 5 — checkpoints (pausa → workflow_respond) + budget (agentLaunches hard).
// Los checkpoints pausan la run hasta resolveCheckpoint (simulate workflow_respond);
// el budget hard de agentLaunches lanza BUDGET_EXHAUSTED → estado budget_exhausted.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runWorkflow } from "../../src/tools/frida-extensible-workflows/core/execution";
import { RunStore } from "../../src/tools/frida-extensible-workflows/core/persistence";
import {
	runWorkflowInStore,
	createJournaledBridge,
} from "../../src/tools/frida-extensible-workflows/frida-host";
import {
	resolveCheckpoint,
	_resetPendingCheckpoints,
} from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

const CWD = "/tmp/proj-cp";
const SESSION = "sess-cp";
let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "frida-wf-cp-"));
	_resetPendingCheckpoints();
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	_resetPendingCheckpoints();
});

async function waitUntil(
	predicate: () => boolean,
	timeoutMs = 5000,
): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("waitUntil timeout");
		await new Promise((r) => setTimeout(r, 10));
	}
}

describe("frida-extensible-workflows · checkpoints (Fase 5)", () => {
	it("checkpoint() pausa hasta resolveCheckpoint(approved=true) y devuelve true", async () => {
		const seen: Array<{ name: string; prompt: string }> = [];
		const onCheckpoint = (cp: { name: string; prompt: string }) =>
			seen.push({ name: cp.name, prompt: cp.prompt });
		const spawn: SpawnAgentFn = async (p) => `R:${p}`;
		const runId = randomUUID();
		const controller = new AbortController();
		const script =
			"const ok = await checkpoint({ name: 'gate', prompt: 'aprobar?', context: { x: 1 } }); return ok ? 'yes' : 'no';";

		const promise = runWorkflowInStore({
			name: "cp",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			signal: controller.signal,
			home,
			foreground: false,
			onCheckpoint,
		});

		await waitUntil(() => seen.length > 0);
		expect(seen[0]!.name).toBe("gate");
		expect(seen[0]!.prompt).toBe("aprobar?");

		resolveCheckpoint(runId, "gate", true);
		const { result } = await promise;
		expect(result).toBe("yes");
	}, 15000);

	it("checkpoint() con approved=false devuelve 'rejected'", async () => {
		const seen: Array<{ name: string }> = [];
		const spawn: SpawnAgentFn = async (p) => `R:${p}`;
		const runId = randomUUID();
		const script =
			"const ok = await checkpoint({ name: 'c2', prompt: 'p', context: null }); return ok;";

		const promise = runWorkflowInStore({
			name: "cp",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			home,
			foreground: false,
			onCheckpoint: (cp) => seen.push({ name: cp.name }),
		});

		await waitUntil(() => seen.length > 0);
		resolveCheckpoint(runId, "c2", false);
		const { result } = await promise;
		// execution.ts brandea: result false → "rejected" (string), no boolean.
		expect(result).toBe("rejected");
	}, 15000);

	it("checkpoint replay: una run ya decidida no vuelve a preguntar (journal)", async () => {
		const seen: Array<{ name: string }> = [];
		const spawn: SpawnAgentFn = async (p) => `R:${p}`;
		const runId = randomUUID();
		const script =
			"const ok = await checkpoint({ name: 'g3', prompt: 'p', context: null }); return ok ? 'Y' : 'N';";

		// 1ª vez: lanzar, esperar a que pause, resolver true, await.
		const first = runWorkflowInStore({
			name: "cp",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			home,
			foreground: false,
			onCheckpoint: (cp) => seen.push({ name: cp.name }),
		});
		await waitUntil(() => seen.length > 0);
		resolveCheckpoint(runId, "g3", true);
		const done = await first;
		expect(done.result).toBe("Y");

		// Re-run MISMO runId con store fresco: el checkpoint replaya (no pausa).
		const store = new RunStore(CWD, SESSION, runId, home);
		const bridge = createJournaledBridge({
			store,
			spawnAgent: spawn,
			cwd: CWD,
			foreground: false,
		});
		const replayed = await runWorkflow(script, null, bridge).result;
		expect(replayed).toBe("Y");
	}, 15000);
});

describe("frida-extensible-workflows · budget agentLaunches hard (Fase 5)", () => {
	it("exceder agentLaunches.hard lanza BUDGET_EXHAUSTED → estado budget_exhausted", async () => {
		const spawn: SpawnAgentFn = async (p) => `R:${p}`;
		const runId = randomUUID();
		const script =
			"const a = await agent('a'); const b = await agent('b'); return [a, b];";
		// hard: 1 → el 2º agent se bloquea.
		const budget = { agentLaunches: { hard: 1 } };

		const promise = runWorkflowInStore({
			name: "bg",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			home,
			budget: budget as never,
		});
		await expect(promise).rejects.toThrow(/budget|BUDGET/i);
		const status = await new RunStore(CWD, SESSION, runId, home).loadStatus();
		expect(status.state).toBe("budget_exhausted");
	}, 15000);

	it("sin budget, N agents corren sin límite", async () => {
		let calls = 0;
		const spawn: SpawnAgentFn = async () => {
			calls++;
			return calls;
		};
		const script =
			"const a = await agent('a'); const b = await agent('b'); const c = await agent('c'); return [a, b, c];";
		const { result } = await runWorkflowInStore({
			name: "nobudget",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		expect(result).toEqual([1, 2, 3]);
		expect(calls).toBe(3);
	}, 15000);
});
