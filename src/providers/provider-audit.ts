// #86: provider-audit como extensión del SDK.
//
// Los hooks before_provider_request / after_provider_response son eventos de
// la ExtensionAPI (pi.on), NO del AgentSession. La primera iteración
// (2026-08-19, 6fed59a) los llamó como session.on desde wireSession →
// "session.on is not a function" → ninguna sesión arrancaba. Este factory
// replica el patrón de softtek-provider: se registra en extensionFactories y
// el SDK lo conecta por pi.on.
//
// Líneas que produce (todas con tag de sesión, rotación a cargo del appender
// inyectado — ver createForensicAppender en tools/frida-forensics.ts):
//   REQUEST model=provider/modelId   — cada llamada al LLM (modelo REAL del
//                                       payload; cae al ctx.model si falta)
//   HTTP status=N model=p/m          — respuestas ≥400 del provider
//
// Forense best-effort: NADA aquí puede lanzar — una auditoría rota nunca
// debe tumbar la sesión que intenta diagnosticar.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { forensicLine, formatModelRef } from "../tools/frida-forensics";

export interface ProviderAuditDeps {
	/** Sink forense (appender con rotación) — recibe la línea completa. */
	append: (line: string) => void;
	/** Tag de sesión (mismo namespace que abort.log). */
	tag: () => string;
	/** Notifica errores HTTP ≥400 (para causality de AUTO-CHANGE en el host). */
	onHttpError?: (status: number, modelRef: string) => void;
}

/** Ref legible del modelo del contexto de un evento (ctx.model). */
function modelRefOfCtx(ctx: any): { provider?: string; id?: string } {
	const m = ctx?.model;
	return {
		provider: typeof m?.provider === "string" ? m.provider : undefined,
		id: typeof m?.id === "string" ? m.id : undefined,
	};
}

export function createProviderAuditHooks(deps: ProviderAuditDeps) {
	return (pi: ExtensionAPI): void => {
		pi.on("before_provider_request", (event: any, ctx: any) => {
			try {
				const payloadModel =
					event?.payload && typeof event.payload === "object"
						? (event.payload as Record<string, unknown>).model
						: undefined;
				const { provider, id } = modelRefOfCtx(ctx);
				const modelId =
					typeof payloadModel === "string" ? payloadModel : id;
				deps.append(
					forensicLine(
						deps.tag(),
						`REQUEST model=${formatModelRef(provider, modelId)}`,
					),
				);
			} catch {
				/* noop — forense best-effort */
			}
		});

		pi.on("after_provider_response", (event: any, ctx: any) => {
			try {
				const status = Number(event?.status ?? 0);
				if (status < 400) return;
				const { provider, id } = modelRefOfCtx(ctx);
				const modelRef = formatModelRef(provider, id);
				deps.append(
					forensicLine(deps.tag(), `HTTP status=${status} model=${modelRef}`),
				);
				deps.onHttpError?.(status, modelRef);
			} catch {
				/* noop — forense best-effort */
			}
		});
	};
}
