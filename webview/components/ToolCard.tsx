import type { SubagentProgressDetails, ToolEntry } from "../types";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Tooltip } from "./Tooltip";
import { Spinner } from "./Spinner";
import { useEffect, useState, type ReactNode } from "react";
import {
	Compass,
	FilePen,
	FileText,
	Folder,
	Gauge,
	ListChecks,
	MessageCircleQuestion,
	PencilLine,
	ScanSearch,
	Search,
	Terminal,
	UserCheck,
	Circle,
	CircleCheck,
	CircleDot,
	CircleX,
	Users,
	Wrench,
} from "lucide-react";

// Formatea una duración en ms a algo legible (318 ms · 4.2s).
export function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

// Resumen legible de la llamada (icono + texto) según el tool, en vez de JSON.
// Tools de frida-lens (pi-lens): label legible (Title Case, paridad con el TUI
// de pi) + extractor del argumento principal para el header. Ícono ScanSearch.
const LENS_INFO: Record<
	string,
	{ label: string; arg: (a: Record<string, unknown>) => string }
> = {
	project_report: {
		label: "Project Report",
		arg: (a) => (a.focus ? `"${a.focus}"` : ""),
	},
	module_report: { label: "Module Report", arg: (a) => String(a.path ?? "") },
	symbol_search: {
		label: "Symbol Search",
		arg: (a) => `"${a.query ?? ""}"`,
	},
	read_symbol: { label: "Read Symbol", arg: (a) => String(a.symbol ?? "") },
	read_enclosing: {
		label: "Read Enclosing",
		arg: (a) => `${a.path ?? ""}:${a.line ?? ""}`,
	},
	lsp_diagnostics: {
		label: "LSP Diagnostics",
		arg: (a) => String(a.path ?? a.paths ?? ""),
	},
	lens_diagnostics: {
		label: "Lens Diagnostics",
		arg: (a) => String(a.mode ?? ""),
	},
	pi_lens_activate_tools: {
		label: "Activate pi-lens Tools",
		arg: (a) => (Array.isArray(a.tools) ? a.tools.join(", ") : ""),
	},
};

/** Cuenta líneas agregadas (+) y eliminadas (-) de un diff unificado (excluye
 *  los headers +++/---). Para el badge git del header de edit/write. */
function countDiff(diff: string): { add: number; del: number } {
	let add = 0;
	let del = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) add++;
		else if (line.startsWith("-")) del++;
	}
	return { add, del };
}

/** Conteo de líneas leídas para el header de `read` (NL, o "offset–end (NL)" si
 *  hubo offset). Cuenta las líneas reales del result; null si no aplica. */
function readStats(entry: ToolEntry): string | null {
	if (entry.tool !== "read" || !entry.result) return null;
	const count = entry.result.trimEnd().split("\n").length;
	if (count === 0) return null;
	const offset = Number((entry.args as Record<string, unknown>)?.offset) || 1;
	return offset > 1
		? `${offset}–${offset + count - 1} (${count}L)`
		: `${count}L`;
}

// Status echo del tool `todo` (paridad renderTodoResult de rpiv-todo): glyph + label
// coloreado según el status resultante de la acción.
const TODO_STATUS_GLYPH: Record<string, { glyph: ReactNode; label: string }> = {
	pending: { glyph: <Circle size={11} />, label: "pendiente" },
	in_progress: { glyph: <CircleDot size={11} />, label: "en progreso" },
	completed: { glyph: <CircleCheck size={11} />, label: "completado" },
	deleted: { glyph: <CircleX size={11} />, label: "eliminado" },
};

/** Infiere el status resultante de una acción `todo` parseando el content del
 *  resultado. create → "(status)"; update → "from → to"; delete → "eliminado".
 *  null si no aplica (list/get/clear no tienen status echo, como rpiv). */
