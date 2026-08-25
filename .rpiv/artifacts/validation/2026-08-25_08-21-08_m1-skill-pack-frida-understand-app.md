---
template_version: 1
date: 2026-08-25T08:21:08-0600
author: Edgar F. Fuentes Perea
commit: 39b18f7
branch: main
repository: frida-code
topic: "Validation of M1 skill pack frida-understand-app — plan de implementación: patrón builtin understand-app (6 fases) + seam del moat (pi-lens + frida-codebase-index) en sesiones hijas vía pattern.meta.moat"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-25_05-30-23_m1-understand-app.md"
tags: [validation, plan, frida-understand-app, frida-extensible-workflows, pi-lens, frida-codebase-index, skill-pack, moat]
last_updated: 2026-08-25T08:21:08-0600
---

## Validation Report: M1 skill pack frida-understand-app — patrón builtin understand-app (6 fases) + seam del moat

### Implementation Status

- ✓ Phase 1: Prompts y resolver 3-capas — Implementada por completo (committeada en `dfdec0e`): `skills.ts` (4 stages + preamble no-stage con veto), `resolver.ts` (4º consumidor de `createLayeredStageResolver`), suite espejo M8 (6/6).
- ✓ Phase 2: Generador del script de 6 fases — Implementada por completo: `validateUnderstandAppArgs` eager (D13), `MOAT_TOOL_CATALOG` (10 tools), `DAY1_QUESTIONS` normalizadas a pregunta, cortes pre-LLM (D9), fanouts con gates + reintento, veredicto M4/M5 determinista, juez detached con checkpoint.
- ✓ Phase 3: Patrón builtin y registro del pack — Implementada por completo: `UNDERSTAND_APP_PATTERN` con `meta.moat`, `detectUnderstandAppCapabilities` (sonda host-side), campo `moat` aditivo en `BuiltinPatternMeta`, registro en `pi-session.ts` (suite pattern 22/22).
- ✓ Phase 4: Módulo de factories del moat — Implementada por completo: `piLensEntryPath` (sonda única, resolución S1 del Plan Review), `createFridaLensFactory` diferida, `createMoatFactories`, `createWorkflowChildFactoriesWithMoat` no-leakage (17/17).
- ✓ Phase 5: Seam del motor — Implementada por completo: `WorkflowMetadata.patternMeta`, persistencia + `loadPatternMeta` + herencia en retry (frida-host), getter `codebaseIndexEnabled` + `buildSpawner` en los 4 call sites (index del motor), fence fusionado en `pi-session.ts` (dedup D2 + getter D5), suite moat-seam (8/8).
- ✓ Phase 6: e2e sobre el motor — Implementada por completo: 8 casos sobre `runWorkflowInStore` con anclas verbatim, mocks honestos (#83), date falsificado y caso negativo del juez citando §Qn.
- ✓ Phase 7: Publicación — Implementada por completo: doc técnica + how-to nuevas, entrada HELP_TOOLS (alias sin "moat"), fila en README, suite completa verde, cero dependencias nuevas.

Nota de lineage: la validación previa (`2026-08-25_06-45-35_m1-skill-pack-frida-understand-app.md`, verdict `fail`) bloqueó con 5 blockers por implementación parcial (solo Fase 1). Esta corrida re-verifica los 43 criterios automatizados de las 7 fases contra el código actual: los 5 blockers están resueltos (workflow.ts `phase("` = 6; suites pattern/moat-factories/moat-seam/e2e verdes).

### Automated Verification Results

- ✓ F1 tests del resolver: `npx vitest run test/frida-understand-app/resolver.test.ts` — 6/6 pasan.
- ✓ F1 veto confinado: `grep -c "VETADO" skills.ts` = 1 · `resolver.ts` = 0 · `grep -c "Q7" skills.ts` = 3 (≥1).
- ✓ F2 fases del script: `grep -c 'phase("' src/tools/frida-understand-app/workflow.ts` = 6 (exacto).
- ✓ F2 interpolación y cortes: `CAPABILITIES` = 8 · `frida.codebaseIndex.enabled` = 3 · `sin-evidencia` = 10 · `stoppedBy` = 13 (todos ≥1).
- ✓ F3 tests del patrón: `npx vitest run test/frida-understand-app/pattern.test.ts` — 22/22 pasan.
- ✓ F3 registro y ausencia de toggle: `createFridaUnderstandApp` en pi-session = 2 (exacto) · `moat` en builtin-patterns = 2 (≥1) · `understandAppEnabled` = 0 en tool-toggles.ts y pi-session.ts.
- ✓ F4 tests del módulo: `npx vitest run test/frida-extensible-workflows/moat-factories.test.ts` — 17/17 pasan.
- ✓ F4 presencia del seam: `createFridaLensFactory` = 4 · `pathToFileURL` = 3 · `codebaseIndexEnabled` = 5 · `registerTool` en la suite = 5 (todos cumplen).
- ✓ F5 tests del seam: `npx vitest run test/frida-extensible-workflows/moat-seam.test.ts` — 8/8 pasan.
- ✓ F5 cableado del motor: `patternMeta` en frida-host = 10 · `loadPatternMeta` en index = 3 · `buildSpawner` = 5 · `codebaseIndexEnabled` en index = 3 · `createFridaExtensibleWorkflows({` en pi-session = 1 · `createFridaLensFactory` en pi-session = 2 · `pathToFileURL` en pi-session = 0.
- ✓ F6 tests e2e: `npx vitest run test/frida-understand-app/e2e.test.ts` — 8/8 pasan (happy path, presupuesto, wall-clock, mentiroso, scout flaky, escritor flaky, juez FAIL, determinismo).
- ✓ F6 greps del suite: anclas = 10 · `writeArtifact` = 3 · `§Q` = 4 · `CONCERNS` = 10 · `FAKE_DATE_MOCK` = 2 (todos cumplen).
- ✓ F7 docs presentes: `test -s docs/tools/frida-understand-app.md && test -s docs/how-to-frida-understand-app.md` — ambas existen; `^##` = 14 (≥10) y 8 (≥8).
- ✓ F7 publicación: `frida-understand-app` en extension.ts = 3 · `"moat"` en extension.ts = 1 (alias no secuestrado) · en README.md = 1.
- ✓ Typecheck completo: `npm run typecheck && npm run typecheck:test` — limpio, sin errores.
- ✓ Suite completa del repo: `npm test` — 196 archivos pasados (8 omitidos), 2162 tests pasados / 19 omitidos / 0 fallos. Sin regresiones (incluye las suites M8 y del motor intactas).
- ✓ Cero dependencias nuevas: `git diff --exit-code package.json package-lock.json` — limpio, también contra la base del plan (`30ef616`).

### Code Review Findings

#### Matches Plan

- `src/tools/frida-understand-app/index.ts:34,57-64` — `detectUnderstandAppCapabilities` consume `piLensEntryPath` del motor (resolución S1 del Plan Review aplicada: literal de la entry único) y `isInstalledAtPin` AND toggle (D5/D6), exacto al plan.
- `src/tools/frida-extensible-workflows/builtin-patterns.ts:360-371` — campo `moat?: { lens?, codebaseIndex? }` aditivo e inerte, verbatim del plan.
- `src/tools/frida-extensible-workflows/core/types.ts:272-283` — `WorkflowMetadata.patternMeta?: JsonValue` opcional y aditivo con la justificación D4 completa.
- `src/tools/frida-extensible-workflows/frida-host.ts:313-317,334-337,380-401,447-451,487-488` — opts `patternMeta`, spread condicional (runs sin campo → metadata sin el campo), `loadPatternMeta` exportado (filtra flags no-boolean, nunca throw), retry hereda el patternMeta del source, comentario de resume sin reescritura del snapshot.
- `src/tools/frida-extensible-workflows/index.ts:257-293,330-344,381-395,426-437,782-796,836-849` — getter `codebaseIndexEnabled`, `moatAgentDir` + `buildSpawner` centralizando los 4 call sites (launch spawnAgent, createSpawnerForCwd, retry, resume), `patternMeta` persistido en foreground y background (shallow copy de `builtin.meta`), retry/resume leen `loadPatternMeta` del snapshot.
- `src/pi-session.ts` (fence fusionado) — dedup D2 completo: import `pathToFileURL` eliminado, bloque inline de lens reemplazado por `createFridaLensFactory(opts.agentDir)`, spread con la entry diferida; entrada del pack con `agentDir` + getter; entrada del motor pasando `codebaseIndexEnabled`.
- `src/tools/frida-extensible-workflows/moat-factories.ts` — imports exactos a los declarados (frida-agent-execution por composición, builtin-patterns type-only, frida-codebase-index wrapper, provider-audit type-only): dirección única de dependencia, sin ciclos.
- `src/tools/frida-understand-app/workflow.ts:405,582` — resolución del Plan Review aplicada: hint y signal del veredicto nombran pin antes que toggle e instruyen ejercitar `index_status` en modo guía.
- `src/extension.ts:4064-4073` — entrada HELP_TOOLS tras app-walkthrough con alias sin "moat" (first-match respetado); `README.md:213` — fila con doc + guía.
- Commit `dfdec0e` (Fase 1) lleva `Refs #134` en el cuerpo, como exige el plan.

#### Deviations from Plan

None — la implementación es una realización fiel del plan, incluidas las 4 resoluciones del Plan Review (smoke real como gate de la Fase 7, hint pin→toggle, `piLensEntryPath` compartida, comentario "normalizadas a forma de pregunta").

#### Pattern Conformance

- ✓ El pack espeja la estructura del molde M8 (`frida-app-walkthrough`): `skills.ts`/`resolver.ts`/`workflow.ts`/`index.ts` + suites `resolver`/`pattern`/`e2e`; el resolver es el 4º consumidor de `createLayeredStageResolver` de frida-aidd (mismo contrato de capas y JSON inválido aborta ruidosamente).
- ✓ El e2e sigue el patrón M8: enrutamiento por anclas verbatim del runtime context, mocks que escriben archivos reales (#83), `waitUntil` local, `FAKE_DATE_MOCK` en PATH.
- ✓ `moat-factories.test.ts` verifica registro REAL con pi falso (lección #91) y composición por NOMBRE para TODAS las factories (base 4 + moat según flags).
- Minor observation (aceptable, no es desviación): los diffs del motor y `pi-session.ts` absorben reformato de pi-lens (cambio de quotes en `args` de builtin-patterns, `// pi-lens-ignore` en core/types.ts, renormalización de spreads y comentarios `SAFETY` justificando casts). El plan esperaba absorberlo tras el commit (patrón c4cbe02); llegó pre-commit mezclado con el feature. Es churn style-only dentro de archivos ya declarados en el write-set del plan, sin efecto conductual — convención propia del repo.

#### Potential Issues

None — sin `risks:` en el frontmatter del plan que reglar; los criterios manuales abiertos son los pasos de usuario documentados abajo, no defectos.

### Manual Testing Required

1. Smoke real (criterio de cierre del issue #134):
   - [ ] Correr `workflow({ name: "understand-app", args: { maxHotspots: N } })` sobre un repo real y verificar empíricamente que las 10 tools del moat (4 pi-lens + 6 codebase-index) llegan a las sesiones hijas — valida también la duda de singletons de pi-lens (doble factory main+hija).
   - [ ] Verificar que `frida-tea`/`frida-aidd`/`app-walkthrough` no ven cambio alguno en su catálogo de tools de hijas (no-leakage en runtime real).
2. Catálogo y ayuda:
   - [ ] `workflow_catalog` lista `understand-app` con args documentados y `meta.moat` visible como JSON.
   - [ ] `/help understand` y `/help entendimiento` abren la doc del pack; `/help moat` sigue abriendo frida-learn.
3. Issue #134:
   - [ ] Actualizar el texto del issue ("skills sobre frida-workflow D32" → patrón builtin sobre frida-extensible-workflows).
4. Commit (paso siguiente del pipeline):
   - [ ] Commit atómico de las Fases 2–7 (pack+wiring+docs+README+HELP_TOOLS+tests, `Refs #134`); tras el commit, absorber el reformato automático de pi-lens (patrón c4cbe02) antes de cerrar.

### Recommendations

- Ready to commit — implementación completa y validada: los 43 criterios automatizados de las 7 fases verificados verde de forma independiente (61 tests nuevos del pack/seam + suite completa del repo 2162/2162 sin regresiones, typecheck limpio, cero dependencias nuevas).
- Ejecutar el smoke real (§Manual Testing 1) en un repo real antes de cerrar el issue #134: es el único criterio de cierre que no puede cubrirse estáticamente (valida la llegada de las 10 tools del moat a las hijas y la duda de singletons de pi-lens documentada en el design).
- Al commitear, mantener la disciplina del plan: un único commit atómico para las Fases 2–7 con `Refs #134`, y el reformato de pi-lens post-commit como commit `style` separado si vuelve a tocar archivos.
