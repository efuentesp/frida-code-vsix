import type {
	OutMessage,
	PmCrossState,
	PmExportPayload,
	PmExportSection,
	PmTechnicalState,
} from "../../types";
import { Codicon } from "../Codicon";
import { GraphCanvas, type GraphColumn, type GraphEdge } from "./GraphCanvas";

// M2 (#143) — vista Técnica (slice 3): mapa técnico de pi-lens (projectReport
// vía lens-engine.js, import dinámico host-side). Estructura fiel al Desired
// End State del diseño: grafo de subsystems (directorio = columna con UN nodo,
// aristas = subsystems.edges con conteo) + listas clicables de hubs /
// entryPoints + overlay de riesgo (tone:"danger" en directorios que hospedan
// hotspots) + deadWeight sutil (<details>) + trust header + toggle de límite
// 10/25/50 (re-pide con options.limit — clampea las secciones rankeadas).
//
// Estados FR-7 (sin spinner eterno #142): building = cache fría con re-poll
// automático del HOST (backoff 2s→5s→10s, intentos visibles n/10 — resuelve
// solo); disabled = size-skip permanente (hint verbatim, SIN re-poll, botón
// Reintentar para después de subir el tope); exhausted = re-poll agotado
// (hint verbatim + Reintentar); not-installed / error = hint accionable.
// Clic en archivo → open_file (paths cwd-relativos; el host rebasa siempre).

/** Tope de reintentos — espejo del host (TECH_POLL_DELAYS_MS.length en
 *  src/project-map/lens-project-report.ts; congelado por test de lib). */
const PM_TECH_MAX_ATTEMPTS = 10;

const LIMITS: readonly number[] = [10, 25, 50];

/** Directorios del grafo: rankeados por peso en edges, tope = límite elegido
 *  (subsystems.directories viene UNCAPPED upstream — cap visual local). */
