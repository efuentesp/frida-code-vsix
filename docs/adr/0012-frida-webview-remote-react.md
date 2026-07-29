# frida-webview: Remote React para UI rica de extensiones (opción A)

**Estado:** aceptado (demo validado end-to-end).

Frida implementa **Remote React**: las extensiones escriben UI con **JSX + React + estado** que
corre en el **host**, y un custom renderer (`react-reconciler`) **serializa** cada commit a un árbol
que el **webview materializa**. Así una extensión puede tener UI rica e interactiva (estado,
re-render reactivo) sin reescribir el modelo de ejecución de pi-tui, y **sin cargar React en el
webview para cada extensión** (el espejo es genérico).

Es la **opción A** del análisis de extensibilidad web (frente a B = extensión-en-webview,
descartada por requerir dividir cada extensión; y C = declarativo, descartada por gestión manual
de estado). Ver `CONTEXT.md` D19 para el contexto y `0011` para el `ExtensionUIContext` base.

## Razón

El contrato `pi.ui.custom(factory)` del SDK devuelve un `Component` de **pi-tui** (framework TUI
propio, no React). No se puede reusar para UI React. Para que las extensiones puedan escribir UI
web rica, Frida añade un **canal propio** `pi.ui.fridaWeb(factory)` que:

1. La factory devuelve un `ReactElement` (JSX con tags de `frida-webview`: `fbox`, `ftext`,
   `fbutton`, …). **Corre en el host** → tiene acceso a Node APIs y a `useState`/`useEffect`.
2. Un custom renderer (`react-reconciler`) monta el elemento en el host; las "instancias" son
   `WebNode` (`{type, props, children}`), **no DOM**.
3. En cada commit, el árbol se serializa (los handlers → IDs en una tabla) y se publica al webview
   (`web_commit`).
4. El webview (`RemoteRoot`) materializa el árbol en DOM (`fbox→div`, `fbutton→button`…). Los
   eventos disparan `web_event{handlerId}` → el host ejecuta el handler → React re-renderiza →
   nuevo commit.

## Decisión / piezas

- **`src/web-protocol.ts`** — `WebNode`, mensajes `web_commit` / `web_event`.
- **`src/frida-webview/index.ts`** — catálogo de tags intrinsic (`fbox`/`ftext`/`fbutton`/
  `finput`/`fselect`) tipados vía `declare global JSX.IntrinsicElements`. Tags lowercase con guion
  (exigencia de JSX para intrinsic).
- **`src/web-renderer.ts`** — custom renderer `react-reconciler` 0.29.2 (LegacyRoot, mutation mode).
  `createWebRenderer(rootElement, send)`. Serializa snapshots completos por commit (el diffing
  incremental es mejora futura).
- **`src/web-bridge.ts`** — `WebBridge`: `Map<rootId, WebRenderer>`, `render(factory)` devuelve una
  promesa que resuelve al llamar `done(result)`, `fireEvent` enruta los eventos del webview.
- **`src/extension-ui-context.ts`** — `fridaWeb(factory)` añadido al `ExtensionUIContext` (no es
  parte del contrato del SDK; las extensiones web lo usan vía cast).
- **`webview/components/RemoteRoot.tsx`** — espejo: materializa `WebNode` → DOM, envuelve
  handlerIds en `web_event`.
- **`src/demo/web-demo.tsx`** + comando `frida.demoWebReact` — contador interactivo con `useState`
  que valida el ciclo completo.

## Gotcha crítico: children en props (FiberNode circular)

React pasa los children **dos veces** a un host config: dentro de `props.children` (como elementos
React con `_owner: FiberNode`) **y** por separado vía `appendChild`. Si `createInstance` copia
`props` enteros, el árbol serializado arrastra `FiberNode` → `JSON.stringify` del `web_commit`
choca con la estructura circular (`_owner → props → children → _owner`).

**Solución**: `createInstance` y `commitUpdate` **excluyen `children`** de los props serializados
(`const { children, ...rest } = props`). Los children se gestionan exclusivamente vía
`appendChild`/`appendInitialChild` y viven en `instance.children`. Este es el bug clásico de los
custom renderers y debe mantenerse al extender el host config.

## Lo que NO cubre (todavía)

- **Catálogo**: `fbox`/`ftext`/`fbutton`/`finput`/`fselect`/`fmarkdown`. Este último se
  añadió reusando el renderer del webview (`react-markdown` + gfm + highlight), y habilita
  **previews markdown side-by-side** en opciones single-select. A `fbox` se le añadió prop
  `flex` para layouts de columnas y **event handlers** (`onMouseEnter`/`onMouseLeave`):
  la serialización de handlers es **genérica** (cualquier prop función → `h#N` en
  `web-renderer.ts:71`), así que `fbutton` los hereda vía `domProps` y `fbox` vía
  `pickEventHandlers` (filtra claves `on*` para no pisar el `style` de layout).
  `WebQuestionnaire` los usa para **preview-en-hover** (prioridad hover > selección >
  primera; `onMouseLeave` en el contenedor vuelve a la selección). Falta `SelectList`
  rica, `Image`, `Editor` (queda como `<textarea>` salvo vim-mode).
- **Snapshot completo por commit** (no diffing). Suficiente para UIs de extensión (pequeñas); si una
  UI grande parpadea, migrar a diffing incremental.
- **`ask_user_question` reimplementado sobre fridaWeb** (`src/web-questionnaire.tsx`, D21):
  recupera la UI rica del TUI (tabs, opciones con descripción, **multiSelect con checkbox
  visual ☑/☐**, **preview side-by-side**, texto libre). Reemplazó a `QuestionBridge`/
  `QuestionCard` y al modo RPC de rpiv (que se desactivó). El bug `rpivAskPresent` (detección
  por directorio vs. `settings.json`) dejó el tool fuera del request hasta su fix.

## Consecuencias

- Las extensiones pueden escribir UI web rica con React + estado, igual que escribirían UI Ink para
  el TUI, pero para el navegador.
- React + react-reconciler viven en el **bundle del host** (+~500 KB). Aceptado a cambio de la
  ergonomía de JSX/reactividad.
- `fridaWeb` es una extensión propia del contrato (no del SDK): las extensiones que la usan se
  acoplan a Frida (no son portables al CLI pi tal cual). Es deliberado: es la capa web de Frida.
