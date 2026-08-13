# ADR-0055 — Proveedor OpenAI (ChatGPT) como built-in Bearer del registry

**Estado:** Propuesta · **Fecha:** 2026-08-13 · **Relaciona:** ADR-0017 (registry de API-key providers + z.ai), ADR-0018 (selector dinámico, lista explícita del registry), ADR-0009 (compat DevEngine)

## Contexto

Frida lista hoy cuatro proveedores: **Softtek DevEngine** (API key, `X-Api-Key`),
**Z.ai** (API key Bearer, built-in), **Moonshot AI** (API key Bearer, built-in) y
**GitHub Copilot** (OAuth). Se quiere activar **OpenAI (ChatGPT)** como nuevo
proveedor de API key.

### Hallazgo clave: OpenAI es un provider BUILT-IN de pi-ai

`@earendil-works/pi-ai` ya incluye OpenAI como proveedor nativo
(`providers/openai.js` + `providers/data/openai.json`):

- **id `"openai"`**, baseUrl `https://api.openai.com/v1`, API `openai-responses`.
- **Auth:** Bearer estándar vía `envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"])`.
- **Catálogo oficial enorme:** `gpt-4o`, `gpt-5`, `gpt-5.1`…`gpt-5.6`, `o1`, `o3`,
  `o4-mini`, etc. (más de 40 modelos con `contextWindow`/`maxTokens`/`cost` correctos).
- **Sin `compat` especial:** el razonamiento funciona de forma nativa (no arrastra
  los bugs del gateway DevEngine `requiresThinkingAsText` /
  `requiresAssistantAfterToolResult`, que son exclusivos de DevEngine — ADR-0009).

Por eso OpenAI cae en el **mismo caso que Z.ai y Moonshot**: NO requiere
`providers/openai-provider.ts`, ni `registerProvider`, ni hooks de headers. El
`ModelRuntime.create` del SDK ya carga el built-in; sólo falta la API key.

## Decisión

**D1 — OpenAI como entrada BUILT-IN del registry.** Una sola entrada en
`API_KEY_PROVIDERS` (`src/providers/api-key-providers.ts`, ADR-0017):

```ts
{
  id: "openai",                  // coincide con el built-in del SDK
  displayName: "OpenAI (ChatGPT)",
  secretKey: "frida.openaiKey",  // su propia llave en SecretStorage
  authMode: "bearer",            // Bearer estándar (como z.ai / moonshotai)
}
```

Todo el plumbing ya es genérico y se deriva de esa lista, **sin cambios adicionales
en el backend**:

- `SUPPORTED_PROVIDERS` / `API_KEY_PROVIDER_IDS` → OpenAI aparece en el selector
  (`postModels`), en el onboarding y en el check "al menos un proveedor autenticado"
  (`anyAuthed`).
- El bucle de arranque (`pi-session.ts`) itera `API_KEY_PROVIDER_IDS`, lee la key del
  SecretStorage y hace `setRuntimeApiKey("openai", key)`.
- `setKey` / `promptKey` / `pickApiKeyProvider` / `getKeyFor` / `onUnauthorized` y el
  auth-check 401/403 (reabre onboarding) **son genéricos**.
- El catálogo de modelos se publica automáticamente desde el built-in del SDK.

**D2 — Metadata UI opcional (frontend).** Una entrada en
`webview/providers-registry.ts` enriquece la tarjeta (nombre, link para obtener key,
blurb). Sin ella el proveedor **igual aparece** (caé a defaults; Moonshot funciona hoy
sin esta entrada), así que es **opcional pero recomendada** para mejor UX:

```ts
{
  id: "openai",
  name: "OpenAI (ChatGPT)",
  authType: "apikey",
  keyHint: "API key · Authorization Bearer",
  keyPlaceholder: "sk-...",
  getKeyUrl: "https://platform.openai.com/api-keys",
  blurb: "Modelos GPT-5 / o-series de OpenAI (requiere API key de pago).",
}
```

**D3 — Modelo default al configurar (opcional).** Patrón
`copilotDefaultModelId()` / `moonshotDefaultModelId()` (`extension.ts`) para
preseleccionar un modelo al introducir la key por primera vez. Sin esto el usuario
elige manualmente del catálogo.

## Alternativas consideradas

- **A — `providers/openai-provider.ts` + `registerProvider` + hooks.** Descartada:
  duplica innecesariamente el built-in. Sólo se justifica para auth no-Bearer
  (`X-Api-Key`) o lógica especial (dump requests, `compat`) como DevEngine. OpenAI es
  Bearer nativo.
- **B — Discovery dinámico de los 39 built-ins de pi-ai.** Descartada por decisión de
  producto (ADR-0018 §A): el selector lista **sólo el registry explícito** de Frida,
  ampliable editando el vsix. No se ofrece el catálogo completo al usuario final.

## Consecuencias

**Positivas**

- Activar OpenAI es **O(1)**: 1 entrada obligatoria (+ 2 opcionales). Ningún cambio
  de plumbing (la generalización de ADR-0017 ya lo cubrió).
- Funciona "out of the box": catálogo oficial completo, razonamiento nativo, sin
  workarounds de compat.
- Secret aislado por proveedor (`frida.openaiKey`), consistente con el resto.

**Negativas / trade-offs**

- **API key de pago requerida:** el usuario necesita una API key de la **plataforma
  OpenAI** (`platform.openai.com/api-keys`), **no** la suscripción de ChatGPT. Exige
  saldo/billing activo.
- **Costo real:** a diferencia de DevEngine (`cost: 0` interno), los modelos OpenAI
  cobran de verdad (ej. `gpt-5.4` $2.5/M entrada · $15/M salida; `o3` $2/$8). El
  reporte de uso de Frida lo reflejará.

## Fuera de alcance

- Soporte para la suscripción de ChatGPT (sólo login OAuth distinto al de Copilot):
  fuera de alcance; este ADR cubre únicamente API key.
- Definición del modelo default concreto (ej. `gpt-5` vs `gpt-5.4`): se decide al
  implementar D3.
- Pricing/cache real por modelo: el built-in ya trae `cost`.

## Referencias

- Issue **#43**.
- ADR-0017 (registry de API-key providers + z.ai como built-in Bearer).
- ADR-0018 (selector dinámico; lista explícita del registry como decisión de producto).
- ADR-0009 (compat `requiresThinkingAsText` — exclusivo de DevEngine, no aplica a OpenAI).
