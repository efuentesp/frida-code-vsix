import { useEffect, useState } from "react";
import type { OutMessage, State } from "../types";
import { Codicon } from "./Codicon";
import { FunctionalView } from "./project-map/FunctionalView";

// M2 (#143) — tab "Mapa del proyecto" (Fase 2): el cuerpo ready delega a
// FunctionalView (grafo SVG por columnas + evidencia) — la lista honesta de
// chips de la Fase 1 se retira. El conmutador Funcional/Técnica llega en la
// Fase 3 y el botón Exportar en la Fase 5. Contrato {state, post}; la carga
// vive en el componente (molde ProductivityTab.tsx:44-47) y la verdad del
// estado en el host (#111 — busySince) publicada por push
// project_map_state. El plegado (open) sigue siendo estado LOCAL del
// componente — NO campo del store global (análogo period/scope de
// ProductivityTab.tsx:37-38).

export function ProjectMapTab({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	// FR-3: colapsado por defecto — solo los journeys abiertos renderizan su
	// grafo (render condicional real, molde TreePanel.visibleIds).
	const [open, setOpen] = useState<Set<string>>(new Set());
	const fn = state.projectMap?.functional;
	// Spinner del host (#111).
	const busy = state.projectMap?.busy === "functional";
	const shots = state.projectMap?.shots ?? {};

	// FR-10: carga al abrir + refresh manual (re-enviar el mismo mensaje).
	useEffect(() => {
		post({ type: "project_map", view: "functional" });
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const toggleOpen = (id: string): void => {
		setOpen((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleAll = (all: boolean): void => {
		if (!fn || fn.status !== "ready") return;
		setOpen(all ? new Set(fn.data.journeys.map((j) => j.id)) : new Set());
	};

	return (
		<div className="pm-tab">
			<div className="pm-head">
				<button
					type="button"
					className="pc-save"
					disabled={busy}
					onClick={() => post({ type: "project_map", view: "functional" })}
				>
					<Codicon name="refresh" size={13} spin={busy} />
					<span>{busy ? "Cargando…" : "Recargar"}</span>
				</button>
			</div>

			{!fn || fn.status === "loading" ? (
				<div className="cfg-stub">
					<Codicon name="loading" size={14} spin /> Cargando mapa funcional...
				</div>
			) : fn.status === "empty" || fn.status === "error" ? (
				<div className="cfg-stub pm-empty">
					<Codicon name={fn.status === "error" ? "warning" : "map"} size={16} />
					<span>{fn.hint}</span>
				</div>
			) : (
				<FunctionalView
					data={fn.data}
					loadedAt={fn.loadedAt}
					shots={shots}
					open={open}
					onToggle={toggleOpen}
					onToggleAll={toggleAll}
					post={post}
				/>
			)}
		</div>
	);
}
