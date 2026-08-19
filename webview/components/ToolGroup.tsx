// ToolGroup — grupo colapsable de tools del turno completado (Fase 3 P1).
// Espejo del completed-response-disclosure de VS Code: summary pill
// «N herramientas · Σdur · Σtok» + guía vertical (border-left con gradiente
// que se desvanece al final) que contiene las filas planas.
// Colapsado por defecto [layout AUTORIZADO 2026-08-19]; el toggle del usuario
// persiste por turno (WeakMap, patrón ChatSimpleToolProgressPart de VS Code).
// La cronología la arma Turn.tsx: este componente sólo pinta [inicio, fin].

import { useState, type ReactNode } from "react";
import { Codicon } from "./Codicon";

interface ToolGroupProps {
	/** Summary tabular: "3 herramientas · 2.1s · 1.2k tok". */
	summary: string;
	/** Clave de memoria del toggle (id del turno + índice de corrida). */
	memKey: object;
	children: ReactNode;
}

/** Memoria del toggle manual del usuario por corrida (WeakMap turno→abierto). */
const expandedByRun = new WeakMap<object, boolean>();

export function ToolGroup({ summary, memKey, children }: ToolGroupProps) {
	const [open, setOpen] = useState(expandedByRun.get(memKey) ?? false);

	function toggle() {
		const next = !open;
		expandedByRun.set(memKey, next);
		setOpen(next);
	}

	return (
		<div className={"tool-group" + (open ? " open" : " collapsed")}>
			<button
				type="button"
				className="tool-group-summary"
				onClick={toggle}
				aria-expanded={open}
			>
				<Codicon name="chevron-right" size={13} />
				<span className="tg-count">{summary}</span>
			</button>
			<div className="tool-group-rail">
				{open ? children : null}
			</div>
		</div>
	);
}
