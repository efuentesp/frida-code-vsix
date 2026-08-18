# ADR-0061 — Erratas 7–12: dual-endpoint, reasoning y canales laterales

**Estado:** Aceptada · **Fecha:** 2026-08-16 · **Relaciona:** ADR-0059 (provider frida-enterprise), ADR-0060 original (adaptador)

## Contexto

Validación exhaustiva contra el bundle de la extensión original (2.1.28) y probes live
contra el gateway (documentados abajo) reveló que el 422/500 persistente y la ausencia
de tarjetas de pensamiento en NIKE-VICTORY comparten causa: **el gateway Frida no es
un único endpoint OpenAI-compatible, son dos** con reglas distintas.

## Evidencia (bundle + probes live 2026-08-16)

| # | Hecho | Fuente |
|---|---|---|
| E1 | La original **no usa function-calling nativo**: 0 `tool_choice`/`parallel_tool_calls`; agentic loop = XML (`<write_to_file>`, `<function_calls>`, `<end_task>`) + MCP + formato GLM crudo (`<\|tool_call_begin\|>functions.name`) | bundle |
| E2 | Payload de la original: `{model, messages\|input, stream, max_tokens, auto_log, user_id, email, reasoning?}` — sin `tools` | bundle ($Ma/XMa) |
| E3 | Roles aceptados: `system|user|assistant|tool`; `developer` → **500 en /v1/responses y 422 en /v1/chat/completions**; la original mapea `developer→user` y `content:null→""` | bundle (LMa) + probes |
| E4 | Enrutamiento de la original (`yAt`/`TCn`): capability `"responses"` ⇒ **/v1/responses**; sólo-`"chat"` ⇒ /v1/chat/completions; desconocido ⇒ responses | bundle |
| E5 | NIKE-VICTORY (`["chat","responses"]`) **sólo razona por /v1/responses** (`response.reasoning_summary_text.delta`, 98 reasoning_tokens); por chat emite 0 | probes |
| E6 | SELENE-CIPHER (`["chat"]`) razona por chat/completions vía `reasoning_content` (pi-ai lo traduce a `thinking_delta` sin gate de `model.reasoning`) | probes + pi-ai l.293-317 |
| E7 | `/v1/responses` acepta el payload exacto de pi-ai `openai-responses`: `store:false`, `prompt_cache_key`, `max_output_tokens`, `reasoning:{effort,summary:"auto"}`, `include:["reasoning.encrypted_content"]`, tools formato Responses + round-trip `function_call_output` | probes |
| E8 | `reasoning.effort` acepta `none|low|medium|high` (200 en ambos endpoints); la original hardcodea `medium` (interactivo) / `none` (títulos) | probes + bundle |
| E9 | pi-ai `openai-responses` **ya emite `thinking_delta`** desde `reasoning_summary_text.delta` (openai-responses-shared.js:358) | pi-ai |
| E10 | En modo reasoning, pi-ai envía el system prompt como role `developer` en AMBOS adapters → E3 aplica a los dos | pi-ai buildParams/convertResponsesMessages |

## Decisión

1. **Dual-endpoint en el catálogo** (adapter): capability `"responses"` ⇒ modelo
   `api:"openai-responses"` con `baseUrl:{root}/v1`; sólo-chat ⇒ `openai-completions`.
   Igual criterio que la original (E4). Con esto NIKE y los 37 modelos "responses"
   ganan tarjetas de pensamiento sin stream handler custom (E5+E9).
2. **`compat.supportsReasoningEffort:true`** para modelos sólo-chat (pi-ai manda
   `reasoning_effort`; buildFridaPayload ya lo traduce a `reasoning:{effort}`).
3. **Errata-8 extendida**: `buildFridaPayload` traduce `developer→system` en
   `messages` **y** en `input` (E3/E10 — el 500 de responses era este caso).
4. **`reasoning:true` en todos los modelos verificados** (ambos adapters lo usan:
   chat vía reasoning_effort→reasoning; responses vía reasoning:{effort,summary}).
5. Canales laterales (Errata-9): el patch `patchFridaSideChannelsOn` sigue aplicando
   (streamSimple existe en ambos adapters de pi-ai).

## Riesgos aceptados

