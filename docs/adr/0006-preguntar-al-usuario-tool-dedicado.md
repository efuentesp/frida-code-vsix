# Preguntar al usuario: tool dedicado nativo, no `ExtensionUIContext` general

**Estado:** aceptado.

Damos al modelo una herramienta `ask_user_question` —equivalente en **idea** a
`@juicesharp/rpiv-ask-user-question`— para que, ante una decisión real (estrategia,
alcance, convención), **pregunte con opciones concretas** en el panel en vez de
adivinar. La implementamos como **extensión de Pi propia de Frida** (factory inline en
`src/`, registrada en `DefaultResourceLoader.extensionFactories`) que habla con el
webview por un puente `QuestionBridge` análogo al `ApprovalBridge` de los gates (D7).

Decisión de costura: **no** activamos el `ExtensionUIContext` de Pi
(`session.extensionRunner.setUIContext(ctx, "rpc")`). Nuestro tool **no** usa
`ctx.ui.select/confirm/input`; llama directo al puente, igual que el gate de `bash`
hoy. Consecuencia inmediata: el host sigue reportando `ctx.mode = "print"` y
`ctx.hasUI = false`, y eso **no nos afecta**, porque no dependemos de esa vía.

## Opciones consideradas

- **(A) Tool dedicado nativo vía puente propio.** Elegida. Reutiliza el patrón
  `ApprovalBridge`/`ApprovalCard` ya probado (D7): el `execute` del tool queda en
  `await` sobre `QuestionBridge.request(id)`, el webview renderiza una `QuestionCard`
  y responde por `postMessage`; el handler del host resuelve la promesa. Coste
  bajo-medio; costura específica a este consumidor.

- **(B) Implementar `ExtensionUIContext` general + `setUIContext(ctx, "rpc")`.**
  Descartada por ahora. Haría funcionar `ctx.ui.select/confirm/input/editor/notify/
  setStatus/setWidget` para **cualquier** extensión Pi. Superficie grande y, con
  descubrimiento abierto (ADR-0005), cualquier extensión ajena en
  `~/.pi/agent/extensions/` ganaría de golpe un canal de interacción con el dev.
  Prematura: hoy solo hay un consumidor de "preguntar al usuario". *(Una costura
  general se justifica con dos adapters reales, no con uno hipotético.)*

- **(C) Cargar `@juicesharp/rpiv-ask-user-question` por descubrimiento.** Descartada.
  Su diálogo rico es TUI propia (no aplica a un host embebido que no es terminal) y
  cargaría una extensión ajena con descubrimiento libre —reabre ADR-0005.

## Consecuencias

- **No reabre ADR-0005:** el tool es código de Frida (`src/`), cargado como
  `extensionFactory`, no una extensión ajena descubierta. El §7 de `CONTEXT.md`
  ("extensiones ajenas con allowlist curado") no aplica.
- **No activa `ctx.ui` general:** el riesgo de que extensiones no previstas pidan
  diálogos no se materializa.
- **Reutiliza `ApprovalBridge`:** `QuestionBridge` tiene la misma forma que
  `ApprovalBridge` (Map de pendientes + emisión de cambios). En el MVP se implementan
  por separado; al ser ya dos adapters reales, la generalización a un `DialogBridge<T>`
  común está justificada y se deja como refactor posterior (ver punto siguiente).
- **MVP frente a fidelidad:** el MVP cubre 1-4 preguntas, 2-4 opciones cada una,
  `multiSelect`, texto libre por pregunta y nota opcional. Quedan diferidos
  (convenidos como reversibles): previews markdown, pestañas tipo rpiv, reserved
  labels (`Other`/`Type something.`/`Next`), i18n.
- **Abort del turn (decisión A, resuelta):** el `execute` de un tool recibe
  `signal: AbortSignal`. Pi **no** hace `Promise.race` con él
  (`pi-agent-core/agent-loop.js`: el corte `if (signal?.aborted) break` corre solo
  *después* de que el tool termine), así que si el tool no escucha el signal y queda en
  `await`, el agent loop se cuelga. Por eso el patrón "race con signal + resolución
  como `cancelled`" vive **dentro del puente** (`QuestionBridge.request(id, signal)`),
  no en cada `execute`: al abortar se resuelve `{ cancelled: true }`, el puente elimina
  la entrada pendiente y emite `onChange`, y la tarjeta desaparece del webview por el
  mismo conducto que los approvals (post de `questions: []`). Semántica de
  "declinación", no de error. No vale escuchar `turn_end`/`agent_end` para esto: con
  el tool colgado esos eventos no llegan a emitirse.
- **Patrón reutilizable (costura diferida):** el mismo race+limpieza se aplicó a
  `ApprovalBridge` (resuelve como `reject` al abortar), cerrando su riesgo latente
  simétrico. Ahora `QuestionBridge` y `ApprovalBridge` comparten la misma forma (Map de
  pendientes + emisión de cambios + race con signal); al ser dos adapters reales, la
  generalización a un `DialogBridge<T>` común está justificada y queda como refactor
  posterior.
- **Punto frágil a regresar en cada bump de Pi** (junto a los de D12): la firma de
  `registerTool` (`promptSnippet`, `execute(toolCallId, ...)`) y el TypeBox
  `{minItems,maxItems}` del schema, que es lo que ve el modelo.
