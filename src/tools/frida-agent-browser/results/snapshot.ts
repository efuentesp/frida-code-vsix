/**
 * frida-agent-browser — render compacto de snapshots (Fase 1).
 *
 * El binario upstream YA entrega `data.snapshot` (texto formateado con `[ref=eN]`) y
 * `data.refs` (mapa estructurado). Aquí armamos una salida agent-friendly: el texto
 * del binario + una tabla compacta de refs accionables (`@eN role "name"`), ordenada
 * por id numérico. Esto reemplaza el volcado JSON crudo del porte Esencial.
 */

import { getRefs, getSnapshotText, type AgentBrowserData } from "./envelope";

/** Compara ids de ref ("e1","e2",…,"e10") por su número, no lexicográfico. */
export function compareRefIds(a: string, b: string): number {
	const na = parseInt(a.replace(/^e/i, ""), 10) || 0;
	const nb = parseInt(b.replace(/^e/i, ""), 10) || 0;
	return na - nb;
}

function quoteName(name: string): string {
	const trimmed = name.trim();
	return trimmed === "" ? "" : `"${trimmed}"`;
}

/** Lista compacta de refs: `@e1 heading "Example Domain"`. */
export function renderRefList(
	data: AgentBrowserData | null | undefined,
): string[] {
	const refs = getRefs(data);
	return Object.entries(refs)
		.sort(([a], [b]) => compareRefIds(a, b))
		.map(([id, entry]) => {
			const role =
				typeof entry.role === "string" && entry.role.length > 0
					? entry.role
					: "unknown";
			const name = typeof entry.name === "string" ? quoteName(entry.name) : "";
			return name ? `- @${id} ${role} ${name}` : `- @${id} ${role}`;
		});
}

/**
 * Texto agent-friendly para un snapshot exitoso: cuerpo del binario + tabla de refs.
 * Si el binario no entregó `snapshot`, se arma sólo la tabla de refs.
 */
export function renderSnapshot(
	data: AgentBrowserData | null | undefined,
): string {
	const body = getSnapshotText(data);
	const refs = renderRefList(data);
	const parts: string[] = [];
	if (body) parts.push(body.trim());
	if (refs.length > 0) parts.push(`Refs (${refs.length}):\n${refs.join("\n")}`);
	return parts.length > 0
		? parts.join("\n\n")
		: "(snapshot returned no content.)";
}
