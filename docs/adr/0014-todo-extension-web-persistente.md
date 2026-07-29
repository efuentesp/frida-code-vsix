# Tool `todo` como extensión web persistente (Remote React)

**Estado:** aceptado.

El tool `todo` deja de ser un porte **nativo** inline (`src/tools/todo/todo.ts` +
panel nativo del webview + conducto `post {type:"todos"}`) y pasa a ser una
**extensión** con UI en **frida-webview (Remote React persistente)**, reescrita a
partir de la extensión `rpiv-todo` de pi pero con UI web en vez del overlay Ink.
Es la segunda extensión web de Frida (después de `ask_user_question`, ADR-0012) y la
**primera con UI persistente** (no diálogo).

## Contexto

Hasta aquí, el `todo` era un porte simplificado de `rpiv-todo`:

- **Tool** nativo: factory inline en `pi-session.ts` (`createTodoTool`), lógica en
  `src/tools/todo/` (~675 líneas: `state-reducer`, `types`, `replay`,
  `response-envelope`, `task-graph`, `invariants`).
- **Estado**: holder mudo en `src/todo-state.ts` (1 sesión).
- **UI**: `webview/components/TodoPanel.tsx`, un **panel nativo del webview** que leía
  `state.todos` del store.
- **Publicación**: el host leía `getTodoState()` y posteaba `{type:"todos"}` desde
  `postTodos()` al crear/abrir sesión y tras cada `tool_execution_end` del tool.

La extensión original de pi (`npm:@juicesharp/rpiv-todo`) registra tool + `/todos` +
**`TodoOverlay` widget** (UI pi-tui vía `setWidget(..., {placement:"aboveEditor"})`),
estado keyed por sid, replay en session_start/compact/tree, dispose en shutdown.

## El problema central: diálogo ≠ persistente

`ask_user_question` (ADR-0012) usa `fridaWeb(factory)` = `WebBridge.render()`, que
**bloquea hasta `done(result)`** — patrón **diálogo efímero**: monta, interactúa,
desmonta, devuelve.

El `todo` necesita **UI persistente**: el panel vive toda la sesión, el `execute`
del tool **no bloquea** (muta y retorna), y la UI debe **re-renderizar tras cada
mutation**. El patrón diálogo **no aplica**.

## Decisión

Remote React **persistente** vía una variante nueva del `WebBridge`, con un **store
reactivo** que comparten el tool (muta) y el componente (se suscribe). Inline en
`src/` (no extensión externa — paridad con D21).

### 1. `WebBridge.mountPersistent(factory): { unmount }`

Como `render()` pero **sin Promise/`done()`**: crea el `WebRenderer`, lo registra en
el Map, monta y devuelve un handle para desmontar. El `WebRenderer` ya soportaba vida
persistente (el `done()` era lógica del puente, no del reconciler); sólo faltaba el
método no-bloqueante.

### 2. Store reactivo + `useSyncExternalStore`

`src/tools/todo-web/store.ts` sucede a `todo-state.ts`: misma API
(`getTodoState`/`setTodoState`/`resetTodoState`) + `subscribeTodoState`.
`setTodoState` **emite** a los oyentes. El componente `<TodoWebPanel>` consume el
estado con `useSyncExternalStore(subscribe, getTodoState)` y se re-renderiza solo ante
cada mutation → el reconciler serializa el nuevo commit → el webview actualiza. El
host **no publica nada** (el conducto `postTodos` quedó obsoleto).

### 3. `WebBridge.republish()` + handshake `webview_ready`

Al recargar el webview (cambio de pestaña, reabrir panel, reload window) éste pierde
su estado. Los roots persistentes ya montados **no reciben un `session_start` nuevo**
(sesión existente), así que sin re-publicación el panel quedaría vacío. El
`WebBridge` ahora cachea el último árbol por rootId (`lastTrees`) y expone
`republish()`; el host lo llama en `case "webview_ready"` tras `bootstrapSession()`.

### 4. Eventos de la extensión (paridad conceptual con rpiv-todo)

`createTodoWeb()` registra el tool (reusa `state-reducer`/`response-envelope`/`types`/
`replay`) y se engancha a:

- `session_start`: `resetTodoState` + replay desde `ctx.sessionManager.getBranch()` +
  montar el panel vía `fridaWebMount` si hay UI.
- `session_compact`: replay (la rama cambió tras compactar) + reset del display state.
- `session_shutdown`: `unmount` del panel + `resetTodoState`.
- `agent_start`: **oculta las tareas completadas de turnos anteriores** (paridad
  con rpiv-todo `hideCompletedTasksFromPreviousTurn`) — al iniciar un nuevo turno,
  las que ya están `completed` pasan a un `hiddenIds` en el store (display state);
  las que se completen en el turno actual se muestran hasta el siguiente
  `agent_start`. Una tarea descompletada vuelve a verse (el filtro exige
  `status==="completed" && hiddenIds.has(id)`). Reduce ruido sin perder datos (las
  tareas siguen en el TaskState; `/todos` y el replay las ven todas).

El `execute` del tool muta el store (`setTodoState` emite → el panel re-renderiza).

## Qué se eliminó / reutilizó

- **Eliminado:** `src/tools/todo/todo.ts` (factory vieja), `src/todo-state.ts`,
  `webview/components/TodoPanel.tsx`, `postTodos()` + conducto `{type:"todos"}`,
  tipos/estado/reducer `todos` del webview, CSS `.todo-*`.
