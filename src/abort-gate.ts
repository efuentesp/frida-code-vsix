// #90: gate de re-abort del run escapado — estado PURO e inyectable.
//
// Defecto (abort.log 2026-08-19 19:35, sesión nutrimetrics-9835): durante la
// ejecución de un tool, session.abort() cae en el GAP entre runs del SDK
// (agent_end del turno N → agent_start del turno N+1) donde el AgentSession
// no rastrea nada: abort() resuelve al instante como NO-OP y el siguiente run
// del ciclo tool→LLM arranca libre. Cuatro aborts → cuatro no-ops; el flujo
// siguió 18s más (toolResult +3s → respuesta +6.5s → auto-título → 500 →
// retry → final). El usuario percibe «Detener no funciona».
//
// Fix: gate en el host. abortRun marca el gate; si llega OTRO agent_start sin
// que haya habido settle real (isIdle=true), el host RE-ABORTA ese run (con
// isStreaming ya true, el abort del SDK SÍ lo mata). El gate se limpia con:
//   • agent_settled con isIdle=true (el ciclo de verdad paró)
//   • un prompt NUEVO del usuario (trabajo nuevo intencional)
//   • TTL de SILENCIO (#2, abort.log 2026-08-29 19:16, sesión SELE-DEV-756a):
//     el run escapado colgado 85s (provider timeout) outlive un TTL fijo
//     desde el request → su RETRY siguiente (2s después de su agent_end)
//     revivió el ciclo y corrió un turno completo. El TTL ahora corre desde
//     el ÚLTIMO evento del ciclo (agent_start / agent_settled), no desde el
//     request: mientras el ciclo siga emitiendo eventos, el gate sigue armado;
//     expira sólo tras 30s de silencio absoluto (anti-zombi) o prompt nuevo.
//
// Puro (sin I/O ni estado del SDK) para testear el contrato completo.

/** Vigencia del request de abort tras el ÚLTIMO evento del ciclo: suficiente
 * para cubrir cadenas tool→LLM, hangs de provider y retries; corto para no
 * interferir con trabajo nuevo. */
export const ABORT_GATE_TTL_MS = 30_000;

export interface AbortGate {
	/** Marca: hubo abort del usuario y el ciclo puede seguir vivo. */
	requestAbort(): void;
	/** agent_start del SDK → ¿debe el host re-abortar este run? */
	onAgentStart(s: { isIdle: boolean }): boolean;
	/** agent_settled del SDK → limpia el gate sólo si el agente de verdad paró. */
	onAgentSettled(s: { isIdle: boolean }): void;
	/** El usuario envió un prompt nuevo → limpia el gate (trabajo intencional). */
	onUserPrompt(): void;
	/** Estado actual (diagnóstico/forense). */
	isPending(): boolean;
}

export function createAbortGate(now: () => number = Date.now): AbortGate {
	let requestedAtMs: number | undefined;
	let lastEventAtMs: number | undefined;
	/** Expiración (#2): TTL de SILENCIO desde el último evento del ciclo —
	 *  max(request, último evento). Un ciclo que sigue emitiendo eventos
	 *  (retry, revive) mantiene el gate armado por tiempo indefinido. */
	const isExpired = () => {
		if (requestedAtMs === undefined) return true;
		const anchor = Math.max(requestedAtMs, lastEventAtMs ?? requestedAtMs);
		return now() - anchor > ABORT_GATE_TTL_MS;
	};
	return {
		requestAbort() {
			requestedAtMs = now();
		},
		onAgentStart(_s: { isIdle: boolean }): boolean {
			if (requestedAtMs === undefined) return false;
			if (isExpired()) {
				// Silencio > TTL: gate zombi — descartar y no re-abortar.
				requestedAtMs = undefined;
				lastEventAtMs = undefined;
				return false;
			}
			// El ciclo emitió un evento: la ventana corre desde AQUÍ (#2).
			lastEventAtMs = now();
			return true;
		},
		onAgentSettled(s: { isIdle: boolean }): void {
			if (s.isIdle) {
				requestedAtMs = undefined;
				lastEventAtMs = undefined;
			} else if (requestedAtMs !== undefined) {
				// Ciclo vivo (retry en curso): cuenta como evento (#2).
				lastEventAtMs = now();
			}
		},
		onUserPrompt(): void {
			requestedAtMs = undefined;
			lastEventAtMs = undefined;
		},
		isPending(): boolean {
			return requestedAtMs !== undefined && !isExpired();
		},
	};
}