- Cambiar 37 modelos verificados a `openai-responses` cambia su camino de requests:
  re-validar con la matriz live (los 3 históricos + muestra) tras el cambio.
- Headers de session affinity (`session_id`/`x-session-affinity`) que añade pi-ai:
  el gateway los ignoró en los probes; el E2E determinista vigila regresiones.
- `include:["reasoning.encrypted_content"]`: aceptado hoy; si el gateway lo dejara
  de soportar, `compat` del modelo permite desactivarlo.

## Validación ejecutada

- Unit: catálogo dual-endpoint, traducción developer→system en messages+input,
  compat por capability, thinkingLevelMap.
- E2E determinista: runtime real + adapter openai-responses real → payload grabado
  sin `developer`, con `reasoning`, identidad y `store:false`.
- E2E live: NIKE-VICTORY por /v1/responses con thinking events + tool round-trip.
- Suite completa: baseline exacto (12 fallos preexistentes).

## Errata-11 (añadida 2026-08-16 noche) — canal del título de sesión

`generateSessionTitle` (extension.ts) construía su `DefaultResourceLoader`
**sin `extensionFactories`** → sesión hija sin hooks del provider → 422
`missing user_id` (Errata-2) en toda sesión nueva con modelo frida activo
(reproducido 5/5; síntoma: sesiones sin título). El patch Errata-9 no cubre
este canal: el título va por `session.prompt` → `provider.stream`, no por
`streamSimple`. Fix: `extensionFactories: [createFridaEnterpriseHooks(...)]`
del barrel (runtime compartido ⇒ identidad). Validación: `title-path.e2e`
(T1 documenta el payload roto, T2-fix × ambos adapters, T3 aserción de
wiring del host) + `hooks.test.ts` (7) para la instrumentación `message_end`
(`summarizeMessageEnd`: stop=length|error|stop + bloques + errorMessage al
log de debug — diagnóstico de cortes de conversación).

## Errata-12 (2026-08-16 tarde) — summary≠auto mata el razonamiento; effort siempre visible + Off explícito

**Motivación:** el selector del footer (Bajo/Medio/Alto) SÍ viaja al gateway
por el camino principal (`streamSimple` → `reasoningEffort` → `buildParams`),
pero (a) no había forma de confirmar por-request el nivel enviado, (b) NIKE
mostró tarjetas de pensamiento sólo en 5/52 turnos de una sesión real
(`message_end blocks=[thinking:1…]`), y (c) el nivel "off" no era alcanzable
desde la UI — en modelos chat el campo quedaba **ausente** y el gateway
aplicaba su propio default.

**Probe live (NIKE-VICTORY, `/v1/responses`, prompts que exigen razonamiento):**

| reasoning.summary | effort | resultado |
|---|---|---|
| `auto` | high | 200 + 33 deltas `reasoning_summary_text` (427 reasoning_tokens) — **el único que razonó** |
| `detailed` | high | 200 + **0 items de razonamiento** — acepta pero mata el resumen en silencio |
| `concise` | high | 200 + 0 ídem |
| `auto` | low | sin resumen en esas corridas |

**E12 — hallazgos:** (a) el gateway acepta cualquier `summary` con 200 pero
SÓLO produce resúmenes con `"auto"`; `detailed`/`concise` desactivan el
pipeline silenciosamente ⇒ **no inyectar summary≠auto** (se mantiene el
`"auto"` nativo de pi-ai). (b) El backend NIKE rutea a **Anthropic** tras el
gateway: durante el probe el backend falló con `response.failed`
`"Anthropic streaming API request failed: credential validation failed"`
(incidente de credenciales del gateway, 2026-08-16 ~16:00 UTC; pi-ai ya lo
traduce a error del turno — sin cambio nuestro). (c) La emisión de resumen es
**no determinista lado servidor** incluso con auto+high (misma request:
una corrida con 33 deltas, siguientes sin backend). (d) En chat, `none` da
200 pero su efecto depende del modelo: TIRESIAS lo honora (sin
`reasoning_content`), SELENE razona igual — el nivel EXPLÍCITO es lo que el
cliente garantiza; honrarlo es del backend. Conclusión: las tarjetas
esporádicas de pensamiento son comportamiento del **backend**, no del payload
cliente — con el tag del dbg ahora es diagnosticable por-request.

