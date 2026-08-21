// TodoWebPanel — panel persistente del tool `todo` en Remote React (ADR-0014).
// Reemplaza al panel nativo del webview (webview/components/TodoPanel.tsx) y al
// conducto post {type:"todos"}: se monta una vez (createTodoWeb, session_start)
// y se re-renderiza solo ante cada mutation del store reactivo vía
// useSyncExternalStore(subscribeTodoState, getTodoState).
//
// Propuesta 2: Tree View Compacto estilo VS Code Test Explorer / Explorer.
// Header con count e icono de checklist, ramas tipo árbol (├─ / └─), iconos
// nativos (circle-check verde, loader-circle ámbar con spin, circle gris),
// visualización de activeForm y dependencias (⛓ #id).
// Auto-hide: si no hay tareas visibles devuelve null → el reconciler envía
// tree:null → el webview no renderiza nada.
//
// Tags intrinsic de frida-webview (fbox/ftext/ficon/fbutton), tipados en src/frida-webview/index.ts.

import { useSyncExternalStore, useState } from "react";
import type { ReactElement } from "react";
import type { Task, TaskStatus } from "../todo/types";
import { getHiddenIds, getTodoState, subscribeTodoState } from "./store";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";

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
export function createTodoWebPanelElement(opts?: {
	/** #66: botón ↻ — replay desde la rama + follow-up de conciliación manual. */
	onRefresh?: () => void;
}): ReactElement {
	return <TodoWebPanel onRefresh={opts?.onRefresh} />;
}

function TodoWebPanel({
	onRefresh,
}: {
	onRefresh?: () => void;
}): ReactElement | null {
	const state = useSyncExternalStore(subscribeTodoState, getTodoState);
	const hiddenIds = useSyncExternalStore(subscribeTodoState, getHiddenIds);
	const [collapsed, setCollapsed] = useState(false);
	// Tombstones (deleted) no se muestran; tampoco las completadas de turnos
	// anteriores (hiddenIds). Una tarea descompletada (vuelve a in_progress) se
	// muestra aunque esté en hiddenIds (status !== completed).
	const tasks = state.tasks.filter(
		(t) =>
			t.status !== "deleted" && !(t.status === "completed" && hiddenIds.has(t.id)),
	);
	// Auto-hide: sin tareas → null → tree:null → el webview no pinta el panel.
	if (tasks.length === 0) return null;

	const completed = tasks.filter((t) => t.status === "completed").length;
	const activeTask = tasks.find((t) => t.status === "in_progress");
	const allDone = completed === tasks.length;
	// Mostrar #id en cada fila si hay más de 1 tarea o si alguna tiene dependencias (blockedBy)
	const showIds =
		tasks.length > 1 || tasks.some((t) => t.blockedBy && t.blockedBy.length > 0);

	return (
		<CollapsiblePanel
			collapsed={collapsed}
			onToggle={() => setCollapsed((c) => !c)}
			padding={6}
			header={
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon
						name="list-checks"
						size={13}
						color="var(--vscode-textLink-foreground, #4daafc)"
					/>
					<ftext bold>Tareas</ftext>
					<ftext color="var(--vscode-descriptionForeground)">
						({completed}/{tasks.length})
					</ftext>
					{collapsed && activeTask ? (
						<ftext color="var(--vscode-list-warningForeground, #cca700)">
							◐ {activeTask.activeForm || activeTask.subject}
						</ftext>
					) : collapsed && allDone ? (
						<ftext color="var(--vscode-testing-iconPassed, #73c991)">
							✓ Todas completadas
						</ftext>
					) : null}
					{/* #66: re-sincronizar — replay + conciliación manual */}
					{onRefresh ? (
						<fbutton variant="secondary" onClick={onRefresh}>
							<ficon name="rotate-cw" size={11} />
						</fbutton>
					) : null}
				</fbox>
			}
		>
			<fbox flexDirection="column" gap={2} cls="todo-tree-container">
				{tasks.map((t, i) => (
					<TaskRow
						key={t.id}
						task={t}
						showIds={showIds}
						isLast={i === tasks.length - 1}
					/>
				))}
			</fbox>
		</CollapsiblePanel>
	);
}

function TaskRow({
	task,
	showIds,
	isLast,
}: {
	task: Task;
	showIds: boolean;
	isLast: boolean;
}): ReactElement {
	const active = task.status === "in_progress";
	const done = task.status === "completed";
	const statusColor = STATUS_COLOR[task.status];
	const branchGuide = isLast ? "└─" : "├─";

	return (
		<fbox
			flexDirection="column"
			gap={1}
			cls={`todo-tree-row${active ? " is-active" : ""}`}
			tone={active ? "active" : "default"}
		>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext
					color="var(--vscode-tree-indentGuidesStroke, var(--vscode-descriptionForeground))"
					cls="todo-tree-branch"
				>
					{branchGuide}
				</ftext>
				{done ? (
					<ficon
						name="circle-check"
						size={12}
						color="var(--vscode-testing-iconPassed, #73c991)"
					/>
				) : active ? (
					<ficon
						name="loader-circle"
						size={12}
						color="var(--vscode-list-warningForeground, #cca700)"
						cls="spin"
					/>
				) : task.status === "deleted" ? (
					<ficon
						name="circle-x"
						size={12}
						color="var(--vscode-errorForeground, #f85149)"
					/>
				) : (
					<ficon
						name="circle"
						size={12}
						color="var(--vscode-descriptionForeground)"
					/>
				)}

				{showIds ? (
					<ftext color="var(--vscode-descriptionForeground)" size={11}>
						#{task.id}
					</ftext>
				) : null}

				<ftext bold={active} color={statusColor} strike={done}>
					{task.subject}
				</ftext>

				{active && task.activeForm ? (
					<ftext color="var(--vscode-descriptionForeground)" size={11}>
						({task.activeForm})
					</ftext>
				) : null}

				{task.blockedBy && task.blockedBy.length > 0 ? (
					<ftext
						color="var(--vscode-descriptionForeground)"
						size={10}
						cls="todo-deps"
					>
						(⛓ {task.blockedBy.map((id) => `#${id}`).join(",")})
					</ftext>
				) : null}
			</fbox>
		</fbox>
	);
}
