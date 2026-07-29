// TodoWebPanel — panel persistente del tool `todo` en Remote React (ADR-0014).
// Reemplaza al panel nativo del webview (webview/components/TodoPanel.tsx) y al
// conducto post {type:"todos"}: se monta una vez (createTodoWeb, session_start)
// y se re-renderiza solo ante cada mutation del store reactivo vía
// useSyncExternalStore(subscribeTodoState, getTodoState).
//
// Paridad visual con el TodoPanel nativo: header con count + indicador de
// actividad, glifos ○/◐/✓, activeForm entre paréntesis, dependencias (⛓ #id).
// Auto-hide: si no hay tareas visibles devuelve null → el reconciler envía
// tree:null → el webview no renderiza nada (equivalente al setWidget(undefined)
// de rpiv-todo cuando la lista está vacía).
//
// Tags intrinsic de frida-webview (fbox/ftext), tipados en src/frida-webview/index.ts.

import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { Task, TaskStatus } from "../todo/types";
import { getHiddenIds, getTodoState, subscribeTodoState } from "./store";

const GLYPH: Record<TaskStatus, string> = {
	pending: "○",
	in_progress: "◐",
	completed: "✓",
	deleted: "✗",
};

/** Factory del elemento raíz que monta la extensión vía fridaWebMount. */
export function createTodoWebPanelElement(): ReactElement {
	return <TodoWebPanel />;
}

function TodoWebPanel(): ReactElement | null {
	const state = useSyncExternalStore(subscribeTodoState, getTodoState);
	const hiddenIds = useSyncExternalStore(subscribeTodoState, getHiddenIds);
	// Tombstones (deleted) no se muestran; tampoco las completadas de turnos
	// anteriores (hiddenIds). Una tarea descompletada (vuelve a in_progress) se
	// muestra aunque esté en hiddenIds (status !== completed).
	const tasks = state.tasks.filter(
		(t) =>
			t.status !== "deleted" &&
			!(t.status === "completed" && hiddenIds.has(t.id)),
	);
	// Auto-hide: sin tareas → null → tree:null → el webview no pinta el panel.
	if (tasks.length === 0) return null;

	const completed = tasks.filter((t) => t.status === "completed").length;
	const hasActive = tasks.some(
		(t) => t.status === "in_progress" || t.status === "pending",
	);

	return (
		<fbox flexDirection="column" gap={2}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext>{hasActive ? "●" : "○"}</ftext>
				<ftext bold>Tareas</ftext>
				<ftext>
					({completed}/{tasks.length})
				</ftext>
			</fbox>
			<fbox flexDirection="column" gap={1}>
				{tasks.map((t) => (
					<TaskRow key={t.id} task={t} />
				))}
			</fbox>
		</fbox>
	);
}

function TaskRow({ task }: { task: Task }): ReactElement {
	return (
		<fbox flexDirection="row" gap={6} alignItems="center">
			<ftext>{GLYPH[task.status]}</ftext>
			<ftext>{task.subject}</ftext>
			{task.status === "in_progress" && task.activeForm ? (
				<ftext>({task.activeForm})</ftext>
			) : null}
			{task.blockedBy && task.blockedBy.length > 0 ? (
				<ftext>⛓ {task.blockedBy.map((id) => `#${id}`).join(",")}</ftext>
			) : null}
		</fbox>
	);
}
