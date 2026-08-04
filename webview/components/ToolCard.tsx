import type { ReactNode } from "react";
import type { SubagentProgressDetails, ToolEntry, ToolState } from "../types";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Spinner } from "./Spinner";
import { CollapsibleCard } from "./CollapsibleCard";
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

type ToolInfo = { icon: ReactNode; name: string; label: string };
type ToolArgs = Record<string, unknown>;

/** String seguro: undefined → "". */
const str = (v: unknown): string => String(v ?? "");

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
						(a.args as unknown[]).find((x) => /^https?:\/\//.test(String(x))) ??
							"",
					)
				: "";
	return { icon: <Compass size={13} />, name: "agent_browser", label: url };
}

/** Resumen legible de la llamada (icono + texto) según el tool, en vez de JSON.
 *  Tabla de datos → baja complejidad y facilita añadir tools nuevas (una entrada
 *  por tool) en vez de un switch gigante. */
const TOOL_INFO: Record<string, (a: ToolArgs) => ToolInfo> = {
	read: (a) => ({
		icon: <FileText size={13} />,
		name: "read",
		label: str(a.path),
	}),
	bash: (a) => ({
		icon: <Terminal size={13} />,
		name: "bash",
		label: str(a.command),
	}),
	// El impacto del cambio (líneas +/-) va como badge git en el header
	// (tc-diffstats), calculado desde entry.diff en el componente; aquí sólo el path.
	edit: (a) => ({
		icon: <PencilLine size={13} />,
		name: "edit",
		label: str(a.path),
	}),
	write: (a) => ({
		icon: <FilePen size={13} />,
		name: "write",
		label: str(a.path),
	}),
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
	ls: (a) => ({ icon: <Folder size={13} />, name: "ls", label: str(a.path) }),
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
function renderBody(entry: ToolEntry, running: boolean): ReactNode {
	if (running) {
		if (entry.partialDetails) return renderSubagentLive(entry.partialDetails);
		if (entry.partial && entry.partial.trim())
			return <pre className="tool-result partial">{entry.partial}</pre>;
		return <div className="tool-running-placeholder">Ejecutando…</div>;
	}
	return renderResult(entry);
}

/** Contenido del header entre el icono y el estado (título, etiqueta, badges).
 *  Extraído a función para mantener baja la complejidad de ToolCard. */
function buildLeading(p: {
	name: string;
	label: string;
	diffStats: { add: number; del: number } | null;
	lines: string | null;
	statusEcho: { glyph: ReactNode; label: string; status: string } | null;
}): ReactNode {
	return (
		<>
			<span className="card-title">{p.name}</span>
			{p.label ? <code className="card-label">{p.label}</code> : null}
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
): ReactNode {
	const text = fmtDuration(elapsed);
	const ctx = ctxTokens > 0 ? ` · ${fmtTok(ctxTokens)} ctx` : "";
	return (
		<span className={"card-status " + state}>
			{state === "running" ? (
				<>
					<Spinner size={13} /> {text}
					{ctx}
				</>
			) : state === "ok" ? (
				<>
					<Icon name="check" /> {text}
					{ctx}
				</>
			) : (
				<>
					<Icon name="x" /> {text}
					{ctx}
				</>
			)}
		</span>
	);
}

export function ToolCard({ entry }: { entry: ToolEntry }) {
	const running = entry.state === "running";
	const { icon, name, label } = toolCallInfo(entry.tool, entry.args);
	const hasResult =
		!running && (!!(entry.result && entry.result.trim()) || !!entry.diff);
	// Progreso parcial en vivo (tool_execution_update) de un tool largo. Fuerza la
	// auto-apertura inmediata mientras corre.
	const hasPartial =
		running &&
		((!!entry.partial && !!entry.partial.trim()) || !!entry.partialDetails);

	// Cronómetro: CollapsibleCard re-renderiza cada 250 ms mientras corre, así que
	// basta con leer Date.now() aquí para que el tiempo avance.
	const elapsed = (entry.endedAt ?? Date.now()) - entry.startedAt;
	// Tokens del contenido (resultado/partial) que aporta al contexto. Estimación.
	const ctxTokens = estimateTokens(entry.result ?? entry.partial);
	// Badge git de líneas +/- (estilo GitHub) desde el diff, para edit/write.
	const diffStats = entry.diff ? countDiff(entry.diff) : null;
	// Conteo de líneas leídas (read) con rango si hubo offset.
	const lines = readStats(entry);
	// Status echo del tool `todo` (badge glyph + label, paridad rpiv-todo).
	const statusEcho = todoStatusEcho(entry);

	return (
		<CollapsibleCard
			running={running}
			startedAt={entry.startedAt}
			hasPartial={hasPartial}
			hasContent={hasResult}
			variant="tool"
			icon={icon}
			iconLive={running}
			leading={buildLeading({ name, label, diffStats, lines, statusEcho })}
			status={buildStatus(entry.state, elapsed, ctxTokens)}
			chevronTooltip={(open) => (open ? "Contraer resultado" : "Ver resultado")}
		>
			{running || hasResult ? renderBody(entry, running) : null}
		</CollapsibleCard>
	);
}