**Cambios (TDD: 13 pruebas nuevas, rojo→verde; 120/120 del provider):**

1. **`reasoningEffortTag(payload)`** (adapter, pura): el dbg del hook
   (`before_provider_request` post-traducción) registra el effort de CADA
   request en `~/.frida/logs/frida-enterprise-debug.log` —
   `reasoning=high` · `reasoning=high(auto)` · `reasoning=none` ·
   `reasoning=ausente` (delata un payload sin nivel ⇒ default del gateway).
2. **`thinkingLevelMap:{off:"none"}`** en los modelos chat del catálogo
   (`toProviderModel`, junto a `compat.supportsReasoningEffort`): el nivel
   **Off** del footer viaja explícito — pi-ai emite `reasoning_effort:"none"`
   y `buildFridaPayload` lo traduce a `reasoning:{effort:"none"}` (E8 validó
   200 en ambos endpoints). Los modelos responses no lo necesitan: pi-ai ya
   emite `effort:"none"` nativo en ese canal.
3. **Opción "Off" en el select de esfuerzo del Composer** (webview): genérica
   para todo proveedor razonador (GLM: `thinking:disabled`; frida chat:
   `effort:none` explícito). NO es wiring del provider — sin referencia a
   frida-enterprise, sobrevive a la remoción.

**Validación:** unitarias (5 tag + 3 map + 1 regresión + 2 hooks) · E2E
S11 (Alto → `body.reasoning {effort:'high'}` con el modelo del catálogo real)
y S12 (Off → `{effort:'none'}` vía streamSimple con `reasoning:"off"`) ·
typecheck host+webview · suite completa = baseline exacto (12) · VSIX
reparcheado (19,741,814 B, md5 build≡instalado). El botón del header
(ocultar/mostrar razonamiento) es un toggle de VISTA puro y
provider-agnóstico (`Turn.tsx`) — no requería cambio.

## F3 (2026-08-16 tarde) — indicador "razonó N tokens" + matriz de niveles automatizada + detector del incidente

**Motivación:** el usuario debe SABER cuándo un modelo razonó aunque no llegue
tarjeta de pensamiento, y las pruebas deben evidenciar el incidente del canal
`/v1/responses` hoy y pasar solas cuando el gateway lo corrija.

**Matriz en vivo (reporte-reasoning.md, generada por
`live-reasoning.e2e.test.ts` opt-in):**

| Modelo | Canal | Hallazgo (2026-08-16 ~16:20 UTC) |
|---|---|---|
| NIKE-VICTORY | responses | Anthropic se RECUPERÓ (texto ✓, 4/4 efforts 200) pero **0 reasoning_tokens** en todas las corridas → sin tarjeta ni hint |
| ATHENA-LANCE | responses | **ROTO**: `Bedrock ValidationException … ConverseStream … content field` — incidente distinto al de NIKE; detector T1 lo reporta |
| GAIA-FLARE / MERCURY-WING | responses | sanos (texto ✓), 0 reasoning_tokens |
| SELENE-CIPHER | chat | razona SIEMPRE (ignora `none` — lo emite igual); 4/4 efforts 200 |
| TIRESIAS-PRISM / AEOLUS-GALE | chat | nunca emiten `reasoning_content` (200 + texto en 4/4 efforts) |

**T1 = detector del incidente** (aserción dura por modelo): `200 + sin
response.failed + texto`. HOY falla en ATHENA-LANCE con el error del gateway en
el mensaje (evidencia directa para el equipo); cuando lo corrijan, la suite
pasa VERDE → re-corriendo el test se sabe sin inspección manual. T2 (chat ×
none/low/medium/high) y T3 (responses sanos × low/medium/high) fijan el
contrato cliente: todo effort aceptado con 200 + texto.

**Indicador UI (opción "b")**: cuando un turn recibe `usage.reasoning > 0` sin
tarjeta thinking, el host posta `{type:"reasoning_hint", tokens}` y el store
(red webview, reducer puro) añade un segmento `reasoning_hint` que `Turn.tsx`
renderiza: *"🧠 razonó N tokens · el proveedor no envió el resumen del
pensamiento"*. Genérico (cualquier proveedor que reporte `usage.reasoning`);
ignorado si ya llegó `thinking_delta` (redundante); idempotente (máximo); se
reconstruye en el replay del historial. El dbg del provider registra
`reasoning=<N>` en `summarizeMessageEnd`.

