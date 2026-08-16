/**
 * frida-sandboxes — panel /sandbox (webview, issue #35).
 *
 * Patrón CcPluginsPanel: todo vive DENTRO del webview (regla de UI), tabs
 * Activos/Finalizados al estilo unificado (docs/webview-ui-styles.md),
 * master-detail, acciones host-side vía post(). Sin Docker: estado vacío
 * honesto con guía + reintentar (diseño UX del comentario en #35).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Package, RefreshCw, Search, Terminal, X } from "lucide-react";
import type { SandboxInfoWs, SandboxPanelWs } from "../types";

/** Acción del panel → host (todas excepto refresh/reprobe llevan name). */
export type SbxAction =
	| { kind: "refresh" | "reprobe" }
	| { kind: "pause" | "resume" | "destroy"; name: string }
	| { kind: "terminal"; name: string }
	| { kind: "changes"; name: string }
	| { kind: "merge"; name: string; files: string[] };

interface Props {
	panel: SandboxPanelWs;
	onAction: (id: string, a: SbxAction) => void;
	onClose: (id: string) => void;
}

type Tab = "active" | "finished";

const STATE_LABEL: Record<string, string> = {
	active: "● corriendo",
	paused: "⏸ pausado",
};

export function SandboxesPanel({ panel, onAction, onClose }: Props) {
	// Secciones colapsables no aplican (2 tabs); sí búsqueda + foco teclado.
	const [tab, setTab] = useState<Tab>("active");
	const [query, setQuery] = useState("");
	const [focusIdx, setFocusIdx] = useState(0);
	const [confirmKill, setConfirmKill] = useState<string | null>(null);
	const [pending, setPending] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const sandboxes = panel.sandboxes;
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return sandboxes;
		return sandboxes.filter(
			(s) =>
				`${s.name} ${s.image} ${s.projectDir}`.toLowerCase().includes(q),
		);
	}, [sandboxes, query]);

	// Reset de foco al cambiar tab/filtro (patrón ccp).
	useEffect(() => {
		setFocusIdx(0);
		setConfirmKill(null);
	}, [tab, query]);

	// Teclado: ↑↓ navega · ⏎ detalles en ficha · Esc cierra confirmación o panel.
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		el.onkeydown = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				if (confirmKill) setConfirmKill(null);
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
			if (e.key === "Enter" && filtered[focusIdx]) {
				// ⏎ pide cambios (lazy) de la fila enfocada — la ficha los muestra.
				e.preventDefault();
				onAction(panel.id, { kind: "changes", name: filtered[focusIdx].name });
			}
		};
	}, [filtered, focusIdx, confirmKill, onClose, onAction, panel.id]);

	// Scroll de la fila enfocada (patrón ccp).
	useEffect(() => {
		listRef.current
			?.querySelector('[data-focused="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [focusIdx]);

	const focused = filtered[focusIdx];

	const act = (a: SbxAction) => {
		setPending(a.kind);
		onAction(panel.id, a);
	};

	// ── Sin Docker: estado vacío honesto (diseño #35 §5) ──
	if (!panel.docker.available) {
		return (
			<div
				className="sbx-panel ccp-panel"
				ref={rootRef}
				tabIndex={-1}
				role="dialog"
			>
				<header className="ccp-head">
					<span className="ccp-title">Sandboxes</span>
					<span className="ccp-spacer" />
					<button
						type="button"
						className="ccp-x"
						title="Cerrar (Esc)"
						onClick={() => onClose(panel.id)}
					>
						<X size={13} />
					</button>
				</header>
				<div className="sbx-empty">
					<div className="sbx-empty-icon">📦</div>
					<p>Sandboxes requiere Docker</p>
					<p className="sbx-empty-reason">
						{panel.docker.reason ?? "Docker no detectado en el host."}
					</p>
					<p className="sbx-empty-guide">
						macOS: Docker Desktop u OrbStack · Linux: docker.io
					</p>
					<button
						type="button"
						className="ccp-btn"
						onClick={() => act({ kind: "reprobe" })}
					>
						{pending === "reprobe" ? (
							<>
								<span className="ccp-spin">⟳</span> Detectando…
							</>
						) : (
							"Reintentar detección"
						)}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="sbx-panel ccp-panel" ref={rootRef} tabIndex={-1} role="dialog">
			<header className="ccp-head">
				<button
					type="button"
					className={`cfg-tab${tab === "active" ? " active" : ""}`}
					onClick={() => setTab("active")}
				>
					<Package size={12} /> Activos ({sandboxes.length})
				</button>
				<span className="ccp-spacer" />
				<button
					type="button"
					className="ccp-x"
					title="Refrescar"
					onClick={() => act({ kind: "refresh" })}
				>
					<RefreshCw size={13} />
				</button>
				<button
					type="button"
					className="ccp-x"
					title="Cerrar (Esc)"
					onClick={() => onClose(panel.id)}
				>
					<X size={13} />
				</button>
			</header>

			{/* Búsqueda (patrón ccp; teclado llega por el root) */}
			<div className="ccp-search">
				<Search size={12} />
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Filtrar sandboxes (nombre · imagen · proyecto)"
					spellCheck={false}
				/>
			</div>

			<div className="ccp-body">
				<div className="ccp-list ccp-list-full" ref={listRef}>
					{filtered.map((s, i) => (
						<button
							key={s.name}
							type="button"
							tabIndex={-1}
							className={`ccp-res-row${i === focusIdx ? " ccp-row-focus" : ""}`}
							data-focused={i === focusIdx ? "true" : "false"}
							onClick={() => {
								setFocusIdx(i);
								onAction(panel.id, { kind: "changes", name: s.name });
							}}
						>
							<span className="ccp-mkt-opt-cursor">
								{i === focusIdx ? "❯" : " "}
							</span>
							<span className="ccp-row-label">{s.name}</span>
							<span className="ccp-comp">{s.image}</span>
							<span
								className={`sbx-state sbx-state-${s.state === "active" ? "on" : "off"}`}
							>
								{STATE_LABEL[s.state] ?? s.state}
							</span>
						</button>
					))}
					{filtered.length ? null : (
						<div className="ccp-empty">
							Sin sandboxes{query ? ` para “${query}”` : ""}. El agente crea
							uno con sandbox_create.
						</div>
					)}
				</div>

				{/* Ficha lateral: acciones del sandbox enfocado (patrón ccp-detail) */}
				<div className="ccp-detail">
					{focused ? (
						<>
							<div className="ccp-detail-md">
								<div className="sbx-detail-name">{focused.name}</div>
								<div className="sbx-detail-meta">
									Imagen {focused.image} ·{" "}
									{STATE_LABEL[focused.state] ?? focused.state}
									{focused.lastSeen ? ` · docker: ${focused.lastSeen}` : ""}
								</div>
								<div className="sbx-detail-meta">
									Proyecto {focused.projectDir} · creado por{" "}
									{focused.createdBy}
								</div>
							</div>
							<div className="ccp-detail-btns">
								<button
									type="button"
									className="ccp-btn"
									disabled={pending !== null}
									onClick={() => act({ kind: "terminal", name: focused.name })}
								>
									<Terminal size={12} /> Terminal
								</button>
								{focused.state === "active" ? (
									<button
										type="button"
										className="ccp-btn"
										disabled={pending !== null}
										onClick={() => act({ kind: "pause", name: focused.name })}
									>
										Pausar
									</button>
								) : (
									<button
										type="button"
										className="ccp-btn"
										disabled={pending !== null}
										onClick={() => act({ kind: "resume", name: focused.name })}
									>
										Reanudar
									</button>
								)}
								{confirmKill === focused.name ? (
									<button
										type="button"
										className="ccp-btn ccp-btn-primary"
										onClick={() => {
											setConfirmKill(null);
											act({ kind: "destroy", name: focused.name });
										}}
									>
										Confirmar destrucción
									</button>
								) : (
									<button
										type="button"
										className="ccp-btn"
										disabled={pending !== null}
										onClick={() => setConfirmKill(focused.name)}
									>
										Descartar
									</button>
								)}
							</div>
						</>
					) : (
						<div className="ccp-detail-md">
							Selecciona un sandbox para ver sus acciones.
						</div>
					)}
				</div>
			</div>

			<div className="ccp-foot">
				↑↓ navegar · ⏎ ver cambios · Esc cerrar · el agente usa sandbox_create
				para crear
			</div>
		</div>
	);
}

export type { SandboxInfoWs };
