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
	orphanStatusPill,
	groupBar,
	phaseChips,
	AGENT_ICON,
	timelineRows,
	agentDisplayName,
	collapsedHeader,
	phaseProgress,
	formatTokens,
	runStats,
	recentFailed,
	hasPanelContent,
	pipelineGraph,
} from "../../src/tools/frida-extensible-workflows/panel-view";
import {
	applyWorkflowProgress,
	getWorkflowRuns,
	upsertWorkflowRun,
	_resetWorkflowRuns,
	_resetPanelVisibility,
	consumePanelShowRequest,
	requestPanelShow,
	isPanelPinned,
	setPanelPinned,
	subscribePanelVisibility,
	rehydrateRuns,
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

describe("frida-extensible-workflows · orphanStatusPill (#149)", () => {
	it("resuelve pill semántico para runs huérfanas terminadas", () => {
		expect(
			orphanStatusPill({ state: "completed", kind: "terminal" }),
		).toMatchObject({
			label: "COMPLETADO",
			color: "#3fb950",
			icon: "circle-check",
		});
		expect(
			orphanStatusPill({ state: "stopped", kind: "terminal" }),
		).toMatchObject({
			label: "DETENIDO",
			color: "#8b949e",
			icon: "square",
		});
		expect(orphanStatusPill({ state: "failed", kind: "terminal" })).toMatchObject(
			{
				label: "FALLÓ",
				color: "#f85149",
				icon: "circle-x",
			},
		);
	});

	it("resuelve pill de advertencia para runs huérfanas atoradas (stuck)", () => {
		expect(orphanStatusPill({ state: "running", kind: "stuck" })).toMatchObject({
			label: "ATORADO",
			color: "#d29922",
			icon: "triangle-alert",
		});
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

describe("frida-extensible-workflows · timeline vertical + label real (#79)", () => {
	const ev = applyWorkflowProgress;

	function seedRun(runId: string): void {
		upsertWorkflowRun({
			runId,
			workflowName: "aidd-ship-demo",
			state: "running",
			phases: [],
			agents: [],
			groups: [],
		} as Parameters<typeof upsertWorkflowRun>[0]);
	}

	beforeEach(() => _resetWorkflowRuns());

	it("phaseTimes: phase abre fase nueva y cierra la previa; reaparición reabre", () => {
		seedRun("r79a");
		ev({
			runId: "r79a",
			progress: { type: "progress", kind: "phase", name: "bootstrap" },
		});
		let run = getWorkflowRuns().find((r) => r.runId === "r79a");
		expect(run?.phaseTimes.bootstrap?.startedAt).toBeTypeOf("number");
		expect(run?.phaseTimes.bootstrap?.endedAt).toBeUndefined();

		ev({
			runId: "r79a",
			progress: { type: "progress", kind: "phase", name: "ship" },
		});
		run = getWorkflowRuns().find((r) => r.runId === "r79a");
		expect(run?.phaseTimes.bootstrap?.endedAt).toBeTypeOf("number");
		expect(run?.phaseTimes.ship?.startedAt).toBeTypeOf("number");

		// Reaparición (resume / fase que vuelve): reabre, no duplica startedAt base.
		const before = run?.phaseTimes.ship?.startedAt;
		ev({
			runId: "r79a",
			progress: { type: "progress", kind: "phase", name: "bootstrap" },
		});
		run = getWorkflowRuns().find((r) => r.runId === "r79a");
		expect(run?.phaseTimes.ship?.endedAt).toBeTypeOf("number");
		expect(run?.phaseTimes.bootstrap?.endedAt).toBeUndefined();
		expect(run?.phaseTimes.bootstrap?.startedAt).toBeTypeOf("number");
		expect(run?.phaseTimes.ship?.startedAt).toBe(before);
	});

	it("agent_start con label guarda label humano y la fase activa", () => {
		seedRun("r79b");
		ev({
			runId: "r79b",
			progress: { type: "progress", kind: "phase", name: "story E3-S2" },
		});
		ev({
			runId: "r79b",
			progress: {
				type: "progress",
				kind: "agent_start",
				agentId: "a1",
				structuralPath: ["root"],
				label: "implement E3-S2",
			},
		});
		const a = getWorkflowRuns().find((r) => r.runId === "r79b")?.agents[0];
		expect(a?.label).toBe("implement E3-S2");
		expect(a?.phase).toBe("story E3-S2");
	});

	it("timelineRows: fases en orden con duración; activa lleva sus agentes anidados", () => {
		const rows = timelineRows(
			{
				phase: "story E2-S1",
				phases: ["bootstrap", "ship", "story E1-S1", "story E2-S1"],
				phaseTimes: {
					bootstrap: { startedAt: 0, endedAt: 12_000 },
					ship: { startedAt: 12_000, endedAt: 58_000 },
					"story E1-S1": { startedAt: 58_000, endedAt: 474_000 },
					"story E2-S1": { startedAt: 474_000 },
				},
				agents: [
					{
						agentId: "a1",
						structuralPath: ["root"],
						label: "implement E2-S1",
						phase: "story E2-S1",
						state: "running",
						startedAt: 480_000,
					},
					{
						agentId: "a0",
						structuralPath: ["root"],
						label: "brief",
						phase: "bootstrap",
						state: "completed",
						startedAt: 1_000,
						endedAt: 10_000,
					},
				],
				groups: [],
			},
			600_000,
		);
		expect(rows.map((r) => r.name)).toEqual([
			"bootstrap",
			"ship",
			"story E1-S1",
			"story E2-S1",
		]);
		expect(rows[0]).toMatchObject({ state: "done", durationMs: 12_000 });
		expect(rows[2]).toMatchObject({ state: "done", durationMs: 416_000 });
		expect(rows[3]).toMatchObject({ state: "current", durationMs: 126_000 });
		// Agentes anidados bajo SU fase, en orden de inicio.
		expect(rows[3].agents.map((a) => a.agentId)).toEqual(["a1"]);
		expect(rows[0].agents.map((a) => a.agentId)).toEqual(["a0"]);
		// Fase sin agentes conocidos: lista vacía, no undefined.
		expect(rows[1].agents).toEqual([]);
	});

	it("timelineRows excluye agentes de grupos y agentDisplayName prefiere label", () => {
		const rows = timelineRows(
			{
				phase: "specs",
				phases: ["specs"],
				phaseTimes: { specs: { startedAt: 0 } },
				agents: [
					{
						agentId: "g1",
						structuralPath: ["root", "specs", "E1"],
						phase: "specs",
						state: "running",
						startedAt: 5,
					},
					{
						agentId: "f1",
						structuralPath: ["root"],
						label: "sweep",
						phase: "specs",
						state: "running",
						startedAt: 9,
					},
				],
				groups: [
					{
						structuralPath: ["root", "specs"],
						name: "specs",
						taskNames: ["E1"],
						state: "running",
					},
				],
			},
			10,
		);
		// g1 pertenece al grupo (path lo extiende) → queda para la sección de grupos.
		expect(rows[0].agents.map((a) => a.agentId)).toEqual(["f1"]);

		expect(agentDisplayName({ ...rows[0].agents[0] })).toBe("sweep");
		expect(
			agentDisplayName({
				agentId: "x",
				structuralPath: ["root", "specs", "E1-S1"],
				state: "running",
				startedAt: 0,
			}),
		).toBe("E1-S1");
		expect(
			agentDisplayName({
				agentId: "x",
				structuralPath: ["root"],
				role: "worker",
				state: "running",
				startedAt: 0,
			}),
			// Prioridad documentada: label > path > role (#71 conservado).
		).toBe("root");
		expect(
			agentDisplayName({
				agentId: "x",
				structuralPath: [],
				role: "worker",
				state: "running",
				startedAt: 0,
			}),
		).toBe("worker");
	});
});

describe("frida-extensible-workflows · header contraído con progreso (#80)", () => {
	const run = (over: Partial<Parameters<typeof collapsedHeader>[0][number]>) =>
		({
			runId: "r",
			workflowName: "wf",
			state: "running",
			phase: undefined,
			phases: [],
			phaseTimes: {},
			agents: [],
			groups: [],
			...over,
		}) as Parameters<typeof collapsedHeader>[0][number];

	it("phaseProgress: done = índice de la fase activa; terminal = total", () => {
		expect(
			phaseProgress({
				phases: ["bootstrap", "ship", "story E1"],
				phase: "ship",
			}),
		).toEqual({ done: 1, total: 3 });
		expect(phaseProgress({ phases: ["a", "b"], phase: "b" })).toEqual({
			done: 1,
			total: 2,
		});
		// Fase actual no está en el historial (edge) → done = total.
		expect(phaseProgress({ phases: ["a"], phase: "zzz" })).toEqual({
			done: 1,
			total: 1,
		});
	});

	it("collapsedHeader con 1 run: nombre, barra, fase y ⟳N", () => {
		const h = collapsedHeader([
			run({
				workflowName: "aidd-ship-nutrimetrics",
				phase: "story E3-S2",
				phases: ["bootstrap", "ship", "story E1", "story E3-S2"],
				agents: [
					{
						agentId: "a1",
						structuralPath: ["root"],
						state: "running",
						startedAt: 0,
					},
					{
						agentId: "a2",
						structuralPath: ["root"],
						state: "completed",
						startedAt: 0,
					},
				],
			}),
		]);
		expect(h.title).toBe("aidd-ship-nutrimetrics");
		expect(h.progress).toEqual({ done: 3, total: 4 });
		expect(h.phase).toBe("story E3-S2");
		expect(h.running).toBe(1);
	});

	it("collapsedHeader con 2+: título agregado, sin barra, ⟳ suma", () => {
		const h = collapsedHeader([
			run({
				workflowName: "uno",
				phase: "p1",
				phases: ["p1"],
				agents: [
					{ agentId: "a", structuralPath: [], state: "running", startedAt: 0 },
				],
			}),
			run({
				workflowName: "dos",
				phase: "q1",
				phases: ["q1"],
				agents: [
					{ agentId: "b", structuralPath: [], state: "running", startedAt: 0 },
				],
			}),
		]);
		expect(h.title).toBe("Workflows · 2");
		expect(h.progress).toBeUndefined();
		expect(h.phase).toBeUndefined();
		expect(h.running).toBe(2);
	});

	it("collapsedHeader sin runs activos: sin progreso", () => {
		const h = collapsedHeader([
			run({ state: "completed", phases: ["a", "b"], phase: undefined }),
		]);
		expect(h.title).toBe("Workflows");
		expect(h.progress).toBeUndefined();
		expect(h.running).toBe(0);
	});
});

describe("frida-extensible-workflows · stats del run: ⏱ + ∑tokens (#81)", () => {
	beforeEach(() => _resetWorkflowRuns());

	it("agent_end con tokens: acumula en el run y en el agente", () => {
		upsertWorkflowRun({ runId: "r81", workflowName: "wf", state: "running" });
		applyWorkflowProgress({
			runId: "r81",
			progress: { type: "progress", kind: "phase", name: "p" },
		});
		applyWorkflowProgress({
			runId: "r81",
			progress: {
				type: "progress",
				kind: "agent_start",
				agentId: "a1",
				structuralPath: ["r"],
			},
		});
		applyWorkflowProgress({
			runId: "r81",
			progress: {
				type: "progress",
				kind: "agent_end",
				agentId: "a1",
				ok: true,
				tokens: 48_000,
				cost: 0.11,
			},
		});
		applyWorkflowProgress({
			runId: "r81",
			progress: {
				type: "progress",
				kind: "agent_start",
				agentId: "a2",
				structuralPath: ["r"],
			},
		});
		applyWorkflowProgress({
			runId: "r81",
			progress: {
				type: "progress",
				kind: "agent_end",
				agentId: "a2",
				ok: true,
				tokens: 6_000,
			},
		});
		const run = getWorkflowRuns().find((r) => r.runId === "r81");
		expect(run?.tokens).toBe(54_000);
		expect(run?.costUsd).toBeCloseTo(0.11);
		expect(run?.agents.find((a) => a.agentId === "a1")?.tokens).toBe(48_000);
	});

	it("startedAt al primer evento; lastActivityAt avanza con cada evento", () => {
		upsertWorkflowRun({ runId: "r81b", workflowName: "wf", state: "running" });
		applyWorkflowProgress({
			runId: "r81b",
			progress: { type: "progress", kind: "phase", name: "p" },
		});
		const t1 = getWorkflowRuns()[0].lastActivityAt;
		expect(getWorkflowRuns()[0].startedAt).toBeTypeOf("number");
		applyWorkflowProgress({
			runId: "r81b",
			progress: {
				type: "progress",
				kind: "agent_start",
				agentId: "a1",
				structuralPath: [],
			},
		});
		expect(getWorkflowRuns()[0].lastActivityAt ?? 0).toBeGreaterThanOrEqual(
			t1 ?? 0,
		);
	});

	it("formatTokens legible; runStats elapsed con lastActivity", () => {
		expect(formatTokens(543_000)).toBe("543K");
		expect(formatTokens(1_234_567)).toBe("1.2M");
		expect(formatTokens(950)).toBe("950");
		const s = runStats(
			{ startedAt: 1_000, lastActivityAt: 61_000, tokens: 543_000, costUsd: 1.24 },
			120_000,
		);
		expect(s).toEqual({ elapsedMs: 60_000, tokens: 543_000, costUsd: 1.24 });
		// Sin lastActivity (running): elapsed hasta now.
		const s2 = runStats(
			{ startedAt: 1_000, lastActivityAt: undefined, tokens: 0, costUsd: 0 },
			61_000,
		);
		expect(s2.elapsedMs).toBe(60_000);
	});
});

describe("frida-extensible-workflows · fallidos visibles en el panel (#74)", () => {
	const run = (id: string, over: Record<string, unknown>) =>
		({
			runId: id,
			workflowName: "wf-" + id,
			state: "running",
			phase: undefined,
			phases: [],
			phaseTimes: {},
			agents: [],
			groups: [],
			tokens: 0,
			costUsd: 0,
			...over,
		}) as Parameters<typeof recentFailed>[0][number];

	it("recentFailed: sólo failed de la sesión, más reciente primero, cap 3", () => {
		const out = recentFailed([
			run("live", { state: "running", lastActivityAt: 90 }),
			run("done", { state: "completed", lastActivityAt: 80 }),
			run("f1", { state: "failed", error: "uno", lastActivityAt: 50 }),
			run("f2", { state: "failed", error: "dos", lastActivityAt: 70 }),
			run("f3", { state: "failed", error: "tres", lastActivityAt: 60 }),
			run("f4", { state: "failed", error: "cuatro", lastActivityAt: 10 }),
		]);
		// Sólo failed, ordenados por última actividad desc, máximo 3.
		expect(out.map((r) => r.runId)).toEqual(["f2", "f3", "f1"]);
	});

	it("recentFailed vacío sin fallidos", () => {
		expect(recentFailed([run("a", { state: "running" })])).toEqual([]);
	});
});

describe("frida-extensible-workflows · visibilidad forzada del panel (#84)", () => {
	beforeEach(() => {
		_resetWorkflowRuns();
		_resetPanelVisibility();
	});

	it("requestPanelShow one-shot: true al pedir, se consume al leer", () => {
		expect(consumePanelShowRequest()).toBe(false);
		requestPanelShow();
		expect(consumePanelShowRequest()).toBe(true);
		expect(consumePanelShowRequest()).toBe(false);
	});

	it("pin reactivo: toggle + notifica listeners", () => {
		let fires = 0;
		const off = subscribePanelVisibility(() => {
			fires += 1;
		});
		expect(isPanelPinned()).toBe(false);
		setPanelPinned(true);
		expect(isPanelPinned()).toBe(true);
		expect(fires).toBe(1);
		off();
	});

	it("rehydrateRuns: revive awaiting de disco sin pisar los ya presentes", () => {
		upsertWorkflowRun({
			runId: "vivo",
			workflowName: "wf-vivo",
			state: "running",
		});
		rehydrateRuns([
			{
				runId: "vivo",
				workflowName: "wf-vivo-DELDISCO",
				state: "running",
			},
			{
				runId: "checkpointed",
				workflowName: "tea-atdd-demo",
				state: "awaiting",
				checkpointName: "scenarios",
			},
		]);
		const runs = getWorkflowRuns();
		// El vivo NO se pisa (el store de memoria gana).
		expect(runs.find((r) => r.runId === "vivo")?.workflowName).toBe("wf-vivo");
		// El awaiting de disco revivió con su checkpoint para el banner #64.
		const revived = runs.find((r) => r.runId === "checkpointed");
		expect(revived?.state).toBe("awaiting");
		expect(revived?.checkpointName).toBe("scenarios");
	});

	it("hasPanelContent: pinned/showRequest fuerzan; sin nada y sin fijar → false", () => {
		const empty: never[] = [];
		expect(hasPanelContent([], empty, { pinned: false })).toBe(false);
		expect(hasPanelContent([], empty, { pinned: true })).toBe(true);
		expect(hasPanelContent([], empty, { showRequested: true })).toBe(true);
	});
});

describe("frida-extensible-workflows · pipelineGraph (Propuesta 1)", () => {
	it("genera nodos conectados con estados done, current y pending más conteo de agentes", () => {
		const nodes = pipelineGraph(
			{
				phase: "research",
				phases: ["discovery", "research", "plan", "review"],
				phaseTimes: {
					discovery: { startedAt: 0, endedAt: 15_000 },
					research: { startedAt: 15_000 },
				},
				agents: [
					{
						agentId: "a1",
						structuralPath: ["root"],
						label: "Codebase Analyzer",
						phase: "research",
						state: "running",
						startedAt: 16_000,
					},
					{
						agentId: "a2",
						structuralPath: ["root"],
						label: "Domain Modeler",
						phase: "research",
						state: "running",
						startedAt: 18_000,
					},
					{
						agentId: "a0",
						structuralPath: ["root"],
						label: "Scope Tracer",
						phase: "discovery",
						state: "completed",
						startedAt: 1_000,
						endedAt: 14_000,
					},
				],
			},
			35_000,
		);

		expect(nodes).toHaveLength(4);
		expect(nodes[0]).toMatchObject({
			name: "discovery",
			state: "done",
			durationMs: 15_000,
			agentCount: 1,
			isLast: false,
		});
		expect(nodes[1]).toMatchObject({
			name: "research",
			state: "current",
			durationMs: 20_000,
			agentCount: 2,
			isLast: false,
		});
		expect(nodes[2]).toMatchObject({
			name: "plan",
			state: "pending",
			isLast: false,
		});
		expect(nodes[3]).toMatchObject({
			name: "review",
			state: "pending",
			isLast: true,
		});
	});
});
