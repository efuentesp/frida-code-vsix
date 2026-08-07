// frida-extensible-workflows — store reactivo de runs (Fase 7 UI).
//
// Host-side: index.ts (factory) lo muta directamente al iniciar/completar/fallar
// runs en background. El WorkflowPanel (fridaWeb persistente) lo consume vía
// useSyncExternalStore y se re-renderiza solo. Cada mutación reasigna `current`
// (nueva ref) → useSyncExternalStore lo detecta por Object.is.
// Host-agnostic: no importa fridaWeb ni el SDK.

export type WorkflowRunState =
	| "running"
	| "completed"
	| "failed"
	| "stopped"
	| "budget_exhausted";

export interface WorkflowRunView {
	runId: string;
	workflowName: string;
	state: WorkflowRunState;
	error?: string;
}

let current: readonly WorkflowRunView[] = [];
const listeners = new Set<() => void>();

function emit(): void {
	for (const listener of listeners) listener();
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

/** Inserta o actualiza una run por runId (reasigna ref → re-render). */
export function upsertWorkflowRun(view: WorkflowRunView): void {
	const idx = current.findIndex((r) => r.runId === view.runId);
	current =
		idx >= 0
			? current.map((r, i) => (i === idx ? view : r))
			: [...current, view];
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
