---
date: 2026-08-31T07:56:10-0600
author: Edgar F. Fuentes Perea
commit: d46ed97
branch: main
repository: frida-code
topic: "Paneles de pipeline SDD (N1 planeación + N2 ejecución) con monitor HTML por método"
tags: [research, codebase, frida-workflow, pipeline-panels, features-json, http-sse, panel-spec, welcome]
status: ready
last_updated: 2026-08-31T07:56:10-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Research: Paneles de pipeline SDD (N1 planeación + N2 ejecución) con monitor HTML por método

## Research Question

Cadena del FRD `.rpiv/artifacts/discover/2026-08-31_07-08-47_pipeline-panels-sdd-n1-n2-html.md`. Tema trazado: «Overlay hermano de `/board` (mismo stack webview, `panel.ts`/`board-ui.tsx` como referencia) para N1, con dominio nuevo `features.ts` + persistencia `features.json` reutilizando el patrón atómico de `board.ts`; servidor HTTP+SSE embebido en la extensión (node:http nativo) que sirve páginas estáticas por método y POSTs autenticados que enrutan a `runPrompt`; motor de panel genérico con columnas/disparadores declarativos del cual SDD-N1 es la primera configuración».

9 preguntas de investigación respondidas por 6 agentes (5 análisis + 1 precedent sweep) sobre: pila de montaje del overlay, contrato `features.ts`/`features.json`, canal de disparo, ciclo de vida del servidor HTTP+SSE, motor declarativo, puente N1→N2, reconciliación FS↔estado, hub Welcome y coexistencia de overlays.

## Summary

Todos los moldes que N1 necesita ya existen y están verificados: el overlay replica `mountBoardOverlay` (extension.ts:5072-5168); la persistencia replica `saveBoard`/`loadBoard` (board.ts:238-265); el disparo del ▶ y del POST del HTML viaja por `runCustomCommand` → `runPrompt` — literalmente el mismo canal que un submit del usuario (extension.ts:5322-5324); el servidor HTTP+SSE tiene una plantilla casi completa ya corriendo en el extension host (`node_modules/pi-mcp-adapter/ui-server.ts`: SSE en `Set`, token, puerto efímero, watchdog `.unref()`); el motor declarativo sigue el patrón `registerBuiltinPattern` (builtin-patterns.ts:481) ya usado por frida-aidd; y el ship N1→N2 es exactamente `openBoard`+`syncUnitsFromPlan` (board.ts:268-303, 354-374), que crea unidades en backlog sin ejecutar nada.

Tres conflictos contra el FRD fueron resueltos en checkpoint con el desarrollador: (1) la raíz de artefactos primaria es `.frida/artifacts/` (con buckets plurales `designs/`/`plans/`), no `.rpiv/artifacts/` como asumía el constraint del FRD — `.rpiv/` queda como seed histórico de solo-lectura; (2) `/pipeline` ya existe como comando del orquestador y N1 lo absorbe; (3) las tarjetas Welcome aidd existentes se retarjetan según el FRD. El riesgo técnico #1 identificado por precedentes: la sincronización derivada (FS↔features.json) duplica unidades/eventos — 4 fixes consecutivos en el board por ese patrón — exige id canónico + dedup desde el día 1.

## Detailed Findings

### 1. Pila de montaje del overlay — N1 replica `/board` pieza por pieza

- Un comando builtin requiere exactamente tres puntos: entrada en `BUILTIN_COMMANDS` (extension.ts:4159), `BUILTIN_SLASH` derivado automáticamente (extension.ts:4262), y `case` en el switch de `runBuiltinSlash` (extension.ts:4264). `ResourceSummary.commands` (autocompletado del Composer + Recursos) también se deriva de `BUILTIN_COMMANDS`.
- `mountBoardOverlay(arg)` (extension.ts:5072-5168) resuelve el plan en escalera de tres peldaños (argumento > plan del último run vía `extractPhaseId` > board más reciente por mtime en `.frida/artifacts/board/`), materializa el board con `loadBoard`/`openBoard`/`saveBoard`, y monta vía closure `mount(data)` → `webBridge.mountPersistent(..., "footer")` (montaje dentro de extension.ts:5130-5156; `mountPersistent` en src/web-bridge.ts:86).
- El contrato de UI es `BoardOverlayActions` (onOpenArtifact/onAdvance/onClose, board-ui.tsx:32-38) con fábrica `createBoardOverlayElement` (board-ui.tsx:45-50). El `onAdvance` de N2 (extension.ts:5137-5149) enfoca el chat y llama `runCustomCommand("/wf …")`.
- **`/pipeline` ya existe**: registrado en extension.ts:4225 (`name: "pipeline"`), dispatch en extension.ts:4351 → `postPipelineCommand` (extension.ts:5547-5561) que monta el banner del orquestador (`wirePipelinePanel`, src/tools/frida-pipeline/panel.ts:34) + postea estado. Decisión de checkpoint: N1 absorbe el comando.
- El orden de footers #175 (kanban arriba, workflow debajo) se controla re-montando: `remountWorkflowPanel` (src/tools/frida-workflow/panel.ts:263) tras `mount(board)` (extension.ts:5160). El orden visual = orden de inserción de llaves en `webRoots` del webview — no hay z-index en el protocolo; con dos overlays vivos el orden relativo flota (cada re-montaje cae al final).

### 2. Dominio `features.ts` + `features.json` — herencia del patrón board

