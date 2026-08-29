import { useEffect, useState } from "react";
import type { OutMessage, State } from "../types";
import { Codicon } from "./Codicon";

// M2 (#143) — tab "Mapa del proyecto". Contrato {state, post} de los tabs del
// SettingsHub; la carga vive en el componente (molde ProductivityTab.tsx:44-47)
// y la verdad del estado en el host (#111 — busySince) publicada por push
// project_map_state. Fase 1: "lista honesta" — journeys colapsados por
// defecto; al expandir, chips de pantallas. El plegado (open) sigue siendo
// estado LOCAL del componente — NO campo del store global (análogo
// period/scope de ProductivityTab.tsx:37-38).

const STOP_REASON: Record<string, string> = {
	budget: "tope de pantallas",
	time: "tiempo",
	stepLimit: "límite de pasos",
};

export function ProjectMapTab({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	// FR-3: colapsado por defecto — solo los journeys abiertos muestran sus
	// pantallas (render condicional real, molde TreePanel.visibleIds).
	const [open, setOpen] = useState<Set<string>>(new Set());
	const fn = state.projectMap?.functional;
	// Spinner del host (#111).
	const busy = state.projectMap?.busy === "functional";
	const data = fn?.status === "ready" ? fn.data : null;
	const stop = data?.stoppedBy ?? "";
	const partial = !!data && stop !== "" && stop !== "done";
	const allOpen =
		!!data &&
		data.journeys.length > 0 &&
		data.journeys.every((j) => open.has(j.id));
	const byId = new Map((data?.screens ?? []).map((s) => [s.id, s]));

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
			) : data ? (
				<>
					<div className="pm-meta">
						<span>
							{data.journeys.length}{" "}
							{data.journeys.length === 1 ? "journey" : "journeys"}
						</span>
						<span className="pm-dot">·</span>
						<span>
							{data.screens.length}{" "}
							{data.screens.length === 1 ? "pantalla" : "pantallas"}
						</span>
						{data.journeys.length > 0 && (
							<button
								type="button"
								className="pm-expand-all"
								onClick={() => toggleAll(!allOpen)}
							>
								{allOpen ? "Colapsar todo" : "Mostrar todo"}
							</button>
						)}
						{partial && (
							<span
								className="pm-badge partial"
								title="La corrida de M8 se detuvo antes de recorrer todo — la pantalla que rebasó el corte no se registró"
							>
								cobertura parcial: {STOP_REASON[stop] ?? stop}
							</span>
						)}
					</div>
					{data.runUrl && <div className="pm-meta">Recorrido de {data.runUrl}</div>}
					{data.journeys.length === 0 ? (
						<div className="cfg-stub">
							Sin journeys derivables del actionLog
							{data.screens.length > 0
								? ` — ${data.screens.length} pantalla(s) registradas sin navegación registrada`
								: ""}
							.
						</div>
					) : (
						data.journeys.map((j) => {
							const isOpen = open.has(j.id);
							return (
								<div key={j.id} className="pm-journey">
									<button
										type="button"
										className="pm-journey-head"
										onClick={() => toggleOpen(j.id)}
										aria-expanded={isOpen}
									>
										<Codicon name={isOpen ? "chevron-down" : "chevron-right"} size={12} />
										<span className="pm-journey-title">
											{j.id} · {j.screenIds[0]} → {j.screenIds[j.screenIds.length - 1]}
										</span>
										<span className="pm-journey-count">
											{j.screenIds.length} pantallas · {j.edges.length} aristas
										</span>
									</button>
									{isOpen && (
										<div className="pm-journey-body">
											{j.screenIds.map((sid) => {
												const s = byId.get(sid);
												return (
													<span key={sid} className="pm-screen-chip">
														{sid} {s?.title ?? sid}
													</span>
												);
											})}
										</div>
									)}
								</div>
							);
						})
					)}
					{data.orphans.length > 0 && (
						<div className="pm-orphan-note">
							<Codicon name="warning" size={12} />
							<span>
								{data.orphans.length} screenId(s) del actionLog sin pantalla registrada
								({data.orphans.join(", ")}) — se excluyeron del mapa.
							</span>
						</div>
					)}
				</>
			) : null}
		</div>
	);
}
