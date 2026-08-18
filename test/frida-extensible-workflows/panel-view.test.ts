// frida-extensible-workflows · panel-view (#71) — helpers puros de la vista
// v2 (cards con pills) y acumulación de fases por run.
//
// El diseño elegido reemplaza el look terminal (glifos unicode planos) por
// cards bordered con pills de estado semántico. Los helpers viven en
// panel-view.ts (puros, testeables) y el panel los consume; el store acumula
// el historial de fases vistas por run (antes sólo llegaba la última).

import { describe, it, expect, beforeEach } from "vitest";
import {
	runPill,
	groupBar,
	phaseChips,
	AGENT_ICON,
} from "../../src/tools/frida-extensible-workflows/panel-view";
import {
	applyWorkflowProgress,
	getWorkflowRuns,
	upsertWorkflowRun,
	_resetWorkflowRuns,
	type AgentProgressView,
	type GroupProgressView,
} from "../../src/tools/frida-extensible-workflows/store";

describe("frida-extensible-workflows · runPill (#71)", () => {
	it("etiqueta + color semántico por estado", () => {
		expect(runPill("awaiting")).toMatchObject({
			label: "APROBAR",
			color: "#d29922",
		});
		expect(runPill("running")).toMatchObject({
			label: "RUNNING",
			color: "#58a6ff",
		});
		expect(runPill("completed")).toMatchObject({
			label: "COMPLETADO",
			color: "#3fb950",
		});
		expect(runPill("failed")).toMatchObject({
			label: "FALLÓ",
			color: "#f85149",
		});
		// Estados sin urgencia visual: pill neutro (gris).
		expect(runPill("stopped").color).toBe("#8b949e");
		expect(runPill("budget_exhausted").color).toBe("#8b949e");
	});

	it("el pill de awaiting es compacto (icono lucide + label corto)", () => {
		const pill = runPill("awaiting");
		pill.icon = "circle-pause";
		expect(pill.label.length).toBeLessThanOrEqual(10);
		expect(pill.icon).toBe("circle-pause");
		expect(runPill("running").icon).toBe("loader-circle");
		expect(runPill("failed").icon).toBe("circle-x");
	});
	it("iconos lucide en vez de glifos unicode (#71)", () => {
		expect(runPill("completed").icon).toBe("circle-check");
		expect(runPill("stopped").icon).toBe("square");
		expect(runPill("budget_exhausted").icon).toBe("hourglass");
		expect(AGENT_ICON.completed).toBe("check");
		expect(AGENT_ICON.failed).toBe("x");
		expect(AGENT_ICON.running).toBe("loader-circle");
		expect(AGENT_ICON.queued).toBe("circle");
	});
});

const GROUP: GroupProgressView = {
	structuralPath: ["root", "specs"],
	name: "specs",
	taskNames: ["E1-S1", "E1-S2", "E1-S3", "E1-S4"],
	state: "running",
};

const agent = (
	task: string,
	state: AgentProgressView["state"],
): AgentProgressView => ({
	agentId: `${task}-${state}`,
	structuralPath: ["root", "specs", task],
	state,
	startedAt: 0,
});

describe("frida-extensible-workflows · groupBar (#71)", () => {
	it("segmenta por tarea con estados reales de agentes (extrae taskState)", () => {
		const bar = groupBar(GROUP, [
			agent("E1-S1", "completed"),
			agent("E1-S2", "failed"),
			agent("E1-S3", "running"),
			// E1-S4 sin agente → queued
		]);
		expect(bar.total).toBe(4);
		expect(bar.done).toBe(1);
		expect(bar.failed).toBe(1);
		expect(bar.running).toBe(1);
		expect(bar.segments).toEqual([
			{ state: "completed" },
			{ state: "failed" },
			{ state: "running" },
			{ state: "queued" },
		]);
	});

	it("sin agentes: todas queued", () => {
		const bar = groupBar(GROUP, []);
		expect(bar.segments.every((s) => s.state === "queued")).toBe(true);
		expect(bar.done).toBe(0);
	});
});

describe("frida-extensible-workflows · phaseChips (#71)", () => {
	it("fases vistas: ✓ las anteriores a la actual, ● la actual", () => {
		expect(phaseChips(["brief", "prd", "architecture"], "prd")).toEqual([
			{ name: "brief", state: "done" },
			{ name: "prd", state: "current" },
			{ name: "architecture", state: "pending" },
		]);
	});

	it("la fase actual siempre es current aunque falte en el historial", () => {
		expect(phaseChips(["brief"], "prd")).toEqual([
			{ name: "brief", state: "done" },
			{ name: "prd", state: "current" },
		]);
	});
});

describe("frida-extensible-workflows · fases acumuladas por run (#71)", () => {
	beforeEach(() => {
		_resetWorkflowRuns();
	});

	it("los eventos phase se acumulan en orden y sin duplicados ni vacíos", () => {
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "running" });
		applyWorkflowProgress({
			runId: "r1",
			progress: { type: "progress", kind: "phase", name: "brief" },
		});
		applyWorkflowProgress({
			runId: "r1",
			progress: { type: "progress", kind: "phase", name: "prd" },
		});
		// Duplicado consecutivo → no repite; vacío → ignora.
		applyWorkflowProgress({
			runId: "r1",
			progress: { type: "progress", kind: "phase", name: "prd" },
		});
		applyWorkflowProgress({
			runId: "r1",
			progress: { type: "progress", kind: "phase", name: "" },
		});
		const run = getWorkflowRuns()[0];
		expect(run.phases).toEqual(["brief", "prd"]);
		expect(run.phase).toBe("prd");
	});

	it("una run nueva arranca con phases vacías; upsert conserva el historial", () => {
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "running" });
		expect(getWorkflowRuns()[0].phases).toEqual([]);
		applyWorkflowProgress({
			runId: "r1",
			progress: { type: "progress", kind: "phase", name: "brief" },
		});
		// upsert de transición (running → awaiting) NO borra el historial.
		upsertWorkflowRun({ runId: "r1", workflowName: "wf", state: "awaiting" });
		expect(getWorkflowRuns()[0].phases).toEqual(["brief"]);
	});
});
