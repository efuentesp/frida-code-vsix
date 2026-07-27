# Fix del gateway DevEngine para Frida (compatibilidad OpenAI/OpenRouter)

> **Para:** equipo de DevEngine / agentes de IA que mantengan el gateway.
> **De:** proyecto Frida Code (extensión VS Code sobre Pi que usa DevEngine como provider OpenAI-compatible).
> **Objetivo:** que el gateway se comporte como un router OpenAI/OpenRouter estándar, de modo que
> clientes como Frida (y cualquier cliente OpenAI-compat) se **autoconfiguren** y dejen de fallar.

Frida registra DevEngine como un provider con `api: "openai-completions"` y le envía peticiones a
`POST {baseUrl}/chat/completions`. Hoy hay **tres problemas** que provocan `500 Internal Server Error`
y que obligan a Frida a carry workarounds. Este documento detalla cada uno, la causa raíz y la
especificación de lo que falta implementar.

- **Base URL (OpenAI):** `https://mywork.softtek.com/apg/devengine`
- **Auth:** header `X-Api-Key: <key>` (también acepta `Authorization: Bearer` y `X-Api-Token`).
- **Modelo usado por Frida:** `gpt-5.4-mini` (mapeado internamente por el gateway; ver diagnóstico).

---

## 0. Diagnóstico actual del gateway (verificado)

Llamadas reales con una key válida. **Frida incluye un comando que ejecuta todos estos probes**
y muestra un resumen de compatibilidad: `Cmd+Shift+P` → **"Frida: Diagnosticar gateway DevEngine"**
(vuelca el resultado al canal de salida "Frida DevEngine").

| Endpoint | Resultado | Observación |
| --- | --- | --- |
| `GET /models` | **200** | Devuelve `azure-chat-default` y `azure-embeddings-default`. Formato OpenAI **mínimo** (`id, object, created, owned_by`). **Sin `context_window`/`context_length`.** |
| `GET /models/gpt-5.4-mini` | **404** | "Modelo no encontrado con alias: gpt-5.4-mini". **No soporta detalle por modelo ni aliases.** |
| `GET /models/azure-chat-default` | **404** (probable) | Detalle por `id` real tampoco soportado. |
| `GET /v1/models` | **400** | Rutea a la **API de Anthropic** (pide `anthropic-version`). O sea: `/` = OpenAI, `/v1/*` = Anthropic. |
| `GET /key` | **?** (no OpenAI estándar) | OpenRouter lo expone (limit, usage, is_free_tier). Verificar si existe. |
| `GET /credits` | **?** (no OpenAI estándar) | OpenRouter lo expone. Verificar si existe. |
| `POST /chat/completions` | ✅ (sesión corta) / **500** (sesión larga) | Ver issues 1, 2 y 3. |
| `POST /embeddings` | **?** | Existe el modelo `azure-embeddings-default`; verificar el endpoint. |

**Hallazgos clave:**

1. El modelo `gpt-5.4-mini` que usa Frida **no aparece** en `/models` → el gateway lo **mapea** internamente (probablemente a `azure-chat-default`, Azure OpenAI). El chat funciona por ese mapeo, pero el alias no es consultable.
2. **No se expone el `context_window`/`context_length`** del modelo real en ningún endpoint → los clientes no pueden saber el límite real de tokens.
3. Los `500` no incluyen body → imposible diagnosticar desde el cliente (Frida tiene que dumpear el request para inferir la causa).

---

## Issue 1 — Round-trip de `reasoning_content` (500 al continuar sesión con razonamiento)

### Síntoma

`POST /chat/completions` devuelve **500** cuando el body incluye un mensaje `assistant` del historial
con el campo `reasoning_content`. Las sesiones **nuevas** (sin ese campo) funcionan; las que
**continúan** un historial con razonamiento previo fallan.

```json
{
  "model": "gpt-5.4-mini",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "respuesta...", "reasoning_content": "el razonamiento que el modelo devolvió antes..." },
    { "role": "user", "content": "continúa" }
  ],
  "reasoning_effort": "medium"
}
```

### Causa raíz

1. El gateway **emite** `reasoning_content` en el stream de respuesta (`delta.reasoning_content`) cuando se pide `reasoning_effort`.
2. Los clientes (Pi, y cualquier cliente OpenAI-compat que respete la extensión de DeepSeek) lo **persisten** en el historial.
3. Al **reenviar** ese mensaje en `messages`, el gateway **no lo acepta como input** y responde 500.

Es decir: **el campo que el gateway produce en responses, lo rechaza en requests.**

### Fix esperado (en orden de preferencia)

1. **Aceptar `reasoning_content` en mensajes `assistant` del historial** (round-trip consistente). Es lo que hace DeepSeek (referencia canónica de esta extensión).
2. **Proxy tolerante**: si un mensaje trae un campo que el backend no reconoce, **ignorarlo** y continuar, no responder 500.
3. Devolver un **body** en el 500 con la causa real (ver §4).

