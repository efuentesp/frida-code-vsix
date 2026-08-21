import { useState } from "react";
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

/** basename del cwd de la sesión → etiqueta corta de proyecto (modo "Todas"). */
function projLabel(cwd: string): string {
	const t = cwd.trim();
	if (!t) return "—";
	const parts = t.replace(/\/+$/, "").split("/");
	return parts[parts.length - 1] || t;
}

export function SessionsPanel({
	sessions,
	scope = "project",
	onScopeChange,
	onClose,
	onSwitch,
	onRename,
	onDelete,
}: {
	sessions: Sessions;
	scope: "project" | "all";
	onScopeChange: (s: "project" | "all") => void;
	onClose: () => void;
	onSwitch: (path: string) => void;
	onRename: (path: string, name: string) => void;
	onDelete: (path: string) => void;
}) {
	const [editing, setEditing] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [draft, setDraft] = useState("");

	const items = sessions.items ?? [];
	// En modo "Todas" cada fila etiqueta a qué proyecto (cwd) pertenece; en modo
	// "Este proyecto" todas son del mismo → omitir para no inundar de ruido.
	const showProj = scope === "all";

	return (
		<div className="sessions-overlay" onClick={onClose}>
			<div className="sessions-panel" onClick={(e) => e.stopPropagation()}>
				<div className="sessions-head">
					<span>Sesiones ({items.length})</span>
					{/* Toggle de 2 segmentos: filtra por el cwd del workspace o muestra
					    todas. El conteo (items.length) refleja siempre el scope activo. */}
					<div className="seg-toggle" role="tablist">
						<button
							className={"seg" + (scope === "project" ? " active" : "")}
							onClick={() => onScopeChange("project")}
							title="Solo sesiones iniciadas en este proyecto"
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
					<button className="sec" onClick={onClose}>
						Cerrar
					</button>
				</div>
				<div className="sessions-list">
					{items.length === 0 && (
						<div className="sessions-empty">
							{scope === "project"
								? "Aún no hay sesiones de este proyecto."
								: "Aún no hay sesiones guardadas."}
						</div>
					)}
					{items.map((s) => {
						const isCurrent = s.path === sessions.currentPath;
						const title = s.name || s.firstMessage || "(sin mensajes)";
						const hasStats =
							s.durationMs !== undefined &&
							(s.inputTotal !== undefined || s.outputTotal !== undefined);
						return (
							<div
								key={s.path}
								className={"session-row" + (isCurrent ? " current" : "")}
							>
								{editing === s.path ? (
									<div className="session-rename">
										<input
											autoFocus
											className="rename-input"
											value={draft}
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
											onClick={() => {
												onRename(s.path, draft);
												setEditing(null);
											}}
										>
											<Codicon name="check" size={14} />
										</button>
										<button className="sec" onClick={() => setEditing(null)}>
											<Codicon name="close" size={14} />
										</button>
									</div>
								) : confirming === s.path ? (
									<div className="session-confirm">
										<span className="session-confirm-msg">
											¿Eliminar esta sesión?
										</span>
										<button className="sec" onClick={() => setConfirming(null)}>
											Cancelar
										</button>
										<button
											className="danger"
											onClick={() => {
												onDelete(s.path);
												setConfirming(null);
											}}
										>
											Eliminar
										</button>
									</div>
								) : (
									<>
										<div
											className="session-main"
											onClick={() => onSwitch(s.path)}
											title="Abrir esta sesión"
										>
											<div className="session-title">
												{isCurrent && (
													<span className="dot">
														<Codicon name="circle-filled" size={10} />
													</span>
												)}
												{title}
											</div>
											<div className="session-meta">
												{s.messageCount} msgs
												{showProj && (
													<>
														{" · "}
														<span className="session-proj">
															📁 {projLabel(s.cwd)}
														</span>
													</>
												)}
												{" · "}
												{fmtDate(s.modified)}
											</div>
											{/* Segunda línea dedicada: tiempo de sesión (primer→último
											    mensaje) + tokens acumulados. Más fácil de escanear que
											    mezclado con msgs/fecha. */}
											{hasStats && (
												<div className="session-stats-line">
													<span>⏱ {formatDuration(s.durationMs ?? 0)}</span>
													<span className="ss-tokens">
														↑{fmtTokens(s.inputTotal ?? 0)} ↓
														{fmtTokens(s.outputTotal ?? 0)}
													</span>
												</div>
											)}
										</div>
										<Tooltip label="Renombrar" side="top">
											<button
												className="sec icon-btn"
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
													: "Eliminar"
											}
											side="top"
										>
											<button
												className="sec icon-btn danger"
												disabled={isCurrent}
												onClick={() => setConfirming(s.path)}
											>
												<Codicon name="trash" size={13} />
											</button>
										</Tooltip>
									</>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