- Tipos a heredar de board.ts:39-95: `v` versionado (normalizado a 1 en carga, board.ts:238-249), `source` trazable, `updatedAt` estampado dentro del save (board.ts:251-265), `BoardArtifactLink` (kind/path/label) para enlazar FRD/research/design/plan.
- Persistencia atómica exacta a copiar (`saveBoard`, board.ts:251-265): `mkdirSync recursive` → tmp `${file}.${process.pid}.tmp` → `renameSync` → `emitBoardChange()` (board.ts:220-227). `features.ts` necesita su propio par `subscribeFeaturesChanges`/`emitFeaturesChange` espejo de board.ts:213-227.
- La ruta `.frida/artifacts/pipeline/features.json` no existe aún (dir nuevo; `mkdirSync` lo crea). A diferencia de `boardFilePath(cwd, planPathToken)` (board.ts:233-236, un board por plan), `featuresFilePath(cwd)` no lleva token: N1 agrega todas las features del proyecto en un solo archivo.
- Modelo recomendado por el análisis: `stage` directo + historial append-only ligero por feature — NO el modelo completo de `BoardTransition` (board.ts:45-61): `failed`/`regress` existen por el zigzag implement↔validate (board.ts:431+), `blocked` por el circuit breaker, `runId` por el replay del bootstrap — ninguno aplica a un pipeline lineal discover→…→ready-to-ship sin runs del motor.
- El contrato multi-escritor documentado en extension-api.ts:8-16 (append-only, versionado, `source` obligatorio, tmp+rename) gobierna a los TRES escritores de features.json: la UI (▶), las skills RPIV (nivel 1, FS como API) y el POST autenticado del HTML.
- `features.ts` debe co-ubicarse en `src/tools/frida-workflow/` junto a board.ts: el badge puente consume `loadBoard`+`isUnitDone` del mismo módulo, el wiring del host importa por el índice del tool, y `frida-pipeline/` ya está tomado por el orquestador ADR-0021.

### 3. Canal de disparo — `runCustomCommand` y `runPrompt` son el mismo canal

