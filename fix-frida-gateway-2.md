# Fix del gateway DevEngine — Segundo reporte: incidente de streaming del 29-30/ago

> **Para:** equipo de DevEngine.
> **De:** proyecto Frida Code (cliente OpenAI-compatible sobre Pi).
> **Seguimiento de:** `fix-frida-gateway.md` (primer reporte: 3 issues de 500 opacos).
> **Base URL:** `https://mywork.softtek.com/apg/devengine` · **Auth:** `X-Api-Key`.
> **Modelos afectados:** `gpt-5.6-sol` (el incidente se observó con este; los probes
> corren el catálogo completo: mini, luna, sol, terra).

---

## 0. Resumen ejecutivo

Durante una sesión agéntica real de ~20 h (29-ago 16:40Z → 30-ago 13:12Z) el gateway
falló **19 veces en ~700 requests (~2.7%)**, concentradas en **4 episodios** de
minutos, con **dos firmas nuevas** que no estaban en el primer reporte:

| Firma | Síntoma que ve el usuario | Veces | Δ tras el request |
| --- | --- | --- | --- |
| **A** | `Error procesando la respuesta del proveedor` (error SSE en streaming, **sin status HTTP**) | 9 | 61–68 s |
| **B** | `Request timed out.` (el gateway **nunca devuelve ni los headers**) | 10 | 71–85 s |

**No es la red del cliente**: en las mismas ventanas horarias de los fallos,
cientos de requests al gateway tuvieron éxito por la misma ruta (hora 17Z: 205
requests / 3 fallos; hora 00Z: 116 / 6). La red local no produce mensajes de
error JSON en español emitidos por el servidor.

**No es el cliente**: este reporte incluye una suite determinista
(`stream-failure-signatures.test.ts`) que reproduce AMBAS firmas contra un
servidor SSE local que emula el comportamiento del gateway, y un caso CONTROL
que demuestra que el mismo cliente termina bien cuando el stream es correcto.

---

## 1. Estado de los issues del primer reporte

El primer reporte (`fix-frida-gateway.md`) documentó 3 issues + autodescubrimiento.
Frida mantiene los workarounds activos (`src/providers/softtek-provider.ts`,
ADR-0009) **hasta confirmar cada fix con el gate automatizado nuevo**:

| Probe | Issue del reporte 1 | Workaround activo de Frida | Cómo verificar |
| --- | --- | --- | --- |
| P1 | `reasoning_content` rechazado en historial → 500 | `requiresThinkingAsText` (infla contexto) | `live-regression.e2e.test.ts` |
| P2 | `content: null` + `tool_calls` → 500 | `requiresAssistantAfterToolResult` (assistant puente) | ídem |
| P3 | overflow de contexto manifestado como 500 | setting `frida.devengine.contextWindow` manual | ídem |
| P4 | `GET /models/{alias}` → 404 (sin autodescubrimiento) | catálogo estático hardcodeado | ídem |

**Resultado de los probes (corridos el 30-ago 13:48 UTC con key válida)**:
`test/devengine/e2e/reporte-regresion-devengine.md` —

| Probe | Issue del reporte 1 | Status | Estado |
| --- | --- | --- | --- |
| P1 | `reasoning_content` rechazado en historial → 500 | 200 | ✅ **RESUELTO** |
| P2 | `content: null` + `tool_calls` → 500 | 200 | ✅ **RESUELTO** |
| P3 | `/models` sin `context_length` (overflow → 500 opaco) | 200 | ❌ **PENDIENTE** (lista 6 modelos, ninguno con context_length/context_window) |
| P4 | `GET /models/{alias}` → 404 | 200 | ✅ **RESUELTO** (devuelve detalle de `gpt-5.4-mini`) |

**Gracias por los fixes de P1/P2/P4.** Como seguimiento nuestro: con P1/P2
verificados en 200 retiraremos los workarounds `requiresThinkingAsText` y
`requiresAssistantAfterToolResult` de Frida (ADR-0009) — el único que
permanece es el ajuste manual de `frida.devengine.contextWindow` mientras P3
no exponga el límite real.

Para re-verificar en cualquier momento (1 min):

```bash
DEVENGINE_API_KEY="tu-key" npx vitest run test/devengine/e2e/live-regression.e2e.test.ts
```

El test genera `test/devengine/e2e/reporte-regresion-devengine.md` con el estado
RESUELTO/PENDIENTE por issue. **El suite está ROJO mientras exista un issue
pendiente** (hoy: P3) — es el gate de aceptación.

