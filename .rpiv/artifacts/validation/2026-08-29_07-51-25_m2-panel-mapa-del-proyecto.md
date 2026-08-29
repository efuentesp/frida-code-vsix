---
date: 2026-08-29T07:51:25-0600
author: Edgar F. Fuentes Perea
commit: 0af904d
branch: main
repository: frida-code
topic: "Validation of M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-29_03-02-03_m2-panel-mapa-del-proyecto.md"
tags: [validation, m2, webview, settingshub, pi-lens, project-map, frida-app-walkthrough, frida-traffic2api]
last_updated: 2026-08-29T07:51:25-0600
---

## Validation Report: M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens

1ª corrida incremental (convención del repo: ver Pista M, 5 corridas 21:24:49→23:43:37). Alcance de este run: **Fase 1** — la única marcada `- [x]` en el plan (commits be7dc1c precondición + 0af904d, ya aterrizados). El veredicto aplica a las fases marcadas; las Fases 2-5 se listan como pendientes — no se evaluaron sus criterios. Implementación = 1/5 fases.

### Implementation Status

- ✓ Phase 1: Contrato del tab + mapa funcional host + lista honesta — Fully implemented (be7dc1c aterrizaje previo + 0af904d; los 12 archivos declarados + rebuild conjunto de `dist-webview/` en el MISMO commit)
- ⚠️ Phase 2: Grafo SVG funcional + evidencia — Not implemented (pendiente; `webview/components/project-map/` no existe, sin `GraphCanvas`/`FunctionalView`, sin guard `safeResolveWithin`/`readScreenshotDataUri`, sin cases `open_file`/`project_map_shot`)
- ⚠️ Phase 3: Vista técnica (pi-lens) + re-poll — Not implemented (pendiente; sin `src/project-map/lens-project-report.ts` ni `TechnicalView` ni conmutador)
- ⚠️ Phase 4: Cruce técnico↔funcional (matriz M9) — Not implemented (pendiente; sin `src/project-map/matrix-cross.ts` ni `refreshPmCross`)
- ⚠️ Phase 5: Export HTML autónomo + aterrizaje — Not implemented (pendiente; fase terminal que corre el baseline `npm test` y documenta `docs/webview-ui-styles.md`)

### Automated Verification Results

Comandos ejecutados tal como los codifica el plan (Fase 1 marcada), re-ejecutados en esta corrida contra HEAD 0af904d:

