// TodoWebPanel — panel persistente del tool `todo` en Remote React (ADR-0014).
// Reemplaza al panel nativo del webview (webview/components/TodoPanel.tsx) y al
// conducto post {type:"todos"}: se monta una vez (createTodoWeb, session_start)
// y se re-renderiza solo ante cada mutation del store reactivo vía
// useSyncExternalStore(subscribeTodoState, getTodoState).
//
// Paridad visual con el TodoPanel nativo: header con count + indicador de
// actividad, glifos ○/◐/✓, activeForm entre paréntesis en su propia línea (debajo del subject), dependencias (⛓ #id).
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

// Color por estado (paleta temática VS Code):
//   - pending: undefined → color por defecto (texto normal, legible).
//   - in_progress: ámbar (color principal) → destaca como la tarea activa.
//   - completed: descriptionForeground (tono muteado) + tachado (strike).
const STATUS_COLOR: Partial<Record<TaskStatus, string>> = {
	in_progress: "var(--vscode-list-warningForeground, #cca700)",
	completed: "var(--vscode-descriptionForeground)",
	deleted: "var(--vscode-gitDecoration-deletedResourceForeground, #f85149)",
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
	// Mostrar #id en cada fila sólo si alguna tarea tiene dependencias (blockedBy),
	// para anclar las referencias ⛓ #N (paridad con rpiv-todo selectShowTaskIds).
	const showIds = tasks.some((t) => t.blockedBy && t.blockedBy.length > 0);

	return (
		<fbox flexDirection="column" padding={6}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext>{hasActive ? "●" : "○"}</ftext>
				<ftext bold>Todos</ftext>
				<ftext>
					({completed}/{tasks.length})
				</ftext>
			</fbox>
			<fbox flexDirection="column" gap={4} cls="todo-rows">
				{tasks.map((t) => (
					<TaskRow key={t.id} task={t} showIds={showIds} />
				))}
			</fbox>
		</fbox>
	);
}

function TaskRow({
	task,
	showIds,
}: {
	task: Task;
	showIds: boolean;
}): ReactElement {
	const active = task.status === "in_progress";
	const done = task.status === "completed";
	const statusColor = STATUS_COLOR[task.status];
	// El activeForm (present-continuous, p.ej. "Formulando preguntas…") va en su
	// propia línea debajo del subject, indentada (padding-left) para leerse como
	// sub-línea. Antes compartía fila con el subject y se desalineaba en ventanas
	// angostas; el indent CSS es robusto sin importar fuente/zoom/ancho.
	const showActiveForm = active && !!task.activeForm;
	return (
		<fbox flexDirection="column" gap={2} tone={active ? "active" : "default"}>
			{/* Línea 1: glyph + (#id) + subject + (deps). Sin caracteres de rama: la
			    guía vertical la dibuja el contenedor .todo-rows (border-left CSS). */}
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext color={statusColor}>{GLYPH[task.status]}</ftext>
				{showIds ? (
					<ftext color="var(--vscode-descriptionForeground)">#{task.id}</ftext>
				) : null}
				<ftext bold={active} color={statusColor} strike={done}>
					{task.subject}
				</ftext>
				{task.blockedBy && task.blockedBy.length > 0 ? (
					<ftext>⛓ {task.blockedBy.map((id) => `#${id}`).join(",")}</ftext>
				) : null}
			</fbox>
			{/* Línea 2 (sólo en progreso con activeForm): sub-línea muteada, indentada
			    bajo el glyph vía .todo-activeform (padding-left). */}
			{showActiveForm ? (
				<fbox
					cls="todo-activeform"
					flexDirection="row"
					gap={6}
					alignItems="center"
				>
					<ftext color="var(--vscode-descriptionForeground)" size={12} wrap>
						({task.activeForm})
					</ftext>
				</fbox>
			) : null}
		</fbox>
	);
}
