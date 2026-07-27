import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SOFTTEK_PROVIDER = "softtek-devengine";
export const SOFTTEK_MODEL = "gpt-5.4-mini";
export const SOFTTEK_MODEL_DISPLAY = "GPT-5.4 Mini";
export const SOFTTEK_PROVIDER_DISPLAY = "Softtek DevEngine";
export const DEVENGINE_BASE_URL = "https://mywork.softtek.com/apg/devengine";

/**
 * Config del proveedor (ProviderConfigInput). Se registra DIRECTAMENTE en el
 * ModelRuntime (vía registerProvider), NO en la factory, para que
 * modelRuntime.getModel(...) lo resuelva. (Riesgo #1 del PoC, ya resuelto.)
 */
export const SOFTTEK_PROVIDER_CONFIG = {
	name: "Softtek DevEngine Gateway",
	baseUrl: DEVENGINE_BASE_URL,
	api: "openai-completions", // ⚠️ Pi añade /chat/completions — verificar el path en runtime
	authHeader: false, // el gateway NO usa Authorization: Bearer; la key va como X-Api-Key
	// vía before_provider_headers. Esto además evita el gate "No API key".
	models: [
		{
			id: SOFTTEK_MODEL,
			name: SOFTTEK_MODEL_DISPLAY,
			reasoning: true, // habilita niveles de thinking → reasoning_effort (low/medium/high)
			input: ["text", "image"] as ("text" | "image")[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400_000,
			maxTokens: 128_000,
			compat: {
				supportsReasoningEffort: true, // DevEngine acepta reasoning_effort (low/medium/high)
				// El gateway DEVUELVE reasoning_content en el stream, pero NO lo acepta de vuelta
				// como campo de un mensaje assistant del historial (responde 500 al continuar una
				// sesión con razonamiento previo). requiresThinkingAsText hace que pi reenvíe el
				// thinking como TEXTO plano en `content` (estándar OpenAI) en vez de como el campo
				// `reasoning_content` → el gateway lo acepta. Fix de fondo: ver ADR-0008 / DevEngine.
				requiresThinkingAsText: true,
			},
		},
	],
};

export interface SofttekProviderDeps {
	/** Lee la key del cache en memoria (síncrono). */
	getKey: () => string | undefined;
	/** Se invoca al recibir 401 → el host reabre el onboarding. */
	onUnauthorized: () => void;
	/** Se invoca al recibir 4xx/5xx del gateway → el host dumpea el request
	 *  (DevEngine no devuelve body en el 500, así que el error es opaco; el
	 *  request nos dice qué campo lo rechaza). Ver ADR-0009. */
	onProviderError?: (payload: unknown, status: number) => void;
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