**Pruebas (TDD, 6 nuevas):** `hooks.test.ts` (2: usage.reasoning>0 →
`reasoning=427`; sin usage → sin ruido) · `test/webview-store.test.ts` (4:
añade hint / ignora con tarjeta / idempotente-máximo / sin crash sin turns).
NOTA: webview-store.test.ts vive SÓLO en el árbol v018 — depende de
`webview/store.ts` (host UI) que no existe en el espejo frida-llops ni se
sincroniza al main atrasado (AGENTS.md: edits de UI no aplican tal cual).
Suite provider: 122/122 · typecheck host+webview · suite completa = baseline
exacto (12) · VSIX reparcheado (md5 build≡instalado).

**Comando para saber si el gateway corrigió:**

```bash
FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-reasoning.e2e.test.ts
```

- T1 rojo → backend aún roto (el mensaje trae el error exacto para reportar).
- Todo verde → incidente corregido; el reporte-reasoning.md queda actualizado.

## F3-bis (2026-08-16 ~16:45 UTC) — T4: barrido de razonamiento de los 32 verificados a effort=high

Añadido a `live-reasoning.e2e.test.ts` (T4): recorre `VERIFIED_MODEL_IDS`
enrutando cada modelo por SU canal real (capabilities del gateway, igual que
`apiForCapabilities`), effort high fijo. No razonar NO es fallo (queda en el
reporte); falla sólo si hay backend roto.

**Resultado (reporte-reasoning.md regenerado):**

- **19/32 razonan visible (todos con tarjeta de pensamiento):**
  SELENE-CIPHER (chat, `reasoning_content`) y por `/v1/responses`
  (`reasoning_summary`): AEOLUS-GALE (854 tk) · model-router (874) ·
  ZEUS-THUNDER (656) · MIDAS-GOLD (805) · TITAN-CROWN (721) ·
  DEMETER-BLOOM (686) · SIBYL-GLASS (498) · ORACLE-SIGHT (471) ·
  GAIA-FLARE (364) · POSEIDON-DEEP (312) · TIRESIAS-PRISM (264) ·
  ATLAS-CROWN (194) · OURANOS-CROWN (122) · GAIA-LOOM (108) ·
  PYTHIA-LENS (112) · GAIA-GLEAM (84) · HADES-PRIME (65) · KRONOS-VEIL (43).
- **9 sanos sin razonamiento expuesto:** NIKE-VICTORY (⭐ sugerido grande —
  texto ✓ pero 0 reasoning_tokens en TODAS las corridas: la traducción
  Anthropic→responses del gateway pierde el reasoning; reportable) ·
  ORPHEUS-VERSE · SATURN-RING · MARS-SHIELD · PHOEBE-DUST (chat) ·
  MERCURY-WING (⭐ compacto) · PUCK-SWIFT · HELIOS-BRIGHT · JANUS-GATE (chat).
- **4 backends rotos (T4 falla — evidencia para el gateway):** ATHENA-LANCE
  (`Bedrock ValidationException ConverseStream: content field`) ·
  AEGIS-WAVE · OLYMPUS-PEAK · OLYMPUS-GUST (`The request could not be
  completed`).

**Precisión sobre corridas previas:** T2 fuerza el canal chat
(`FRIDA_ENTERPRISE_CHAT_MODELS`) — allí TIRESIAS/AEOLUS no muestran
`reasoning_content`. El catálogo real los enruta por `/v1/responses`
(caps `[chat,responses]` → prioridad responses) y ahí SÍ razonan con tarjeta.
La conclusión "no razonan" era específica del canal chat, no del producto.

**Sugeridos ⭐ vs razonamiento:** NIKE (grande) y MERCURY (compacto) NO
razonan visible hoy; SELENE-CIPHER (mediano) sí. Si el razonamiento visible
pesa en la elección, GAIA-FLARE/TITAN-CROWN/MIDAS-GOLD (grandes, 364–805 tk)
son alternativas verificadoras — decisión de producto pendiente.

