/**
 * frida-subagents — panel /detached (webview, issue #26).
 *
 * Patrón CcPluginsPanel/SandboxesPanel: todo vive DENTRO del webview, tabs
 * Activos/Histórico al estilo unificado (docs/webview-ui-styles.md),
 * master-detail, Detener con confirmación doble-⏎, resultado y último texto
 * en la ficha. Los runs sobreviven al host (registry durable) — este panel
 * también (reabierto tras /reload o reinicio de VS Code).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Codicon } from "./Codicon";
import type { DetachedPanelWs, DetachedRunWs } from "../types";

export type DtAction = { kind: "refresh" } | { kind: "stop"; runId: string };

interface Props {
	panel: DetachedPanelWs;
	onAction: (id: string, a: DtAction) => void;
	onClose: (id: string) => void;
}

type Tab = "active" | "history";

const RUNNING = new Set(["running", "orphaned", "lost"]);

const STATUS_LABEL: Record<string, string> = {
	running: "● corriendo",
	orphaned: "◌ huérfano (padre murió)",
	lost: "? perdido",
	completed: "✓ completado",
	failed: "✗ falló",
	killed: "⏹ detenido",
};

function fmtDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${s % 60}s`;
	return `${Math.floor(m / 60)}h${m % 60}m`;
}

function fmtTokens(run: DetachedRunWs): string {
	const t = run.tokensIn + run.tokensOut;
	if (!t) return "";
	return t >= 1000 ? `${(t / 1000).toFixed(1)}k tok` : `${t} tok`;
}

export function DetachedPanel({ panel, onAction, onClose }: Props) {
	const [tab, setTab] = useState<Tab>("active");
	const [query, setQuery] = useState("");
	const [focusIdx, setFocusIdx] = useState(0);
	const [confirmStop, setConfirmStop] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const runs = panel.runs;
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const byTab = runs.filter((r) =>
			tab === "active" ? RUNNING.has(r.status) : !RUNNING.has(r.status),
		);
		if (!q) return byTab;
		return byTab.filter((r) =>
			`${r.id} ${r.name} ${r.agentType} ${r.model ?? ""}`
				.toLowerCase()
				.includes(q),
		);
	}, [runs, query, tab]);

	const activeCount = runs.filter((r) => RUNNING.has(r.status)).length;

	// Reset de foco al cambiar tab/filtro (patrón ccp).
	useEffect(() => {
		setFocusIdx(0);
		setConfirmStop(null);
	}, [tab, query]);

	// Teclado: ↑↓ navega · ⏎ detalle/ficha · Esc cierra confirmación o panel.
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		el.onkeydown = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				if (confirmStop) setConfirmStop(null);
				else onClose(panel.id);
				return;
			}
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setFocusIdx((i) =>
					Math.min(
						filtered.length - 1,
						Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)),
					),
				);
				return;
			}
			if (e.key === "Enter" && confirmStop) {
				e.preventDefault();
				onAction(panel.id, { kind: "stop", runId: confirmStop });
				setConfirmStop(null);
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				setConfirmStop(filtered[focusIdx]?.id ?? null);
			}
		};
	}, [filtered, focusIdx, confirmStop, onClose, onAction, panel.id]);

	// Auto-foco al montar (patrón ccp/sbx).
	useEffect(() => {
		rootRef.current?.focus();
	}, []);

	const sel = filtered[Math.min(focusIdx, filtered.length - 1)];

	// Estado vacío honesto.
	if (runs.length === 0) {
		return (
			<div
				className="dt-panel ccp-panel"
				ref={rootRef}
				tabIndex={-1}
				role="dialog"
			>
				<header className="ccp-head">
					<button
						type="button"
						className="ccp-close"
						onClick={() => onClose(panel.id)}
					>
						<Codicon name="close" size={14} />
					</button>
				</header>
				<div className="ccp-empty">
					<div className="ccp-empty-title">Sin subagentes detached</div>
					<div className="ccp-empty-hint">
						Pide en el chat: «lanza un subagente detached que…» — corre en su propio
						proceso y sobrevive a esta sesión. También:
						<code>Agent(&#123; detached: true &#125;)</code>.
					</div>
					<div className="dt-empty-actions">
						<button
							type="button"
							className="ccp-btn"
							onClick={() => onAction(panel.id, { kind: "refresh" })}
						>
							<Codicon name="refresh" size={13} /> Refrescar
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="dt-panel ccp-panel" ref={rootRef} tabIndex={-1} role="dialog">
			<header className="ccp-head">
				<div className="ccp-tabs">
					<button
						type="button"
						className={`ccp-tab ${tab === "active" ? "ccp-tab-active" : ""}`}
						onClick={() => setTab("active")}
					>
						Activos {activeCount > 0 ? activeCount : ""}
					</button>
					<button
						type="button"
						className={`ccp-tab ${tab === "history" ? "ccp-tab-active" : ""}`}
						onClick={() => setTab("history")}
					>
						Histórico
					</button>
				</div>
				<div className="ccp-head-actions">
					<button
						type="button"
						className="ccp-icon-btn"
						title="Refrescar"
						onClick={() => onAction(panel.id, { kind: "refresh" })}
					>
						<Codicon name="refresh" size={13} />
					</button>
					<button
						type="button"
						className="ccp-close"
						onClick={() => onClose(panel.id)}
					>
						<Codicon name="close" size={14} />
					</button>
				</div>
			</header>

			<div className="ccp-search">
				<Codicon name="search" size={12} />
				<input
					type="text"
					value={query}
					placeholder="Filtrar runs (id, nombre, tipo, modelo)"
					onChange={(e) => setQuery(e.target.value)}
				/>
			</div>

			<div className="ccp-body">
				<div className="ccp-list">
					{filtered.map((r, i) => (
						<button
							key={r.id}
							type="button"
							className={`ccp-res-row ${i === focusIdx ? "focused" : ""}`}
							onClick={() => setFocusIdx(i)}
							onDoubleClick={() => setConfirmStop(RUNNING.has(r.status) ? r.id : null)}
						>
							<span className="dt-row-status" data-status={r.status}>
								{STATUS_LABEL[r.status] ?? r.status}
							</span>
							<span className="dt-row-name">
								{r.name || r.id}
								{RUNNING.has(r.status) && (
									<span className="dt-row-live">
										{" "}
										t{r.turnCount || 0} · {fmtTokens(r) || r.activity}
									</span>
								)}
							</span>
							<span className="dt-row-type">{r.agentType}</span>
						</button>
					))}
					{filtered.length === 0 && (
						<div className="ccp-empty-hint">
							{tab === "active"
								? "Ningún run activo — mira el Histórico."
								: "Nada en el histórico."}
						</div>
					)}
				</div>

				{sel && (
					<aside className="ccp-detail">
						<div className="ccp-detail-title">
							{sel.name || sel.id}
							<code className="dt-detail-id">{sel.id}</code>
						</div>
						<div className="dt-detail-meta">
							<div>{STATUS_LABEL[sel.status] ?? sel.status}</div>
							<div>
								{sel.agentType}
								{sel.model ? ` · ${sel.model}` : ""}
							</div>
							<div>
								{RUNNING.has(sel.status)
									? `corriendo ${fmtDuration(Date.now() - sel.startedAt)} · turn ${sel.turnCount || 0} · ${sel.toolUses || 0} tools · ${fmtTokens(sel)}`
									: sel.endedAt
										? `${fmtDuration(sel.endedAt - sel.startedAt)} · ${fmtTokens(sel)}`
										: ""}
							</div>
							{RUNNING.has(sel.status) && (
								<div className="dt-detail-activity">{sel.activity}</div>
							)}
						</div>

						<div className="dt-detail-prompt">
							<div className="dt-detail-label">Prompt</div>
							<div>{sel.promptPreview}</div>
						</div>

						{(sel.text || sel.failureReason) && (
							<div className="dt-detail-text">
								<div className="dt-detail-label">
									{sel.status === "completed" ? "Resultado" : "Último texto"}
								</div>
								<pre>{sel.text || sel.failureReason}</pre>
							</div>
						)}

						<div className="ccp-detail-actions">
							{RUNNING.has(sel.status) && (
								<button
									type="button"
									className="ccp-btn"
									onClick={() => setConfirmStop(sel.id)}
								>
									<Codicon name="stop-circle" size={13} /> Detener
								</button>
							)}
							{confirmStop === sel.id && (
								<span className="dt-confirm">
									⏎ confirma · Esc cancela (SIGTERM al grupo)
								</span>
							)}
						</div>
					</aside>
				)}
			</div>

			<footer className="ccp-foot">
				↑↓ navegar · ⏎ en run activo: detener (2ª ⏎ confirma) · Esc cerrar
			</footer>
		</div>
	);
}
