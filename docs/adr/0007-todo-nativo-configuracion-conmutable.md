# Lista de tareas (`todo`) nativa + Configuración conmutable

**Estado:** aceptado.

Damos al modelo una herramienta `todo` —equivalente en **idea** a
`@juicesharp/rpiv-todo`— para que planee y siga trabajo multi-paso, y mostramos
esa lista en el panel (no en el editor). La implementamos como **extensión de Pi
propia de Frida** (porte de la lógica de rpiv-todo a `src/tools/todo/`, registrada
como factory inline en `DefaultResourceLoader.extensionFactories`), con un panel
`TodoPanel` en el webview en lugar del overlay TUI (`setWidget`) que usa rpiv-todo.
Y añadimos una **Configuración** (settings de VS Code ↔ webview) que activa y
desactiva este tool y `ask_user_question` (D14) en caliente, sin reabrir
[ADR-0005](./0005-descubrimiento-de-recursos-abierto.md).

La máquina de estados (`pending → in_progress → completed`, más `deleted` como
tombstone), el reducer puro, la validación de `blockedBy` (transiciones, dependencias
colgantes, auto-bloqueos, ciclos) y el **replay desde la rama** son porte directo de
rpiv-todo (MIT, con atribución). El replay reutiliza el hecho de que cada llamada
exitosa al tool devuelve el snapshot completo en `details`; al crear/abrir sesión se
reconstruye el estado desde el último `toolResult` con `toolName === "todo"` —sin
escribir a disco—, así la lista sobrevive a recarga, switch de sesión y compaction.

Decisión de costura: **no** hay puente bloqueante. A diferencia de `ask_user_question`
(ADR-0006), el tool `todo` **no** espera respuesta del usuario: el `execute` muta el
holder en memoria (`src/todo-state.ts`) y devuelve el envelope; el host publica el
estado al webview desde `tool_execution_end` (canal unidireccional host→webview). Más
simple que un `DialogBridge`.

Decisión de costura sobre la UI: el overlay TUI de rpiv-todo (`ctx.ui.setWidget`,
`aboveEditor`) **no aplica** en Frida, porque el host corre en `ctx.mode="print"` /
`hasUI=false` (ADR-0006) y el "editor" es un webview. El panel equivalente se
renderiza en el webview (`TodoPanel`), fijo arriba del transcript y auto-oculto si la
lista está vacía.

## Opciones consideradas

- **(A) Portear la lógica a `src/` + panel propio en el webview + Configuración.**
  Elegida. Consistente con cómo se hizo `ask_user_question` (ADR-0006: código propio,
  no extensión ajena descubierta — no reabre ADR-0005). Sin arrastrar dependencias de
  `@earendil-works/pi-tui` (que el overlay usaría) ni de `@juicesharp/rpiv-config` /
  `rpiv-i18n`. La Configuración (toggles) reutiliza el `/reload` existente para aplicar
  el cambio en caliente.

- **(B) Depender del paquete npm `@juicesharp/rpiv-todo` como factory inline.**
  Descartada. Aunque meter su `default` export en `extensionFactories` no es
  descubrimiento libre (es inline explícito, como el resto), arrastraría `pi-tui`,
  `rpiv-config` y `rpiv-i18n` (peer opcional) al `.vsix` y, sobre todo, su overlay TUI
  importaría/correría código de terminal que aquí no renderiza (`hasUI=false`). Rompe la
  simetría con `ask_user_question` (que se portó, no se dependió) y ensancha la
  superficie de ADR-0004.

- **(C) Activar `ExtensionUIContext` general + `setWidget`.** Descartada por las
  mismas razones que la opción (B) de ADR-0006: superficie grande y, con
  descubrimiento abierto (ADR-0005), cualquier extensión ajena ganaría un canal de
  interacción con el dev. Prematura.

## Consecuencias

- **No reabre ADR-0005:** el tool es código de Frida (`src/`), cargado como
  `extensionFactory`, no una extensión ajena descubierta. El §7 de `CONTEXT.md`
  ("extensiones ajenas con allowlist curado") no aplica.
- **Persistencia sin disco:** el `details` de cada `toolResult` "todo" es el snapshot
  de replay; `replayFromBranch` lo reconstruye en `createFridaSession` (y al switch).
  No hay archivo de estado de tareas. El estado vivo vive solo en memoria del proceso
  (`src/todo-state.ts`).
- **Una sesión activa:** a diferencia de rpiv-todo (que keyed por `sid` por tener
  sesiones foreground/child paralelas en la TUI), Frida orquesta UNA sesión conmutada
  por `switchSession`. El holder es un singleton de módulo; `resetTodoState()` +
  `replayFromBranch` al crear/abrir garantizan el punto de partida correcto.
- **Configuración conmutable, fuente única:** los settings de VS Code
  (`frida.todo.enabled`, `frida.askUserQuestion.enabled`) son la fuente de verdad de
  **intención**; las factories los leen vía getters (`toggleable(getEnabled, factory)`).
  Un cambio persiste el setting y dispara `session.reload()`, que re-ejecuta las
  factories y re-evalúa los getters → el tool aparece/desaparece **sin perder el
  historial** (el estado de `todo` se recupera por replay). El panel se oculta cuando
  el toggle está apagado, aunque haya tareas en el historial.
- **Aplicación no instantánea si el agente responde:** el `/reload` (y por tanto la
  aplicación de un toggle) espera a que termine el streaming, igual que el `/reload`
  manual (D12). El setting queda persistido y se aplica en la siguiente recarga/sesión.
  Trade-off aceptado por consistencia con `/reload`.
- **`StringEnum` evitado:** el schema del tool usa `Type.Union([Type.Literal(...)])`
  en lugar de `StringEnum` de `@earendil-works/pi-ai`, porque este último es una
  dependencia anidada no expuesta por el SDK. Genera el mismo JSON `enum` que ve el
  modelo.
- **Punto frágil a regresar en cada bump de Pi** (junto a los de D12 y ADR-0006): la
  firma de `registerTool` (`promptSnippet`, `promptGuidelines`, `execute`), el TypeBox
  del schema, y la clave `toolName === "todo"` como filtro de replay (no renombrar).
