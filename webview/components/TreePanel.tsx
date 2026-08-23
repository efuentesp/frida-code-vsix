import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeData, TreeEntryNode } from "../types";
import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";

/**
 * /tree (#126): navegación del árbol de la sesión ACTIVA (misma sesión, se
 * mueve la hoja). No sustituye a SessionsPanel: sesiones = entre
 * conversaciones; árbol = dentro de la conversación. El puente explícito es
 * /fork (archivo nuevo), sugerido en el footer.
 *
 * Paridad con TreeSelectorComponent de Pi TUI: filtros por modo, búsqueda
 * incremental, plegado de ramas, etiquetas de checkpoint y diálogo de branch
 * summary al confirmar un salto de rama.
 */

type FilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

const FILTER_ORDER: FilterMode[] = [
	"default",
	"no-tools",
	"user-only",
	"labeled-only",
	"all",
];

const FILTER_LABELS: Record<FilterMode, string> = {
	default: "Conversación",
	"no-tools": "Sin herramientas",
	"user-only": "Sólo usuario",
	"labeled-only": "Sólo etiquetadas",
	all: "Todo",
};

const KIND_ICONS: Record<string, string> = {
	user: "account",
	assistant: "copilot",
	toolResult: "tools",
	branchSummary: "git-branch",
	compaction: "fold",
	modelChange: "settings",
	thinking: "lightbulb",
	customMessage: "symbol-snake",
	other: "circle-outline",
};

/** ¿Visible bajo el modo de filtro? Paridad con applyFilter de Pi. */
export function passesFilter(
	n: TreeEntryNode,
	mode: FilterMode,
	isLeaf: boolean,
): boolean {
	switch (mode) {
		case "user-only":
			return n.kind === "user";
		case "no-tools":
			return (
				!isBookkeeping(n) && n.kind !== "toolResult" && showsAssistant(n, isLeaf)
			);
		case "labeled-only":
			return !!n.label;
		case "all":
			return true;
		default:
			return !isBookkeeping(n) && showsAssistant(n, isLeaf);
	}
}

/** Entradas de bookkeeping ocultas en el modo default (espejo de Pi). */
function isBookkeeping(n: TreeEntryNode): boolean {
	// custom_message con display:false es material interno del host (wiki/git
	// context inyectado cada turno) — no es conversación visible para el
	// usuario, así que el modo Conversación lo oculta. El modo Todo lo muestra.
	if (n.kind === "customMessage") return n.display !== true;
	return (
		n.kind === "modelChange" ||
		n.kind === "thinking" ||
		n.kind === "other"
	);
}

/** Asistentes sin texto se ocultan salvo error/abort o que sean la hoja actual. */
function showsAssistant(n: TreeEntryNode, isLeaf: boolean): boolean {
	if (n.kind !== "assistant" || isLeaf) return true;
	const stop = n.stopReason ?? "";
	const isErrorOrAborted = !!stop && stop !== "stop" && stop !== "toolUse";
	return !!n.hasText || isErrorOrAborted;
}

function searchableText(n: TreeEntryNode): string {
	return `${n.label ?? ""} ${n.kind} ${n.text ?? ""}`.toLowerCase();
}

function previewOf(n: TreeEntryNode): string {
	if (n.text) return n.text;
	if (n.kind === "assistant") {
		if (n.toolCalls)
			return `${n.toolCalls} ${n.toolCalls === 1 ? "herramienta" : "herramientas"}`;
		const stop = n.stopReason ?? "";
		if (stop && stop !== "stop" && stop !== "toolUse")
			return `⚠ sin respuesta (${stop})`;
	}
	if (n.kind === "toolResult") return "(resultado de herramienta)";
	return "—";
}

function fmtTime(ts: string): string {
	try {
		const d = new Date(ts);
		if (Number.isNaN(d.getTime())) return "";
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	} catch {
		return "";
	}
}

