// Proveedor Z.ai (Zhipu AI / GLM) — ADR-0017. z.ai es un proveedor **BUILT-IN** de
// pi-ai (`@earendil-works/pi-ai/providers/zai`): el ModelRuntime ya lo carga con
// baseUrl, modelos oficiales (glm-4.5-air / glm-4.7 / glm-5.x) y, sobre todo,
// `compat.thinkingFormat:"zai"` → el SDK inyecta el parámetro `thinking` que GLM
// espera, así que el razonamiento funciona NATIVAMENTE (sin el workaround
// `requiresThinkingAsText` de DevEngine; ese bug es exclusivo del gateway DevEngine).
//
// Por eso aquí NO registramos el provider (registerProvider) ni definimos su config:
// sólo (1) la API key vía SecretStorage + setRuntimeApiKey("zai", key), y
// (2) exploración opcional de modelos vía GET /models. El auth es Bearer estándar
// (envApiKeyAuth del built-in); no hacemos hooks de headers.

export const ZAI_PROVIDER = "zai";
export const ZAI_PROVIDER_DISPLAY = "Z.ai";
/** baseUrl del endpoint de CODING de z.ai (no el genérico /paas/v4). */
export const ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

/** Meta conocida por modelo GLM (contextWindow / maxTokens) para modelos DESCUBIERTOS
 *  vía /models que no estén en el catálogo built-in. Los built-in ya traen la suya. */
const ZAI_MODEL_META: Record<
	string,
	{ contextWindow: number; maxTokens: number }
> = {
	"glm-4.5-air": { contextWindow: 131_072, maxTokens: 98_304 },
	"glm-4.7": { contextWindow: 204_800, maxTokens: 131_072 },
	"glm-5-turbo": { contextWindow: 200_000, maxTokens: 131_072 },
	"glm-5.1": { contextWindow: 200_000, maxTokens: 131_072 },
	"glm-5.2": { contextWindow: 1_000_000, maxTokens: 131_072 },
	"glm-5v-turbo": { contextWindow: 200_000, maxTokens: 131_072 },
};
/** Defaults si un modelo descubierto no está en la tabla. */
const DEFAULT_META = { contextWindow: 200_000, maxTokens: 131_072 };

function displayName(id: string): string {
	const [base, ...rest] = id.split("-");
	const baseUpper = base ? base.toUpperCase() : id;
	const restStr = rest.length > 0 ? " " + rest.join(" ") : "";
	return `${baseUpper}${restStr}`;
}

/** Construye el bloque override `models` para registerProvider: los modelos built-in
 *  actuales (con TODOS sus campos, incluido `compat.thinkingFormat:"zai"`) + los
 *  descubiertos nuevos (con thinkingFormat preservado para que el razonamiento siga
 *  funcionando). Así applyExtension (que reemplaza el array) no rompe el thinking. */
export function buildZaiCatalogOverride(
	builtinModels: Array<Record<string, unknown>>,
	discoveredIds: string[],
	fallback: { contextWindow: number; maxTokens: number } = DEFAULT_META,
): { models: unknown[] } {
	const existingIds = new Set(builtinModels.map((m) => m["id"]));
	const newModels = discoveredIds
		.filter((id) => !existingIds.has(id))
		.map((id) => {
			const meta = ZAI_MODEL_META[id] ?? fallback;
			return {
				id,
				name: displayName(id),
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				compat: {
					supportsStore: false,
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					thinkingFormat: "zai",
				},
				contextWindow: meta.contextWindow,
				maxTokens: meta.maxTokens,
			};
		});
	return { models: [...builtinModels, ...newModels] };
}

/** Descubre los ids de modelos vía GET {baseUrl}/models (Bearer). Formato OpenAI:
 *  { data: [{ id: "glm-4.7", ... }] }. Lanza si el fetch falla; el caller hace
 *  fallback (deja intacto el catálogo built-in). */
export async function discoverZaiModels(
	baseUrl: string,
	key: string,
): Promise<string[]> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 15000);
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
			method: "GET",
			headers: { Authorization: `Bearer ${key}` },
			signal: ctrl.signal,
		});
		if (!res.ok) {
			throw new Error(`GET /models → ${res.status} ${res.statusText}`);
		}
		const json = (await res.json()) as { data?: Array<{ id?: string }> };
		const ids = (json.data ?? [])
			.map((m) => m?.id)
			.filter((id): id is string => typeof id === "string" && id.length > 0);
		return ids.sort((a, b) => a.localeCompare(b));
	} finally {
		clearTimeout(timer);
	}
}

/** Hooks del proveedor z.ai. Bearer nativo ⇒ sin before_provider_headers. Sólo
 *  atrapa 401/403 para reabrir el onboarding de la key. */
export interface ZaiProviderDeps {
	/** Se invoca al recibir 401/403 → el host reabre el onboarding de z.ai. */
	onUnauthorized: () => void;
}
export function createZaiProviderHooks(deps: ZaiProviderDeps) {
	return (pi: any) => {
		pi.on("after_provider_response", (event: any, ctx: any) => {
			if (ctx.model?.provider !== ZAI_PROVIDER) return;
			if (event.status === 401 || event.status === 403) deps.onUnauthorized();
		});
	};
}
