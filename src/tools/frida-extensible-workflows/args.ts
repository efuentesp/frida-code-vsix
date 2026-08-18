/**
 * frida-extensible-workflows — normalización de args (#76).
 *
 * Algunos modelos (incidente GLM-5.3, 2026-08-18) serializan los objetos
 * anidados de sus tool calls como string JSON — la llamada llega con
 * args: '{"idea": "…"}' en vez del objeto plano. El schema de la tool
 * (Type.Unknown) lo deja pasar y el validador del patrón rechazaba con un
 * mensaje que apuntaba a la capa equivocada, llevando al modelo a bordear
 * el patrón curado generando su propio script por scriptPath.
 *
 * Decodificación tolerante: un string que parsea a OBJETO JSON se
 * convierte en objeto; cualquier otra cosa pasa intacta (args escalares
 * son legítimos, y un JSON corrupto no debe romper la frontera).
 */
import type { JsonValue } from "./core/types";

export function normalizeWorkflowArgs(raw: unknown): JsonValue {
	if (typeof raw !== "string") {
		return (raw ?? null) as JsonValue;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		// Sólo objetos: arrays y escalares string-codificados no son el
		// patrón del incidente y podrían ser args legítimos.
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as JsonValue;
		}
	} catch {
		// String no-JSON → args escalar legítimo (o payload raro): intacto.
	}
	return raw;
}
