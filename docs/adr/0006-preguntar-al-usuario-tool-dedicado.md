# Preguntar al usuario: tool dedicado nativo, no `ExtensionUIContext` general

**Estado:** aceptado.

> **Actualización (D21 / ADR-0012):** la *implementación web* migró de
> `QuestionBridge`+`QuestionCard` (puente propio + `postMessage`) a **`WebQuestionnaire`
> sobre Remote React** (`fridaWeb`): tabs, multiSelect con checkbox visual, preview
> markdown side-by-side y texto libre, con estado en el host serializado al webview.
> `QuestionBridge`/`QuestionCard`/`question-bridge.ts`/`ask-user-question.ts` fueron
> **retirados** en la limpieza. La *decisión* (tool dedicado `ask_user_question`, no
> `ExtensionUIContext` general) se mantiene; cambió solo el canal de UI. Ver D21.
>
> **Actualización (D24):** paridad con rpiv sobre cuándo mostrar el preview. (1) La
> descripción del tool + el schema TypeBox ahora guía al modelo a **no** usar
> `preview` para preguntas simples de preferencia (causa raíz: antes el modelo abusaba
> del preview). (2) El pane sigue al focus **sin fallback** — antes siempre caía a la
> primera opción con preview y mostraba algo aunque no correspondiera. (3) Gate
> `inputMode`: el preview se oculta mientras se escribe respuesta custom. Ver
> "Paridad con rpiv" abajo.

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
- **Reutiliza `ApprovalBridge`:** `QuestionBridge` tenía la misma forma que
  `ApprovalBridge` (Map de pendientes + emisión de cambios). Tras el refactor
  posterior ambos extienden `DialogBridge<TReq, TResp>` (`src/dialog-bridge.ts`) —ver
  "Patrón reutilizable" y "Post-MVP resuelto".
- **MVP frente a fidelidad:** el MVP cubre 1-4 preguntas, 2-4 opciones cada una,
  `multiSelect`, texto libre por pregunta y nota opcional. Los items Post-MVP diferidos
  ya están implementados (ver "Post-MVP resuelto" abajo): validación runtime exhaustiva
  - reserved labels, previews markdown en la UI, pestañas tipo rpiv + Submit/Review, y
  el refactor `DialogBridge<T>`. Queda pendiente: i18n.
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
- **Patrón reutilizable (resuelto):** el mismo race+limpieza se aplicó a
  `ApprovalBridge` (resuelve como `reject` al abortar), cerrando su riesgo latente
  simétrico. La generalización ya está hecha: `QuestionBridge` y `ApprovalBridge`
  extienden una clase base abstracta `DialogBridge<TReq, TResp>`
  (`src/dialog-bridge.ts`) que concentra el Map de pendientes + el race con el
  `AbortSignal` + la emisión de cambios; cada subclase solo aporta su
  `cancelledResponse(id)` (reject / cancelled). Añadir un tercer tipo de diálogo es
  ahora una clase de pocas líneas.
- **Punto frágil a regresar en cada bump de Pi** (junto a los de D12): la firma de
  `registerTool` (`promptSnippet`, `execute(toolCallId, ...)`) y el TypeBox
  `{minItems,maxItems}` del schema, que es lo que ve el modelo.

## Post-MVP resuelto

Los items que la sección "Consecuencias" difería como reversibles ya están
implementados (código propio en `src/`/`webview/`, sin reabrir ADRs). Estado:

| Item | Archivos | Estado |
| --- | --- | --- |
| Validación runtime exhaustiva + reserved labels + echo de preview | `src/tools/types.ts`, `src/tools/validate.ts`, `src/tools/ask-user-question-web.ts` | ✅ |
| Previews markdown en la UI (side-by-side en single-select; apilado en panel estrecho) | `src/web-questionnaire.tsx` (Remote React) | ✅ |
| Refactor `DialogBridge<T>` (base común de `ApprovalBridge`/`QuestionBridge`) | `src/dialog-bridge.ts`, `src/{approval,question}-bridge.ts` | ✅ |
| Pestañas tipo rpiv + Submit/Review (multregunta tabbed; layout simple para 1 pregunta) | `src/web-questionnaire.tsx` (Remote React) | ✅ |
| i18n | — | ⬜ pendiente |

Notas de implementación:

- **Reserved labels:** `RESERVED_LABELS` (`Otro`, `Escribe algo`, `Type something.`,
  `Other`, `Next`, `Siguiente`) se rechazan en runtime desde `validate.ts`, no como
  mera convención del prompt. `reserved_label` se cortocircuita antes de
  `duplicate_option_label`.
- **Echo de preview:** el HOST resuelve el markdown de la opción elegida desde
  `params.questions` y lo devuelve al modelo en el envelope (paridad rpiv).
- **Previews en la UI:** solo single-select (paridad rpiv); el pane sigue al
  hover/foco de la opción **sin fallback** — si la opción enfocada no trae `preview`, el
  pane queda vacío ("Vista previa no disponible") en vez de mostrar el de otra opción.
  Además se oculta mientras el usuario escribe respuesta custom (gate `inputMode`).
  Ver "Paridad con rpiv" abajo.
- **Abort del turn:** sigue residiendo en `DialogBridge.request(id, signal)` (ver
  arriba); las subclases no lo reimplantan.

## Paridad con rpiv: cuándo mostrar el preview (D24)

Revisión de `@juicesharp/rpiv-ask-user-question` reveló que `WebQuestionnaire`
mostraba el preview **siempre**, a diferencia de rpiv. Tres correcciones alinean el
comportamiento (código: `src/web-questionnaire.tsx`, `src/tools/ask-user-question-web.ts`):

1. **Guía del tool + schema (causa raíz).** La descripción del tool y el campo
   `options[].preview` del schema TypeBox ahora dicen explícitamente *"úsalo SOLO para
   artefactos concretos a comparar (mockups/código/diagramas/configs); NO para preguntas
   simples de preferencia donde label+description bastan"*. rpiv lo dice en su
   descripción; el tool de Frida lo omitía y el modelo abusaba del preview.
2. **Sin fallback agresivo.** `activePreviewOpt` ya no cae a la primera opción con
   `preview`. El pane sigue al focus (hover > selección); si la opción enfocada no
   trae `preview`, queda vacío (`NO_PREVIEW_TEXT` de rpiv: *"Vista previa no
   disponible"*). Antes Frida "inventaba" un preview de otra opción.
3. **Gate `inputMode`.** Mientras el usuario escribe respuesta custom
   (`customText[tab]` no vacío), el preview side-by-side se oculta y opciones+input
   toman ancho completo. rpiv hace lo mismo (`PreviewPane.render`:
   `if (inputMode) return optionList.render(width)`): el preview es irrelevante al
   teclear la propia respuesta.

rpiv oculta además el pane en `multiSelect` y cuando **ninguna** opción trae
`preview` (`!hasAnyPreview()`) — ambos casos ya cubiertos por `hasPreviews`. El gate
de ancho de rpiv (≥100 cols → side-by-side, si no stacked) no aplica: el webview es
flexible y no tiene restricción de columnas de terminal.