function todoStatusEcho(
	entry: ToolEntry,
): { glyph: ReactNode; label: string; status: string } | null {
	if (entry.tool !== "todo" || !entry.result) return null;
	const r = entry.result;
	if (r.startsWith("Created")) {
		const m = r.match(/\((pending|in_progress|completed)\)\s*$/);
		if (m) return { ...TODO_STATUS_GLYPH[m[1]], status: m[1] };
	}
	if (r.startsWith("Updated")) {
		const m = r.match(/→ (pending|in_progress|completed)\)/);
		if (m) return { ...TODO_STATUS_GLYPH[m[1]], status: m[1] };
	}
	if (r.startsWith("Deleted")) {
		return { ...TODO_STATUS_GLYPH.deleted, status: "deleted" };
	}
	return null;
}

function toolCallInfo(
	tool: string,
	args: unknown,
): { icon: ReactNode; name: string; label: string } {
	const a = (args ?? {}) as Record<string, unknown>;
	const s = (v: unknown) => String(v ?? "");
	const lens = LENS_INFO[tool];
	if (lens) {
		return {
			icon: <ScanSearch size={13} />,
			name: lens.label,
			label: lens.arg(a),
		};
	}
	switch (tool) {
		case "read":
			return { icon: <FileText size={13} />, name: "read", label: s(a.path) };
		case "bash":
			return {
				icon: <Terminal size={13} />,
				name: "bash",
				label: s(a.command),
			};
		case "edit":
			// El impacto del cambio (líneas +/-) va como badge git en el header
			// (tc-diffstats), calculado desde entry.diff en el componente; aquí sólo el path.
			return { icon: <PencilLine size={13} />, name: "edit", label: s(a.path) };
		case "write":
			return { icon: <FilePen size={13} />, name: "write", label: s(a.path) };
		case "grep":
			return {
				icon: <Search size={13} />,
				name: "grep",
				label: `"${s(a.pattern)}"${a.path ? ` en ${s(a.path)}` : ""}`,
			};
		case "find":
			return {
				icon: <Search size={13} />,
				name: "find",
				label: `${s(a.pattern)}${a.path ? ` en ${s(a.path)}` : ""}`,
			};
		case "ls":
			return { icon: <Folder size={13} />, name: "ls", label: s(a.path) };
		case "todo": {
			// Header del tool `todo`: glyph de acción + subject (paridad renderTodoCall
			// de rpiv-todo). El subject de update/get/delete llega en args._subject
			// (resuelto por enrichTodoArgs en el host, pues el webview no ve el store).
			const action = s(a.action);
			const subject = s(a._subject ?? a.subject);
			if (action === "create")
				return {
					icon: <ListChecks size={13} />,
					name: "todo",
					label: `+ ${subject}`,
				};
			if (action === "update")
				return {
					icon: <ListChecks size={13} />,
					name: "todo",
					label: `→ #${s(a.id)} ${subject}`,
				};
			if (action === "delete")
				return {
					icon: <ListChecks size={13} />,
					name: "todo",
					label: `× #${s(a.id)} ${subject}`,
				};
			if (action === "get")
				return {
					icon: <ListChecks size={13} />,
					name: "todo",
					label: `› #${s(a.id)} ${subject}`,
				};
			if (action === "list")
				return {
					icon: <ListChecks size={13} />,
					name: "todo",
					label: `☰ ${a.status ? s(a.status) : "all"}`,
				};
			if (action === "clear")
				return { icon: <ListChecks size={13} />, name: "todo", label: "∅" };
			return { icon: <ListChecks size={13} />, name: "todo", label: action };
		}
		case "ask_user_question": {
			// Label: header (chip corto) de la primera pregunta, o su texto.
			const qs = Array.isArray(a.questions) ? a.questions : [];
			const first = qs[0] as Record<string, unknown> | undefined;
			const label = first ? String(first.header ?? first.question ?? "") : "";
			return {
				icon: <MessageCircleQuestion size={13} />,
				name: "ask_user_question",
				label,
			};
		}
		case "agent_browser": {
			// Label: la URL objetivo si es fácil de localizar (qa.url o el primer
			// arg http(s) del modo args). Si no, vacío (el icono ya identifica al tool).
			const url =
				typeof a.url === "string"
					? a.url
					: Array.isArray(a.args)
						? String(
								(a.args as unknown[]).find((x) =>
									/^https?:\/\//.test(String(x)),
								) ?? "",
							)
						: "";
			return { icon: <Compass size={13} />, name: "agent_browser", label: url };
		}
		case "agent": {
			// Sub-agente autónomo: label = la descripción corta (3-5 palabras) que pide
			// el tool, o el tipo de agente si no trae descripción.
			const desc = s(a.description);
			return {
				icon: <Users size={13} />,
				name: "agent",
				label: desc || s(a.subagent_type),
			};
		}
		case "get_subagent_result": {
			// Recupera el resultado de un sub-agente (background). UserCheck (agente
			// con palomita = "resultado recibido") distingue la recuperación del
			// lanzamiento (agent → Users). Label = agent_id que identifica al sub-agente.
			return {
				icon: <UserCheck size={13} />,
				name: "get_subagent_result",
				label: s(a.agent_id),
			};
		}
		case "context":
			// Reporte de uso del contexto (presión del context window, categorías,
			// system prompt). El icono (Gauge) ya lo identifica; sin label.
			return { icon: <Gauge size={13} />, name: "context", label: "" };
		default:
			return { icon: <Wrench size={13} />, name: tool, label: "" };
	}
}

