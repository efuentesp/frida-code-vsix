// Fase 3 — persistencia + journal/replay determinista + status.
// runWorkflowInStore escribe state/journal/snapshot; al re-ejecutar la misma run
// el agent NO se vuelve a llamar (replay desde journal). El estado sobrevive a
// "reload" (un RunStore fresco lee de disco).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflow } from "../../src/tools/frida-extensible-workflows/core/execution";
import {
	RunStore,
	runsDirectory,
} from "../../src/tools/frida-extensible-workflows/core/persistence";
import {
	runWorkflowInStore,
	createJournaledBridge,
} from "../../src/tools/frida-extensible-workflows/frida-host";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

const CWD = "/tmp/proj-replay";
const SESSION = "sess-replay";

let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "frida-wf-replay-"));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("frida-extensible-workflows · persistencia + replay (Fase 3)", () => {
	it("runWorkflowInStore persiste state/journal/snapshot y termina completed", async () => {
		let calls = 0;
		const spawn: SpawnAgentFn = async (p) => {
			calls++;
			return `R:${p}`;
		};
		const { runId, result } = await runWorkflowInStore({
			name: "wf1",
			script: "return await agent('x');",
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		expect(result).toBe("R:x");
		expect(calls).toBe(1);

		const dir = join(runsDirectory(CWD, SESSION, home), runId);
		expect(existsSync(join(dir, "state.json"))).toBe(true);
		expect(existsSync(join(dir, "journal.json"))).toBe(true);
		expect(existsSync(join(dir, "snapshot.json"))).toBe(true);
		const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
		expect(state.state).toBe("completed");
	}, 15000);

	it("REPLAY: re-ejecutar la misma run NO llama al spawner (journal)", async () => {
		let calls = 0;
		const spawn: SpawnAgentFn = async (p) => {
			calls++;
			return `R:${p}`;
		};
		const script = "return await agent('x');";

		// 1ª ejecución: journaliza el agent.
		const { runId } = await runWorkflowInStore({
			name: "wf2",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		expect(calls).toBe(1);

		// Re-ejecutar MISMO runId con un RunStore fresco que lee el journal de disco:
		// el agent ya está completado → replay → el spawner NO se invoca.
		const store = new RunStore(CWD, SESSION, runId, home);
		const bridge = createJournaledBridge({
			store,
			spawnAgent: spawn,
			cwd: CWD,
		});
		const exec = runWorkflow(script, null, bridge);
		const result = await exec.result;
		expect(result).toBe("R:x");
		expect(calls).toBe(1); // no incrementó → replay determinista verificado
	}, 15000);

	it("status sobrevive a reload: un RunStore nuevo lee estado 'completed'", async () => {
		const spawn: SpawnAgentFn = async (p) => `R:${p}`;
		const { runId } = await runWorkflowInStore({
			name: "wf3",
			script: "return await agent('y');",
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});

		// Simula reload: otra instancia de RunStore apuntando al mismo runId en disco.
		const fresh = new RunStore(CWD, SESSION, runId, home);
		const status = await fresh.loadStatus();
		expect(status.id).toBe(runId);
		expect(status.state).toBe("completed");
		expect(status.workflowName).toBe("wf3");
	}, 15000);

	it("replay con parallel(): ambas ramas se journalizan y no se re-ejecutan", async () => {
		let calls = 0;
		const spawn: SpawnAgentFn = async (p) => {
			calls++;
			return `R:${p}`;
		};
		const script = `
			const r = await parallel("op", { a: () => agent("A"), b: () => agent("B") });
			return r;
		`;
		const { runId } = await runWorkflowInStore({
			name: "wf4",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
		});
		expect(calls).toBe(2);

		// Re-run: las 2 ramas replay → 0 llamadas nuevas.
		const store = new RunStore(CWD, SESSION, runId, home);
		const bridge = createJournaledBridge({
			store,
			spawnAgent: spawn,
			cwd: CWD,
		});
		const result = await runWorkflow(script, null, bridge).result;
		expect(result).toEqual({ a: "R:A", b: "R:B" });
		expect(calls).toBe(2);
	}, 15000);
});
