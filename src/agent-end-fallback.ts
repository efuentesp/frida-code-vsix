// Extraído de extension.ts (rama agent_end sin salida): decide qué mensaje
// publicar cuando el agente termina. Bug del "mensaje fantasma": el fallo
// retriable del intento 1 publicaba el fallback genérico (401/key) ANTES del
// auto-retry que sí respondía → el usuario veía error + respuesta. Las ramas
// 1-2 (errorMessage/lastMessageError) ya filtraban por !willRetry; ahora la
// rama 3 también — en willRetry=true TODO calla y espera al intento final.
//
// Puro y testeable (test/agent-end-fallback.test.ts). El mensaje exacto de la
// rama 3 se conserva byte a byte (es contrato visible del panel).

export interface AgentEndFallbackInput {
	/** agent_end.errorMessage del evento (error terminal del provider). */
	errorMessage?: string | undefined;
	/** Error dejado en el último mensaje assistant (issue #6, stopReason=error). */
	lastMessageError?: string | undefined;
	/** pi-ai va a reintentar automáticamente (auto_retry_start). */
	willRetry?: boolean;
	/** El turno produjo texto visible o al menos una tool_call. */
	hadText: boolean;
	hadToolCall: boolean;
	/** Proveedor activo es DevEngine (SOFTTEK_PROVIDER). */
	isDevEngine: boolean;
	/** Nombre visible del proveedor activo (getApiKeyProvider().displayName). */
	providerDisplayName: string;
}

/** null = no publicar nada; string = texto del provider_error. */
export function agentEndFallbackText(
	input: AgentEndFallbackInput,
): string | null {
	const {
		errorMessage,
		lastMessageError,
		willRetry = false,
		hadText,
		hadToolCall,
		isDevEngine,
		providerDisplayName,
	} = input;

	// Fallo retriable: el auto-retry puede responder. NO alarmar con el
	// fallback genérico; si todos los reintentos fallan, el agent_end FINAL
	// (willRetry=false) publica el error que corresponda.
	if (willRetry) return null;

	// Rama 1: error terminal del provider (no se reintenta).
	if (errorMessage) return String(errorMessage);

	// Rama 2 (issue #6): pi-ai dejó el error en el mensaje, no en el evento.
	if (lastMessageError) return String(lastMessageError);

	// El turno produjo salida: no hay nada que reportar.
	if (hadText || hadToolCall) return null;

	// Rama 3: terminó sin texto, sin tools y sin error capturable → fallback
	// consciente del proveedor (antes hardcodeado a DevEngine para todos).
	return isDevEngine
		? `El modelo no generó respuesta. Causa probable: API key inválida o vencida (401), o el gateway DevEngine no respondió. Renueva tu API key o ejecuta "Frida: Diagnosticar gateway DevEngine".`
		: `El modelo no generó respuesta (${providerDisplayName}). Causa probable: API key inválida o vencida (401), o el modelo/ID es incorrecto. Verifica tu API key en el panel de Proveedores.`;
}
