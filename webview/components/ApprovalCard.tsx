import type { ApprovalRequest } from "../types";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Diff } from "./Diff";

// Clasificación del tool para el hint del ApprovalCard: distinguimos las tools
// internas/nativas conocidas de un MCP/extensión de terceros real.
//   • READONLY_TOOLS: sólo leen/analizan, no mutan archivos del proyecto
//     (frida-lens + las nativas de lectura del SDK + el reporte de contexto).
//   • FRIDA_INTERNAL_TOOLS: extensiones de Frida que SÍ hacen cosas (mutan state,
//     lanzan sub-agentes, navegan web, preguntan): conocidas, pero conviene
//     revisar la acción antes de aceptar.
const READONLY_TOOLS = new Set([
	"project_report",
	"module_report",
	"symbol_search",
	"read_symbol",
	"read_enclosing",
	"lsp_diagnostics",
	"lens_diagnostics",
	"pi_lens_activate_tools",
	"read",
	"grep",
	"find",
	"ls",
	"context",
	"workflow_status",
	"workflow_catalog",
]);
const FRIDA_INTERNAL_TOOLS = new Set([
	"todo",
	"ask_user_question",
	"Agent",
	"get_subagent_result",
	"steer_subagent",
	"web_search",
	"web_fetch",
	"web_fetch_md",
	"web_docs_search",
	"web_docs_fetch",
	"agent_browser",
	"workflow",
	"workflow_stop",
	"workflow_respond",
	"workflow_retry",
	"workflow_resume",
]);

type ItemKey = "yes" | "pattern" | "no" | "reason";

interface MenuItem {
	key: ItemKey;
	label: string;
	letter: string;
}

// Icono de cabecera según el tipo de approval (sin ternarios anidados).
const ICON_BY_KIND: Record<ApprovalRequest["kind"], string> = {
	bash: "term",
	tool: "wrench",
	diff: "edit",
};

/** Título legible de la cabecera según el tipo. */
function approvalLabel(a: ApprovalRequest): string {
	if (a.kind === "bash") return "Ejecución de comando";
	if (a.kind === "tool") return `Herramienta — ${a.toolName}`;
	return `Edición de archivo${a.path ? ` — ${a.path}` : ""}`;
}

/** Máximo de líneas de comando visibles antes de activar scroll vertical.
 *  Más allá de este límite el recuadro hace scroll y muestra un contador
 *  "⌄ N líneas más" para que el usuario sepa que no ve todo de un vistazo (y no
 *  apruebe a ciegas un comando largo). */
const CMD_LINE_LIMIT = 10;

/** Recuadro del comando a ejecutar, con numeración de líneas y scroll vertical
 *  acotado a CMD_LINE_LIMIT. Patrón de Diff.tsx: divide el comando en líneas y
 *  renderiza cada una con su número a la izquierda (tenue, no seleccionable).
 *  Sin zebra striping — el número basta como guía visual. */
function CmdBlock({ command }: { command: string }) {
	const lines = command.replace(/\n+$/, "").split("\n");
	const overflow = Math.max(0, lines.length - CMD_LINE_LIMIT);
	return (
		<div className="cmd">
			<div className="cmd-scroll">
				{lines.map((ln, i) => (
					<div className="cmd-line" key={i}>
						<span className="cmd-num">{i + 1}</span>
						<span className="cmd-txt">{ln.length > 0 ? ln : " "}</span>
					</div>
				))}
			</div>
			{overflow > 0 && <div className="cmd-more">⌄ {overflow} líneas más</div>}
		</div>
	);
}

/**
 * Menú de aprobación navegable (réplica del selector de pi-permission-system).
 * 4 opciones en el orden canónico: Sí · Sí+patrón · No · No+motivo. Navegación
 * con ↑↓ + Enter + Esc, atajos de letra (Y/P/N/M) y mouse (clic / hover). La
 * opción "No, indicar motivo" reemplaza el menú por un input inline; el motivo
 * se inyecta en el tool_result que ve el modelo (vía el gate, index.ts).
 */