---

## 2. Incidente nuevo — evidencia

### 2.1 Cronología (UTC)

| Ventana | Requests | Fallos | Firmas |
| --- | --- | --- | --- |
| 29-ago 17:02–17:52 | 205 (hora 17Z) | 3 | A×1, B×2 |
| 29-ago 19:09–19:18 | 72 (hora 19Z) | 5 | B×4, A×1 |
| 30-ago 00:03–00:45 | 116 (hora 00Z) | 6 | B×4, A×2 |
| 30-ago 01:34–03:00 | 21 | 5 | A×5 |
| Aislados (03:00, 13:12) | — | 2 | A×1, B×1 |

Fuente: `~/.frida/logs/provider-audit.log` (1 línea por request) y el historial de
sesión (`message_end … stopReason=error — <errorMessage>` en `abort.log`).

### 2.2 FIRMA A — error SSE del gateway sin status HTTP

**Qué emite el gateway** (reconstruido del comportamiento del cliente; el shape
`type/param/code` es el mismo de sus otros bodies de error, p. ej. el 500 del
probe del 26-ago):

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: {"choices":[{"delta":{"role":"assistant","content":""}}]}      ← streaming normal
data: {"choices":[{"delta":{"content":"..."}}]}                       ← contenido parcial…
data: {"error":{"message":"Error procesando la respuesta del proveedor","type":"server_error","param":null,"code":"internal_error"}}

                                                                      ← stream muere. Sin status, sin finish_reason, sin [DONE].
