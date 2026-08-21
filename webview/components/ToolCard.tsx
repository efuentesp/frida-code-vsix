import type { ReactNode } from "react";
import type { SubagentProgressDetails, ToolEntry, ToolState } from "../types";
import { Icon } from "./Icon";
import { Codicon } from "./Codicon";
import { Markdown } from "./Markdown";
import { Spinner } from "./Spinner";
import { CollapsibleCard } from "./CollapsibleCard";
import { Tooltip } from "./Tooltip";
import { getToolPhrase, type ToolPhrase } from "../tool-phrases";
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
	Globe,
	Library,
	BookOpen,
} from "lucide-react";

// Formatea una duración en ms a algo legible (318 ms · 4.2s).
export function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

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

type ToolInfo = { icon: ReactNode; name: string; label: string; path?: string };
type ToolArgs = Record<string, unknown>;

/** String seguro: undefined → "". */
const str = (v: unknown): string => String(v ?? "");

/** Basename de una ruta (último segmento). Para mostrar sólo el archivo en el
 *  header de read/edit/write/ls; la ruta completa va en el tooltip. */
const basename = (p: string): string =>
	p.split(/[/\\]/).filter(Boolean).pop() ?? p;

/** Header del tool `todo`: glyph de acción + subject (paridad renderTodoCall de
 *  rpiv-todo). El subject de update/get/delete llega en args._subject (resuelto
 *  por enrichTodoArgs en el host, pues el webview no ve el store). */
const TODO_ICON = <ListChecks size={13} />;
const TODO_ACTION_LABEL: Record<string, (a: ToolArgs) => string> = {
	create: (a) => `+ ${str(a._subject ?? a.subject)}`,
	update: (a) => `→ #${str(a.id)} ${str(a._subject ?? a.subject)}`,
	delete: (a) => `× #${str(a.id)} ${str(a._subject ?? a.subject)}`,
	get: (a) => `› #${str(a.id)} ${str(a._subject ?? a.subject)}`,
	clear: () => "∅",
};
function todoCallInfo(a: ToolArgs): ToolInfo {
	const action = str(a.action);
	const labeler = TODO_ACTION_LABEL[action];
	if (labeler) return { icon: TODO_ICON, name: "todo", label: labeler(a) };
	if (action === "list")
		return {
			icon: TODO_ICON,
			name: "todo",
			label: `☰ ${a.status ? str(a.status) : "all"}`,
		};
	return { icon: TODO_ICON, name: "todo", label: action };
}

/** ask_user_question: header (chip corto) de la primera pregunta, o su texto. */
function askCallInfo(a: ToolArgs): ToolInfo {
	const qs = Array.isArray(a.questions) ? a.questions : [];
	const first = qs[0] as Record<string, unknown> | undefined;
	const label = first ? String(first.header ?? first.question ?? "") : "";
	return {
		icon: <MessageCircleQuestion size={13} />,
		name: "ask_user_question",
		label,
	};
}

/** agent_browser: la URL objetivo si es fácil de localizar (qa.url o el primer
 *  arg http(s) del modo args). Si no, vacío (el icono ya identifica al tool). */
