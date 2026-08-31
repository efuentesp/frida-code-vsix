---
date: 2026-08-31T14:45:43-0600
author: Edgar F. Fuentes Perea
commit: d46ed97
branch: main
repository: frida-code
topic: "Validation of Paneles de pipeline SDD (N1 planeación + N2 ejecución) con monitor HTML por método"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-08-31_13-40-16_paneles-pipeline-sdd-n1-n2.md"
tags: [validation, frida-workflow, pipeline-panels, features-json, monitor-server, panel-spec, welcome]
blockers:
  - id: b1
    command: "grep -n \"export function reconcileFeatures\" src/tools/frida-workflow/features.ts"
    file: src/tools/frida-workflow/features.ts
    line: 169
  - id: b2
    command: "grep -n \"export function advanceFeature\" src/tools/frida-workflow/features.ts"
    file: src/tools/frida-workflow/features.ts
    line: 169
  - id: b3
    command: "npx vitest run test/frida-workflow/panel-spec.test.ts"
    file: src/tools/frida-workflow/panel-spec.ts
    line: 1
  - id: b4
    command: "test ! -f src/tools/frida-pipeline/banner.tsx && test ! -f src/tools/frida-pipeline/panel.ts"
    file: src/tools/frida-pipeline/banner.tsx
    line: 1
  - id: b5
    command: "npx vitest run test/frida-workflow/monitor-server.test.ts"
    file: src/tools/frida-workflow/monitor-server.ts
    line: 1
  - id: b6
    command: "npx vitest run test/frida-workflow/monitor-html.test.ts"
    file: src/tools/frida-workflow/monitor-html.ts
    line: 1
  - id: b7
    command: "grep -c \"monitorUrl\" webview/components/Welcome.tsx"
    file: webview/components/Welcome.tsx
    line: 48
last_updated: 2026-08-31T14:45:43-0600
---

# Validation Report: Paneles de pipeline SDD (N1 planeación + N2 ejecución) con monitor HTML por método

## Implementation Status

- ✓ Fase 1: Dominio features — tipos y persistencia — **Implementada por completo** (única fase marcada `- [x]` en el plan; verificada contra el código).
- ✗ Fase 2: Reconciler — auto-adopción y vinculación — **No implementada** (checkboxes `- [ ]` en el plan, consistentes con el árbol).
- ✗ Fase 3: Acciones — avance temprano y ship N1→N2 — **No implementada**.
- ✗ Fase 4: Motor declarativo PanelSpec — **No implementada** (`panel-spec.ts` y su test no existen).
- ✗ Fase 5: Overlay N1 — /pipeline absorbe el comando — **No implementada** (`features-ui.tsx` ausente; `banner.tsx`/`panel.ts` siguen en pie; `extension.ts` intacto desde el 31-08 02:00).
- ✗ Fase 6: Servidor HTTP+SSE + watcher — **No implementada** (`monitor-server.ts` ausente; sin wiring en `activate`).
- ✗ Fase 7: HTML del monitor — hub de métodos + /sdd — **No implementada** (`monitor-html.ts` ausente).
- ✗ Fase 8: Hub Welcome + URL monitor + encadenamiento parent — **No implementada** (Welcome sin retarjetar; sin `monitor_url` en types/store/App; los 4 SKILL.md sin `parent:`).

El working tree lo confirma: únicamente `src/tools/frida-workflow/features.ts` (nuevo, 14:22), `test/frida-workflow/features.test.ts` (nuevo, 14:22) y `src/tools/frida-workflow/index.ts` (modificado, bloque de reexports) — exactamente el write-set de la Fase 1. **El árbol no cambió desde la validación previa (14:32)**: los mtimes de los tres archivos del run son anteriores a ambos reportes y ningún archivo de las fases 2-8 existe.

## Automated Verification Results

### Fase 1 (implementada) — todos pasan

- ✓ Tests del dominio: `npx vitest run test/frida-workflow/features.test.ts` — 11/11 tests en 3 describes (persistencia atómica, listeners, etapas).
- ✓ Typecheck: `npm run typecheck` — verde (host + webview).
- ✓ Patrón tmp+rename: `grep -c "renameSync" src/tools/frida-workflow/features.ts` — 2 (≥1).
- ✓ Listeners espejo board: `grep -n "export function subscribeFeaturesChanges" src/tools/frida-workflow/features.ts` — 1 línea (features.ts:110).
- ✓ Sin regresiones: `npx vitest run test/frida-workflow test/frida-pipeline` — 27 archivos / 332 tests, todos verdes.

### Fases 2-8 (no implementadas) — fallan

- ✗ Fase 2 — `reconcileFeatures` ausente (0 líneas), `desync` ausente (0 en features.ts), test «re-scan idéntico no duplica» ausente.
- ✗ Fase 3 — `advanceFeature` ausente, `shipFeature` ausente, `openBoard` ausente (0 en features.ts).
- ✗ Fase 4 — `panel-spec.ts` y `test/frida-workflow/panel-spec.test.ts` no existen.
- ✗ Fase 5 — `banner.tsx` y `panel.ts` siguen existiendo (`test ! -f …` falla); `mountPipelineOverlay` ausente en `extension.ts`; los 6 usos de `wirePipelinePanel|postPipelineCommand|formatPipelineStatus` siguen en el host; `features-ui.tsx` y `pipeline-wiring.test.ts` no existen.
- ✗ Fase 6 — `monitor-server.ts` y su test no existen; `startPipelineMonitor` sin wiring en `extension.ts`.
- ✗ Fase 7 — `monitor-html.ts` y su test no existen.
- ✗ Fase 8 — `monitorUrl` ausente en Welcome (0), «PRÓXIMAMENTE» ausente (0), `monitor_url` ausente en `extension.ts` (0); `grep -l "parent:"` sobre los 4 SKILL.md no retorna ninguna ruta.

