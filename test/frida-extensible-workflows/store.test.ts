// Fase 7 — store reactivo del panel UI: upsert/subscribe/get/remove.
import { describe, it, expect, beforeEach } from "vitest";
import {
	subscribeWorkflowRuns,
	getWorkflowRuns,
	upsertWorkflowRun,
	removeWorkflowRun,
	_resetWorkflowRuns,
} from "../../src/tools/frida-extensible-workflows/store";

beforeEach(() => {
	_resetWorkflowRuns();
});

describe("frida-extensible-workflows · store UI (Fase 7)", () => {
	it("upsert inserta y get devuelve; subscribe notifica", () => {
		const seen: number[] = [];
		const unsub = subscribeWorkflowRuns(() =>
			seen.push(getWorkflowRuns().length),
		);
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "running" });
		expect(getWorkflowRuns()).toHaveLength(1);
		upsertWorkflowRun({ runId: "r2", workflowName: "wf2", state: "running" });
		expect(getWorkflowRuns()).toHaveLength(2);
		expect(seen).toEqual([1, 2]);
		unsub();
	});

	it("upsert con runId existente actualiza (no duplica)", () => {
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "running" });
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "completed" });
		const runs = getWorkflowRuns();
		expect(runs).toHaveLength(1);
		expect(runs[0]!.state).toBe("completed");
	});

	it("remove elimina por runId", () => {
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "running" });
		removeWorkflowRun("r1");
		expect(getWorkflowRuns()).toHaveLength(0);
	});

	it("cada mutación produce una nueva referencia (Object.is false)", () => {
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "running" });
		const before = getWorkflowRuns();
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "completed" });
		const after = getWorkflowRuns();
		expect(Object.is(before, after)).toBe(false); // useSyncExternalStore lo detecta
	});
});
