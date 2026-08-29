---
date: 2026-08-28T18:01:10-0600
author: Edgar F. Fuentes Perea
commit: abb1640
branch: main
repository: frida-code
topic: "Comandos slash + cards de inicio para los patrones de la Pista M"
tags: [research, codebase, pista-m, slash-commands, welcome, register-command, send-user-message, frida-app-walkthrough, frida-understand-app, frida-size-app, frida-extensible-workflows, starter-cards]
status: ready
last_updated: 2026-08-28T18:01:10-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Research: Comandos slash + cards de inicio para los patrones de la Pista M

## Research Question

Tres handlers por-pack: cada factory (`createFridaAppWalkthrough` / `createFridaUnderstandApp` / `createFridaSizeApp`) registra su `pi.registerCommand` en el setup que hoy recibe `_pi` sin usar; el handler hace QuickPicks `vscode.window` por los args requeridos del patrón y envía el mensaje de lanzamiento vía `pi.sendUserMessage` (capturado en closure), delegando al tool `workflow` como único orquestador. Tres entradas nuevas en `STARTER_CARDS` (`webview/components/Welcome.tsx`) con `actionType: "insert"` y el comando como prompt. Cero cambios al motor (`src/tools/frida-extensible-workflows/`).

Origen: FRD `.rpiv/artifacts/discover/2026-08-28_17-29-53_pista-m-slash-commands-welcome.md` (issue #140). 8 preguntas de investigación (scope-tracer) respondidas por 5 agentes de análisis + 1 barrido de precedentes.

## Summary

- El Recommended Approach del FRD es **estructuralmente sólido**: el `_pi` hoy ignorado es el mismo objeto que `/goal` ya explota (`src/tools/frida-goal/runtime.ts:75` guarda `this.pi = pi`; `:118` llama `sendUserMessage`). `registerCommand` es válido dentro del setup; `sendUserMessage` solo puede llamarse diferido (al ejecutarse el handler), nunca dentro del setup.
- El seam de envío está verificado en ambos extremos: contrato SDK (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:934`) y uso en producción (`src/tools/frida-git-sync/index.ts:403-404` con gate `ctx.isIdle()` → `deliverAs: "followUp"`).
- **Gap del host descubierto**: `src/extension.ts:1855-1857` envía `description: ""` para todos los comandos de extensión — sin fix, los 3 comandos aparecen en el `/` pero SIN descripción (AC-1 incumplido). Decisión del checkpoint: incluir el fix (los 3 packs NO están en `TOOL_TOGGLE_BASES`, así que sus comandos sí fluyen al autocompletado).
- Formato del mensaje resuelto: `Ejecuta el workflow '<name>' con los siguientes argumentos:\n{...}` con objeto literal que coincide 1:1 con el `args` del patrón y TODOS los requeridos presentes (FR-7 estructural: el agente no re-pregunta).
- El motor queda intacto: todo lo necesario (registro de patrones, lookup, tool, catálogo) ya existe como API pública; los consumidores del catálogo son inmunes a los comandos nuevos.
- Tests: `vscode` no es resolvable en vitest (cero infra de mock en el repo); decisión del checkpoint: **adapter UI inyectable** (`opts.ui?` con inline type import, default = wrappers de `vscode.window` en un `command.ts` por pack, molde `presenter.ts`/`WorktreeUI`).
- Los stubs `{} as never` de las 3 suites `pattern.test.ts` existentes se actualizan forzosamente (un `pi.registerCommand` incondicional en el setup los rompe) — ese mismo stub es el vehículo de los tests nuevos.
- Welcome append-only validado: grid de 2 columnas fijas (`webview/styles.css:5345`); 7 cards = 4 filas con hueco visual en la última (no rompe); cada cambio webview regenera `dist-webview/` que se commitea.

## Detailed Findings

### 1. Ciclo de vida del `ExtensionAPI` (`_pi`) y seguridad del closure

Las tres factories siguen el molde `(pi: ExtensionAPI) => void` con el parámetro hoy ignorado:

- `createFridaAppWalkthrough()` en `src/tools/frida-app-walkthrough/index.ts:49`; setup `:50-56` que solo ejecuta `registerBuiltinPattern(APP_WALKTHROUGH_PATTERN)` (`:55`).
- `createFridaUnderstandApp(opts)` en `src/tools/frida-understand-app/index.ts:121`; setup `:137-142` (clona el patrón con closure que re-sondea capacidades y registra en `:140`).
- `createFridaSizeApp(opts)` en `src/tools/frida-size-app/index.ts:154`; setup `:172-201`: registra (`:175`), gate `isSccInstalledAtPin` (`:178`), descarga fire-and-forget de scc vía `void ensureBinary(...)` (`:180`) con `.catch` que solo hace `console.warn` (`:194-200`) — jamás bloquea el loader.

El wiring vive en `extensionFactories` del `DefaultResourceLoader` en `src/pi-session.ts`: `frida-app-walkthrough` en `:673`, `frida-understand-app` en `:681`, `frida-size-app` en `:708` (los tres ya cableados — **este feature no necesita tocar pi-session.ts**). El momento exacto de ejecución es `await loader.reload()` (`src/pi-session.ts:1013`); la semántica documentada del contrato `await factory(api)` está en el comentario `:575`. Dentro del SDK: `loadExtensionFromFactory` crea una `ExtensionAPI` por pack (paths `<inline:NAME>`) sobre un **runtime compartido**; los métodos de registro (`registerCommand`, `registerTool`, `on`) funcionan durante el setup, pero los métodos de acción (`sendUserMessage` incluido) son stubs que **lanzan** hasta que `bindCore` los reemplaza al construir el `AgentSession` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:425` para el `await factory(api)`; el binding en `dist/core/agent-session.js:2037`/`:1845`, asignación del sendUserMessage real en `:1855-1862`).

Dispatch cuando el usuario teclea el comando: el host ya sabe enrutar comandos de extensión (`src/extension.ts:5002-5006` → `session.session.prompt`), y `AgentSession._tryExecuteExtensionCommand` (`dist/core/agent-session.js:923-947`) resuelve el comando del Map de la extensión y ejecuta `command.handler(args, ctx)`; si el handler lanza, lo atrapa y emite error de extensión sin tumbar la sesión (`:938-945`).

**Seguridad del closure**: dentro de la vida de la sesión, sí — precedentes `this.pi` en `src/tools/frida-goal/runtime.ts:75`/`:118` y el closure `onCheckpoint` del motor (`src/tools/frida-extensible-workflows/index.ts:342-357`). La frontera: `runner.invalidate()` (`dist/core/extensions/runner.js:352-357`) tras `/reload` o switch de sesión mata el `pi` capturado ("stale"), pero el reload **re-corre las tres factories** sobre un runtime nuevo, re-registrando comando y patrón juntos. El helper `toggleable()` (`src/pi-session.ts:149`) NO aplica a los packs (sin toggle propio, comentarios en `:677-680`); el gate que sí importa es el del motor: `(opts.extensibleWorkflowsEnabled?.() ?? true)` (`src/pi-session.ts:954`) — si el usuario apaga el motor, el patrón queda registrado pero el tool `workflow` no existe (ver §8). Las sesiones hijas (`createChildSession`, `src/pi-session.ts:201`) usan lista curada sin packs: el seam de comandos vive solo en la sesión principal.

### 2. Contrato del handler y QuickPicks

Contrato formal (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:852-858`): `handler(args: string, ctx: ExtensionCommandContext) => Promise<void>` — `args` es TODO el texto tras el nombre del comando; `ctx` trae `isIdle()`, `waitForIdle()`, control de sesión y `ui` (interfaz `ExtensionUIContext`). Registro vía `pi.registerCommand(name, options)` (`types.d.ts:904`); `getArgumentCompletions` existe (`types.d.ts:856`) pero ningún comando del repo lo usa.

Precedentes de parseo:

- `/fridasync` (`src/tools/frida-git-sync/index.ts:141`): `switch (args?.trim())` sobre subcomandos — trata `undefined` y `""` igual.
- `postWfCommand` (`src/extension.ts:4447`): `trimmed.split(/\s+/)`, primer token + `rest.join(" ").trim()` como payload libre — el molde para `/walkthrough <url>` (las URLs no tienen espacios; basta `args?.trim()`).
- Dos estilos de cancelación en `postWfCommand`: aidd-plan (`:4465`, `if (!entered || !entered.trim()) return` — Esc Y Enter-vacío son no-op porque el valor es requerido) y genérico (`:4483`, `if (entered === undefined) return` — solo Esc). Para la URL requerida aplica el estilo aidd-plan.
- **Heurística clave**: `postWfCommand` solo auto-pregunta si `pattern.args` contiene "string no vacío" u "obligatoria" (`src/extension.ts:4474-4478`); los 3 patrones M dicen "REQUERIDO" — por eso hoy `/wf walkthrough` no pregunta nada y los handlers nuevos deben preguntar por sí mismos (FR-4/5/6).

Tensión `ctx.ui` vs `vscode.window` resuelta: git-sync usa `ctx.ui` por fidelidad a su upstream TUI (porte de extensión pi), no por convención de producto; `ctx.ui` enruta a diálogos del webview (`src/extension-ui-context.ts:44-100`), `vscode.window` a la paleta nativa. La afirmación del FRD "`ctx.ui` no tiene ni un uso" es **inexacta** (`/worktree` lo usa vía `ctxWorktreeUI`, `src/worktree/index.ts:71-78`), pero la decisión `vscode.window` se sostiene: es el precedente del flujo que se replica (`postWfCommand`) y el notify de git-sync en cancelaciones (`src/tools/frida-git-sync/index.ts:124`, `:250`) violaría FR-8 — con `vscode.window`, un `return` tras `undefined` es literalmente silencioso. Matiz del barrido de precedentes: no existe aún un slash command con `vscode.window` puro (worktree-slash usa `ctx.ui`); este feature es el primero — decisión rationaleada, no blindada por precedente.

Adapter para tests (decisión del checkpoint): `WorktreeUI` (`src/worktree/command.ts:57`) es el molde — interfaz inyectable + `createVscodeWorktreeUI()` (`:84`) con `showInputBox` (`:87`) y `showQuickPick` (`:106`). El caso de uso original era doble-entrada (paleta + chat), que aquí no existe; el motivo del adapter aquí es testeabilidad (ver §7).

### 3. Mensaje de lanzamiento y seam de entrega

Contrato de `ExtensionAPI.sendUserMessage` verificado (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:934`, doc comment `:926-933`): *"Send a user message to the agent. Always triggers a turn. When the agent is streaming, use deliverAs to specify how to queue the message."* — entrega al chat de la sesión a la que está ligado el `ExtensionAPI` (asunción del FRD confirmada). Firma gemela en `ReplacedSessionContext` (`types.d.ts:302`). Es `void` síncrono (fire-and-forget) — no requiere await.

Diferencia con `s.session.prompt` (el seam de `/wf`, `src/extension.ts:4495`): `Session.prompt` **lanza** si está streameando sin `streamingBehavior` — correcto para el host (fuera del ciclo del agente), incorrecto para un handler pi. El seam correcto desde factory, con producción vigente:

- `src/tools/frida-git-sync/index.ts:403-404`: `if (ctx.isIdle()) pi.sendUserMessage(prompt); else pi.sendUserMessage(prompt, { deliverAs: "followUp" });` — replicar literal (no `steer`, que redirigiría el stream en curso). Opcional: un único `ctx.ui.notify("…encolado…")` solo en la rama followUp; el post informativo de `/wf` (`src/extension.ts:4490-4494`) no es necesario (el mensaje del usuario ya es visible en el transcript).

**Formato del mensaje** (FR-7 — 1 round-trip, sin re-preguntar): variante "con los siguientes argumentos" (`src/extension.ts:4471`) con objeto literal que coincide 1:1 con el `args` declarado del patrón:

- `Ejecuta el workflow 'app-walkthrough' con los siguientes argumentos:\n{ url: "https://ejemplo.app", maxScreens: 10 }`
- `Ejecuta el workflow 'understand-app' con los siguientes argumentos:\n{ maxHotspots: 8 }`
- `Ejecuta el workflow 'size-app' con los siguientes argumentos:\n{ wage: 35000, currency: "MXN", cocomoType: "semi-detached" }`

Por qué funciona: (a) el nombre exacto del patrón es lo que `findBuiltinPattern` busca por match exacto sin normalización (`src/tools/frida-extensible-workflows/builtin-patterns.ts:469-471`) tanto en `/wf` (`src/extension.ts:4454`) como en el tool (`index.ts:328`); (b) objeto literal elimina ambigüedad de mapeo, y `normalizeWorkflowArgs` tolera string-JSON (`src/tools/frida-extensible-workflows/args.ts:17-35`); (c) todos los requeridos presentes neutraliza la instrucción del patrón "si falta, preguntar el presupuesto con ask_user_question ANTES de lanzar"; (d) tipos correctos: números para `maxScreens`/`maxHotspots`/`wage` ("todo" → `0`), enum literal `semi-detached` con guion; (e) no mencionar `foreground`/`budget` para no cambiar la semántica de espera.

### 4. Ruta delegada y disciplina "motor intacto"

Tipos del motor (`src/tools/frida-extensible-workflows/builtin-patterns.ts`): `BuiltinPatternMeta` `:348-372` (tipo cerrado, sin campo `slashCommand` — base de la decisión por-pack); `BuiltinPattern` `:375-390` (`name`/`description`/`args`/`meta`/`resolve` síncrono que valida eager); `findBuiltinPattern` `:469`; `REGISTERED_PATTERNS` module-global `:478`; `registerBuiltinPattern` idempotente `:481`; `clearRegisteredBuiltinPatterns` (solo tests) `:488`; `builtinPatternsCatalog` `:499`.

Ruta completa verificada: mensaje del chat → agente invoca `workflow({ name, args })` (guiado por `WORKFLOW_TOOL_PROMPT_SNIPPET` que remite a `workflow_catalog`) → execute del tool (`src/tools/frida-extensible-workflows/index.ts:307-336`): `findBuiltinPattern(name)` (`:328`) → `builtin.resolve(args, { cwd })` (`:329-332`, aquí corren los `validate*Args` eager) → `runWorkflowInStore` (`:372` foreground await / `:416` background void) definida en `src/tools/frida-extensible-workflows/frida-host.ts:325`.

Diff vacío en el motor es alcanzable: los handlers viven en las factories (fuera del motor), las cards en el webview (sin imports del motor), y el lanzamiento delega al chat. Consumidores del catálogo inmunes al comando: `builtinPatternsCatalog` alimenta `/wf` (`src/extension.ts:4508`, QuickPick `:4545-4557`) y el tool `workflow_catalog` (`src/tools/frida-extensible-workflows/index.ts:575`, detalle con hint de lanzamiento `:560`); los nombres de comando (`walkthrough`) y de patrón (`app-walkthrough`) son namespaces distintos; `frida.showWorkflows` (`src/extension.ts:5976-5981`) alimenta el panel de *runs*, no de comandos — un run lanzado por handler nuevo produce los mismos eventos que uno de `/wf`. Nota: `WORKFLOW_TOOL_DESCRIPTION` es estático y solo nombra 2 patrones; la lista completa ante el agente llega por `workflow_catalog`.

### 5. Validadores eager y opciones de los QuickPicks

Fuente de verdad por pack:

- `validateAppWalkthroughArgs` (`src/tools/frida-app-walkthrough/workflow.ts:93`): `url` no vacía requerida; `maxScreens` entero **0-200** requerido, `0 = "todo"`; el mensaje de error sugiere "30 pantallas" (`:102`).
- `validateUnderstandAppArgs` (`src/tools/frida-understand-app/workflow.ts:99`): `maxHotspots` entero **0-100** requerido, `0 = "todo"`; sugiere "10 hotspots" (`:103`).
- `validateSizeAppArgs` (`src/tools/frida-size-app/workflow.ts:156`): `wage` número **> 0** (decimales válidos, `:163-171`); sugerencias exactas "MXN $35,000" (wage 35000, currency "MXN") / "USD $6,000" / monto propio (`:160`); `cocomoType` ∈ organic|semi-detached|embedded, default `semi-detached` (`:172-180`, default `:197-200`); `currency` default `"USD"` (`:196`). Contrato documentado en el string `args` de `SIZE_APP_PATTERN` (`src/tools/frida-size-app/index.ts:119-120`).

Divergencias vs FRD (resueltas en checkpoint — ganan las opciones del FRD): maxScreens "10 rec · 5 · 25 · todo" vs sugerido "30"; maxHotspots "8 · 15 · todo" vs sugerido "10". Ninguna opción del FRD queda fuera de rango (5/10/25 ∈ [0,200]; 8/15 ∈ [0,100]). El mapeo "todo" → **número 0** es obligatorio: un string `"todo"` hace `typeof record.maxScreens !== "number"` lanzar y el run truena en vez de degradar — la validación corre eager dentro de `resolve()` invocada por el tool (`src/tools/frida-extensible-workflows/index.ts:331`), ANTES de crear el run. El picker es la única barrera previa; como FR-10 ya toca los how-tos, los textos de error del validador y how-tos se alinean con los defaults nuevos (10/8).

### 6. Welcome: cards `actionType: "insert"` → composer

- Interfaz `StarterCard` (`webview/components/Welcome.tsx:6-13`): `id`, `title`, `desc`, `iconName`, `prompt`, `actionType?: "submit" | "insert"` (omitir = submit).
- `STARTER_CARDS` (`:15-51`): 4 entradas; solo `aidd-plan` usa `insert` con `prompt: "/wf aidd-plan "` (`:22`, **con espacio final** para que el usuario escriba el arg después) — el precedente exacto.
- Router `handleCardClick` (`:187-193`): insert → `onInsert(card.prompt)`; submit → `onPrompt`. También enruta `onKeyDown` Enter/Espacio (accesibilidad).
- Montaje (`webview/App.tsx:541-551`): Welcome solo con transcript vacío (`:541`); `onPrompt` = submit steer (`:543`); `onInsert` = `dispatch({ type: "composer_insert", text })` (`:546`).
- Reducer (`webview/store.ts:751-761`): guarda `{ text, n: prev+1 }` en `state.composerInsert` (`webview/types.ts:881`, action en `:1040`) — el nonce fuerza re-disparo ante textos idénticos.
- Composer (`webview/components/Composer.tsx:148-164`): prop `insertSignal` (`:74`, `:106`); el efecto hace **append** (`:153-155`, une con un espacio — el prompt con espacio final no genera dobles espacios), focus y cursor al final (`:158-160`). Aquí termina el texto: estado `text` del textarea (`:110`).

Layout validado: grid de **2 columnas fijas** `repeat(2, 1fr)` (`webview/styles.css:5345`; media query 1 columna ≤380px en `:5351`). Con 7 cards: 4 filas, la 7ª en columna izquierda, celda derecha vacía — **no rompe**, queda hueco visual (asunto cosmético para design). Insert es aditivo y tipado-correcto; únicas condiciones: `id` único y `iconName` codicon válido (`Codicon` no crashea con nombre inválido, solo no muestra glifo). Semántica append: clicks múltiples concatenan comandos en el composer (comportamiento existente, no cambia).

### 7. Estrategia de pruebas

Runner: vitest 2.1.9 (`package.json:477`, `:511`), entorno node (`vitest.config.ts:27`), `resolve.alias` con un solo alias pi-ai (`vitest.config.ts:8-22`) — **sin alias de `vscode`**, sin `__mocks__/`, y `vscode` no es resolvable (solo `@types/vscode`). El único `vi.mock` del repo es de un paquete npm resolvable (`test/frida-mcp-adapter/wrapper.test.ts:14-16`). Mockear `vscode` = nueva infraestructura sin precedente; el repo lo evita estructuralmente dos veces:

- Precedente A (type-only inline import): `src/tools/frida-cc-plugins/presenter.ts:13-16` importa vscode solo en la implementación; `index.ts` referencia el tipo con `presenter?: import("./presenter").CcPluginsPresenter` (`src/tools/frida-cc-plugins/index.ts:85`) — TS borra el import y los tests cargan `index.ts` sin vscode.
- Precedente B (adapter inyectable): `WorktreeUI` (`src/worktree/command.ts:57`) + `createVscodeWorktreeUI()` (`:84`).

Decisión del checkpoint: **adapter inyectable**. Diseño: `command.ts` por pack importa `vscode` y exporta `SlashPickUI` (`pick`/`input`, `undefined` = Esc); la factory acepta `opts.ui?` con inline type import; default de producción = `createVscodePickUI()`. Guardián estructural: si un `index.ts` de pack importara vscode estáticamente, las 3 suites `pattern.test.ts` truenan al resolver el import — el propio `npm test` protege la arquitectura.

Moldes de stub (ya probados en el repo): `fakePi()` capturando `registerCommand` en un Map + invocación del handler (`test/frida-cc-plugins/presenter.test.ts:59-86`); captura de `sendUserMessage` (`test/frida-goal/goal-runtime.test.ts:12-50`). Casos por pack: (a) registro — `commands.keys()` contiene el nombre + descripción es-MX no vacía; (b) armado — exactamente 1 `sendUserMessage` con nombre de patrón y args resueltos (url/maxScreens · maxHotspots · wage/cocomoType, "todo" → `0`); (c) cancelación FR-8 — fake UI devuelve `undefined` en cualquier paso → `sent.length === 0`. Particularidades de size-app: HOME aislado en beforeEach/afterEach + `ensureDeps` rechazante + `vi.spyOn(console, "warn")` (molde `test/frida-size-app/pattern.test.ts:48-62`, `:103-105`).

Welcome: capa estática — extender `test/welcome.test.ts:23-31` (solo `toContain`; cero snapshots/conteos — append seguro) con los 3 títulos + conteo `starter-card-head` 4→7; capa datos — exportar `STARTER_CARDS` y asertar `actionType === "insert"` + prompts `"/walkthrough "` etc.; capa interactiva opcional — montaje jsdom (`jsdom` ya es dependency) + click → `spy("/walkthrough ")`.

### 8. Resiliencia, idempotencia y caso "comando sí, patrón no"

- Idempotencia: `registerBuiltinPattern` hace findIndex → splice → push (gana el último, `src/tools/frida-extensible-workflows/builtin-patterns.ts:481-484`); los comentarios "Idempotente por nombre" están en las tres factories — es lo que hace seguro el re-registro tras `/reload`.
- Por construcción, comando y patrón viven en el mismo setup y mueren juntos ante invalidación de sesión. Los caminos artificiales al estado "comando sí, patrón no": `clearRegisteredBuiltinPatterns()` en tests, o el toggle del motor (`src/pi-session.ts:954` — patrón registrado, tool ausente). Si ocurriera y el handler enviara igual, el tool lanza un error **opaco** que no nombra el patrón (`readLaunchScript`: "provide exactly one of script or scriptPath", `src/tools/frida-extensible-workflows/index.ts:226-228`). Mitigación: el handler guarda con `findBuiltinPattern(nombre)` antes de enviar y ante ausencia muestra `vscode.window.showWarningMessage` con causa+remedio, sin enviar nada — así el NFR "error accionable, sesión viva" se cumple (la sesión ya sobrevive por sí: `dist/core/agent-session.js:938-945` atrapa errores de handler).

### 9. Gap del host: descripción de comandos de extensión (decisión: fix incluido)

`ResourceSummary.commands` alimenta el autocompletado `/` del Composer (`src/extension.ts:1880-1889` concatena `BUILTIN_COMMANDS` + `extCommands`). El loop de `extCommands` (`src/extension.ts:1848-1863`) solo itera `e.commands.keys()` y el push hardcodea `description: ""` (`:1855-1857`). Además, `factoryEsModulo()` (`:1837`) excluye comandos de módulos con toggle/base (van al acordeón Herramientas) — **verificado que los 3 packs NO están en `TOOL_TOGGLE_BASES`** (`src/tool-toggles.ts` lista frida-git-sync, frida-worktree, frida-subagents, etc., no los packs M), así que sus comandos SÍ fluyen al autocompletado. El fix aprobado: leer `e.commands.get(n)?.description` en el push — 1-3 líneas fuera del motor congelado; beneficia también a comandos de extensiones externas.

## Code References

- `src/tools/frida-app-walkthrough/index.ts:49-56` — factory `createFridaAppWalkthrough`; setup hoy solo registra el patrón (`:55`); `_pi` sin usar.
- `src/tools/frida-understand-app/index.ts:121-142` — factory + setup con clonación de patrón; registro en `:140`.
- `src/tools/frida-size-app/index.ts:154-201` — factory + setup; registro `:175`; descarga scc fire-and-forget `:178-200`; opts inyectables `:143-153` (`agentDir`, `codebaseIndexEnabled`, `ensureDeps`).
- `src/tools/frida-app-walkthrough/workflow.ts:93-135` — `validateAppWalkthroughArgs` (url + maxScreens 0-200; "30 pantallas" `:102`).
- `src/tools/frida-understand-app/workflow.ts:99-133` — `validateUnderstandAppArgs` (maxHotspots 0-100; "10 hotspots" `:103`).
- `src/tools/frida-size-app/workflow.ts:156-208` — `validateSizeAppArgs` (wage > 0, cocomo enum, currency).
- `src/tools/frida-git-sync/index.ts:141-162` — precedente `pi.registerCommand("fridasync")` con `switch (args?.trim())`.
- `src/tools/frida-git-sync/index.ts:403-404` — seam de envío: gate `ctx.isIdle()` → `pi.sendUserMessage` / `deliverAs: "followUp"`.
- `src/tools/frida-goal/runtime.ts:75` / `:118` — precedente de closure `this.pi` + `sendUserMessage` diferido al handler.
- `src/tools/frida-cc-plugins/presenter.ts:13-16` + `src/tools/frida-cc-plugins/index.ts:85` — precedente type-only inline import (tests sin vscode).
- `src/worktree/command.ts:57-62` / `:84-111` — molde adapter `WorktreeUI` + `createVscodeWorktreeUI` (`showInputBox` `:87`, `showQuickPick` `:106`).
- `src/extension.ts:4447-4497` — `postWfCommand`: parseo por tokens (`:4452-4456`), lookup `findBuiltinPattern(first)` `:4454`, InputBox `:4460`/`:4479`, mensajes `:4468`/`:4471-4472`/`:4487-4488`, heurística de auto-pregunta `:4474-4478`, post `:4490-4494`, `s.session.prompt` `:4495`.
- `src/extension.ts:1837-1863` — `factoryEsModulo` `:1837`; loop extCommands `:1848`; push con `description: ""` `:1855-1857` (gap AC-1).
- `src/extension.ts:5002-5006` — el host enruta comandos de extensión vía `session.prompt`.
- `src/extension.ts:5976-5981` — `frida.showWorkflows` (panel de runs, inmune).
- `src/pi-session.ts:673` / `:681` / `:708` — wiring existente de las 3 factories (no se toca).
- `src/pi-session.ts:1013` — `await loader.reload()` (momento de ejecución de los setups).
- `src/pi-session.ts:954` — gate `extensibleWorkflowsEnabled` (motor apagado = patrón sin tool).
- `src/pi-session.ts:149` / `:201` — `toggleable` (no aplica a packs) / `createChildSession` (sin packs).
- `src/tools/frida-extensible-workflows/builtin-patterns.ts:348-372` — `BuiltinPatternMeta` cerrado, sin `slashCommand`.
- `src/tools/frida-extensible-workflows/builtin-patterns.ts:375-390` — `BuiltinPattern` (`resolve` síncrono eager `:389`).
- `src/tools/frida-extensible-workflows/builtin-patterns.ts:469-471` — `findBuiltinPattern` match exacto.
- `src/tools/frida-extensible-workflows/builtin-patterns.ts:481-484` / `:488-490` — registro idempotente / clear (solo tests).
- `src/tools/frida-extensible-workflows/index.ts:302` / `:307-336` — tool `workflow`: registro y execute (lookup `:328`, resolve `:329-332`).
- `src/tools/frida-extensible-workflows/index.ts:372` / `:416` — invocaciones foreground/background de `runWorkflowInStore`.
- `src/tools/frida-extensible-workflows/index.ts:226-228` — error opaco si el patrón no existe (motiva el guard del handler).
- `src/tools/frida-extensible-workflows/index.ts:528-580` — tool `workflow_catalog` (catálogo `:575`, hint launch `:560`).
- `src/tools/frida-extensible-workflows/args.ts:17-35` — `normalizeWorkflowArgs` (tolera string-JSON).
- `src/tools/frida-extensible-workflows/frida-host.ts:325` — `runWorkflowInStore` (definición).
- `webview/components/Welcome.tsx:6-13` / `:15-51` / `:187-193` — `StarterCard` / `STARTER_CARDS` (aidd-plan insert `:22-23`) / router insert-submit.
- `webview/App.tsx:541-551` — montaje condicional + wiring `onPrompt`/`onInsert` (dispatch `:546`).
- `webview/store.ts:751-761` — case `composer_insert` con nonce (`:759`).
- `webview/types.ts:881` / `:1040` — estado `composerInsert` / action.
- `webview/components/Composer.tsx:106` / `:148-164` — `insertSignal` y efecto append+focus+cursor.
- `webview/styles.css:5345` / `:5351` — grid 2 columnas fijas / media query 1 columna.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:852-858` / `:904` / `:934` — `RegisteredCommand` / `registerCommand` / `sendUserMessage` (contratos SDK verificados).
- `test/welcome.test.ts:23-31` — aserciones por título (solo `toContain`).
- `test/frida-cc-plugins/presenter.test.ts:59-86` — molde `fakePi` (captura + invoca handler).
- `test/frida-goal/goal-runtime.test.ts:12-50` — molde captura `sendUserMessage`.
- `test/frida-app-walkthrough/pattern.test.ts:150` (y homólogos understand `:253`, size `:359`) — stubs `{} as never` a actualizar.
- `package.json:477` / `:511` — `vitest run` / vitest 2.1.9.

## Integration Points

### Inbound References

- `src/pi-session.ts:673/:681/:708` — las factories se invocan como extensiones inline en cada `loader.reload()` (`:1013`); el `ExtensionAPI` queda ligado a la sesión principal (sesiones hijas `:201` excluidas).
- `src/extension.ts:5002-5006` — el host detecta comandos de extensión en el prompt del chat y los enruta por `session.prompt` → dispatch del handler.
- `webview/App.tsx:541-551` — las cards del Welcome llegan al composer vía `composer_insert` (canal existente, cero mensajes nuevos al webview).
- `src/extension.ts:1848-1863` — el ResourceSummary recoge los comandos registrados para el autocompletado `/` (requiere fix de descripción `:1855-1857`).

### Outbound Dependencies

- `pi.registerCommand` / `pi.sendUserMessage` / `ctx.isIdle()` — SDK `@earendil-works/pi-coding-agent` (`types.d.ts:852-858`, `:904`, `:934`).
- `findBuiltinPattern` / `registerBuiltinPattern` (`src/tools/frida-extensible-workflows/builtin-patterns.ts:469/:481`) — lookup compartido con `/wf` y el tool; dirección consumidor → motor, sin cambios al motor.
- Tool `workflow` (`src/tools/frida-extensible-workflows/index.ts:302/328/331`) — único orquestador del lanzamiento.
- `vscode.window.showQuickPick/showInputBox` — vía adapter por pack (default de producción).

### Infrastructure Wiring

- Validadores eager de cada pack (`workflow.ts:93/:99/:156`) — frontera de contrato de args; el mensaje armado debe pasarlos al primer intento.
- `dist-webview/` — los bundles dist se commitean con cada cambio webview (precedente: todos los commits de Welcome los incluyen).
- How-tos espejo: `docs/how-to-frida-app-walkthrough.md` (flujo típico `:38-56`, paso 3 `:97-103`, recetas `:167`), `docs/how-to-frida-understand-app.md` (`:42-58`, `:91-95`, `:160`), `docs/how-to-frida-size-app.md` (`:38-56`, `:81-88`, `:147`) + encabezados "Uso:" en `src/tools/frida-app-walkthrough/index.ts:9`, `src/tools/frida-understand-app/index.ts:10`, `src/tools/frida-size-app/index.ts:11`. Ningún test lee estos documentos (grep `how-to-frida` en `test/` = 0 matches).

## Architecture Insights

- **Un seam, tres consumidores**: el `ExtensionAPI` por-pack registra patrón hoy y comandos mañana; `/goal` y git-sync ya ejercitan el par registro/envío. Regla dura: nunca llamar `pi.sendUserMessage` dentro del setup (stub que lanza hasta `bindCore`).
- **El picker es la única barrera antes del validador eager**: valores fuera de contrato (string "todo", wage como texto) = tool error, no degradación. Serializar SIEMPRE a número/enum.
- **Diseño deliberado de contrastes en size-app**: por binario la corrida "NUNCA aborta" (degrada sin scc); por args aborta a propósito (D13). Los comandos deben respetar esa asimetría: recoger args conformes, no validar de nuevo.
- **Silencio como contrato FR-8**: `return` plano tras `undefined` de cualquier picker; sin notify (el notify de git-sync en cancelaciones sería ruido aquí).
- **El envío es fire-and-forget void** — no await, no retry; la visibilidad del run llega por los eventos del motor al panel (independiente de la ruta de entrada).
- **Moldes del repo para no cargar vscode en tests**: type-only inline import + adapter inyectable; `npm test` actúa como guardián (un import estático de vscode en `index.ts` rompe las suites existentes).
- **Defaults de QuickPick aprobados**: FRD gana (10·5·25·todo; 8·15·todo; wage MXN 35000/USD 6000/propio + cocomo semi-detached rec) — alinear textos de validadores y how-tos en el mismo cambio.

## Precedents & Lessons

7 cambios pasados similares analizados.

### Precedente: `/fridasync` (seam canónico registerCommand + sendUserMessage)

**Commit(s)**: `29cf622` — "feat(frida-git-sync): port @jachy/pi-git-sync to the frida agentDir" (2026-08-03)
**Blast radius**: ~14 archivos, 3 capas (pi-session wiring + pack completo + webview widget)

**Follow-up fixes**:

- `1522bf1` — "footer status widget with Cancel button" (2026-08-03) — la cancelación quedó diferida en el MVP y hubo que restaurarla el mismo día.

**Takeaway**: el seam exacto del FRD ya funciona en producción; decidir la rama no-idle (`isIdle` → `followUp`) ANTES de escribir el handler.

### Precedente: `/worktree` (adapter WorktreeUI)

**Commit(s)**: `ed244ba` — "feat(worktree): slash command /worktree en el chat, fiel al original (Refs #13)" (2026-08-08)
**Blast radius**: 3 archivos, 2 capas (pi-session + worktree/command.ts reescrito a adapter)

**Takeaway**: el slash de worktree usa `ctx.ui`, no `vscode.window` — no existe precedente de slash con `vscode.window` puro; el adapter dual es el molde de testeabilidad.

### Precedente: `/wf` unificado con patrones agénticos

**Commit(s)**: `32d874d` (2026-08-06), `4c5f2f2` — "unificar comando /wf con patrones agénticos" (2026-08-21)
**Blast radius**: 2-6+ archivos (extension.ts +122 en la unificación)

**Follow-up fixes**: 4 commits, TODOS en cableado del panel webview (`9588fa1` panel nunca llamado, `599c23c`, `11d4e50` singleton stale, `d52e7cd` visibilidad) — el slash en sí jamás se rompió.

**Takeaway**: el formato "Ejecuta el workflow 'X' con: ..." es el molde directo; el riesgo histórico vive en el webview, que este feature no toca (solo append a STARTER_CARDS).

### Precedente: `/ask` y `/tree` (slash built-in recientes)

**Commit(s)**: `637f2bd` (/ask, 2026-08-22), `3403541` (/tree, 2026-08-22)
**Follow-up fixes**: `c37ef71` (mismo día que /tree) — publicar mensaje al webview no bastaba; había que despacharlo al reducer.

**Takeaway**: el punto de quiebre reciente es el flujo mensaje→reducer; las cards insert reusan un canal existente (cero mensajes nuevos) — riesgo bajo.

### Precedente: Starter Cards del Welcome

**Commit(s)**: `f2a13cb`, `c58e20e` (ambos 2026-08-21)
**Blast radius**: 6-10 archivos (Welcome.tsx, App.tsx, test, styles, dist-webview)

**Follow-up fixes**: ninguno — el mecanismo card → `composer_insert` lleva estable desde el landed.

**Takeaway**: mecanismo probado; riesgos residuales: layout 4→7 (hueco, cosmético) y regenerar/commitear `dist-webview/`.

### Precedente: M8/M1/M10 (los packs que reciben los handlers)

**Commit(s)**: `d958d4f` (M8, 2026-08-24), `62e5f06` (M1, 2026-08-25), `83929c6`+`070e87a` (M10, 2026-08-28)
**Follow-up fixes**: `30ef616` (mismo día que M8) — el mock del e2e "mentía sobre el contrato del binario" y no veía los bugs reales.

**Lessons from docs**:

- `.rpiv/artifacts/validation/2026-08-24_18-09-01_m8-skill-pack-frida-app-walkthrough.md` — arranque completo post-wiring (`npm test`, lesson 34d496a); commit atómico pack+wiring+docs+tests (lesson 1ff6b0e/D1); `clearRegisteredBuiltinPatterns()` en afterEach; HOME aislado; catálogo con `toContain` nunca conteo global.
- `.rpiv/artifacts/validation/2026-08-28_08-05-45_m10-size-app.md` — "V8 motor intacto… vacío": la disciplina de diff vacío ya se cumplió una vez.

**Takeaway**: los mocks no validan el AC principal ("el LLM no vuelve a preguntar el presupuesto") — se requiere al menos 1 invocación real por comando contra sesión viva (fase de validación).

### Precedente: `/goal` (segundo usuario de sendUserMessage)

**Commit(s)**: `c3d04da` (2026-08-17)
**Takeaway**: inyecta continuaciones vía `sendUserMessage`; el wiring de pi-session de los 3 packs YA existe — blast radius menor de lo que parece.

### Composite Lessons

- Decide la rama no-idle antes de escribir el handler (`29cf622` + `src/tools/frida-git-sync/index.ts:403-404`): el handler de QuickPicks es async y la sesión puede estar corriendo cuando el usuario termina de pickear.
- No agregues mensajes nuevos al webview ni paneles — el 100% de los fixes post-`/wf` (`9588fa1`, `c37ef71`) fue cableado webview; las cards insert existentes tienen cero fixes.
- Los mocks no validan el criterio e2e (`30ef616`): planear smoke real por comando (1 envío → 1 invocación del tool workflow → run visible en panel) en validación.
- Cancelación = no-op es AC explícito y el repo ya se quemó (`1522bf1`): probar Esc en CADA paso del picker, no como afterthought.
- Commit atómico (lessons 1ff6b0e/34d496a): handlers + cards + how-tos + actualización de stubs + tests nuevos aterrizan juntos; `npm test` completo tras cualquier toque de wiring.
- Cada cambio webview regenera `dist-webview/` y los bundles se commitean (`f2a13cb`, `c58e20e`).

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-08-28_17-29-53_pista-m-slash-commands-welcome.md` — FRD de entrada (decisiones, alcance, criterios de aceptación).
- `.rpiv/artifacts/research/2026-08-27_06-28-43_m10-size-app.md` — research M10 (picker `/wf`, formato de mensaje, string args como documentación pura).
- `.rpiv/artifacts/validation/2026-08-24_18-09-01_m8-skill-pack-frida-app-walkthrough.md` — validación M8 (lessons de arranque y commit atómico).
- `.rpiv/artifacts/validation/2026-08-28_08-05-45_m10-size-app.md` — validación M10 (disciplina motor intacto).

## Developer Context

**Q (discover: Seam de lanzamiento: delegar al chat): ¿El handler llama al motor (`runWorkflowInStore`) o arma un mensaje determinista y lo envía al chat?**
A: Delegar al chat (vía `pi.sendUserMessage`).

**Q (discover: Dónde vive el handler: por-pack): ¿Handler en cada skill-pack o meta-driven en el motor?**
A: Por-pack (motor intacto).

**Q (discover: API de QuickPicks: vscode.window): ¿QuickPicks con `ctx.ui` de pi o `vscode.window`?**
A: `vscode.window`.

**Q (discover: Welcome: insert del comando): ¿Cómo aparecen las capacidades en la página de inicio?**
A: Cards con `actionType: "insert"` que dejan el comando en el composer.

**Q (discover: Alcance: solo los 3 comandos del issue): ¿traffic2api (M9) entra al lote?**
A: Solo `/walkthrough` `/understand` `/size`.

**Q (discover: Pre-autenticación de /walkthrough: la maneja el patrón): ¿El handler orquesta la pre-autenticación o M8 la cubre?**
A: El patrón la maneja.

**Q (discover: Nombres: EN corto): ¿Verbos EN cortos o sustantivos es-MX?**
A: `/walkthrough` `/understand` `/size` (descripciones en es-MX).

**Q (discover: Presupuesto: solo args requeridos): ¿QuickPicks mínimos o completos (maxMinutes/review)?**
A: Solo requeridos: url+maxScreens · maxHotspots · cocomoType+wage; el resto en defaults.

**Q (discover: Cards: agregar sin tocar): ¿Las 3 cards nuevas reemplazan alguna existente?**
A: Agregar sin tocar — `STARTER_CARDS` pasa de 4 a 7 entradas.

**Q (`src/extension.ts:1855-1857`): el push de extCommands hardcodea `description: ""` para todos los comandos de extensión — sin fix, AC-1 ("visibles con descripción") queda incumplido. ¿Incluimos el fix del host en el alcance?**
A: Sí, fix del host — leer la descripción del Map (`e.commands.get(n)?.description`) y pasarla al ResourceSummary; fuera del motor congelado; beneficia también a extensiones externas.

**Q (`src/tools/frida-app-walkthrough/workflow.ts:102` / `src/tools/frida-understand-app/workflow.ts:103`): el FRD propone defaults de QuickPick (10·5·25·todo; 8·15·todo) que divergen de lo establecido en validadores/how-tos (30 pantallas; 10 hotspots). ¿Qué opciones gana?**
A: Las del FRD; como FR-10 ya toca los how-tos, se alinean ahí (y opcionalmente el texto de error del validador) para eliminar la inconsistencia.

**Q (`vitest.config.ts:8-22` / `src/worktree/command.ts:57`): `vscode` no es resolvable en vitest y ningún test lo carga hoy — ¿qué seam usan los handlers para ser testeables?**
A: Adapter UI inyectable (`opts.ui?` por factory con inline type import; default de producción = wrappers de `vscode.window` en `command.ts` por pack, molde presenter/WorktreeUI). Cero cambios a vitest.config; la decisión "vscode.window" queda intacta.

## Related Research

- `.rpiv/artifacts/research/2026-08-27_06-28-43_m10-size-app.md` — dimensionamiento scc/size-app (pack M10, mismo molde de factory que recibirá `/size`).

## Open Questions

Ninguna — el FRD entró sin preguntas abiertas ("Ninguna — todas las ramas quedaron resueltas con decisión y rationale") y las 3 surgidas durante el checkpoint (fix del host, defaults de QuickPick, seam UI de tests) quedaron resueltas y registradas en Developer Context. Los asuntos cosméticos detectados (hueco del grid con 7 cards; curación de las 4 cards actuales; retiro de skills launcher obsoletos en `~/.frida/skills/`) son materia de design/seguimiento, no bloqueos.