> **Workaround temporal de Frida:** `compat.requiresThinkingAsText = true` → Pi reenvía el razonamiento como **texto plano en `content`** en vez de como `reasoning_content`. Infla el contexto. **Se quita cuando el gateway acepte el round-trip.**

---

## Issue 2 — `content: null` en `assistant` con `tool_calls` (500)

### Síntoma

`POST /chat/completions` devuelve **500** cuando un mensaje `assistant` del historial tiene
`"content": null` y `tool_calls`. Es **estándar OpenAI**: cuando hay `tool_calls`, `content` puede
ser `null`. Las primeras interacciones (texto puro) funcionan; en cuanto el agente hace un
tool_call (`edit`/`write`/`bash`), ese mensaje viaja con `content: null` y la siguiente petición 500.

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    { "id": "call_abc123", "type": "function", "function": { "name": "edit", "arguments": "{...}" } }
  ]
}
```

### Fix esperado

- **Aceptar `content: null`** cuando el mensaje `assistant` tiene `tool_calls` (igual que OpenAI).

> **Workaround temporal de Frida:** `compat.requiresAssistantAfterToolResult = true` → Pi envía `content: ""` (string vacío) en vez de `null`. Efecto colateral menor: inserta un mensaje `assistant` puente tras tool results. **Se quita cuando el gateway acepte `content: null`.**

---

## Issue 3 — Overflow de contexto manifestado como 500 (probable)

### Síntoma

Sesiones largas (historial grande) fallan con 500 aunque el request sea **estructuralmente válido**
(verificado: orden de roles correcto, tool_calls ↔ tool_results emparejados, `content` válido, sin
campos raros). Sesiones nuevas funcionan. El límite está **entre sesiones cortas y largas** (~33k
tokens ya falló en nuestras pruebas).

### Causa probable

El modelo real detrás (`azure-chat-default`, Azure OpenAI) tiene un `context_window` propio y
**desconocido para el cliente**. Frida declara 400k (o el ajustable), pero si el modelo real aguanta
menos y el gateway no valida/clipa el input, el backend falla y el gateway lo manifiesta como **500**
en vez de un error claro de overflow.

### Fix esperado

- **Exponer el `context_window` real** (ver §3) para que los clientes respeten el límite.
- Devolver un **error semántico** (`400`/`413` con mensaje `context_length_exceeded`) en vez de 500.

> **Workaround temporal de Frida:** setting `frida.devengine.contextWindow` (ajustable) para que Pi compacte antes de cruzar el umbral. **Se quita la necesidad cuando el gateway exponga el `context_window` real** (Frida lo leería).

---

## 3. Objetivo: autodescubrimiento estilo OpenRouter

Para que Frida (y cualquier cliente) se autoconfigure —modelos disponibles y `context_window` real—
**sin hardcodear nada**, el gateway debe exponer el `context_window` por modelo. El estándar OpenAI
`/v1/models` **no** lo incluye; routers como **OpenRouter** y **Together** lo añaden como extensión.

### 3.1 `GET /models` — incluir `context_window` (y metadata útil) por modelo

**Hoy** devuelve:

```json
{
  "object": "list",
  "data": [
    { "id": "azure-chat-default", "object": "model", "created": 1778845950, "owned_by": "azure" },
    { "id": "azure-embeddings-default", "object": "model", "created": 1778846410, "owned_by": "azure" }
  ]
}
```

**Esperado** (extensión tipo OpenRouter/Together):

```json
{
  "object": "list",
  "data": [
    {
      "id": "azure-chat-default",
      "object": "model",
      "created": 1778845950,
      "owned_by": "azure",
      "context_length": 128000,
      "max_completion_tokens": 16384,
      "supports_tool_calls": true,
      "supports_vision": true,
      "supports_reasoning": true,
      "aliases": ["gpt-5.4-mini", "gpt-4o-mini"]
    }
  ]
}
```

**Campos clave a añadir** (todos opcionales, pero `context_length` es el crítico):

| Campo | Tipo | Por qué | Referencia |
| --- | --- | --- | --- |
| `context_length` | number | **Crítico.** Límite de tokens de input. Evita el Issue 3. | OpenRouter usa `context_length`; Together, `context_window`. |
| `max_completion_tokens` | number | Límite de output (`max_tokens`). | OpenRouter: `max_completion_tokens`. |
| `supports_tool_calls` | boolean | Si admite function calling. | — |
| `supports_vision` | boolean | Si admite imágenes (`image_url`). | — |
| `supports_reasoning` | boolean | Si admite `reasoning_effort`/`reasoning_content`. | — |
| `aliases` | string[] | Nombres alternativos que el gateway mapea a este modelo (ej. `gpt-5.4-mini`). | Para que el cliente sepa qué alias es válido. |

### 3.2 `GET /models/{id}` — detalle de un modelo

**Hoy:** `404 "Modelo no encontrado con alias: gpt-5.4-mini"`.

**Esperado:** soportar tanto el `id` real (`azure-chat-default`) como los **aliases** (`gpt-5.4-mini`),
devolviendo la misma metadata de §3.1:

```json
GET /models/gpt-5.4-mini  →  200
{ "id": "azure-chat-default", "aliases": ["gpt-5.4-mini"], "context_length": 128000, ... }
```

### 3.3 Comportamiento de errores (transparente)

- **Overflow de contexto** → `400` (o `413`) con body:

  ```json
  { "error": { "message": "This model's maximum context length is 128000 tokens...", "type": "invalid_request_error", "code": "context_length_exceeded" } }
  ```

  en vez de `500`. Así el cliente puede compactar/reintentar con contexto menor.
- **Campos no reconocidos en `messages`** (`reasoning_content`, `content: null` válido, etc.) →
  **ignorarlos** y continuar, no `500`.
- **Cualquier 500 debe incluir body** con la causa real (para que clientes y DevEngine puedan
  diagnosticar). Hoy el 500 viene sin body → opaque.

---

## 4. Casos de prueba (cómo verificar cada fix)

Cada fix debe verificarse con `curl` contra el gateway. Ejemplo con key en variable:

```bash
KEY="tu-api-key"
B="https://mywork.softtek.com/apg/devengine"
```

**Fix 1 (reasoning_content):** reenviar un assistant con `reasoning_content` → debe devolver 200.

```bash
curl -sS -X POST "$B/chat/completions" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{
  "model": "gpt-5.4-mini",
  "messages": [
    { "role": "user", "content": "hola" },
    { "role": "assistant", "content": "hola!", "reasoning_content": "pensé antes de responder" },
    { "role": "user", "content": "otra vez" }
  ]
}'
# Esperado: 200 con respuesta, NO 500.
```

**Fix 2 (content null + tool_calls):** reenviar un assistant con `content: null` y `tool_calls` → 200.

```bash
curl -sS -X POST "$B/chat/completions" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{
  "model": "gpt-5.4-mini",
  "messages": [
    { "role": "user", "content": "edita x" },
    { "role": "assistant", "content": null, "tool_calls": [ { "id": "call_1", "type": "function", "function": { "name": "edit", "arguments": "{}" } } ] },
    { "role": "tool", "tool_call_id": "call_1", "content": "ok" },
    { "role": "user", "content": "gracias" }
  ]
}'
# Esperado: 200, NO 500.
```

**Fix 3 (context_window + overflow claro):**

```bash
# /models expone context_length:
curl -sS -H "X-Api-Key: $KEY" "$B/models" | grep -o '"context_length":[0-9]*'
# Overflow devuelve 400 (no 500): enviar un prompt enorme y verificar el código + body.
```

**Detalle por alias:**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -H "X-Api-Key: $KEY" "$B/models/gpt-5.4-mini"
# Esperado: 200 (no 404).
```

