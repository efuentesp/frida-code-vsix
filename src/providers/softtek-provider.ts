import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

export const SOFTTEK_PROVIDER = "softtek-devengine";
export const SOFTTEK_MODEL = "gpt-5.4-mini";
export const SOFTTEK_MODEL_DISPLAY = "GPT-5.4 Mini";
export const SOFTTEK_PROVIDER_DISPLAY = "Softtek DevEngine";
export const DEVENGINE_BASE_URL = "https://mywork.softtek.com/apg/devengine";

/** Metadatos del modelo resueltos del catálogo canónico de pi-ai (modelo NATIVO,
 *  no del gateway). */
export interface CanonicalModelMeta {
	contextWindow?: number;
	maxTokens?: number;
	reasoning: boolean;
	input: ("text" | "image")[];
	thinkingLevelMap?: Record<string, string | null>;
}

/** Proveedores canónicos donde buscar el modelo base (priorizamos Azure porque
 *  DevEngine enruta a Azure; luego openai/copilot/opencode). Excluimos openai-codex
 *  (su contexto es de codificación, 272000, no el general). */
const CANONICAL_LOOKUP_PROVIDERS = [
	"azure-openai-responses",
	"openai",
	"github-copilot",
	"opencode",
];

/** Busca `modelId` en los catálogos canónicos de pi-ai y devuelve sus metadatos
 *  (contextWindow/maxTokens/reasoning/input/thinkingLevelMap). undefined si no aparece. */
export function lookupCanonicalModelMeta(
	mr: any,
	modelId: string,
): CanonicalModelMeta | undefined {
	for (const providerId of CANONICAL_LOOKUP_PROVIDERS) {
		const m = mr
			?.getModels?.(providerId)
			?.find?.((mm: any) => mm.id === modelId);
		if (m) {
			return {
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
				reasoning: m.reasoning ?? true,
				input: Array.isArray(m.input) ? m.input : ["text", "image"],
				thinkingLevelMap: m.thinkingLevelMap,
			};
		}
	}
	return undefined;
}

/** Auto-detect del contextWindow REAL del gateway DevEngine vía GET /models.
 *  Best-effort (timeout 10s): lee context_window/context_length del modelo; si no lo
 *  expone o falla, devuelve undefined y el caller hace fallback. Reutiliza el patrón
 *  de diagnoseGateway (X-Api-Key, probe /models). */
