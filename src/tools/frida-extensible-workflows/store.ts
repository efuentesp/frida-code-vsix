// frida-extensible-workflows — store reactivo de runs (Fase 7 UI + issue #7).
//
// Host-side: index.ts (factory) lo muta al iniciar/completar/fallar runs en
// background, y applyWorkflowProgress() lo muta en vivo con cada evento de
// progreso (agent_start/end, group_start/end, phase) recibido del child forkeado.
// El WorkflowPanel (fridaWeb persistente) lo consume vía useSyncExternalStore y
// se re-renderiza solo. Cada mutación reasigna `current` (nueva ref) →
// useSyncExternalStore lo detecta por Object.is. Host-agnostic: no importa
// fridaWeb ni el SDK; por eso el tipo del evento se define aquí (sin depender
// de core/execution, que arrastra módulos de node).

import { wfLog } from "./telemetry";

export type WorkflowRunState =
	| "running"
	| "awaiting"
	| "completed"
	| "failed"
	| "stopped"
	| "budget_exhausted";

export type AgentProgressState = "running" | "completed" | "failed";

/** Vista de un agente individual dentro de un run (emergió de un agent_start). */
export interface AgentProgressView {
	agentId: string;
	structuralPath: readonly string[];
	role?: string;
	/** Label humano de las options del agent() (#79) — p.ej. "stage prd". */
	label?: string;
	/** Fase activa del run al momento del agent_start (#79) — anida en el timeline. */
	phase?: string;
	occurrence?: number;
	state: AgentProgressState;
	startedAt: number;
	endedAt?: number;
	code?: string;
}

/** Grupo (parallel/pipeline) con sus tareas esperadas (taskNames se conocen al inicio). */
export interface GroupProgressView {
	structuralPath: readonly string[];
	name: string;
	taskNames: readonly string[];
	state: AgentProgressState;
}

/** Evento de progreso emitido por el child forkeado vía IPC (shape de core/execution). */
export interface WorkflowProgressEvent {
	type: "progress";
	kind: "agent_start" | "agent_end" | "group_start" | "group_end" | "phase";
	agentId?: string;
	structuralPath?: string[];
	role?: string;
	/** Label de las options del agent() (#79). */
	label?: string;
	occurrence?: number;
	ok?: boolean;
	code?: string;
	name?: string;
	taskNames?: string[];
}

/** Tiempo abierto/cerrado de una fase (#79) — duración del timeline vertical. */
export interface PhaseTiming {
	startedAt: number;
	endedAt?: number;
}

export interface WorkflowRunView {
	runId: string;
	workflowName: string;
	state: WorkflowRunState;
	error?: string;
	/** Fase actual (si el workflow llama phase(name)). */
	phase?: string;
	/** Historial de fases vistas por el run (#71) — chips ✓/● del panel v2. */
	phases: readonly string[];
	/** startedAt/endedAt por fase (#79) — duración en el timeline vertical. */
	phaseTimes: Readonly<Record<string, PhaseTiming>>;
	/** Checkpoint pendiente de aprobación cuando state === "awaiting" (#64). */
	checkpointName?: string;
	/** Agentes en vivo (issue #7). */
	agents: readonly AgentProgressView[];
	/** Grupos parallel/pipeline en vivo (issue #7). */
	groups: readonly GroupProgressView[];
}

let current: readonly WorkflowRunView[] = [];
const listeners = new Set<() => void>();

function emit(): void {
	for (const listener of listeners) listener();
}

/** Clave estable para comparar/arglomerar structuralPath. */
export function pathKey(structuralPath: readonly string[] | undefined): string {
	return (structuralPath ?? []).join("/");
}

export function subscribeWorkflowRuns(listener: () => void): () => void {
	listeners.add(listener);
	wfLog("subscribe", { listeners: listeners.size });
	return () => {
		listeners.delete(listener);
		wfLog("unsubscribe", { listeners: listeners.size });
	};
}

export function getWorkflowRuns(): readonly WorkflowRunView[] {
	return current;
}

// ── Huérfanos de sesiones previas (#69) ─────────────────────────────────────
// Vista serializable de un run huérfano para el panel (host-side: incluye
// runDir para [Ver journal] sin re-escanear).

export interface OrphanRunView {
	runId: string;
	sessionId: string;
	workflowName: string;
	state: string;
	kind: "stuck" | "terminal";
	checkpointName?: string;
	ageDays: number;
	runDir: string;
}

let currentOrphans: readonly OrphanRunView[] = [];
const orphanListeners = new Set<() => void>();

function emitOrphans(): void {
	for (const listener of orphanListeners) listener();
}

export function subscribeOrphanRuns(listener: () => void): () => void {
	orphanListeners.add(listener);
	return () => {
		orphanListeners.delete(listener);
	};
}

export function getOrphanRuns(): readonly OrphanRunView[] {
	return currentOrphans;
}

/** Reemplaza la lista de huérfanos del panel (tras scan/purge del GC #69). */
export function setOrphanRuns(runs: readonly OrphanRunView[]): void {
	currentOrphans = runs;
	emitOrphans();
}

/** Sólo tests. */
export function _resetOrphanRuns(): void {
	currentOrphans = [];
	orphanListeners.clear();
}

/**
 * Inserta o actualiza una run por runId (reasigna ref → re-render). Merge:
 * preserva phase/agents/groups existentes si no se proveen en `view` (para que
 * la transición running→completed no borre el progreso acumulado).
 */
