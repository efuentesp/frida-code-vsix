# ask_user_question: componente nativo del webview (reemplaza Remote React)

**Estado:** aceptado (typecheck + build + tests verificados; demo `frida.demoWebQuestionnaire` actualizado).

**Reemplaza (parcialmente):** la decisión de la [ADR-0012](0012-frida-webview-remote-react.md)
**solo para `ask_user_question`**. Remote React (`fridaWeb`) **se mantiene** para los widgets
persistents de pie (frida-subagents / frida-workflow / frida-git-sync / todo-web, ADR-0014).

## Contexto

La ADR-0012 puso `ask_user_question` sobre Remote React: `WebQuestionnaire`
(`src/web-questionnaire.tsx`) corría en el **host** con React + `useState`, y cada
commit se serializaba a un árbol `WebNode` que el webview materializaba vía
`RemoteRoot`. Recuperaba la UI rica del TUI (tabs, opciones con descripción,
multiSelect con ☑/☐, preview side-by-side, texto libre).

**El problema:** los permisos (`ApprovalCard`) permiten **seleccionar por teclado**
(↑↓ navega, Enter confirma, Esc cancela, letras directas) porque son un componente
nativo del webview —corren en el browser, con `window` real para
`addEventListener("keydown")`. `WebQuestionnaire`, en cambio, corre en el **host**
(Node): no hay `window`, y los `useEffect`/handlers **no se serializan** a través de
`RemoteRoot` (éste proyecta solo la vista, no los side-effects). Por tanto, añadir
teclado al cuestionario era **imposible** sin cambiar de arquitectura. El usuario lo
pidió explícitamente: *"que la selección se pueda hacer también por teclado, similar
a los permisos"*.

## Decisión

Migrar `ask_user_question` a un **componente nativo del webview**
(`QuestionsPanel`), con el **mismo patrón que `ApprovalCard`/`ApprovalBridge`**:
estado + mensaje (no árbol serializado). La lógica del cuestionario (tabs, drafts,
multiSelect, preview side-by-side, texto libre) migra del host al webview; el host
solo transporta el spec y recoge el resultado.

Remote React (`fridaWeb`) **no se toca**: sigue siendo la capa para los widgets
persistentes de pie, que sí aprovechan la reactividad host-side (estado cambiante,
eventos de lifecycle). `ask_user_question` era su **único** uso con placement
`"composer"`; ese slot queda libre.

## Piezas

- **`src/questionnaire-bridge.ts`** (nuevo) — `QuestionnaireBridge extends
  DialogBridge<QuestionnaireRequest, QuestionnaireResponse>` (ADR-0006). `request()`
  publica el cuestionario y queda en `await`; `resolve()` entrega el resultado; el
  abort del turn → `cancelledResponse` (decline). Tipos `WebQuestionSpec`/
  `WebQuestionAnswer`/`WebQuestionnaireResult` viven aquí (antes en
  `web-questionnaire.tsx`).
- **`src/extension-ui-context.ts`** — nuevo `askUserQuestion(questions):
  Promise<WebQuestionnaireResult>` (envuelve `questionnaireBridge.request`).
  Reemplaza el uso de `fridaWeb(factory, "composer")` para el cuestionario.
- **`src/pi-session.ts`** — instancia `questionnaireBridge`, lo pasa al
  `ExtensionUIContext`, y expone un helper `askUserQuestion` (demo/tests).
- **`src/extension.ts`** — callback `onQuestionnaire` (publica `state.questionnaire`)
  en ambas llamadas a `createFridaSession`, y `case "questionnaire_answer"` en el
  handler (resuelve el bridge). Demo `frida.demoWebQuestionnaire` usa `s.askUserQuestion`.
- **`src/tools/ask-user-question-web.ts`** — `execute` llama `ui.askUserQuestion(raw)`
  en vez de `ui.fridaWeb(factory, "composer")`.
- **`webview/components/QuestionsPanel.tsx`** (nuevo) — componente nativo: su propio
  `useState` + `window.addEventListener("keydown")` (patrón ApprovalCard). Réplica
  de la UI (q-opt ◉/○/☑/☐, q-tabs, preview side-by-side con `Markdown`, texto libre).
- **`webview/types.ts`** — tipos del cuestionario + `State.questionnaire` + mensajes
  `questionnaire` (host→webview) y `questionnaire_answer` (webview→host).
- **`webview/App.tsx`** — renderiza `<QuestionsPanel>` en el slot del composer (como
  `ApprovalCard`), entre approvals y `composerDialogRoots`.
- **`webview/styles.css`** — `.q-opt` + `.q-opt.focused` (resaltado de teclado,
  distinto del `.selected`/`:hover`) + `.q-panel`/`.q-input`/`.q-nav`/`.q-btn`.
- **Eliminado:** `src/web-questionnaire.tsx`. El test `test/ask-question-overlay.test.ts`
  se reescribió para probar `QuestionnaireBridge` (antes inspeccionaba el árbol `WebNode`).

## Keymap (consistente con permisos)

| Tecla | Acción |
| --- | --- |
| ↑ ↓ | navegar foco entre opciones |
| ⏎ / Espacio | confirmar opción enfocada |
| 1 – 9 | selección directa |
| ← → | cambiar de pregunta (si 2+) |
| Tab | saltar al campo de texto libre |
| Shift + ⏎ | **enviar** el cuestionario |
| Esc | cancelar (por niveles: con foco+texto en el input, el 1er Esc sale del input conservando el texto; el 2º cancela) |

## Consecuencias

- **Teclado en el cuestionario** (parity con permisos), antes imposible por la
  arquitectura host-side de Remote React.
- `RemoteRoot` y el custom renderer (`react-reconciler`) **siguen en el bundle del
  host** (~500 KB), ahora justificados solo por los widgets persistentes.
- El placement `"composer"` de `WebPlacement` ya no lo usa nadie; la rama
  `composerDialogRoots` de `App.tsx` queda como dead-code defensivo (se dejó por si
  una extensión futura la usa — limpieza opcional).
- `askUserQuestion` es una extensión propia del contrato (como `fridaWeb`): las
  extensiones que la usan se acoplan a Frida. Es deliberado.
