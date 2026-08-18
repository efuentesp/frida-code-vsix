// Hooks de sesión Frida Enterprise (ADR-1002) — DELGADOS.
//
// Patrón del bundle ORIGINAL (verificado en 2.1.28): los 9 call-sites LLM —
// incluidos los laterales de título/summary — pasan user_id/email EXPLÍCITOS
// en cada request; nunca dependen de un contexto ambiental de "modelo activo".
// Réplica en pi: la identidad vive en el runtime (capturada por oauth.getApiKey
// o por el Bearer frida de before_provider_headers) y se inyecta SIEMPRE que
// se conozca; ctx.model sólo se usa como EXCLUSIÓN (otro provider conocido
// nunca se toca — S4). Como el runner traga errores de handlers en silencio,
// el acceso a ctx.model va envuelto en try/catch (S2b).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FRIDA_ENTERPRISE_PROVIDER } from "./oauth";
import {
	buildFridaPayload,
	payloadShapeTag,
	reasoningEffortTag,
} from "./adapter";
import { dbg, type FridaEnterpriseRuntime } from "./runtime";

export interface FridaEnterpriseProviderDeps {
	/** Se invoca al recibir 401/403 → el host reabre el login OAuth. */
	onUnauthorized: () => void;
	/** Runtime compartido con el oauth del provider (identidad del idToken). */
	runtime: FridaEnterpriseRuntime;
}

/** ¿El contexto indica OTRO provider (no frida)? Nunca tocarlo. */
function isOtherKnownProvider(ctx: any): boolean {
	try {
		const provider = ctx?.model?.provider;
		return typeof provider === "string" && provider !== FRIDA_ENTERPRISE_PROVIDER;
	} catch {
		return false; // getter roto → tratar como desconocido, no como exclusión
	}
}

function safeProvider(ctx: any): string {
	try {
		return ctx?.model?.provider ?? "undefined";
	} catch {
		return "getter-roto";
	}
}

/** Resumen de diagnóstico de un mensaje assistant (instrumentación del corte
 *  de conversación, Errata-11/#2): stopReason + composición de bloques +
 *  errorMessage. Pura y defensiva: NUNCA lanza (Errata-6: getters hostiles). */
export function summarizeMessageEnd(message: any): string {
	try {
		if (!message || typeof message !== "object")
			return "message_end: mensaje ausente/malformado";
		const counts: Record<string, number> = {};
		let textChars = 0;
		if (Array.isArray(message.content)) {
			for (const b of message.content) {
				if (!b || typeof b !== "object") continue;
				const t = String(b.type ?? "?");
				counts[t] = (counts[t] ?? 0) + 1;
				if (t === "text" && typeof b.text === "string") textChars += b.text.length;
			}
		}
		const blocks = Object.entries(counts)
			.map(([k, v]) => `${k}:${v}`)
			.join(",");
		const stop = message.stopReason ?? "?";
		const model = typeof message.model === "string" ? message.model : "?";
		// ADR-1003-F3: tokens razonados reportados por el gateway (aunque el
		// backend no emitiera resumen → sin tarjeta thinking, el uso existió).
		const reasoningTokens = Number(message?.usage?.reasoning ?? 0);
		const reasoning =
			Number.isFinite(reasoningTokens) && reasoningTokens > 0
				? ` reasoning=${reasoningTokens}`
				: "";
		const err =
			typeof message.errorMessage === "string" && message.errorMessage
				? ` err="${message.errorMessage.slice(0, 120)}"`
				: "";
		return `message_end: model=${model} stop=${stop} blocks=[${blocks}] textLen=${textChars}${reasoning}${err}`;
	} catch (e: any) {
		return `message_end: resumen falló (${String(e?.message ?? e).slice(0, 80)})`;
	}
}

export function createFridaEnterpriseHooks(deps: FridaEnterpriseProviderDeps) {
	const { onUnauthorized, runtime } = deps;
	return (pi: ExtensionAPI) => {
		// Orden real de pi-ai (models.js): transformHeaders corre ANTES que
		// api.stream/onPayload. Además de respaldo, es la fuente cuando la
		// sesión aún no resolvió auth por getApiKey.
		pi.on("before_provider_headers", (event: any) => {
			const value =
				event?.headers?.Authorization ?? event?.headers?.authorization ?? "";
			if (value)
				runtime.rememberToken(
					String(value).replace(/^Bearer\s+/i, ""),
				);
		});

		pi.on("before_provider_request", (event: any, ctx: any) => {
			const payload = event?.payload;
			if (!payload || typeof payload !== "object") return payload;
			// Errata-7: decidir por LA REQUEST (payload.model), no por el
			// contexto ambiental — ctx.model llegó VENCIDO en el host real
			// (decía zai para una request NIKE-VICTORY → 422). La whitelist la
			// mantiene el runtime (semilla VERIFIED + catálogo/store/fallback).
			const modelId =
				typeof payload.model === "string" ? payload.model : undefined;
			if (modelId !== undefined) {
				if (!runtime.knowsModel(modelId)) {
					dbg(`payload: EXCLUIDO por modelo (${modelId} no es frida-enterprise)`);
					return;
				}
			} else if (isOtherKnownProvider(ctx)) {
				// payload sin model (raro en chat/completions): defensa ctx.
				dbg(`payload: EXCLUIDO (provider=${safeProvider(ctx)})`);
				return;
			}
			const identity = runtime.getIdentity();
			if (!identity.user_id && !identity.email) {
				// Este estado es el que producía el 422: sin identidad vista.
				dbg(`payload: SIN identidad (provider=${safeProvider(ctx)}) → sin inyectar ⚠`);
				return;
			}
			try {
				const out = buildFridaPayload(payload, identity);
				// ADR-1003-F2: el effort viaja SIEMPRE visible en el log (nivel del
				// footer Bajo/Medio/Alto/Off; "ausente" delata un payload sin nivel).
				dbg(`payload: identidad inyectada (provider=${safeProvider(ctx)}, user_id=${String(identity.user_id ?? "?").slice(0, 6)}…) · ${reasoningEffortTag(out)} · ${payloadShapeTag(payload)}`);
				return out;
			} catch (e: any) {
				dbg(`payload: buildFridaPayload falló (${String(e?.message ?? e).slice(0, 80)}) → payload intacto`);
				return payload;
			}
		});

		pi.on("after_provider_response", (event: any, ctx: any) => {
			try {
				if (ctx?.model?.provider !== FRIDA_ENTERPRISE_PROVIDER) return;
			} catch {
				return;
			}
			dbg(`respuesta HTTP ${event?.status} (provider=${safeProvider(ctx)})`);
			if (event?.status === 401 || event?.status === 403) {
				onUnauthorized();
			}
		});

		// Instrumentación del corte de conversación (Errata-11/#2): ante un
		// turno que "se corta" con modelos frida, el log de debug registra
		// stopReason (length=truncado, error=fallo, stop=cierre conductual) +
		// composición del mensaje. Sólo mensajes frida; jamás lanza.
		pi.on("message_end", (event: any) => {
			let message: any;
			try {
				message = event?.message;
				if (
					!message ||
					typeof message !== "object" ||
					message.provider !== FRIDA_ENTERPRISE_PROVIDER
				)
					return;
			} catch {
				return; // getter roto (Errata-6): nada que reportar
			}
			dbg(summarizeMessageEnd(message));
		});
	};
}
