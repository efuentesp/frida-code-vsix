// frida-workflow — store reactivo del estado de runs (Fase 5).
//
// Un listener global (createWorkflowLifecycle, en panel.ts) muta este store ante
// cada evento de lifecycle; el WorkflowPanel (fridaWeb persistente) lo consume
// vía useSyncExternalStore y se re-renderiza solo. Cada mutación reasigna
// `current` (nueva ref) → useSyncExternalStore lo detecta por Object.is.
// Host-agnostic: no importa fridaWeb ni el SDK.

import type { LifecycleContext, StageOutput, StageRef } from "./lifecycle";

export type StageViewStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "aborted";

export interface UnitView {
	label: string;
	status: "running" | "completed" | "failed";
	handle?: string;
}

/** Una entrada del transcript en vivo de una child session: una tool o un
 *  fragmento de texto del sub-agente. Lo captura el host suscribiéndose a los
 *  eventos del SDK (tool_execution_start/end + message_update) y lo renderiza
 *  el WorkflowPanel al expandir la etapa. */
export interface TranscriptEntry {
	/** toolCallId (tools) o clave sintética (texto). */
	id: string;
	kind: "tool" | "text";
	toolName?: string;
	status?: "running" | "completed" | "failed";
	/** edit/write/read/grep… — ruta o patrón extraído de los args. */
	path?: string;
	/** bash — comando extraído de los args. */
	command?: string;
	/** edit/write — «+X -Y» si el result lo expone. */
	diffStat?: string;
	/** text — fragmento del texto del sub-agente. */
	text?: string;
}

export interface StageView {
	name: string;
	skill: string;
	status: StageViewStatus;
	primaryHandle?: string;
	error?: string;
	retries?: number;
	/** Unidades de loop (Fase 6) bajo esta etapa. */
	units?: UnitView[];
	/** Transcript en vivo de la(s) child session(s) de esta etapa (tools + texto
	 *  del sub-agente), capturado por el host vía suscripción a eventos del SDK.
	 *  Lo renderiza el WorkflowPanel al expandir la etapa. */
	transcript?: TranscriptEntry[];
}

export type RunStatus = "running" | "completed" | "failed" | "aborted";

export interface RunView {
	runId: string;
	workflow: string;
	input: string;
	status: RunStatus;
	stages: StageView[];
	error?: string;
}

export interface WorkflowRunsState {
	runs: RunView[];
}

let current: WorkflowRunsState = { runs: [] };
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of [...listeners]) l();
}

function set(next: WorkflowRunsState): void {
	current = next;
	emit();
}

/** Snapshot para useSyncExternalStore. */
export function getWorkflowRuns(): WorkflowRunsState {
	return current;
}

