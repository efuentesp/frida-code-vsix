import * as fs from "node:fs";

/**
 * Estadísticas acumuladas de una sesión, leídas de su JSONL en disco (la fuente
 * de verdad: guarda TODO el historial, incluido el evento `compaction` con su
 * propio usage). Las usa `postUsage` (extension.ts) para que el tiempo de sesión
 * y los tokens NO se pierdan al recargar una sesión ni tras una compactación:
 * el estado en memoria (`session.agent.state.messages`) puede estar truncado al
 * contexto vivo, pero el archivo siempre conserva el histórico completo.
 */
export interface SessionStats {
	/** epoch ms — timestamp de la PRIMERA entrada de la sesión (su inicio). */
	firstTs: number;
	/** epoch ms — timestamp de la ÚLTIMA entrada (avanza con cada turno). */
	lastTs: number;
	inputTotal: number;
	outputTotal: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	/** #107 — Duración de cada turno cerrado: ts(mensaje user) → ts(última
	 *  entrada antes del siguiente user msg). El turno ABIERTO se omite (el
	 *  timer en vivo del webview lo cubre); un turno abortado cuenta hasta su
	 *  última entrada emitida. */
	turns: Array<{ startMs: number; endMs: number }>;
	/** Σ duraciones de turnos cerrados ("tiempo activo", sin gaps de lectura). */
	activeMs: number;
	/** nº de turnos cerrados. */
	turnCount: number;
}

/** Caché por (archivo, mtime): relee el JSONL sólo cuando cambió en disco. Así
 *  postUsage (que se llama en varios puntos por turno) no reparsea en vano. */
let cache: { file: string; mtime: number; stats: SessionStats | null } = {
	file: "",
	mtime: -1,
	stats: null,
};

/** Normaliza un timestamp que puede ser epoch ms (number, en memoria) o ISO
 *  string (formato del JSONL de pi en disco). null si no es parseable. */
function toMs(ts: unknown): number | null {
	if (typeof ts === "number" && Number.isFinite(ts)) return ts;
	if (typeof ts === "string" && ts) {
		const ms = Date.parse(ts);
		return Number.isNaN(ms) ? null : ms;
	}
	return null;
}

/** `cost` puede ser un número (en memoria) o un objeto { total, ... } (en el
 *  JSONL de pi). Devuelve el monto numérico en cualquier caso. */
function toCost(c: unknown): number {
	if (typeof c === "number" && Number.isFinite(c)) return c;
	if (c && typeof c === "object" && "total" in c) {
		const t = (c as { total: unknown }).total;
		return typeof t === "number" && Number.isFinite(t) ? t : 0;
	}
	return 0;
}

/**
 * Lee las estadísticas acumuladas de una sesión desde su JSONL en disco.
 *
 * Itera cada línea y acumula:
 *  - `firstTs`/`lastTs` del timestamp de cada entrada (min/max).
 *  - tokens de `entry.message.usage` (assistant messages) y de `entry.usage`
 *    (el evento `compaction`, que también consume tokens).
 *
 * @param sessionFile Ruta del JSONL (típicamente `session.sessionFile`).
 * @returns null si no hay archivo / no se puede leer. Defensivo: las líneas
 *          malformadas se ignoran sin abortar el recuento.
 */
export function readSessionStats(
	sessionFile: string | undefined | null,
): SessionStats | null {
	if (!sessionFile) return null;
	try {
		const st = fs.statSync(sessionFile);
		if (!st.isFile()) return null;
		// Reutilizar caché si el archivo no cambió (mismo path + mismo mtime).
		if (cache.file === sessionFile && cache.mtime === st.mtimeMs) {
			return cache.stats;
		}
		const raw = fs.readFileSync(sessionFile, "utf8");
		const stats: SessionStats = {
			firstTs: 0,
			lastTs: 0,
			inputTotal: 0,
			outputTotal: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			turns: [],
			activeMs: 0,
			turnCount: 0,
		};
		let first = Infinity;
		let last = 0;
		// #107 — turno en construcción: abre con el user msg (startMs) y cierra
		// con la última entrada antes del siguiente user msg (endMs). user sin
		// timestamp abre turno con startMs null (se descarta al cerrar: no se
		// puede medir duración) sin romper el recuento del resto.
		let openStart: number | null = null;
		// Última entrada con timestamp vista desde la apertura del turno actual
		// (el cierre real del turno abierto).
		let lastOpenEnd = 0;
		for (const line of raw.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			let entry: any;
			try {
				entry = JSON.parse(t);
			} catch {
				continue; // línea malformada: ignorar sin abortar
			}
			// Cada entrada de pi trae `timestamp` (ISO string en disco).
			const ms = toMs(entry?.timestamp);
			if (ms !== null) {
				if (ms < first) first = ms;
				if (ms > last) last = ms;
			}
			// #107 — detección de turno: un mensaje user abre turno; cualquier
			// otra entrada con timestamp lo va cerrando (actualiza endMs).
			const isUser = entry?.type === "message" && entry?.message?.role === "user";
			if (isUser) {
				// Cierra el turno previo (si quedó uno abierto con última entrada
				// conocida) justo antes de abrir el nuevo.
				if (openStart !== null && openStart > 0 && lastOpenEnd > openStart) {
					stats.turns.push({ startMs: openStart, endMs: lastOpenEnd });
				}
				openStart = ms !== null && ms > 0 ? ms : null;
				lastOpenEnd = 0;
			} else if (ms !== null && ms > 0) {
				if (ms > lastOpenEnd) lastOpenEnd = ms;
			}
			// usage: el assistant message lo trae anidado en entry.message.usage;
			// el evento compaction lo traza en entry.usage (toplevel).
			const usage =
				entry?.type === "compaction"
					? entry?.usage
					: entry?.message?.role === "assistant"
						? entry?.message?.usage
						: undefined;
			if (usage) {
				stats.inputTotal += Number(usage.input ?? 0) || 0;
				stats.outputTotal += Number(usage.output ?? 0) || 0;
				stats.cacheRead += Number(usage.cacheRead ?? 0) || 0;
				stats.cacheWrite += Number(usage.cacheWrite ?? 0) || 0;
				stats.cost += toCost(usage.cost);
			}
		}
		stats.firstTs = first === Infinity ? 0 : first;
		stats.lastTs = last;
		// Cierra el último turno del archivo (turno final cerrado con entradas).
		if (openStart !== null && openStart > 0 && lastOpenEnd > openStart) {
			stats.turns.push({ startMs: openStart, endMs: lastOpenEnd });
		}
		stats.activeMs = stats.turns.reduce(
			(acc, t) => acc + (t.endMs - t.startMs),
			0,
		);
		stats.turnCount = stats.turns.length;
		cache = { file: sessionFile, mtime: st.mtimeMs, stats };
		return stats;
	} catch {
		return null;
	}
}
