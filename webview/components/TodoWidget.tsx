import { useRef, useState } from "react";
import { Codicon } from "./Codicon";
import type { TodoSnapshot } from "../todo-state";

/**
 * Widget persistente de tareas (F5 P2, §5.4 — layout AUTORIZADO 2026-08-19):
 * primer miembro del input-stack mientras haya tareas. Colapsado muestra la
 * tarea en curso con dot azul pulsante; expandido, la lista completa. La
 * memoria del toggle es por widget (sesión): si el usuario lo abrió, no se
 * re-colapsa solo al llegar una mutación (patrón WeakMap de ToolGroup).
 */
export function TodoWidget({ snap }: { snap: TodoSnapshot }) {
	// memoria manual del usuario: null = aún no interviene (colapsado default)
	const manualRef = useRef<boolean | null>(null);
	const [open, setOpen] = useState(false);
	const effectiveOpen = manualRef.current ?? open;

	function toggle() {
		const next = !effectiveOpen;
		manualRef.current = next;
		setOpen(next);
	}

	return (
		<div className={"todo-widget" + (effectiveOpen ? " open" : "")}>
			<button
				type="button"
				className="todo-head"
				onClick={toggle}
				aria-expanded={effectiveOpen}
			>
				<span
					className={"todo-dot" + (snap.anyRunning ? " run" : "")}
					aria-hidden="true"
				/>
				<span className="todo-current" title={snap.current}>
					{effectiveOpen ? `Tareas (${snap.done}/${snap.total})` : snap.current}
					{effectiveOpen ? "" : ` (${snap.done}/${snap.total})`}
				</span>
				<span className={"todo-chev" + (effectiveOpen ? " open" : "")}>
					<Codicon name="chevron-right" size={12} />
				</span>
			</button>
			{effectiveOpen ? (
				<ul className="todo-list">
					{snap.tasks.map((t) => (
						<li key={t.id} className={"todo-item " + t.status}>
							<span className="todo-item-mark" aria-hidden="true">
								{t.status === "completed" ? (
									<Codicon name="check" size={11} />
								) : t.status === "in_progress" ? (
									<span className="todo-dot run" />
								) : (
									<span className="todo-dot" />
								)}
							</span>
							<span className="todo-item-subject">{t.subject}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
