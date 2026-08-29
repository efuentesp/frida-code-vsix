---
template_version: 1
date: 2026-08-29T08:40:23-0600
author: Edgar F. Fuentes Perea
commit: 86a0467
branch: main
repository: frida-code
topic: "Validation of M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-29_03-02-03_m2-panel-mapa-del-proyecto.md"
tags: [validation, m2, webview, settingshub, pi-lens, project-map, frida-app-walkthrough, frida-traffic2api]
last_updated: 2026-08-29T08:40:23-0600
---

## Validation Report: M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens

Validación incremental (3er run del plan). Fases 1-2 ya verificadas en los runs 07-51-25 y 08-13-28 (verdict pass, commits 0af904d/3aa1f3b); este run valida la **Fase 3** (marcada `- [x]` en el plan, implementada en el working tree, pendiente de commit conjunto fuente+bundle). Fases 4-5 siguen sin marcar — pendientes, no evaluadas como completas.

### Implementation Status

- ✓ Phase 1: Contrato del tab + mapa funcional host + lista honesta — Fully implemented (commit 0af904d; verificado en run previo, sin regresiones en el baseline actual)
- ✓ Phase 2: Grafo SVG funcional + evidencia — Fully implemented (commit 3aa1f3b; verificado en run previo, sin regresiones en el baseline actual)
- ✓ Phase 3: Vista técnica (pi-lens) + re-poll — Fully implemented en working tree (verificado en este run; commit conjunto pendiente)
- ⚠️ Phase 4: Cruce técnico↔funcional (matriz M9) — Not implemented (sin marcar en el plan)
- ⚠️ Phase 5: Export HTML autónomo + aterrizaje — Not implemented (sin marcar en el plan)

### Automated Verification Results