- ✓ Aterrizaje previo: commit conjunto be7dc1c trackea `test/dist-bundle-integrity.test.ts` + rebuild de `dist-webview/`; `git status --porcelain` sin residuos en dist-webview tras ese commit
- ✓ Typecheck limpio (host + webview): `npm run typecheck` — exit 0 (ambos tsconfig)
- ✓ Tests del slice: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts` — 25/25 (lib 10 · tab 4 · store 11), coincide con el "(25/25)" del plan
- ✓ Seam completo (grep): `"project_map_state"` en `webview/store.ts` = 1 (≥1); `"project_map"` en `src/extension.ts` = 1 (≥1); `ProjectMapTab` en `webview/components/SettingsHub.tsx` = 2 (≥2, import + render)
- ✓ Bundle en el MISMO commit que la fuente: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` — 2/2 en verde; el rebuild NO produce diff (bundle commiteado al día, working tree limpio tras rebuild)
- ✓ Diff funcional limpio: `git diff --check` sin errores; el diff de 0af904d solo toca los 12 archivos declarados + `dist-webview/` + el propio plan (checks `[x]`)
- ✓ Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` vacío
- ✓ Sin regresiones — baseline `npm test`: 211 archivos pasados / 2324 tests (19 skipped), 0 fallos (nota: la 1ª ejecución tuvo 2 fallos flaky `ENOTEMPTY` en `test/frida-tea/e2e.test.ts` — archivo byte-idéntico a la base 202751d, preexistente y ambiental; re-ejecución completa en verde)

### Code Review Findings

#### Matches Plan

- `src/project-map/functional-inventory.ts:1-173` — fiel al fence: sonda `existsSync`, `JSON.parse` en try/catch, canon `screens`/`actionLog`, huérfanos excluidos y reportados, `MISSING_WORKAROUND`, SIEMPRE resuelve (nunca throw)
- `src/project-map/journeys.ts:1-138` — corte por goto exacto: solo un goto que progresa abre journey; fails no cortan; clasificación canónica M9 (shell-error / app-validation / no-progression); kind "done" sin arista
- `src/extension.ts` — wiring completo del fence: import + `let pmState` + `postProjectMapState()` + re-posteo en `webview_ready` + case `project_map` con try/catch que SIEMPRE responde + comando `frida.projectMap` (molde frida.codebaseIndex, post directo en caliente / flush en frío)
- `webview/types.ts` — espejo con unión DISCRIMINADA (fix del slice-verifier aplicado), `State.projectMap`, `project_map_state` (In) y `project_map` (Out) con `view` desde Fase 1
- `webview/store.ts:612-621` — case `project_map_state` con el merge del fix del triage Step 5 (`shots: state.projectMap?.shots`), comentario documental incluido
- `webview/components/SettingsHub.tsx` — los 3 toques exactos (unión `SettingsTab`, fila en `TABS` con icono `map`, rama de render `{state, post}`)
- `webview/components/ProjectMapTab.tsx` — lista honesta fiel: colapsado por defecto con render condicional real, badge de cobertura parcial, nota de huérfanos, `busy` del host para el spinner; el typo `Codicon` detectado en plan-review (3 blockers de transcripción) quedó corregido (`: "map"} size={16}`) como manda la resolución del triage
- `webview/styles.css:11414-11527` — bloque `.pm-*` de Fase 1 completo, incluida la revisión en cascada del `:hover` de `.pm-journey-head` ratificada en el slice 5 del diseño y los estilos adelantados (`pm-expand-all`/`pm-empty`/`pm-orphan-note`) que la NOTA DE DESCOMPOSICIÓN del plan autoriza
- Tests: fixtures honestos del schema real del writer M8 (con `run.maxScreens` alcanzable, huérfanos P99, timeline canónico J01/J02); `test/webview-store.test.ts` describe del contrato #126

#### Deviations from Plan

- `webview/types.ts:623-626` — el campo `shots?: Record<string, string>` de `ProjectMapUiState` llegó ADELANTADO (el plan lo declara en Fase 2 §4, no en Fase 1). Desviación coherente y necesaria: el reducer de Fase 1 aplica el merge del fix del triage (`state.projectMap?.shots`) y sin el campo el typecheck webview fallaría (TS2339) — inconsistencia interna del plan que la implementación resolvió; documentada en el propio código como "Campo adelantado de la Fase 2". No requiere acción.
- `0af904d` incluye el propio `.md` del plan (checks `[x]` de Fase 1) — housekeeping estándar de la convención del repo, no una fuga de alcance funcional.

#### Pattern Conformance

- ✓ `ProjectMapTab.tsx` sigue el molde `ProductivityTab.tsx`: contrato `{state, post}`, carga en `useEffect` con `// eslint-disable-line react-hooks/exhaustive-deps`, plegado como estado LOCAL (análogo period/scope), estados `cfg-stub`
- ✓ Tests de componente siguen el molde `productivity-tab.test.ts` (`renderToStaticMarkup` + `post = vi.fn()`; efectos no corren — documentado)
- ✓ Libs host Node puro (`node:fs`/`node:path`, cero import de `vscode`) — convención de lib pura del repo
- ✓ Sin drift: `docs/webview-ui-styles.md` sin `.pm-*` (correcto — llega en Fase 5); referencias `projectMap` coherentes en exactamente los 6 archivos esperados; sin TODO/FIXME en el código nuevo

#### Potential Issues

- `test/frida-tea/e2e.test.ts:45` — flake preexistente `ENOTEMPTY` en `rmSync` de tmpdir (macOS): falló 2 tests en la 1ª corrida del baseline y pasó completo en la re-ejecución; archivo byte-idéntico a la base 202751d (`git diff --quiet 202751d` limpio). Preexistente y ambiental — no requiere acción de M2; registrado para futuras corridas que lo vuelvan a ver.
- `.pi-lens.json` (untracked, raíz del repo) — config de ignore de pi-lens (`dist-webview/**`) con mtime 28-ago 23:50, ANTERIOR a la creación del plan (29-ago 03:02): artefacto de entorno, no trabajo de esta corrida. No requiere acción.

### Manual Testing Required

Criterios manuales de la Fase 1 (del plan; el resto de fases se evaluará al implementarse):

1. Paleta:
   - [ ] "Frida: Mapa del proyecto" abre el SettingsHub en el tab "Mapa" (en frío y en caliente)
2. Sin insumos:
   - [ ] Sin `docs/funcional/` en el workspace: estado vacío con workaround "corre el patrón app-walkthrough (M8)", sin spinner eterno
3. Con inventory M8 válido:
   - [ ] Journeys J01.. en lista colapsada por defecto; clic en el encabezado expande los chips de pantallas; badge "cobertura parcial: tope de pantallas" cuando stoppedBy="budget"
4. Persistencia:
   - [ ] Cambiar de pestaña del hub y volver: el mapa persiste sin "Cargando…" eterno (re-posteo en webview_ready)

### Recommendations

- Continuar la implementación con `/skill:implement` (Fase 2: grafo SVG funcional + evidencia; luego 3→5 en orden estricto — dependencias declaradas 1→5)
- Re-ejecutar `/skill:validate` tras cada aterrizaje (convención incremental) o al cierre con las 5 fases marcadas
- El veredicto `pass` de este run NO cierra el issue #143: el cierre requiere las 5 fases verificadas + smoke manual del usuario (AGENTS.md)
