import type { ReactNode } from "react";
import type { SubagentProgressDetails, ToolEntry, ToolState } from "../types";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Spinner } from "./Spinner";
import { CollapsibleCard } from "./CollapsibleCard";
import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";
import { toolPhrases, runningPhraseParts, countDiff } from "../tool-phrases";

type ToolArgs = Record<string, unknown>;

/** String seguro: undefined → "". */
const str = (v: unknown): string => String(v ?? "");
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
		rows.push(
			v === undefined || v === null || v === "" ? null : [k, String(v)],
		);
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
					{a.prompt ? (
						<pre className="tc-input-prompt">{str(a.prompt)}</pre>
					) : null}
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
			{inputNode ? (
				<ToolSection label="Entrada">{inputNode}</ToolSection>
			) : null}
			{outputNode ? (
				<ToolSection label="Salida">{outputNode}</ToolSection>
			) : null}
		</div>
	);
}

/** Construye el header de la fila plana (Fase 2 P1, estilo Copilot):
 *  - running: verbo con shimmer parcial (sólo el verbo brilla) + detalle estático
 *    + subtítulo tabular (duración/tokens contando en vivo).
 *  - ok: frase en pasado, gris plano; check verde opt-in vía .show-checks.
 *  - error: frase en pasado + ✗ errorForeground.
 *  El status de duración/tokens (spinner/⏱) se conserva a la derecha mientras
 *  corre; al terminar, todo el detalle vive en el subtítulo (sin spinner). */
function buildLeading(p: {
	entry: ToolEntry;
	running: boolean;
}): ReactNode {
	const { entry, running } = p;
	const phrase = toolPhrases(entry);
	const parts = runningPhraseParts(entry);
	const path = String((entry.args as Record<string, unknown>)?.path ?? "");

	const label = running ? (
		<>
			<span className="tc-shimmer-verb">{parts.verb}</span>
			{parts.rest}
		</>
	) : (
			phrase.past
	);

	return (
		<>
			{/* icono: oculto mientras corre (shimmer); ✓ opt-in al terminar; ✗ en error */}
			{entry.state === "error" ? (
				<span className="card-icon tc-error">
					<Codicon name="error" size={13} label="Error" />
				</span>
			) : (
				<span className="card-icon tc-ok">
					<Codicon name="check" size={13} />
				</span>
			)}
			<span className="card-title">{label}</span>
			{/* ancla de archivo: basename como link-color (tooltip con ruta completa) */}
			{path && !phrase.past.includes(basenameOf(path)) ? null : null}
			{phrase.subtitle ? (
				<span className="card-sub">{phrase.subtitle}</span>
			) : null}
		</>
	);
}

const basenameOf = (p: string): string =>
	p.split(/[/\\]/).filter(Boolean).pop() ?? p;

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

export function ToolCard({ entry }: { entry: ToolEntry }) {
	const running = entry.state === "running";
	const phrase = toolPhrases(entry);
	const hasResult =
		!running && (!!(entry.result && entry.result.trim()) || !!entry.diff);
	const hasInput =
		!!entry.args &&
		typeof entry.args === "object" &&
		Object.keys(entry.args as Record<string, unknown>).length > 0;
	const hasPartial =
		running &&
		((!!entry.partial && !!entry.partial.trim()) || !!entry.partialDetails);

	const elapsed = (entry.endedAt ?? Date.now()) - entry.startedAt;
	const ctxTokens = estimateTokens(entry.result ?? entry.partial);

	return (
		<CollapsibleCard
			running={running}
			startedAt={entry.startedAt}
			hasPartial={hasPartial}
			hasContent={hasResult || hasInput}
			variant="flat"
			className={running ? "running" : entry.state === "error" ? "error" : ""}
			icon={null}
			leading={buildLeading({ entry, running })}
			status={
				running ? (
					<span className="card-status running">
						<Spinner size={13} /> {fmtDuration(elapsed)}
						{ctxTokens > 0 ? ` · ${fmtTok(ctxTokens)} ctx` : ""}
					</span>
				) : entry.tokensLLM && entry.tokensLLM > 0 ? (
					<span className="card-status ok">~{fmtTok(entry.tokensLLM)} llm</span>
				) : null
			}
			chevronTooltip={(open) => (open ? "Contraer resultado" : "Ver resultado")}
		>
			{renderBody(entry, running)}
		</CollapsibleCard>
	);
}
