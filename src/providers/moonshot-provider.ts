// Proveedor Moonshot AI (Kimi) — ADR-0017. moonshotai es un proveedor BUILT-IN de
// pi-ai: el ModelRuntime ya lo carga con baseUrl (api.moonshot.ai/v1), catálogo
// oficial (kimi-k3, kimi-k2.6, kimi-k2-thinking, kimi-k2.5…) y formato thinking de
// OpenAI con `reasoning_effort`. El envApiKeyAuth del built-in hace el Bearer
// estándar, igual que z.ai.
//
// Por eso aquí NO registramos el provider (registerProvider) ni definimos su config:
// sólo (1) la API key vía SecretStorage + setRuntimeApiKey("moonshotai", key), y
// (2) la selección del modelo default (kimi-k3) al configurar por primera vez — ver
// moonshotDefaultModelId() en extension.ts. Sin hooks de headers ni exploración de
// modelos (el catálogo built-in basta; a diferencia de z.ai, Moonshot no expone un
// endpoint /models útil para descubrir modelos fuera del catálogo).

/** id del provider built-in de pi-ai (debe coincidir con el catálogo del SDK). */
export const MOONSHOT_PROVIDER = "moonshotai";
/** Nombre para el selector / onboarding de Frida. */
export const MOONSHOT_PROVIDER_DISPLAY = "Moonshot AI (Kimi)";
