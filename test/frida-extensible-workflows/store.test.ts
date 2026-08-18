// Fase 7 — store reactivo del panel UI: upsert/subscribe/get/remove.
import { describe, it, expect, beforeEach } from "vitest";
import {
	subscribeWorkflowRuns,
	getWorkflowRuns,
	upsertWorkflowRun,
	removeWorkflowRun,
	_resetWorkflowRuns,
} from "../../src/tools/frida-extensible-workflows/store";
import {
	registerCheckpoint,
	hasPendingCheckpoint,
	resolveCheckpointFromUi,
} from "../../src/tools/frida-extensible-workflows/frida-delivery";

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

describe("frida-extensible-workflows · checkpoints visibles en el panel (#64)", () => {
	beforeEach(() => {
		_resetWorkflowRuns();
	});

	it("state awaiting + checkpointName: el panel puede distinguir 'esperando al usuario' de 'trabajando'", () => {
		upsertWorkflowRun({ runId: "r1", workflowName: "aidd-plan", state: "running" });
		upsertWorkflowRun({
			runId: "r1",
			workflowName: "aidd-plan",
			state: "awaiting",
			checkpointName: "stage-prd",
		});
		const run = getWorkflowRuns().find((r) => r.runId === "r1");
		expect(run?.state).toBe("awaiting");
		expect(run?.checkpointName).toBe("stage-prd");
	});

	it("al resolver (aprobar/rechazar) la run vuelve a running SIN checkpoint pendiente", () => {
		upsertWorkflowRun({
			runId: "r1",
			workflowName: "aidd-plan",
			state: "awaiting",
			checkpointName: "stage-prd",
		});
		// Lo que hará el botón del panel / workflow_respond: limpiar el pendiente.
		upsertWorkflowRun({
			runId: "r1",
			workflowName: "aidd-plan",
			state: "running",
			checkpointName: undefined,
		});
		const run = getWorkflowRuns().find((r) => r.runId === "r1");
		expect(run?.state).toBe("running");
		expect(run?.checkpointName).toBeUndefined();
	});

	it("resolveCheckpointFromUi resuelve el checkpoint en vivo Y hace el upsert optimista", () => {
		let decided: boolean | undefined;
		registerCheckpoint("r1", "stage-prd", {
			resolve: (approved) => {
				decided = approved;
			},
			reject: () => undefined,
		});
		upsertWorkflowRun({
			runId: "r1",
			workflowName: "aidd-plan",
			state: "awaiting",
			checkpointName: "stage-prd",
		});
		const ok = resolveCheckpointFromUi("r1", "stage-prd", true);
		expect(ok).toBe(true);
		expect(decided).toBe(true);
		const run = getWorkflowRuns().find((r) => r.runId === "r1");
		expect(run?.state).toBe("running");
		expect(run?.checkpointName).toBeUndefined();
		expect(hasPendingCheckpoint("r1", "stage-prd")).toBe(false);
	});

	it("resolveCheckpointFromUi sin checkpoint pendiente es no-op (retorna false, no toca el store)", () => {
		upsertWorkflowRun({
			runId: "r1",
			workflowName: "aidd-plan",
			state: "awaiting",
			checkpointName: "stage-prd",
		});
		expect(resolveCheckpointFromUi("r1", "stage-otro", true)).toBe(false);
		const run = getWorkflowRuns().find((r) => r.runId === "r1");
		expect(run?.state).toBe("awaiting"); // intacto
	});
});
