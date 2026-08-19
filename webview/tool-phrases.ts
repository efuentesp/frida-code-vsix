// Frases de tool estilo Copilot (DESIGN-SYSTEM-WEBVIEW.md §5.2 / Fase 2).
// MÓDULO PURO (sin React): vocabulario de la fila plana —
//   - running: gerundio («Leyendo …») con el VERBO marcado para el shimmer
//     parcial (sólo el verbo brilla; contadores/archivos quedan estáticos).
//   - past: frase en pasado al completar («Leído oauth.ts – 212 líneas»).
//   - subtitle: detalle tabular (duración/líneas/diff) que va en <small>.
// Refactor del TOOl_INFO de ToolCard.tsx: mismo conocimiento por tool, ahora
// bilingüe gerundio/pasado. Tests: test/webview-tool-phrases.test.ts.

import type { ToolEntry } from "./types";

type ToolArgs = Record<string, unknown>;

const str = (v: unknown): string => String(v ?? "");
const basename = (p: string): string => p.split(/[/\\]/).filter(Boolean).pop() ?? p;

/** Cuenta líneas agregadas/eliminadas de un diff unificado. */
export function countDiff(diff: string): { add: number; del: number } {
	let add = 0;
	let del = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) add++;
		else if (line.startsWith("-")) del++;
	}
	return { add, del };
}

export interface ToolPhrase {
	/** Frase completa en gerundio (running). */
	running: string;
	/** SÓLO el verbo inicial (shimmer parcial). */
	runningVerb: string;
	/** Frase completa en pasado (completada). */
	past: string;
	/** Detalle tabular: "212 líneas · 1.3s · +4 -1" (sin guion inicial). */
	subtitle: string;
}

/** Descriptor por tool: verbo running (shimmer) + gerundio completo + verbo
 *  pasado + extractor del detalle. `verb` es SÓLO la palabra que brilla. */
const PHRASES: Record<
	string,
	{ run: string; verb?: string; done: string; detail: (a: ToolArgs) => string }
> = {
	read: { run: "Leyendo archivo", verb: "Leyendo", done: "Leído", detail: (a) => basename(str(a.path)) },
	bash: { run: "Ejecutando", done: "Ejecutado", detail: (a) => str(a.command) },
	edit: { run: "Editando", done: "Editado", detail: (a) => basename(str(a.path)) },
	write: { run: "Escribiendo", done: "Escrito", detail: (a) => basename(str(a.path)) },
	grep: { run: "Buscando", done: "Encontradas coincidencias de", detail: (a) => str(a.pattern) },
	find: { run: "Buscando", done: "Búsqueda de", detail: (a) => str(a.pattern) },
	ls: { run: "Listando", done: "Listado", detail: (a) => basename(str(a.path) || ".") },
	todo: { run: "Actualizando tareas", verb: "Actualizando", done: "Tarea", detail: (a) => str(a._subject ?? a.subject ?? a.action) },
	ask_user_question: { run: "Preguntando", done: "Preguntado", detail: () => "" },
	agent_browser: { run: "Navegando", done: "Navegado", detail: (a) => str(a.url) },
	web_fetch_md: { run: "Descargando página", done: "Descargada", detail: (a) => str(a.url) },
	web_docs_search: { run: "Buscando documentación", done: "Búsqueda en docs", detail: (a) => str(a.library_name) },
	web_docs_fetch: { run: "Consultando documentación", done: "Consultada documentación", detail: (a) => str(a.library_id) },
	agent: { run: "Ejecutando agente", done: "Agente", detail: (a) => str(a.description) || str(a.subagent_type) },
	get_subagent_result: { run: "Recuperando resultado", done: "Resultado recuperado", detail: (a) => str(a.agent_id) },
	context: { run: "Midiendo contexto", done: "Contexto medido", detail: () => "" },
};

// Tools de frida-lens: label legible (paridad con LENS_INFO de ToolCard).
const LENS_PHRASES: Record<string, { run: string; done: string; arg: (a: ToolArgs) => string }> = {
	project_report: { run: "Generando reporte de proyecto", done: "Reporte de proyecto", arg: () => "" },
	module_report: { run: "Analizando módulo", done: "Módulo analizado", arg: (a) => str(a.path) },
	symbol_search: { run: "Buscando símbolos", done: "Símbolos encontrados", arg: (a) => str(a.query) },
	read_symbol: { run: "Leyendo símbolo", done: "Símbolo leído", arg: (a) => str(a.symbol) },
	read_enclosing: { run: "Leyendo bloque", done: "Bloque leído", arg: (a) => `${a.path ?? ""}:${a.line ?? ""}` },
	lsp_diagnostics: { run: "Diagnosticando (LSP)", done: "Diagnóstico LSP", arg: (a) => str(a.path ?? a.paths ?? "") },
	lens_diagnostics: { run: "Diagnosticando (lens)", done: "Diagnóstico lens", arg: (a) => str(a.mode ?? "") },
	pi_lens_activate_tools: { run: "Activando tools de lens", done: "Tools de lens activadas", arg: (a) => (Array.isArray(a.tools) ? (a.tools as string[]).join(", ") : "") },
};

/** Duración legible (ms/s) — mismo formato que fmtDuration de ToolCard. */
function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Conteo de líneas de read (NL) o rango offset–end (NL) si hubo offset. */
function readLines(entry: ToolEntry): string | null {
	if (entry.tool !== "read" || !entry.result) return null;
	const count = entry.result.trimEnd().split("\n").length;
	if (count === 0) return null;
	const offset = Number((entry.args as ToolArgs)?.offset) || 1;
	return offset > 1
		? `${offset}–${offset + count - 1} (${count} líneas)`
		: `${count} líneas`;
}

/** Subtítulo tabular: líneas/diff · duración. */
function buildSubtitle(entry: ToolEntry): string {
	const parts: string[] = [];
	const lines = readLines(entry);
	if (lines) parts.push(lines);
	if (entry.diff) {
		const { add, del } = countDiff(entry.diff);
		parts.push(`+${add}${del > 0 ? ` -${del}` : ""}`);
	}
	const dur = fmtDuration((entry.endedAt ?? Date.now()) - entry.startedAt);
	if (dur) parts.push(dur);
	return parts.join(" · ");
}

export function toolPhrases(entry: ToolEntry): ToolPhrase {
	const a = (entry.args ?? {}) as ToolArgs;
	const lens = LENS_PHRASES[entry.tool];
	const base = PHRASES[entry.tool];

	let running: string;
	let past: string;
	let verb: string;
	if (lens) {
		running = lens.run;
		past = `${lens.done}${lens.arg(a) ? ` ${lens.arg(a)}` : ""}`;
		verb = lens.run;
	} else if (base) {
		const detail = base.detail(a);
		running = detail ? `${base.run} ${detail}` : base.run;
		past = detail ? `${base.done} ${detail}` : base.done;
		verb = base.verb ?? base.run;
	} else {
		running = `Ejecutando ${entry.tool}`;
		past = entry.tool;
		verb = "Ejecutando";
	}

	return {
		running,
		runningVerb: verb,
		past,
		subtitle: buildSubtitle(entry),
	};
}

/** Partes para shimmer parcial: verbo (brilla) + resto (estático). */
export function runningPhraseParts(entry: ToolEntry): { verb: string; rest: string } {
	const { running, runningVerb } = toolPhrases(entry);
	const rest = running.startsWith(runningVerb)
		? running.slice(runningVerb.length)
		: "";
	return { verb: runningVerb, rest };
}
