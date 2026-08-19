import type { ToolEntry } from "./types";

/**
 * Bloques de salida de una tool (Fase 2 P2, §5.2 del design system):
 * clasifica el resultado de una ejecución en bloques renderizables estilo
 * Copilot — codeblock bordeado máx ~13 líneas con «ver más», diff coloreado
 * y terminal para bash. Módulo PURO (sin React) para TDD.
 */

/** Máx de líneas visibles antes del «ver más» (§5.2: «máx ~13 líneas»). */
export const OUTPUT_MAX_LINES = 13;

export type OutputBlock =
	| {
			kind: "code";
			lines: string[]; // clampadas a OUTPUT_MAX_LINES
			full: string[]; // todas (modo expandido «ver más»)
			totalLines: number;
	  }
	| {
			kind: "diff";
			lines: string[];
			full: string[];
			totalLines: number;
			added: number;
			removed: number;
	  }
	| {
			kind: "terminal";
			lines: string[];
			full: string[];
			totalLines: number;
	  };

/** Divide en líneas SIN línea fantasma final (trailing \n no crea vacía). */
function toLines(text: string): string[] {
	if (text === "") return [];
	return text.split("\n");
}

/** Clampa al máximo visible, preservando el INICIO (fade inferior + ver más). */
function clamp(lines: string[]): { visible: string[]; total: number } {
	return { visible: lines.slice(0, OUTPUT_MAX_LINES), total: lines.length };
}

/** Conteo +/- de un diff unificado (para el subtítulo coloreado). */
export function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of toLines(diff)) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return { added, removed };
}

/**
 * Bloques de salida de una entrada tool:
 * - `diff` presente → bloque diff (coloreable línea a línea) con stats.
 * - tool bash → bloque terminal (fondo --vscode-terminal-background).
 * - resto → bloque code genérico.
 * Sin resultado → [] (nada que renderizar).
 */
export function buildOutputBlocks(entry: ToolEntry): OutputBlock[] {
	const diff = typeof entry.diff === "string" ? entry.diff.trim() : "";
	if (diff) {
		const all = toLines(diff);
		const { visible, total } = clamp(all);
		const { added, removed } = diffStats(diff);
		return [
			{
				kind: "diff",
				lines: visible,
				full: all,
				totalLines: total,
				added,
				removed,
			},
		];
	}
	const result = typeof entry.result === "string" ? entry.result : "";
	if (result === "") return [];
	const all = toLines(result);
	const { visible, total } = clamp(all);
	if (entry.tool === "bash") {
		return [{ kind: "terminal", lines: visible, full: all, totalLines: total }];
	}
	return [{ kind: "code", lines: visible, full: all, totalLines: total }];
}

/** ¿Algún bloque quedó recortado (debe offering «ver más»)? */
export function needsMore(blocks: OutputBlock[]): boolean {
	return blocks.some((b) => b.totalLines > b.lines.length);
}
