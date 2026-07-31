// Metadata UI declarativa por proveedor. La lista de proveedores que existen
// viene del HOST (state.models.providers, que postea el ModelRuntime); este
// registry sólo ENRIQUECE la UI (cómo se configura cada uno, link para obtener
// key, etc.). Así, agregar un proveedor = darle soporte en el host + una entrada
// aquí; si falta la entrada, la UI cae a defaults razonables y el proveedor igual
// aparece (en "Disponibles").
//
// El id coincide con el del host (SOFTTEK_PROVIDER="softtek-devengine", "zai",
// "github-copilot").

export type ProviderAuthType = "apikey" | "oauth";

export interface ProviderMeta {
	id: string;
	name: string;
	/** Tipo de auth → decide qué form mostrar (input de key vs OAuth device-code). */
	authType: ProviderAuthType;
	/** Etiqueta corta del campo de key (ej. "API key (X-Api-Key)"). */
	keyHint?: string;
	/** Placeholder del input de key. */
	keyPlaceholder?: string;
	/** URL externa para obtener/crear una API key o suscripción. */
	getKeyUrl?: string;
	/** ¿Soporta auto-detección de modelos (GET /models)? Muestra botón "Explorar". */
	supportsDiscover?: boolean;
	/** Descripción corta para la tarjeta del proveedor. */
	blurb?: string;
}

export const PROVIDER_REGISTRY: ProviderMeta[] = [
	{
		id: "softtek-devengine",
		name: "Softtek DevEngine",
		authType: "apikey",
		keyHint: "API key (X-Api-Key)",
		keyPlaceholder: "mwr-sk-...",
		getKeyUrl: "https://mywork.softtek.com",
		blurb: "Gateway interno de Softtek (compatible OpenAI). Por defecto.",
	},
	{
		id: "zai",
		name: "Z.ai (GLM)",
		authType: "apikey",
		keyHint: "API key · Authorization Bearer",
		keyPlaceholder: "<z.ai api key>",
		getKeyUrl: "https://z.ai/manage-apikey/apikey-list",
		supportsDiscover: true,
		blurb: "Modelos GLM-4.x / GLM-5 con razonamiento nativo.",
	},
	{
		id: "github-copilot",
		name: "GitHub Copilot",
		authType: "oauth",
		getKeyUrl: "https://github.com/features/copilot",
		blurb: "Suscripción de GitHub. Inicia sesión con tu cuenta (device code).",
	},
];

const FALLBACK_NAME: Record<string, string> = {};

/** Metadata para un id; si no está en el registry, devuelve defaults para que el
 *  proveedor siga apareciendo (authType se infiere del flag `oauth` del host). */
export function providerMeta(id: string, oauth?: boolean): ProviderMeta {
	const found = PROVIDER_REGISTRY.find((p) => p.id === id);
	if (found) return found;
	return {
		id,
		name: FALLBACK_NAME[id] ?? id,
		authType: oauth ? "oauth" : "apikey",
	};
}
