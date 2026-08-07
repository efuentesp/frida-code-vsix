// Fase 1 — RunStore persiste/carga artefactos de una run bajo un home temporal
// (mecanismo de journal/snapshot verificado; el layout usa home/.pi/workflows/...
// que es almacenamiento interno de persistencia, independiente del agentDir).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	RunStore,
	runsDirectory,
} from "../../src/tools/frida-extensible-workflows/core/persistence";
import type { PersistedRun } from "../../src/tools/frida-extensible-workflows/core/persistence";
import type { LaunchSnapshot } from "../../src/tools/frida-extensible-workflows/core/types";

const CWD = "/tmp/proj-test";
const SESSION = "sess-1";
const RUN = "run-1";

let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "frida-wf-home-"));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function sampleRunningRun(): PersistedRun {
	return {
		id: RUN,
		workflowName: "test-wf",
		cwd: CWD,
		sessionId: SESSION,
		state: "running",
		agentSessions: [],
		agents: [],
	} as PersistedRun;
}

function sampleSnapshot(script: string): LaunchSnapshot {
	return {
		script,
		args: null,
		metadata: { name: "test-wf" },
		settings: { concurrency: 1 },
		models: [],
		tools: [],
		agentTypes: [],
		schemas: [],
	} as LaunchSnapshot;
}

describe("frida-extensible-workflows · RunStore persist/carga (Fase 1)", () => {
	it("create() escribe state/journal/snapshot/workflow.js", async () => {
		const store = new RunStore(CWD, SESSION, RUN, home);
		await store.create(sampleRunningRun(), sampleSnapshot("return 42;"));
		const dir = store.directory;
		expect(existsSync(join(dir, "state.json"))).toBe(true);
		expect(existsSync(join(dir, "journal.json"))).toBe(true);
		expect(existsSync(join(dir, "snapshot.json"))).toBe(true);
		expect(existsSync(join(dir, "workflow.js"))).toBe(true);
	}, 10000);

	it("load() recupera la run y el snapshot persistidos", async () => {
		const store = new RunStore(CWD, SESSION, RUN, home);
		await store.create(sampleRunningRun(), sampleSnapshot("return 42;"));

		const fresh = new RunStore(CWD, SESSION, RUN, home);
		const loaded = await fresh.load();
		expect(loaded.run.id).toBe(RUN);
		expect(loaded.run.state).toBe("running");
		expect(loaded.snapshot.script).toBe("return 42;");
	}, 10000);

	it("saveState() actualiza state.json y loadStatus() lo refleja", async () => {
		const store = new RunStore(CWD, SESSION, RUN, home);
		await store.create(sampleRunningRun(), sampleSnapshot("return 42;"));
		await store.saveState({ ...sampleRunningRun(), state: "completed" });

		const fresh = new RunStore(CWD, SESSION, RUN, home);
		const status = await fresh.loadStatus();
		expect(status.state).toBe("completed");
	}, 10000);

	it("runsDirectory() anida bajo <home>/.frida/workflows/projects/.../runs", () => {
		const dir = runsDirectory(CWD, SESSION, home);
		expect(dir.startsWith(join(home, ".frida", "workflows"))).toBe(true);
		expect(dir.endsWith("runs")).toBe(true);
	});
});
