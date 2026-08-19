// Agrupación de tools por corrida contigua (Fase 3 P1, estilo
// completed-response-disclosure de VS Code — DESIGN-SYSTEM-WEBVIEW.md §5.2).
// MÓDULO PURO: detecta corridas contiguas de segments kind:"tool" dentro de un
// turno COMPLETADO y agrega métricas para el summary pill. El renderer (Turn)
// envuelve esas corridas en <ToolGroup>; el modelo no se toca (regla §5.0).
// Tests: test/webview-group-stats.test.ts.

import type { Segment, ToolEntry } from "./types";

export interface ToolRun {
	/** Índice del PRIMER segment de la corrida (en turn.segments). */
	startIndex: number;
	/** Índice del ÚLTIMO segment de la corrida (inclusivo). */
	endIndex: number;
	/** Número de tools en la corrida. */
	count: number;
	/** Σ duración en ms (tools sin endedAt cuentan 0). */
	totalMs: number;
	/** Σ tokensLLM atribuidos. */
	totalTokens: number;
	/** Texto del summary pill: "N herramientas · 2.0s · 1.5k tok". */
	summary: string;
}

/** Duración legible (ms/s) — mismo formato que fmtDuration. */
function fmtDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTok(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const isTool = (s: Segment): s is { kind: "tool" } & ToolEntry => s.kind === "tool";

/** Corridas contiguas de tools de un turno COMPLETADO (status === null).
 *  Turno en vivo → [] (filas sueltas: el grupo no existe aún — regla §5.0.2).
 *  segments kind:"text"|"thinking" PARTE corridas (cronología preservada);
 *  "reasoning_hint" se ignora (es decorativo, no contenido). */
export function toolRuns(turn: {
	status: "thinking" | "executing" | null;
	segments: Segment[];
}): ToolRun[] {
	if (turn.status !== null) return [];
	const runs: ToolRun[] = [];
	let start = -1;
	let entries: ToolEntry[] = [];

	// for plano (no forEach): el narrowing de `start`/`entries` funciona en el
	// mismo scope de función — TS no rastrea mutaciones de closures capturadas.
	for (let i = 0; i < turn.segments.length; i++) {
		const seg = turn.segments[i]!;
		if (isTool(seg)) {
			if (start === -1) start = i;
			entries.push(seg);
		} else if (seg.kind === "text" || seg.kind === "thinking") {
			// el contenido NO-tool cierra la corrida abierta
			if (start !== -1) {
				runs.push(build(start, i - 1, entries));
				start = -1;
				entries = [];
			}
		}
		// reasoning_hint: se ignora (no parte ni cierra corridas)
	}
	if (start !== -1) runs.push(build(start, turn.segments.length - 1, entries));
	return runs;
}

function build(start: number, end: number, entries: ToolEntry[]): ToolRun {
	const count = entries.length;
	const totalMs = entries.reduce(
		(acc, e) => acc + ((e.endedAt ?? e.startedAt) - e.startedAt),
		0,
	);
	const totalTokens = entries.reduce((acc, e) => acc + (e.tokensLLM ?? 0), 0);
	const noun = count === 1 ? "herramienta" : "herramientas";
	const parts = [`${count} ${noun}`, fmtDuration(totalMs)];
	if (totalTokens > 0) parts.push(`${fmtTok(totalTokens)} tok`);
	return { startIndex: start, endIndex: end, count, totalMs, totalTokens, summary: parts.join(" · ") };
}
