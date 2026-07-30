/**
 * frida-agent-browser — tipos del sobre JSON del binario upstream (Fase 1).
 *
 * Contrato verificado contra agent-browser 0.33.1 (captura real):
 *   { success: boolean, data: {...} | null, error: string | null }
 *   - open       → data: { lifecycle, title, url }
 *   - snapshot   → data: { lifecycle, origin, refs: { e1:{name,role}, … }, snapshot: "<texto>" }
 *   - error      → data: null, error: "<mensaje>"
 *
 * Los keys de `refs` son "e1","e2" (sin @); el binario usa "@e1" como id en comandos.
 */

export interface RefEntry {
	name?: string;
	role?: string;
	[key: string]: unknown;
}

export interface AgentBrowserData {
	lifecycle?: Record<string, unknown>;
	/** URL activa (open) o de origen (snapshot). */
	origin?: string;
	url?: string;
	title?: string;
	/** Mapa de refs estructurado: { "e1": { name, role }, … }. */
	refs?: Record<string, RefEntry>;
	/** Texto de snapshot ya formateado por el binario (incluye [ref=eN]). */
	snapshot?: string;
	/** Datos arbitrarios del comando (batch steps, get text, etc.). */
	[key: string]: unknown;
}

export interface AgentBrowserEnvelope {
	success: boolean;
	data?: AgentBrowserData | null;
	error?: string | null;
}

export function isEnvelope(v: unknown): v is AgentBrowserEnvelope {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof (v as { success?: unknown }).success === "boolean"
	);
}

/** Mapa de refs (data.refs), normalizado. */
export function getRefs(
	data: AgentBrowserData | null | undefined,
): Record<string, RefEntry> {
	return data && typeof data.refs === "object" && data.refs !== null
		? (data.refs as Record<string, RefEntry>)
		: {};
}

/** URL relevante (open usa `url`; snapshot usa `origin`). */
export function getOrigin(
	data: AgentBrowserData | null | undefined,
): string | undefined {
	return data?.url ?? data?.origin ?? undefined;
}

/** Texto de snapshot formateado por el binario. */
export function getSnapshotText(
	data: AgentBrowserData | null | undefined,
): string | undefined {
	return typeof data?.snapshot === "string" ? data.snapshot : undefined;
}
