---
date: 2026-08-29T00:04:25-0600
author: Edgar F. Fuentes Perea
commit: 202751d
branch: main
repository: frida-code
topic: "M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens"
tags: [research, m2, webview, settingshub, pi-lens, frida-app-walkthrough, frida-traffic2api, project-map]
status: ready
last_updated: 2026-08-29T00:04:25-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Research: M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens

## Research Question

Componente `ProjectMapTab` nuevo en `webview/components/` (contrato `{ state, post }`, registro en `SettingsHub.tsx:13/24/456`) con dos vistas hijas (Funcional desde `docs/funcional/artifacts/inventory.json` de M8 · Técnica vía `projectReport(cwd)` de pi-lens con import dinámico host-side) y un renderer de grafo SVG propio; wiring host: par `OutMessage`/`InMessage` (`project_map` + `open_file` + `export_map`) en el dispatcher existente (`extension.ts:2520`); export reusando el patrón HTML autónomo de M8 (`workflow.ts:581`). Sin persistencia nueva, sin watchers, sin deps pesadas. Encadena el FRD `.rpiv/artifacts/discover/2026-08-28_23-57-41_m2-panel-mapa-del-proyecto.md` (issue #143).

## Summary

El registro de un tab es un contrato de 3 piezas en `SettingsHub.tsx` (unión `SettingsTab:13` + `TABS:24` + rama de render `:456` con firma `{state, post}`) más el canal `open_settings`/`pendingSettingsTab` para apertura por comando — sin tocar `App.tsx`. La discrepancia de entry del FRD quedó resuelta en checkpoint: M2 importa `pi-lens/dist/clients/lens-engine.js` (seam declarado para host adapters; re-exporta `projectReport`), reutilizando textualmente el patrón moat (`existsSync` + `pathToFileURL` + `import()` warn-no-throw). El contrato `projectReport` (dist 3.8.72 en `~/.frida`) retorna `{available:false, hint}` en dos ramas con semántica opuesta — size-skip permanente (NO re-polear) vs cache fría transitoria (re-poll) — y el hint es el único discriminador accesible. La vista Funcional parsea `inventory.json` (schema verificado: `run/screens/actionLog/stoppedBy`; paths relativos al cwd de la corrida) y debe **derivar** los journeys ella misma: los IDs `J01..` no existen en ningún JSON — `journeys.md` lo escribe un LLM; el algoritmo determinista de aristas canónico vive en M9 (`traffic2api/workflow.ts:1053-1064`, hoy no importable). El cruce M9 usa `docs/api/artifacts/inventory.json` → `inv.matrix[].screenIds` (Pnn, misma llave que M8) y `modules[].path` (cwd-relativos, cruzables contra `subsystems.directories` de pi-lens por prefijo de segmentos). Los screenshots se sirven como data-URI host-side on-demand (decisión de checkpoint; CSP `img-src ... data:` ya lo permite en `webview-html-core.ts:17`). `openAtLine` solo sirve texto — los PNG requieren rama `vscode.open` (código nuevo, sin precedente local) y todo `msg.file` exige rebase contra `workspaceCwd()` + guard de contención `safeJoin`. El export HTML es híbrido: webview serializa layout (coordenadas congeladas), host ensambla HTML self-contained con screenshots inlinados base64 y guarda con `showSaveDialog`. **Alerta de working tree**: `dist-webview/assets/index-gE2gVxhC.js` está modificado sin commitear y `test/dist-bundle-integrity.test.ts` (la guarda que cita el FRD) está sin trackear — ambos deben aterrizar junto al primer commit de M2.

## Detailed Findings

### Registro del tab (superficie webview)

- La unión `SettingsTab` (`webview/components/SettingsHub.tsx:13-22`) y el array `TABS` (`:24-34`, id/label/iconName Codicon) son los dos primeros toques; la rama de render `{tab === "usage" && <UsageDashboard state={state} post={post} />}` (`:456-459`) fija el contrato de facto de los tabs recientes: un solo componente que recibe `State` completo + `post`.
- `SettingsTab` se exporta solo para el cast `initialTab={(settingsTab ?? "providers") as SettingsTab}` en `webview/App.tsx:999` — agregar `"projectMap"` a la unión no rompe ningún otro archivo.
- El `useEffect` de carga del hub (`SettingsHub.tsx:54-64`) corre al montar y en cada cambio de tab; pero los tabs recientes (usage/productivity/codebaseIndex/environment) cargan desde su propio componente — molde `ProductivityTab.tsx:44-47` (`useEffect` + `post({type:"list_usage", period, scope})` con `eslint-disable-line`). Para "carga al abrir + refresh manual" (FR-10) el patrón componente-interno + botón refresh (`EnvironmentTab.tsx:245-254`, `disabled={isChecking}` + Codicon `refresh` spin) es el exemplar.
- El conmutador Funcional/Técnica es estado local del componente (análogo `period/scope` de `ProductivityTab.tsx:37-38`), NO campo del store global.
- Apertura por comando: `pendingSettingsTab` se setea antes de `frida.openPanel` y se flushea en `webview_ready` (`src/extension.ts:2544-2546`); en caliente, el `.then()` postea directo (molde comando `frida.codebaseIndex` en `extension.ts:5954-5967`). El `key={settingsTab ?? "default"}` (`webview/App.tsx:992`) fuerza re-monte para entrar al tab pedido.
- La vista es una `WebviewView` lateral con `retainContextWhenHidden: true` (`src/extension.ts:5962-5966`); cerrarla dispara `onDidDispose` (`:2425-2427`) y una reapertura re-corre `resolveFridaView` → reload completo.

### Búsqueda global (decisión: fuera)

- La búsqueda filtra dominios de datos ya en `state` (`matchedProviders`/`matchedModules`/`matchedSkills`/`matchedCommands`/`matchedEnvDeps`, `SettingsHub.tsx:70-124`); es por dominio, no por tab. Los tabs dashboard (`usage`, `productivity`, `codebaseIndex`) NO participan con costo cero: no aparecen en ningún `matched*` y no renderizan durante la búsqueda. `projectMap` queda fuera (decisión de checkpoint) — mismo género dashboard-visual.

### Estado global, busy y re-poll

- Campo nuevo `projectMap?` en `State` (`webview/types.ts:774`), molde `codebaseIndex?: CodebaseIndexUiState` (`types.ts:853`): banderas de disponibilidad, `busy`/`busySince` epoch del host, payload del grafo. La conmutación de vistas NO va en `State`.
- Convención #111 — el reloj vive en el store del host, no en el tab: `let ciBusySince: number | null` (`src/extension.ts:602`), seteado en `:3203`, reseteado al terminar; el tab solo deriva (`IndexTab.tsx:688-697`, lazy initializer para sobrevivir re-montes). M2 debe seguir #111 o "construyendo…" se reinicia a 0 en cada cambio de tab.
- Publicación por push: `postCodebaseIndexState()` (`src/extension.ts:617-655`) mergea estado de wrapper + lets del host y se postea en `webview_ready` (`:2529` — esto ES el cacheo para re-monte frío), al arrancar acción, en cada tick, y al terminar. Contrario ejemplar: `lensStatus` NO se re-postea en `webview_ready` y tras re-monte frío el badge se pierde — M2 no debe copiar ese hueco.
- Dispatcher async con catch-que-postea-fallback: case `codebase_index_action` (`src/extension.ts:3166-3290`) — acción read-only sin busy (`:3178-3191`, try/catch que SIEMPRE responde), busy con `ciBusySince = Date.now()` antes del trabajo async (`:3200-3204`), poll host-side de 2s best-effort (`:3237-3258`), `finally` que limpia el poll SIEMPRE (`:3272-3277`), catch final que convierte error en `lastLine` visible (`:3280-3288`).
- Reducer webview trivial: `case "codebase_index_state": return {...state, codebaseIndex: msg.state}` (`webview/store.ts:608-609`).
- No existe timeout sobre acciones host hoy (la única salida del tab Index es Detener → `reloadWindow`, `:3193-3197`); para M2 las opciones coherentes: botón cancelar que corte el polling, tope de ticks sin señal, o `Promise.race` con timeout.

### Contrato pi-lens `projectReport` (entry `lens-engine.js`)

- Instalación de referencia: `~/.frida/npm/node_modules/pi-lens` = **3.8.72** (`~/.pi/agent/npm/...` = 4.1.2 diverge; instalación npm flat, los archivos de `dist/clients/` resuelven externos por walk-up).
- Seam declarado: header de `lens-engine.js:1-14` ("host adapters talk ONLY to this module"); re-exporta `projectReport` y `renderCompactProjectReport` en `lens-engine.js:35`. Sus imports estáticos (`:16-27`) arrastran la capa LSP completa + dispatch + word-index — evaluación one-shot del árbol (sin spawns de LSP, sin escrituras de caches al importar; verificado módulo por módulo), mutaciones de registro idempotentes en `dispatch/integration.js:48-96`.
- Alternativa descartada en checkpoint: `project-report.js` directo (solo 3 imports estáticos puros, `project-report.js:36-39`) — más liviano pero viola la regla del seam; ambos devuelven JSON idéntico (re-export puro).
- La entrada `dist/index.js` que usa el patrón moat (`moat-factories.ts:59-66`) es la entry de *extensión* (factory que recibe `pi`): NO sirve para invocar `projectReport` sin sesión pi.
- Patrón moat reutilizable textualmente (`moat-factories.ts:77-99`): sonda `fs.existsSync` → estado "no instalado" sin throw; `await import(pathToFileURL(entry).href)` (lección #57 — import() ESM exige URL, probado en producción desde M1); try/catch → `console.warn` + return undefined. Para M2: destructurar export nombrado `const { projectReport } = await import(url)`. Advertencia: el `await import("./review-graph/builder.js")` interno de `projectReport` (`project-report.js:505`) NO está envuelto — el caller debe atrapar rechazos de la llamada completa, no solo del import.
- Firma `projectReport(cwd, options)` (`~/.frida/npm/node_modules/pi-lens/dist/clients/project-report.js:501`): `options.limit` clampea TODAS las secciones rankeadas (`DEFAULT_LIMIT = 10`, `:40-43`; excepción: el set de exclusión `entryPointFiles` es uncapped, `:237-243`); `options.focus` re-rankea hubs/entryPoints/riskHotspots sin expandir scope; `options.view` solo se hace echo — el render compacto es función separada (`renderCompactProjectReport`, `:569+`). Para M2: pedir el JSON (sin `view`) y renderizar en React.
- Dos ramas `available:false` (`:506-542`): **size-skip permanente** — hint `review graph disabled: project has N files, cap is M — raise maxProjectFiles...` y NO dispara build (re-polear aquí es "actively wrong guidance", `:512-515`); **cache fría transitoria** — `triggerBackgroundGraphBuild(cwd)` fire-and-forget con dedup por cwd (`:474-498`) + hint "retry this call shortly". El hint es el ÚNICO discriminador accesible desde el seam (`getReviewGraphSizeSkipVerdict` NO se re-exporta); parsear lenient (`/^review graph disabled/i`) y tratar el resto como texto de display. En 4.1.2 los hints cambiaron de texto y agregaron `lastBuildAttempt` + rama "build already running" — NO hardcodear strings completos.
- Secuencia real en extension host fresco: 1er poll → "build kicked off"; si el repo excede el tope, el build graba el verdict in-memory (TTL 15 min) → 2º poll → "review graph disabled". El size-skip puede tardar DOS polls en revelarse.
- Payload caliente `{available:true, trust, hubs, entryPoints, subsystems, riskHotspots, deadWeight}` (`:544-558`): `hubs[] = {file, fanIn, blastRadius, role?, suggestedNext}`; `entryPoints[] = {file, fanIn, fanOut, suggestedNext}`; `subsystems = {directories: string[], edges: [{from,to,count}], cycles: [{dirs, edgeCount}], violations: [...]}` — **NO existe `subsystems[].name`** (asunción del FRD corregida); `riskHotspots[] = {file, fanIn, maxComplexity, score}` con `score = fanIn × maxComplexity`; `deadWeight = {files: [{file}], disclaimer}`. Todos los `file` son display paths cwd-relativos (`toDisplayPath`, `:57-64`) y llevan `suggestedNext: {tool:"module_report", path}` (`:65-67`) — aprovechable por el clic→archivo.
- Estabilidad: las 6 secciones no cambiaron campo-por-campo entre 3.8.72 y 4.1.2; lo que evolucionó son hints y ramas unavailable. Sin `.d.ts` exportados — la interfaz del contrato se declara en el lado Frida.
- Cadencia de re-poll consistente con #142: 2-3 s con backoff (2s→5s→10s), acotado a ~60-90 s o ~10 intentos; al agotar → detener spinner, mostrar hint verbatim + botón Reintentar. Paro inmediato si hint size-skip. Nota: el graph puede ya estar en disco (`~/.pi-lens/projects/<slug>/cache/review-graph.json`) si el usuario chateó con lens activo antes — primer paint caliente.

### Fuente funcional: `inventory.json` de M8

- Writer único determinista: `inv = {run, screens, actionLog, stoppedBy, stoppedByTime}` (`src/tools/frida-app-walkthrough/workflow.ts:313-318`), serializado con `invSerialize()`/`invWrite()` a `docs/funcional/artifacts/inventory.json` (`:320-324`) en cada registro (persistencia incremental).
- `screens[]` (`:410`): `{id: "P01..", canon, origin, title, firstSeenStep, snapshot, screenshot, purpose, userRoles, mainElements, validationEvidence}` — `snapshot` y `screenshot` son **paths relativos al cwd de la corrida** (`docs/funcional/artifacts/steps/NNN-snapshot.json`, `docs/funcional/screenshots/Pnn-slug.png`; `screenshot: ""` si falló). `actionLog[]` (`:468`): `{step, screenId, kind, description, ref, url, outcome}` con `kind ∈ {click, form, validate, goto, done}` y `outcome ∈ {"ok", "fail: <200 chars>", "unknown-kind:<kind>"}`. `stoppedBy ∈ {"", "budget", "time", "stepLimit", "done"}`.
- **Journeys `J01..` no existen en JSON**: `journeys.md` lo escribe el agente LLM (writer `ANALYZE_WRITERS[1]`, `workflow.ts:182-186`); ni el generador ni `skills.ts` contienen algoritmo de journeys. La vista Funcional debe derivarlos del actionLog plano. El precedente canónico de aristas es el join inter-pasos de M9: `progressed = !!(next && next.screenId !== a.screenId)` (`src/tools/frida-traffic2api/workflow.ts:1053`), clasificación fail/validate/no-progression/traversed (`:1056-1064`) — hoy vive dentro de un template literal (no importable); re-implementación host-side necesaria.
- Detección de ausencia: probe `test -s docs/funcional/catalogo-pantallas.md || test -s docs/funcional/artifacts/inventory.json` (`traffic2api/workflow.ts:792`) — molde host-side con `fs.existsSync`/`statSync`. Validación de corrupción: `JSON.parse` en try/catch → null + exigir `Array.isArray(screens) && Array.isArray(actionLog)` (canonizado en `:996-1002`). Degradación sin M8: registrar workaround accionable "corre el patrón app-walkthrough (M8) para generar docs/funcional/" (texto exacto en `:795`).
- Defensivos: `screenId` huérfano (imposible del writer, posible por edición manual) → marcar/excluir, nunca `undefined` en layout; `stoppedBy: "budget"` = mapa incompleto por diseño (la pantalla que rebasa el tope no se registra) → badge "cobertura parcial" con motivo.
- No existe `docs/funcional/` real en este repo (los artifacts se generan en el workspace de la app objetivo); ejemplos vivos fieles: `test/frida-app-walkthrough/e2e.test.ts:399-424` (generado por el motor, 5 pantallas) y `test/frida-traffic2api/e2e.test.ts:497-560` (fixture literal con outcome fail).

### Cruce técnico↔funcional: matriz M9

- Fuente canónica: `docs/api/artifacts/inventory.json` (header `traffic2api/workflow.ts:64-66`: registro auditable con `matrix/orphans/deadZone/graph`). `inv.matrix` lo produce el agente correlacionador (schema `MATRIX_SCHEMA`, `:605`) y la normalización asigna `id: "M01.."` por orden de respuesta (`:1267-1273`).
- Forma de fila: `{id, functionality, screenIds: ["P02"], endpoints: [{id, method, path}], modules: [{path, evidence}], evidence}` — `endpoints` es el único campo required; `modules[].path` son rutas cwd-relativas free-form del LLM (normalizar: strip `./`, resolver contra workspace root, tolerar absolutos accidentales).
- Join funcional: `matrix[].screenIds ⊆ Set(screens[].id)` de M8 (IDs Pnn estables y compartidos por diseño — M9 usa el mismo generador). Join técnico: `dirname(modules[].path)` contra `subsystems.directories` de pi-lens por **prefijo exacto de segmentos completos** (`"src/server.js"` → cluster `"src"`); fuzzy por basename produce falsos cruces (`server.js`/`index.ts` colisionan). Los clusters son 1er segmento bajo la raíz, `"(root)"` para raíz, 2 segmentos solo si el top domina ≥40%.
- Degradación documentada: sin `docs/funcional/` la matriz degrada a endpoint↔módulo (`inv.siblings.funcional === false`, `:792-810`) — M2 omite el cruce con nota, sin error (FR-7/FR-8).

### Evidencia visual (screenshots) — decisión: data-URI host-side

- CSP actual (`src/webview-html-core.ts:14-19`): `img-src ${opts.cspSource} data:` ya permite data-URIs — probado en producción por `Turn.tsx:76` (`src={`data:${im.mimeType};base64,${im.data}`}`) con contrato `ImageAttachment` (`webview/types.ts:52-55`).
- `localResourceRoots` fijo a `dist-webview`+`media` (`src/extension.ts:2417-2420`) — los PNG del workspace quedan inalcanzables por `asWebviewUri` sin ensanchar raíces (opción descartada en checkpoint: ampliaría el perímetro de lectura del origen webview).
- Mecánica elegida: host lee el PNG con guard de contención (molde `safeJoin` — `resolve(root, name)` + `startsWith(resolve(root) + sep)`, `src/tools/frida-pipeline/agents-sync.ts:89-94`) y postea data-URI on-demand (al expandir/clic en nodo); base64 infla +33% → jamás postear el set completo de golpe.

### Clic-en-nodo → `open_file`

- `OutMessage` sin variante `open_file` hoy (unión `webview/types.ts:1062-1243`, termina en `check_environment`); dispatcher `handleWebviewMessage` (`src/extension.ts:2520`) sin `default` — un case faltante se ignora en silencio.
- `openAtLine` (`src/extension.ts:4691-4698`) = `openTextDocument` + `showTextDocument` con `Position` 0-based (`line` 1-based → `line-1`); su único caller hoy es el QuickPick de `checkWorkflows` con paths absolutos resolvibles.
- Grieta binarios: `openTextDocument` decodifica PNG como texto (basura + pesado). Rama alternativa necesaria: `vscode.commands.executeCommand("vscode.open", uri)` — sin precedente en el repo (único pariente: `vscode.openFolder` en `src/worktree/command.ts:217`).
- Grieta paths: los paths del inventory son relativos al cwd de la corrida → rebase obligatorio `path.resolve(workspaceCwd(), invPath)` contra `workspaceCwd()` (`src/extension.ts:871-873` — `workspaceFolders[0]` con fallback `process.cwd()`; no multi-root). Los `actionLog[].ref` NO son paths (refs de DOM `@eN`) — no son evidencia abrible.
- Validación anti-traversal: `safeJoin(workspaceCwd(), msg.file)` antes de abrir — mismo guard para `open_file` y para el lector de PNGs del data-URI (nota: `resolve` no sigue symlinks; el patrón de la casa no hace `realpath`).

### Export HTML autónomo

- Molde M8 (`src/tools/frida-app-walkthrough/workflow.ts:576-615`): `escHtml` (`:578-580`), `dataJson = JSON.stringify(...).split("</").join("<\\/")` (`:581`), CSS inline con paleta fija sin tokens `--vscode-*` (`:586-593`: `#0f1117`/`#e6e8ee`/`#161a26`/`#232a3d`, system-ui), render vanilla `createElement` sin `innerHTML` (`:597-608`). NO es importable (fragmento de template literal) — M2 replica la estructura en módulo host nuevo.
- Limitación del molde: M8 es self-contained sin CDN pero NO single-file — screenshots por ruta relativa que solo funcionan porque `index.html` vive junto a `screenshots/`. El export de M2 va a ruta arbitraria → inlinar base64 host-side (`workspace.fs.readFile` → `data:image/png;base64`), degradando a nodo sin imagen si falta el archivo.
- Molde guardado (`exportUsage`, `src/extension.ts:5905-5938`): `showSaveDialog({defaultUri, filters})` → cancelar = no-op → `workspace.fs.writeFile(uri, Buffer)` → toast. `writeFile` no tiene el límite práctico de `postMessage` — varios MB OK.
- División: webview serializa SU vista actual (nodos/aristas con x,y congeladas del layout + rutas de screenshots + filtros) vía `OutMessage` tipo `export_map`; host ensambla HTML + inlina screenshots + guarda. Re-layout en el export queda descartado (duplicaría el algoritmo y divergiría de lo que el usuario ve); `view:"compact"` + `renderCompactProjectReport` solo útil si se quiere texto plano.

### Render SVG, perf y a11y

- Precedentes SVG: exactamente dos — `DonutChart.tsx:28` (geometría manual, dasharray, cap `slice(0,8)`, empty state `chart-empty`) y `FridaRobotIcon.tsx:21` (`aria-label`+`role="img"`, `stroke="currentColor"` para heredar tema). No hay d3/reactflow en `package.json:480-533`.
- Cientos de nodos colapsados: molde `TreePanel.tsx` — `Set` de plegados (`:162`), `visibleIds` memoizado que ELIMINA descendientes de plegados del render (`:223-261`), `flatVisible` para teclado (`:262-273`), render solo de visibles (`:460`, `:591-604`). Caps `slice(0,N)` y contención CSS (`max-height`+`overflow`, `styles.css:10171-10176`). **Sin** precedente de `React.memo`/virtualización/`content-visibility` (0 matches) — no introducirlos.
- a11y: 6 reglas `@media (prefers-reduced-motion: reduce)` verificadas en `webview/styles.css` (`:1370`, `:3681`, `:3715`, `:7291`, `:11018`, `:11405` — la de `:11405` desactiva transiciones de chevron/fila del TreePanel, molde directo para animaciones de colapso del mapa) + 1 inline en `webview/index.html:82-86`. Teclado: roving tabindex + ↑↓←→/Enter/Esc (`TreePanel.tsx:352-392`, `:500-505`); diálogos Esc/Enter (`IndexTab.tsx:167-177`). `Codicon.tsx:31-44` con `aria-label`/`aria-hidden`.
- Build: `npm run build:webview` (vite, `package.json:469`) → `dist-webview/` con hash de contenido (`vite.config.ts`: `emptyOutDir: true`, target es2022); commit conjunto fuente+bundle. Guarda `test/dist-bundle-integrity.test.ts` — valida presencia (`:17-24`) y `node --check` por bundle (`:26-36`), nada más. Motor congelado literal (`core/registry.ts:34-40`, `REGISTRY_FROZEN`) — M2 no lo toca.
- Tests del tab: molde A componente (`test/productivity-tab.test.ts:77-118` — `renderToStaticMarkup` + `post = vi.fn()` + aserciones `toContain`; los efectos NO corren, documentado en `IndexTab.tsx:701-704`); molde B contrato InMessage vía `reduce(initialState, msg)` (`test/webview-store.test.ts:16-21`).

## Code References

- `webview/components/SettingsHub.tsx:13-34` — unión `SettingsTab` + array `TABS` (toques 1-2 del registro)
- `webview/components/SettingsHub.tsx:54-64` — `useEffect` de carga por tab (molde hub-level; alternativa componente-interno)
- `webview/components/SettingsHub.tsx:70-124` — búsqueda global por dominios de datos (projectMap queda fuera)
- `webview/components/SettingsHub.tsx:456-459` — ramas de render `{state, post}` de los tabs recientes (molde del contrato)
- `webview/App.tsx:128-132` — consumo de `open_settings` antes del reducer (UI pura, sin dispatch)
- `webview/App.tsx:991-999` — montaje del hub con `key={settingsTab}` + cast `as SettingsTab`
- `webview/types.ts:774` — interface `State` (campo nuevo `projectMap?`)
- `webview/types.ts:1062-1243` — unión `OutMessage` (variantes nuevas `open_file`/`export_map`)
- `webview/components/ProductivityTab.tsx:37-66` — exemplar carga-on-mount + stub loading + empty state + guard de coincidencia filtro/dato
- `webview/components/IndexTab.tsx:688-742` — convención #111: reloj derivado de `busySince` del host + auto-consulta condicionada
- `webview/components/TreePanel.tsx:162-273` — `Set` de plegados + `visibleIds`/`flatVisible` memoizados (render condicional de colapso)
- `webview/components/TreePanel.tsx:352-392` — navegación por teclado (roving tabindex, ↑↓←→/Enter/Esc)
- `webview/components/usage/DonutChart.tsx:22-53` — precedente SVG manual (geometría JS puro, cap de datos, empty state)
- `webview/components/Turn.tsx:76` — render de data-URI base64 (contrato del screenshot on-demand)
- `webview/components/Codicon.tsx:31-44` — iconografía con aria
- `webview/styles.css:1370` · `:11018` · `:11405` — reglas `prefers-reduced-motion` (molde para animaciones del mapa)
- `src/extension.ts:871-873` — `workspaceCwd()` (base del rebase de paths relativos)
- `src/extension.ts:2408-2433` — `resolveFridaView`: `localResourceRoots` [dist-webview, media] + HTML + `onDidReceiveMessage`
- `src/extension.ts:2520-2547` — dispatcher `handleWebviewMessage` + case `webview_ready` (flush `pendingSettingsTab` + re-posteo de estado cacheado)
- `src/extension.ts:5954-5967` — comando `frida.codebaseIndex` (molde apertura por command palette)
- `src/extension.ts:5905-5938` — `exportUsage`: `showSaveDialog` + `workspace.fs.writeFile` + toast (molde del export)
- `src/extension.ts:617-655` — `postCodebaseIndexState()`: publicación push + cacheo para re-monte (molde de `postProjectMapState`)
- `src/extension.ts:3166-3290` — case `codebase_index_action`: anatomía completa de acción async host (busy, poll 2s, finally, catch)
- `src/extension.ts:4691-4698` — `openAtLine` (solo texto; base del case `open_file`)
- `src/webview-html-core.ts:14-19` — CSP con `img-src ${cspSource} data:` (data-URIs ya permitidas)
- `src/webview-html.ts:7-21` — `getWebviewHtml` + `asWebviewUri` (único consumidor de resource roots)
- `src/tools/frida-pipeline/agents-sync.ts:89-94` — `safeJoin` (guard de contención para `msg.file` y lectura de PNGs)
- `src/tools/frida-extensible-workflows/moat-factories.ts:59-66` — `piLensEntryPath()` (única fuente del layout `dist/` de pi-lens)
- `src/tools/frida-extensible-workflows/moat-factories.ts:77-99` — `createFridaLensFactory`: sonda + `pathToFileURL` + import warn-no-throw (subconjunto textual a reutilizar)
- `src/tools/frida-app-walkthrough/workflow.ts:313-330` — objeto `inv` + `invSerialize`/`invWrite` (writer determinista del inventory)
- `src/tools/frida-app-walkthrough/workflow.ts:364-410` — `snapPath`/`shot` relativos + push de screen con forma completa
- `src/tools/frida-app-walkthrough/workflow.ts:468` — push de actionLog (`step/screenId/kind/description/ref/url/outcome`)
- `src/tools/frida-app-walkthrough/workflow.ts:576-615` — generador HTML self-contained de M8 (molde del export)
- `src/tools/frida-traffic2api/workflow.ts:64-72` — header: registro auditable `docs/api/artifacts/inventory.json`
- `src/tools/frida-traffic2api/workflow.ts:792-810` — probe `test -s` + degradación sin M8 (texto del workaround)
- `src/tools/frida-traffic2api/workflow.ts:996-1012` — validación defensiva del inventory M8 al consumirlo
- `src/tools/frida-traffic2api/workflow.ts:1048-1064` — join inter-pasos del actionLog (algoritmo canónico de aristas)
- `src/tools/frida-traffic2api/workflow.ts:1266-1279` — normalización de `inv.matrix` (schema MATRIX_SCHEMA en `:605`)
- `~/.frida/npm/node_modules/pi-lens/dist/clients/lens-engine.js:1-35` — seam de host adapters + re-export de `projectReport` (entry elegido)
- `~/.frida/npm/node_modules/pi-lens/dist/clients/project-report.js:501-567` — `projectReport(cwd, options)`: ramas unavailable + payload de 6 secciones
- `test/dist-bundle-integrity.test.ts:17-36` — guarda del bundle (presencia + `node --check`; hoy SIN trackear en git)
- `test/productivity-tab.test.ts:77-118` — molde de test de componente webview (`renderToStaticMarkup` + `post=vi.fn()`)
- `test/webview-store.test.ts:16-21` — molde de test de contrato InMessage (reducer)

## Integration Points

### Inbound References

- `webview/App.tsx:146-149` — `webview_ready` al montar: dispara el flush frío (`pendingSettingsTab`) y el re-posteo de estado cacheado que M2 debe extender con `postProjectMapState()`
- `webview/store.ts` (reducer) — case nuevo `project_map_state` estilo `codebase_index_state` (`store.ts:608-609`); lección #126 (`c37ef71`): dispatcher host + case reducer + render condicional aterrizan JUNTOS
- `webview/App.tsx:221` — `post(msg)` singleton `acquireVsCodeApi`: único canal webview→host de `open_file`/`export_map`
- Sesiones pi con moat lens (`moat-factories.ts:123-135`) — comparten proceso de extension host: un graph build de fondo de pi-lens y el estado `PI_LENS_CONFIG_PATH` (mutaciones OFF, irrelevante para read-only) conviven con el import host-side de M2

### Outbound Dependencies

- `~/.frida/npm/node_modules/pi-lens` (3.8.72) — `lens-engine.js` → `projectReport(cwd, {limit?, focus?, view?})`; instalación sondeada con `piLensEntryPath()` como fuente única del layout
- `docs/funcional/artifacts/inventory.json` (M8) — lectura host-side con validación de forma (`screens`/`actionLog` arrays)
- `docs/api/artifacts/inventory.json` (M9) — lectura del campo `matrix` para el cruce (FR-8, condicional a existencia)
- Archivos del workspace (PNGs de `docs/funcional/screenshots/`, snapshots, fuentes) — lectura con guard `safeJoin(workspaceCwd(), path)` para data-URIs y `open_file`
- `vscode.commands.executeCommand("vscode.open", uri)` — rama binarios del `open_file` (código nuevo, sin precedente local)

### Infrastructure Wiring

- Dispatcher `handleWebviewMessage` (`src/extension.ts:2520`) — cases nuevos `project_map` (carga/refresh), `open_file` (clic en nodo), `export_map` (guardado)
- `webview_ready` (`src/extension.ts:2523-2547`) — agregar `postProjectMapState()` junto a `postCodebaseIndexState()` (`:2529`) para sobrevivir re-montes fríos
- Apertura por comando (opcional): `pendingSettingsTab = "projectMap"` + comando en `contributes.commands` (`package.json`), molde `frida.codebaseIndex`
- Re-poll del build: poll host-side estilo `:3237-3258` (2s best-effort, `finally` que limpia SIEMPRE) o `setInterval` webview con cleanup — verdad del estado en el host (#111)
- Build/commit: `npm run build:webview` + commit conjunto fuente+`dist-webview/`; guarda `test/dist-bundle-integrity.test.ts` en cada fase

## Architecture Insights

- **Contrato de tab = 3 piezas + carga interna**: unión `SettingsTab` + `TABS` + rama `{state, post}` (`SettingsHub.tsx:13/24/456`); la carga vive en el componente (molde ProductivityTab), no en el `useEffect` del hub. `App.tsx` no se toca para que el tab exista.
- **El patrón `{state, post}` puro es el perfil de tab sin follow-ups** (Productividad: cero fixes); los tabs con estados de larga duración + guards null acumulan follow-ups (Index: 6+). M2 combina ambos perfiles: build lento de pi-lens + nodos condicionados a datos que pueden faltar.
- **Verdad del estado en el host, pushes al webview**: `postXxxState()` + lets módulo-nivel + re-posteo en `webview_ready` — el patrón que hace que re-montes fríos no pierdan estado (y que `lensStatus` hoy viola).
- **El seam mensaje→reducer es el punto de quiebre histórico del wiring** (#126): publicar desde el host no basta si el case del reducer o el render faltan.
- **Los contratos upstream se congelan en mocks honestos**: `inventory.json` (schema del writer M8) y `projectReport` (6 secciones estables 3.8.72→4.1.2, hints tratados como opacos) — verificar contra el artefacto real, no contra supuestos (lecciones `30ef616`/`9d6d8bb`).
- **Degradación digna heredada de M9 (R7)**: sin `docs/funcional/` → estado vacío accionable con workaround textual; sin matriz M9 → cruce omitido con nota; size-skip de pi-lens → NO re-polear, mostrar acción.
- **Colapso = render condicional real** (TreePanel): los nodos plegados salen del DOM, no se esconden con CSS; caps `slice(0,N)` + contención de scroll; sin virtualización/`React.memo` (sin precedente).
- **El dist de pi-lens es ESM en host CJS-esbuild**: `await import(pathToFileURL(...).href)` funciona (probado desde M1 #57); el catch debe degradar ruidosamente a estado vacío, nunca al silencio (lección `f3112ec`).

## Precedents & Lessons

7 grupos de cambios similares analizados.

### Precedent: Tabs nuevos del SettingsHub (Entorno · Productividad · Uso · Index)

**Commit(s)**: `78335d1` (Refs #99), `d7d24c1` (Refs #102), `30f50bd`, `eb935a1`, rediseños `0d25c13`/`f5879df` (2026-08)
**Blast radius**: Entorno 13 archivos; Productividad 9; Usage 26 (+2 643); codebase-index 20 (+5 833) — siempre con rebuild de `dist-webview/` incluido.

**Follow-up fixes**:

- `117605b` — reloj del index parpadeaba al cambiar tab (→ #111)
- `379a8b7` — botón "Cambiar motor" no abría modal (guard falsy para null)
- `c6d3123`, `4f8b95a`, `1160561`, `9cdd677` — iteraciones UX del tab Index (detener, progreso, toggle, flush frío)
- `5719c77`/`d4aca29` — reformateo biome post-commit (correr formato ANTES de commitear)

**Takeaway**: M2 combina el perfil de tab sin mensajes (Productividad, 0 fixes) con el de estados largos (Index, 6+ fixes) — el re-poll de cache fría y los guards null son la fábrica de follow-ups.

### Precedent: M8 frida-app-walkthrough (fuente del mapa Funcional)

**Commit(s)**: `d958d4f` (Refs #133, 2026-08-24) — 16 archivos +7 496, motor 0 líneas.
**Follow-up fixes**: `30ef616` (mismo día) — el mock del e2e mentía sobre el contrato del binario agent-browser: `String(data)` sobre data tipado producía `"[object Object]"` (dedup colapsado a 1 pantalla) y el daemon resuelve rutas relativas contra SU cwd (screenshots ENOENT).
**Takeaway**: el defecto no fue el código propio sino suponer el contrato upstream — M2 consume dos contratos ajenos (`projectReport`, `inventory.json`): verificar contra el dist/JSON real antes del renderer.

### Precedent: M9 frida-traffic2api (fuente del cruce)

**Commit(s)**: `b45375b` + `d5da7ad` (Refs #135, 2026-08-27).
**Follow-up fixes**: `9d6d8bb` (mismo día) — `screenshot` sin `--full` capturaba solo viewport (contrato upstream no leído).
**Takeaway**: segundo caso del mismo patrón en 3 días; además M2 hereda la degradación digna R7 (matriz sin M8 → endpoint↔módulo + gap registrado).

### Precedent: Import dinámico host-side de pi-lens (Windows)

**Commit(s)**: `f3112ec` (Refs #57, 2026-08-17) — `import(pathToFileURL(entry).href)`; sin follow-ups.
**Takeaway**: el path crudo falla SOLO en Windows y el catch silencioso ocultaba la feature completa — M2 hereda `pathToFileURL` + catch ruidoso a estado vacío.

### Precedent: Wiring mensaje webview→host→reducer (#126)

**Commit(s)**: `c37ef71` (2026-08-22) — `tree_data`/`fork_points` hacían `return` antes del `dispatch`.
**Takeaway**: case del dispatcher + case del reducer + render condicional aterrizan y prueban juntos — el host puede publicar bien y el panel seguir en blanco.

### Precedent: dist-webview desincronizado

**Commit(s)**: `590b946` (Refs #43) — commit dedicado solo para reparar el olvido del rebuild; `d01621c` institucionalizó el bundle prístino determinista.
**Takeaway**: todo commit que toque `webview/` regenera y commitea `dist-webview/` en el MISMO commit. **Estado actual**: el working tree tiene `dist-webview/assets/index-gE2gVxhC.js` modificado sin commitear y `test/dist-bundle-integrity.test.ts` sin trackear — aterrizar antes/durante M2.

### Precedent: Spinner eterno (issue #142 · Refs #25/#113/#114)

**Commit(s)**: `92eca3d`, `c6d3123`, `9cdd677` — progreso visible + flush frío respetado.
**Takeaway**: la cache fría de pi-lens es el análogo exacto de la instalación del index: "construyendo…" con re-poll que resuelve solo, acotado; insumo faltante/corrupto → vacío accionable, jamás loading sin fin.

### Composite Lessons

- Contratos upstream verificados contra el artefacto real y congelados en mocks honestos con tests de regresión (`30ef616`, `9d6d8bb`).
- Import dinámico = `pathToFileURL().href` + catch ruidoso al estado vacío (`f3112ec`).
- Estados largos y guards null = fábrica de follow-ups; re-poll que resuelve solo + botones probados contra `null`/`undefined` + degradación digna sin matriz (`92eca3d`, `379a8b7`, R7 de M9).
- Seam mensaje→reducer aterriza completo en un commit (`c37ef71`).
- Commit atómico fuente+`dist-webview/`+tests; biome antes de commitear (`590b946`, `5719c77`).
- Motor `frida-extensible-workflows` congelado: M8/M9/M10 aterrizaron con 0 líneas al motor; único seam `moat-factories.ts:59-99`.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-08-28_23-57-41_m2-panel-mapa-del-proyecto.md` — FRD de M2 (input de este research)
- `.rpiv/artifacts/research/2026-08-24_14-29-54_app-walkthrough-m8.md` — research de M8
- `.rpiv/artifacts/designs/2026-08-24_15-21-15_app-walkthrough-m8.md` — design de M8
- `.rpiv/artifacts/plans/2026-08-24_17-14-22_app-walkthrough-m8.md` — plan de M8
- `.rpiv/artifacts/validation/2026-08-24_18-09-01_m8-skill-pack-frida-app-walkthrough.md` — validación de M8 (lessons de commits)
- `.rpiv/artifacts/research/2026-08-26_13-00-12_traffic2api-m9.md` — research de M9
- `.rpiv/artifacts/designs/2026-08-26_13-25-20_traffic2api-m9.md` — design de M9 (R7 degradación digna)
- `.rpiv/artifacts/research/2026-08-24_19-37-37_m1-understand-app.md` — research de M1 (moat lens)
- `.rpiv/artifacts/research/2026-08-28_18-01-10_pista-m-slash-commands-welcome.md` — research Pista M (dist-webview commiteado, seam mensaje→reducer)

## Developer Context

**Q (discover: Intención — ¿a quién le duele?): ¿A quién le duele que el entendimiento viva solo en markdown, y cómo se ve el éxito la primera vez que abre el panel?**
A: Stakeholder / demo — alguien que no va a leer markdown; necesita VER el entendimiento en una pantalla y entenderlo en minutos.

**Q (discover: El panel vive como tab del SettingsHub): ¿Tab nuevo en SettingsHub (unión + TABS + rama de render)?**
A: Confirmar.

**Q (discover: Clic en nodo → `open_file` conectado a `openAtLine`): ¿`OutMessage` `{type:"open_file", file, line?}` + case en el dispatcher que invoque `openAtLine()`?**
A: Confirmar.

**Q (discover: Mapa técnico vía import dinámico de `lens-engine.js`): ¿Import dinámico host-side de pi-lens llamando `projectReport(cwd)`; sin MCP ni subprocess?**
A: Confirmar (frente a alternativas MCP stdio / CLI).

**Q (discover: Fuente del mapa funcional = `inventory.json` de M8): ¿Leer `docs/funcional/artifacts/inventory.json`; no parsear markdown?**
A: Confirmar.

**Q (discover: Alcance v1 — núcleo + hotspots + cruce + export): ¿Qué entra en v1?**
A: Núcleo + overlay de hotspots + cruce técnico↔funcional + export/compartir (cruce condicionado a la matriz M9; degradación digna sin ella).

**Q (discover: Render React nativo vs embeber el `index.html` de M8): ¿React nativo en la webview?**
A: React nativo (theming `--vscode-*`, clic→archivo y cruce en UNA superficie; layout SVG propio, sin lib pesada).

**Q (discover: Presentación por defecto con inventarios grandes): ¿Colapsado con toggle o todo expandido?**
A: Colapsado con toggle.

**Q (discover: Cache fría de pi-lens): ¿Re-poll automático o reintento manual?**
A: Re-poll automático.

**Q (discover: Refresh del mapa funcional): ¿Recarga al abrir + botón manual, o watcher automático?**
A: Al abrir + manual.

**Q (`lens-engine.js:16-27` del dist 3.8.72): El seam arrastra imports estáticos de LSP/diagnostics, mientras `project-report.js:36-39` es liviano — ¿qué entry usa M2?**
A: `lens-engine.js` (seam declarado para host adapters, fiel a la decisión del discover; el costo one-shot de evaluar el árbol estático es aceptable).

**Q (`src/extension.ts:2417-2420`): `localResourceRoots` excluye los PNG del workspace; el CSP (`webview-html-core.ts:17`) ya permite `data:` — ¿cómo accede la webview a screenshots?**
A: Data-URI host-side on-demand (guard `safeJoin` + post al expandir/clic; la webview no gana fetch; perímetro exacto `docs/funcional/`).

**Q (`SettingsHub.tsx:70-124`): La búsqueda global filtra dominios de datos; los tabs dashboard quedan fuera con costo cero — ¿participa `projectMap`?**
A: Fuera (género dashboard-visual, como usage/productivity/codebaseIndex).

## Related Research

- `.rpiv/artifacts/research/2026-08-24_14-29-54_app-walkthrough-m8.md` — schema y writers de `docs/funcional/` (M8)
- `.rpiv/artifacts/research/2026-08-26_13-00-12_traffic2api-m9.md` — matriz y degradaciones de `docs/api/` (M9)
- `.rpiv/artifacts/research/2026-08-24_19-37-37_m1-understand-app.md` — moat de pi-lens y sesión principal (M1)
- `.rpiv/artifacts/research/2026-08-28_18-01-10_pista-m-slash-commands-welcome.md` — convenciones webview/dist-webview de la Pista M

## Open Questions

- Ninguna de las del FRD: los supuestos a verificar quedaron resueltos — matriz M9 (fuente canónica y schema documentados arriba), CSP de screenshots (data-URI ya permitido, decisión tomada), política `vscode-resource` (innecesaria con data-URIs).
- Decisiones de diseño que este research deja abiertas para `/skill:design` o `/skill:blueprint` (no son de investigación): semántica exacta de los segmentos `J01..` sobre la línea de tiempo del actionLog (cortes por `goto`/`fail:` vs otra heurística); cadencia exacta del re-poll (análisis propone 2-3s con backoff acotado ~60-90s); layout del grafo SVG (posicionamiento de nodos por journey/subsystem); estructura fina de `ProjectMapUiState`.
- Estado del working tree a la fecha (2026-08-29, commit `202751d`): `dist-webview/assets/index-gE2gVxhC.js` modificado sin commitear y `test/dist-bundle-integrity.test.ts` sin trackear — deben aterrizar (commit conjunto) antes o durante M2 para que la guarda del FRD exista en git.
