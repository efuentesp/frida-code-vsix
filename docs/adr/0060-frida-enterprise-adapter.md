# ADR-0060 — Adaptador aislado Pi → Frida Enterprise

**Estado:** Implementado y validado E2E (TDD) · **Fecha:** 2026-08-16 · **Relaciona:** ADR-0059 (provider Frida Enterprise), ADR-0017 (registry de providers), Erratas 1–5 del ADR-0059 + Errata-6 de este ADR

## Contexto

El provider Frida Enterprise (ADR-0059) funciona hoy con `api: "openai-completions"`
de pi-ai + un conjunto de traducciones repartidas entre el catálogo
(`refreshModels`), el OAuth (`getApiKey`) y los hooks de sesión
(`before_provider_request` / `before_provider_headers`). Las cinco erratas de la
validación en vivo demuestran que el gateway **no** es 100% OpenAI-compatible:

| # | Desviación | Dónde se compensa hoy |
|---|---|---|
| 1 | `redirect_uri` base64url en la URL de login | `oauth.login` |
| 2 | `user_id`/`email` obligatorios (422) | hook `before_provider_request` + claims recordados en `getApiKey` (Errata-5) |
| 3 | UI pre-login según registry del webview | `providers-registry.ts` + flag `oauth` en `postModels` |
| 4 | `baseUrl` debe llevar `/v1`; sólo modelos cap `chat` | `refreshModels` + filtro del catálogo |
| 5 | orden `getApiKey → onPayload` para la identidad | convención implícita entre OAuth y hooks |

El problema no es cada fix individual (todos funcionan y están testeados), sino
que la **traducción Pi → Frida está dispersa** y depende del orden interno de
eventos del runtime (`getApiKey` antes que `onPayload`, `transformHeaders`
después). Además, si quisiéramos soportar los 3 modelos `responses`-only
(`/v1/responses`), el adapter `openai-completions` de pi-ai no puede hacerlo.

## Requisitos duros (del desarrollador)

1. **Aislamiento total:** el adaptador es exclusivo de Frida Enterprise. z.ai,
   DevEngine, Copilot y cualquier provider futuro quedan intactos.
2. **Removible:** toda la pieza vive en una extensión/carpeta específica del
   provider; eliminarla = borrar la carpeta + quitar N líneas de wiring
   documentadas. Nada huérfano, cero alteración a los demás providers.
3. **Traducción explícita:** un llamado de pi se transforma en el llamado que
   Frida Enterprise necesita, en UN solo lugar.

## Decisión

**Crear un módulo-carpeta `src/providers/frida-enterprise/` con un adaptador
puro de traducción como pieza central**, manteniendo el registro vía
`registerProvider` + `openai-completions` en una primera fase. El adaptador
concentra TODA la semántica propietaria del gateway; los hooks dejan de tener
lógica propia y se convierten en consumidores del adaptador.

```
frida code (host)                      Compatible API (gateway Frida)
────────────────                       ───────────────────────────────
pi-session.ts
  modelRuntime.registerProvider(           GET  {root}/v1/models
      "frida-enterprise",                  │
      buildFridaEnterpriseProviderConfig)  ▼
       │                            ┌─────────────────────────┐
       │                            │  frida-enterprise/      │
       │  sesión principal e hijas │  (EXTENSIÓN REMOVIBLE)  │
       └─ extensionFactories ─────▶│                         │
                                    │  oauth.ts ─── login/refresh/getApiKey
Pi / pi-ai                          │  catalog.ts ─ catálogo + filtro chat
  streamSimple(model, …)            │  adapter.ts ─ ◀ TRADUCCIÓN PURA
   │                                │  hooks.ts ─── consume adapter.ts
   │  payload OpenAI estándar       │  provider.ts ─ registerProvider config
   └───────────────────────────────▶│  index.ts ─── barrel público
                                    └─────────────────────────┘
                                               │ payload Frida:
                                               │  user_id, email, auto_log,
                                               │  reasoning:{effort},
                                               │  baseUrl con /v1
                                               ▼
                                    POST {root}/v1/chat/completions
                                    Authorization: Bearer <idToken> (pi-ai)
```

