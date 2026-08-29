import { useEffect, useRef } from "react";
import type {
	OutMessage,
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

export function FunctionalView({
	data,
	loadedAt,
	shots,
	open,
	onToggle,
	onToggleAll,
	post,
}: {
	data: PmFunctionalData;
	loadedAt: number;
	shots: Record<string, string>;
	open: Set<string>;
	onToggle: (id: string) => void;
	onToggleAll: (all: boolean) => void;
	post: (m: OutMessage) => void;
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
