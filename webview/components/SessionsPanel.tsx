import { useMemo, useState } from "react";
import type { SessionItem } from "../types";
import { fmtTokens, formatDuration } from "../format";
import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";

interface Sessions {
	items: SessionItem[];
	currentPath?: string;
}

function fmtDate(ms: number): string {
	try {
		const d = new Date(ms);
		return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
	} catch {
		return "";
	}
}

/** Agrupa las sesiones cronológicamente según su fecha de modificación. */
function getSessionGroup(
	modifiedMs: number,
): "Hoy" | "Ayer" | "Últimos 7 días" | "Este mes" | "Anteriores" {
	const now = new Date();
	// Inicio de hoy (00:00:00)
	const todayStart = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	if (modifiedMs >= todayStart) return "Hoy";

	// Inicio de ayer
	const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
	if (modifiedMs >= yesterdayStart) return "Ayer";

	// Últimos 7 días
	const sevenDaysAgo = todayStart - 6 * 24 * 60 * 60 * 1000;
	if (modifiedMs >= sevenDaysAgo) return "Últimos 7 días";

	// Últimos 30 días
	const thirtyDaysAgo = todayStart - 29 * 24 * 60 * 60 * 1000;
	if (modifiedMs >= thirtyDaysAgo) return "Este mes";

	return "Anteriores";
}

/** basename del cwd de la sesión → etiqueta corta de proyecto (modo "Todas"). */
function projLabel(cwd: string): string {
	const t = cwd.trim();
	if (!t) return "—";
	const parts = t.replace(/\/+$/, "").split("/");
	return parts[parts.length - 1] || t;
}

/** Modos de ordenación del historial: recencia (grupos de fecha, como siempre)
 * o actividad/turnos (lista plana global — rankear trabajo total por bucket de
 * fecha no tiene sentido). */
type SortMode = "recent" | "active" | "turns";

/** Tooltip del chip ⚡ — mismo vocabulario que el popover #107 del header
 * (activo/turnos, pared con proporción, promedio, tokens y costo). */
