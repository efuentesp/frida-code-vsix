import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Package, RefreshCw, Search, Store, X } from "lucide-react";
import { Markdown } from "./Markdown";
import type { CcPanelErrorWs, CcPanelRowWs, CcPanelWs } from "../types";

// CcPluginsPanel — panel nativo de /ccplugin (UX #49, rediseño e2e v3):
// estructura tipo /plugins de Claude Code: tabs Discover | Instalados |
// Marketplaces | Errores (oculta si no hay errores, badge con el conteo).
// Discover/Instalados: lista filtrable (@marketplace filtra por origen) +
// ficha lado a lado. Marketplaces: tarjetas; ⏎ abre el MENÚ SECUENCIAL del
// marketplace (Explorar plugins → Discover con filtro @mkt · Actualizar ·
// Quitar con confirmación inline de doble-⏎); la fila final "＋ Agregar"
// abre un diálogo modal con los 4 sources. Errores: lista con Reintentar.
//
// Zonas de foco (QuestionsPanel-style): "tabs" | "list" | "buttons".
// Keymap: Tab cicla zonas · en tabs: ←/→ o 1-4 cambia tab · en list: escribir
// filtra, ↑↓ mueve (ficha en vivo), ⏎ abre/acción primaria · Esc sube niveles
// (confirmar-quitar → menú → zona → cerrar). El id del panel es estable entre
// refreshes → tab, filtro y foco se conservan tras cada acción.

export type CcPanelActionMsg =
	| { kind: "install" | "uninstall" | "enable" | "disable"; ref: string }
	| { kind: "mkt_add"; value: string }
	| { kind: "mkt_remove" | "mkt_update"; name?: string }
	| { kind: "retry"; source: CcPanelErrorWs["source"] };

interface Props {
	panel: CcPanelWs;
	onAction: (id: string, action: CcPanelActionMsg) => void;
	onRowMeta: (id: string, ref: string) => void;
	onClose: (id: string) => void;
}

type Tab = "discover" | "installed" | "marketplaces" | "errors";
type Zone = "tabs" | "list" | "buttons";

/** Ranking subsequence (mismo espíritu que el autocompletado de "/" y "@"). */
function subseqScore(text: string, q: string): number {
	let ti = 0,
		qi = 0,
		score = 0,
		consecutive = 0;
	while (ti < text.length && qi < q.length) {
		if (text[ti] === q[qi]) {
			consecutive++;
			score += 1 + consecutive;
			qi++;
		} else consecutive = 0;
		ti++;
	}
	return qi < q.length ? -1 : score;
}

const STATUS_LABEL: Record<CcPanelRowWs["status"], string> = {
	available: "",
	installed: "instalado",
	disabled: "deshabilitado",
};
const STATUS_CLS: Record<CcPanelRowWs["status"], string> = {
	available: "",
	installed: "ccp-badge-on",
	disabled: "ccp-badge-off",
};

