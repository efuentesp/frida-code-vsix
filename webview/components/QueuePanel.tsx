// QueuePanel — panel de cola de mensajes encolados (issue #45).
//
// Gestión completa mientras el agente ejecuta (paridad con alt+up de la TUI de
// pi): ver el texto completo, quitar, editar (devuelve al composer; al enviar
// se reencola al final) y reordenar (↑/↓). Auto-oculto cuando la cola está
// vacía. Patrón visual de LensDiagnostics (header clicable + chevron).
//
// Refleja el estado publicado por el host (post {type:"queued", items}) — las
// acciones viajan como queue_remove / queue_edit / queue_move y el store del
// host (src/queue/pending-queue.ts) sincroniza las colas del SDK.
//
// Refs #45.

import { useState } from "react";
import type { QueueItem } from "../types";
import { Icon } from "./Icon";

export function QueuePanel({
	items,
	onRemove,
	onEdit,
	onMove,
}: {
	items: QueueItem[];
	onRemove: (id: string) => void;
	onEdit: (id: string) => void;
	onMove: (id: string, dir: -1 | 1) => void;
}) {
	const [open, setOpen] = useState(true);
	if (items.length === 0) return null;

	return (
		<div className="queue-panel">
			<button
				type="button"
				className="queue-head"
				onClick={() => setOpen((v) => !v)}
				title={open ? "Contraer" : "Expandir"}
			>
				<span className="queue-head-label">Cola de mensajes</span>
				<span className="queue-count">({items.length})</span>
				<span className={"queue-caret" + (open ? "" : " closed")}>
					<Icon name="chevron" size={12} />
				</span>
			</button>
			{open && (
				<ul className="queue-list">
					{items.map((q, i) => (
						<li key={q.id} className="queue-item">
							<span className="queue-pos">{i + 1}</span>
							<span className="queue-text" title={q.text}>
								{q.text}
							</span>
							{q.mode === "followUp" && (
								<span
									className="queue-tag"
									title="Se entrega como follow-up tras el turno en curso"
								>
									follow-up
								</span>
							)}
							<span className="queue-actions">
								<button
									type="button"
									title="Subir (se entrega antes)"
									disabled={i === 0}
									onClick={() => onMove(q.id, -1)}
								>
									<Icon name="up" size={12} />
								</button>
								<button
									type="button"
									title="Bajar (se entrega después)"
									disabled={i === items.length - 1}
									onClick={() => onMove(q.id, 1)}
								>
									<Icon name="down" size={12} />
								</button>
								<button
									type="button"
									title="Editar: vuelve al composer; al enviar se reencola al final"
									onClick={() => onEdit(q.id)}
								>
									<Icon name="edit" size={12} />
								</button>
								<button
									type="button"
									title="Quitar de la cola (no se entrega)"
									onClick={() => onRemove(q.id)}
								>
									<Icon name="x" size={12} />
								</button>
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
