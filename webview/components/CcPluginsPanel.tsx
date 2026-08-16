import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Markdown } from "./Markdown";
import type { CcPanelRowWs, CcPanelWs } from "../types";

// CcPluginsPanel — panel nativo de /ccplugin (UX #49, rediseño e2e):
// lista filtrable con teclado (como el autocompletado de "/" del composer) +
// ficha del plugin enfocado lado a lado. Reemplaza al UiDialog gigante (203
// filas sin filtro), a los toasts con listados y al QuickPick de VS Code
// (fuera del webview, roba foco, se cierra solo).
//
// Zonas de foco (QuestionsPanel-style): "list" (búsqueda + filas) | "buttons".
// Keymap: escribir = filtrar · ↑↓ mueve el foco (la ficha sigue en vivo) ·
// ⏎ acción primaria de la fila (instalar / alternar habilitado) · Tab cicla
// lista → botones · Esc cierra el panel.
//
// El id del panel es estable entre refreshes (tras una acción, el host
// re-emite filas frescas con el MISMO id) → filtro y foco se conservan.

interface Props {
	panel: CcPanelWs;
	onAction: (
		id: string,
		action: "install" | "uninstall" | "enable" | "disable",
		ref: string,
	) => void;
	onClose: (id: string) => void;
}

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

type Zone = "list" | "buttons";

const STATUS_BADGE: Record<CcPanelRowWs["status"], string> = {
	available: "",
	installed: "ccp-badge-on",
	disabled: "ccp-badge-off",
};
const STATUS_LABEL: Record<CcPanelRowWs["status"], string> = {
	available: "",
	installed: "instalado",
	disabled: "deshabilitado",
};

export function CcPluginsPanel({ panel, onAction, onClose }: Props) {
	const [query, setQuery] = useState("");
	const [zone, setZone] = useState<Zone>("list");
	const [focusIdx, setFocusIdx] = useState(0);
	const [focusBtn, setFocusBtn] = useState(0);
	const listRef = useRef<HTMLUListElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Filtrado fuzzy sobre label+ref (case-insensitive).
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return panel.rows;
		return panel.rows
			.map((r) => ({
				r,
				score: subseqScore(`${r.label} ${r.ref}`.toLowerCase(), q),
			}))
			.filter((x) => x.score >= 0)
			.map((x) => x.r);
	}, [panel.rows, query]);

	// Clamp del foco cuando el filtrado cambia el conjunto.
	useEffect(() => {
		setFocusIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)));
	}, [filtered.length]);

	const row = filtered[focusIdx];
	const buttons = useMemo(() => {
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

	useEffect(() => {
		setFocusBtn((i) => Math.min(i, Math.max(0, buttons.length - 1)));
	}, [buttons.length]);

	// Foco inicial al input de búsqueda.
	useEffect(() => {
		inputRef.current?.focus();
	}, [panel.id]);

	// Scroll de la fila enfocada a la vista.
	useEffect(() => {
		listRef.current
			?.querySelector('[data-focused="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [focusIdx, query]);

	const move = (d: 1 | -1) =>
		setFocusIdx((i) => {
			const n = filtered.length;
			if (!n) return 0;
			return (i + d + n) % n;
		});

	const primary = () => {
		if (!row) return;
		const b = buttons[focusBtn] ?? buttons[0];
		if (!b) return;
		onAction(panel.id, b.key as "install" | "uninstall" | "enable" | "disable", row.ref);
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose(panel.id);
			return;
		}
		if (e.key === "Tab") {
			e.preventDefault();
			setZone((z) => (z === "list" ? "buttons" : "list"));
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
		if (e.key === "ArrowRight" && zone === "list") {
			e.preventDefault();
			setZone("buttons");
			setFocusBtn(0);
			return;
		}
		if (e.key === "ArrowLeft" && zone === "buttons") {
			e.preventDefault();
			setZone("list");
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			if (zone === "buttons") {
				if (row && buttons[focusBtn])
					onAction(
						panel.id,
						buttons[focusBtn]!.key as
							| "install"
							| "uninstall"
							| "enable"
							| "disable",
						row.ref,
					);
			} else {
				primary();
			}
		}
	};

	return (
		<div className="ccp-panel" onKeyDown={onKeyDown}>
			<div className="ccp-head">
				<Search size={14} />
				<span className="ccp-title">{panel.title}</span>
				<input
					ref={inputRef}
					className="ccp-search"
					value={query}
					placeholder="Filtrar (escribe); ↑↓ mover · ⏎ acción · Tab botones · Esc cerrar"
					onChange={(e) => {
						setQuery(e.target.value);
						setFocusIdx(0);
					}}
				/>
				<button
					type="button"
					className="ui-dialog-x"
					title="Cerrar (Esc)"
					onClick={() => onClose(panel.id)}
				>
					<X size={14} />
				</button>
			</div>
			<div className="ccp-body">
				<ul className="ccp-list" ref={listRef}>
					{filtered.map((r, i) => (
						<li key={r.ref}>
							<button
								type="button"
								className={`ccp-row${i === focusIdx ? " ccp-row-focus" : ""}`}
								data-focused={i === focusIdx ? "true" : "false"}
								tabIndex={-1}
								onClick={() => setFocusIdx(i)}
								onDoubleClick={() => primary()}
							>
								<span className="ccp-row-label">{r.label}</span>
								{r.version ? (
									<span className="ccp-row-ver">v{r.version}</span>
								) : null}
								{r.status === "available" ? null : (
									<span className={`ccp-badge ${STATUS_BADGE[r.status]}`}>
										{STATUS_LABEL[r.status]}
									</span>
								)}
							</button>
						</li>
					))}
					{filtered.length ? null : (
						<li className="ccp-empty">Sin resultados para “{query}”.</li>
					)}
				</ul>
				<div className="ccp-detail">
					{row ? (
						<>
							<div className="ccp-detail-md">
								<Markdown>{row.markdown}</Markdown>
							</div>
							<div className={`ccp-actions${zone === "buttons" ? " ccp-actions-focus" : ""}`}>
								{buttons.map((b, i) => (
									<button
										key={b.key}
										type="button"
										tabIndex={-1}
										className={`ccp-btn${b.primary ? " ccp-btn-primary" : ""}${
											zone === "buttons" && i === focusBtn ? " ccp-btn-focus" : ""
										}`}
										onClick={() =>
											onAction(
												panel.id,
												b.key as
													| "install"
													| "uninstall"
													| "enable"
													| "disable",
												row.ref,
											)
										}
									>
										{b.label}
									</button>
								))}
								<button
									type="button"
									tabIndex={-1}
									className="ccp-btn"
									onClick={() => onClose(panel.id)}
								>
									Cerrar
								</button>
							</div>
						</>
					) : (
						<div className="ccp-empty">Elige un plugin de la lista.</div>
					)}
				</div>
			</div>
			<div className="ccp-foot">
				{filtered.length} de {panel.rows.length} · ⏎ {buttons[0]?.label ?? "—"} · Esc
				cerrar
			</div>
		</div>
	);
}
