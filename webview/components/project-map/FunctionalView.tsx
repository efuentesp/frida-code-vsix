import { useEffect, useRef } from "react";
import type {
	OutMessage,
	PmCrossData,
	PmCrossState,
	PmExportPayload,
	PmExportSection,
	PmFunctionalData,
	PmJourney,
	PmScreen,
} from "../../types";
import { Codicon } from "../Codicon";
import { GraphCanvas, type GraphColumn, type GraphEdge } from "./GraphCanvas";

// M2 (#143) — vista Funcional (slice 2): journey expandido → sus pantallas
// como COLUMNAS del grafo en fila horizontal (fiel al Desired End State del
// diseño: P01 ──▶ P02 ──▶ P03 con scroll-x en panel angosto); colapsado por
// defecto = la columna no se renderiza (molde TreePanel.visibleIds). Los
// attempted-failed NO se dibujan como aristas (to=""): se listan bajo el
// grafo (legibles en panel angosto, evita geometría frágil de self-loops).
//
// Screenshots data-URI on-demand: al abrir un journey se piden SOLO los PNGs
// de sus pantallas (decisión de design — base64 infla +33%, jamás el set
// completo). El ref deduplica pedidos; dataUri "" = "sin captura" definitivo
// (sin retry infinito). Clic en nodo → open_file con la evidencia primaria
// (screenshot > snapshot; el host resuelve texto vs binario).

const STOP_REASON: Record<string, string> = {
	budget: "tope de pantallas",
	time: "tiempo",
	stepLimit: "límite de pasos",
};

const CAUSE_LABEL: Record<string, string> = {
	"shell-error": "error de comando",
	"app-validation": "validación de app",
	"no-progression": "sin progresión",
};

function columnsOf(
	j: PmJourney,
	screens: PmScreen[],
	shots: Record<string, string>,
): { columns: GraphColumn[]; edges: GraphEdge[] } {
	const byId = new Map(screens.map((s) => [s.id, s]));
	return {
		// Una columna por pantalla (orden de primera visita DENTRO del journey).
		columns: j.screenIds.map((sid) => {
			const s = byId.get(sid);
			const shot = shots[sid];
			return {
				id: sid,
				nodes: [
					{
						id: sid,
						title: s?.title ?? sid,
						// undefined = aún sin respuesta; "" = respondido sin captura
						preview: s?.screenshot ? shot : undefined,
						previewPending: !!s?.screenshot && shot === undefined,
					},
				],
			};
		}),
		edges: j.edges
			.filter((e) => e.type === "traversed")
			.map((e) => ({
				from: e.from,
				to: e.to,
				label: `#${e.step} ${e.kind}: ${e.description}`,
			})),
	};
}

/** ══ Fase 4: filas de cruce del journey — solo pantallas con módulos
 *  (sin ruido para journeys sin cruce). */
function crossOfJourney(
	j: PmJourney,
	cross: PmCrossData,
): { sid: string; links: { entryId: string; module: string }[] }[] {
	return j.screenIds
		.filter((sid) => (cross.byScreen[sid] ?? []).length > 0)
		.map((sid) => ({ sid, links: cross.byScreen[sid] }));
}

