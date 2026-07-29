// Store reactivo del TaskState del tool `todo` (ADR-0014). Sucesor de
// `src/todo-state.ts`: misma API (getTodoState/setTodoState/resetTodoState) +
// `subscribeTodoState` para que el panel Remote React (TodoWebPanel) se
// re-renderice ante cada mutation vía useSyncExternalStore.
//
// Sigue siendo un holder simple de módulo (Frida maneja UNA sesión activa en el
// webview, a diferencia de rpiv-todo que keyea por sid). La diferencia con el
// holder anterior: setTodoState/resetTodoState EMITEN a los oyentes, así el
// componente web (montado persistente) recibe cada cambio sin que el host tenga
// que publicarlo por un conducto aparte (post {type:"todos"} queda obsoleto).
//
// Ciclo de vida:
//  - Al crear/abrir (switch) sesión: la extensión (createTodoWeb) llama a
//    resetTodoState() + setTodoState(replayFromBranch(...)).
//  - Cada execute del tool muta aquí vía setTodoState (emite → re-render).
//  - La sesión_activa/compaction dispara replay → setTodoState (emite).

import { EMPTY_STATE, type TaskState } from "../todo/state-reducer";

let current: TaskState = { tasks: [], nextId: 1 };
// Display state: ids de tareas completadas en turnos anteriores, ocultas para
// reducir ruido (paridad con rpiv-todo hideCompletedTasksFromPreviousTurn). Se
// llenan en agent_start (las completed del turno previo) y se resetean en
// session_start/compact. Estable por referencia entre emits (useSyncExternalStore).
let hiddenIds = new Set<number>();
const listeners = new Set<() => void>();

function emit(): void {
	// Copia: un oyente puede desuscribirse durante el ciclo (patrón estándar de
	// useSyncExternalStore).
	for (const l of [...listeners]) l();
}

export function getTodoState(): TaskState {
	return current;
}

export function setTodoState(s: TaskState): void {
	current = s;
	emit();
}

/** ids de tareas completadas ocultas (turnos anteriores). */
export function getHiddenIds(): Set<number> {
	return hiddenIds;
}

export function setHiddenIds(ids: Set<number>): void {
	hiddenIds = ids;
	emit();
}

export function resetTodoState(): void {
	current = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
	hiddenIds = new Set();
	emit();
}

/** Suscripción para useSyncExternalStore. Devuelve la función de cleanup. */
export function subscribeTodoState(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
