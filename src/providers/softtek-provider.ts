import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

export const SOFTTEK_PROVIDER = "softtek-devengine";
export const SOFTTEK_PROVIDER_DISPLAY = "Softtek DevEngine";
export const DEVENGINE_BASE_URL = "https://mywork.softtek.com/apg/devengine";

/** Definición de un modelo del gateway DevEngine (id + nombre visible). */
export interface SofttekModelDef {
	id: string;
	display: string;
}

/** Catálogo de modelos que ofrece el gateway DevEngine. El PRIMERO es el
 *  default/fallback (se usa cuando no hay modelo activo guardado). Los
 *  gpt-5.6-* son ids internos de Softtek: NO existen en los catálogos
 *  canónicos de pi-ai, así que sus metadatos caen a los defaults (o a lo que
 *  exponga GET /models del gateway). */
export const SOFTTEK_MODELS: SofttekModelDef[] = [
	{ id: "gpt-5.4-mini", display: "GPT-5.4 Mini" },
	{ id: "gpt-5.6-luna", display: "GPT-5.6 Luna" },
	{ id: "gpt-5.6-sol", display: "GPT-5.6 Sol" },
	{ id: "gpt-5.6-terra", display: "GPT-5.6 Terra" },
];

/** Modelo default de DevEngine (el primero del catálogo). Se mantiene como
 *  constante porque es el fallback de resolución de modelo en pi-session. */
export const SOFTTEK_MODEL = SOFTTEK_MODELS[0].id;
export const SOFTTEK_MODEL_DISPLAY = SOFTTEK_MODELS[0].display;

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

/** Auto-detect de los contextWindow REALES del gateway DevEngine vía GET /models.
 *  UNA sola llamada: parsea la lista completa y devuelve un mapa id → contextWindow
 *  (sólo entradas con valor numérico > 0). Best-effort (timeout 10s): si falla o el
 *  gateway no lo expone, devuelve undefined y el caller hace fallback por modelo
 *  (override > gateway > catálogo > default). Reutiliza el patrón de
 *  diagnoseGateway (X-Api-Key, probe /models). */
export async function fetchDevengineModelsContext(
	baseUrl: string,
	key: string,
): Promise<Record<string, number> | undefined> {
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
		// Formato OpenAI {data:[{id,…}]} o variante del gateway.
		const list: any[] = Array.isArray(json?.data)
			? json.data
			: Array.isArray(json)
				? json
				: [];
		const map: Record<string, number> = {};
		for (const m of list) {
			const cw = m?.context_window ?? m?.context_length ?? m?.contextWindow;
			if (typeof m?.id === "string" && typeof cw === "number" && cw > 0) {
				map[m.id] = cw;
			}
		}
		return map;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

/** Workaround de compat del GATEWAY DevEngine (bug ADR-0009): es propiedad del
 *  endpoint, no del modelo, así que se aplica a TODOS los modelos del catálogo.
 *  - supportsReasoningEffort: DevEngine acepta reasoning_effort (low/medium/high).
 *  - requiresThinkingAsText: el gateway DEVUELVE reasoning_content en el stream,
 *    pero NO lo acepta de vuelta como campo de un mensaje assistant del historial
 *    (responde 500 al continuar una sesión con razonamiento previo); pi reenvía el
 *    thinking como TEXTO plano en `content` (estándar OpenAI) → el gateway lo acepta.
 *  - requiresAssistantAfterToolResult: el gateway rechaza `content: null` en
 *    mensajes assistant con tool_calls (responde 500); pi envía `content: ""`.
 *    Efecto colateral menor: inserta un assistant puente ("I have processed the
 *    tool results.") entre toolResult y user; benigno. */
const DEVENGINE_COMPAT = {
	supportsReasoningEffort: true,
	requiresThinkingAsText: true,
	requiresAssistantAfterToolResult: true,
};

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
	/** Límites ya RESUELTOS por modelo (override > gateway > catálogo > default). */
	limitsByModel: Record<string, { contextWindow: number; maxTokens: number }>;
	/** Metadatos canónicos por modelo (reasoning/input/thinkingLevelMap del modelo
	 *  nativo). Los ids internos de Softtek (gpt-5.6-*) no están en los catálogos
	 *  de pi-ai → undefined → defaults. */
	metaByModel?: Record<string, CanonicalModelMeta | undefined>;
}) {
	return {
		name: "Softtek DevEngine Gateway",
		baseUrl: DEVENGINE_BASE_URL,
		api: "openai-completions", // ⚠️ Pi añade /chat/completions — verificar el path en runtime
		authHeader: false, // el gateway NO usa Authorization: Bearer; la key va como X-Api-Key
		// vía before_provider_headers. Esto además evita el gate "No API key".
		models: SOFTTEK_MODELS.map((def) => {
			const meta = opts.metaByModel?.[def.id];
			const limits = opts.limitsByModel[def.id] ?? {
				contextWindow: 300000,
				maxTokens: 128000,
			};
			return {
				id: def.id,
				name: def.display,
				reasoning: meta?.reasoning ?? true,
				input: (meta?.input ?? ["text", "image"]) as ("text" | "image")[],
				...(meta?.thinkingLevelMap
					? { thinkingLevelMap: meta.thinkingLevelMap }
					: {}),
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				// Ajustables desde settings (frida.devengine.contextWindow / maxTokens).
				contextWindow: limits.contextWindow,
				maxTokens: limits.maxTokens,
				// El `compat` es un workaround del GATEWAY (ADR-0009), no del modelo:
				// aplica a TODOS los ids que sirve DevEngine.
				compat: { ...DEVENGINE_COMPAT },
			};
		}),
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
	};
}