export function ApprovalCard({
	approval,
	active,
	onRespond,
}: {
	approval: ApprovalRequest;
	/** true → esta tarjeta captura el teclado (la primera/en foco). Las demás
	 *  sólo responden a mouse, para que varios approvals simultáneos no peleen
	 *  por las teclas. */
	active?: boolean;
	onRespond: (r: {
		decision: "accept" | "reject";
		pattern?: string;
		reason?: string;
	}) => void;
}) {
	const isTool = approval.kind === "tool";
	const icon = ICON_BY_KIND[approval.kind] ?? "edit";
	const label = approvalLabel(approval);

	// Opciones visibles: "Sí+patrón" sólo si el gate sugirió un patrón.
	const items = useMemo<MenuItem[]>(
		() => [
			{ key: "yes", label: "Sí", letter: "Y" },
			...(approval.suggestedPattern
				? [
						{
							key: "pattern" as ItemKey,
							label: `Sí, permitir «${approval.suggestedPattern}» esta sesión`,
							letter: "P",
						},
					]
				: []),
			{ key: "no", label: "No", letter: "N" },
			{ key: "reason", label: "No, indicar motivo", letter: "M" },
		],
		[approval.suggestedPattern],
	);

	const [sel, setSel] = useState(0);
	const [reasonOpen, setReasonOpen] = useState(false);
	const [reasonText, setReasonText] = useState("");
	const [collapsed, setCollapsed] = useState(false);
	const reasonRef = useRef<HTMLInputElement>(null);

	function choose(key: ItemKey) {
		if (key === "yes") onRespond({ decision: "accept" });
		else if (key === "pattern")
			onRespond({ decision: "accept", pattern: approval.suggestedPattern });
		else if (key === "no") onRespond({ decision: "reject" });
		else if (key === "reason") setReasonOpen(true);
	}

	// Teclado del menú: sólo la tarjeta activa y mientras no estamos en el input
	// de motivo (ése tiene su propio onKeyDown). ↑↓ navega, Enter confirma, Esc
	// cancela (= rechazar, como el selector de pi), Y/P/N/M ejecutan directo.
	useEffect(() => {
		if (!active || reasonOpen || collapsed) return;
		const onKey = (e: KeyboardEvent) => {
			const n = items.length;
			const k = e.key;
			if (k === "ArrowDown") {
				e.preventDefault();
				setSel((s) => (s + 1) % n);
			} else if (k === "ArrowUp") {
				e.preventDefault();
				setSel((s) => (s - 1 + n) % n);
			} else if (k === "Enter") {
				e.preventDefault();
				choose(items[sel].key);
			} else if (k === "Escape") {
				e.preventDefault();
				onRespond({ decision: "reject" });
			} else {
				const idx = items.findIndex(
					(it) => it.letter.toLowerCase() === k.toLowerCase(),
				);
				if (idx >= 0) {
					e.preventDefault();
					choose(items[idx].key);
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// choose/onRespond son estables durante la vida del componente; sel e
		// items son las dependencias reales del cierre.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active, reasonOpen, collapsed, sel, items]);

	// Al abrir el input de motivo, le damos el foco (sin autoFocus, que el linter
	// desaconseja por accesibilidad).
	useEffect(() => {
		if (reasonOpen) reasonRef.current?.focus();
	}, [reasonOpen]);

	function submitReason() {
		const t = reasonText.trim();
		if (t) onRespond({ decision: "reject", reason: t });
	}

	return (
		<div className="approval">
			<div
				className="ttl collapsible-ttl"
				onClick={() => setCollapsed((c) => !c)}
				title={collapsed ? "Expandir" : "Colapsar"}
			>
				<span className="ap-chev">{collapsed ? "▶" : "▼"}</span>
				<span className="ic">
					<Icon name={icon} />
				</span>
				<span>{label}</span>
			</div>
			{!collapsed && (
				<>
					{approval.command && <CmdBlock command={approval.command} />}
					{approval.diff && <Diff text={approval.diff} />}
					{approval.warning && (
						<p className="warning">
							<span className="ic">
								<Icon name="alert" />
							</span>{" "}
							{approval.warning}
						</p>
					)}
					{isTool && (
						<p className="hint">
							{READONLY_TOOLS.has(approval.toolName)
								? "Herramienta de sólo lectura/análisis (no modifica archivos). Revisa la acción antes de aceptar."
								: FRIDA_INTERNAL_TOOLS.has(approval.toolName)
									? "Herramienta interna de Frida. Revisa la acción antes de aceptar."
									: "Herramienta no reconocida (MCP o extensión de terceros). Revisa la acción antes de aceptar."}
						</p>
					)}

					{reasonOpen ? (
						<div className="ap-reason">
							<input
								ref={reasonRef}
								className="ap-reason-input"
								placeholder="Escribe el motivo y presiona Enter…"
								value={reasonText}
								onChange={(e) => setReasonText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										submitReason();
									} else if (e.key === "Escape") {
										e.preventDefault();
										setReasonOpen(false);
									}
								}}
							/>
							<div className="ap-keys">
								⏎ rechazar con motivo · Esc volver al menú
							</div>
						</div>
					) : (
						<div className="ap-menu" role="listbox">
							{items.map((it, i) => (
								<button
									key={it.key}
									type="button"
									role="option"
									className={"ap-item" + (i === sel ? " active" : "")}
									onClick={() => choose(it.key)}
									onMouseEnter={() => setSel(i)}
									aria-selected={i === sel}
								>
									<span className="ap-bullet">{i === sel ? "❯" : ""}</span>
									<span className="ap-label">{it.label}</span>
									<span className="ap-letter">{it.letter}</span>
								</button>
							))}
							<div className="ap-keys">
								↑↓ navegar · ⏎ confirmar · Esc cancelar
								{active ? " · Y/P/N/M" : ""}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
