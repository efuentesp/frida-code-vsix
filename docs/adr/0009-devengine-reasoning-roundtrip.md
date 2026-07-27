# DevEngine: round-trip de `reasoning_content` (workaround temporal)

**Estado:** aceptado (workaround activo; revertible cuando DevEngine arregle el round-trip).

El gateway Softtek DevEngine (`api: "openai-completions"`) **devuelve** `reasoning_content`
en el stream de respuesta cuando se le pide `reasoning_effort`, pero **no lo acepta de
vuelta** como campo de un mensaje `assistant` en el array `messages` del request →
responde **500 Internal Server Error**. El síntoma: una **sesión nueva** funciona, pero
**continuar una sesión grabada** que tenga razonamiento previo falla (3 reintentos → fail).
No es un bug de Frida ni de pi: es un round-trip inconsistente del gateway (lo que emite,
lo rechaza de vuelta). Los providers oficiales no lo sufren (OpenAI Responses →
`reasoning.encrypted`; Anthropic → thinking signatures; DeepSeek → acepta `reasoning_content`
de vuelta).

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

## Fix de fondo (equipo DevEngine) — fuera de Frida

Hacer el round-trip consistente, en orden de preferencia:

1. **Aceptar `reasoning_content` en mensajes `assistant` del historial** (como DeepSeek).
2. **Proxy tolerante**: ignorar campos no reconocidos en `messages` en vez de 500.
3. Confirmar la causa exacta en los logs del proxy (el 500 es genérico).

## Cambio en Frida cuando DevEngine arregle el round-trip

**Quitar `requiresThinkingAsText: true`** del `compat` del modelo Softtek (volver a
`compat: { supportsReasoningEffort: true }`). Recupera reenvío nativo de `reasoning_content`
(menos tokens, mejor continuidad). **Tras quitarlo, validar** continuando una sesión
grabada con razonamiento previo: si vuelve el 500, el fix del gateway no está completo y se
restaura el workaround.

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