function subsystemColumns(
	tech: Extract<PmTechnicalState, { status: "ready" }>,
): { columns: GraphColumn[]; edges: GraphEdge[] } {
	const { subsystems, riskHotspots } = tech.data;
	const weight = new Map<string, number>();
	for (const e of subsystems.edges) {
		weight.set(e.from, (weight.get(e.from) ?? 0) + e.count);
		weight.set(e.to, (weight.get(e.to) ?? 0) + e.count);
	}
	// Overlay de riesgo (FR-5): directorio danger si hospeda un hotspot. Los
	// clusters upstream son 1 segmento (o 2 si el top domina ≥40%) — aquí se
	// aproxima por prefijos: se marcan todos los ancestros del archivo.
	const dangerDirs = new Set<string>();
	for (const h of riskHotspots) {
		const segs = h.file.split("/").filter(Boolean);
		if (segs.length <= 1) {
			dangerDirs.add("(root)");
			continue;
		}
		for (let i = 1; i < segs.length; i++) {
			dangerDirs.add(segs.slice(0, i).join("/"));
		}
	}
	const dirs = [...subsystems.directories]
		.sort(
			(a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a.localeCompare(b),
		)
		.slice(0, tech.limit);
	const inGraph = new Set(dirs);
	return {
		columns: dirs.map((d) => ({
			id: d,
			title: d,
			nodes: [
				{
					id: d,
					title: d,
					tone: dangerDirs.has(d) ? ("danger" as const) : undefined,
				},
			],
		})),
		edges: subsystems.edges
			.filter((e) => inGraph.has(e.from) && inGraph.has(e.to))
			.map((e) => ({
				from: e.from,
				to: e.to,
				label: `${e.count} import(s): ${e.from} → ${e.to}`,
			})),
	};
}

export function TechnicalView({
	tech,
	busy,
	post,
	cross,
}: {
	tech: PmTechnicalState | undefined;
	busy: boolean;
	post: (m: OutMessage) => void;
	/** ══ Fase 4: cruce técnico↔funcional (matriz M9) — opcional para no
	 *  romper consumers sin cruce (tests de la fase anterior). */
	cross?: PmCrossState;
}) {
	const currentLimit = tech?.status === "ready" ? tech.limit : undefined;

	if (!tech || tech.status === "loading") {
		return (
			<div className="cfg-stub">
				<Codicon name="loading" size={14} spin /> Cargando mapa técnico...
			</div>
		);
	}

	if (tech.status === "building") {
		return (
			<div className="cfg-stub pm-empty">
				<Codicon name="loading" size={14} spin />
				<span>
					Construyendo mapa técnico… reintentando ({tech.attempts}/
					{PM_TECH_MAX_ATTEMPTS}) — resuelve solo.
				</span>
				<span className="pm-note">{tech.hint}</span>
			</div>
		);
	}

	if (tech.status === "empty") {
		return (
			<div className="cfg-stub pm-empty">
				<Codicon
					name={tech.reason === "not-installed" ? "package" : "warning"}
					size={16}
				/>
				<span>{tech.hint}</span>
				{tech.reason !== "not-installed" && tech.reason !== "error" && (
					<button
						type="button"
						className="pm-expand-all"
						disabled={busy}
						onClick={() =>
							post({
								type: "project_map",
								view: "technical",
								limit: currentLimit,
							})
						}
					>
						Reintentar
					</button>
				)}
			</div>
		);
	}

	const { columns, edges } = subsystemColumns(tech);
	const t = tech.data.trust;
	const sys = tech.data.subsystems;

	return (
		<>
			<div className="pm-meta">
				<span>
					Grafo: {t.graphBuiltAt || "—"} · cobertura {Math.round(t.coverage * 100)}%
					({t.filesCovered}/{t.filesTotal} archivos)
				</span>
				{t.stale && (
					<span className="pm-badge partial" title={t.notes.join(" · ")}>
						desactualizado
					</span>
				)}
				{t.lowCoverage && (
					<span className="pm-badge partial" title={t.notes.join(" · ")}>
						cobertura baja
					</span>
				)}
			</div>
			<div className="pm-head">
				<div className="seg-toggle">
					{LIMITS.map((n) => (
						<button
							key={n}
							type="button"
							className={"seg" + (tech.limit === n ? " active" : "")}
							disabled={busy}
							onClick={() =>
								post({ type: "project_map", view: "technical", limit: n })
							}
						>
							{n}
						</button>
					))}
				</div>
				<span className="pm-note">top N por sección</span>
			</div>
			{columns.length === 0 ? (
				<div className="cfg-stub">Sin subsystems derivables del grafo</div>
			) : (
				<GraphCanvas
					columns={columns}
					edges={edges}
					ariaLabel="Mapa de subsystems (directorios e imports)"
				/>
			)}
			{sys.cycles.length > 0 && (
				<div className="pm-note-list">
					{sys.cycles.slice(0, 5).map((c, i) => (
						<div key={i} className="pm-note">
							<Codicon name="sync" size={11} />
							<span>
								ciclo: {c.dirs.join(" ↔ ")} ({c.edgeCount} aristas)
							</span>
						</div>
					))}
				</div>
			)}
			{sys.violations.length > 0 && (
				<div className="pm-note-list">
					{sys.violations.slice(0, 5).map((v, i) => (
						<div key={i} className="pm-note">
							<Codicon name="arrow-swap" size={11} />
							<span>
								capa: {v.from} → {v.to} minoritario ({v.count} vs {v.dominantCount})
							</span>
						</div>
					))}
				</div>
			)}
			{/* ══ Fase 4: cruce funcional — pantallas cubiertas por directorio
			    (cap coherente con el límite del grafo) + módulos fuera ══ */}
			{cross?.status === "ready" &&
				Object.keys(cross.data.byDirectory).length > 0 && (
					<section className="pm-list">
						<h4 className="pm-list-title">
							<Codicon name="link" size={12} /> Cruce funcional (M9)
						</h4>
						{Object.entries(cross.data.byDirectory)
							.slice(0, tech.limit)
							.map(([dir, sids]) => (
								<div key={dir} className="pm-cross-dir">
									<span className="pm-row-main">{dir}</span>
									<span className="pm-row-meta">{sids.join(" · ")}</span>
								</div>
							))}
					</section>
				)}
			{cross?.status === "ready" && cross.data.unmatchedModules.length > 0 && (
				<div className="pm-note">
					<Codicon name="warning" size={11} />
					<span>
						{cross.data.unmatchedModules.length} módulo(s) de la matriz fuera de los
						subsystems del grafo.
					</span>
				</div>
			)}
			{tech.data.hubs.length > 0 && (
				<section className="pm-list">
					<h4 className="pm-list-title">
						<Codicon name="hubot" size={12} /> Hubs (fan-in)
					</h4>
					{tech.data.hubs.map((h) => (
						<button
							key={h.file}
							type="button"
							className="pm-row"
							title={h.role ? `roles: ${h.role}` : undefined}
							onClick={() => post({ type: "open_file", file: h.file })}
						>
							<span className="pm-row-main">{h.file}</span>
							<span className="pm-row-meta">
								fanIn {h.fanIn} · impacto {h.blastRadius}
							</span>
						</button>
					))}
				</section>
			)}
			{tech.data.entryPoints.length > 0 && (
				<section className="pm-list">
					<h4 className="pm-list-title">
						<Codicon name="play" size={12} /> Puntos de entrada
					</h4>
					{tech.data.entryPoints.map((p) => (
						<button
							key={p.file}
							type="button"
							className="pm-row"
							onClick={() => post({ type: "open_file", file: p.file })}
						>
							<span className="pm-row-main">{p.file}</span>
							<span className="pm-row-meta">fanOut {p.fanOut}</span>
						</button>
					))}
				</section>
			)}
			{tech.data.riskHotspots.length > 0 && (
				<section className="pm-list">
					<h4 className="pm-list-title">
						<Codicon name="flame" size={12} /> Riesgo (fanIn × complejidad)
					</h4>
					{tech.data.riskHotspots.map((h) => (
						<button
							key={h.file}
							type="button"
							className="pm-row is-danger"
							title={`score = fanIn ${h.fanIn} × complejidad máx ${h.maxComplexity}`}
							onClick={() => post({ type: "open_file", file: h.file })}
						>
							<span className="pm-row-main">{h.file}</span>
							<span className="pm-row-meta">score {h.score}</span>
						</button>
					))}
				</section>
			)}
			{tech.data.deadWeight.files.length > 0 && (
				<details className="pm-dead">
					<summary>
						<Codicon name="eye-closed" size={11} />
						<span>
							{tech.data.deadWeight.files.length} archivo(s) sin importadores conocidos
						</span>
					</summary>
					<div className="pm-note">{tech.data.deadWeight.disclaimer}</div>
					{tech.data.deadWeight.files.map((f) => (
						<button
							key={f.file}
							type="button"
							className="pm-row pm-row-dim"
							onClick={() => post({ type: "open_file", file: f.file })}
						>
							<span className="pm-row-main">{f.file}</span>
						</button>
					))}
				</details>
			)}
		</>
	);
}

// ══ Fase 5 (FR-9): serializa la vista Técnica para el export HTML.
// Sección de grafo (subsystems con overlay danger, reusa subsystemColumns) +
// secciones-lista como notas (hubs/puntos de entrada/riesgo/cruce) +
// deadWeight global. Sin shots: la vista Técnica no tiene capturas. ══
export function serializeTechnicalExport(
	tech: Extract<PmTechnicalState, { status: "ready" }>,
	cross?: PmCrossState,
): PmExportPayload {
	const { columns, edges } = subsystemColumns(tech);
	const t = tech.data.trust;
	const sys = tech.data.subsystems;
	const sections: PmExportSection[] = [
		{
			id: "subsystems",
			title: `Subsystems (top ${tech.limit} por peso de imports)`,
			open: true,
			columns: columns.map((c) => ({
				id: c.id,
				title: c.title,
				nodes: c.nodes.map((n) => ({
					id: n.id,
					title: n.title,
					danger: n.tone === "danger" ? true : undefined,
				})),
			})),
			edges,
			notes: [
				...sys.cycles
					.slice(0, 5)
					.map((c) => `ciclo: ${c.dirs.join(" ↔ ")} (${c.edgeCount} aristas)`),
				...sys.violations
					.slice(0, 5)
					.map(
						(v) =>
							`capa: ${v.from} → ${v.to} minoritario (${v.count} vs ${v.dominantCount})`,
					),
			],
		},
		{
			id: "hubs",
			title: "Hubs (fan-in)",
			open: false,
			columns: [],
			edges: [],
			notes: tech.data.hubs.map(
				(h) => `${h.file} — fanIn ${h.fanIn} · impacto ${h.blastRadius}`,
			),
		},
		{
			id: "entryPoints",
			title: "Puntos de entrada",
			open: false,
			columns: [],
			edges: [],
			notes: tech.data.entryPoints.map((p) => `${p.file} — fanOut ${p.fanOut}`),
		},
		{
			id: "risk",
			title: "Riesgo (fanIn × complejidad)",
			open: true,
			columns: [],
			edges: [],
			notes: tech.data.riskHotspots.map(
				(h) =>
					`${h.file} — score ${h.score} (fanIn ${h.fanIn} × complejidad ${h.maxComplexity})`,
			),
		},
	];
	if (
		cross?.status === "ready" &&
		Object.keys(cross.data.byDirectory).length > 0
	) {
		sections.push({
			id: "cross",
			title: "Cruce funcional (M9)",
			open: false,
			columns: [],
			edges: [],
			notes: Object.entries(cross.data.byDirectory)
				.slice(0, tech.limit)
				.map(([dir, sids]) => `${dir}: ${sids.join(" · ")}`),
		});
	}
	const notes: string[] = [];
	if (tech.data.deadWeight.files.length > 0) {
		notes.push(tech.data.deadWeight.disclaimer);
		notes.push(
			...tech.data.deadWeight.files.map((f) => `sin importadores: ${f.file}`),
		);
	}
	if (cross?.status === "ready" && cross.data.unmatchedModules.length > 0) {
		notes.push(
			`${cross.data.unmatchedModules.length} módulo(s) de la matriz fuera de los subsystems del grafo`,
		);
	}
	return {
		view: "technical",
		generatedAt: new Date().toISOString(),
		title: "Mapa técnico",
		meta: [
			`grafo: ${t.graphBuiltAt || "—"}`,
			`cobertura ${Math.round(t.coverage * 100)}% (${t.filesCovered}/${t.filesTotal} archivos)`,
			t.stale ? "desactualizado" : "",
			t.lowCoverage ? "cobertura baja" : "",
		].filter(Boolean),
		sections,
		notes,
	};
}