function timingTip(s: SessionItem): string {
	const active = s.activeMs ?? 0;
	const turns = s.turnCount ?? 0;
	const avg = turns > 0 ? Math.round(active / turns) : 0;
	const pct =
		s.durationMs && s.durationMs > 0
			? Math.round((active / s.durationMs) * 100)
			: null;
	const tokens = (s.inputTotal ?? 0) + (s.outputTotal ?? 0);
	return [
		`⚡ ${formatDuration(active)} · ${turns} turnos`,
		pct !== null
			? `Pared: ${formatDuration(s.durationMs!)} (${pct}% activo)`
			: "",
		turns > 0 ? `Promedio: ${formatDuration(avg)}/turno` : "",
		tokens > 0
			? `↑${fmtTokens(s.inputTotal ?? 0)} ↓${fmtTokens(s.outputTotal ?? 0)} tokens`
			: "",
		(s.cost ?? 0) > 0 ? `$${(s.cost ?? 0).toFixed(2)}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export function SessionsPanel({
	sessions,
	scope = "project",
	onScopeChange,
	onClose,
	onSwitch,
	onRename,
	onDelete,
	onNewSession,
}: {
	sessions: Sessions;
	scope: "project" | "all";
	onScopeChange: (s: "project" | "all") => void;
	onClose: () => void;
	onSwitch: (path: string) => void;
	onRename: (path: string, name: string) => void;
	onDelete: (path: string) => void;
	onNewSession?: () => void;
}) {
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<SortMode>("recent");
	const [editing, setEditing] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [draft, setDraft] = useState("");

	const rawItems = sessions.items ?? [];
	const showProj = scope === "all";

	// Filtrado en tiempo real por término de búsqueda (nombre, mensajes, proyecto)
	const filteredItems = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return rawItems;
		return rawItems.filter((s) => {
			const name = (s.name ?? "").toLowerCase();
			const firstMsg = (s.firstMessage ?? "").toLowerCase();
			const cwd = (s.cwd ?? "").toLowerCase();
			return name.includes(q) || firstMsg.includes(q) || cwd.includes(q);
		});
	}, [rawItems, search]);

	// Agrupación cronológica ordenada (sólo en modo recencia)
	const dateGroups = useMemo(() => {
		const order: Array<
			"Hoy" | "Ayer" | "Últimos 7 días" | "Este mes" | "Anteriores"
		> = ["Hoy", "Ayer", "Últimos 7 días", "Este mes", "Anteriores"];
		const map: Record<string, SessionItem[]> = {};
		for (const s of filteredItems) {
			const g = getSessionGroup(s.modified);
			if (!map[g]) map[g] = [];
			map[g].push(s);
		}
		return order
			.filter((g) => map[g] && map[g].length > 0)
			.map((g) => ({ group: g, items: map[g] }));
	}, [filteredItems]);

	// Secciones a renderizar: grupos de fecha (recencia) o lista plana global
	// ordenada desc por tiempo activo / turnos.
	const sections = useMemo(() => {
		if (sort !== "recent") {
			const items = [...filteredItems].sort((a, b) =>
				sort === "active"
					? (b.activeMs ?? 0) - (a.activeMs ?? 0)
					: (b.turnCount ?? 0) - (a.turnCount ?? 0),
			);
			return [{ group: null, items }];
		}
		return dateGroups;
	}, [filteredItems, sort, dateGroups]);

	// Σ de tiempo activo y turnos de las sesiones filtradas (pie del panel).
	const totals = useMemo(() => {
		let active = 0;
		let turns = 0;
		let any = false;
		for (const s of filteredItems) {
			if (s.activeMs !== undefined) {
				active += s.activeMs;
				any = true;
			}
			turns += s.turnCount ?? 0;
		}
		return { active, turns, any };
	}, [filteredItems]);

	return (
		<div className="sessions-overlay" onClick={onClose}>
			<div className="sessions-panel" onClick={(e) => e.stopPropagation()}>
				{/* Cabecera estilo Copilot History */}
				<div className="sessions-head">
					<div className="sessions-head-title">
						<Codicon name="history" size={15} />
						<span>Historial de Sesiones</span>
					</div>
					<div className="seg-toggle" role="tablist">
						<button
							className={"seg" + (scope === "project" ? " active" : "")}
							onClick={() => onScopeChange("project")}
							title="Solo sesiones de este proyecto"
						>
							Este proyecto
						</button>
						<button
							className={"seg" + (scope === "all" ? " active" : "")}
							onClick={() => onScopeChange("all")}
							title="Sesiones de todos los proyectos"
						>
							Todas
						</button>
					</div>
					{/* #107 — orden por actividad: recencia (grupos de fecha) o ranking
				    global por tiempo activo / turnos. */}
					<div className="seg-toggle" role="tablist" title="Ordenar sesiones">
						<button
							className={"seg" + (sort === "recent" ? " active" : "")}
							onClick={() => setSort("recent")}
							title="Grupos cronológicos (por fecha de modificación)"
						>
							<Codicon name="calendar" size={12} />
						</button>
						<button
							className={"seg" + (sort === "active" ? " active" : "")}
							onClick={() => setSort("active")}
							title="Más tiempo activo primero (lista plana)"
						>
							<Codicon name="zap" size={12} />
						</button>
						<button
							className={"seg" + (sort === "turns" ? " active" : "")}
							onClick={() => setSort("turns")}
							title="Más turnos primero (lista plana)"
						>
							<Codicon name="repeat" size={12} />
						</button>
					</div>
					<button
						className="icon-btn sessions-close-btn"
						onClick={onClose}
						title="Cerrar (Esc)"
					>
						<Codicon name="close" size={14} />
					</button>
				</div>

				{/* Buscador en tiempo real */}
				<div className="sessions-search-bar">
					<span className="sessions-search-icon">
						<Codicon name="search" size={13} />
					</span>
					<input
						className="sessions-search-input"
						placeholder="Buscar por título, contenido o carpeta…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						autoFocus
					/>
					{search && (
						<button
							type="button"
							className="sessions-search-clear"
							onClick={() => setSearch("")}
							title="Limpiar búsqueda"
						>
							<Codicon name="close" size={12} />
						</button>
					)}
				</div>

				{/* Lista de sesiones agrupada cronológicamente */}
				<div className="sessions-list">
					{filteredItems.length === 0 ? (
						<div className="sessions-empty">
							<Codicon name="search" size={24} className="empty-icon" />
							<span>
								{search
									? "No se encontraron sesiones que coincidan con la búsqueda."
									: scope === "project"
										? "Aún no hay sesiones guardadas en este proyecto."
										: "Aún no hay sesiones guardadas."}
							</span>
						</div>
					) : (
						sections.map(({ group, items }, si) => (
							<div key={group ?? `flat-${si}`} className="session-group">
								{group !== null && (
									<div className="session-group-header">
										<span className="session-group-label">{group}</span>
										<span className="session-group-count">{items.length}</span>
									</div>
								)}
								{items.map((s) => {
									const isCurrent = s.path === sessions.currentPath;
									const title = s.name || s.firstMessage || "(sin mensajes)";
									const snippet =
										s.name && s.firstMessage && s.name !== s.firstMessage
											? s.firstMessage
											: null;
									const totalTokens = (s.inputTotal ?? 0) + (s.outputTotal ?? 0);

									return (
										<div
											key={s.path}
											className={"session-card" + (isCurrent ? " is-current" : "")}
										>
											{editing === s.path ? (
												<div className="session-rename-box">
													<input
														autoFocus
														className="rename-input"
														value={draft}
														placeholder="Nombre de la sesión…"
														onChange={(e) => setDraft(e.target.value)}
														onKeyDown={(e) => {
															if (e.key === "Enter") {
																onRename(s.path, draft);
																setEditing(null);
															}
															if (e.key === "Escape") setEditing(null);
														}}
													/>
													<button
														type="button"
														className="icon-btn primary"
														title="Guardar nombre"
														onClick={() => {
															onRename(s.path, draft);
															setEditing(null);
														}}
													>
														<Codicon name="check" size={13} />
													</button>
													<button
														type="button"
														className="icon-btn sec"
														title="Cancelar"
														onClick={() => setEditing(null)}
													>
														<Codicon name="close" size={13} />
													</button>
												</div>
											) : confirming === s.path ? (
												<div className="session-confirm-box">
													<span className="session-confirm-msg">
														<Codicon name="warning" size={13} /> ¿Eliminar esta sesión
														permanentemente?
													</span>
													<div className="session-confirm-actions">
														<button
															type="button"
															className="sec"
															onClick={() => setConfirming(null)}
														>
															Cancelar
														</button>
														<button
															type="button"
															className="danger"
															onClick={() => {
																onDelete(s.path);
																setConfirming(null);
															}}
														>
															Eliminar
														</button>
													</div>
												</div>
											) : (
												<>
													<div
														className="session-main"
														onClick={() => onSwitch(s.path)}
														title="Abrir esta sesión"
													>
														<div className="session-title-line">
															<span
																className={
																	"session-status-icon " + (isCurrent ? "current" : "")
																}
															>
																<Codicon
																	name={isCurrent ? "circle-filled" : "history"}
																	size={12}
																/>
															</span>
															<span className="session-title">{title}</span>
															{isCurrent && (
																<span className="session-current-badge">ACTUAL</span>
															)}
														</div>

														{snippet && <div className="session-snippet">«{snippet}»</div>}

														<div className="session-meta-row">
															<span className="session-meta-chip">
																<Codicon name="comment" size={11} />
																<span>{s.messageCount} msgs</span>
															</span>
															{/* #107 — chip fusionado ⚡ tiempo activo · Nt (paridad con el
																    header); fallback al reloj de pared si el JSONL no trajo
																    turns (p. ej. sesiones pre-#107). Tooltip = vocabulario
																    del popover del header. */}
															{(s.activeMs ?? 0) > 0 || (s.turnCount ?? 0) > 0 ? (
																<Tooltip label={timingTip(s)} side="top">
																	<span className="session-meta-chip session-timing-chip">
																		<Codicon name="zap" size={11} />
																		<span>
																			{formatDuration(s.activeMs ?? 0)} · {s.turnCount ?? 0}t
																		</span>
																	</span>
																</Tooltip>
															) : (
																s.durationMs !== undefined &&
																s.durationMs > 0 && (
																	<span className="session-meta-chip">
																		<Codicon name="clock" size={11} />
																		<span>{formatDuration(s.durationMs)}</span>
																	</span>
																)
															)}
															{totalTokens > 0 && (
																<span className="session-meta-chip">
																	<Codicon name="database" size={11} />
																	<span>{fmtTokens(totalTokens)} tok</span>
																</span>
															)}
															{showProj && (
																<span className="session-meta-chip session-proj-chip">
																	<Codicon name="folder" size={11} />
																	<span>{projLabel(s.cwd)}</span>
																</span>
															)}
															<span className="session-meta-date">{fmtDate(s.modified)}</span>
														</div>
													</div>

													<div className="session-actions">
														<Tooltip label="Renombrar sesión" side="top">
															<button
																type="button"
																className="icon-btn sec session-act-btn"
																onClick={() => {
																	setEditing(s.path);
																	setDraft(s.name || "");
																}}
															>
																<Codicon name="edit" size={13} />
															</button>
														</Tooltip>
														<Tooltip
															label={
																isCurrent
																	? "No puedes eliminar la sesión activa"
																	: "Eliminar sesión"
															}
															side="top"
														>
															<button
																type="button"
																className="icon-btn sec danger session-act-btn"
																disabled={isCurrent}
																onClick={() => setConfirming(s.path)}
															>
																<Codicon name="trash" size={13} />
															</button>
														</Tooltip>
													</div>
												</>
											)}
										</div>
									);
								})}
							</div>
						))
					)}
				</div>

				{/* Pie del panel con acción rápida de Nueva Sesión */}
				<div className="sessions-footer">
					{onNewSession && (
						<button
							type="button"
							className="primary-btn sessions-new-btn"
							onClick={onNewSession}
						>
							<Codicon name="add" size={13} />
							<span>Nueva Sesión</span>
						</button>
					)}
					<span className="sessions-footer-count">
						{filteredItems.length === 1
							? "1 sesión"
							: `${filteredItems.length} sesiones`}
						{search && ` (de ${rawItems.length})`}
					</span>
					{/* Σ de las filtradas — mismo vocabulario del chip (#107). */}
					{totals.any && (
						<span className="sessions-footer-total">
							<Codicon name="zap" size={11} />
							<span>
								{formatDuration(totals.active)} · {totals.turns}t
							</span>
						</span>
					)}
					<button type="button" className="sec" onClick={onClose}>
						Cerrar
					</button>
				</div>
			</div>
		</div>
	);
}