function browserCallInfo(a: ToolArgs): ToolInfo {
	const url =
		typeof a.url === "string"
			? a.url
			: Array.isArray(a.args)
				? String(
						(a.args as unknown[]).find((x) => /^https?:\/\//.test(String(x))) ?? "",
					)
				: "";
	return { icon: <Compass size={13} />, name: "agent_browser", label: url };
}

/** Resumen legible de la llamada (icono + texto) según el tool, en vez de JSON.
 *  Tabla de datos → baja complejidad y facilita añadir tools nuevas (una entrada
 *  por tool) en vez de un switch gigante. */
const TOOL_INFO: Record<string, (a: ToolArgs) => ToolInfo> = {
	read: (a) => {
		const p = str(a.path);
		return {
			icon: <FileText size={13} />,
			name: "read",
			label: basename(p),
			path: p,
		};
	},
	bash: (a) => ({
		icon: <Terminal size={13} />,
		name: "bash",
		label: str(a.command),
	}),
	// El impacto del cambio (líneas +/-) va como badge git en el header
	// (tc-diffstats), calculado desde entry.diff en el componente; el label es
	// sólo el basename del archivo (la ruta completa va en el tooltip).
	edit: (a) => {
		const p = str(a.path);
		return {
			icon: <PencilLine size={13} />,
			name: "edit",
			label: basename(p),
			path: p,
		};
	},
	write: (a) => {
		const p = str(a.path);
		return {
			icon: <FilePen size={13} />,
			name: "write",
			label: basename(p),
			path: p,
		};
	},
	grep: (a) => ({
		icon: <Search size={13} />,
		name: "grep",
		label: `"${str(a.pattern)}"${a.path ? ` en ${str(a.path)}` : ""}`,
	}),
	find: (a) => ({
		icon: <Search size={13} />,
		name: "find",
		label: `${str(a.pattern)}${a.path ? ` en ${str(a.path)}` : ""}`,
	}),
	ls: (a) => {
		const p = str(a.path);
		return {
			icon: <Folder size={13} />,
			name: "ls",
			label: basename(p),
			path: p,
		};
	},
	todo: todoCallInfo,
	ask_user_question: askCallInfo,
	agent_browser: browserCallInfo,
	// frida-supi-web (porte de @mrclrchtr/supi-web): las 3 tools web. El cuerpo se
	// renderiza como Markdown (ver renderResult), no como terminal plano.
	web_fetch_md: (a) => ({
		icon: <Globe size={13} />,
		name: "Web Fetch",
		label: str(a.url),
	}),
	web_docs_search: (a) => ({
		icon: <Library size={13} />,
		name: "Docs Search",
		label: str(a.library_name),
	}),
	web_docs_fetch: (a) => ({
		icon: <BookOpen size={13} />,
		name: "Docs Fetch",
		label: str(a.library_id),
	}),
	// Sub-agente autónomo: label = descripción corta (3-5 palabras) que pide el
	// tool, o el tipo de agente si no trae descripción.
	agent: (a) => ({
		icon: <Users size={13} />,
		name: "agent",
		label: str(a.description) || str(a.subagent_type),
	}),
	// Recupera el resultado de un sub-agente (background). UserCheck (agente con
	// palomita = "resultado recibido") distingue la recuperación del lanzamiento
	// (agent → Users). Label = agent_id que identifica al sub-agente.
	get_subagent_result: (a) => ({
		icon: <UserCheck size={13} />,
		name: "get_subagent_result",
		label: str(a.agent_id),
	}),
	// Reporte de uso del contexto (presión del context window, categorías,
	// system prompt). El icono (Gauge) ya lo identifica; sin label.
	context: () => ({ icon: <Gauge size={13} />, name: "context", label: "" }),
};

function toolCallInfo(tool: string, args: unknown): ToolInfo {
	const a = (args ?? {}) as ToolArgs;
	const lens = LENS_INFO[tool];
	if (lens)
		return {
			icon: <ScanSearch size={13} />,
			name: lens.label,
			label: lens.arg(a),
		};
	const fn = TOOL_INFO[tool];
	if (fn) return fn(a);
	return { icon: <Wrench size={13} />, name: tool, label: "" };
}

/** Token count legible: 1234 → "1.2k tokens", 500 → "500 tokens". */
function formatTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`;
}

/** Compacto para el status de tarjeta: 1234 → "1.2k tok", 500 → "500 tok". */
export function fmtTok(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;
}

/** Estimación burda de tokens de un texto (~4 chars/token, sin tokenizer real).
 *  Refleja cuánto contexto aporta ese contenido. */
export function estimateTokens(text: string | undefined | null): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
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
		<div className="subagent-live">
			{stats.length > 0 ? (
				<div className="sl-stats">{stats.join(" · ")}</div>
			) : null}
			<div className="sl-activity">⎿ {d.activity}</div>
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
	// frida-supi-web: web_fetch_md / web_docs_search / web_docs_fetch devuelven
	// Markdown (la página convertida o la tabla de Context7). Renderizar como tal.
	if (
		entry.tool === "web_fetch_md" ||
		entry.tool === "web_docs_search" ||
		entry.tool === "web_docs_fetch"
	) {
		return (
			<div className="tool-result md">
				<Markdown>{entry.result}</Markdown>
			</div>
		);
	}
	// bash / grep / default → terminal plano.
	return <pre className="tool-result">{entry.result}</pre>;
}

/** Construye el cuerpo (children) de la tarjeta según el estado de la tool:
 *  - corriendo + detalles de sub-agente → vista rica en vivo.
 *  - corriendo + parcial textual → <pre> con la salida fluyendo.
 *  - corriendo sin parcial → placeholder "Ejecutando…" (sólo visible tras el
 *    umbral, porque CollapsibleCard abre entonces).
 *  - terminado con resultado/diff → render rico del resultado. */
// ---- Secciones Entrada / Salida ------------------------------------------
// Cada tarjeta se divide en dos secciones claras: qué se solicitó (args) y
// qué se devolvió (result/diff). Reutilizamos renderResult para la Salida.

function ToolSection({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="tc-section">
			<div className="tc-section-label">{label}</div>
			<div className="tc-section-body">{children}</div>
		</div>
	);
}

/** Filas [etiqueta, valor] para la Entrada de tools con args simples. */
function InputRows({ rows }: { rows: [string, string][] }) {
	if (!rows.length) return null;
	return (
		<dl className="tc-rows">
			{rows.map(([k, v], i) => (
				<div key={i} className="tc-row">
					<dt>{k}</dt>
					<dd>{v}</dd>
				</div>
			))}
		</dl>
	);
}

/** Filas significativas por tool (clave → valor legible). null se descarta. */
function inputRowsFor(tool: string, a: ToolArgs): [string, string][] {
	const rows: ([string, string] | null)[] = [];
	const push = (k: string, v: unknown) =>
		rows.push(v === undefined || v === null || v === "" ? null : [k, String(v)]);
	switch (tool) {
		case "read":
			push("ruta", a.path);
			push("offset", a.offset);
			push("limit", a.limit);
			break;
		case "ls":
			push("ruta", a.path);
			break;
		case "edit":
			push("ruta", a.path);
			push("replace_all", a.replace_all === true ? "sí" : undefined);
			break;
		case "write":
			push("ruta", a.path);
			break;
		case "grep":
			push("patrón", a.pattern ? `"${a.pattern}"` : undefined);
			push("ruta", a.path);
			push("glob", a.glob);
			push("output_mode", a.output_mode);
			break;
		case "find":
			push("patrón", a.pattern);
			push("ruta", a.path);
			break;
		case "get_subagent_result":
			push("agent_id", a.agent_id);
			push("verbose", a.verbose === true ? "sí" : undefined);
			break;
		case "web_fetch_md":
			push("url", a.url);
			break;
		case "web_docs_search":
			push("library", a.library_name);
			push("query", a.query);
			break;
		case "web_docs_fetch":
			push("library_id", a.library_id);
			push("query", a.query);
			break;
	}
	return rows.filter((r): r is [string, string] => r !== null);
}

/** Fallback: todas las claves primitivas de args como filas. */
function genericRows(a: ToolArgs): [string, string][] {
	return Object.entries(a)
		.filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
		.map(([k, v]) => [k, String(v)]);
}

/** Cuerpo de la Salida mientras corre (parcial / placeholder / sub-agente). */
function renderRunning(entry: ToolEntry): ReactNode {
	if (entry.partialDetails) return renderSubagentLive(entry.partialDetails);
	if (entry.partial && entry.partial.trim())
		return <pre className="tool-result partial">{entry.partial}</pre>;
	return <div className="tool-running-placeholder">Ejecutando…</div>;
}

/** Sección "Entrada": formatea los args del tool de forma legible (no JSON
 *  crudo). Espejo de renderResult para el lado del request. */
function renderInput(entry: ToolEntry): ReactNode {
	const a = (entry.args ?? {}) as ToolArgs;
	const tool = entry.tool;
	switch (tool) {
		case "bash":
			return <pre className="tool-result tc-input-cmd">$ {str(a.command)}</pre>;
		case "agent":
			return (
				<div className="tc-input-block">
					{a.subagent_type ? (
						<div className="tc-row">
							<dt>tipo</dt>
							<dd>
								<code>{str(a.subagent_type)}</code>
							</dd>
						</div>
					) : null}
					{a.description ? (
						<div className="tc-row">
							<dt>descripción</dt>
							<dd>{str(a.description)}</dd>
						</div>
					) : null}
					{a.prompt ? <pre className="tc-input-prompt">{str(a.prompt)}</pre> : null}
				</div>
			);
		case "ask_user_question": {
			const qs = Array.isArray(a.questions) ? a.questions : [];
			if (!qs.length) return null;
			return (
				<div className="tc-input-block">
					{qs.map((q, i) => {
						const qq = (q ?? {}) as ToolArgs;
						const opts = Array.isArray(qq.options) ? qq.options : [];
						return (
							<div key={i} className="tc-ask-q">
								<div className="tc-ask-head">
									<span className="tc-ask-n">P{i + 1}</span>
									{qq.header ? (
										<span className="tc-ask-h">[{str(qq.header)}]</span>
									) : null}{" "}
									{str(qq.question)}
								</div>
								{opts.length ? (
									<ul className="tc-ask-opts">
										{opts.map((o, j) => {
											const oo = (o ?? {}) as ToolArgs;
											return <li key={j}>· {str(oo.label)}</li>;
										})}
									</ul>
								) : null}
							</div>
						);
					})}
				</div>
			);
		}
		case "edit":
		case "write":
		case "read":
		case "ls":
		case "grep":
		case "find":
		case "get_subagent_result":
		case "web_fetch_md":
		case "web_docs_search":
		case "web_docs_fetch":
			return <InputRows rows={inputRowsFor(tool, a)} />;
		default:
			return <InputRows rows={genericRows(a)} />;
	}
}

function renderBody(entry: ToolEntry, running: boolean): ReactNode {
	const inputNode = renderInput(entry);
	const outputNode = running ? renderRunning(entry) : renderResult(entry);
	if (!inputNode && !outputNode) return null;
	return (
		<div className="tc-sections">
			{inputNode ? <ToolSection label="Entrada">{inputNode}</ToolSection> : null}
			{outputNode ? <ToolSection label="Salida">{outputNode}</ToolSection> : null}
		</div>
	);
}

/** Contenido del header entre el icono y el estado (título, etiqueta, badges).
 *  Extraído a función para mantener baja la complejidad de ToolCard. */
function buildLeading(p: {
	name: string;
	label: string;
	path?: string;
	diffStats: { add: number; del: number } | null;
	lines: string | null;
	statusEcho: { glyph: ReactNode; label: string; status: string } | null;
}): ReactNode {
	return (
		<>
			<span className="card-title">{p.name}</span>
			{p.label ? (
				p.path && p.path !== p.label ? (
					<Tooltip label={p.path} side="top">
						<code className="card-label">{p.label}</code>
					</Tooltip>
				) : (
					<code className="card-label">{p.label}</code>
				)
			) : null}
			{(p.diffStats || p.lines) && (
				<span className="card-badges">
					{p.diffStats ? (
						<span className="tc-diffstats">
							<span className="add">+{p.diffStats.add}</span>
							{p.diffStats.del > 0 ? (
								<span className="del">-{p.diffStats.del}</span>
							) : null}
						</span>
					) : null}
					{p.lines ? <span className="tc-linestats">{p.lines}</span> : null}
				</span>
			)}
			{p.statusEcho ? (
				<span className={"tc-todostatus " + p.statusEcho.status}>
					{p.statusEcho.glyph} {p.statusEcho.label}
				</span>
			) : null}
		</>
	);
}

/** Bloque de estado a la derecha (spinner/check/x + duración). Extraído a
 *  función para mantener baja la complejidad de ToolCard. */
function buildStatus(
	state: ToolState,
	elapsed: number,
	ctxTokens = 0,
	llmTokens?: number,
): ReactNode {
	const text = fmtDuration(elapsed);
	const ctx = ctxTokens > 0 ? ` · ${fmtTok(ctxTokens)} ctx` : "";
	const llm = llmTokens && llmTokens > 0 ? ` · ~${fmtTok(llmTokens)} llm` : "";
	return (
		<span className={"card-status " + state}>
			{state === "running" ? (
				<>
					<Spinner size={13} /> {text}
					{ctx}
					{llm}
				</>
			) : state === "ok" ? (
				<>
					<Icon name="check" /> {text}
					{ctx}
					{llm}
				</>
			) : (
				<>
					<Icon name="x" /> {text}
					{ctx}
					{llm}
				</>
			)}
		</span>
	);
}

/** Contenido del header plano estilo Copilot (.tool-flat). */
function buildFlatLeading(entry: ToolEntry, phrase: ToolPhrase): ReactNode {
	const running = entry.state === "running";
	const isError = entry.state === "error";
	const fullPath = (entry.args as Record<string, unknown>)?.path;

	return (
		<div className="tool-flat-title">
			{running ? (
				<Codicon name="loading" size={14} className="tc-icon-running" />
			) : isError ? (
				<Codicon name="error" size={14} className="tc-icon-error" />
			) : (
				<Codicon name="check" size={14} className="tc-icon-check" />
			)}
			<span className={running ? "tc-shimmer-verb" : "tc-verb"}>
				{phrase.verb}
			</span>
			{phrase.arg ? (
				phrase.isAnchor && fullPath ? (
					<Tooltip label={String(fullPath)} side="top">
						<span className="tc-anchor">{phrase.arg}</span>
					</Tooltip>
				) : (
					<span className="tc-arg">{phrase.arg}</span>
				)
			) : null}
			{phrase.detail ? <span className="tc-sub">{phrase.detail}</span> : null}
		</div>
	);
}

export function ToolCard({ entry }: { entry: ToolEntry }) {
	const running = entry.state === "running";
	const phrase = getToolPhrase(entry);
	const hasResult =
		!running && (!!(entry.result && entry.result.trim()) || !!entry.diff);
	// Con la sección Entrada, la tarjeta siempre tiene algo que mostrar (los args),
	// así que es expandible aunque el resultado esté vacío.
	const hasInput =
		!!entry.args &&
		typeof entry.args === "object" &&
		Object.keys(entry.args as Record<string, unknown>).length > 0;
	// Progreso parcial en vivo (tool_execution_update) de un tool largo. Fuerza la
	// auto-apertura inmediata mientras corre.
	const hasPartial =
		running &&
		((!!entry.partial && !!entry.partial.trim()) || !!entry.partialDetails);

	return (
		<CollapsibleCard
			running={running}
			startedAt={entry.startedAt}
			hasPartial={hasPartial}
			hasContent={hasResult || hasInput}
			variant="flat"
			leading={buildFlatLeading(entry, phrase)}
			chevronTooltip={(open) => (open ? "Contraer resultado" : "Ver resultado")}
		>
			{renderBody(entry, running)}
		</CollapsibleCard>
	);
}
