# ADR-1003 — Erratas 7–11: dual-endpoint, reasoning y canales laterales

**Estado:** Aceptada · **Fecha:** 2026-08-16 · **Relaciona:** ADR-1001 (provider frida-enterprise), ADR-1002 original (adaptador)

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