### Estructura de archivos

```
src/providers/
├── api-key-providers.ts            # INTACTO
├── softtek-provider.ts             # INTACTO
├── z-ai-provider.ts                # INTACTO
└── frida-enterprise/               # NUEVA CARPETA (todo el provider aquí)
    ├── index.ts                    # barrel + runtime compartido (DI)
    ├── runtime.ts                  # holder de identidad (getApiKey→hooks)
    ├── oauth.ts                    # PKCE/login/refreshToken/getApiKey
    ├── catalog.ts                  # catálogo + filtro chat (usa adapter)
    ├── adapter.ts                  # ★ adaptador PURO (sin I/O ni estado)
    ├── provider.ts                 # buildFridaEnterpriseProviderConfig
    └── hooks.ts                    # createFridaEnterpriseHooks (delgado)
```

`test/frida-enterprise/` espeja la estructura:
`adapter.test.ts` (contrato bidireccional, 26), `tools-conformance.test.ts` (4),
`e2e/` (`harness.ts`, `runtime-payload.e2e.test.ts`,
`tools-roundtrip.e2e.test.ts`, `live-runtime.e2e.test.ts`) y `live.test.ts` — más
`test/frida-enterprise-provider.test.ts` (24, regresión del monolito original).
Resultado local actual: **61 pruebas pasan, 2 live opt-in skipped**.

## Contrato del adaptador

`adapter.ts` es una biblioteca de **funciones puras** — sin `fetch`, sin
módulo-global mutable, deterministas y testeables sin mocks de red:

```ts
// ─── Identidad ───────────────────────────────────────────────────────────

/** Claims decodificados del idToken (sin verify — el gateway valida la firma). */
export interface FridaIdentity {
	user_id?: string;
	email?: string;
}

/** Extrae la identidad de un idToken JWT (undefined si no se puede decodificar). */
export function identityFromToken(idToken: string): FridaIdentity | undefined;

// ─── Payload: Pi (OpenAI estándar) → Frida ────────────────────────────────

/**
 * Traduce el payload que arma el adapter openai-completions de pi-ai al
 * contrato del gateway. Reglas (Erratas 2, 4 y 5 del ADR-0059):
 *   1. injecta user_id/email de `identity` (obligatorios; 422 si faltan);
 *   2. auto_log = true;
 *   3. reasoning_effort (OpenAI) → reasoning:{effort} (Frida), si no hay
 *      reasoning ya presente;
 *   4. no toca model/messages/tools/stream/max_tokens — pasan tal cual;
 *   5. devuelve SIEMPRE un objeto nuevo (no muta el de entrada).
 */
export function buildFridaPayload(
	piPayload: Record<string, unknown>,
	identity: FridaIdentity,
): Record<string, unknown>;

// ─── Enrutamiento por modelo ──────────────────────────────────────────────

export type FridaEndpoint = "chat" | "responses" | "embeddings" | "none";

/** Decide qué endpoint sirve a un modelo según sus capabilities.
 *  "chat"+"responses" → "chat" (pi consume chat/completions; hoy igual que
 *  la extensión original cuando ambos están). */
export function endpointForCapabilities(caps: unknown): FridaEndpoint;

// ─── Catalogación ────────────────────────────────────────────────────────

/** Entrada cruda de /v1/models → ProviderModelConfig (con baseUrl /v1). */
export function toProviderModel(
	raw: Record<string, unknown>,
	rootUrl: string,
): FridaEnterpriseModelConfig | undefined; // undefined → filtrar

// ─── Errores ──────────────────────────────────────────────────────────────

/** Clasifica un status/body del gateway para mensajes de UI accionables. */
export function classifyGatewayError(status: number, body?: string):
	| { kind: "identity"; hint: "revisa el login (/login frida-enterprise)" }
	| { kind: "model-unavailable"; hint: "el backend no sirve este modelo (502)" }
	| { kind: "auth-expired"; hint: "re-login" }   // 401/403 → onUnauthorized
	| { kind: "unknown" };
```

