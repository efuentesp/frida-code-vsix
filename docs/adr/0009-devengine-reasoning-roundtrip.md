# DevEngine: issues de formato de mensajes (workarounds temporales)

**Estado:** aceptado (workarounds activos; revertibles cuando DevEngine arregle el round-trip).

El gateway Softtek DevEngine (`api: "openai-completions"`) tiene **dos** inconsistencias
con el formato de mensajes OpenAI que provocan **500 Internal Server Error** (3 reintentos →
fail) al **continuar una sesión grabada** (las nuevas funcionan). Ninguna es bug de Frida ni
de pi: el gateway rechaza mensajes que el estándar OpenAI acepta.

## Decisión: workaround `requiresThinkingAsText: true`

Registrar el modelo Softtek (`src/providers/softtek-provider.ts`) con:

```ts
compat: { supportsReasoningEffort: true, requiresThinkingAsText: true }
```

Es la **perilla canónica de pi-ai** (`api/openai-completions.js`, `convertMessages`) para
proveedores que devuelven reasoning pero no lo aceptan de vuelta: hace que pi reenvíe el
thinking previo como **texto plano en `content`** (estándar OpenAI) en vez de como el campo
`reasoning_content` → el gateway lo acepta.

**Efecto:** las sesiones grabadas con razonamiento vuelven a continuar; se conserva la
generación de reasoning en turnos nuevos (`reasoning_effort` sigue enviándose).

## Trade-off aceptado (mientras el workaround esté activo)

- **Infla el contexto al continuar**: el razonamiento previo viaja como texto en `content`,
  no como `reasoning_content` compacto. En sesiones largas con varios turnos de razonamiento,
  consume más tokens.
- **Peor continuidad semántica**: el modelo lee el razonamiento previo como texto suelto, no
  como razonamiento nativo (pérdida menor vs. DeepSeek-style).

## Segundo issue: `content: null` en assistant con tool_calls

El gateway **rechaza** mensajes `assistant` con `"content": null` y `tool_calls` (es
**estándar OpenAI**: cuando hay `tool_calls`, `content` puede ser `null`). Síntoma: las
primeras interacciones (texto puro, `content` string) funcionan; en cuanto el agente hace
un tool_call (`edit`/`write`/`bash`), ese mensaje viaja con `content: null` y la siguiente
petición 500. Confirmado con el dump: 84 mensajes, 20 assistant con `content: null` +
`tool_calls`.

## Workaround: `requiresAssistantAfterToolResult: true`

Registrar el modelo con `compat.requiresAssistantAfterToolResult: true`. Es la perilla de
pi-ai (`convertMessages`) que cambia el `content` default del assistant de `null` a `""`
(string vacío), que el gateway sí acepta.

**Efecto colateral menor**: ese flag también inserta un mensaje `assistant` puente
(`"I have processed the tool results."`) entre un `toolResult` y el siguiente `user`
(para providers que lo exigen). Es benigno para DevEngine (un assistant con texto).

## Tercer issue: 401 invisible (API key vencida) — fallback de UX

DevEngine responde **401 estándar** (`{"error":{"code":"invalid_api_key"}}`) cuando la
API key es inválida o vencida. **No es un bug del gateway.** El problema es que Frida **no lo
mostraba**: el agente cerraba con mensajes vacíos (silencio) en vez de un cartel claro, lo
que confundía al usuario (parecía "no responde" en vez de "key inválida").

### Causa: el SDK oficial `openai` lanza antes de `onResponse`

El hook `after_provider_response` (que en Frida dispara `onUnauthorized`/`onProviderError`
para 401/403) **no se ejecuta para errores 4xx**. En `pi-ai/api/openai-completions.js`:

```js
const { data, response } = await client.chat.completions.create(params).withResponse(); // l.138
await options?.onResponse?.({ status: response.status, ... });                          // l.139
```

