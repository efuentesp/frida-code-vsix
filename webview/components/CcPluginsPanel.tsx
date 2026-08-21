import { useEffect, useMemo, useRef, useState } from "react";
import { Codicon } from "./Codicon";
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
	// Vista completa de un plugin instalado (⏎ en Instalados) + selector de
	// estado binario on/off (decisión: pantalla completa + Ctrl+Espacio).
	const [instView, setInstView] = useState<string | null>(null);
	// Recurso enfocado en la vista completa (Instalados lista RECURSOS por
	// tipo — paridad Claude: skills una por una, plugin = origen).
	const [resView, setResView] = useState<string | null>(null);
	const [stateIdx, setStateIdx] = useState(0);
	// Acciones en vuelo (optimista): ref → etiqueta corta ("instalando…").
	// Se limpia cuando llega el re-emit completo (éxito O error — el host
	// refresca en ambos) + timeout de seguridad de 20s por acción.
	const [pending, setPending] = useState<Map<string, string>>(new Map());
	const [pendingMkt, setPendingMkt] = useState<string | null>(null);
	// Secciones colapsadas en Instalados (skill/cmd/mcp) — menos scroll.
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
		new Map(),
	);
	const [addSpec, setAddSpec] = useState("");
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const addInputRef = useRef<HTMLInputElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const tabs: {
		key: Tab;
		label: string;
		iconName: string;
		count?: number;
	}[] = [
		{
			key: "discover",
			label: "Discover",
			iconName: "search",
			count: panel.rows.length,
		},
		{
			key: "installed",
			label: "Instalados",
			iconName: "package",
			count: panel.resources.length,
		},
		{
			key: "marketplaces",
			label: "Marketplaces",
			iconName: "extensions",
			count: panel.marketplaces.length,
		},
		...(panel.errors.length
			? [
					{
						key: "errors" as Tab,
						label: "Errores",
						iconName: "warning",
						count: panel.errors.length,
					},
				]
			: []),
	];

	// Discover lista plugins disponibles; Instalados lista RECURSOS.
	const activeRows = useMemo(() => panel.rows, [panel]);
	const menuMkt = useMemo(
		() =>
			mktMenu ? panel.marketplaces.find((m) => m.name === mktMenu) : undefined,
		[mktMenu, panel.marketplaces],
	);
	const inMktMenu = tab === "marketplaces" && !!mktMenu;
	const inInstView = tab === "installed" && !!instView;
	const inResView = tab === "installed" && !!resView && !instView;
	const viewRow = useMemo(
		() =>
			instView ? panel.installed.find((r) => r.ref === instView) : undefined,
		[instView, panel.installed],
	);
	const showSearch =
		(tab === "discover" || tab === "installed" || tab === "marketplaces") &&
		!inMktMenu &&
		!inInstView &&
		!inResView;

	const filteredResources = useMemo(() => {
		if (tab !== "installed" || inInstView || inResView) return [];
		const q = query.trim().toLowerCase();
		if (!q) return panel.resources;
		if (q.startsWith("@"))
			return panel.resources.filter((r) =>
				r.pluginRef.toLowerCase().includes(q.slice(1)),
			);
		return panel.resources.filter((r) =>
			`${r.name} ${r.plugin} ${r.kind}`.toLowerCase().includes(q),
		);
	}, [tab, panel.resources, query, inInstView, inResView]);
	// La navegación (↑↓/⏎/Espacio) opera solo sobre recursos VISIBLES:
	// los de secciones colapsadas quedan fuera del orden.
	const visibleResources = useMemo(
		() => filteredResources.filter((r) => !collapsed.has(r.kind)),
		[filteredResources, collapsed],
	);

	const filteredRows = useMemo(() => {
		if (tab !== "discover") return [];
		const q = query.trim().toLowerCase();
		if (!q) return activeRows;
		// "@nombre" filtra por marketplace de origen (ref = plugin@mkt) —
		// es el destino de "Explorar plugins" del menú secuencial.
		if (q.startsWith("@")) {
			const m = q.slice(1);
			return activeRows.filter((r) => {
				const at = r.ref.lastIndexOf("@");
				return (
					at >= 0 &&
					r.ref
						.slice(at + 1)
						.toLowerCase()
						.includes(m)
				);
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
				: tab === "installed"
					? visibleResources.length
					: filteredRows.length;

	useEffect(() => {
		setFocusIdx((i) => Math.min(i, Math.max(0, itemCount - 1)));
	}, [itemCount]);

	const row = filteredRows[focusIdx];
	const resRow = useMemo(
		() => (resView ? panel.resources.find((r) => r.name === resView) : undefined),
		[resView, panel.resources],
	);
	const resItem = visibleResources[focusIdx];
	const mkt = inMktMenu ? menuMkt : filteredMkts[focusIdx];
	const err = panel.errors[focusIdx];

	// "Last updated" async de la fila enfocada (debounce).
	useEffect(() => {
		if (tab !== "discover") return;
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

	const markPending = (ref: string, label: string) => {
		setPending((m) => new Map(m).set(ref, label));
		const t = setTimeout(() => {
			setPending((m) => {
				const c = new Map(m);
				c.delete(ref);
				return c;
			});
			pendingTimers.current.delete(ref);
		}, 20_000);
		pendingTimers.current.set(ref, t);
	};

	// Re-emit COMPLETO (sin _patch) = toda acción terminó → limpiar ⏳.
	useEffect(() => {
		if (panel._patch) return;
		for (const t of pendingTimers.current.values()) clearTimeout(t);
		pendingTimers.current.clear();
		setPending(new Map());
		setPendingMkt(null);
	}, [panel]);

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

	const buttons = inResView
		? [
				{ key: "res_plugin", label: "Ver plugin →", primary: false },
				{
					key: stateIdx === 0 ? "disable" : "enable",
					label: stateIdx === 0 ? "Deshabilitar" : "Habilitar",
					primary: true,
				},
			]
		: inInstView
			? [
					{
						key: "disable",
						label: "Deshabilitar",
						primary: true,
					},
					{ key: "uninstall", label: "Desinstalar", primary: false },
				]
			: tab === "marketplaces" || tab === "installed"
				? []
				: tab === "errors"
					? [{ key: "retry", label: "Reintentar", primary: true }]
					: pluginButtons;

	useEffect(() => {
		setFocusBtn((i) => Math.min(i, Math.max(0, buttons.length - 1)));
	}, [buttons.length, tab]);

	const submitBtn = (key: string, target?: { ref: string }) => {
		if (tab === "errors" && err) {
			if (key === "retry")
				onAction(panel.id, { kind: "retry", source: err.source });
			return;
		}
		if (key === "res_plugin" && resRow) {
			// Vista de recurso → vista del plugin dueño (desinstalar, costo…).
			setInstView(resRow.pluginRef);
			setStateIdx(resRow.status === "disabled" ? 1 : 0);
			return;
		}
		const r = target ?? row;
		if (r) {
			markPending(
				r.ref,
				key === "install"
					? "instalando…"
					: key === "uninstall"
						? "desinstalando…"
						: "alternando…",
			);
			onAction(panel.id, {
				kind: key as "install" | "uninstall" | "enable" | "disable",
				ref: r.ref,
			});
		}
	};

	const switchTab = (t: Tab) => {
		setTab(t);
		setFocusIdx(0);
		setFocusBtn(0);
		setZone("list");
		setMktMenu(null);
		setConfirmRemove(false);
		setAddOpen(false);
		setInstView(null);
		setResView(null);
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
			setPendingMkt("update");
			onAction(panel.id, { kind: "mkt_update", name: m.name });
			return;
		}
		if (!confirmRemove) {
			setConfirmRemove(true);
			return;
		}
		setConfirmRemove(false);
		setMktMenu(null);
		setPendingMkt("remove");
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
			if (inInstView) {
				setInstView(null);
				return;
			}
			if (inResView) {
				setResView(null);
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
		if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// Espacio = toggle rápido (paridad Claude: "Space to toggle").
			// Los nombres de recursos/plugins no llevan espacios → el filtro
			// jamás necesita uno; el preventDefault evita que llegue al input.
			// En Instalados alterna el PLUGIN dueño del recurso enfocado.
			if (tab === "installed" && !inInstView && !inResView && resItem) {
				e.preventDefault();
				onAction(panel.id, {
					kind: resItem.status === "disabled" ? "enable" : "disable",
					ref: resItem.pluginRef,
				});
			}
			return;
		}
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
		// Vista de recurso: ↑↓/←→ estado · ⏎ fija si difiere.
		if (inResView && resRow && zone === "list") {
			if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
				e.preventDefault();
				setStateIdx((i) => 1 - i);
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				const cur = resRow.status === "disabled" ? 1 : 0;
				if (stateIdx !== cur)
					onAction(panel.id, {
						kind: stateIdx === 0 ? "enable" : "disable",
						ref: resRow.pluginRef,
					});
				return;
			}
			return; // la vista captura el resto
		}
		// Vista completa de instalado: ↑↓/←→ estado · ⏎ fija si difiere.
		if (inInstView && viewRow && zone === "list") {
			if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
				e.preventDefault();
				setStateIdx((i) => 1 - i);
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				const cur = viewRow.status === "disabled" ? 1 : 0;
				if (stateIdx !== cur)
					onAction(panel.id, {
						kind: stateIdx === 0 ? "enable" : "disable",
						ref: viewRow.ref,
					});
				return;
			}
			return; // la vista captura el resto (nada de filtrar con teclas)
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
		if (
			tab === "installed" &&
			!inInstView &&
			!inResView &&
			zone === "list" &&
			(e.key === "ArrowLeft" || e.key === "ArrowRight")
		) {
			// Acordeón: ← pliega la sección del recurso enfocado · → despliega.
			e.preventDefault();
			const kind = resItem?.kind;
			if (!kind) return;
			setCollapsed((prev) => {
				const next = new Set(prev);
				if (e.key === "ArrowLeft") next.add(kind);
				else next.delete(kind);
				return next;
			});
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
			if (tab === "installed" && zone === "list" && resItem) {
				// ⏎ en Instalados abre la vista del RECURSO (Enter to view).
				setResView(resItem.name);
				setStateIdx(resItem.status === "disabled" ? 1 : 0);
				return;
			}
			const b = zone === "buttons" ? buttons[focusBtn] : buttons[0];
			if (b) submitBtn(b.key);
		}
	};

	const footerHint = addOpen
		? "⏎ agregar · Esc cancelar"
		: inInstView
			? "↑↓ estado · ⏎ fijar · Tab acciones · Esc volver"
			: inResView
				? "↑↓ estado del plugin · ⏎ fijar · Tab acciones · Esc volver"
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
									: tab === "installed"
										? "↑↓ recurso · Espacio alterna plugin · ⏎ detalle · ←/→ pliega sección"
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
		<div className="ccp-panel" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
			<div className="ccp-tabs" data-focused={zone === "tabs" ? "true" : "false"}>
				{tabs.map((t) => (
					<button
						key={t.key}
						type="button"
						tabIndex={-1}
						className={`ccp-tab${tab === t.key ? " ccp-tab-active" : ""}`}
						onClick={() => switchTab(t.key)}
					>
						<Codicon name={t.iconName} size={12} />
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
					<Codicon name="close" size={14} />
				</button>
			</div>
			{showSearch ? (
				<div className="ccp-head">
					<Codicon name="search" size={14} />
					<span className="ccp-title">{panel.title}</span>
					<input
						ref={inputRef}
						className="ccp-search"
						value={query}
						placeholder={
							tab === "marketplaces"
								? "Filtrar marketplaces · ↑↓ mover · ⏎ menú"
								: tab === "installed"
									? "Filtrar recursos (skills · commands · MCP)"
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
									<button
										type="button"
										tabIndex={-1}
										className="ccp-back"
										onClick={() => {
											setConfirmRemove(false);
											setMktMenu(null);
										}}
									>
										← Volver
									</button>
									<span className="ccp-mkt-name">✻ {menuMkt.name}</span>
									<span className="ccp-mkt-url">{menuMkt.url}</span>
									<span className="ccp-mkt-stats">
										{menuMkt.plugins} plugins disponibles
										{menuMkt.refreshedAt ? ` · Actualizado ${menuMkt.refreshedAt}` : ""}
										{menuMkt.autoUpdate ? (
											<>
												{" · "}
												<Codicon name="refresh" size={11} className="ccp-mkt-auto" />
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
										disabled={pendingMkt !== null}
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
										{pendingMkt && i === 1 ? (
											<span className="ccp-pend">⏳ actualizando…</span>
										) : (
											label
										)}
									</button>
								))}
							</div>
						</div>
					) : (
						<div className="ccp-mkt-full">
							<div className="ccp-list ccp-list-full" ref={listRef}>
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
												<Codicon name="refresh" size={11} className="ccp-mkt-auto" />
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
									data-focused={focusIdx === filteredMkts.length ? "true" : "false"}
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
				) : tab === "installed" ? (
					inResView && resRow ? (
						<div className="ccp-mkt-full">
							<div className="ccp-instview">
								<div className="ccp-instview-head">
									<button
										type="button"
										tabIndex={-1}
										className="ccp-back"
										onClick={() => setResView(null)}
									>
										← Volver
									</button>
									<span className="ccp-instview-name">{resRow.name}</span>
									<span className={`ccp-badge ${STATUS_CLS[resRow.status]}`}>
										{STATUS_LABEL[resRow.status]}
									</span>
									<span className="ccp-comp">{resRow.kind}</span>
								</div>
								{resRow.description ? (
									<div className="ccp-instview-desc">{resRow.description}</div>
								) : null}
								<div className="ccp-instview-fields">
									<div>
										<span className="ccp-instview-k">Tipo</span>
										<span>
											{resRow.kind === "skill"
												? "skill"
												: resRow.kind === "cmd"
													? "command (prompt)"
													: "servidor MCP"}
										</span>
									</div>
									<div>
										<span className="ccp-instview-k">Origen</span>
										<span>
											{resRow.plugin} ·{" "}
											{resRow.pluginRef.slice(resRow.pluginRef.lastIndexOf("@") + 1)}
										</span>
									</div>
									<div>
										<span className="ccp-instview-k">Costo</span>
										<span>{resRow.tokens ? `~${resRow.tokens} tokens/turno` : "—"}</span>
									</div>
									<div>
										<span className="ccp-instview-k">Path</span>
										<span className="ccp-instview-path">{resRow.path ?? "—"}</span>
									</div>
								</div>
								<div className="ccp-instview-state">
									<div className="ccp-instview-state-label">
										Estado (afecta a TODO el plugin {resRow.plugin}):
									</div>
									{(["habilitado", "deshabilitado"] as const).map((label, i) => (
										<button
											key={label}
											type="button"
											tabIndex={-1}
											className="ccp-instview-opt"
											data-focused={zone === "list" && i === stateIdx ? "true" : "false"}
											onClick={() => {
												setStateIdx(i);
												const cur = resRow.status === "disabled" ? 1 : 0;
												if (i !== cur)
													onAction(panel.id, {
														kind: i === 0 ? "enable" : "disable",
														ref: resRow.pluginRef,
													});
											}}
										>
											<span className="ccp-mkt-opt-cursor">
												{zone === "list" && i === stateIdx ? "❯" : " "}
											</span>
											{i === 0 ? "◉" : "◯"} {label}
										</button>
									))}
								</div>
								<div
									className={`ccp-actions${zone === "buttons" ? " ccp-actions-focus" : ""}`}
								>
									{buttons.map((b, i) => (
										<button
											key={b.key}
											type="button"
											tabIndex={-1}
											disabled={pending.has(resRow.pluginRef)}
											className={`ccp-btn${b.primary ? " ccp-btn-primary" : ""}${
												zone === "buttons" && i === focusBtn ? " ccp-btn-focus" : ""
											}`}
											onClick={() => submitBtn(b.key, { ref: resRow.pluginRef })}
										>
											{b.primary && pending.has(resRow.pluginRef) ? (
												<>
													<span className="ccp-spin">⟳</span> {pending.get(resRow.pluginRef)}
												</>
											) : (
												b.label
											)}
										</button>
									))}
								</div>
							</div>
						</div>
					) : inInstView && viewRow ? (
						<div className="ccp-mkt-full">
							<div className="ccp-instview">
								<div className="ccp-instview-head">
									<button
										type="button"
										tabIndex={-1}
										className="ccp-back"
										onClick={() => setInstView(null)}
									>
										← Volver
									</button>
									<span className="ccp-instview-name">
										{viewRow.label}
										{viewRow.version ? ` v${viewRow.version}` : ""}
									</span>
									<span className={`ccp-badge ${STATUS_CLS[viewRow.status]}`}>
										{STATUS_LABEL[viewRow.status]}
									</span>
								</div>
								{viewRow.description ? (
									<div className="ccp-instview-desc">{viewRow.description}</div>
								) : null}
								<div className="ccp-instview-fields">
									<div>
										<span className="ccp-instview-k">Origen</span>
										<span>{viewRow.ref.slice(viewRow.ref.lastIndexOf("@") + 1)}</span>
									</div>
									<div>
										<span className="ccp-instview-k">Costo</span>
										<span>
											{viewRow.tokens ? `~${viewRow.tokens} tokens/turno` : "—"}
										</span>
									</div>
									<div>
										<span className="ccp-instview-k">Componentes</span>
										<span>{viewRow.components?.join(" · ") ?? "—"}</span>
									</div>
									<div>
										<span className="ccp-instview-k">Path</span>
										<span className="ccp-instview-path">{viewRow.path ?? "—"}</span>
									</div>
								</div>
								<div className="ccp-instview-state">
									<div className="ccp-instview-state-label">Estado:</div>
									{(["habilitado", "deshabilitado"] as const).map((label, i) => (
										<button
											key={label}
											type="button"
											tabIndex={-1}
											className="ccp-instview-opt"
											data-focused={zone === "list" && i === stateIdx ? "true" : "false"}
											onClick={() => {
												setStateIdx(i);
												const cur = viewRow.status === "disabled" ? 1 : 0;
												if (i !== cur)
													onAction(panel.id, {
														kind: i === 0 ? "enable" : "disable",
														ref: viewRow.ref,
													});
											}}
										>
											<span className="ccp-mkt-opt-cursor">
												{zone === "list" && i === stateIdx ? "❯" : " "}
											</span>
											{i === 0 ? "◉" : "◯"} {label}
										</button>
									))}
								</div>
								{viewRow.description ? null : (
									<div className="ccp-detail-md">
										<Markdown>{viewRow.markdown}</Markdown>
									</div>
								)}
								<div
									className={`ccp-actions${zone === "buttons" ? " ccp-actions-focus" : ""}`}
								>
									{(viewRow.status === "installed"
										? [
												{ key: "disable", label: "Deshabilitar", primary: true },
												{ key: "uninstall", label: "Desinstalar", primary: false },
											]
										: [
												{ key: "enable", label: "Habilitar", primary: true },
												{ key: "uninstall", label: "Desinstalar", primary: false },
											]
									).map((b, i) => (
										<button
											key={b.key}
											type="button"
											tabIndex={-1}
											disabled={pending.has(viewRow.ref)}
											className={`ccp-btn${b.primary ? " ccp-btn-primary" : ""}${
												zone === "buttons" && i === focusBtn ? " ccp-btn-focus" : ""
											}`}
											onClick={() => submitBtn(b.key, viewRow)}
										>
											{b.primary && pending.has(viewRow.ref) ? (
												<>
													<span className="ccp-spin">⟳</span> {pending.get(viewRow.ref)}
												</>
											) : (
												b.label
											)}
										</button>
									))}
								</div>
							</div>
						</div>
					) : (
						<div className="ccp-list ccp-list-full" ref={listRef}>
							{(["skill", "cmd", "mcp"] as const).map((kind) => {
								const items = visibleResources.filter((r) => r.kind === kind);
								const total = filteredResources.filter((r) => r.kind === kind).length;
								if (!total) return null;
								const isCol = collapsed.has(kind);
								return (
									<div key={kind} className="ccp-res-section">
										<button
											type="button"
											tabIndex={-1}
											className="ccp-res-header"
											title={isCol ? "Desplegar (→)" : "Plegar (←)"}
											onClick={() =>
												setCollapsed((prev) => {
													const next = new Set(prev);
													if (isCol) next.delete(kind);
													else next.add(kind);
													return next;
												})
											}
										>
											<span className="ccp-res-caret">
												{isCol ? (
													<Codicon name="add" size={14} />
												) : (
													<Codicon name="remove" size={14} />
												)}
											</span>
											{kind === "skill"
												? "Skills"
												: kind === "cmd"
													? "Commands"
													: "Servidores MCP"}
											<span className="ccp-res-count">{total}</span>
										</button>
										{isCol
											? null
											: items.map((r) => {
													const i = visibleResources.indexOf(r);
													return (
														<button
															key={r.name}
															type="button"
															tabIndex={-1}
															className={`ccp-res-row${i === focusIdx ? " ccp-row-focus" : ""}`}
															data-focused={i === focusIdx ? "true" : "false"}
															onClick={() => {
																setFocusIdx(i);
																setResView(r.name);
																setStateIdx(r.status === "disabled" ? 1 : 0);
															}}
														>
															<span className="ccp-mkt-opt-cursor">
																{i === focusIdx ? "❯" : " "}
															</span>
															<span className="ccp-row-label">{r.name}</span>
															<span className="ccp-comp">{r.kind}</span>
															<span className="ccp-res-plugin">de {r.plugin}</span>
															{r.tokens ? (
																<span className="ccp-row-tok">~{r.tokens} tok</span>
															) : null}
															{pending.has(r.pluginRef) ? (
																<span className="ccp-pend">⏳ {pending.get(r.pluginRef)}</span>
															) : null}
															<button
																type="button"
																tabIndex={-1}
																className={`ccp-switch${r.status === "installed" ? " ccp-switch-on" : ""}`}
																title={
																	r.status === "installed"
																		? "Habilitado — click para deshabilitar (afecta a todo el plugin)"
																		: "Deshabilitado — click para habilitar (afecta a todo el plugin)"
																}
																onClick={(ev) => {
																	ev.stopPropagation();
																	onAction(panel.id, {
																		kind: r.status === "disabled" ? "enable" : "disable",
																		ref: r.pluginRef,
																	});
																}}
															>
																<span className="ccp-switch-knob" />
															</button>
														</button>
													);
												})}
									</div>
								);
							})}
							{filteredResources.length ? null : (
								<div className="ccp-empty">
									Sin recursos instalados{query ? ` para “${query}”` : ""}.
								</div>
							)}
						</div>
					)
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
								{r.components?.map((c) => (
									<span key={c} className="ccp-comp">
										{c}
									</span>
								))}
								{r.version ? <span className="ccp-row-ver">v{r.version}</span> : null}
								{r.tokens ? <span className="ccp-row-tok">~{r.tokens} tok</span> : null}
								{pending.has(r.ref) ? (
									<span className="ccp-pend">⏳ {pending.get(r.ref)}</span>
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
				{tab === "errors" || tab === "discover" ? (
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
									{row.lastUpdated ? <span>· Actualizado {row.lastUpdated}</span> : null}
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
										disabled={row ? pending.has(row.ref) : false}
										className={`ccp-btn${b.primary ? " ccp-btn-primary" : ""}${
											zone === "buttons" && i === focusBtn ? " ccp-btn-focus" : ""
										}`}
										onClick={() => submitBtn(b.key)}
									>
										{b.primary && row && pending.has(row.ref) ? (
											<>
												<span className="ccp-spin">⟳</span> {pending.get(row.ref)}
											</>
										) : (
											b.label
										)}
									</button>
								))}
							</div>
						) : null}
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
						<div className="ccp-modal-actions">
							<button
								type="button"
								tabIndex={-1}
								className="ccp-btn ccp-btn-primary"
								disabled={!addSpec.trim() || pendingMkt === "add"}
								onClick={() => {
									if (!addSpec.trim()) return;
									setPendingMkt("add");
									onAction(panel.id, { kind: "mkt_add", value: addSpec.trim() });
									setAddSpec("");
									setAddOpen(false);
								}}
							>
								{pendingMkt === "add" ? (
									<>
										<span className="ccp-spin">⟳</span> Agregando…
									</>
								) : (
									"Agregar"
								)}
							</button>
							<button
								type="button"
								tabIndex={-1}
								className="ccp-btn"
								onClick={() => setAddOpen(false)}
							>
								Cancelar
							</button>
						</div>
						<div className="ccp-modal-hint">⏎ agregar · Esc cancelar</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
