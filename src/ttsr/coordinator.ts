// TTSR (#201): coordinator — orquesta regla violada → abort → steer → continue.
//
// Se cablea desde wireSession() (extension.ts), igual que la forense de abort:
// recibe TODOS los eventos de sesión con la sesión viva a mano. El flujo de
// una intervención:
//
//   message_update (delta) → extractScopes(partial) → matchRule por regla
//     → manager.shouldIntervene (guards anti-bucle)
//     → session.abort()            (la cadena curada en #2: resuelve al idle)
//     → session.steer(reminder)    (encola en el steering del SDK)
//     → session.agent.continue()   (drena el steering como mensaje siguiente:
//                                   último=assistant abortado → prompt con el
//                                   recordatorio; último=toolResult → continua)
//     → fallback followUp si continue lanza (carrera con activeRun)
//
// El parcial abortado queda en contexto (contextMode: "keep" en V1): el
// recordatorio llega justo después y corrige el rumbo. Descartarlo del
// transcript (modo discard) es V2 — documentado en el issue.
//
// Diagnóstico: mismo canal que la forense de abort (canal "Frida Abort" +
// ~/.frida/logs/abort.log) con prefijo [ttsr] — una sola línea de tiempo al
// depurar interacciones abort-usuario ↔ abort-TTSR.

import {
	BUILTIN_TTSR_RULES,
	extractScopes,
	matchRule,
	type TtsrRule,
	type TtsrScope,
} from "./rules";
import { createTtsrManager, type TtsrManager } from "./manager";

export interface TtsrCoordinatorDeps {
	/** Diag al canal Frida Abort (abortDiag del host). */
	diag: (msg: string) => void;
	/** Notificación al transcript del webview (post {type:"info"}). */
	notify: (text: string) => void;
	/** ¿TTSR activo? (setting frida.ttsr.enabled — se relee en cada evento). */
	isEnabled: () => boolean;
	/** Ids de reglas builtin desactivadas (frida.ttsr.disabledRules). */
	disabledRules: () => string[];
	now?: () => number;
}

/** Sesión del SDK con la superficie que TTSR toca (defensiva: todo opcional). */
export interface TtsrSessionLike {
	abort?: () => Promise<void>;
	steer?: (text: string) => Promise<void>;
	followUp?: (text: string) => Promise<void>;
	agent?: { continue?: () => Promise<void> };
}

export function createTtsr(deps: TtsrCoordinatorDeps) {
	const manager: TtsrManager = createTtsrManager({ now: deps.now });
	let activeSession: TtsrSessionLike | undefined;

	const rules = (): TtsrRule[] => {
		const off = new Set(deps.disabledRules());
		return BUILTIN_TTSR_RULES.filter((r) => !off.has(r.id));
	};

	/** ¿El handler debe ser barato? (disabled: no-op). */
	const armed = () => deps.isEnabled() && rules().length > 0;

	async function intervene(rule: TtsrRule, scope: TtsrScope, fragment: string) {
		manager.onIntervention(rule);
		deps.diag(
			`[ttsr] VIOLACIÓN rule=${rule.id} scope=${scope} match="${fragment}" → abort + steer + continue (${JSON.stringify(manager.snapshot())})`,
		);
		deps.notify(
			`🛡️ TTSR: ${rule.description} — stream interrumpido, recordatorio inyectado.`,
		);
		const s = activeSession;
		if (!s) {
			deps.diag(`[ttsr] sin sesión activa — sólo se registra la violación`);
			return;
		}
		try {
			await s.abort?.();
			deps.diag(`[ttsr] abort() OK`);
		} catch (e: any) {
			deps.diag(`[ttsr] abort() falló: ${String(e?.message ?? e)} — no se reinyecta`);
			return; // sin abort limpio no hay reintento confiable (lección de #2)
		}
		try {
			await s.steer?.(rule.reminder);
			deps.diag(`[ttsr] steer(reminder) OK`);
		} catch (e: any) {
			deps.diag(`[ttsr] steer falló: ${String(e?.message ?? e)}`);
			return;
		}
		try {
			await s.agent?.continue?.();
			deps.diag(`[ttsr] continue() OK — reintento con recordatorio`);
		} catch (e: any) {
			deps.diag(
				`[ttsr] continue() falló: ${String(e?.message ?? e)} — fallback followUp`,
			);
			try {
				await s.followUp?.(rule.reminder);
			} catch (e2: any) {
				deps.diag(`[ttsr] followUp también falló: ${String(e2?.message ?? e2)}`);
			}
		}
	}

	/** message_update: el hook principal (delta a delta, barato si no matchea). */
	function onMessageUpdate(event: any): void {
		if (!armed() || manager.isIntervening()) return;
		const partial = event?.assistantMessageEvent?.partial ?? event?.message;
		if (!partial) return;
		const scopes = extractScopes(partial);
		for (const rule of rules()) {
			for (const scope of rule.scopes) {
				const content =
					scope === "text"
						? scopes.text
						: scope === "thinking"
							? scopes.thinking
							: scopes.toolargs;
				const m = matchRule(rule, scope, content);
				if (
					m &&
					manager.shouldIntervene(rule, {
						ruleId: m.ruleId,
						scope: m.scope,
						pattern: m.pattern,
						fragment: m.fragment,
					})
				) {
					void intervene(rule, m.scope, m.fragment);
					return; // una intervención por delta; los guards del manager hacen el resto
				}
			}
		}
	}

	return {
		/** wireSession: registra la sesión viva y consume eventos del bus. */
		handleEvent(event: any, session: TtsrSessionLike | undefined): void {
			if (session) activeSession = session;
			switch (event?.type) {
				case "message_update":
					onMessageUpdate(event);
					break;
				case "agent_start":
					manager.onAgentStart();
					break;
				case "agent_end":
					// La ventana `intervening` se cierra con agent_start; agent_end
					// no la toca (el steer→continue puede disparar start de inmediato).
					break;
				default:
					break;
			}
		},
		/** Prompt nuevo del usuario (before_agent_start con prompt, vía host). */
		onUserPrompt(): void {
			manager.onUserPrompt();
		},
		/** Estado para diagnóstico/tests. */
		manager,
	};
}