- `runCustomCommand(cmd)` (store.ts:108) invoca `commandRunner?.(cmd)`; el único registro en toda la base es extension.ts:5322-5324: `registerCommandRunner((cmd) => { void runPrompt(cmd); })` — el comentario #156 lo declara diseño deliberado («mismo pipeline que un submit del usuario»).
- `runPrompt` (extension.ts:5802) triajea: (1) builtins vía `runBuiltinSlash` — la regex `/^\/([\w-]+)…/` **no puede capturar `/skill:discover`** (el `:` corta `[\w-]+`), así que `/skill:` nunca es builtin; (2) comandos de extensión vía `session.session.prompt` crudo; (3) gate de auth; (4) expansión B1: `expandSkillText` (extension.ts:5866, de `./tools/frida-args`) expande el bloque `<skill>` en vivo para paridad display↔modelo, con guard de re-entrada (el bloque ya expandido pasa intacto); (5) `toSend`/`toPost` paritarios + queue si el agente está ocupado.
- **Decisión derivada del código**: ▶ N1 y `POST /api/advance` usan `runCustomCommand("/skill:<etapa> <ruta-frd>")`. `runPrompt` es una clausura dentro de `activate` — no importable desde un módulo de servidor; `runCustomCommand` es la única indirección a nivel de módulo. Precedentes del patrón: `onAdvance` de N2 (extension.ts:5137-5149) y `setBoardShowHandler(() => void runPrompt("/board"))` (extension.ts:5328, extension-api.ts:37).
- «Mueve la tarjeta al iniciar»: en N2 el movimiento temprano lo produce el lifecycle del workflow (`onStageStart` → `applyRuntimeBoardTransition`, panel.ts:199-206, panel.ts:115). Para `/skill:` en la sesión principal NO hay lifecycle de workflow — el propio handler del ▶ debe escribir features.json al momento del clic (movimiento temprano espejo de #171) y emitir su cambio.

### 4. Servidor HTTP+SSE embebido — dos precedentes, uno casi completo

- `node:http` corre sin restricciones en el extension host: esbuild con `platform: "node"`, external sólo `vscode`+nativos; `createServer` ya se usa en producción (oauth.ts:2, 115).
- Precedente A (src propio): servidor OAuth efímero (src/providers/frida-antigravity/auth/oauth.ts) — puerto fijo 51121 (oauth.ts:169), bind loopback vía `CALLBACK_HOST` (oauth.ts:37), `closeServerGracefully` con `closeAllConnections()` (oauth.ts:90), manejo de `EADDRINUSE`. Vida acotada al login; sin SSE.
- Precedente B (plantilla casi completa, YA corre en el host): `node_modules/pi-mcp-adapter/ui-server.ts` — token `randomUUID()` (:86), `sseClients = new Set<ServerResponse>()` (:96) con headers `text/event-stream` y baja en `req.on("close")`, replay por `Last-Event-ID` con cap de 128 eventos, `parseBody` con tope 2MB, `validateTokenBody` (:634, responde **403** — el FRD exige **401**, delta consciente), watchdog `setInterval` con `.unref()` (:513-522), y `server.listen(options.port ?? 0, "127.0.0.1")` (:531) — **puerto efímero** que elimina el `EADDRINUSE` entre recargas del extension host.
- `deactivate()` está VACÍO (extension.ts:7215-7217) — el ciclo de vida del servidor debe registrarse como `Disposable` en `context.subscriptions` (patrón del status bar item: subscribe dual + dispose en extension.ts:6895-6901).
- **No existe ningún `fs.watch` en `src/`** — el watcher es diseño nuevo. Fuente necesaria porque `emitBoardChange` sólo dispara desde `saveBoard` in-process (board.ts:251-265): artefactos escritos por el agente vía bash (skills de la sesión principal) nunca pasan por el host → el ámbar de reconciliación y el SSE <1s exigen vigilar el FS directamente. El watcher debe tolerar el patrón tmp+rename (eventos sobre tmp o rename según plataforma) y usar debounce (propuesta diferida documentada en CONTEXT.md).
- Las dos fuentes reactivas existentes para alimentar SSE: `subscribeBoardChanges` (board.ts:213) y `subscribeWorkflowRuns` (store.ts:127) — el SSE sería su tercer consumidor sin tocar emisores.

### 5. Motor de panel genérico declarativo — registro, no derivación

- Las etapas N1 (discover/research/design/plan) NO son stages de ningún `Workflow` — se disparan como `/skill:` sueltas, así que una `PanelSpec` no puede derivarse de un grafo como `deriveBoardSpec` (board.ts:186-201) hace con N2. Nace declarativa-total.
- La cadena resolver existente como molde: `setBoardSpecResolver`/`resolveBoardSpec` (board.ts:159-169), registrada desde `handleWfSlash` con precedencia `wf.board` > `deriveBoardSpec` (command.ts:99); cascada de kinds config > contrato SKILL.md > defaults en `resolveStageKind` (board.ts:139-147) alimentada por `scanSkillContracts` (skill-contracts.ts:65). `BoardSpec` vive en types.ts:349.
- **Patrón de registro probado para «aidd entra por fixture sin tocar el motor»**: `registerBuiltinPattern` (builtin-patterns.ts:481, idempotente por nombre, «gana el último», dirección de dependencia consumidor→motor) — así registra frida-aidd sus patrones hoy (src/tools/frida-aidd/index.ts:115-116) sin que el motor lo conozca. Un `registerPanelSpec`/`resolvePanelSpec` espejo + fixture de arranque en el wiring (precedente: fixture inline del grafo sdd-ship en el bootstrap) cumple la aceptación «configurar aidd NO modifica el motor». Test espejo del fixture: test/frida-workflow/board.test.ts ya corre `deriveBoardSpec` sobre fixture local.
- Alternativa descartada por el análisis: extender el envelope de config de workflows (`load.ts`) tocaría el motor de carga y rompería la aceptación del fixture.

### 6. Puente N1→N2 — ship es `openBoard`+`syncUnitsFromPlan`; el badge es `isUnitDone`

- El ▶ ship se implementa con la puerta que ya existe: `loadBoard(cwd, planPath)` → si no hay board: `openBoard(cwd, planPath, planContent)` → `saveBoard` (flujo exacto de extension.ts:5115-5123 para /board). `syncUnitsFromPlan` (board.ts:354-374) parsea los headers `## FN` del plan (`parsePlanPhases`, plan-utils.ts:31-47), crea cada unidad nueva en la PRIMERA columna (backlog) con `transitions: []` — **cero ejecución** —, es idempotente (refresca title, no duplica) y conserva unidades que desaparecen del plan.
- La API pública `frida.board.transition` (extension-api.ts:51-69) NO sirve para ship: `applyStageTransition` (board.ts:431) siempre empuja hacia adelante — no puede dejar una unidad recién creada en backlog.
- Caveat real del resolver: `setBoardSpecResolver` sólo se llena dentro de `handleWfSlash` (command.ts:99) — un ship antes de cualquier `/wf` en la sesión crea el board con columnas default (`DEFAULT_BOARD_COLUMNS`); `openBoard` remapea status cuando el spec real llegue (board.ts:268-303 + `remapUnitStatuses`), patrón ya testeado.
- Jerarquía por convención de punto: `parentOf` (board.ts:341-346) — las F01…Fn recién shipeadas son raíces (sin punto). No se duplica en N1 (decisión del FRD confirmada por código).
- Badge «n/m fases commit»: misma lógica que el header de N2 — `roots = units.filter(u => !u.parentId)` + `isUnitDone` (board.ts:589-596) — patrón exacto en board-ui.tsx:89-90. La tarjeta N1 guarda `planPath` (llave del puente) y se refresca en vivo si escucha `subscribeBoardChanges` (misma señal que re-monta N2, extension.ts:5163). `readCompletedPhases` (plan-utils.ts:107) es la fuente alternativa (progress file), NO la del badge.

### 7. Reconciliación FS↔estado — raíz `.frida/` primaria, `.rpiv/` seed (decisión de checkpoint)

- Los skills bundled que el ▶ disparará escriben en `.frida/artifacts/`: discover → `.frida/artifacts/discover/` (discover/SKILL.md:122), research → `research/` (research/SKILL.md:100), design → **`designs/`** (design/SKILL.md:78), plan → **`plans/`** (plan/SKILL.md:70) — buckets PLURALES que el constraint del FRD nombra en singular; el mapa etapa→bucket debe corregirse en diseño.
- El contenido bundled es el que corre por construcción: `syncBundledSkills` (skills-sync.ts:104) fuerza-overwrite a `~/.frida/skills/` (call en session-hooks.ts:118), y el test skills-lote1.test.ts:93 prohíbe `.rpiv/artifacts/` en los skills bundled.
- `.rpiv/artifacts/` es la raíz del pipeline RPIV externo (CLI `pi`, upstream en `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/`): contiene TODO el historial de este workspace (incluido el FRD fuente y artefactos con encadenamiento `parent:` en frontmatter). Ningún skill bundled puede escribir ahí.
- El constraint del FRD (`.rpiv/artifacts/{discover,research,design,plan}/`) tiene 3 desviaciones contra el FS real: buckets singulares inexistentes, raíz única incorrecta (el ▶ produce en `.frida/`), y sin features.json (no existe archivo ni código aún).
- Status por artefacto: enum `[in-progress, in-review, ready]` en los cuatro contratos (discover/SKILL.md:16); en la práctica los skills escriben `ready` al terminar — el ámbar «desincronizado» se decide por **existencia+mtime del artefacto vs. etapa en features.json**, no por valores intermedios del enum. Para plan, `phase_count` presente es señal adicional (plan/SKILL.md:70).
- Molde de lectura fresca: `readFreshVerdict` (sdd-factory.ts:84) — readdir por bucket + statSync mtime + sort + `split("---")[1]` + regex de la clave — neutraliza la carrera de flush #174; el reconciliador reusa el molde cambiando la regex de `verdict` a `status`, siempre leyendo el FS en render/SSE-time, nunca un snapshot del collector.
- Detectar por bucket (no por skill) absorbe las variantes automáticamente: synthesize/blueprint/revise producen `plan`→`plans/`, design-slice produce `design`→`designs/`, explore produce `solutions/` (entrada alternativa de design).

### 8. Hub Welcome — `submit` ya cruza al host; no se necesita actionType nuevo

- La Welcome se monta sólo con transcript vacío (webview/App.tsx:542); máquina declarativa `CATEGORIES` (Welcome.tsx:30) con union cerrado de 4 actionTypes (Welcome.tsx:16): `submit` (cruza al host vía `post({type:"submit"})`, App.tsx:544 → case "submit" extension.ts:3070 → `runPrompt`), `insert` (100% local: dispatch `composer_insert`, App.tsx:545), `settings` (local), `roadmap` (no-op con badge — el estado «próximamente» exacto que necesita AiDD).
- Abrir `/pipeline` desde la Welcome funciona HOY con `actionType: "submit"` + `prompt: "/pipeline"` — la cadena completa existe (submit → runPrompt → runBuiltinSlash → case "pipeline" extension.ts:4351). Como los builtins se interceptan ANTES de auth y sin publicar turno, la Welcome permanece montada tras abrir el panel.
- Abrir el monitor HTML en el navegador: NO existe `OutMessage` de openExternal (el webview no puede llamar `vscode.env.openExternal`); las anclas HTML nativas `<a href>` del webview SÍ abren en el navegador externo sin código host (patrón vigente en el banner OAuth). Para una URL con puerto+token dinámicos haría falta un canal nuevo (~5 líneas) o un ancla con URL provista por el host.
- Decisión de checkpoint: retarjetar según FRD — «Desarrollo Autónomo» pasa de insert `/wf aidd-ship` (Welcome.tsx:48) a submit `/pipeline` (SDD); «Planificar con AiDD» (Welcome.tsx:39) pasa a roadmap/próximamente. `/wf aidd-plan`/`/wf aidd-ship` siguen existiendo como comandos.
- La landing del servidor espeja el hub: mismo modelo de datos (extraer `CATEGORIES` a módulo compartido o duplicar) y mismo canal de control (POSTs → `runCustomCommand`).

### 9. Coexistencia de overlays y render vivo

- El overlay vivo N2 re-monta en cada cambio: `subscribeBoardChanges(() => { loadBoard fresco → mount(fresh) })` (extension.ts:5163-5167). Cada mount = unmount del root viejo + rootId nuevo + commit snapshot completo; el webview reemplaza el subárbol. Esto porque `mountPersistent` congela `factory()` en el montaje — los cambios estructurales requieren re-montar; los cambios de runs van por store reactivo interno.
- El estado colapsado sobrevive re-mounts sólo como variable de módulo (`boardPanelCollapsed`, board-ui.tsx:42, sembrada en `useState` en cada montaje) — N1 necesita su propio par. `CollapsiblePanel` (src/frida-webview) es compartido por los tres paneles existentes.
- Con N1 y N2 abiertos a la vez: dos roots "footer" + sus suscripciones; un `emitBoardChange` dispararía re-mount de N2 y (si N1 escucha boards para el badge) re-render de N1; cada re-montaje cae al final del stack. `remountWorkflowPanel` es barato pero no gratis (2 mensajes + pérdida del `useState` del WorkflowPanel).
- El pulso «en ejecución» por runs NO transporta a N1: `extractPhaseId` (plan-utils.ts:80-97) exige `.md` + id de fase `F\d+` en el input del run — un input `/skill:research <ruta-frd>` no produce phaseId. El FRD ya lo dejó fuera de fase 1 (movimiento temprano del ▶ en su lugar). El mini-timeline de 5 etapas (FR#11) se recalcula por índice en cada render (i<actual done / i=actual destacada / i>actual próxima / flag pausada-ámbar por feature); ancestro visual directo: la barra segmentada de N2 (board-ui.tsx:127-140, celdas done/gap).

## Code References

- `src/extension.ts:4159` — `BUILTIN_COMMANDS`: fuente única de comandos builtin (alimenta allowlist + autocompletado).
- `src/extension.ts:4225` — entrada existente `pipeline` (hoy: estado del orquestador; N1 lo absorbe).
- `src/extension.ts:4262-4264` — `BUILTIN_SLASH` derivado + `runBuiltinSlash` (regex que no captura `/skill:` por el `:`).
- `src/extension.ts:4342-4351` — cases `board` y `pipeline` del dispatch builtin.
- `src/extension.ts:5072-5168` — `mountBoardOverlay`: resolución en escalera, materialización, montaje footer, orden #175, suscripción viva. Molde directo de `mountPipelineOverlay`.
- `src/extension.ts:5130-5156` — closure `mount(data)` + acciones (`onAdvance` → `runCustomCommand("/wf …")`).
- `src/extension.ts:5163-5167` — re-mount vivo con datos frescos en cada `emitBoardChange`.
- `src/extension.ts:5322-5328` — `registerCommandRunner((cmd) => void runPrompt(cmd))` + `setBoardShowHandler` — el canal único botón-UI→chat.
- `src/extension.ts:5547-5561` — `postPipelineCommand` (banner del orquestador que N1 reemplaza).
- `src/extension.ts:5802-5945` — `runPrompt`: triaje builtins/extension/auth + expansión B1 (`expandSkillText` en :5866) + paridad toSend/toPost.
- `src/extension.ts:7215-7217` — `deactivate()` vacío (el servidor debe ser `Disposable` en subscriptions).
- `src/tools/frida-workflow/board.ts:39-95` — tipos base: BoardArtifactLink/BoardTransition/BoardUnit/Board (v, source, updatedAt).
- `src/tools/frida-workflow/board.ts:139-169` — cascada `resolveStageKind` + `setBoardSpecResolver`/`resolveBoardSpec` (molde del motor de PanelSpecs).
- `src/tools/frida-workflow/board.ts:186-201` — `deriveBoardSpec` (columnas derivadas de stages; NO aplica a N1).
- `src/tools/frida-workflow/board.ts:213-227` — `subscribeBoardChanges`/`emitBoardChange` (patrón listeners a clonar para features).
- `src/tools/frida-workflow/board.ts:233-249` — `boardFilePath`/`loadBoard` (normalización v→1, degradación a null).
- `src/tools/frida-workflow/board.ts:251-265` — `saveBoard`: mkdir + tmp PID + renameSync + emitBoardChange (patrón atómico a heredar).
- `src/tools/frida-workflow/board.ts:268-303` — `openBoard` (+ remapUnitStatuses): creador/sincronizador desde plan — la puerta del ship.
- `src/tools/frida-workflow/board.ts:341-374` — `parentOf` (jerarquía por punto) + `syncUnitsFromPlan` (unidades en backlog, cero ejecución, idempotente).
- `src/tools/frida-workflow/board.ts:431` — `applyStageTransition` (sólo avanza; por eso ship NO usa `transition`).
- `src/tools/frida-workflow/board.ts:589-598` — `isUnitDone`/`firstRealGap` (lógica del badge puente).
- `src/tools/frida-workflow/board-ui.tsx:32-50` — `BoardOverlayActions` + `createBoardOverlayElement` (contrato y fábrica a espejar).
- `src/tools/frida-workflow/board-ui.tsx:42` — `boardPanelCollapsed` módulo-nivel (memoria entre re-mounts).
- `src/tools/frida-workflow/board-ui.tsx:80-90` — `useSyncExternalStore` (pulso por runs) + conteo roots/done del badge.
- `src/tools/frida-workflow/store.ts:105-127` — `registerCommandRunner`/`runCustomCommand` + store reactivo de runs.
- `src/tools/frida-workflow/panel.ts:115` — `applyRuntimeBoardTransition` (movimiento temprano #171 en runtime N2).
- `src/tools/frida-workflow/panel.ts:199-206` — `onStageStart`: stageStart al store + transición temprana del board.
- `src/tools/frida-workflow/panel.ts:263` — `remountWorkflowPanel` (orden de footers #175 + rehidratación webview_ready).
- `src/tools/frida-workflow/extension-api.ts:8-16` — contrato multi-escritor (append-only, versionado, source, tmp+rename).
- `src/tools/frida-workflow/extension-api.ts:37-83` — `setBoardShowHandler`, `transition`, superficie `frida.board.*`.
- `src/tools/frida-workflow/command.ts:99` — registro del boardSpecResolver dentro de `handleWfSlash` (caveat: sólo tras un /wf).
- `src/tools/frida-workflow/plan-utils.ts:31-47` — `parsePlanPhases` (headers `## FN` — insumo del ship).
- `src/tools/frida-workflow/plan-utils.ts:80-97` — `extractPhaseId` (exige `.md` + `F\d+`; limitación documentada del pulso N1).
- `src/tools/frida-workflow/plan-utils.ts:100-118` — `progressFilePath`/`readCompletedPhases` (fuente alternativa de progreso).
- `src/tools/frida-workflow/sdd-factory.ts:59-101` — `newestMdCollector` + `readFreshVerdict` (molde de lectura fresca de frontmatter por mtime, #174).
- `src/tools/frida-workflow/types.ts:349` — `BoardSpec` (vocabulario declarativo existente).
- `src/tools/frida-workflow/skill-contracts.ts:65` — `scanSkillContracts` (contratos skill⇒artifactKind).
- `src/tools/frida-extensible-workflows/builtin-patterns.ts:481` — `registerBuiltinPattern`: registro idempotente consumidor→motor (molde de `registerPanelSpec`).
- `src/tools/frida-aidd/index.ts:115-116` — frida-aidd registra sus patrones sin tocar el motor (precedente de extensión por configuración).
- `src/tools/frida-pipeline/skills/discover/SKILL.md:11,122` — contrato: `artifactKind: frd`, salida `.frida/artifacts/discover/<slug>_<topic>.md`.
- `src/tools/frida-pipeline/skills/research/SKILL.md:100` — salida `.frida/artifacts/research/`.
- `src/tools/frida-pipeline/skills/design/SKILL.md:78` — salida `.frida/artifacts/designs/` (PLURAL).
- `src/tools/frida-pipeline/skills/plan/SKILL.md:70` — salida `.frida/artifacts/plans/` (PLURAL) + `phase_count`.
- `src/tools/frida-pipeline/skills-sync.ts:23,104` — `BUNDLED_SKILLS_DIR` + `syncBundledSkills` (force-overwrite a `~/.frida/skills/`).
- `src/tools/frida-pipeline/session-hooks.ts:118` — call-site del sync por proceso.
- `test/frida-pipeline/skills-lote1.test.ts:93` — test que prohíbe `.rpiv/artifacts/` en skills bundled.
- `src/tools/frida-pipeline/panel.ts:34` — `wirePipelinePanel` (banner Fase 1 que N1 absorbe).
- `src/providers/frida-antigravity/auth/oauth.ts:37,90,115,169` — CALLBACK_HOST loopback, closeServerGracefully, createServer, listen 51121 (precedente efímero).
- `node_modules/pi-mcp-adapter/ui-server.ts:86,96,513-531,634` — plantilla del monitor: token randomUUID, Set de SSE clients, watchdog unref, listen puerto efímero 127.0.0.1, validateTokenBody (403 vs 401 del FRD).
- `webview/components/Welcome.tsx:10,30,39,48,407` — StarterCard (4 actionTypes), CATEGORIES, tarjetas aidd-plan/aidd-ship, handleCardClick.
- `webview/App.tsx:542-545` — montaje de Welcome (transcript vacío) + props onPrompt (submit al host) / onInsert (local).
- `src/web-bridge.ts:86` — `mountPersistent` (placement "footer"; congela factory() → re-montar para datos nuevos).

## Integration Points

### Inbound References

- `src/extension.ts:3070` — `case "submit"` del webview: TODO accionable de la UI termina en `runPrompt` (la Welcome, el Composer, los botones).
- `src/extension.ts:3304` — `case "web_event"`: clicks de paneles remotos vuelven al host (fireEvent → handler del componente host-side).
- `src/extension.ts:5322-5324` — `runCustomCommand` registrado: consumido por ▶ del board, botones del WorkflowPanel, y (futuro) ▶ N1 + POST del monitor.
- `board-ui.tsx:80` + `WorkflowPanel.tsx` + status bar (extension.ts:6895) — tres consumidores actuales de `subscribeWorkflowRuns`; N1/SSE serían el cuarto.
- `extension.ts:5163` — consumidor actual de `subscribeBoardChanges` (re-mount vivo de /board); N1 (badge) y SSE serían segundo/tercero.

### Outbound Dependencies

- El overlay N1 depende de: `mountPersistent` (web-bridge), `CollapsiblePanel` (frida-webview), `createBoardOverlayElement` como molde (board-ui.tsx), y del dominio board para el badge (`loadBoard`, `isUnitDone`).
- `features.ts` depende de: patrón de persistencia de `saveBoard`/`loadBoard` (board.ts) y contrato multi-escritor (extension-api.ts).
- El servidor del monitor depende de: `node:http`/`node:crypto` (nativos, sin dependencias nuevas), `runCustomCommand` (store.ts), `subscribeBoardChanges`/`subscribeWorkflowRuns`, y fs.watch sobre `.frida/artifacts/`.
- El ▶ N1 depende de: expansión `/skill:` de frida-args (`expandSkillText`) y skills bundled sincronizados en `~/.frida/skills/` (skills-sync.ts:104).

### Infrastructure Wiring

- Registro de comando: `BUILTIN_COMMANDS` (extension.ts:4159) + case (extension.ts:4351) — N1 cambia el cuerpo del handler `postPipelineCommand`.
- Registro de specs: `setBoardSpecResolver` desde `handleWfSlash` (command.ts:99); PanelSpecs entrarían por `registerPanelSpec` en el wiring de activate (análogo a `setSkillContracts`/bootstrap en el mismo bloque).
- Vida del servidor: `Disposable` en `context.subscriptions` (patrón extension.ts:6895-6901); republish/re-montaje tras `webview_ready` (extension.ts:3062).
- Skills: `syncBundledSkills` por proceso (session-hooks.ts:118) garantiza que `/skill:discover` etc. corran el contenido bundled que escribe `.frida/artifacts/`.

## Architecture Insights

- **FS como API con capa reactiva in-process**: features.json/boards son la verdad; `emit*Change` sólo ve escrituras del propio proceso — cualquier escritor externo (bash del agente) exige fs.watch para reflejo en vivo. Este hueco estructural justifica el watcher del FRD.
- **Canal único de acción**: todo botón UI → `runCustomCommand` → `runPrompt`. `/skill:` atraviesa auth+expansión B1+queue idéntico a un submit manual; `/wf` corre en child sessions con lifecycle propio — dos semánticas distintas bajo el mismo embudo. N1 pertenece a la primera.
- **Extensión por registro, no por derivación**: el patrón «motor genérico + configuración registrada por el consumidor» (builtin-patterns / boardSpecResolver) es la garantía estructural de que AiDD/TEA entren como datos; derivar del grafo sólo funciona cuando hay grafo (N2), no para pipelines de skills sueltas (N1).
- **Reconciliación tolerante en vez de escritor perfecto**: la decisión del FRD (estado propio + ámbar por desfase) se apoya en `loadBoard` normalizando `v→1` y en lectura fresca por mtime (`readFreshVerdict`) — el sistema degrada visible, no rompe.
- **Orden de footers como emergente**: no hay z-index; el orden es orden de inserción en `webRoots`. Con dos overlays vivos re-montándose, el orden flota — el diseño debe fijar secuencia de re-montaje o aceptar la flotación.
- **Puerto efímero + token por proceso** (ui-server.ts:531, 86) resuelve de raíz el `EADDRINUSE` de las recargas del extension host; el costo es que la URL del monitor no es estable — la Welcome/necesita un mecanismo de descubrimiento (host provee URL al abrir).

## Precedents & Lessons

10 cambios similares analizados (git log del área frida-workflow/webview, 2026-08-03 → 2026-08-31).

### Precedent: Board kanban jerárquico (ancestro directo de features.ts)

**Commit(s)**: `8ed293a` — "feat(frida-workflow): board (kanban interno) jerarquico con contratos de skills" (2026-08-30)
**Blast radius**: 8 archivos, ~1,028 líneas, 4 capas (dominio+runtime+UI+test).
**Follow-up fixes**: `0c6f467` (ids fantasma en migración progress→board), `b44c066` (re-sync por etapa colaba duplicados con headers agrupados), `e979053` (disablePlanSync #166), `c10b46f` (export faltante).
**Takeaway**: la sincronización derivada duplica sin id canónico + dedup + flag de no-sync.

### Precedent: Overlay visual /board (molde del overlay N1)

**Commit(s)**: `f2e2bd8` — "tablero kanban visual del plan — comando /board" (2026-08-30)
**Blast radius**: 3 archivos, 471 líneas (extension.ts + board-ui.tsx + styles.css).
**Follow-up fixes**: 5 visuales el mismo día (`4344fff` ficon sin color heredado, `c51b68a` ids que se parten, `3285ea7` comentario JSX renderizado, `bf7397e`, `69ffe5a`).
**Takeaway**: presupuesta passes de pulido visual como fase propia.

### Precedent: Tablero-vivo reactivo (modelo del SSE interno)

**Commit(s)**: `f52818d` — "tablero-vivo — imagen fiel del ciclo" (2026-08-30); nace `emitBoardChange`/`subscribeBoardChanges`.
**Follow-up fixes**: `6a3199f` (onAdvance desmontaba el overlay y mataba la suscripción — #167), `76376ec` (dedup del replay del bootstrap, 59 eventos duplicados — #185).
**Takeaway**: no canceles la suscripción en la acción; todo replay/bootstrap necesita guard de dedup + ts único.

### Precedent: Footer colapsable + orden + rehidratación

**Commit(s)**: `b3cbb2c` (CollapsiblePanel), `1cd6ae4` (#169 board colapsable), `00a85b6` (#175 orden de footers), `17772e7` (#170 candado).
**Follow-up fixes**: `ba40da0` — mountPersistent se perdía al recrearse la webview y el flag `wired` lo impedía recuperar PARA SIEMPRE; fix: re-montaje idempotente en `webview_ready`.
**Takeaway**: el overlay N1 debe nacer con re-montaje en webview_ready, no añadirlo después.

### Precedent: Store reactivo de runs

**Commit(s)**: `7d0d2a1` — "progreso en vivo de workflows en background" (2026-08-08); `useSyncExternalStore(subscribeWorkflowRuns, getWorkflowRuns)` estable desde entonces.
**Takeaway**: no inventar mecanismo de pulso — el que existe (con la limitación documentada de `extractPhaseId`).

### Precedent: Superficie frida.board.* (#161)

**Commit(s)**: `56ed6ac` (2026-08-31) — 5 archivos, 195 líneas, sin fixes posteriores (único feature del área sin bug de seguimiento).
**Takeaway**: superficie API pequeña + passthrough + tests con fixtures funcionó a la primera.

### Precedent: Factory declarativo defineSddWorkflow (#174/#152)

**Commit(s)**: `5e4cb2b` (2026-08-31); config global migra a sdd-ship/sdd-full en 2 llamadas.
**Follow-up fixes**: `ea1a00a` (shims import.meta en el bundle DSL), `8e128a3` (alias jiti no cableado).
**Takeaway**: extraer a factory funcionó, pero toda decisión de etapa debe leer estado FRESCO del disco (#174, `readFreshVerdict`); si el motor se configura vía DSL, heredas shims de esbuild/jiti.

### Precedent: Servidor OAuth embebido + ADR-0035

**Commit(s)**: `6a4f16f` (frida-antigravity — único createServer en src/), `71924f6` (ADR-0035 background tasks/watchers — DECISIÓN SIN IMPLEMENTAR).
**Takeaway**: no hay precedente de SSE ni POST con token en src/ (la plantilla real es pi-mcp-adapter/ui-server.ts); la durabilidad está acotada a VS Code abierto (el proceso huésped es la extensión).

### Precedent: Cards de arranque en la Welcome (Pista M)

**Commit(s)**: `d01621c` (2026-08-28).
**Follow-up fixes**: `0806ed9` (insert-vs-submit: insert metía al textarea lo que debía ejecutarse), `d88e0e1` (carrera async del workspace en primer render, fix con `userPicked` + efecto corrector).
**Takeaway**: para comandos que deben EJECUTARSE (abrir panel), `actionType: "submit"`, nunca insert.

### Precedent: Integración del motor como feature usable

**Commit(s)**: `32d874d` (2026-08-06) — 17 archivos, 739 líneas, el más ancho del área.
**Follow-up fixes**: `3ee3b97` (command runner sin cablear), `c1b6e5` (detección de fase se tragaba el path), `09ce750` (cwd).
**Takeaway**: integrar motor nuevo a extension.ts rompe en las costuras — tests punta a punta del cableado desde el inicio.

### Composite Lessons

- **Duplicados por sincronización = fallo #1 del área** (`0c6f467`, `b44c066`, `e979053`, `76376ec`) — la reconciliación FS↔features.json exige id canónico, dedup, y tolerancia a re-scan desde el día 1.
- **El footer pierde overlays al recrearse la webview** (`ba40da0`) — re-montaje idempotente en `webview_ready` + `republish()` es parte del contrato de montaje, no un extra.
- **Suscripciones reactivas: no cancelar en la acción** (`6a3199f` #167) — el ▶ dispara y la vista sigue viva.
- **Leer estado FRESCO al decidir** (`5e4cb2b` #174) — reconciliar en render/SSE-time leyendo el FS, nunca snapshots.
- **UI webview con trampas conocidas** (ficon color, JSX comments, badges indivisibles, insert-vs-submit, carreras de primer render) — pass de pulido presupuestada.
- **Servidor de vida larga = territorio nuevo** — sólo precedentes efímeros (oauth) y de dependencia (ui-server); ciclo de vida, 401-vs-403, puerto/token y descubrimiento de URL son decisiones de diseño primeras.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-08-31_07-08-47_pipeline-panels-sdd-n1-n2-html.md` — FRD fuente de este research (decisions, AC, Recommended Approach).
- `.rpiv/artifacts/research/2026-08-14_23-26-53_frida-codebase-index.md` — índice general del codebase; documenta la propuesta de watcher diferida.
- `.rpiv/artifacts/research/2026-08-28_18-01-10_pista-m-slash-commands-welcome.md` — seam original de las cards de la Welcome (insert → composer_insert).
- `.rpiv/artifacts/discover/2025-07-31_frida-pipeline-porter-rpiv-pi.md` — FRD del porte rpiv-pi: convención de buckets `.rpiv/artifacts/` del upstream (base del mapeo seed).

## Developer Context

**Q (discover: Alcance reencuadrado): ¿Qué problema resuelve el kanban de tareas y quién lo sufre hoy?**
A: Reencuadre del desarrollador: paneles especializados por método SDD (N1 planeación + N2 ejecución) «que el usuario siempre tenga claro en dónde va en ambos ciclos»; el kanban de tareas libres queda sustituido.

**Q (discover: Unidad del panel N1): ¿La tarjeta de N1 es la feature (FRD) o mezcla tareas manuales libres?**
A: Feature (FRD) como tarjeta. Separación nítida planear-vs-ejecutar; las tareas libres quedan fuera.

**Q (discover: Columnas de N1): ¿Columnas exactas de N1 — 4 etapas canónicas o incluir variantes?**
A: `discover | research | design | plan | 🚀 ready-to-ship`. Espejo 1:1 con los comandos del pipeline; las variantes son rutas internas de una etapa, no columnas.

**Q (discover: Origen de verdad de N1): ¿N1 deriva 100% de los artefactos en disco o tiene archivo de estado propio?**
A: `features.json` con estado propio. El desarrollador quiere metadata de control (etapa actual, pausas, orden, enlaces) que los artefactos solos no codifican.

**Q (discover: Mecanismo de avance por etapa): ¿Cómo se disparan las transiciones de una feature?**
A: ▶ por etapa inyecta `/skill:<etapa> <ruta-frd>` al chat Y mueve la tarjeta a esa columna al iniciar (movimiento temprano, igual que N2).

**Q (discover: Puente N1→N2): ¿Cruce de features a N2 — ship manual o auto-aparición en backlog?**
A: Solo el ▶ ship de ready-to-ship crea las fases en N2 (backlog, sin ejecutar nada). Gesto deliberado de «bajar a producción».

**Q (discover: Panel AiDD): ¿Construimos AiDD ya o solo garantizamos el motor genérico?**
A: AiDD después; motor genérico (columnas declarativas + disparadores) garantiza entrada sin rediseño.

**Q (discover: Estructura del HTML externo): ¿Qué secciones nacen en la primera versión del HTML?**
A: Páginas separadas por método, sin mezclar; el hub es la Welcome de Frida («Desde cero»: Desarrollo Autónomo = SDD, Planificar con AiDD); métodos futuros (TEA…) siempre visibles ahí.

**Q (discover: Alcance del HTML): ¿El HTML nace read-only y el control después, o todo junto?**
A: Monitoreo + control juntos (SSE en vivo + POST con token). El muro operativo completo desde la primera versión.

**Q (discover: WIP limits en N1): ¿WIP limits en columnas de N1?**
A: Sin WIP en N1. Bajo volumen de features simultáneas.

**Q (discover: Comando del panel N1): ¿Comando para abrir N1 — /pipeline, /plan, /features?**
A: `/pipeline`. Par natural de `/board`; evita colisión con `/skill:plan`.

**Q (discover: Jerarquía de unidades): ¿Convención de punto (parentOf) o parentId explícito siempre?**
A: Convención de punto + parentId como override opcional (evidence: board.ts:341-346).

**Q (discover: Pulso «en ejecución»): ¿Extender extractPhaseId para ids libres en fase 1?**
A: Fuera — limitación documentada (evidence: plan-utils.ts:80-97).

**Q (discover: Refinamientos de visibilidad Design OS): ¿Qué patrones de visibilidad se adoptan para N1?**
A: Timeline 4-estados (incl. pausada ámbar), reconciliación FS con indicador de desincronización, botón que nombra el siguiente paso, banner ámbar dismissible para saltos, EmptyState con comando accionable, vista detalle por feature en el HTML externo.

**Q (discover: Escritor de features.json): ¿Quién escribe features.json al completar una etapa?**
A: Modelo híbrido: features.json es el estado de verdad, y la tarjeta reconcilia contra los artefactos del FS marcando desfases en ámbar (nadie tiene que ser el escritor perfecto).

**Q (`src/tools/frida-pipeline/skills/discover/SKILL.md:122` + `test/frida-pipeline/skills-lote1.test.ts:93`): ¿Cuál es la raíz primaria de detección/reconciliación de N1 — `.frida/artifacts/` (donde escriben los skills bundled que el ▶ dispara, con buckets plurales `designs/`/`plans/`) o `.rpiv/artifacts/` (donde vive el historial y el encadenamiento `parent:`)?**
A: `.frida/` primaria + `.rpiv/` seed: detección/reconciliación viva sobre la raíz que el runtime de Frida escribe; `.rpiv/artifacts/` se lee una vez como semilla histórica de solo-lectura, sin vigilarla en vivo. (Decisión de checkpoint 2026-08-31.)

**Q (`src/extension.ts:4225` + `src/extension.ts:5547-5561`): `/pipeline` ya existe y monta el banner del orquestador frida-pipeline — ¿qué pasa con ese banner cuando N1 tome el comando?**
A: N1 absorbe el comando: el overlay N1 reemplaza al banner; el estado del orquestador (build/vet/polish) se integra o queda accesible vía `/wf frida-pipeline`. (Decisión de checkpoint 2026-08-31.)

**Q (`webview/components/Welcome.tsx:39,48` + `src/tools/frida-aidd/index.ts:115-116`): la Welcome ya tiene tarjetas «Planificar con AiDD» y «Desarrollar Autónomo» vivas apuntando a `/wf aidd-*` — ¿retarjetamos según el FRD?**
A: Sí: «Desarrollo Autónomo» pasa a submit `/pipeline` (SDD); «Planificar con AiDD» queda roadmap/próximamente; `/wf aidd-plan` y `/wf aidd-ship` siguen existiendo como comandos fuera de la Welcome. (Decisión de checkpoint 2026-08-31.)

## Related Research

- `.rpiv/artifacts/research/2026-08-14_23-26-53_frida-codebase-index.md` — índice del codebase (watchers diferidos, arquitectura general).
- `.rpiv/artifacts/research/2026-08-28_18-01-10_pista-m-slash-commands-welcome.md` — seam Welcome/composer_insert.

## Open Questions

- **Alcance del watch para el SSE <1s**: `emitBoardChange`/emit de features sólo cubre escrituras in-process (board.ts:251-265); los artefactos escritos por bash del agente no emiten. ¿Un solo `fs.watch` recursivo sobre `.frida/artifacts/` (cubre features.json + boards + buckets de etapas) vs. watchers puntuales? Recomendación del análisis: recursivo con debounce y tolerancia a tmp+rename — decisión de diseño.
- **401 vs 403 en POST sin token**: el FRD exige 401; la plantilla (ui-server.ts:634) responde 403. El FRD manda — sólo registrar el delta consciente.
- **Descubrimiento de la URL del monitor**: con puerto efímero (recomendado por EADDRINUSE), la URL no es estable — ¿cómo la Welcome/tarjeta SDD la obtiene? (ancla con URL provista por el host vs. `OutMessage` open_external nuevo de ~5 líneas).
- **Dónde vive el estado del orquestador absorbido**: N1 toma `/pipeline`; el estado build/vet/polish del orquestador (hoy banner) se integra como sección del overlay N1 o queda sólo en `/wf frida-pipeline` — decisión de diseño de la etapa design.
- **Extracción del hub compartido**: la landing del servidor «espeja» la Welcome — ¿`CATEGORIES` se extrae a módulo compartido host/webview/servidor o se duplica? Decisión de diseño.
