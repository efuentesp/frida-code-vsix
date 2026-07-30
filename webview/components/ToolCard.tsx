import type { ToolEntry } from "../types";
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
	ListChecks,
	MessageCircleQuestion,
	PencilLine,
	ScanSearch,
	Search,
	Terminal,
	Wrench,
} from "lucide-react";

// Formatea una duración en ms a algo legible (318 ms · 4.2s).
function fmtDuration(ms: number): string {
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
const TODO_STATUS_GLYPH: Record<string, { glyph: string; label: string }> = {
	pending: { glyph: "○", label: "pendiente" },
	in_progress: { glyph: "◐", label: "en progreso" },
	completed: { glyph: "✓", label: "completado" },
	deleted: { glyph: "✗", label: "eliminado" },
};

/** Infiere el status resultante de una acción `todo` parseando el content del
 *  resultado. create → "(status)"; update → "from → to"; delete → "eliminado".
 *  null si no aplica (list/get/clear no tienen status echo, como rpiv). */
function todoStatusEcho(
	entry: ToolEntry,
): { glyph: string; label: string; status: string } | null {
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
		default:
			return { icon: <Wrench size={13} />, name: tool, label: "" };
	}
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
				<span className="tc-icon">{icon}</span>
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
			{livePartial && (
				<div className="tool-result-wrap">
					<pre className="tool-result partial">{entry.partial}</pre>
				</div>
			)}
		</div>
	);
}
