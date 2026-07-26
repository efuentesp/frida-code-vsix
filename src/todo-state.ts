// Holder en memoria del TaskState del tool `todo` para la sesión activa de Frida.
//
// Frida maneja UNA sesión de Pi activa a la vez en el webview (el SDK soporta
// branching, pero el host orquesta una sesión conmutada por switchSession).
// Por eso basta con un estado simple de módulo (a diferencia de rpiv-todo, que
// keyed por sid por tener sesiones foreground/child paralelas).
//
// Ciclo de vida:
//  - Al crear / abrir (switch) sesión: el host llama a `setTodoState(replayFromBranch(...))`
//    para reconstruir desde el historial (cada toolResult "todo" lleva el snapshot).
//  - Tras cada `tool_execution_end` del tool "todo": el host lee `getTodoState()`
//    y lo publica al webview (post {type:"todos",...}).
//  - El propio `execute` del tool muta aquí vía `setTodoState` antes de retornar.
//
// Así la lista sobrevive a /reload (las factories se re-ejecutan pero el módulo
// retiene el estado y, además, coincide con el historial) y a compaction.

import { EMPTY_STATE, type TaskState } from "./tools/todo/state-reducer";

let current: TaskState = { tasks: [], nextId: 1 };

export function getTodoState(): TaskState {
	return current;
}

export function setTodoState(s: TaskState): void {
	current = s;
}

export function resetTodoState(): void {
	current = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
}