## Code Review Findings

### Matches Plan

- `src/tools/frida-workflow/features.ts` — realización fiel del fence de la Fase 1: tipos (`PipelineFeature`/`FeaturesFile`/`FeatureTransition`), `PIPELINE_STAGES`/`STAGE_BUCKET` con buckets plurales (`designs`/`plans`), listeners in-process y persistencia atómica tmp PID + rename con `emitFeaturesChange()`. Indentación normalizada a tabs según la nota de Developer Context del plan.
- `test/frida-workflow/features.test.ts` — los 11 tests del fence, con fixture `mkdtempSync` (molde `board.test.ts`), degradación ante JSON corrupto, sin `.tmp` huérfanos, listener roto no bloquea, contrato de etapas completo.
- `src/tools/frida-workflow/index.ts:274-293` — bloque de reexports de features exacto (valores y tipos) al final del archivo, como manda la Fase 1 §3. Sin referencias adelantadas a `features-ui`/`monitor-*` (grep = 0).
- `features.ts:169-170` — el comentario final anuncia correctamente las secciones Reconciler/Acciones pendientes de las Fases 2-3: sin drift.
- Alcance limpio: cero archivos tocados fuera del write-set de la Fase 1 (los untracked `.rpiv/artifacts/*` son artefactos del propio flujo RPIV; `devengine-suite-completa-2026-08-30.zip` es previo al plan y ajeno al run).

### Deviations from Plan

- Fases 2-8 sin implementar: el plan declara 8 fases y el árbol sólo contiene la Fase 1. Los checkboxes del plan son honestos (Fase 1 `- [x]`, Fases 2-8 `- [ ]`), así que la desviación es de **alcance de ejecución**, no de registro — pero los criterios automatizados de esas 7 fases fallan tal como están escritos y fuerzan `verdict: fail`. Cada fase pendiente queda capturada en un `blocker` del frontmatter (b1-b7). El estado es idéntico al de la validación previa (14:32): nada progresó entre ambas.

### Pattern Conformance

- ✓ `features.ts` espeja la forma del sibling `board.ts` (board.ts:213-227 listeners, board.ts:233-265 persistencia): `featuresListeners`/`subscribeFeaturesChanges`/`emitFeaturesChange` replican `boardListeners`/`subscribeBoardChanges`/`emitBoardChange` con el mismo manejo de listener roto; `saveFeatures` replica `saveBoard` (tmp PID + rename, `updatedAt`, emit tras rename).
- ✓ Test con `mkdtempSync` + `afterEach(vi.restoreAllMocks())` — misma estructura que `board.test.ts`.
- ✓ Indentación a tabs en los tres archivos, consistente con `src/tools/frida-workflow/*`.

## Manual Testing Required

1. Fase 1 (única implementada):
   - [x] Workspace sin `.frida/`: `loadFeatures(cwd)` no lanza y devuelve null — cubierto por el test unitario «loadFeatures devuelve null si features.json no existe».
2. Fases 2-8 (pendientes de implementar — aplican cuando el run continúe):
   - [ ] Fase 2: scratch contra este workspace — `reconcileFeatures` adopta los FRDs del seed `.rpiv/artifacts/discover/` sin duplicar, con el FRD `2026-08-31_07-08-47_pipeline-panels-sdd-n1-n2-html.md` en `design`.
   - [ ] Fase 3: scratch tmp — `shipFeature` crea `.frida/artifacts/board/<slug>.json` con fases en `backlog` y `transitions: []`.
   - [ ] Fase 5: F5 — `/pipeline` con 5 columnas, EmptyState con InputBox, movimiento temprano, banner ámbar, ship, badge n/m vivo, Reload Webviews (ba40da0), orden de footers D8.
   - [ ] Fase 6: F5 — curl 401 sin token / 200 con token; cambios reflejados <1s; `*.tmp` no emite, rename sí.
   - [ ] Fase 7: navegador — hub espejo «De cero», /sdd con N1+N2, detalle FR#16 sobrevive SSE, claro/oscuro, degradación host muerto.
   - [ ] Fase 8: Welcome retarjetada con ancla «Abrir monitor ↗»; `grep -m1 "parent:" ~/.frida/skills/research/SKILL.md`; `/skill:research` produce `parent:` al FRD.

## Recommendations

- Continuar la ejecución del plan desde la Fase 2 con `/skill:implement` — la Fase 1 es la base limpia y verde sobre la que cuelgan las 7 fases restantes (el propio `features.ts:169` marca el punto de inserción del Reconciler).
- Los blockers b1-b7 no requieren plan-level changes: son trabajo pendiente, no defects. No invocar `/skill:revise`.
- Al llegar a la Fase 8, recordar el hallazgo blocker del Plan Review ya aplicado (§10): actualizar `test/welcome.test.ts` al título «Desarrollo Autónomo (SDD)».
