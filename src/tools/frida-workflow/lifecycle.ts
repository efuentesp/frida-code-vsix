// frida-workflow — lifecycle hooks (Fase 5).
//
// El runner dispara estos eventos DESPUÉS de que su fila JSONL aterrice (rpiv:
// garantía para lectores que llamen readLastStage). Un listener global
// (createWorkflowLifecycle en panel.ts) los traduce a mutaciones del store → el
// WorkflowPanel (fridaWeb persistente) se re-renderiza solo. Eventos de loop/unidad
// (onLoopStart/onUnitStart/...) llegan en Fase 6; aquí sólo stage + workflow.

import type { RunWorkflowResult } from "./types";

export interface LifecycleContext {
	runId: string;
	workflow: string;
	input: string;
	cwd: string;
}

export interface StageRef {
	name: string;
	skill: string;
}

/** Info del loop al arrancar (Fase 6/7). */
export interface LoopInfo {
	kind: "fanout" | "iterate" | "assess";
	units?: number; // sólo fanout (precalcula las unidades)
}

/** Identidad de una unidad de loop (onUnitStart/onUnitEnd). */
export interface UnitEvent {
	index: number;
	label: string;
	id?: string;
}

/** Info del cap de loop (onLoopCap, Fase 6/7). */
export interface LoopCapInfo {
	kind: "fanout" | "iterate" | "assess";
	count: number;
	max: number;
	policy: "halt" | "advance";
}

/** Proyección ligera del Output de la etapa (lo que el panel necesita). */
export interface StageOutput {
	primaryHandle?: string;
	data?: unknown;
}

export interface LifecycleListeners {
	onWorkflowStart?: (ctx: LifecycleContext) => void | Promise<void>;
	onStageStart?: (
		stage: StageRef,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onStageEnd?: (
		stage: StageRef,
		output: StageOutput | undefined,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onStageRetry?: (
		stage: StageRef,
		attempt: number,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onStageError?: (
		stage: StageRef,
		error: string,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onRoute?: (
		from: string,
		to: string,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onLoopStart?: (
		stage: StageRef,
		info: LoopInfo,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onUnitStart?: (
		stage: StageRef,
		unit: UnitEvent,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onUnitEnd?: (
		stage: StageRef,
		unit: UnitEvent,
		output: StageOutput | undefined,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onLoopCap?: (
		stage: StageRef,
		info: LoopCapInfo,
		ctx: LifecycleContext,
	) => void | Promise<void>;
	onWorkflowEnd?: (
		result: RunWorkflowResult,
		ctx: LifecycleContext,
	) => void | Promise<void>;
}

const bundles: LifecycleListeners[] = [];

/** Registra un bundle de listeners. Devuelve dispose(). */
export function registerLifecycle(b: LifecycleListeners): () => void {
	bundles.push(b);
	return () => {
		const i = bundles.indexOf(b);
		if (i >= 0) bundles.splice(i, 1);
	};
}

/** Sólo tests: limpia el registry. */
export function _resetLifecycle(): void {
	bundles.length = 0;
}

/** Dispara un evento a todos los bundles registrados (orden de registro).
 *  Awaits cada uno; un throw se captura (no rompe el run). Snapshot: cada bundle
 *  se evalúa contra el registry al instante del fire. */
export async function fire<K extends keyof LifecycleListeners>(
	event: K,
	...args: Parameters<NonNullable<LifecycleListeners[K]>>
): Promise<void> {
	for (const b of [...bundles]) {
		const fn = b[event] as ((...a: unknown[]) => unknown) | undefined;
		if (!fn) continue;
		try {
			await fn(...(args as unknown[]));
		} catch {
			/* un listener que falla no rompe el run */
		}
	}
}
