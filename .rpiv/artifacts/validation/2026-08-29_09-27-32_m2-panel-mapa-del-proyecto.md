---
template_version: 1
date: 2026-08-29T09:27:32-0600
author: Edgar F. Fuentes Perea
commit: 81a49c9
branch: main
repository: frida-code
topic: "Validation of M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-29_03-02-03_m2-panel-mapa-del-proyecto.md"
tags: [validation, m2, webview, settingshub, pi-lens, project-map, frida-app-walkthrough, frida-traffic2api]
last_updated: 2026-08-29T09:27:32-0600
---

## Validation Report: M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens

Validación terminal del plan (fases 1-5) contra el working tree en HEAD `81a49c9`. Las fases 1-3 ya tenían validaciones incrementales (`2026-08-29_07-51-25`, `_08-13-28`, `_08-40-23`); este run verifica el plan completo con foco en las fases 4-5 y el baseline del proyecto.

### Implementation Status

- ✓ Phase 1: Contrato del tab + mapa funcional host + lista honesta — Fully implemented (commit `0af904d`)
- ✓ Phase 2: Grafo SVG funcional + evidencia — Fully implemented (commit `3aa1f3b`)
- ✓ Phase 3: Vista técnica (pi-lens) + re-poll — Fully implemented (commit `9e95a04`)
- ✓ Phase 4: Cruce técnico↔funcional (matriz M9) — Fully implemented (commit `e60a84e`)
- ✓ Phase 5: Export HTML autónomo + aterrizaje — Fully implemented (commit `81a49c9`)

Precondición (Ordering Constraint 1) aterrizada ANTES del primer commit de M2: `be7dc1c` commitea conjunto `test/dist-bundle-integrity.test.ts` (37 líneas, nuevo) + rebuild de `dist-webview/index.html` ✓.

### Automated Verification Results

Ejecutados en este run contra el working tree (7 archivos con reformateo Prettier pendiente de commitear, sin cambios semánticos — ver Potential Issues):

