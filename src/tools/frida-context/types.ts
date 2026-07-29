// Tipos compartidos de frida-context. `ContextPressureSnapshot` se mueve aquí para
// que analysis.ts y index.ts lo importen sin ciclo.

/** Lectura puntual de la presión del contexto (paridad ContextPressureSnapshot
 *  de supi). Shape constante: el agente puede parsearla sin inspección. */
export interface ContextPressureSnapshot {
	modelName: string;
	contextWindow: number | null;
	usedTokens: number;
	/** % de la contextWindow usada (null si contextWindow desconocido). */
	usagePercent: number | null;
	compactionEnabled: boolean;
	reserveTokens: number;
	/** Tokens libres antes de tocar el reserve (contextWindow - reserve - used). */
	headroomTokens: number | null;
	/** % de la capacidad EFECTIVA (contextWindow - reserve) usada. >100% ⇒ compactar. */
	pressurePercent: number | null;
	/** ¿La rama activa tiene una entrada de compaction? */
	compacted: boolean;
	/** Nota cuando usedTokens es estimado (el gateway no reportó medición). */
	approximationNote: string | null;
}
