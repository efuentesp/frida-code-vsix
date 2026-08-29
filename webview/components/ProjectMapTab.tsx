import { useEffect, useState } from "react";
import type { OutMessage, State } from "../types";
import { Codicon } from "./Codicon";
import {
	FunctionalView,
	serializeFunctionalExport,
} from "./project-map/FunctionalView";
import {
	TechnicalView,
	serializeTechnicalExport,
} from "./project-map/TechnicalView";

// M2 (#143) — tab "Mapa del proyecto". Contrato {state, post} de los tabs del
// SettingsHub; la carga vive en el componente (molde ProductivityTab.tsx:44-47)
// y la verdad del estado en el host (#111 — busySince) publicada por push
// project_map_state. El cuerpo ready delega a FunctionalView (grafo SVG por
// columnas + evidencia); conmutador Funcional/Técnica — la vista Técnica
// delega a TechnicalView (pi-lens) y su carga dispara el MISMO mensaje
// project_map con view:"technical" (el efecto de [view] re-dispara al
// conmutar). La vista activa y el plegado (open) siguen siendo estado
// LOCAL del componente — NO campos del store global (análogo period/scope de
// ProductivityTab.tsx:37-38).

export function ProjectMapTab({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	// La vista activa es estado LOCAL (análogo period/scope de
	// ProductivityTab.tsx:37-38) — NO campo del store global.
	const [view, setView] = useState<"functional" | "technical">("functional");
	// FR-3: colapsado por defecto — solo los journeys abiertos renderizan su
	// grafo (render condicional real, molde TreePanel.visibleIds).
	const [open, setOpen] = useState<Set<string>>(new Set());
	const fn = state.projectMap?.functional;
	const tech = state.projectMap?.technical;
	// Spinner solo de la vista activa (busy del host #111).
	const busy = state.projectMap?.busy === view;
	const shots = state.projectMap?.shots ?? {};
	// ══ Fase 4: cruce técnico↔funcional (matriz M9) — se pasa a ambas vistas ══
	const cross = state.projectMap?.cross;

	// FR-10: carga al abrir + refresh manual (re-enviar el mismo mensaje). El
	// switch de vista también dispara la carga de esa vista (mismo efecto);
	// en Técnica se conserva el límite elegido (10/25/50) al re-disparar.
	useEffect(() => {
		post({
			type: "project_map",
			view,
			limit:
				view === "technical" && tech?.status === "ready" ? tech.limit : undefined,
		});
	}, [view]); // eslint-disable-line react-hooks/exhaustive-deps

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

	// ══ Fase 5 (FR-9): export HTML autónomo de la vista ACTIVA — la webview
	// serializa el layout (journeys abiertos/columnas/shots cacheados), el host
	// ensambla + inlina los PNGs faltantes. Solo con vista lista. ══
	const exportable =
		view === "functional" ? fn?.status === "ready" : tech?.status === "ready";
	const doExport = (): void => {
		if (view === "functional" && fn?.status === "ready") {
			post({
				type: "export_map",
				payload: serializeFunctionalExport(fn.data, open, shots, cross),
			});
		} else if (view === "technical" && tech?.status === "ready") {
			post({
				type: "export_map",
				payload: serializeTechnicalExport(tech, cross),
			});
		}
	};

	return (
		<div className="pm-tab">
			<div className="pm-head">
				<div className="seg-toggle">
					<button
						type="button"
						className={"seg" + (view === "functional" ? " active" : "")}
						onClick={() => setView("functional")}
					>
						Funcional
					</button>
					<button
						type="button"
						className={"seg" + (view === "technical" ? " active" : "")}
						onClick={() => setView("technical")}
					>
						Técnica
					</button>
				</div>
				<button
					type="button"
					className="pc-save"
					disabled={busy}
					onClick={() =>
						post({
							type: "project_map",
							view,
							limit:
								view === "technical" && tech?.status === "ready"
									? tech.limit
									: undefined,
						})
					}
				>
					<Codicon name="refresh" size={13} spin={busy} />
					<span>{busy ? "Cargando…" : "Recargar"}</span>
				</button>
				{/* ══ Fase 5: export HTML autónomo (.pc-save primario, codicon export) ══ */}
				<button
					type="button"
					className="pc-save"
					disabled={!exportable}
					onClick={doExport}
					title="Exportar la vista actual como HTML autónomo"
				>
					<Codicon name="export" size={13} />
					<span>Exportar</span>
				</button>
			</div>

			{view === "functional" ? (
				!fn || fn.status === "loading" ? (
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
						cross={cross}
					/>
				)
			) : (
				<TechnicalView tech={tech} busy={busy} post={post} cross={cross} />
			)}
		</div>
	);
}