### Flujo de identidad (secuencia)

```
pi-ai                     oauth.ts                adapter.ts         gateway
─────                     ────────                ──────────         ───────
resolveStoredOAuth
  └─ getApiKey(cred) ───▶ identityFromToken(cred.access)
                          claims → contexto de sesión
                                                     (guardado junto al
                                                      provider, no global
                                                      del módulo)
streamSimple(model,…)
  └─ onPayload(payload) ──────────────────────▶ buildFridaPayload(
   hook hooks.ts (delgado)                        payload, claims)
                                                  │
                                                  ▼ POST /v1/chat/completions
                                                                       200/4xx
after_provider_response(status) ─────────▶ classifyGatewayError(status)
                                           401/403 → onUnauthorized
```

**Diferencia clave vs hoy:** los claims viven en un contexto de sesión del
provider (inyectado en `createFridaEnterpriseHooks`), no en una variable global
del módulo — elimina la carrera si dos sesiones (principal + hijas de workflow)
rotan tokens a la vez. `before_provider_headers` se conserva como respaldo
defensivo y actualiza el mismo contexto.

### Qué NO hace el adaptador

- **No** gestiona el `Authorization` header (sigue siendo de pi-ai,
  `authHeader: true`).
- **No** toca el registro/config de otros providers ni código genérico del host.
- **No** parchea el SDK de OpenAI ni bifurca `openai-completions`.
- **No** hace I/O: ni fetch ni timers — sólo transformación de datos.

## Traducción bidireccional (decisión explícita)

El adaptador no es sólo un transformador **Pi → Frida**. Es la frontera
bidireccional exclusiva del provider:

```text
Pi / pi-ai request                         Frida Compatible API response
──────────────────                         ─────────────────────────────
model, messages, tools, stream              chat.completion / chunk
max_tokens, reasoning_effort       ⇄       content, reasoning_content
                                         ⇄ tool_calls + finish_reason
user_id, email, auto_log                 ⇄ usage + errores HTTP
```

### Pi → Frida (`buildFridaPayload`)

- inyecta `user_id`, `email`, `auto_log: true`;
- traduce `reasoning_effort` → `reasoning: { effort }`;
- conserva sin mutar `model`, `messages`, `tools`, `tool_choice`, `stream`,
  `stream_options`, `max_tokens`/`max_completion_tokens`;
- el `baseUrl` de cada modelo ya contiene `/v1`;
- la cabecera Bearer sigue siendo responsabilidad de pi-ai.

### Frida → Pi (`translateFridaResponse` / `translateFridaStreamChunk`)

- `message.content` → contenido textual Pi;
- `reasoning_content` → evento/bloque de reasoning;
- `tool_calls[].function.arguments` (string u objeto) → argumentos JSON de la
  tool Pi;
- `finish_reason: stop|length|tool_calls|function_call` →
  `stop|length|toolUse`;
- `usage.prompt_tokens/completion_tokens` → usage Pi, incluidos cache counters;
- chunks SSE `delta.content`, `delta.reasoning_content`, `delta.tool_calls` →
  eventos incrementales Pi;
- `401/403/422/502` → clasificación accionable mediante
  `classifyGatewayError`.

La Fase 1 mantiene el parser SSE de `openai-completions` de pi-ai para el
transporte real; estas funciones de respuesta son el contrato explícito y
testeable de la frontera Frida, y permiten migrar a un stream handler custom
sin volver a mezclar semánticas en otros providers.

### Errata-6: runtime de identidad conectado y puerta de provider

La E2E reprodujo el 422 cuando el runner no tenía `ctx.model` (caso de la
generación automática de título): el hook hacía early-return y no añadía
`user_id`/`email`. Además, el barrel podía crear una instancia de runtime
distinta para OAuth y hooks en embedders/tests.

