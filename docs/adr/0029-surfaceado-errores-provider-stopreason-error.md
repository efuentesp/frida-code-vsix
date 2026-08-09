# Surfaceado de errores del provider (`stopReason="error"` → `message.errorMessage`)

**Estado:** aceptado (fix `f772fd7`, issue #6).

## Contexto

Frida se apoya en el SDK de Pi embebido (ADR-0002). Cuando un provider falla durante
la generación (401 auth, 429 cuota/saldo, 404 modelo, error de red, etc.), pi-ai
**termina el mensaje assistant con `stopReason="error"`** y deja el detalle legible en
`message.errorMessage` — lo confirman `print-mode.js:106` e `interactive-mode.js:2380`
del propio SDK:

```js
if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
    console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
}
```

Crucialmente, **el SDK NO copia ese error al evento `agent_end.errorMessage`** (ese
campo sólo se popula para compaction/summarization). El único sitio fiable para leerlo
es el mensaje.

El handler `message_end` de Frida, sin embargo, **sólo revisaba `stopReason === "aborted"`**
y nunca leía `message.errorMessage`. Como consecuencia:

1. El error real se perdía → `agent_end` veía `errorMessage=(none)` con `!hadText &&
   !hadToolCall` → caía en un **fallback genérico hardcodeado**.
2. Ese fallback decía textualmente *"API key inválida o vencida (401), o el gateway
   DevEngine no respondió"* — **incluso para proveedores no-DevEngine** (Moonshot, Z.ai).

El bug se volvió visible vía el **issue #6 (Kimi/Moonshot)**: el request a Moonshot
terminaba con `stopReason=error` (HTTP 429 *"insufficient balance"*, cuenta prepago sin
saldo), pero el usuario veía *"API key inválida o vencida (401)"* mencionando DevEngine.
Un diagnóstico exactamente inverso a la realidad (la key era válida; el problema era de
saldo), durante un proveedor que no es DevEngine.

## Decisión

**D1 — Capturar el error a nivel mensaje.** En el handler `message_end`, cuando
`role === "assistant"` **y** `stopReason === "error"`, guardar `message.errorMessage`
en una variable `lastMessageError` (con `abortDiag` para trazabilidad). Se resetea en
cada `agent_start` (un error capturado pertenece al turno en curso).

**D2 — Surfacear antes que el fallback.** En `agent_end`, el orden de prioridad para
publicar un `provider_error` al webview queda:

1. `event.errorMessage && !event.willRetry` (errores que el SDK sí propaga al evento).
2. `lastMessageError && !event.willRetry` (errores del provider que viven en el mensaje).
3. `!hadText && !hadToolCall` → **fallback** (sólo si no hay error capturable).

**D3 — Fallback consciente del proveedor.** El mensaje genérico usa
`getApiKeyProvider(activeModel.provider).displayName` (vía ADR-0018). El texto específico
de *"Diagnosticar gateway DevEngine"* se reserva **exclusivamente** para
`SOFTTEK_PROVIDER`; el resto recibe un mensaje neutral que indica verificar la API key y
el modelo/ID en el panel de Proveedores.

## Consecuencias

- **El usuario ve el error real** del provider (auth, saldo, cuota, modelo, red) en vez
  de un mensaje inventado. Paridad con el TUI de Pi, que lee exactamente el mismo campo.
- **No se reintenta** lo que no debe: los errores terminales (`willRetry === false`) se
  publican una sola vez; los retriables siguen su flujo por `auto_retry_end`, que ya
  muestra `finalError`.
- **Cero acoplamiento nuevo**: se reutilizan `getApiKeyProvider`, `activeModel` y
  `SOFTTEK_PROVIDER` ya en scope. No se añade estado fuera del closure de sesión.

## Alternativas consideradas

- **Leer sólo `event.errorMessage` en `agent_end`**: insuficiente. El SDK no propaga ahí
  los errores de provider (sí los de compaction/summarization). Sin D1 el error seguiría
  tragado.
- **Registrar un hook `after_provider_response`**: el SDK lanza `AuthenticationError`
  **antes** de `onResponse` para ciertos fallos, así que el hook no los atrapa a todos.
  Esa fue, de hecho, la hipótesis original del comentario "Fix UX #1" — que resultó
  incompleta.
- **Hacer el fallback 100% genérico sin rama DevEngine**: se descartó para conservar la
  guía accionable (*"Diagnosticar gateway DevEngine"*) que sí aplica al gateway SoftTek
  (ADR-0009), donde existen diagnósticos propios.

## Relacionado

- ADR-0017 (registry de providers API-key), ADR-0018 (selector dinámico de
  providers/modelos), ADR-0009 (gateway DevEngine/SoftTek), ADR-0002 (SDK embebido).
- Issue #6 (Kimi/Moonshot) — caso que lo destapó.
- `src/extension.ts` (handlers `message_end` / `agent_start` / `agent_end`).