/** Token count legible: 1234 → "1.2k tokens", 500 → "500 tokens". */
function formatTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`;
}

/** Vista rica del progreso de un sub-agente mientras corre: métricas (turnos,
 *  tools, tokens) + actividad compacta en una línea. Reemplaza el <pre> de
 *  livePartial para los tools agent / get_subagent_result. */
function renderSubagentLive(d: SubagentProgressDetails) {
	const stats: string[] = [];
	if (d.maxTurns) stats.push(`turn ${d.turnCount}/${d.maxTurns}`);
	else if (d.turnCount > 1) stats.push(`turn ${d.turnCount}`);
	if (d.toolUses > 0)
		stats.push(`${d.toolUses} tool${d.toolUses === 1 ? "" : "s"}`);
	if (d.tokens > 0) stats.push(formatTokens(d.tokens));
	return (
		<div className="tool-result-wrap">
			<div className="subagent-live">
				{stats.length > 0 ? (
					<div className="sl-stats">{stats.join(" · ")}</div>
				) : null}
				<div className="sl-activity">⎿ {d.activity}</div>
			</div>
		</div>
	);
}

// Render del resultado según el tipo de tool (estilo TUI: diff, código, terminal).
function renderResult(entry: ToolEntry) {
	if (entry.diff) {
		const lines = entry.diff.split("\n");
		return (
			<pre className="diff-out">
				{lines.map((ln, i) => {
					const cls = ln.startsWith("+")
						? "add"
						: ln.startsWith("-")
							? "del"
							: "ctx";
					return (
						<span key={i} className={"diff-line " + cls}>
							{ln || " "}
						</span>
					);
				})}
			</pre>
		);
	}
	if (!entry.result?.trim()) return null;
	// read/write → bloque de código con resaltado según extensión.
	if (entry.tool === "read" || entry.tool === "write") {
		const path = String((entry.args as any)?.path ?? "");
		const ext = (path.split(".").pop() || "").toLowerCase();
		const fence = "```";
		return (
			<div className="tool-result md">
				<Markdown>{`${fence}${ext}\n${entry.result}\n${fence}`}</Markdown>
			</div>
		);
	}
	// agent → resultado markdown del sub-agente (su resumen final; en background
	// es un mensaje de estado, que también renderiza bien como párrafo).
	if (entry.tool === "agent") {
		return (
			<div className="tool-result md">
				<Markdown>{entry.result}</Markdown>
			</div>
		);
	}
	// get_subagent_result → metadatos (Agente:/Estado:/Error:) + contenido markdown
	// del sub-agente tras "Resultado:". Se formatea: etiquetas en negrita y el
	// contenido libre (tras una línea en blanco) para que encabezados/listas
	// rendericen (sin esto, "Resultado: ## X" no se parsea como encabezado).
	if (entry.tool === "get_subagent_result") {
		const md = entry.result
			.replace(/^Agente: /m, "**Agente:** ")
			.replace(/^Estado: /m, "**Estado:** ")
			.replace(/^Resultado: /m, "\n")
			.replace(/^Error: /m, "\n> **Error:** ");
		return (
			<div className="tool-result md">
				<Markdown>{md}</Markdown>
			</div>
		);
	}
	// bash / grep / default → terminal plano.
	return <pre className="tool-result">{entry.result}</pre>;
}

