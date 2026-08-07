// Fase 4 — background + entrega follow-up + workflow_stop + eventos de progreso.
// Verifica la fontanería de Fase 4 sin modelo real: runWorkflowInStore con runId
// externo y signal abortable (background), deliverFollowUp/emitWorkflowEvent con
// pi mockeado, y la cancelación (workflow_stop) persiste "stopped".
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import { RunStore } from "../../src/tools/frida-extensible-workflows/core/persistence";
import {
	registerBackgroundRun,
	getBackgroundRun,
	unregisterBackgroundRun,
	deliverFollowUp,
	emitWorkflowEvent,
	_resetBackgroundRuns,
} from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

const CWD = "/tmp/proj-bg";
const SESSION = "sess-bg";
let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "frida-wf-bg-"));
	_resetBackgroundRuns();
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	_resetBackgroundRuns();
});

describe("frida-extensible-workflows · background + entrega (Fase 4)", () => {
	it("background: runWorkflowInStore acepta runId externo y signal abortable", async () => {
		let calls = 0;
		const spawn: SpawnAgentFn = async (p) => {
			calls++;
			return `R:${p}`;
		};
		const runId = randomUUID();
		const controller = new AbortController();
		registerBackgroundRun(runId, {
			controller,
			workflowName: "bg",
			sessionId: SESSION,
			cwd: CWD,
		});

		const { runId: rid, result } = await runWorkflowInStore({
			name: "bg",
			script: "return await agent('x');",
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			signal: controller.signal,
			home,
		});
		expect(rid).toBe(runId);
		expect(result).toBe("R:x");
		expect(getBackgroundRun(runId)).toBeDefined();
	}, 15000);

	it("workflow_stop: abortar el controller persiste estado 'stopped' (no 'failed')", async () => {
		const runId = randomUUID();
		const controller = new AbortController();
		registerBackgroundRun(runId, {
			controller,
			workflowName: "stop",
			sessionId: SESSION,
			cwd: CWD,
		});
		// Spawner que cuelga hasta que la señal aborte (simula un agent en vuelo).
		const spawn: SpawnAgentFn = (_p, _o, signal) =>
			new Promise((_resolve, reject) => {
				if (signal.aborted)
					reject(
						Object.assign(new Error("Workflow cancelled"), {
							code: "CANCELLED",
						}),
					);
				signal.addEventListener(
					"abort",
					() =>
						reject(
							Object.assign(new Error("Workflow cancelled"), {
								code: "CANCELLED",
							}),
						),
					{ once: true },
				);
			});

		const promise = runWorkflowInStore({
			name: "stop",
			script: "return await agent('hang');",
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			signal: controller.signal,
			home,
		});
		// workflow_stop: aborta a mitad.
		setTimeout(() => controller.abort(), 50);

		await expect(promise).rejects.toThrow(/cancel/i);
		const status = await new RunStore(CWD, SESSION, runId, home).loadStatus();
		expect(status.state).toBe("stopped"); // CANCELLED → stopped
	}, 15000);

	it("deliverFollowUp llama a pi.sendMessage con deliverAs=followUp y triggerTurn", () => {
		const calls: Array<{ m: unknown; o: unknown }> = [];
		const pi = {
			sendMessage: (m: unknown, o: unknown) => calls.push({ m, o }),
		} as never;
		deliverFollowUp(pi, "resultado-bg");
		expect(calls).toHaveLength(1);
		const { m, o } = calls[0]!;
		expect((m as { customType: string }).customType).toBe("workflow");
		expect((m as { content: string }).content).toBe("resultado-bg");
		expect((o as { deliverAs: string }).deliverAs).toBe("followUp");
		expect((o as { triggerTurn: boolean }).triggerTurn).toBe(true);
	});

	it("deliverFollowUp es no-op si el runtime no expone sendMessage", () => {
		expect(() => deliverFollowUp({} as never, "x")).not.toThrow();
	});

	it("emitWorkflowEvent emite al bus pi.events", () => {
		const events: Array<{ n: string; p: unknown }> = [];
		const pi = {
			events: { emit: (n: string, p: unknown) => events.push({ n, p }) },
		} as never;
		emitWorkflowEvent(pi, "workflow:run-started", { runId: "r1" });
		expect(events).toHaveLength(1);
		expect(events[0]!.n).toBe("workflow:run-started");
		expect((events[0]!.p as { runId: string }).runId).toBe("r1");
	});

	it("registro de background: register/get/unregister", () => {
		const runId = randomUUID();
		const controller = new AbortController();
		registerBackgroundRun(runId, {
			controller,
			workflowName: "x",
			sessionId: SESSION,
			cwd: CWD,
		});
		expect(getBackgroundRun(runId)?.workflowName).toBe("x");
		unregisterBackgroundRun(runId);
		expect(getBackgroundRun(runId)).toBeUndefined();
	});
});