export function upsertWorkflowRun(
	view: Pick<WorkflowRunView, "runId" | "workflowName" | "state"> & {
		error?: string;
		phase?: string;
		checkpointName?: string;
		agents?: readonly AgentProgressView[];
		groups?: readonly GroupProgressView[];
	},
): void {
	wfLog("upsert", {
		runId: view.runId,
		state: view.state,
		phase: view.phase,
		agents: view.agents?.length,
		groups: view.groups?.length,
		totalRuns: current.length,
		listeners: listeners.size,
	});
	const idx = current.findIndex((r) => r.runId === view.runId);
	if (idx >= 0) {
		const prev = current[idx];
		const merged: WorkflowRunView = {
			...prev,
			...view,
			// Al no proveerse, conservar el progreso existente.
			phase: "phase" in view ? view.phase : prev.phase,
			// checkpointName: undefined EXPLÍCITO lo limpia (awaiting → running);
			// ausente conserva el valor previo (merge).
			checkpointName:
				"checkpointName" in view ? view.checkpointName : prev.checkpointName,
			agents: view.agents ?? prev.agents,
			groups: view.groups ?? prev.groups,
			// #71: el historial de fases sólo lo muta applyWorkflowProgress;
			// un upsert de transición (running → awaiting) lo conserva.
			phases: prev.phases,
			// #79: ídem para los tiempos por fase.
			phaseTimes: prev.phaseTimes,
		};
		const next = current.slice();
		next[idx] = merged;
		current = next;
	} else {
		current = [
			...current,
			{
				runId: view.runId,
				workflowName: view.workflowName,
				state: view.state,
				...(view.error ? { error: view.error } : {}),
				...(view.phase === undefined ? {} : { phase: view.phase }),
				...(view.checkpointName === undefined
					? {}
					: { checkpointName: view.checkpointName }),
				agents: view.agents ?? [],
				groups: view.groups ?? [],
				phases: [],
				phaseTimes: {},
			},
		];
	}
	emit();
}

/**
 * Procesa un evento de progreso en vivo (issue #7) y muta la run correspondiente.
 * Si la run no está registrada en el panel (p.ej. foreground), es no-op.
 */
export function applyWorkflowProgress(opts: {
	runId: string;
	progress: WorkflowProgressEvent;
}): void {
	const { runId, progress } = opts;
	const idx = current.findIndex((r) => r.runId === runId);
	wfLog("progress", {
		runId,
		kind: progress.kind,
		knownRun: idx >= 0,
		totalRuns: current.length,
		listeners: listeners.size,
	});
	if (idx < 0) return;
	const run = current[idx];
	const {
		kind,
		name,
		agentId,
		structuralPath,
		role,
		label,
		occurrence,
		ok,
		code,
		taskNames,
	} = progress;
	const now = Date.now();
	let phase = run.phase;
	let agents = run.agents;
	let groups = run.groups;
	let phases = run.phases;
	let phaseTimes = run.phaseTimes;

	if (kind === "phase") {
		if (name) {
			phase = name;
			// #71: acumula el historial (sin duplicados consecutivos).
			if (phases[phases.length - 1] !== name) phases = [...phases, name];
			// #79: cierra la fase previa (si es distinta) y abre la nueva.
			// Reaparición (resume) reabre conservando el startedAt original.
			if (run.phase && run.phase !== name) {
				phaseTimes = {
					...phaseTimes,
					[run.phase]: {
						...(phaseTimes[run.phase] ?? { startedAt: now }),
						endedAt: now,
					},
				};
			}
			if (!phaseTimes[name]) {
				phaseTimes = { ...phaseTimes, [name]: { startedAt: now } };
			} else if (phaseTimes[name].endedAt !== undefined) {
				const { startedAt: reopened } = phaseTimes[name];
				phaseTimes = { ...phaseTimes, [name]: { startedAt: reopened } };
			}
		}
	} else if (kind === "agent_start") {
		if (agentId) {
			const started: AgentProgressView = {
				agentId,
				structuralPath: structuralPath ?? [],
				...(role ? { role } : {}),
				...(label ? { label } : {}),
				// #79: fase activa al nacer — anida en el timeline vertical.
				...(phase ? { phase } : {}),
				...(occurrence === undefined ? {} : { occurrence }),
				state: "running",
				startedAt: now,
			};
			agents = [...run.agents.filter((a) => a.agentId !== agentId), started];
		}
	} else if (kind === "agent_end") {
		if (agentId) {
			agents = run.agents.map((a) =>
				a.agentId === agentId
					? {
							...a,
							state: ok ? "completed" : "failed",
							endedAt: now,
							...(code && !ok ? { code } : {}),
						}
					: a,
			);
		}
	} else if (kind === "group_start") {
		const key = pathKey(structuralPath);
		groups = [
			...run.groups.filter((g) => pathKey(g.structuralPath) !== key),
			{
				structuralPath: structuralPath ?? [],
				name: name ?? "",
				taskNames: taskNames ?? [],
				state: "running",
			},
		];
	} else if (kind === "group_end") {
		const key = pathKey(structuralPath);
		groups = run.groups.map((g) =>
			pathKey(g.structuralPath) === key
				? { ...g, state: ok ? "completed" : "failed" }
				: g,
		);
	}

	// Sólo reasignar si algo cambió.
	if (
		phase === run.phase &&
		agents === run.agents &&
		groups === run.groups &&
		phases === run.phases &&
		phaseTimes === run.phaseTimes
	)
		return;
	const next = current.slice();
	next[idx] = { ...run, phase, agents, groups, phases, phaseTimes };
	current = next;
	emit();
}

export function removeWorkflowRun(runId: string): void {
	if (!current.some((r) => r.runId === runId)) return;
	current = current.filter((r) => r.runId !== runId);
	emit();
}

/** Sólo tests. */
export function _resetWorkflowRuns(): void {
	current = [];
	listeners.clear();
}