- **Reutilizado (intacto):** `state-reducer`, `types`, `replay`, `response-envelope`,
  `task-graph`, `invariants` — son puros y agnósticos al holder.
- **Preservado:** el comando `/todos` del composer (`postTodosCommand` en
  `extension.ts`) ahora lee del nuevo store (`todo-web/store`).

## Por qué inline (no externa en `~/.frida/npm`)

Mismo razonamiento que D21: `react` + `react-reconciler` (~500 KB) viven en el bundle
del host, y `useSyncExternalStore` exige el **mismo** React que el reconciler. Una
extensión externa necesitaría React inyectado vía `make(React)` + pragma. Complejidad
alta, ahorro de vsix nulo → factory inline en `src/tools/todo-web/`.

## Placement: footer vs overlay (y coexistencia de roots)

El panel del todo **vive en el footer** del webview (entre la barra de progreso y
el Composer), no como overlay en el cuerpo — paridad visual con el `TodoPanel`
nativo que reemplaza y con el overlay `aboveEditor` de rpiv-todo. El cuestionario
de `ask_user_question` **también** va al footer (consistencia: las UIs de
extensión conviven en el footer, no flotando en el cuerpo).

Esto exigió distinguir **dónde** materializa el webview cada root remoto, y
coleccionar **varios** roots a la vez (antes `state.webRoot` era un solo objeto;
cada commit lo pisaba, así que un panel persistente + un diálogo simultáneo se
habrían pisado):

- **`WebPlacement`** (`src/web-protocol.ts`): `"overlay"` (cuerpo) | `"footer"`
  (panel inferior). Viaja en cada `WebCommitMessage`. En producción hoy ambos
  (`todo` y `ask_user_question`) usan `"footer"`; `"overlay"` queda para los demos.
- **`WebBridge.render(factory, placement)`** (diálogos efímeros) y
  `mountPersistent(factory, placement)` (paneles) **ambos** aceptan la zona;
  `lastTrees`/`republish()` la propagan para que la recarga del webview
  re-publicque cada root en su zona.
- **Webview**: `webRoot` → `webRoots: Record<rootId, {tree, placement}>`; el
  reducer hace upsert/elimina por rootId (coexisten).
- **`App.tsx`** particiona por placement: los `"overlay"` se renderizan en el
  cuerpo, los `"footer"` en el footer dentro de un `.web-footer` (marco de panel,
  auto-oculto con `:empty`, `max-height:60vh` + scroll para UIs altas como el
  cuestionario).

El `todo-web` monta con `placement: "footer"`; `ask_user_question` pasa
`"footer"` a `fridaWeb`.

## Consecuencias

- **Una sola fuente de verdad**: el store reactivo. El host ya no orquesta la
  publicación del estado del todo — la extensión es autónoma (muta + notifica + monta).
- **`mountPersistent`/`republish` son infraestructura reusable**: cualquier panel de
  extensión que viva toda la sesión puede usarlas (no sólo el todo).
- **Snapshot completo por commit** (no diffing, ver ADR-0012): suficiente para un
  panel chico; si una UI grande parpadea, migrar a diffing incremental.
- **`frida.demoWebPersistent`** queda como validación del patrón (timer + botón +
  `useSyncExternalStore`), útil para diagnosticar futuros paneles persistentes.

## Riesgos cubiertos

- **Recarga del webview**: `republish()` en `webview_ready` re-publica los roots.
- **Reconciler reactivo**: validado aislado con el demo antes de tocar el todo.
- **/todos y replay**: el comando lee del nuevo store y se publica como **mensaje
  del sistema** (`notice`) directamente en la conversación (bloque multiline con
  scroll, persiste), no en el info-bar de una línea — paridad con rpiv-todo y con
  espacio para listas largas. replay en session_start/compact como antes.
- **Race condition en `ensureSession`** (bug preexistente que el panel persistente
  expuso): si se la llamaba concurrentemente, ambas veían `!frida` y creaban dos
  sesiones — la perdedora se perdía sin dispose y su `WebBridge` vivía publicando
  roots al webview para siempre (paneles duplicados). Arreglado con una **Promise
  cacheada** (`fridaPromise`): las llamadas concurrentes esperan la misma promesa.
- **`dispose()` del SDK no emite `session_shutdown`**: los paneles persistentes no
  se desmontan solos al rotar sesión (new/switch). Arreglado con
  **`WebBridge.dispose()`** (desmonta todos los roots + limpia el caché), llamado
  en `newSession`/`switchSession` antes de soltar la referencia. Antes no se notaba
  porque el `TodoPanel` nativo leía de un único holder de módulo.

## Referencias

- [ADR-0012](./0012-frida-webview-remote-react.md) — Remote React (diálogo efímero);
  `ask_user_question` como primera extensión web.
- [ADR-0006](./0006-preguntar-al-usuario-tool-dedicado.md) — patrón de extensión web.
- `src/web-bridge.ts` — `mountPersistent` + `republish` + `lastTrees`.
- `src/tools/todo-web/` — `store` (reactivo), `todo-web` (componente), `index`
  (factory + eventos).
- `rpiv-todo` en `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo` — referencia
  original (overlay Ink + estado keyed por sid).