- ✓ Typecheck limpio (host + webview): `npm run typecheck` — sin errores (tsc tsconfig.json + tsconfig.webview.json)
- ✓ Tests del slice en verde: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts` — 50/50 (24 lib + 14 tab + 12 store)
- ✓ Seam técnico en el dispatcher: `grep -c 'loadTechnicalMap' src/extension.ts` — 4 (≥ 2: import + invocación en startTechnicalLoad)
- ✓ Espejo técnico en tipos: `grep -c 'PmTechnicalState' webview/types.ts` — 2 (≥ 2); `grep -c '"technical"' webview/types.ts` — 2 (≥ 2)
- ✓ Parse lenient del size-skip: `grep -c 'isSizeSkipHint' src/project-map/lens-project-report.ts` — 2 (≥ 2; sin strings de hint hardcodeados en src)
- ✓ Schedule de re-poll congelado por test: caso "TECH_POLL_DELAYS_MS congelado: 10 intentos, rampa 2s→5s→10s" en verde (dentro de los 24 de lib)
- ✓ Bundle íntegro: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` — build 1.39s, 2/2 tests (fuente y dist-webview/ coherentes en el working tree para el commit conjunto)
- ✓ Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` — vacío (0 líneas)
- ✓ Sin regresiones — baseline completo `npm test`: 2349 passed | 19 skipped, 0 fallos (criterio exigido solo en Fase 5; corrido extra por confianza); `git diff --check` limpio

### Code Review Findings

#### Matches Plan

- `src/project-map/lens-project-report.ts` (NEW) — fiel al fence: sonda `existsSync` → `empty/not-installed` sin throw; import dinámico `pathToFileURL().href` (#57); parse lenient `/^review graph disabled/i` como único discriminador size-skip vs cache fría; `TECH_POLL_DELAYS_MS = [2000×2, 5000×3, 10000×5]` congelado por test; normalización defensiva del payload (num/str/arrays); catch ruidoso `console.warn` (f3112ec); SIEMPRE resuelve.
- `webview/components/project-map/TechnicalView.tsx` (NEW) — versión base Fase 3 (sin `cross` — correcto, llega en Fase 4): `subsystemColumns` con ranking por peso de edges + cap al límite, overlay danger por ancestros de hotspot, trust header con badges stale/lowCoverage, toggle 10/25/50 que re-pide con `options.limit`, estados building (n/10 visible + hint verbatim) / disabled (sin re-poll + Reintentar) / exhausted / not-installed (sin Reintentar) / error, deadWeight plegado con disclaimer, clic en filas → `open_file`.
- `webview/types.ts` — espejo técnico completo (PmTrust/PmHub/PmEntryPoint/PmSubsystems/PmRiskHotspot/PmTechnicalData/PmTechnicalState, idéntico campo a campo al productor) + `technical?` en ProjectMapUiState + unión `busy` ampliada a `"technical"`.
- `src/project-map/functional-inventory.ts` — fusión marcada `══ Fase 3 ══`: `technical?: PmTechnicalState` (import type, sin ciclo) + unión `busy` ampliada; el resto del archivo intacto.
- `src/extension.ts` — import de la lib, `let pmTechEpoch`, `startTechnicalLoad()` con re-poll epoch-guarded (guard en cada checkpoint: suplantada → return sin mutar), rama `msg.view === "technical"` al inicio del case `project_map` con `limit` validado (default 10).
- `webview/components/ProjectMapTab.tsx` — conmutador `.seg-toggle .seg` Funcional/Técnica, `view` como estado local del componente (no del store), `busy` acotado a la vista activa, efecto `[view]` que dispara la carga conservando el límite 10/25/50 al re-disparar en Técnica.
- `webview/styles.css` — bloque `══ Fase 3 ══` completo (`.pm-list`/`.pm-list-title`/`.pm-row`(+`.is-danger`,`.pm-row-dim`)/`.pm-row-main`/`.pm-row-meta`/`.pm-note`/`.pm-note-list`/`.pm-dead`).
- `test/project-map-lib.test.ts` — describe del seam pi-lens con mock honesto ESM espejo del real (package.json `type:module`, layout dist/clients/lens-engine.js, hints verbatim 3.8.72): 8 its (lenient por prefijo, schedule congelado, layout del path, not-installed, cache fría→building, size-skip→disabled, ready+limit viaja al seam, rechazo→error+warn).
- `test/project-map-tab.test.ts` — describe del conmutador (1 it) + describe de estados de TechnicalView (5 its), con fixtures `techReady` y helper `renderTech` según fence.

#### Deviations from Plan

- `src/extension.ts` (startTechnicalLoad): la condición terminal usa `if (st.status !== "building")` en lugar del `if (st.status === "ready" || st.status === "empty")` del fence. Desviación menor con comentario inline que la justifica: el narrowing de la unión `PmTechnicalState` incluye `loading` (que `loadTechnicalMap` nunca emite) y sin el `!==` TS no permite leer `st.hint` en la rama exhausted. Equivalente funcional; typecheck verde. No requiere acción.

#### Pattern Conformance

- ✓ `lens-project-report.ts` sigue el molde de `functional-inventory.ts` (lib host pura Node sin vscode, degradación digna siempre-resuelve, JSDoc de contrato, comentarios es-MX con lecciones referenciadas).
- ✓ `TechnicalView.tsx` sigue el molde de `FunctionalView.tsx` (mismo directorio, contrato `{post}`, Codicon, reuso de GraphCanvas, colapso por render condicional).
- ✓ Tests siguen el molde vitest del repo: helpers `tmpDirs`/`makeCwd` compartidos a nivel de archivo, fixtures honestos del contrato upstream, `afterEach` con limpieza de tmpdirs.
- ✓ Diff acotado exactamente a los archivos del slice (7 modificados + 2 nuevos); sin reformatos ajenos (`git diff --check` limpio).

#### Potential Issues

- `.pi-lens.json` (untracked, raíz del repo): config local de pi-lens (`{"ignore":["dist-webview/**"]}`), no declarada por el plan ni escrita por el código de M2 (solo aparece como texto de hint dentro de fixtures de test). Excluir del commit de Fase 3 (o decidir su trackeo en un cambio aparte).
- La Fase 3 está verificada en el working tree sin commitear: el criterio "Bundle en el MISMO commit que la fuente" se materializa en el próximo commit — fuente + `dist-webview/` deben ir juntos (ambos ya coherentes; el integrity test lo garantiza).

### Manual Testing Required

Pendiente de verificación por el usuario (Fase 3; los pasos de Fases 1-2 siguen listados en los reportes 07-51-25 / 08-13-28):

1. Vista Técnica en caliente:
   - [ ] Conmutar a "Técnica" pinta columnas por directorio con aristas "N import(s)", directorios con hotspot en rojo (`is-danger`), listas de hubs/puntos de entrada/riesgo clicables que abren el archivo, deadWeight plegado con disclaimer
2. Cache fría de pi-lens:
   - [ ] Borrar `~/.pi-lens/projects/<slug>/cache/review-graph.json` → "Construyendo mapa técnico… reintentando (n/10)" avanza solo y termina en el mapa sin recargar la ventana (#142)
3. Repositorio sobre el tope (size-skip):
   - [ ] Hint "review graph disabled: …" verbatim SIN avance del contador y botón Reintentar visible
4. Toggle de límite:
   - [ ] 10/25/50 re-pide el reporte con el nuevo límite (badge activo se mueve; cambian largos de listas y columnas)
5. Persistencia:
   - [ ] Cambio de vista y vuelta + re-monte del tab: el estado técnico sobrevive vía re-posteo en webview_ready; el spinner de Recargar refleja solo la vista activa

### Recommendations

- Commit conjunto de Fase 3: fuente + `dist-webview/` en un solo commit (`feat(mapa): vista técnica (pi-lens) + re-poll (fase 3)`, `Refs #143`), excluyendo `.pi-lens.json`.
- Continuar con la Fase 4 (cruce técnico↔funcional, matriz M9) y Fase 5 (export HTML autónomo + baseline terminal) — ambas pendientes según el plan.
- Ready to commit — Fases 1-3 completas y validadas; sin bloqueos.