export async function fetchDevengineContextWindow(
	baseUrl: string,
	key: string,
	modelId: string,
): Promise<number | undefined> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 10000);
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
			method: "GET",
			headers: { "X-Api-Key": key },
			signal: ctrl.signal,
		});
		if (!res.ok) return undefined;
		const json = (await res.json()) as any;
		// Formato OpenAI {data:[{id,…}]} o variante del gateway; buscamos por id.
		const list: any[] = Array.isArray(json?.data)
			? json.data
			: Array.isArray(json)
				? json
				: [];
		const match = list.find((m) => m?.id === modelId) ?? list[0];
		const cw =
			match?.context_window ?? match?.context_length ?? match?.contextWindow;
		return typeof cw === "number" && cw > 0 ? cw : undefined;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Config del proveedor (ProviderConfigInput). Se registra DIRECTAMENTE en el
 * ModelRuntime (vía registerProvider), NO en la factory, para que
 * modelRuntime.getModel(...) lo resuelva. (Riesgo #1 del PoC, ya resuelto.)
 *
 *  `meta` (opcional) trae los metadatos del catálogo canónico (reasoning/input/
 *  thinkingLevelMap del modelo nativo). El contextWindow/maxTokens vienen ya
 *  RESUELTOS por el caller (override > gateway > catálogo > default). El `compat`
 *  (requiresThinkingAsText etc.) es específico del bug de DevEngine (ADR-0009).
 */
export function buildSofttekProviderConfig(opts: {
	contextWindow: number;
	maxTokens: number;
	meta?: CanonicalModelMeta;
}) {
	return {
		name: "Softtek DevEngine Gateway",
		baseUrl: DEVENGINE_BASE_URL,
		api: "openai-completions", // ⚠️ Pi añade /chat/completions — verificar el path en runtime
		authHeader: false, // el gateway NO usa Authorization: Bearer; la key va como X-Api-Key
		// vía before_provider_headers. Esto además evita el gate "No API key".
		models: [
			{
				id: SOFTTEK_MODEL,
				name: SOFTTEK_MODEL_DISPLAY,
				reasoning: opts.meta?.reasoning ?? true,
				input: (opts.meta?.input ?? ["text", "image"]) as ("text" | "image")[],
				...(opts.meta?.thinkingLevelMap
					? { thinkingLevelMap: opts.meta.thinkingLevelMap }
					: {}),
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				// Ajustables desde settings (frida.devengine.contextWindow / maxTokens).
				contextWindow: opts.contextWindow,
				maxTokens: opts.maxTokens,
				compat: {
					supportsReasoningEffort: true, // DevEngine acepta reasoning_effort (low/medium/high)
					// El gateway DEVUELVE reasoning_content en el stream, pero NO lo acepta de vuelta
					// como campo de un mensaje assistant del historial (responde 500 al continuar una
					// sesión con razonamiento previo). requiresThinkingAsText hace que pi reenvíe el
					// thinking como TEXTO plano en `content` (estándar OpenAI) en vez de como el campo
					// `reasoning_content` → el gateway lo acepta. Fix de fondo: ver ADR-0009.
					requiresThinkingAsText: true,
					// El gateway rechaza `content: null` en mensajes assistant con tool_calls
					// (responde 500). requiresAssistantAfterToolResult hace que pi envíe
					// `content: ""` (string vacío) en vez de `null`. Efecto colateral menor:
					// inserta un assistant puente ("I have processed the tool results.") entre
					// toolResult y user; benigno. Fix de fondo: ver ADR-0009.
					requiresAssistantAfterToolResult: true,
				},
			},
		],
	};
}

export interface SofttekProviderDeps {
	/** Lee la key del cache en memoria (síncrono). */
	getKey: () => string | undefined;
	/** Se invoca al recibir 401 → el host reabre el onboarding. */
	onUnauthorized: () => void;
	/** Se invoca al recibir 4xx/5xx del gateway → el host dumpea el request
	 *  (DevEngine no devuelve body en el 500, así que el error es opaco; el
	 *  request nos dice qué campo lo rechaza). Ver ADR-0009. */
	onProviderError?: (payload: unknown, status: number) => void;
	/** Path donde dumpear cada request enviado (overwrite). El último request queda
	 *  disponible cuando el gateway responde 500 (after_provider_response no se
	 *  dispara para 500, así que se dumpea ANTES de enviar). Ver ADR-0009. */
	requestDumpPath?: string;
	/** H-2/H-3 (HALLAZGOS-GATEWAY): path donde escribir el diagnóstico del
	 *  último 500 opaco decodificado vía re-probe con stream:false. */
	diagnosticDumpPath?: string;
	/** Resultado del diagnóstico de un 5xx opaco (mensaje accionable para el
	 *  usuario). El host lo muestra en el panel de errores. */
	onGatewayDiagnosis?: (diagnosis: GatewayDiagnosis) => void;
	/** Inyectable para pruebas (default: fetch global). */
	fetchImpl?: typeof fetch;
}

// ─── H-2/H-3: diagnóstico de errores opacos del gateway ─────────────────────

/** H-2: el gateway rechaza tools declaradas no registradas en el proyecto
 *  (registro vacío) cuando su clasificador vincula la intención del texto
 *  del usuario con la tool. Ejemplo real (2026-08-17):
 *  "No existe una tool activa con nombre 'steer_subagent' para el proyecto 22" */
export const DEVENGINE_INACTIVE_TOOL_RE =
	/No existe una tool activa con nombre '([^']+)' para el proyecto \d+/i;

export type GatewayErrorKind =
	| "inactive-tool-validation"
	| "invalid-request"
	| "server-error"
	| "unknown";

export interface GatewayDiagnosis {
	/** Status del stream original (p. ej. 500, el opaco). */
	requestStatus: number;
	/** Status del re-probe con stream:false (el REAL; null si el probe falló). */
	probeStatus: number | null;
	/** Body crudo del re-probe (evidencia). */
	probeBodyText: string | null;
	kind: GatewayErrorKind;
	toolName?: string;
	/** Mensaje listo para mostrar al usuario. */
	actionableMessage: string;
	probedAt: string;
}

/** Clasifica el body de un error del gateway DevEngine. Pura. */
export function classifyGatewayError(
	status: number,
	bodyText: string | null | undefined,
): Omit<GatewayDiagnosis, "requestStatus" | "probeStatus" | "probeBodyText" | "probedAt"> {
	const text = String(bodyText ?? "");
	const m = DEVENGINE_INACTIVE_TOOL_RE.exec(text);
	if (status === 400 && m) {
		const toolName = m[1];
		return {
			kind: "inactive-tool-validation",
			toolName,
			actionableMessage:
				`DevEngine rechazó el mensaje: el gateway vinculó la intención con la tool '${toolName}', ` +
				`que no está registrada como "activa" en el proyecto (validación H-2 del gateway, no de la extensión). ` +
				`Reintenta con otra redacción o reporta a DevEngine con el dump adjunto.`,
		};
	}
	if (status >= 500) return { kind: "server-error", actionableMessage: `DevEngine respondió ${status} (error del servidor; reintentar más tarde).` };
	if (status >= 400) return { kind: "invalid-request", actionableMessage: `DevEngine rechazó la petición (${status}): ${text.slice(0, 200) || "sin body"}` };
	return { kind: "unknown", actionableMessage: `Respuesta inesperada del gateway (${status}).` };
}

/** H-3: en streaming, un 400 del gateway llega como 500 SIN body. Este probe
 *  reenvía el MISMO payload con stream:false para capturar el error real y
 *  clasificarlo. NUNCA lanza. Un solo intento — el rechazo es determinista. */