- ✓ Typecheck limpio (host + webview): `npm run typecheck` — tsc host + webview sin errores
- ✓ Tests del slice (todas las fases): `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts` — 78/78 (42 lib + 24 tab + 12 store), incluye los casos congelados: TECH_POLL_DELAYS_MS (10, rampa 2s→10s), joins M9 ("srca NO matchea src", "(root)", ancestros), escHtml/JSON embebido sin `</` crudo
- ✓ Baseline completo del proyecto (fase terminal): `npm test` — 2377/2377 pasan (211 archivos · exit 0; ver Potential Issues por flakiness intermitente en corridas previas)
- ✓ Bundle íntegro: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` — 2/2 en verde tras rebuild (el rebuild no dejó residuos: el bundle minificado es idéntico al commiteado)
- ✓ Bundle en el MISMO commit que la fuente: los 5 commits de fase (`0af904d`/`3aa1f3b`/`9e95a04`/`e60a84e`/`81a49c9`) tocan `webview/**` y `dist-webview/**` en el mismo commit (verificado con `git show --stat` por commit)
- ✓ Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` — vacío
- ✓ Diff limpio: `git diff --check` — sin errores
- ✓ Seams por grep (todas las fases, todos ≥ umbral): `project_map_state` store (1), `project_map` extension (1), `ProjectMapTab` SettingsHub (2), `project_map_shot` store/extension (1/3), `open_file` extension (1), `loadTechnicalMap` extension (4), `PmTechnicalState`/`"technical"` types (2/3), `isSizeSkipHint` lens-project-report (2), `loadCrossMap` extension (2), `refreshPmCross` extension (4), `cross` FunctionalView/TechnicalView (23/15), `PmCrossState` types (2), `buildExportHtml` extension (2), `export_map` types (1), `serializeFunctionalExport|serializeTechnicalExport` ProjectMapTab (4)
- ✓ Commits con `Refs #143`: los 5 commits de fase lo llevan en el cuerpo
- ✓ Sin regresiones detectadas

### Code Review Findings

#### Matches Plan

- `src/project-map/{functional-inventory,journeys,lens-project-report,matrix-cross,export-html}.ts` — lib host pura (Node puro, sin vscode), SIEMPRE resuelve (nunca throw), fixtures de test que reproducen el schema real de los writers M8/M9
- Reducer `project_map_state` con merge de shots (`{ ...msg.state, shots: state.projectMap?.shots }`) — fix del triage Step 5 aplicado tal cual
- Re-poll técnico con epoch de invalidación (`pmTechEpoch`) y schedule `TECH_POLL_DELAYS_MS` congelado por test; parse lenient `/^review graph disabled/i` sin strings completos hardcodeados
- Export con orden DIÁLOGO→ensamblar→escribir (molde exportUsage); semántica de shots undefined/""/data-URI; JSON embebido con escape de `</`; render vanilla sin innerHTML con datos
- Cruce M9: normalización de paths LLM + joins por prefijo EXACTO de segmentos completos, danglingScreens, unmatchedModules, recompute en cada completion vía `refreshPmCross()`
- `docs/webview-ui-styles.md` — documenta el tab Mapa y las clases `.pm-*` (24 menciones), incluida la regla de cascada del `:hover`

#### Deviations from Plan

None — Implementation is a faithful realization of the plan. Las únicas diferencias working-tree vs HEAD son reformateo Prettier (7 archivos: colapso de líneas, indentación, comillas) sin ningún cambio semántico — verificado con `git diff` completo.

#### Pattern Conformance

- ✓ Libs host puras en `src/project-map/` siguen el molde de lib sin vscode del repo (tests corren en Node puro)
- ✓ Tests siguen el molde vitest del repo: describe/it, fixtures honestos del schema upstream, cleanup de tmpdirs en `afterEach`, `renderToStaticMarkup` + `post = vi.fn()` para componentes (molde productivity-tab)
- ✓ Registro del tab en SettingsHub con contrato `{state, post}` idéntico a `codebaseIndex`; estilos con prefijo per-tab `.pm-` (convención `.ci-`/`.usage-`/`.prod-`/`.env-`)
- ✓ Sin drift: cero restos de `pm-screen-chip` (retirado en Fase 2) ni de términos renombrados

#### Potential Issues

- **Flakiness intermitente del baseline `npm test` (non-blocking, preexistente)**: 2 de 4 corridas completas fallaron 1 test en `test/frida-traffic2api/e2e.test.ts` (ENOENT al escribir `state.json.*.tmp` en un home efímero `/var/folders/.../t2a-e2e-home-*` — condición de carrera de tmpdirs bajo la suite paralela de 2396 tests). Atribución Step 2.6: el archivo está fuera del delta del run (`git diff --stat 202751d..HEAD -- test/frida-traffic2api/ src/tools/frida-traffic2api/` vacío; idéntico a HEAD) y pasa en aislado 9/9, incluido el test que falló. La corrida final completa pasó 2377/2377 con exit 0. Deuda del entorno de tests e2e, no del run M2.
- **Working tree pendiente de aterrizar**: (a) reformateo Prettier puro en 7 archivos (entre ellos `webview/components/project-map/FunctionalView.tsx` y `TechnicalView.tsx` — al commitearlos, el rebuild de `dist-webview/` ya está validado: el bundle regenerado es idéntico, así que el commit conjunto fuente+bundle pasa la guarda sin churn); (b) `.pi-lens.json` untracked (`{ "ignore": ["dist-webview/**"] }` — configuración de la herramienta de análisis pi-lens, ajena al write-set del plan): decidir si se commitea como config del repo o se agrega a `.gitignore`.

### Manual Testing Required

1. Fase 1 — paleta y estados del tab:
   - [ ] "Frida: Mapa del proyecto" abre el SettingsHub en el tab "Mapa" (frío y caliente)
   - [ ] Sin `docs/funcional/`: estado vacío con workaround M8, sin spinner eterno
   - [ ] Con inventory M8: journeys colapsados por defecto; badge "cobertura parcial" con stoppedBy="budget"; re-monte del tab sin "Cargando…" eterno
2. Fase 2 — grafo funcional y evidencia:
   - [ ] Expandir journey → grafo SVG horizontal con scroll bidireccional en panel angosto (~350px)
   - [ ] Clic en nodo → PNG en visor de imágenes / snapshot .json en editor / ruta fuera del workspace rechazada
   - [ ] Shots on-demand ("capturando…" → imagen; "sin captura" no se re-pide); teclado Tab/↑↓/Enter; prefers-reduced-motion
3. Fase 3 — vista técnica:
   - [ ] Conmutar a "Técnica" → columnas por directorio, aristas "N import(s)", hotspots en rojo, listas clicables, deadWeight plegado
   - [ ] Cache fría: borrar `~/.pi-lens/projects/<slug>/cache/review-graph.json` → re-poll (n/10) avanza solo
   - [ ] Size-skip: hint verbatim sin avance del contador; toggle 10/25/50 re-pide con el nuevo límite
4. Fase 4 — cruce M9:
   - [ ] Con docs/api + docs/funcional: chips "Pnn → módulo" clicables; sección "Cruce funcional (M9)" por directorio
   - [ ] Sin docs/api: nota de omisión sin error; matriz stale: nota de pantallas colgantes
5. Fase 5 — export HTML:
   - [ ] Botón "Exportar" → diálogo `frida-mapa-AAAA-MM-DD.html` → el archivo abre en navegador SIN Frida (grafo + screenshots inlinados)
   - [ ] Export Técnica; placeholder "sin captura"; cancelar diálogo = no-op; Exportar deshabilitado sin vista lista

### Recommendations

- Ready to commit — la implementación está completa y validada. `/skill:commit` debe agrupar el reformateo pendiente (los 7 archivos) con su commit de cierre; decidir el destino de `.pi-lens.json` (commitear como config o `.gitignore`).
- Opcional (follow-up fuera del alcance de M2): el flakiness ENOENT del e2e traffic2api bajo suite completa ameritaría un issue `bug` propio — reproducible ~50% bajo `npm test` completo, nunca en aislado.
