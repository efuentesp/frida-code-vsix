// Reconstrucción del TaskState desde la rama de la sesión. Porte (MIT) de
// rpiv-todo `state/replay.ts`, adaptado a Frida.
//
// No escribe a disco: cada llamada exitosa al tool `todo` devuelve el snapshot
// completo en `details`. Aquí recorremos la rama en orden cronológico y gana el
// ÚLTIMO `toolResult` con `toolName === "todo"` cuya `details` tenga la forma
// `TaskDetails` (last-write-wins). Sin coincidencias → EMPTY_STATE.
//
// Esto hace que la lista de tareas sobreviva a recarga, switch de sesión y
// compaction, sin estado adicional en disco.

import { EMPTY_STATE, type TaskState } from "./state-reducer";
import type { TaskDetails } from "./types";

/** ¿Tiene `value` la forma del snapshot `TaskDetails` que persiste el tool? */
export function isTaskDetails(value: unknown): value is TaskDetails {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return Array.isArray(v.tasks) && typeof v.nextId === "number";
}

/** Contexto mínimo: el sessionManager de Pi expone `getBranch()`. */
export interface BranchSource {
	sessionManager: { getBranch(): Iterable<unknown> };
}

/**
 * Camina la rama actual y reconstruye el estado a partir del último snapshot
 * `TaskDetails` del tool `todo`. Puro del estado de módulo — quien llama escribe
 * el resultado en el holder (`src/todo-state.ts`).
 */
export function replayFromBranch(src: BranchSource): TaskState {
	let result: TaskState = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
	for (const entry of src.sessionManager.getBranch()) {
		const e = entry as { type?: string; message?: { role?: string; toolName?: string; details?: unknown } };
		if (e.type !== "message") continue;
		const msg = e.message;
		if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
		if (!isTaskDetails(msg.details)) continue;
		result = {
			tasks: msg.details.tasks.map((t) => ({ ...t })),
			nextId: msg.details.nextId,
		};
	}
	return result;
}