/** Suscripción para useSyncExternalStore. */
export function subscribeWorkflowRuns(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Sólo tests. */
export function _resetWorkflowRuns(): void {
	current = { runs: [] };
	emit();
}

// ---------------------------------------------------------------------------
// Mutadores (llamados por el lifecycle listener)
// ---------------------------------------------------------------------------

function mapRun(runId: string, fn: (r: RunView) => RunView): WorkflowRunsState {
	return { runs: current.runs.map((r) => (r.runId === runId ? fn(r) : r)) };
}

export function startRun(ctx: LifecycleContext): void {
	// Reemplaza si ya existía (re-run con mismo id); deja el más reciente al final.
	const others = current.runs.filter((r) => r.runId !== ctx.runId);
	set({
		runs: [
			...others,
			{
				runId: ctx.runId,
				workflow: ctx.workflow,
				input: ctx.input,
				status: "running",
				stages: [],
			},
		],
	});
}

export function stageStart(stage: StageRef, ctx: LifecycleContext): void {
	set(
		mapRun(ctx.runId, (r) => ({
			...r,
			stages: [
				...r.stages,
				{ name: stage.name, skill: stage.skill, status: "running" },
			],
		})),
	);
}

export function stageEnd(
	stage: StageRef,
	output: StageOutput | undefined,
	ctx: LifecycleContext,
): void {
	set(
		mapRun(ctx.runId, (r) => ({
			...r,
			stages: upsertStage(r.stages, stage, (s) => ({
				...s,
				status: "completed",
				primaryHandle: output?.primaryHandle,
			})),
		})),
	);
}

export function stageRetry(
	stage: StageRef,
	attempt: number,
	ctx: LifecycleContext,
): void {
	set(
		mapRun(ctx.runId, (r) => ({
			...r,
			stages: upsertStage(r.stages, stage, (s) => ({ ...s, retries: attempt })),
		})),
	);
}

export function stageError(
	stage: StageRef,
	error: string,
	ctx: LifecycleContext,
): void {
	set(
		mapRun(ctx.runId, (r) => ({
			...r,
			stages: upsertStage(r.stages, stage, (s) => ({
				...s,
				status: "failed",
				error,
			})),
		})),
	);
}

export function endRun(
	result: { success: boolean; error?: string; termination: { status: string } },
	ctx: LifecycleContext,
): void {
	const status: RunStatus =
		result.termination.status === "completed"
			? "completed"
			: result.termination.status === "aborted"
				? "aborted"
				: "failed";
	set(
		mapRun(ctx.runId, (r) => ({
			...r,
			status,
			error: result.success ? undefined : result.error,
		})),
	);
}

// --- Unidades de loop (Fase 6) ---

export function unitStart(
	stage: StageRef,
	unit: { index: number; label: string; id?: string },
	ctx: LifecycleContext,
): void {
	set(
		mapRun(ctx.runId, (r) => {
			const stages = upsertStage(r.stages, stage, (s) => ({
				...s,
				units: [
					...(s.units ?? []),
					{ label: unit.label, status: "running" as const },
				],
			}));
			return { ...r, stages };
		}),
	);
}

export function unitEnd(
	stage: StageRef,
	unit: { index: number; label: string; id?: string },
	output: StageOutput | undefined,
	ctx: LifecycleContext,
): void {
	set(
		mapRun(ctx.runId, (r) => {
			const stages = upsertStage(r.stages, stage, (s) => {
				const units = [...(s.units ?? [])];
				const at = units[unit.index];
				if (at) {
					units[unit.index] = {
						...at,
						status: output ? "completed" : "failed",
						handle: output?.primaryHandle,
					};
				}
				return { ...s, units };
			});
			return { ...r, stages };
		}),
	);
}

// --- Transcript en vivo (capturado por el host desde eventos del SDK) ---

/** Aplica fn a la última etapa con ese nombre (la running), o NO-OP si no existe
 *  (p.ej. sesiones de judges con nombre sintético «<stage>-judge»: no crean filas
 *  fantasma en el panel). Variante no-insertora de upsertStage. */
function patchStage(
	stages: StageView[],
	name: string,
	fn: (s: StageView) => StageView,
): StageView[] {
	const idx = [...stages].reverse().findIndex((s) => s.name === name);
	if (idx < 0) return stages;
	const realIdx = stages.length - 1 - idx;
	return stages.map((s, i) => (i === realIdx ? fn(s) : s));
}

/** Añade una entrada de tool al transcript de la etapa (tool_execution_start). */
export function appendTranscriptTool(
	runId: string,
	stage: string,
	entry: TranscriptEntry,
): void {
	set(
		mapRun(runId, (r) => ({
			...r,
			stages: patchStage(r.stages, stage, (s) => ({
				...s,
				transcript: [...(s.transcript ?? []), entry],
			})),
		})),
	);
}

/** Actualiza la entrada de tool con ese toolCallId (tool_execution_end: estado +
 *  diffStat). No-op si no existe (p.ej. start descartado). */
export function updateTranscriptTool(
	runId: string,
	stage: string,
	toolCallId: string,
	patch: Partial<TranscriptEntry>,
): void {
	set(
		mapRun(runId, (r) => ({
			...r,
			stages: patchStage(r.stages, stage, (s) => {
				const entries = [...(s.transcript ?? [])];
				const idx = entries.findIndex((e) => e.id === toolCallId);
				if (idx >= 0) entries[idx] = { ...entries[idx], ...patch };
				return { ...s, transcript: entries };
			}),
		})),
	);
}

/** Acumula un fragmento de texto del sub-agente en el transcript de la etapa.
 *  Si la última entrada ya es texto, la extiende (conserva el orden texto→tool). */
export function appendTranscriptText(
	runId: string,
	stage: string,
	text: string,
): void {
	set(
		mapRun(runId, (r) => ({
			...r,
			stages: patchStage(r.stages, stage, (s) => {
				const entries = [...(s.transcript ?? [])];
				const last = entries[entries.length - 1];
				if (last && last.kind === "text") {
					entries[entries.length - 1] = {
						...last,
						text: (last.text ?? "") + text,
					};
				} else {
					entries.push({
						id: `text-${entries.length}`,
						kind: "text",
						text,
					});
				}
				return { ...s, transcript: entries };
			}),
		})),
	);
}

/** Actualiza la última etapa con ese nombre (la que está running), o la inserta. */
function upsertStage(
	stages: StageView[],
	stage: StageRef,
	fn: (s: StageView) => StageView,
): StageView[] {
	const idx = [...stages].reverse().findIndex((s) => s.name === stage.name);
	if (idx < 0) {
		return [
			...stages,
			fn({ name: stage.name, skill: stage.skill, status: "completed" }),
		];
	}
	const realIdx = stages.length - 1 - idx;
	return stages.map((s, i) => (i === realIdx ? fn(s) : s));
}