---

## 5. Workarounds actuales de Frida (y qué quitar cuando se arregle)

Frida registra el modelo DevEngine con estos flags de compatibilidad (ver `src/providers/softtek-provider.ts`
y ADR-0009). **Cada uno se quita cuando el gateway implemente el fix correspondiente:**

| Workaround de Frida | Mitiga | Qitar cuando… |
| --- | --- | --- |
| `requiresThinkingAsText: true` | Issue 1 (reasoning_content) | el gateway acepte `reasoning_content` en requests. |
| `requiresAssistantAfterToolResult: true` | Issue 2 (content null) | el gateway acepte `content: null` con `tool_calls`. |
| `frida.devengine.contextWindow` (setting, hardcodeado antes) | Issue 3 (overflow) | el gateway exponga `context_length` en `/models`. |
| Dump de requests (`devengine-last-request.json` + `devengine-errors/`) | diagnóstico de 500 opacos | el gateway devuelva body útil en los 500. |

El documento vivo de estas decisiones está en `docs/adr/0009-devengine-reasoning-roundtrip.md`.

---

## 6. Resumen para el equipo DevEngine

1. **Aceptar** en `POST /chat/completions` (requests): `reasoning_content` en `assistant` (Issue 1) y
   `content: null` con `tool_calls` (Issue 2) → estándar OpenAI.
2. **Exponer** `context_length` (y metadata) por modelo en `GET /models`, y soportar `GET /models/{id}`
   **incluyendo aliases** (Issue 3 + autodescubrimiento).
3. **Devolver errores semánticos con body** (overflow → `400`/`413` con mensaje; nunca 500 sin body;
   ignorar campos desconocidos en vez de 500).

Con esto, Frida (y cualquier cliente OpenAI-compat) se autoconfigura y deja de necesitar workarounds.