Para un **401**, el SDK oficial `openai` lanza `AuthenticationError` **dentro del `await`
de la l.138** → la l.139 (`onResponse`, que dispara `after_provider_response`) **nunca se
ejecuta** → el hook de Frida no actúa → el 401 queda invisible. El error del SDK se propaga
por el agent loop, pero sin `errorMessage` explícito en `agent_end`, el resultado eran
`message_start`→`message_end` vacíos.

### Workaround: fallback en `agent_end` (no depende del hook)

`wireSession` trackea si el run generó **algo visible**: `hadText` (algún `text_delta`) y
`hadToolCall` (algún `tool_execution_start`), reseteados en `agent_start`. En `agent_end`, si
**no hubo texto, ni tools, ni `errorMessage` explícito**, se publica:

> ⚠️ El modelo no generó respuesta. Causa probable: API key inválida o vencida (401), o el
> gateway DevEngine no respondió. Renueva tu API key o ejecuta "Frida: Diagnosticar gateway
> DevEngine".

Es robusto porque `agent_end` **sí** se ejecuta siempre (a diferencia de
`after_provider_response` para 4xx). Cubre el 401 y otros casos de "silencio" del modelo.

### Fix de fondo (cuando se quiera precisión)

Idealmente, capturar el `AuthenticationError` del provider **antes** de que se trague, para
mostrar "API key inválida (401)" y disparar el re-onboarding automáticamente. Eso requiere un
punto de extensión que pi-ai exponga para errores del provider (hoy `after_provider_response`
no sirve para 4xx por el orden del `onResponse`). Mientras tanto, el fallback de `agent_end`
es la red de seguridad.

## Fix de fondo (equipo DevEngine) — fuera de Frida

Dos inconsistencias a corregir, en orden de preferencia:

1. **Aceptar `reasoning_content` en mensajes `assistant` del historial** (como DeepSeek).
2. **Aceptar `content: null`** en mensajes `assistant` con `tool_calls` (estándar OpenAI:
   cuando hay `tool_calls`, `content` puede ser `null`).
3. **Proxy tolerante**: ignorar campos/valores no reconocidos en `messages` en vez de 500.
4. Confirmar la causa exacta en los logs del proxy (el 500 es genérico; Frida dumpea el
   request en `<globalStorage>/devengine-last-request.json` y, al fallar, en
   `devengine-errors/<fecha>__<sesión>.json`).

## Cambio en Frida cuando DevEngine arregle ambos issues

Quitar del `compat` del modelo Softtek **ambos** flags y volver a
`compat: { supportsReasoningEffort: true }`:

- `requiresThinkingAsText: true` → recupera reenvío nativo de `reasoning_content`
  (menos tokens, mejor continuidad).
- `requiresAssistantAfterToolResult: true` → deja de insertar `content: ""` y el mensaje
  puente tras tool results.

**Tras quitarlos, validar** continuando una sesión grabada con tool_calls y razonamiento
previo: si vuelve el 500, algún fix del gateway no está completo y se restauran los flags.

## Por qué no otras opciones

- **`reasoning: false`**: evitaría el ciclo (no se pide/persiste reasoning), pero **pierde la
  feature de thinking** por completo. Descartado salvo que el usuario no quiera razonamiento.
- **Filtrar thinking del historial en Frida**: la serialización vive en pi-ai (`convertMessages`),
  no es configurable desde el host sin fork. El flag `requiresThinkingAsText` es la salida
  pensada para esto.

## Punto frágil a regresar en cada bump de Pi

- `model.compat.requiresThinkingAsText` y su efecto en `convertMessages`
  (`api/openai-completions.js`): si pi-ai cambia el nombre/semántica del flag o el default,
  revisar. Hoy (pi-ai actual) `requiresThinkingAsText: true` convierte los thinking blocks a
  texto plano en `content`.
- **401 invisible**: el orden `create().withResponse()` (l.138) → `onResponse` (l.139) en
  `openai-completions.js` — si pi-ai mueve `onResponse` **antes** del await o expone un hook
  de error de provider, el fallback de `agent_end` puede afinarse a un cartel específico de
  401 + re-onboarding. Hoy el fallback genérico cubre el caso.