```

**Por qué es opaco para cualquier cliente OpenAI-compatible** (mecanismo exacto,
verificado en el SDK `openai` que usa Frida): un evento SSE con campo `error`
dentro de una respuesta 200 hace que el SDK lance `APIError(undefined, data.error,
…)` → `.message` = el texto del gateway **verbatim, sin status**. El usuario ve
"Error procesando la respuesta del proveedor" sin código, sin causa, sin acción
posible.

**Interpretación**: el texto es del propio gateway ("el proveedor" = el backend del
modelo detrás del gateway): el gateway aceptó el request, empezó a streamear y su
upstream falló a mitad (~61–68 s después). Es un error de infraestructura del
gateway/upstream, no del payload (los mismos payloads tuvieron éxito antes y
después en la misma sesión).

### 2.3 FIRMA B — el gateway nunca responde

El gateway acepta la conexión TCP y **jamás devuelve los headers de la respuesta**.
El timeout HTTP del cliente (efectivo ~60 s en Frida; el SDK openai aplica el
timeout sólo hasta la llegada de headers) aborta → `APIConnectionTimeoutError` →
"Request timed out." a los 71–85 s del request. Implica que el request quedó
en cola/procesando >60 s sin ningún byte de respuesta: colchón de conexiones
agotado, upstream frío o pool saturado durante los episodios.

### 2.4 Descartes

- **Red local / VPN / proxy del cliente**: descartado por los éxitos intercalados
  (§0) y porque la FIRMA A es un mensaje JSON emitido por el servidor.
- **El cliente (Frida/Pi/SDK)**: descartado por el caso CONTROL de la suite
  determinista (§3.1): el mismo cliente contra un stream bien formado termina `stop`.
- **Cuota del gateway**: los 429 observados en la sesión fueron del proveedor
  alterno `zai` (fallback del usuario durante el episodio), no de DevEngine.

---

## 3. Cómo reproducirlo — suite automatizada nueva

Tres archivos en `test/devengine/` (mismo repo que la suite DevEngine existente):

### 3.1 Determinista, sin red (~2 s) — reproduce A y B exactamente

```bash
npx vitest run test/devengine/stream-failure-signatures.test.ts
```

- **FIRMA A**: servidor SSE local que emite chunks normales y LUEGO el evento
  `data: {"error":{…español…}}` sin status → aserta `stopReason=error` con el
  mensaje **verbatim** y sin prefijo de status (la firma exacta del incidente).
- **FIRMA B**: servidor que acepta el request y nunca responde → con timeout de
  cliente 1.5 s → aserta "Request timed out.".
- **CONTROL**: mismo cliente contra un stream correcto → `stopReason=stop`.
  Prueba que las firmas son del gateway, no del cliente.

Este archivo sirve además como **spec ejecutable del comportamiento esperado**:
si su fix cambia el formato del evento de error en streaming, este test (junto al
SDK) define cómo debe verse el resultado en el cliente.

### 3.2 Live contra el gateway real — dispara el episodio y lo clasifica

```bash
DEVENGINE_API_KEY="tu-key" npx vitest run test/devengine/e2e/live-stability.e2e.test.ts
# Overrides: DEVENGINE_MODELS="gpt-5.6-sol" · DEVENGINE_STABILITY_N=20
```

Soak de N requests secuenciales por modelo (default 10 × 4 modelos) con payload
típico agéntico (código + análisis, effort medium) y timeout por request de 90 s.
Cada fallo se clasifica por firma; genera
`reporte-stability-devengine.md` (n, modelo, ms, firma, errorMessage).
**VERDE = estable; ROJO = algún request reprodujo firma A o B** (los episodios
son intermitentes: si no se reproduce a la primera, reintentar en otra ventana).

**Corrida basal del 30-ago 13:49–13:52 UTC**: 40/40 éxitos (10 × 4 modelos),
latencias 2.9–6.9 s (p50 ≈ 4 s) — el gateway estaba sano fuera de episodio.
Durante los episodios del 29-30/ago las mismas llamadas fallaban 2.7% de las
veces; este soak es el detector para capturar la próxima ventana en vivo.

### 3.3 Live — regresión de los issues del primer reporte (§1)

```bash
DEVENGINE_API_KEY="tu-key" npx vitest run test/devengine/e2e/live-regression.e2e.test.ts
```

---

## 4. Fix esperado

### Para la FIRMA A (error de upstream a mitad del stream)

1. **Propagar la causa real con semántica estándar** en el evento SSE:

   ```text
   data: {"error":{"message":"upstream no respondió (azure-chat-default, 60s)","type":"upstream_error","code":"upstream_timeout","request_id":"<id>"}}
   ```

   - `message` descriptivo (qué falló, en qué backend, cuánto esperó) — no un
     genérico en español que el usuario no puede accionar.
   - `type`/`code` estables para que el cliente pueda clasificar y reintentar.
   - **`request_id` de correlación** para que DevEngine pueda ubicar el request
     en sus logs (hoy el cliente no tiene cómo reportar el fallo con trazabilidad).
2. Si ya se emitió contenido parcial, emitir el error como **evento terminal
   documentado** (no cortar el socket sin más) y de ser posible un
   `finish_reason: "error"` para que el cliente distinga corte de fin.
3. Idealmente, **reintento interno del upstream** antes de exponer el fallo.

### Para la FIRMA B (sin respuesta >60 s)

1. **Responder headers siempre dentro de un SLO** (p. ej. 30 s): si el upstream
   no arrancó, emitir `200 + text/event-stream` con keepalives (`: ping\n\n`)
   mientras se espera, o fallar temprano con `503` + `Retry-After`.
2. **Deadline explícito por request hacia el upstream** — nunca dejar el socket
   del cliente colgado sin datos.
3. Si el colapso es por saturación (pool/conexiones), un `429` con `Retry-After`
   es mejor que un hang: el cliente lo reintenta limpio.

### Para ambos

- Publicar el formato del evento de error en streaming en su contrato
  OpenAI-compatible (hoy no está documentado y los clientes lo descubren opaco).
- Telemetría del lado DevEngine: los episodios del 29-30/ago (ventanas en §2.1)
  deberían ser visibles en sus métricas de p99 de first-byte y de errores de
  upstream; cruzar con esos timestamps.

---

## 5. Evidencia adjunta (repositorio Frida)

| Artefacto | Contenido |
| --- | --- |
| `test/devengine/stream-failure-signatures.test.ts` | Repro determinista firmas A/B + control (este reporte, §3.1) |
| `test/devengine/e2e/live-stability.e2e.test.ts` | Soak live + clasificador de firmas + reporte MD (§3.2) |
| `test/devengine/e2e/live-regression.e2e.test.ts` | Gate P1–P4 de los issues del primer reporte (§1) |
| `test/devengine/e2e/reporte-*` | Reportes de las corridas (tools/reasoning/multiturn del 29-ago) |
| `docs/adr/0009-devengine-reasoning-roundtrip.md` | Workarounds activos y su retiro condicionado |
| `fix-frida-gateway.md` | Primer reporte (contexto de P1–P4) |

Del lado del incidente (si la necesitan cruda): volcados de requests fallidos en
`globalStorage/softtek.frida-code/devengine-errors/` (p. ej.
`2026-08-29T19-37-39__Implementar_plan_por_fases.json`), cronología por request en
`~/.frida/logs/provider-audit.log` y mensajes de error exactos en el historial de
sesión (muestras en §2.2–2.3).