export function ToolCard({ entry }: { entry: ToolEntry }) {
	const [open, setOpen] = useState(false);
	const [now, setNow] = useState(Date.now());
	const running = entry.state === "running";
	const { icon, name, label } = toolCallInfo(entry.tool, entry.args);
	const hasResult =
		!running && (!!(entry.result && entry.result.trim()) || !!entry.diff);
	// Progreso parcial en vivo (tool_execution_update) de un tool largo.
	const livePartial = running && !!entry.partial && !!entry.partial.trim();

	// Cronómetro en vivo solo mientras ejecuta (re-render ligero cada 250 ms).
	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, [running]);

	const elapsed = (entry.endedAt ?? now) - entry.startedAt;
	// Badge git de líneas +/- (estilo GitHub) desde el diff, para edit/write.
	const diffStats = entry.diff ? countDiff(entry.diff) : null;
	// Conteo de líneas leídas (read) con rango si hubo offset.
	const lines = readStats(entry);
	// Status echo del tool `todo` (badge glyph + label, paridad rpiv-todo).
	const statusEcho = todoStatusEcho(entry);

	return (
		<div
			className={
				"tool" + (open && hasResult ? "" : livePartial ? "" : " collapsed")
			}
		>
			<div
				className={"tool-head" + (hasResult ? " has-result" : "")}
				onClick={() => hasResult && setOpen(!open)}
			>
				<span className={"tc-icon" + (running ? " live" : "")}>{icon}</span>
				<span className="tc-name">{name}</span>
				{label ? <code className="tc-label">{label}</code> : null}
				{diffStats ? (
					<span className="tc-diffstats">
						<span className="add">+{diffStats.add}</span>
						{diffStats.del > 0 ? (
							<span className="del">-{diffStats.del}</span>
						) : null}
					</span>
				) : null}
				{lines ? <span className="tc-linestats">{lines}</span> : null}
				{statusEcho ? (
					<span className={"tc-todostatus " + statusEcho.status}>
						{statusEcho.glyph} {statusEcho.label}
					</span>
				) : null}
				<span className={"tc-status " + entry.state}>
					{running ? (
						<>
							<Spinner size={13} /> {fmtDuration(elapsed)}
						</>
					) : entry.state === "ok" ? (
						<>
							<Icon name="check" /> {fmtDuration(elapsed)}
						</>
					) : (
						<>
							<Icon name="x" /> {fmtDuration(elapsed)}
						</>
					)}
				</span>
				{hasResult && (
					<Tooltip
						label={open ? "Contraer resultado" : "Ver resultado"}
						side="top"
					>
						<span className={"tc-chev" + (open ? "" : " closed")}>
							<Icon name="chevron" size={12} />
						</span>
					</Tooltip>
				)}
			</div>
			{open && hasResult && (
				<div className="tool-result-wrap">{renderResult(entry)}</div>
			)}
			{running && entry.partialDetails ? (
				renderSubagentLive(entry.partialDetails)
			) : livePartial ? (
				<div className="tool-result-wrap">
					<pre className="tool-result partial">{entry.partial}</pre>
				</div>
			) : null}
		</div>
	);
}
