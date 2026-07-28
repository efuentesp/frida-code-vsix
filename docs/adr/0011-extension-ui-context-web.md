# ExtensionUIContext web: el mismo mecanismo de extensión del TUI en el webview

**Estado:** aceptado.

Frida implementa el slice **data-oriented** del `ExtensionUIContext` del SDK (`pi.ui.select` /
`input` / `confirm` / `notify`) y lo inyecta vía `session.bindExtensions({ uiContext, mode: "rpc" })`.
Así, las **extensiones nativas de pi que respetan el patrón RPC** funcionan en el webview **sin
modificaciones**, usando diálogos (`select`/`input`) en vez de la factory Ink del TUI.

## Razón

El SDK de pi ya separa "qué pide la extensión" de "cómo lo muestra el cliente": el **modo RPC**
(`rpc-mode.js`) implementa `ExtensionUIContext` enrutando `select`/`confirm`/`input` por un canal
(`extension_ui_request`) en vez de renderizarlos en el terminal. La extensión nativa
`@juicesharp/rpiv-ask-user-question` ya explota esto: si `ctx.mode === "rpc"` y
`hasDialogUI(ctx.ui)` (≈ `select` + `input` son funciones), camina las preguntas con
`runRpcQuestionnaire(ctx.ui, …)` y produce el mismo `QuestionnaireResult` que el TUI.

El cableado es limpio: `AgentSession.bindExtensions({ uiContext, mode })` fija `pi.ui`, `pi.mode` y
`pi.hasUI()` para todas las extensiones. Frida antes **no llamaba** `bindExtensions` → `pi.ui` era
no-op → las extensiones que usaban diálogos no funcionaban.

## Decisión

- **`src/ui-bridge.ts`** — `UiBridge extends DialogBridge<UiRequest, UiResponse>`: el patrón
  reutilizable (Map de pendientes + race con el `AbortSignal` del turn + emisión al webview). El
  contrato mínimo que `hasDialogUI` exige: `select(title, options)` + `input(title, placeholder)`.
- **`src/extension-ui-context.ts`** — `createFridaUiContext(bridge, onNotify)`: implementa
  `select`/`input`/`confirm`/`editor` (data-oriented) y deja como **no-op** las factories Ink
  (`setFooter`/`setHeader`/`setWidget(factory)`/`custom`). `custom()` resuelve `undefined` a
  propósito: es el **backstop** que rpiv usa para caer al dialog walker cuando el host no renderiza
  la overlay Ink (issue #78 de rpiv).
- **Cableado** (`pi-session.ts`): tras `createAgentSession`, `await session.bindExtensions({ uiContext,
  mode: "rpc" })`.
- **Host** (`extension.ts`): publica `ui_requests`/`ui_notify` al webview; recibe `ui_response` →
  `uiBridge.resolve`.
- **Webview**: `UiDialog.tsx` (select/input/confirm), estado `uiRequests` en el store.
- **`rpiv-ask-user-question`** se instala en `~/.frida/npm` y se declara en
  `settings.json` → el resourceLoader la carga con jiti. Funciona **sin tocarla**.

## ask-user-question propio: transición

Mientras se confirma que `rpiv-ask-user-question` carga en el runtime de Frida, el
`ask-user-question` **empotrado** (factoría inline) se mantiene como **fallback**: se desactiva
automáticamente (`!rpivAskPresent`) cuando rpiv está instalada en `~/.frida`, para evitar duplicar
el tool `ask_user_question`. Una vez confirmado rpiv, se elimina el empotrado
(`src/tools/ask-user-question.ts`, `src/question-bridge.ts`, 464 líneas).

## Lo que NO se porta (factories Ink)

`setFooter`/`setHeader`/`setWidget(factory)`/`custom(factory)` y `renderCall`/`renderResult` de los
tools reciben factories de **componentes Ink** (`(tui, theme) => Component`). Ink = React para
terminal; el webview = React para navegador. Son modelos de UI incompatibles. Frida las deja como
no-op (igual que el modo RPC del propio SDK). Para replicar esa extensibilidad visual habría que
definir un **contrato nuevo de componentes web registrables** (no existe; fuera de alcance).

## Consecuencias

- Cualquier extensión nativa de pi que use `ctx.ui.select/input/confirm` funciona en Frida
  automáticamente (mecanismo estándar, no puente ad-hoc).
- Trade-offs del camino RPC (documentados por rpiv): sin preview side-by-side (se pliegan al título
  del `select`), sin tabs multi-pregunta (un diálogo por pregunta), multi-select como texto `"1,3"`.
- La UI rica de `QuestionCard` (previews/tabs) se conserva para el `ask_user_question` empotrado
  mientras exista; al eliminarlo, se pierde a favor del diálogo secuencial del patrón RPC.