/** Cuenta las entradas que quedarían abandonadas al saltar de leaf→target:
 *  camino de la hoja hasta el ancestro común con el destino (0 si subes por
 *  la propia ruta activa). Espejo de collectEntriesForBranchSummary del SDK. */
function countAbandoned(
	nodes: TreeEntryNode[],
	leafId: string | null,
	targetId: string,
): number {
	const byId = new Map<string, TreeEntryNode>();
	const walk = (list: TreeEntryNode[]) => {
		for (const n of list) {
			byId.set(n.id, n);
			walk(n.children);
		}
	};
	walk(nodes);
	const targetAncestors = new Set<string>();
	let cur = byId.get(targetId);
	while (cur) {
		targetAncestors.add(cur.id);
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	let count = 0;
	let n = leafId ? byId.get(leafId) : undefined;
	while (n && !targetAncestors.has(n.id)) {
		count++;
		n = n.parentId ? byId.get(n.parentId) : undefined;
	}
	return count;
}

export function TreePanel({
	data,
	onClose,
	onNavigate,
	onLabel,
}: {
	data: TreeData;
	onClose: () => void;
	onNavigate: (
		entryId: string,
		summarize: boolean,
		customInstructions?: string,
	) => void;
	onLabel: (entryId: string, label: string | undefined) => void;
}) {
	const [filterMode, setFilterMode] = useState<FilterMode>("default");
	const [search, setSearch] = useState("");
	const [folded, setFolded] = useState<Set<string>>(new Set());
	const [selectedId, setSelectedId] = useState<string | null>(data.leafId);
	const [status, setStatus] = useState<string | null>(null);
	// Paso 2: diálogo de branch summary para el destino pendiente.
	const [pending, setPending] = useState<string | null>(null);
	const [sumChoice, setSumChoice] = useState<"no" | "yes" | "custom">("no");
	const [customText, setCustomText] = useState("");
	// Edición inline de etiqueta.
	const [editing, setEditing] = useState<{ id: string; value: string } | null>(
		null,
	);

	const panelRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	// Ruta activa: hoja → raíz (para resaltar y atenuar hermanas).
	const activePath = useMemo(() => {
		const set = new Set<string>();
		const byId = new Map<string, TreeEntryNode>();
		const walk = (list: TreeEntryNode[]) => {
			for (const n of list) {
				byId.set(n.id, n);
				walk(n.children);
			}
		};
		walk(data.nodes);
		let cur = data.leafId ? byId.get(data.leafId) : undefined;
		while (cur) {
			set.add(cur.id);
			cur = cur.parentId ? byId.get(cur.parentId) : undefined;
		}
		return set;
	}, [data]);

	// IDs visibles (paridad applyFilter de Pi): pasan el filtro + búsqueda; la
	// hoja actual SIEMPRE visible (posición activa perceptible); los hijos de
	// nodos plegados desaparecen (sólo sin búsqueda). NOTA: NO se conservan
	// ancestros — en una cadena lineal forzarlos re-mostraría todo y los filtros
	// no harían nada (bug #126 reporte: "los tabs no hacen diferencia").
	const visibleIds = useMemo(() => {
		const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
		const keep = new Set<string>();
		const parentOf = new Map<string, string | null>();
		const walk = (list: TreeEntryNode[], parent: string | null) => {
			for (const n of list) {
				parentOf.set(n.id, parent);
				walk(n.children, n.id);
			}
		};
		walk(data.nodes, null);
		const byId = new Map<string, TreeEntryNode>();
		const collect = (list: TreeEntryNode[]) => {
			for (const n of list) {
				byId.set(n.id, n);
				collect(n.children);
			}
		};
		collect(data.nodes);
		for (const n of byId.values()) {
			const isLeaf = n.id === data.leafId;
			const passes =
				passesFilter(n, filterMode, isLeaf) &&
				(tokens.length === 0 ||
					tokens.every((t) => searchableText(n).includes(t)));
			if (passes || isLeaf) keep.add(n.id);
		}
		// Plegado: descendientes de un nodo plegado desaparecen (sólo sin búsqueda).
		if (tokens.length === 0 && folded.size > 0) {
			const drop = new Set<string>();
			for (const n of byId.values()) {
				const p = parentOf.get(n.id) ?? null;
				if (p && (folded.has(p) || drop.has(p))) drop.add(n.id);
			}
			for (const id of drop) keep.delete(id);
		}
		return keep;
	}, [data, filterMode, search, folded]);

	// Lista plana visible en orden DFS (para navegación por teclado).
	const flatVisible = useMemo(() => {
		const out: TreeEntryNode[] = [];
		const walk = (list: TreeEntryNode[]) => {
			for (const n of list) {
				if (visibleIds.has(n.id)) out.push(n);
				walk(n.children);
			}
		};
		walk(data.nodes);
		return out;
	}, [data, visibleIds]);

	useEffect(() => {
		panelRef.current?.focus();
	}, []);

	useEffect(() => {
		if (!selectedId && flatVisible.length > 0)
			setSelectedId(flatVisible[flatVisible.length - 1].id);
	}, [flatVisible, selectedId]);

	const scrollSelected = () => {
		if (!selectedId || !panelRef.current) return;
		const el = panelRef.current.querySelector(
			`[data-entry-id="${CSS.escape(selectedId)}"]`,
		);
		el?.scrollIntoView({ block: "nearest" });
	};

	const move = (delta: number) => {
		if (flatVisible.length === 0) return;
		const idx = flatVisible.findIndex((n) => n.id === selectedId);
		const next = Math.min(
			Math.max(idx === -1 ? flatVisible.length - 1 : idx + delta, 0),
			flatVisible.length - 1,
		);
		setSelectedId(flatVisible[next].id);
		requestAnimationFrame(scrollSelected);
	};

	const toggleFold = (id: string) => {
		setFolded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const byId = useMemo(() => {
		const m = new Map<string, TreeEntryNode>();
		const walk = (list: TreeEntryNode[]) => {
			for (const n of list) {
				m.set(n.id, n);
				walk(n.children);
			}
		};
		walk(data.nodes);
		return m;
	}, [data]);

	const onRowActivate = (id: string) => {
		if (id === data.leafId) {
			setStatus("Ya estás en este punto de la conversación.");
			return;
		}
		setPending(id);
		setSumChoice("no");
		setCustomText("");
		setStatus(null);
	};

	const confirmNavigate = () => {
		if (!pending) return;
		const abandoned = countAbandoned(data.nodes, data.leafId, pending);
		const summarize = abandoned > 0 && sumChoice !== "no";
		onNavigate(
			pending,
			summarize,
			summarize && sumChoice === "custom" ? customText : undefined,
		);
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (editing) return; // el input de etiqueta maneja sus propias teclas
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				move(1);
				break;
			case "ArrowUp":
				e.preventDefault();
				move(-1);
				break;
			case "ArrowRight":
				if (selectedId) {
					const n = byId.get(selectedId);
					if (n && n.children.length > 0 && folded.has(selectedId)) {
						e.preventDefault();
						toggleFold(selectedId);
					}
				}
				break;
			case "ArrowLeft":
				if (selectedId) {
					const n = byId.get(selectedId);
					if (n && n.children.length > 0 && !folded.has(selectedId)) {
						e.preventDefault();
						toggleFold(selectedId);
					}
				}
				break;
			case "Enter":
				if (pending) return; // diálogo abierto: sus botones deciden
				e.preventDefault();
				if (selectedId) onRowActivate(selectedId);
				break;
			case "Escape":
				e.preventDefault();
				if (search) setSearch("");
				else onClose();
				break;
		}
	};

	const renderRow = (n: TreeEntryNode, depth: number) => {
		if (!visibleIds.has(n.id)) return null;
		const isLeaf = n.id === data.leafId;
		const sel = n.id === selectedId;
		const foldable = n.children.some((c) => visibleIds.has(c.id));
		const isOpen = !folded.has(n.id);
		const icon = KIND_ICONS[n.kind] ?? "circle-outline";
		return (
			<div
				key={n.id}
				data-entry-id={n.id}
				className={
					"tree-row" +
					(sel ? " is-sel" : "") +
					(isLeaf ? " is-leaf" : "") +
					(activePath.has(n.id) ? " on-path" : " off-path")
				}
				style={{ paddingLeft: 6 + depth * 2 }}
				onClick={() => setSelectedId(n.id)}
				onDoubleClick={() => onRowActivate(n.id)}
				role="treeitem"
				aria-selected={sel}
				tabIndex={-1}
			>
				<button
					className={
						"tree-chevron" + (foldable ? "" : " ghost") + (isOpen ? " open" : "")
					}
					style={{ visibility: foldable ? "visible" : "hidden" }}
					onClick={(e) => {
						e.stopPropagation();
						toggleFold(n.id);
					}}
					tabIndex={-1}
					aria-label={isOpen ? "Plegar rama" : "Desplegar rama"}
				>
					<Codicon name={isOpen ? "chevron-down" : "chevron-right"} size={14} />
				</button>
				<Codicon name={icon} size={13} className="tree-kind" />
				{editing?.id === n.id ? (
					<input
						className="tree-label-input"
						value={editing.value}
						autoFocus
						placeholder="Etiqueta…"
						onChange={(e) => setEditing({ id: n.id, value: e.target.value })}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Enter") {
								onLabel(n.id, editing.value.trim() || undefined);
								setEditing(null);
							} else if (e.key === "Escape") {
								setEditing(null);
							}
						}}
						onBlur={() => setEditing(null)}
					/>
				) : n.label ? (
					<span
						className="tree-label-badge"
						title={n.label}
						onClick={(e) => {
							e.stopPropagation();
							setEditing({ id: n.id, value: n.label ?? "" });
						}}
					>
						🏷 {n.label}
					</span>
				) : null}
				<span className="tree-text" title={previewOf(n)}>
					{previewOf(n)}
				</span>
				{isLeaf && (
					<Tooltip label="Posición actual" side="top">
						<span className="tree-leaf-dot">●</span>
					</Tooltip>
				)}
				<span className="tree-ts">{fmtTime(n.timestamp)}</span>
				{editing?.id !== n.id && (
					<Tooltip
						label={n.label ? "Editar etiqueta" : "Etiquetar (checkpoint)"}
						side="top"
					>
						<button
							className="tree-label-btn"
							onClick={(e) => {
								e.stopPropagation();
								setEditing({ id: n.id, value: n.label ?? "" });
							}}
							tabIndex={-1}
							aria-label="Etiquetar entrada"
						>
							<Codicon name="tag" size={12} />
						</button>
					</Tooltip>
				)}
			</div>
		);
	};

	const renderLevel = (list: TreeEntryNode[], depth: number): React.ReactNode =>
		list.map((n) => (
			<div key={n.id} className="tree-branch">
				{renderRow(n, depth)}
				{n.children.length > 0 && (
					<div className="tree-children">{renderLevel(n.children, depth + 1)}</div>
				)}
			</div>
		));

	const target = pending ? byId.get(pending) : undefined;
	const abandoned = pending
		? countAbandoned(data.nodes, data.leafId, pending)
		: 0;

	return (
		<div className="sessions-overlay" onClick={onClose}>
			<div
				className="sessions-panel tree-panel"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={onKeyDown}
				ref={panelRef}
				tabIndex={0}
				role="tree"
				aria-label="Árbol de sesión"
			>
				<div className="sessions-head">
					<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
						<Codicon name="list-tree" size={14} /> Árbol de sesión
					</span>
					<Tooltip label="Cerrar" side="top">
						<button className="icon-btn" onClick={onClose}>
							<Codicon name="close" size={15} />
						</button>
					</Tooltip>
				</div>
				{data.sessionName && (
					<div className="tree-subtitle">
						{data.sessionName} · Navegas dentro de la sesión actual; las ramas
						comparten este archivo.
					</div>
				)}
				<div className="tree-toolbar">
					<div className="tree-search">
						<Codicon name="search" size={12} />
						<input
							ref={searchRef}
							value={search}
							placeholder="Buscar en el árbol…"
							onChange={(e) => setSearch(e.target.value)}
							onKeyDown={onKeyDown}
						/>
					</div>
					<div className="tree-filters" role="tablist">
						{FILTER_ORDER.map((m) => (
							<button
								key={m}
								className={"tree-filter-chip" + (filterMode === m ? " active" : "")}
								onClick={() => setFilterMode(m)}
								role="tab"
								aria-selected={filterMode === m}
							>
								{FILTER_LABELS[m]}
							</button>
						))}
					</div>
				</div>
				<div className="tree-scroll">
					{flatVisible.length === 0 ? (
						<div className="tree-empty">
							Nada que mostrar con este filtro. Prueba “Todo” o limpia la búsqueda.
						</div>
					) : (
						renderLevel(data.nodes, 0)
					)}
				</div>
				<div className="tree-statusbar">
					<span className="tree-status">
						{status ??
							(flatVisible.length > 0
								? "Enter: navegar aquí · ←/→ plegar ramas · doble clic también navega"
								: "")}
					</span>
					<span className="tree-fork-hint">
						¿Prefieres una sesión nueva desde un punto? Usa <kbd>/fork</kbd>
					</span>
				</div>
			</div>

			{target && (
				<div className="sessions-overlay tree-confirm-overlay">
					<div
						className="tree-confirm"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-label="Cambiar de rama"
					>
						<div className="tree-confirm-title">
							<Codicon name="git-branch" size={14} /> Cambiar de rama
						</div>
						<div className="tree-confirm-body">
							{abandoned > 0 ? (
								<>
									Vas a abandonar la rama actual ({abandoned}{" "}
									{abandoned === 1 ? "entrada" : "entradas"}). ¿Resumirla y anclar el
									resumen en la nueva posición?
									<div className="tree-opts">
										<button
											className={"tree-opt" + (sumChoice === "no" ? " sel" : "")}
											onClick={() => setSumChoice("no")}
										>
											<Codicon
												name={sumChoice === "no" ? "circle-filled" : "circle-outline"}
												size={13}
											/>
											No resumir
										</button>
										<button
											className={"tree-opt" + (sumChoice === "yes" ? " sel" : "")}
											onClick={() => setSumChoice("yes")}
										>
											<Codicon
												name={sumChoice === "yes" ? "circle-filled" : "circle-outline"}
												size={13}
											/>
											Resumir (prompt por defecto)
										</button>
										<button
											className={"tree-opt" + (sumChoice === "custom" ? " sel" : "")}
											onClick={() => setSumChoice("custom")}
										>
											<Codicon
												name={sumChoice === "custom" ? "circle-filled" : "circle-outline"}
												size={13}
											/>
											Resumir con instrucciones personalizadas…
										</button>
									</div>
									{sumChoice === "custom" && (
										<textarea
											className="tree-custom"
											value={customText}
											placeholder="Enfoca el resumen en… (ej. decisiones de arquitectura)"
											onChange={(e) => setCustomText(e.target.value)}
											rows={3}
										/>
									)}
								</>
							) : (
								<>
									Volverás a este punto de la ruta actual: no se abandona ninguna rama.
								</>
							)}
						</div>
						<div className="tree-confirm-actions">
							<button className="btn-secondary" onClick={() => setPending(null)}>
								Cancelar
							</button>
							<button className="btn-primary" onClick={confirmNavigate}>
								Continuar aquí
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
