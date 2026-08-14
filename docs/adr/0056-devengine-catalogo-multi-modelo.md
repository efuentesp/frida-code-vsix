# ADR-0056: Catálogo multi-modelo para el proveedor DevEngine (gpt-5.6-luna/sol/terra)

- Estado: Propuesta
- Fecha: 2026-08-14
- Issue: #44
- Relacionados: ADR-0009 (compat del gateway), ADR-0017 (registry de proveedores API-key), ADR-0019 (resolución de contextWindow/maxTokens por prioridad)

## Contexto

El gateway DevEngine pasó de ofrecer un solo modelo (`gpt-5.4-mini`) a cuatro:
`gpt-5.4-mini`, `gpt-5.6-luna`, `gpt-5.6-sol` y `gpt-5.6-terra`. El proveedor
estaba hardcodeado a un solo modelo: `buildSofttekProviderConfig` generaba un
array `models` de un elemento, y la resolución de límites (ADR-0019) operaba
sobre una sola constante (`SOFTTEK_MODEL`). El selector de modelos del webview
se alimenta de `modelRuntime.getModels("softtek-devengine")`, así que los
modelos nuevos no aparecían.

Los ids `gpt-5.6-luna/sol/terra` son **internos de Softtek**: no existen en los
catálogos canónicos de pi-ai (azure-openai-responses, openai, github-copilot,
opencode), por lo que `lookupCanonicalModelMeta` no devuelve nada para ellos y
sus metadatos deben caer al gateway (GET /models) o a los defaults.

## Decisión

1. **Catálogo `SOFTTEK_MODELS`** (`{id, display}[]`) en
   `src/providers/softtek-provider.ts` como única fuente de verdad de los
   modelos del gateway. El **primero** (`gpt-5.4-mini`) sigue siendo el
   default/fallback (`SOFTTEK_MODEL` lo deriva) — no cambia el comportamiento
   para usuarios existentes.
2. **`buildSofttekProviderConfig` multi-modelo**: itera `SOFTTEK_MODELS` y
   genera una entrada por modelo con límites ya resueltos por el caller
   (`limitsByModel`) y metadatos canónicos opcionales por id (`metaByModel`).
3. **Compat ADR-0009 compartido** (`DEVENGINE_COMPAT`): el workaround
   (`requiresThinkingAsText`, `requiresAssistantAfterToolResult`,
   `supportsReasoningEffort`) es propiedad del **endpoint del gateway**, no del
   modelo, así que se aplica idéntico a todos los ids. Extraerlo a constante
   evita duplicarlo por modelo.
4. **GET /models en una sola llamada**: `fetchDevengineContextWindow` (un
   modelo) → `fetchDevengineModelsContext` (mapa `id → contextWindow`). Evita
   N llamadas de red al arrancar la sesión (y la llamada sigue siendo
   condicional: solo si DevEngine va a usarse en la sesión).
5. **Resolución de límites por modelo** (ADR-0019 intacto): override settings
   (`frida.devengine.contextWindow`/`maxTokens`) > gateway > catálogo canónico
   > default (300000/128000). Los overrides de settings se aplican a todos los
   modelos (son un solo par de settings; se mantiene el comportamiento actual).

## Consecuencias

- El selector muestra los 4 modelos bajo "Softtek DevEngine" sin tocar
  `extension.ts` ni el webview (ambos ya iteran el catálogo del runtime).
- Si el usuario cambia a un `gpt-5.6-*`, el contextWindow efectivo es el del
  gateway (si GET /models lo expone) o el default 300000; se puede ajustar con
  los settings `frida.devengine.*`.
- Añadir un modelo futuro = agregar una línea a `SOFTTEK_MODELS`.
- `diagnoseGateway` sigue haciendo probes con `gpt-5.4-mini` (default): no
  requirió cambios.

## Alternativas consideradas

- **Descubrir los modelos dinámicamente desde GET /models** y registrarlos
  todos: rechazada porque el listado del gateway incluye modelos ajenos a la
  conversación (embeddings, aliases internos como `azure-chat-default`) y
  requeriría red incluso cuando el usuario no usa DevEngine. El catálogo
  estático mantiene control explícito sobre lo que se expone en la UI.
- **Compat por modelo** (por si algún `gpt-5.6-*` no necesita el workaround):
  rechazada por ahora; el bug es del gateway y aplica a todo lo que sirve. Si
  el gateway se corrige, se ajusta en un solo lugar (`DEVENGINE_COMPAT`).