## F3-c (2026-08-16 ~17:00) — ⭐ medidos y selector reducido a SELECTED_MODEL_IDS

Decisión de producto: el combo del selector pasa de 32 verificados a los **4
medidos**: `SELECTED_MODEL_IDS` (catalog.ts) = DEMETER-BLOOM (⭐ grande, 686
reasoning_tokens) · TITAN-CROWN (⭐ mediano, 721) · MIDAS-GOLD (⭐ compacto,
805) · model-router (meta). `isSuggested` se alinea (desplaza a
NIKE/SELENE/MERCURY: NIKE pierde el reasoning en la traducción del gateway y
MERCURY no expone). `fetchFridaEnterpriseModels` filtra
caps→VERIFIED→**SELECTED**; VERIFIED (32) sigue sembrando `knowsModel`
(sesiones activas con otros modelos intactas) y alimentando el barrido T4.
Re-ampliar el selector = promover en SELECTED tras la matriz live.

Contenido del combo (verificado contra el gateway vivo, 2026-08-16):

```
⭐ DEMETER-BLOOM (responses, grande 1M)
⭐ TITAN-CROWN (responses, mediano 400k)
⭐ MIDAS-GOLD (responses, compacto 128k)
model-router (responses, meta)
```

Pruebas (TDD): adapter.test (⭐ medidos + prefijo ⭐) · provider.test (combo
exacto de 4 con fixture de 9; orden; baseUrl /v1 con DEMETER; los
verificados-no-seleccionados NO llegan al combo). Suite: 127/127 provider+
store · baseline exacto (12) · typecheck limpio · VSIX reparcheado
(19,742,852 B) · 3 árboles sincronizados.

## F3-d (2026-08-16 ~17:10) — fallback offline también = SELECTED (bug de los "4 viejos")

**Síntoma:** tras F3-c el combo seguía mostrando AEOLUS/NIKE/TIRESIAS/SELENE
— exactamente el **fallback MODEL1..4**, no los 32 ni los nuevos. Causa: arranque
offline/PI_OFFLINE con store vacío (`~/.frida/models-store.json` = `{}`) caía a
`buildFallbackCatalog(envVars)` que aún fabricaba los 4 viejos desde los roles
del gateway. F3-c sólo había filtrado el camino online.

**Fix:** `buildFallbackCatalog` devuelve ahora `FALLBACK_SELECTED` — los 4
SELECTED con metadatos medidos (todos `openai-responses`, reasoning:true, ctx
1M/400k/128k/1M) — sin importar qué digan MODEL1..4; `[]` pre-login (sin
envVars). El combo muestra los MISMOS 4 online y offline.

**Prueba pedida (live, `live-runtime.e2e`):** "COMBO del selector tras cambiar
al proveedor" — `refreshModels` online contra el gateway REAL + camino offline
(store vacío) → ambos devuelven exactamente:
`⭐ DEMETER-BLOOM (responses, grande 1M)` · `⭐ TITAN-CROWN (responses,
mediano 400k)` · `⭐ MIDAS-GOLD (responses, compacto 128k)` ·
`model-router (responses, meta)`. Verde en vivo (2026-08-16 17:09 UTC).

Unitarias fallback reescritas (3): SELECTED aunque MODEL1..4 nombren viejos ·
`[]` sin envVars · 4× responses+reasoning. Suite: 127/127 provider+store ·
baseline exacto (12) · VSIX reparcheado (19,743,544 B) · 3 árboles sincronizados.

**Acción del usuario:** recargar la ventana de VS Code (Reload Window) — el
extension host carga el bundle al arrancar; sin recargar sigue el viejo en
memoria. Tras recargar, abrir el selector frida-enterprise (aunque esté
offline): 4 ⭐ medidos.

## Errata-13 (2026-08-17) — 500 en TODO multi-turno por /v1/responses (incidente del usuario)

**Síntoma reportado:** primera respuesta OK, unas llamadas a tools, y de ahí
en adelante TODO falla con "El modelo no generó respuesta (frida-enterprise)
… API key inválida o vencida (401)…" — en TODOS los modelos del selector.
El mensaje del host es genérico: el dbg real dice
`message_end … stop=error err="OpenAI API error (500): 500 Internal Server Error"`.