export function FunctionalView({
	data,
	loadedAt,
	shots,
	open,
	onToggle,
	onToggleAll,
	post,
	cross,
}: {
	data: PmFunctionalData;
	loadedAt: number;
	shots: Record<string, string>;
	open: Set<string>;
	onToggle: (id: string) => void;
	onToggleAll: (all: boolean) => void;
	post: (m: OutMessage) => void;
	/** ══ Fase 4: cruce técnico↔funcional (matriz M9) — opcional para no
	 *  romper consumers sin cruce (tests de las fases previas). */
	cross?: PmCrossState;
}) {
	const requested = useRef<Set<string>>(new Set());

	// Nueva corrida del mapa (loadedAt cambió) → los PNGs pueden ser otros:
	// reset de dedup para re-pedir on-demand.
	// (fix del triage Step 5: loadedAt viaja como prop — PmFunctionalData no lo
	//  lleva; vive en la variante ready de PmFunctionalState)
	useEffect(() => {
		requested.current.clear();
	}, [loadedAt]);

	// On-demand: pide UNA vez cada screenshot de los journeys ABIERTOS.
	useEffect(() => {
		const byId = new Map(data.screens.map((s) => [s.id, s]));
		for (const j of data.journeys) {
			if (!open.has(j.id)) continue;
			for (const sid of j.screenIds) {
				const s = byId.get(sid);
				if (!s?.screenshot) continue;
				if (requested.current.has(sid)) continue;
				if (shots[sid] !== undefined) continue;
				requested.current.add(sid);
				post({ type: "project_map_shot", screenId: sid });
			}
		}
	}, [open, data, shots, post]);

	const stop = data.stoppedBy;
	const partial = stop !== "" && stop !== "done";
	const edgeCount = data.journeys.reduce((acc, j) => acc + j.edges.length, 0);
	const allOpen =
		data.journeys.length > 0 && data.journeys.every((j) => open.has(j.id));

	const evidenceOf = (sid: string): string => {
		const s = data.screens.find((x) => x.id === sid);
		if (!s) return "";
		return s.screenshot || s.snapshot || "";
	};

	return (
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
				<span className="pm-dot">·</span>
				<span>{edgeCount} aristas</span>
				{data.journeys.length > 0 && (
					<button
						type="button"
						className="pm-expand-all"
						onClick={() => onToggleAll(!allOpen)}
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
			{/* ══ Fase 4: notas del cruce (FR-7 omisión + matriz stale) ══ */}
			{cross?.status === "omitted" && (
				<div className="pm-note pm-cross-note">
					<Codicon name="link" size={11} />
					<span>{cross.hint}</span>
				</div>
			)}
			{cross?.status === "ready" && cross.data.danglingScreens.length > 0 && (
				<div className="pm-note pm-cross-note">
					<Codicon name="warning" size={11} />
					<span>
						La matriz M9 cita {cross.data.danglingScreens.length} pantalla(s) no
						registrada(s) en M8 ({cross.data.danglingScreens.join(", ")}) —
						regenera M9 tras la corrida de M8.
					</span>
				</div>
			)}
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
					const fails = j.edges.filter((e) => e.type === "attempted-failed");
					const { columns, edges } = columnsOf(j, data.screens, shots);
					return (
						<div key={j.id} className="pm-journey">
							<button
								type="button"
								className="pm-journey-head"
								onClick={() => onToggle(j.id)}
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
									<GraphCanvas
										columns={columns}
										edges={edges}
										ariaLabel={`Grafo del journey ${j.id}`}
										onNodeClick={(sid) => {
											const file = evidenceOf(sid);
											if (file) post({ type: "open_file", file });
										}}
									/>
									{fails.length > 0 && (
										<div className="pm-fails">
											{fails.map((e) => (
											<div key={e.step} className="pm-fail-row" title={e.detail}>
												<Codicon name="warning" size={11} />
												<span>
													#{e.step} {e.description || e.kind} —{" "}
													{CAUSE_LABEL[e.cause ?? ""] ?? e.cause ?? "fallo"}
												</span>
											</div>
										))}
									</div>
								)}
								{/* ══ Fase 4: chips de módulo (open_file) para las pantallas del
								    journey con cruce M9 ══ */}
								{cross?.status === "ready" &&
									crossOfJourney(j, cross.data).length > 0 && (
										<div className="pm-cross">
											{crossOfJourney(j, cross.data).map(({ sid, links }) => (
												<div key={sid} className="pm-cross-row">
													<span className="pm-cross-screen">{sid}</span>
													<span>→</span>
													{links.map((l) => (
														<button
															key={l.entryId + l.module}
															type="button"
															className="pm-cross-chip"
															title={`implementa ${sid} (${l.entryId})`}
															onClick={() =>
																post({ type: "open_file", file: l.module })
															}
														>
															{l.module}
														</button>
													))}
												</div>
											))}
										</div>
									)}
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
						{data.orphans.length} screenId(s) del actionLog sin pantalla registrada (
						{data.orphans.join(", ")}) — se excluyeron del mapa.
					</span>
				</div>
			)}
		</>
	);
}

// ══ Fase 5 (FR-9): serializa la vista Funcional para el export HTML.
// Reusa columnsOf (mismas columnas/aristas que el grafo en pantalla) y el
// criterio de shots del on-demand: solo pantallas CON screenshot path piden
// resolución al host (shot undefined); "" = sin captura definitiva. Los fails
// y el cruce viajan como notas de texto (el HTML autónomo no tiene clic). ══
export function serializeFunctionalExport(
	data: PmFunctionalData,
	open: Set<string>,
	shots: Record<string, string>,
	cross?: PmCrossState,
): PmExportPayload {
	const byId = new Map(data.screens.map((s) => [s.id, s]));
	const edgeCount = data.journeys.reduce((acc, j) => acc + j.edges.length, 0);
	const stop = data.stoppedBy;
	const sections: PmExportSection[] = data.journeys.map((j) => {
		const { columns, edges } = columnsOf(j, data.screens, shots);
		const fails = j.edges.filter((e) => e.type === "attempted-failed");
		return {
			id: j.id,
			title: `${j.id} · ${j.screenIds[0]} → ${j.screenIds[j.screenIds.length - 1]} (${j.screenIds.length} pantallas · ${j.edges.length} aristas)`,
			open: open.has(j.id),
			columns: columns.map((c) => {
				const s = byId.get(c.id);
				return {
					id: c.id,
					nodes: c.nodes.map((n) => ({
						id: n.id,
						title: n.title,
						screenId: s?.screenshot ? n.id : undefined,
						shot: s?.screenshot ? shots[n.id] : undefined,
					})),
				};
			}),
			edges,
			notes: fails.map(
				(e) =>
					`#${e.step} ${e.description || e.kind} — ${CAUSE_LABEL[e.cause ?? ""] ?? e.cause ?? "fallo"}`,
			),
		};
	});
	const notes: string[] = [];
	if (data.orphans.length > 0) {
		notes.push(
			`${data.orphans.length} screenId(s) del actionLog sin pantalla registrada (${data.orphans.join(", ")}) — se excluyeron del mapa`,
		);
	}
	if (cross?.status === "ready" && cross.data.danglingScreens.length > 0) {
		notes.push(
			`la matriz M9 cita ${cross.data.danglingScreens.length} pantalla(s) no registrada(s) en M8 (${cross.data.danglingScreens.join(", ")}) — regenera M9 tras la corrida de M8`,
		);
	}
	return {
		view: "functional",
		generatedAt: new Date().toISOString(),
		title: "Mapa funcional",
		meta: [
			`${data.journeys.length} journeys · ${data.screens.length} pantallas · ${edgeCount} aristas`,
			stop !== "" && stop !== "done"
				? `cobertura parcial: ${STOP_REASON[stop] ?? stop}`
				: "",
			data.runUrl ? `recorrido de ${data.runUrl}` : "",
		].filter(Boolean),
		sections,
		notes,
	};
}