Fix: `isOtherKnownProvider(ctx)` sólo excluye otro provider conocido; si el
modelo es desconocido o su getter lanza, inyecta cuando existe identidad Frida.
`rememberToken` nunca borra una identidad válida al recibir un Bearer ajeno.
El barrel acepta un runtime explícito para conectar OAuth y hooks; el host
normal usa un singleton compartido. La E2E real cubre ambos escenarios.

### Errata-7: ctx.model VENCIDO excluía requests frida reales (422 con lista fallback)

**Síntoma** (debug log del host, 15:32:59): request con `payload.model=NIKE-VICTORY`
pero `ctx.model.provider="zai"` → la puerta de exclusión la dejaba pasar SIN
identidad → 422. A la vez, el arranque con `PI_OFFLINE=1` del host corre
`refreshModels` sin red y el provider NO usaba `context.store` → catálogo
fallback de 4 modelos sin ⭐ en el selector.

**Fix (2026-08-16, TDD S6/S7):**
1. **Gate por la request, no por el contexto**: `before_provider_request` decide
   por `payload.model` contra la whitelist del runtime (`knowsModel`), sembrada
   con `VERIFIED_MODEL_IDS` desde el arranque y ampliada por cada
   `refreshModels` (catálogo vivo, store o fallback MODEL1..4). `ctx.model` sólo
   queda como defensa cuando el payload no trae `model`. Inmune a ctx vencido,
   roto o ausente (Erratas 5/6/7 comparten lección: nunca depender del estado
   ambiental del runner).
2. **Persistencia del catálogo (patrón `createProvider` de pi-ai)**:
   `refreshModels` ahora hace `store.read()` offline (restaura los 32 con ⭐)
   y `store.write({models, checkedAt})` tras cada fetch exitoso.
3. **Trazas**: `dbg()` escribe a `~/.frida/logs/frida-enterprise-debug.log`
   (archivo propio con timestamp — console.log del exthost no llega a ningún
   log); `after_provider_response` registra TODO status HTTP.

E2E nuevas: S6 (ctx=zai + payload NIKE → inyecta) y S7 (ctx=frida + payload
glm → NO inyecta). Suite: 68/68 locales.

### Errata-8: role "developer" en el system prompt (LA causa final del 422 del host)

**Descubrimiento (réplica fiel del host → gateway real, 2026-08-16):** tras
Errata-7 el hook inyectaba identidad y AÚN ASÍ daba 422. El proxy grabador
capturó la respuesta exacta del gateway:

```json
422 {"detail":[{"type":"enum","loc":["body","messages",0,"role"],
  "msg":"Input should be 'system', 'user', 'assistant' or 'tool'",
  "input":"developer"}]}
```

**Causa:** `openai-completions` de pi-ai usa `role: "developer"` para el
system prompt cuando `model.reasoning && compat.supportsDeveloperRole`
(convención nueva del SDK OpenAI). Todos nuestros modelos declaran
`reasoning: true` → TODA request del host con system prompt llevaba
`developer`… y el gateway (FastAPI/Pydantic) sólo acepta
`system|user|assistant|tool`. Las pruebas con `fetch` manual y el grabador
local pasaban porque usaban `system` o aceptaban cualquier rol.

**Fix (TDD):** `buildFridaPayload` traduce shallow `messages[].role
"developer" → "system"` (copia sólo los mensajes developer; inmutabilidad
preservada; el resto de roles pasa por referencia). Pruebas: 3 unitarias
(adapter) + E2E S8 (systemPrompt real por el SDK → el body grabado lleva
`system`). Suite: 72/72 locales; suite del repo: baseline exacto.

**Lección transversal (Erratas 4–8):** cada desviación del gateway respecto a
OpenAI aparece SÓLO en la request real del host — ni fetch manual ni grabador
permissivo la revelan. La réplica fiel (system prompt + 23 tools + reasoning +
cadena real de hooks + proxy que captura la respuesta del gateway) es la
herramienta de diagnóstico definitiva; quedó como `/tmp/host-replica.mts`
(recrearla en el repo de tests si vuelve a hacer falta).