export async function diagnoseOpaque500(
	payload: unknown,
	opts: { key: string; baseUrl?: string; fetchImpl?: typeof fetch; requestStatus?: number },
): Promise<GatewayDiagnosis> {
	const base = (opts.baseUrl ?? DEVENGINE_BASE_URL).replace(/\/$/, "");
	const fetchFn = opts.fetchImpl ?? fetch;
	const probeStatus = opts.requestStatus ?? 500;
	const probedAt = new Date().toISOString();
	try {
		const body =
			payload && typeof payload === "object"
				? JSON.stringify({ ...(payload as object), stream: false })
				: null;
		if (!body) throw new Error("payload ausente (sin dump del request)");
		const res = await fetchFn(`${base}/chat/completions`, {
			method: "POST",
			headers: {
				"X-Api-Key": opts.key,
				"Content-Type": "application/json",
			},
			body,
		});
		const bodyText = await res.text().catch(() => null);
		return {
			requestStatus: probeStatus,
			probeStatus: res.status,
			probeBodyText: bodyText,
			probedAt,
			...classifyGatewayError(res.status, bodyText),
		};
	} catch (e: any) {
		return {
			requestStatus: probeStatus,
			probeStatus: null,
			probeBodyText: String(e?.message ?? e),
			kind: "unknown",
			actionableMessage: `DevEngine respondió ${probeStatus} y el diagnóstico falló: ${String(e?.message ?? e).slice(0, 120)}`,
			probedAt,
		};
	}
}
/**
 * Factory de la extensión de Pi con SOLO los hooks. NO registra el provider
 * (eso va en ModelRuntime.registerProvider). El gateway usa **X-Api-Key**
 * (no Bearer), por lo que la key se inyecta en before_provider_headers.
 */
export function createSofttekProviderHooks(deps: SofttekProviderDeps) {
	return (pi: ExtensionAPI) => {
		// CRÍTICO (ADR-0005): inyectar la key SOLO en requests a NUESTRO provider.
		pi.on("before_provider_headers", (event: any, ctx: any) => {
			if (ctx.model?.provider !== SOFTTEK_PROVIDER) return;
			const key = deps.getKey();
			if (key) {
				event.headers["X-Api-Key"] = key;
				event.headers["authorization"] = null; // el gateway no usa Bearer
			}
		});

		// Guarda el último payload enviado al provider (para dumpearlo ante un error
		// del gateway y diagnosticar qué campo lo rechaza — el 500 de DevEngine no
		// incluye body). Ver ADR-0009.
		let lastPayload: unknown = null;
		pi.on("before_provider_request", (event: any) => {
			lastPayload = event?.payload;
			if (deps.requestDumpPath) {
				try {
				writeFileSync(
					deps.requestDumpPath,
					JSON.stringify(event?.payload ?? null, null, 2),
				);
				} catch {
				/* noop */
				}
			}
			return event?.payload;
		});
		// 401/403 → re-onboarding de la key (D6). 4xx/5xx → dumpea el request.
		pi.on("after_provider_response", (event: any, ctx: any) => {
			if (ctx.model?.provider !== SOFTTEK_PROVIDER) return;
			if (event.status === 401 || event.status === 403) deps.onUnauthorized();
			if (event.status >= 400)
				deps.onProviderError?.(lastPayload, event.status);
		});

		// H-2/H-3 (HALLAZGOS-GATEWAY): el SDK lanza ANTES de onResponse en 4xx/5xx,
		// así que el 500 opaco NUNCA llega a after_provider_response. El error
		// termina en un mensaje assistant con stopReason "error". Al verlo con
		// status 5xx, disparamos UN re-probe del último payload con stream:false
		// (el rechazo es determinista) para decodificar el error real y notificar
		// un mensaje ACCIONABLE (H-2: "tool activa"; H-3: 500 opaco).
		let diagnosing = false;
		pi.on("message_end", (event: any) => {
			try {
				const msg = event?.message;
				if (!msg || msg.role !== "assistant" || msg.stopReason !== "error")
					return;
				const errText = String(msg.errorMessage ?? msg.error ?? "");
				const m = /\b(5\d\d)\b/.exec(errText);
				if (!m || diagnosing || !lastPayload) return;
				const key = deps.getKey();
				if (!key) return;
				diagnosing = true; // un probe a la vez (fire-and-forget)
				diagnoseOpaque500(lastPayload, {
					key,
					fetchImpl: deps.fetchImpl,
					requestStatus: Number(m[1]),
				})
					.then((diagnosis) => {
						if (deps.diagnosticDumpPath) {
							try {
								writeFileSync(
									deps.diagnosticDumpPath,
									JSON.stringify(diagnosis, null, 2),
								);
							} catch {
								/* noop */
							}
						}
						deps.onGatewayDiagnosis?.(diagnosis);
					})
					.catch(() => {})
					.finally(() => {
						diagnosing = false;
					});
			} catch {
				/* Errata-6: getters hostiles — nunca romper el flujo */
			}
		});
	};
}
