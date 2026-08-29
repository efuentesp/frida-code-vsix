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

	// Badge del header cuando está colapsado (sin ternarias anidadas ni glyphos).
	let collapsedBadge: ReactElement | null = null;
	if (collapsed && activeTask) {
		collapsedBadge = (
			<fbox flexDirection="row" gap={4} alignItems="center">
				<ficon
					name="loader-circle"
					size={11}
					color="var(--vscode-list-warningForeground, #cca700)"
					cls="spin"
				/>
				<ftext color="var(--vscode-list-warningForeground, #cca700)" size={11}>
					{activeTask.activeForm || activeTask.subject}
				</ftext>
			</fbox>
		);
	} else if (collapsed && allDone) {
		collapsedBadge = (
			<fbox flexDirection="row" gap={4} alignItems="center">
				<ficon
					name="check"
					size={11}
					color="var(--vscode-testing-iconPassed, #73c991)"
				/>
				<ftext color="var(--vscode-testing-iconPassed, #73c991)" size={11}>
					Todas completadas
				</ftext>
			</fbox>
		);
	}

	// #66 + UI/UX: botón de re-sincronización en el slot `actions` — justificado a
	// la derecha y FUERA de la zona clicable del header (mismo patrón del pin del
	// WorkflowPanel, #84). Icono `sync` (canónico de VS Code para "Synchronize
	// Changes") en variante ghost: transparente, sólo se percibe al hover.
	const syncAction = onRefresh ? (
		<fbutton
			variant="ghost"
			title="Resincronizar tareas con el estado interno (replay + conciliación)"
			onClick={onRefresh}
		>
			<ficon
				name="sync"
				size={13}
				color="var(--vscode-descriptionForeground, #8b949e)"
			/>
		</fbutton>
	) : null;

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
					{collapsedBadge}
				</fbox>
			}
			actions={syncAction}
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
}: {
	task: Task;
	showIds: boolean;
	isLast: boolean;
}): ReactElement {
	const active = task.status === "in_progress";
	const done = task.status === "completed";
	const statusColor = STATUS_COLOR[task.status];

	return (
		<fbox
			flexDirection="column"
			gap={1}
			cls={`todo-tree-row${active ? " is-active" : ""}`}
			tone={active ? "active" : "default"}
			paddingLeft={6}
		>
			<fbox flexDirection="row" gap={6} alignItems="center">
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
					<fbox cls="ui-chip subtle">
						<ftext color="var(--vscode-descriptionForeground)" size={10}>
							#{task.id}
						</ftext>
					</fbox>
				) : null}

				<ftext bold={active} color={statusColor} strike={done} size={12}>
					{task.subject}
				</ftext>

				{active && task.activeForm ? (
					<ftext color="var(--vscode-descriptionForeground)" size={11}>
						({task.activeForm})
					</ftext>
				) : null}

				{task.blockedBy && task.blockedBy.length > 0 ? (
					<fbox cls="ui-chip subtle" flexDirection="row" gap={3} alignItems="center">
						<ficon
							name="link"
							size={10}
							color="var(--vscode-descriptionForeground)"
						/>
						<ftext
							color="var(--vscode-descriptionForeground)"
							size={10}
							cls="todo-deps"
						>
							{task.blockedBy.map((id) => `#${id}`).join(", ")}
						</ftext>
					</fbox>
				) : null}
			</fbox>
		</fbox>
	);
}