export function CcPluginsPanel({ panel, onAction, onRowMeta, onClose }: Props) {
	const [tab, setTab] = useState<Tab>("discover");
	const [zone, setZone] = useState<Zone>("list");
	const [query, setQuery] = useState("");
	const [focusIdx, setFocusIdx] = useState(0);
	const [focusBtn, setFocusBtn] = useState(0);
	// Sub-vistas de Marketplaces: menú secuencial del mkt enfocado + diálogo
	// modal de agregar (estilo Add Marketplace de Claude Code).
	const [mktMenu, setMktMenu] = useState<string | null>(null);
	const [menuIdx, setMenuIdx] = useState(0);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [addOpen, setAddOpen] = useState(false);
	const [addSpec, setAddSpec] = useState("");
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const addInputRef = useRef<HTMLInputElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const tabs: { key: Tab; label: string; icon: typeof Search; count?: number }[] =
		[
			{ key: "discover", label: "Discover", icon: Search, count: panel.rows.length },
			{
				key: "installed",
				label: "Instalados",
				icon: Package,
				count: panel.installed.length,
			},
			{
				key: "marketplaces",
				label: "Marketplaces",
				icon: Store,
				count: panel.marketplaces.length,
			},
			...(panel.errors.length
				? [
						{
							key: "errors" as Tab,
							label: "Errores",
							icon: AlertTriangle,
							count: panel.errors.length,
						},
					]
				: []),
		];

	// Filas de la tab activa.
	const activeRows = useMemo(
		() => (tab === "installed" ? panel.installed : panel.rows),
		[tab, panel],
	);
	const menuMkt = useMemo(
		() =>
			mktMenu
				? panel.marketplaces.find((m) => m.name === mktMenu)
				: undefined,
		[mktMenu, panel.marketplaces],
	);
	const inMktMenu = tab === "marketplaces" && !!mktMenu;
	const showSearch =
		(tab === "discover" || tab === "installed" || tab === "marketplaces") &&
		!inMktMenu;

	const filteredRows = useMemo(() => {
		if (tab === "marketplaces" || tab === "errors") return [];
		const q = query.trim().toLowerCase();
		if (!q) return activeRows;
		// "@nombre" filtra por marketplace de origen (ref = plugin@mkt) —
		// es el destino de "Explorar plugins" del menú secuencial.
		if (q.startsWith("@")) {
			const m = q.slice(1);
			return activeRows.filter((r) => {
				const at = r.ref.lastIndexOf("@");
				return at >= 0 && r.ref.slice(at + 1).toLowerCase().includes(m);
			});
		}
		return activeRows
			.map((r) => ({
				r,
				score: subseqScore(
					`${r.label} ${r.ref} ${r.category ?? ""}`.toLowerCase(),
					q,
				),
			}))
			.filter((x) => x.score >= 0)
			.map((x) => x.r);
	}, [tab, activeRows, query]);

	const filteredMkts = useMemo(() => {
		if (tab !== "marketplaces") return [];
		const q = query.trim().toLowerCase();
		if (!q) return panel.marketplaces;
		return panel.marketplaces.filter((m) =>
			`${m.name} ${m.url}`.toLowerCase().includes(q),
		);
	}, [tab, panel.marketplaces, query]);

	// Ítems navegables de la tab activa (filas / tarjetas+agregar / errores).
	const itemCount =
		tab === "marketplaces"
			? filteredMkts.length + 1 // + la fila final "＋ Agregar marketplace"
			: tab === "errors"
				? panel.errors.length
				: filteredRows.length;

	useEffect(() => {
		setFocusIdx((i) => Math.min(i, Math.max(0, itemCount - 1)));
	}, [itemCount]);

	const row = filteredRows[focusIdx];
	const mkt = inMktMenu ? menuMkt : filteredMkts[focusIdx];
	const err = panel.errors[focusIdx];

	// "Last updated" async de la fila enfocada (debounce).
	useEffect(() => {
		if (tab !== "discover" && tab !== "installed") return;
		if (!row || row.lastUpdated !== undefined) return;
		const t = setTimeout(() => onRowMeta(panel.id, row.ref), 250);
		return () => clearTimeout(t);
	}, [row?.ref, tab, panel.id, onRowMeta, row]);

	// Foco: search cuando es visible; raíz cuando no (errores / menú mkt) —
	// sin esto, las teclas no llegarían al panel en tabs sin input.
	useEffect(() => {
		if (showSearch) inputRef.current?.focus();
		else rootRef.current?.focus();
	}, [showSearch, panel.id, tab]);

	// Scroll del ítem enfocado a la vista.
	useEffect(() => {
		listRef.current
			?.querySelector('[data-focused="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [focusIdx, query, tab]);

	const move = (d: 1 | -1) =>
		setFocusIdx((i) => {
			if (!itemCount) return 0;
			return (i + d + itemCount) % itemCount;
		});

	const pluginButtons = useMemo(() => {
		if (!row) return [] as { key: string; label: string; primary: boolean }[];
		switch (row.status) {
			case "available":
				return [{ key: "install", label: "Instalar", primary: true }];
			case "installed":
				return [
					{ key: "disable", label: "Deshabilitar", primary: true },
					{ key: "uninstall", label: "Desinstalar", primary: false },
				];
			case "disabled":
				return [
					{ key: "enable", label: "Habilitar", primary: true },
					{ key: "uninstall", label: "Desinstalar", primary: false },
				];
		}
	}, [row]);

	const buttons =
		tab === "marketplaces" ? [] : tab === "errors" ? [{ key: "retry", label: "Reintentar", primary: true }] : pluginButtons;

	useEffect(() => {
		setFocusBtn((i) => Math.min(i, Math.max(0, buttons.length - 1)));
	}, [buttons.length, tab]);

	const submitBtn = (key: string) => {
		if (tab === "errors" && err) {
			if (key === "retry") onAction(panel.id, { kind: "retry", source: err.source });
			return;
		}
		if (row)
			onAction(panel.id, {
				kind: key as "install" | "uninstall" | "enable" | "disable",
				ref: row.ref,
			});
	};

	const switchTab = (t: Tab) => {
		setTab(t);
		setFocusIdx(0);
		setFocusBtn(0);
		setZone("list");
		setMktMenu(null);
		setConfirmRemove(false);
		setAddOpen(false);
	};

	// "Explorar plugins": Discover con filtro por origen (@marketplace).
	const browseMkt = (name: string) => {
		setMktMenu(null);
		setConfirmRemove(false);
		setTab("discover");
		setZone("list");
		setFocusIdx(0);
		setQuery(`@${name}`);
	};

	const openMenu = (name: string) => {
		setMktMenu(name);
		setMenuIdx(0);
		setConfirmRemove(false);
	};

	// Opción del menú secuencial (Enter / click): 0 explorar · 1 actualizar ·
	// 2 quitar (doble-⏎: la primera arma la confirmación inline).
	const runMenuOpt = (i: number) => {
		const m = menuMkt;
		if (!m) return;
		if (i === 0) {
			browseMkt(m.name);
			return;
		}
		if (i === 1) {
			onAction(panel.id, { kind: "mkt_update", name: m.name });
			return;
		}
		if (!confirmRemove) {
			setConfirmRemove(true);
			return;
		}
		setConfirmRemove(false);
		setMktMenu(null);
		onAction(panel.id, { kind: "mkt_remove", name: m.name });
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			if (addOpen) {
				setAddOpen(false);
				return;
			}
			if (inMktMenu) {
				if (confirmRemove) setConfirmRemove(false);
				else setMktMenu(null);
				return;
			}
			if (zone !== "list") {
				setZone("list");
				return;
			}
			onClose(panel.id);
			return;
		}
		if (addOpen) return; // el input del diálogo captura sus propias teclas
		if (e.key === "Tab") {
			e.preventDefault();
			const cycle: Zone[] = ["tabs", "list"];
			if (buttons.length) cycle.push("buttons");
			setZone(cycle[(cycle.indexOf(zone) + 1) % cycle.length]!);
			return;
		}
		if (zone === "tabs") {
			if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
				e.preventDefault();
				const i = tabs.findIndex((t) => t.key === tab);
				const n = tabs.length;
				switchTab(tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + n) % n]!.key);
				return;
			}
			const digit = Number(e.key);
			if (digit >= 1 && digit <= tabs.length) {
				e.preventDefault();
				switchTab(tabs[digit - 1]!.key);
				return;
			}
		}
		// Menú secuencial del marketplace: ↑↓ opciones · ⏎ ejecuta.
		if (inMktMenu && zone === "list") {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setConfirmRemove(false);
				setMenuIdx((i) => (i + (e.key === "ArrowDown" ? 1 : 3)) % 3);
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				runMenuOpt(menuIdx);
			}
			return;
		}
		if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
			e.preventDefault();
			setZone("list");
			move(1);
			return;
		}
		if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
			e.preventDefault();
			setZone("list");
			move(-1);
			return;
		}
		if (zone === "buttons" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
			e.preventDefault();
			setFocusBtn((i) => {
				const n = buttons.length;
				return n ? (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n : 0;
			});
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			if (tab === "marketplaces") {
				// Última fila = "＋ Agregar marketplace" → diálogo de origen.
				if (focusIdx >= filteredMkts.length) {
					setAddOpen(true);
					return;
				}
				if (mkt) openMenu(mkt.name);
				return;
			}
			const b = zone === "buttons" ? buttons[focusBtn] : buttons[0];
			if (b) submitBtn(b.key);
		}
	};

	const footerHint = addOpen
		? "⏎ agregar · Esc cancelar"
		: inMktMenu
			? confirmRemove
				? "⏎ confirmar quitar · Esc cancelar"
				: "↑↓ opción · ⏎ seleccionar · Esc volver"
			: zone === "tabs"
				? "←/→ o 1-4 cambia tab"
				: zone === "buttons"
					? "←/→ mover · ⏎ ejecutar"
					: tab === "marketplaces"
						? "↑↓ marketplace · ⏎ menú · “＋ Agregar” abre diálogo"
						: tab === "errors"
							? "↑↓ error · ⏎ reintentar"
							: `escribe filtra (@mkt por origen) · ↑↓ mueve · ⏎ ${buttons[0]?.label ?? "acción"} · Tab zonas`;

	const menuLabels = useMemo(() => {
		if (!menuMkt) return [] as string[];
		return [
			`Explorar plugins (${menuMkt.plugins})`,
			`Actualizar marketplace${menuMkt.refreshedAt ? ` (actualizado ${menuMkt.refreshedAt})` : ""}`,
			confirmRemove
				? `¿Quitar ${menuMkt.name}? — ⏎ confirmar · Esc cancelar`
				: "Quitar marketplace",
		];
	}, [menuMkt, confirmRemove]);

	return (
		<div
			className="ccp-panel"
			ref={rootRef}
			tabIndex={-1}
			onKeyDown={onKeyDown}
		>
			<div className="ccp-tabs" data-focused={zone === "tabs" ? "true" : "false"}>
				{tabs.map((t) => (
					<button
						key={t.key}
						type="button"
						tabIndex={-1}
						className={`ccp-tab${tab === t.key ? " ccp-tab-active" : ""}`}
						onClick={() => switchTab(t.key)}
					>
						<t.icon size={12} />
						{t.label}
						{typeof t.count === "number" ? (
							<span className="ccp-tab-count">{t.count}</span>
						) : null}
					</button>
				))}
				<span className="ccp-spacer" />
				<button
					type="button"
					className="ui-dialog-x"
					title="Cerrar (Esc)"
					onClick={() => onClose(panel.id)}
				>
					<X size={14} />
				</button>
			</div>
			{showSearch ? (
				<div className="ccp-head">
					<Search size={14} />
					<span className="ccp-title">{panel.title}</span>
					<input
						ref={inputRef}
						className="ccp-search"
						value={query}
						placeholder={
							tab === "marketplaces"
								? "Filtrar marketplaces · ↑↓ mover · ⏎ menú"
								: "Filtrar (escribe; @marketplace por origen) · ↑↓ mover · Tab zonas"
						}
						onChange={(e) => {
							setQuery(e.target.value);
							setFocusIdx(0);
						}}
					/>
				</div>
			) : null}
			<div className="ccp-body">
				{tab === "marketplaces" ? (
					inMktMenu && menuMkt ? (
						<div className="ccp-mkt-full">
							<div className="ccp-mkt-menu">
								<div className="ccp-mkt-menu-head">
									<span className="ccp-mkt-name">✻ {menuMkt.name}</span>
									<span className="ccp-mkt-url">{menuMkt.url}</span>
									<span className="ccp-mkt-stats">
										{menuMkt.plugins} plugins disponibles
										{menuMkt.refreshedAt
											? ` · Actualizado ${menuMkt.refreshedAt}`
											: ""}
										{menuMkt.autoUpdate ? (
											<>
												{" · "}
												<RefreshCw size={11} className="ccp-mkt-auto" />
												auto-update
											</>
										) : null}
									</span>
								</div>
								{menuLabels.map((label, i) => (
									<button
										key={label}
										type="button"
										tabIndex={-1}
										className={`ccp-mkt-opt${i === 2 && confirmRemove ? " ccp-mkt-opt-warn" : ""}`}
										data-focused={i === menuIdx ? "true" : "false"}
										onClick={() => {
											setMenuIdx(i);
											runMenuOpt(i);
										}}
									>
										<span className="ccp-mkt-opt-cursor">
											{i === menuIdx ? "❯" : " "}
										</span>
										{label}
									</button>
								))}
							</div>
						</div>
					) : (
						<div className="ccp-mkt-full">
							<div className="ccp-list" ref={listRef}>
								{filteredMkts.map((m, i) => (
									<button
										key={m.name}
										type="button"
										className={`ccp-mkt-card${i === focusIdx ? " ccp-row-focus" : ""}`}
										data-focused={i === focusIdx ? "true" : "false"}
										tabIndex={-1}
										onClick={() => {
											setFocusIdx(i);
											openMenu(m.name);
										}}
									>
										<span className="ccp-mkt-name">
											✻ {m.name}
											{m.autoUpdate ? (
												<RefreshCw size={11} className="ccp-mkt-auto" />
											) : null}
										</span>
										<span className="ccp-mkt-url">{m.url}</span>
										<span className="ccp-mkt-stats">
											{m.plugins} disponibles
											{m.refreshedAt ? ` · Actualizado ${m.refreshedAt}` : ""}
										</span>
									</button>
								))}
								<button
									type="button"
									className="ccp-add-item"
									data-focused={
										focusIdx === filteredMkts.length ? "true" : "false"
									}
									tabIndex={-1}
									onClick={() => {
										setFocusIdx(filteredMkts.length);
										setAddOpen(true);
									}}
								>
									＋ Agregar marketplace
								</button>
								{filteredMkts.length ? null : (
									<div className="ccp-empty">
										Sin marketplaces — usa “＋ Agregar marketplace”.
									</div>
								)}
							</div>
						</div>
					)
				) : tab === "errors" ? (
					<div className="ccp-list" ref={listRef}>
						{panel.errors.map((er, i) => (
							<button
								key={er.id}
								type="button"
								className={`ccp-err${i === focusIdx ? " ccp-row-focus" : ""}`}
								data-focused={i === focusIdx ? "true" : "false"}
								tabIndex={-1}
								onClick={() => setFocusIdx(i)}
								onDoubleClick={() => submitBtn("retry")}
							>
								<span className="ccp-err-badge">{er.source}</span>
								<span className="ccp-err-when">{er.when}</span>
								<span className="ccp-err-msg">{er.message}</span>
							</button>
						))}
						{panel.errors.length ? null : (
							<div className="ccp-empty">Sin errores.</div>
						)}
					</div>
				) : (
					<div className="ccp-list" ref={listRef}>
						{filteredRows.map((r, i) => (
							<div
								key={r.ref}
								className={`ccp-row${i === focusIdx ? " ccp-row-focus" : ""}`}
								data-focused={i === focusIdx ? "true" : "false"}
								onClick={() => setFocusIdx(i)}
								onDoubleClick={() => buttons[0] && submitBtn(buttons[0].key)}
							>
								<span className="ccp-row-label">{r.label}</span>
								{r.category ? <span className="ccp-cat">{r.category}</span> : null}
								{r.version ? (
									<span className="ccp-row-ver">v{r.version}</span>
								) : null}
								{r.status === "available" ? null : (
									<span className={`ccp-badge ${STATUS_CLS[r.status]}`}>
										{STATUS_LABEL[r.status]}
									</span>
								)}
							</div>
						))}
						{filteredRows.length ? null : (
							<div className="ccp-empty">Sin resultados para “{query}”.</div>
						)}
					</div>
				)}
				{tab === "errors" || tab === "discover" || tab === "installed" ? (
					<div className="ccp-detail">
						{tab === "errors" ? (
							<div className="ccp-detail-md">
								{err ? (
									<Markdown>{`## ${err.source}\n\n**${err.when}** — ${err.message}`}</Markdown>
								) : (
									<div className="ccp-empty">Sin error seleccionado.</div>
								)}
							</div>
						) : row ? (
							<>
								<div className="ccp-meta">
									{row.author ? <span>por {row.author}</span> : null}
									{row.lastUpdated ? (
										<span>· Actualizado {row.lastUpdated}</span>
									) : null}
									{row.homepage ? (
										<a href={row.homepage} target="_blank" rel="noreferrer">
											↗ homepage
										</a>
									) : null}
								</div>
								<div className="ccp-detail-md">
									<Markdown>{row.markdown}</Markdown>
								</div>
							</>
						) : (
							<div className="ccp-empty">Elige un plugin de la lista.</div>
						)}
						{buttons.length ? (
							<div
								className={`ccp-actions${zone === "buttons" ? " ccp-actions-focus" : ""}`}
							>
								{buttons.map((b, i) => (
									<button
										key={b.key}
										type="button"
										tabIndex={-1}
										className={`ccp-btn${b.primary ? " ccp-btn-primary" : ""}${
											zone === "buttons" && i === focusBtn ? " ccp-btn-focus" : ""
										}`}
										onClick={() => submitBtn(b.key)}
									>
										{b.label}
									</button>
								))}
							</div>
						) : null}
						<div className="ccp-actions">
							<button
								type="button"
								tabIndex={-1}
								className="ccp-btn"
								onClick={() => onClose(panel.id)}
							>
								Cerrar
							</button>
						</div>
					</div>
				) : null}
			</div>
			<div className="ccp-foot">{footerHint}</div>
			{addOpen ? (
				<div
					className="ccp-overlay"
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") {
							e.preventDefault();
							setAddOpen(false);
						}
					}}
				>
					<div className="ccp-modal">
						<div className="ccp-modal-title">Agregar marketplace</div>
						<div className="ccp-modal-label">Origen del marketplace:</div>
						<div className="ccp-modal-examples">
							<div>· owner/repo (GitHub)</div>
							<div>· https://git.example.com/owner/repo.git (URL git)</div>
							<div>· npm:paquete (npm)</div>
							<div>· https://ejemplo.com/plugin.zip (zip)</div>
						</div>
						<input
							ref={addInputRef}
							className="ccp-add-input"
							value={addSpec}
							placeholder="owner/repo · URL git · npm:paq · URL zip"
							autoFocus
							onChange={(e) => setAddSpec(e.target.value)}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Enter" && addSpec.trim()) {
									e.preventDefault();
									onAction(panel.id, { kind: "mkt_add", value: addSpec.trim() });
									setAddSpec("");
									setAddOpen(false);
								} else if (e.key === "Escape") {
									e.preventDefault();
									setAddOpen(false);
								} else if (e.key === "Tab") {
									e.preventDefault();
								}
							}}
						/>
						<div className="ccp-modal-hint">⏎ agregar · Esc cancelar</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
