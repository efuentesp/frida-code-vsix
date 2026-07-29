# ADR-0017 — Proveedor Z.ai + registry de API-key providers

**Estado:** Aceptada · **Fecha:** 2025-07-29 · **Relaciona:** ADR-0009 (compat DevEngine), ADR-0010 (agentDir propio)

## Contexto

Frida soporta dos proveedores: **Softtek DevEngine** (API key, `X-Api-Key`) y
**GitHub Copilot** (OAuth). El manejo de API key estaba **acoplado a DevEngine**: un
único `SECRET_KEY = "frida.devengineKey"`, un `keyCache` en memoria, un `setKey(key)`
que siempre llamaba `setRuntimeApiKey(SOFTTEK_PROVIDER, …)`, un `promptKey()` con
mensajes hardcodeados y un `Onboarding.tsx` con dos opciones fijas.

Queremos añadir **Z.ai** (Zhipu AI / GLM) como tercer proveedor, con API key (como
DevEngine), y **explorar dinámicamente** los modelos expuestos por su endpoint
`GET /models` para seleccionarlos/cambiarlos.

## Decisión

**Generalizar** el manejo de API key en un **registry de proveedores** (deep module),
en vez de duplicar el patrón de DevEngine. Cada proveedor de API key declara su id,
`secretKey` (SecretStorage) y `authMode` (`bearer` | `x-api-key`). Añadir un 4º/5º
proveedor = una entrada en el registry.

### Hallazgo clave: Z.ai es un provider BUILT-IN de pi-ai

`@earendil-works/pi-ai` ya incluye Z.ai como proveedor nativo
(`providers/zai.js` + `providers/data/zai.json`):

- **id `"zai"`**, baseUrl `https://api.z.ai/api/coding/paas/v4` (endpoint de CODING).
- **Auth:** Bearer estándar vía `envApiKeyAuth(["ZAI_API_KEY"])`.
- **Modelos oficiales:** `glm-4.5-air`, `glm-4.7`, `glm-5-turbo`, `glm-5.1`,
  `glm-5.2`, `glm-5v-turbo` (con sus contextWindow/maxTokens correctos).
- **`compat.thinkingFormat: "zai"`:** el SDK inyecta el parámetro `thinking` que GLM
  espera → **el razonamiento funciona nativamente**, **sin** el workaround
  `requiresThinkingAsText` / `requiresAssistantAfterToolResult` de DevEngine. Ese bug
  es **exclusivo del gateway DevEngine** (que no tiene thinkingFormat y rechaza
  `reasoning_content` al reanudar sesión — ADR-0009).

Por eso **NO registramos z.ai** (`registerProvider`) ni definimos su config: el
`ModelRuntime.create` del SDK ya carga el built-in. Sólo falta la API key
(`setRuntimeApiKey("zai", key)`).

### Estructura

```
src/providers/
├── api-key-providers.ts  # registry: API_KEY_PROVIDERS (id→{secretKey, authMode})
├── softtek-provider.ts   # DevEngine: registerProvider + X-Api-Key + dump + requiresThinkingAsText
└── z-ai-provider.ts      # Z.ai: sólo exploración (GET /models) + hook 401; SIN registerProvider
```

### Registry (`api-key-providers.ts`)

```ts
interface ApiKeyProviderDef { id; displayName; secretKey; authMode: "bearer" | "x-api-key" }
API_KEY_PROVIDERS = [
  { id: "softtek-devengine", secretKey: "frida.devengineKey", authMode: "x-api-key" },
  { id: "zai",               secretKey: "frida.zaiKey",      authMode: "bearer" },
]
```

El host itera el registry para cargar/guardar keys (`keyCaches: Record<id,string>`) y
para poblar el onboarding/selector. DevEngine registra su `ProviderConfig` propio;
z.ai usa el built-in (sólo necesita la key).

### Exploración dinámica de modelos (z.ai)

1. `discoverZaiModels(baseUrl, key)` → `GET {baseUrl}/models` (Bearer), parsea
   `{data:[{id,…}]}` (formato OpenAI mínimo).
2. `buildZaiCatalogOverride(builtinModels, discoveredIds, fallback)` → **preserva los
   modelos built-in completos** (con `thinkingFormat:"zai"`) + añade los descubiertos
   nuevos con metadatos de `ZAI_MODEL_META` (o defaults). Esto es crítico porque
   `applyExtension` del SDK **reemplaza** el array `models` y los modelos override sólo
   heredan `api`/`baseUrl` (no `compat`) → sin preservar el thinkingFormat, el
   razonamiento se rompería.
3. **Re-`registerProvider("zai", {models})`** sólo si el override trajo modelos nuevos
   (`override.models.length > builtin.length`); si no, el built-in queda intacto.
4. **Cuándo se dispara:** (a) automáticamente al introducir/actualizar la key de z.ai
   (`setKey` → `frida.discoverModels`); (b) botón **"Explorar modelos"** (⟳) en el
   `ModelPanel`.
5. **Fallback:** si el fetch falla o no hay key, el built-in queda intacto (modelos
   oficiales siempre visibles). Best-effort (try/catch + `post info`).

### Generalización del flujo de API key

| Antes (acoplado a DevEngine) | Ahora (generalizado) |
| --- | --- |
| `SECRET_KEY` único | `secretKey` por provider (registry) |
| `keyCache: string` | `keyCaches: Record<id,string>` |
| `getKey()` | `getKeyFor(providerId)` |
| `onUnauthorized()` | `onUnauthorized(providerId)` |
| `setKey(key)` | `setKey(providerId, key)` + `discoverModels(providerId)` |
| `promptKey(reason)` | `promptKey(providerId, reason)` (mensaje usa `authMode`) |
| `Onboarding.tsx` 2 opciones | 3 opciones (softtek / z.ai / copilot) |
| `ModelPanel` sólo login OAuth | + botón **Key** (apiKey providers) + **Explorar** (z.ai) |
| `frida.setKey` (comando) | `pickApiKeyProvider()` (QuickPick si >1) |

### Settings (`frida.zai.*`)

```jsonc
"frida.zai.baseUrl":       "https://api.z.ai/api/coding/paas/v4",
"frida.zai.contextWindow": 200000,   // fallback para modelos descubiertos desconocidos
"frida.zai.maxTokens":     131072
```

## Consecuencias

- **Positivas:** añadir proveedores de API key es O(1) (una entrada del registry); z.ai
  funciona "out of the box" (built-in con thinking nativo); la exploración de modelos
  descubre novedades sin romper el catálogo oficial; el comando `frida.setKey` escala
  con QuickPick; secret por provider aísla credenciales.
- **Negativas:** más superficie (registry + generalización del flujo); la exploración de
  z.ai es best-effort (depende del endpoint `/models`, que puede no listar todo).
- **Riesgo mitigado:** el built-in "zai" garantiza modelos correctos (con thinking) aun
  si `/models` falla; el override preserva `thinkingFormat:"zai"` para que el
  razonamiento nunca se rompa; DevEngine no se ve afectado (su `X-Api-Key` + dump
  requests + compat siguen intactos, sólo migró `getKey`→`getKeyFor`).

## Fuera de alcance

- Selección/almacenamiento del modelo default de z.ai en persistencia (ya existe
  `frida.activeModel` global; reutilizable).
- Cost/pricing real de z.ai (el built-in lo marca `cost: 0`).
- El bug del `requiresThinkingAsText`/`requiresAssistantAfterToolResult` es exclusivo de
  DevEngine (se resolverá en el gateway); **z.ai NO lo necesita** (thinking nativo vía
  `thinkingFormat:"zai"`).