**Causa (probe 2026-08-17 07:15 UTC):** el gateway `/v1/responses` devuelve
500 en cuanto el `input` lleva items de un turno PREVIO del assistant — es
decir, en CUALQUIER segundo turno:

| forma del item | resultado |
|---|---|
| `{role:"assistant", content:[{type:"output_text"}]}` (la que envía pi-ai) | ❌ 500 |
| `{type:"reasoning", …}` (firma del razonamiento del turno previo) | ❌ 500 |
| `{type:"summary_text"}` | ❌ 500 |
| `{role:"assistant", content:[{type:"input_text"}]}` | ✅ 200 (blips 502 en MIDAS/TITAN/router; DEMETER estable) |
| `content` string plano | ✅ 200 |
| `{type:"function_call"}` / `{type:"function_call_output"}` | ✅ 200 |
| multi `user` | ✅ 200 |
| chat/completions con tool_calls+tool multi-turno | ✅ 200 (SANO) |

El turno 1 siempre funciona (sólo system+user); el turno 2 regenera
assistant(output_text)+reasoning+function_call vía pi-ai → 500 → el host
muestra el genérico. Los 500 de las 13:00-13:02 UTC incluían también blips
502 ("OpenAI API request failed") de backends degradados.

**Prueba E2E (opt-in):** `test/frida-enterprise/e2e/live-multiturn.e2e.test.ts`
→ `reporte-multiturn.md`.
- **T1 [REPRO]**: cadena REAL (adapter openai-responses de pi-ai +
  buildFridaPayload) turno 1 con tool → toolResult → turno 2. HOY falla con
  el error exacto del incidente; pasará VERDE solo cuando el gateway acepte
  la forma estándar de OpenAI (o se active un workaround del adaptador).
- **T2**: contrato de formas ACEPTADAS (estables pese al fix): input_text,
  string, fc/fc_out (con tolerancia a blips 5xx persistentes → nota).
- **T3**: contraste — chat/completions multi-turno+tools SANO (SELENE).
- **T4**: evidencia informativa de las formas RECHAZADAS (500 hoy).

**Debug nuevo:** `payloadShapeTag(payload)` (adapter.ts, exportada) — el dbg
del hook ahora registra la FORMA de cada request
(`… · reasoning=low(auto) · shape=input[system(input_text),user(input_text),assistant(output_text),reasoning,fc,fc_out]`)
sin loguear contenido. Con esto, el próximo 500 se diagnostica del log sin
re-probar a mano. (La E2E determinista title-path cazó en el desarrollo un
ReferenceError silencioso del dbg que habría devuelto payloads sin identidad
— el catch del hook traga TODO: lección añadida.)

**Workaround APLICADO (autorizado 2026-08-17, mismo día):** `buildFridaPayload`
traduce en un solo pase los items de `input` para /v1/responses:
`output_text→input_text` en los mensajes previos del assistant, items
`reasoning` DESCARTADOS, `developer→system` (Errata-8) preservado, fc/fc_out
intactos. Copy-on-change: sin items problemáticos el array queda igual.
Coste asumido: sin continuidad de razonamiento entre turnos (ya se perdía:
todo turno 2 moría en 500). REMOVIBLE: cuando el gateway acepte la forma
estándar, borrar el bloque marcado Errata-13 en adapter.ts; T1 del E2E live
sigue verde por sí solo (prueba la cadena real, no el workaround).

**Verificación del fix:** unitarias +6 (traducción/anticambio/rama chat
intacta) · E2E determinista S13 (runtime real + grabador: sin reasoning
items, sin output_text, fc/fc_out emparejados, identidad) · **E2E live T1
VERDE contra el gateway** (turno1 toolCall → turno2 toolResult → respuesta
final stop=stop, DEMETER-BLOOM 2026-08-17 13:34 UTC) · T4a/T4b siguen 500
(el gateway sigue roto de su lado — eso es lo que se reporta al equipo).
Suite: 139/139 provider+store · completa 12 fallas = baseline · typecheck
limpio · VSIX reparcheado (19,745,668 B, md5 build≡instalado) · 3 árboles
sincronizados. Conteo total del provider: 139.
