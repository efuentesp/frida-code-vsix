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

export type WorkflowRunState =
	| "running"
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
	occurrence?: number;
	ok?: boolean;
	code?: string;
	name?: string;
	taskNames?: string[];
}

export interface WorkflowRunView {
	runId: string;
	workflowName: string;
	state: WorkflowRunState;
	error?: string;
	/** Fase actual (si el workflow llama phase(name)). */
	phase?: string;
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
export function pathKey(
	structuralPath: readonly string[] | undefined,
): string {
	return (structuralPath ?? []).join("/");
}

export function subscribeWorkflowRuns(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getWorkflowRuns(): readonly WorkflowRunView[] {
	return current;
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
		agents?: readonly AgentProgressView[];
		groups?: readonly GroupProgressView[];
	},
): void {
	const idx = current.findIndex((r) => r.runId === view.runId);
	if (idx >= 0) {
		const prev = current[idx];
		const merged: WorkflowRunView = {
			...prev,
			...view,
			// Al no proveerse, conservar el progreso existente.
			phase: "phase" in view ? view.phase : prev.phase,
			agents: view.agents ?? prev.agents,
			groups: view.groups ?? prev.groups,
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
				...(view.phase !== undefined ? { phase: view.phase } : {}),
				agents: view.agents ?? [],
				groups: view.groups ?? [],
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
	if (idx < 0) return;
	const run = current[idx];
	const {
		kind,
		name,
		agentId,
		structuralPath,
		role,
		occurrence,
		ok,
		code,
		taskNames,
	} = progress;
	let phase = run.phase;
	let agents = run.agents;
	let groups = run.groups;

	if (kind === "phase") {
		if (name) phase = name;
	} else if (kind === "agent_start") {
		if (agentId) {
			const started: AgentProgressView = {
				agentId,
				structuralPath: structuralPath ?? [],
				...(role ? { role } : {}),
				...(occurrence !== undefined ? { occurrence } : {}),
				state: "running",
				startedAt: Date.now(),
			};
			agents = [...run.agents.filter((a) => a.agentId !== agentId), started];
		}
	} else if (kind === "agent_end") {
		if (agentId) {
			const endedAt = Date.now();
			agents = run.agents.map((a) =>
				a.agentId === agentId
					? {
							...a,
							state: ok ? "completed" : "failed",
							endedAt,
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
	if (phase === run.phase && agents === run.agents && groups === run.groups)
		return;
	const next = current.slice();
	next[idx] = { ...run, phase, agents, groups };
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
