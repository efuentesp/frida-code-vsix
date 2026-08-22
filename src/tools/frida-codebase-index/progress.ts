/**
 * Parser del progreso de indexación (#109).
 *
 * El AutoIndexCoordinator del upstream mantiene el progreso vivo en memoria
 * mientras indexa y la tool index_status lo reporta como una línea:
 *   Auto-index progress: <phase> <pct>% (f/m files, c/n chunks)
 *
 * El host sondea index_status cada 2s durante index/rebuild (mismo proceso →
 * mismo coordinador) y publica este shape en CodebaseIndexUiState.progress.
 */

export interface IndexProgress {
	/** Fase upstream cruda: scanning | parsing | embedding. */
	phase: string;
	percentage: number;
	filesProcessed: number;
	totalFiles: number;
	chunksProcessed: number;
	totalChunks: number;
}

/** Extrae el progreso del texto de index_status; null si no hay línea. */
export function parseAutoIndexProgress(text: string): IndexProgress | null {
	if (typeof text !== "string") return null;
	const m = text.match(
		/Auto-index progress:\s*([\w-]+)\s+(\d+)%\s*\(([\d,.]*)\/([\d,.]*)\s*files,\s*([\d,.]*)\/([\d,.]*)\s*chunks\)/,
	);
	if (!m) return null;
	const num = (s: string | undefined): number => {
		const v = Number.parseInt((s ?? "").replace(/,/g, ""), 10);
		return Number.isFinite(v) ? v : 0;
	};
	return {
		phase: m[1],
		percentage: Math.min(100, Math.max(0, num(m[2]))),
		filesProcessed: num(m[3]),
		totalFiles: num(m[4]),
		chunksProcessed: num(m[5]),
		totalChunks: num(m[6]),
	};
}