### Errata-9: el compact usa un canal lateral sin onPayload (422 "summarization failed")

**Síntoma** (2026-08-16): chat normal ya respondía 200, pero `/compact` daba
`422 status code (no body)` en "summarization failed".

**Causa:** `compact()` → `agent.streamFunction` (sdk.js) →
`modelRuntime.streamSimple` **sin `onPayload`** — ese camino NUNCA pasa por
`before_provider_request` (el log mostró 3 capturas de identidad y CERO
líneas de payload). La request salía sin `user_id`/`email` y con role
`developer` (Erratas 2/8) → 422.

**Fix (TDD):** `side-channels.ts` — `patchFridaSideChannelsOn(modelRuntime)`
(wiring #8, una línea junto al `registerProvider`) envuelve
`streamSimple`/`completeSimple` e inyecta `onPayload = buildFridaPayload`
SÓLO si: modelo ∈ whitelist frida (por id), no hay `onPayload` ya (el camino
normal del Agent manda el suyo) y hay identidad capturada. Otros providers ni
se enteran; removable con la misma carpeta + wiring.

Pruebas: 5 unitarias (`side-channels.test.ts`: inyecta/respeta onPayload
ajeno/no toca zai/sin identidad no inyecta/completeSimple cubierto) + E2E
`compact-path.e2e.test.ts` (réplica exacta del camino: streamSimple sin
onPayload por el adapter real → server grabador recibe `system` + identidad).
Suite: 78/78 locales; repo: baseline exacto.

## E2E desde el runtime real (TDD)

No basta con probar funciones puras ni con `fetch()` directo. La suite
`test/frida-enterprise/e2e/` ejecuta:

```text
ExtensionRunner real → before_provider_headers → pi-ai openai-completions
→ before_provider_request → SDK OpenAI → servidor grabador/gateway real
```

Cubre URL `/v1/chat/completions`, Bearer, identidad, 7 tools core reales,
tool-call, ejecución/resultado (`role: tool`) y respuesta final. La E2E live
con los modelos `NIKE-VICTORY`, `SELENE-CIPHER` y `TIRESIAS-PRISM` pasó con
**generación + tool round-trip** (13 s), reproduciendo y eliminando el 422.

### Catálogo curado (VERIFIED_MODEL_IDS)

El selector NO lista los 45 modelos chat del gateway: `catalog.ts` filtra por
`VERIFIED_MODEL_IDS`, la lista blanca de los **32 que pasaron la matriz live
completa** (generación + tool-call + round-trip + streaming, 2026-08-16).
Excluidos: 11 con 502 del backend, 2 flaky (SELENE-GLOW/DRIFT) y cualquier
modelo nuevo sin verificar. Mantenimiento: correr
`FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/live.test.ts`
y promover aquí los que pasen; cuando el gateway arregle los 502 se pueden
re-incorporar (o eliminar la lista blanca). El fallback MODEL1..4 sigue
intacto: AEOLUS-GALE, NIKE-VICTORY, TIRESIAS-PRISM y SELENE-CIPHER — los 4
verificados. Embeddings: el gateway expone 4 modelos (MNEMOSYNE-THREAD,
URANIA-VAST, CALLIOPE-GRAIN, CLIO-RELIC) pero el contrato de providers de
pi es chat-only — quedan fuera del scope de este provider. Para el RAG
planeado de frida code hay matriz e2e opt-in (`e2e/live-embeddings.e2e.test.ts`,
genera `reporte-embeddings.md`): contrato = Bearer idToken + `user_id`/`email`
(**Errata-2 aplica a embeddings**, sin ellos → 422) + `POST {url}/v1/embeddings`;
los 4 devuelven vector válido con dims estables (1536; URANIA-VAST 3072),
batch `input: string[]` y benchmark de semántica de 6 tripletas ES/EN
(aserción por triplete, ranking por margen mínimo en el reporte).
**Recomendado para el RAG: CALLIOPE-GRAIN** (margen mínimo 0.33, empatado
con URANIA-VAST a la mitad de dims). MNEMOSYNE-THREAD y CLIO-RELIC son el
mismo backend (vector idéntico) y anisotrópicos (distractor a cos ~0.69).
Determinismo FLAKY entre corridas (réplicas del backend): no comparar
embeddings entre corridas; re-indexar documentos completos juntos.
Ejemplo mínimo en `examples/embedding_example.py`.

### UX del selector (clase + orden)

`toProviderModel` anota en el nombre la clase de tamaño con contexto humano —
`NIKE-VICTORY (responses, grande 1M)`, `SELENE-CIPHER (mediano 262k)`,
`MERCURY-WING (compacto 128k)`, `model-router (meta)` — y
`fetchFridaEnterpriseModels` ordena el catálogo **por bloques de clase,
grande → mediano → compacto** (router al final), con el **sugerido ⭐ de cada
clase abriendo su bloque** (`isSuggested`: NIKE-VICTORY, SELENE-CIPHER,
MERCURY-WING — los tres verificados; dentro del bloque, ctx desc → id asc).
Umbral: ≥1M grande, ≥200k mediano, resto compacto. Con la lista curada:
13 grandes, 15 medianos, 3 compactos + meta.

## Aislamiento y remoción (checklist)

### Puntos de wiring (los únicos fuera de la carpeta)

| # | Archivo | Línea/bloque | Tipo |
|---|---|---|---|
| 1 | `src/pi-session.ts` | import desde `./providers/frida-enterprise` | frida-específico |
| 2 | `src/pi-session.ts` | `modelRuntime.registerProvider(FRIDA_ENTERPRISE_PROVIDER, …)` | frida-específico |
| 3 | `src/pi-session.ts` | entrada `extensionFactories` (sesión principal) | frida-específico |
| 4 | `src/pi-session.ts` | entrada `extensionFactories` (sesiones hijas de workflow) | frida-específico |
| 5 | `src/extension.ts` | import + `SUPPORTED_PROVIDERS` | frida-específico |
| 6 | `src/extension.ts` | caso en `providerDisplayName()` | frida-específico |
| 7 | `webview/providers-registry.ts` | entrada `{id:"frida-enterprise", authType:"oauth",…}` | frida-específico |
| 8 | `src/pi-session.ts` | `patchFridaSideChannelsOn(modelRuntime)` tras registerProvider (Errata-9) | frida-específico |

**Nota:** el fix del flag `oauth` en `postModels` (Errata-3,
`!!mr.getProvider?.(id)?.auth?.oauth`) es código **genérico** que beneficia a
cualquier provider OAuth — NO se revierte al remover Frida Enterprise.

### Procedimiento de remoción (verificable)

```bash
rm -rf src/providers/frida-enterprise test/frida-enterprise
# quitar las 7 líneas/bloques de la tabla anterior
grep -rn "frida-enterprise\|FRIDA_ENTERPRISE" src webview test   # → 0 resultados
npm run typecheck && npx vitest run                              # suite del repo verde
# opcional: /logout frida-enterprise (borra la credential de ~/.frida/auth.json)
```

Tras esto, z.ai/DevEngine/Copilot y todo el host quedan exactamente como si el
provider nunca hubiera existido.

## Fase 2 (opcional, criterio explícito) — API custom `/v1/responses`

Sólo si se decide soportar los 3 modelos responses-only (HEPHAESTUS-ANVIL,
LEONIDAS-BLADE, PANTHEON-PRIME) o si pi-ai cambia su contrato de hooks:

- `adapter.ts` ya devuelve `endpointForCapabilities` → `provider.ts` registra
  cada modelo con el endpoint en metadatos.
- Se añade `frida-enterprise/responses-sse.ts`: traduce los eventos
  `response.output_text.delta` / `response.reasoning_summary_text.delta` /
  `response.completed` (documentados en la ingeniería inversa §4.3) al
  `AssistantMessageEventStream` de pi-ai.
- El registro pasa de `api: "openai-completions"` a un stream handler propio
  sólo para los modelos `responses`.
- **No se activa por defecto:** los 502 de backend observados en 10 modelos
  chat sugieren esperar estabilidad del gateway antes de ampliar superficie.

## Implementación (TDD, 2026-08-16)

Proceso seguido: **tests primero (rojo) → código que los cumple (verde)**.

1. **Rojo:** `adapter.test.ts` (21 casos de contrato), `tools-conformance.test.ts`
   (23 tools: 7 schemas reales del runtime — read/bash/edit/write/grep/find/ls
   cargadas desde `dist/core/tools` del propio pi-coding-agent — más 16
   replicadas del harness: ask_user_question, todo, Agent, get/steer_subagent,
   workflow×7, agent_browser, web_fetch_md, read_skills, mcp) y `live.test.ts`
   (matriz completa). Los 3 fallaron: `Failed to load url …/frida-enterprise/adapter`.
2. **Verde:** `adapter.ts` puro + split del monolito en 7 módulos; identidad
   por runtime inyectado (`index.ts` crea UNA instancia compartida oauth↔hooks,
   mismo ciclo de vida que el registro en ModelRuntime). El wiring NO cambió
   ni una línea salvo el path del import (barrel con los nombres originales).
3. **Resultados:** 61/61 pruebas locales en repo (25 standalone fuera del repo,
   sin node_modules las 7 core se omiten con skip explícito); typecheck host+webview
   limpio; suite completa del repo: 12 fallos preexistentes (baseline idéntico,
   sin relación) — **cero regresiones**; VSIX re-parcheado.

### Matriz en vivo (todos los modelos × ciclo completo de tools)

`FRIDA_ENTERPRISE_LIVE=1 FRIDA_ENTERPRISE_MODELS="NIKE-VICTORY,SELENE-CIPHER,TIRESIAS-PRISM" npx vitest run test/frida-enterprise/e2e/live-runtime.e2e.test.ts`
(13 s, cadena real: ExtensionRunner + pi-ai SDK + gateway; completion + tool-call
forzado con schema bash real + round-trip con tool result). La matriz amplia
`test/frida-enterprise/live.test.ts` sigue disponible para los 45 modelos chat.

| Resultado | Modelos | Detalle |
|---|---|---|
| ✅ E2E representante | **3/3** | NIKE-VICTORY, SELENE-CIPHER y TIRESIAS-PRISM: generación + tool round-trip por runtime real; **cero 422** |
| ✅ Matriz amplia | **34/45** | Incluye NIKE-VICTORY y TIRESIAS-PRISM; **cero 422** — el fix de identidad funciona |
| ❌ 502 del backend | 11 | VULCAN-FORGE, COEUS-DEEP, CASTOR-TWIN, POLLUX-STAR, IRIS-DAWN, NEREUS-TIDE, NEREUS-ABYSS, THEMIS-SCALE, SATURN-MARK, MARS-FLEET (fase a) y CYCLOPS-ROUGH (fase b) — `OpenAI/Bedrock API request failed`, `Unknown or unsupported provider`: deployments rotos del gateway, **no del cliente** |
| ⚠ Flaky | SELENE-GLOW, SELENE-DRIFT | Una corrida pasaron completa; en otra, round-trip con `content` vacío (finish=stop, salida sólo reasoning_content) — comportamiento del modelo, no del protocolo |

Conclusión: el lado cliente (provider+adaptador) está correcto y completo en
ambos sentidos y la E2E real elimina el 422. Los fallos restantes requieren
acción del equipo del gateway (deployments 502). `classifyGatewayError` ya los
tipifica como `model-unavailable` para la UI.

## Plan de migración (ejecutado — histórico)

1. Crear la carpeta y partir `frida-enterprise-provider.ts` (588 líneas) en los
   6 módulos; `index.ts` re-exporta los símbolos que el wiring importa hoy
   (`FRIDA_ENTERPRISE_PROVIDER`, `FRIDA_ENTERPRISE_PROVIDER_DISPLAY`,
   `buildFridaEnterpriseProviderConfig`, `createFridaEnterpriseHooks`) →
   **los puntos 1–7 del wiring no cambian ni una línea**.
2. Extraer la lógica de traducción a `adapter.ts` (pura):
   `identityFromToken` (hoy `decodeJwtPayload`), `buildFridaPayload` (hoy el
   cuerpo del hook), `endpointForCapabilities` (hoy el filtro inline del
   catálogo), `toProviderModel` (hoy el `.map` del catálogo).
3. Mover el estado de claims de variable de módulo a contexto de sesión
   inyectado en `createFridaEnterpriseHooks({ onUnauthorized, getIdentity })`.
4. `hooks.ts` queda delgado: early-return por provider + delegación al adapter.
5. Tests: partir los 24 actuales por módulo y añadir contrato del adapter
   (inmutabilidad del payload de entrada, identidad ausente → sin user_id pero
   con auto_log, reasoning ya presente no se sobreescribe, `endpointForCapabilities`
   matriz completa).
6. `npm run typecheck` + suite completa + smoke live (opt-in) + reparcheo VSIX.

## Plan de prueba

1. **Unit (adapter, deterministas):** contrato de `buildFridaPayload` —
   identidad inyectada, `auto_log`, traducción reasoning, inmutabilidad,
   passthrough de model/messages/tools/stream; `endpointForCapabilities` con las
   combinaciones reales del catálogo (chat, chat+responses, responses-only,
   embeddings, vacío); `classifyGatewayError` con 401/403/422/502 reales
   capturados en la validación.
2. **Unit (oauth/catalog/hooks):** los 24 tests existentes, repartidos por
   módulo, sin pérdida de cobertura; más tests bidireccionales de respuesta y
   chunks SSE (61 pruebas locales totales con E2E determinista). (PKCE, parseCallbackInput, base64 del
   redirect, baseUrl /v1, filtro chat, refresh, hooks).
3. **Aislamiento:** test de remoción simulada — el suite del repo corre verde
   con la carpeta renombrada temporalmente y los 7 wirings comentados (verifica
   que ningún otro módulo importa del provider).
4. **E2E runtime local:** servidor grabador + `ExtensionRunner` real + adapter
   OpenAI real; verifica 6 escenarios de identidad/aislamiento, URL, Bearer y
   tools; round-trip E2E de tool-result.
5. **Smoke live (opt-in, `FRIDA_ENTERPRISE_LIVE=1`):** recorre los modelos chat
   publicados; reporta por modelo (los 502 de backend quedan visibles como
   `model-unavailable`). E2E live representante: 3 modelos, generación +
   tool round-trip, verde.
5. **Integración VSIX:** reparcheo + Reload Window + generación real con
   SELENE-CIPHER/NIKE-VICTORY (los del 422 original).

## Consecuencias

- **+** Toda la semántica propietaria de Frida Enterprise en una carpeta con
  contrato explícito; los hooks dejan de tener lógica propia.
- **+** Identidad sin variable global de módulo → sin carreras entre sesión
  principal y sesiones hijas de workflow.
- **+** Remoción verificable por grep + suite; otros providers intactos por
  construcción (el adaptador sólo se invoca tras el early-return por provider).
- **+** `classifyGatewayError` permite mensajes accionables (422 → "re-login",
  502 → "modelo no disponible en el backend") en vez de `422 status code (no body)`.
- **−** Más archivos que el monolito actual (7 vs 2); mitigado con barrel
  `index.ts` que mantiene el wiring idéntico.
- **−** El adaptador de Fase 1 sigue atado al parser SSE de `openai-completions`
  de pi-ai: si el gateway cambia su streaming, hay que ir a Fase 2.
- **Riesgo:** refactors de pi-ai en los eventos (`onPayload`,
  `transformHeaders`) siguen siendo superficie de integración — igual que hoy,
  pero ahora documentada en un solo contrato.
