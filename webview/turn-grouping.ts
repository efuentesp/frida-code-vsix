// webview/turn-grouping.ts — Agrupación de segmentos de turno y métricas de herramientas
// (Fase 3: Estructura de Turnos, Thinking y Agrupación).

import type { Segment, ToolEntry } from "./types";
import { fmtDuration } from "./tool-phrases";
import { fmtTok } from "./components/ToolCard";

export type TurnBlock =
	| { kind: "thinking"; segment: Extract<Segment, { kind: "thinking" }>; index: number }
	| { kind: "text"; segment: Extract<Segment, { kind: "text" }>; index: number }
	| { kind: "tools"; tools: Array<Extract<Segment, { kind: "tool" }>>; startIndex: number };

/**
 * Agrupa segmentos contiguos de tipo "tool" en un único bloque "tools".
 * Preserva el orden cronológico estricto de thinking y texto.
 */
export function groupSegments(segments: readonly Segment[]): TurnBlock[] {
	const blocks: TurnBlock[] = [];
	let currentTools: Array<Extract<Segment, { kind: "tool" }>> = [];
	let toolStartIndex = 0;

	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (s.kind === "tool") {
			if (currentTools.length === 0) {
				toolStartIndex = i;
			}
			currentTools.push(s);
		} else {
			if (currentTools.length > 0) {
				blocks.push({
					kind: "tools",
					tools: currentTools,
					startIndex: toolStartIndex,
				});
				currentTools = [];
			}
			if (s.kind === "thinking") {
				blocks.push({ kind: "thinking", segment: s, index: i });
			} else if (s.kind === "text") {
				blocks.push({ kind: "text", segment: s, index: i });
			}
		}
	}

	if (currentTools.length > 0) {
		blocks.push({
			kind: "tools",
			tools: currentTools,
			startIndex: toolStartIndex,
		});
	}

	return blocks;
}

export interface ToolGroupSummary {
	count: number;
	isRunning: boolean;
	hasError: boolean;
	durationMs: number;
	durationStr: string;
	totalTokens: number;
	tokensStr: string;
	label: string;
}

/**
 * Calcula métricas agregadas (conteo, duración, tokens, estado) de un grupo de herramientas.
 */
export function summarizeToolGroup(
	tools: readonly ToolEntry[],
	now: number = Date.now(),
): ToolGroupSummary {
	const count = tools.length;
	const isRunning = tools.some((t) => t.state === "running");
	const hasError = tools.some((t) => t.state === "error");

	let durationMs = 0;
	if (count > 0) {
		const startTimes = tools.map((t) => t.startedAt).filter((t) => t > 0);
		if (startTimes.length > 0) {
			const minStart = Math.min(...startTimes);
			const endTimes = tools.map((t) => (t.endedAt && t.endedAt > 0 ? t.endedAt : now));
			const maxEnd = Math.max(...endTimes);
			durationMs = Math.max(0, maxEnd - minStart);
		}
	}

	const durationStr = fmtDuration(durationMs);

	const totalTokens = tools.reduce(
		(sum, t) => sum + (typeof t.tokensLLM === "number" && t.tokensLLM > 0 ? t.tokensLLM : 0),
		0,
	);
	const tokensStr = totalTokens > 0 ? fmtTok(totalTokens) : "";

	let label = "";
	if (isRunning) {
		label = `Ejecutando ${count} ${count === 1 ? "herramienta" : "herramientas"}…`;
	} else {
		label = `${count} ${count === 1 ? "herramienta usada" : "herramientas usadas"}`;
	}

	return {
		count,
		isRunning,
		hasError,
		durationMs,
		durationStr,
		totalTokens,
		tokensStr,
		label,
	};
}
