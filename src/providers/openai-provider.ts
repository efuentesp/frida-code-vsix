// Proveedor OpenAI (ChatGPT) — ADR-0055. openai es un proveedor **BUILT-IN** de
// pi-ai (`@earendil-works/pi-ai/providers/openai`): el ModelRuntime ya lo carga con
// baseUrl (api.openai.com/v1), API `openai-responses`, catálogo oficial (gpt-4o,
// gpt-5, gpt-5.1…gpt-5.6, o1, o3, o4-mini…) y auth Bearer estándar
// (`envApiKeyAuth(["OPENAI_API_KEY"])`).
//
// Por eso aquí NO registramos el provider (registerProvider) ni definimos su config:
// sólo (1) la API key vía SecretStorage + setRuntimeApiKey("openai", key), y
// (2) la selección del modelo default (gpt-5) al configurar por primera vez — ver
// openaiDefaultModelId() en extension.ts. Sin hooks de headers (Bearer nativo, igual
// que z.ai y moonshotai) ni compat especial (el razonamiento es nativo; los bugs
// requiresThinkingAsText / requiresAssistantAfterToolResult son exclusivos del
// gateway DevEngine, ADR-0009).

/** id del provider built-in de pi-ai (debe coincidir con el catálogo del SDK). */
export const OPENAI_PROVIDER = "openai";
/** Nombre para el selector / onboarding de Frida. */
export const OPENAI_PROVIDER_DISPLAY = "OpenAI (ChatGPT)";
