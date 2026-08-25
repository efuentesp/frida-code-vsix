---
template_version: 1
date: 2026-08-24T18:09:01-0600
author: Edgar F. Fuentes Perea
commit: d958d4f
branch: main
repository: frida-code
topic: "Validation of M8 skill pack frida-app-walkthrough — patrón builtin app-walkthrough: el agente usa la app como usuario y documenta su funcionalidad"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-24_17-14-22_app-walkthrough-m8.md"
tags: [validation, frida-app-walkthrough, frida-extensible-workflows, frida-agent-browser, pista-m, issue-133]
last_updated: 2026-08-24T18:09:01-0600
---

## Validation Report: M8 skill pack frida-app-walkthrough — patrón builtin app-walkthrough

Validación contra el working tree en `main` @ `d958d4f` (el commit de implementación). El plan no lleva `risks:` en frontmatter ni se recibieron flags `--goal`/`--baseline`/`--scope`.

### Implementation Status

- ✓ Phase 1: Foundation — skills + resolver 3-capas — Fully implemented
- ✓ Phase 2: Generador del workflow — workflow.ts — Fully implemented
- ✓ Phase 3: Patrón + registro — index.ts + pi-session.ts + pattern.test.ts — Fully implemented
- ✓ Phase 4: Docs + superficie — docs + README + HELP_TOOLS — Fully implemented
- ✓ Phase 5: e2e — binario mock + corrida real del script — Fully implemented

### Automated Verification Results

**Phase 1**

- ✓ Typecheck del paquete: `npm run typecheck` — sin errores (host + webview).
- ✓ Typecheck de tests: `npm run typecheck:test` — sin errores.
- ✓ Resolver en verde: `npx vitest run test/frida-app-walkthrough/resolver.test.ts` — 6/6 tests (defaults, equipo, usuario gana, ignora desconocidos/vacíos, JSON inválido aborta, veto solo en preamble).

**Phase 2** (greps estructurales contra `src/tools/frida-app-walkthrough/workflow.ts`)

- ✓ Pin de sesión: `grep -n "agent-browser --session"` — exactamente 2 líneas (función `ab()` + comentario del header), como pide el criterio corregido.
- ✓ Comandos por el pin: `grep -cE "abRun?\("` — 9 (≥ 9).
- ✓ Epoch sin Date: `grep -c "date +%s"` — 2 (≥ 2).
- ✓ Gate de artefacto: `grep -c "test -s"` — 3 (≥ 1).
- ✓ Heredoc fence-guard: `grep -c "WK_EOF"` — 2 (= 2).

**Phase 3**

- ✓ Suite del patrón: `npx vitest run test/frida-app-walkthrough/pattern.test.ts` — 14/14 (eager args, forma del script, registro runtime idempotente).
- ✓ Wiring: `grep -n "frida-app-walkthrough" src/pi-session.ts` — exactamente 2 líneas (import :122 + factory :683).
- ✓ Arranque completo post-wiring (lesson 34d496a): `npm test` — 2101 passed / 19 skipped (8 archivos skip preexistentes), 0 fallos.

**Phase 4**

- ✓ Docs no vacías: `test -s docs/tools/frida-app-walkthrough.md && test -s docs/how-to-frida-app-walkthrough.md` — exit 0.
- ✓ Fila única: `grep -c "frida-app-walkthrough" README.md` — 1 (fila :212, tras frida-tea :211).
- ✓ Links resueltos: ambos targets existen; además verificados todos los links relativos cruzados de las docs nuevas (frida-extensible-workflows, frida-tea, frida-aidd, frida-agent-browser, how-to-frida-tea).
- ✓ HELP_TOOLS: `grep -n "frida-app-walkthrough" src/extension.ts` — exactamente 3 líneas (file/howTo/label, :4060-4062); entrada data-only.
- ✓ Alias sin colisiones: `grep -rn '"walkthrough"' src/extension.ts` — exactamente 1 línea.
- ✓ Contrato documentado: `maxScreens` ×4 (≥ 3), `app-walkthrough/stages.json` ×2 (≥ 2), `--session` en how-to ×2 (≥ 2).
- ✓ Commit único atómico (lesson 1ff6b0e/D1): `git show --stat HEAD` — las 12 entradas del File Map (pack 4 src + wiring 2 + docs 2 + README + 3 suites) aterrizan juntas en `d958d4f` con footer `Refs #133` (más los 4 artefactos `.rpiv` del pipeline, práctica normal del repo).

**Phase 5**

- ✓ Suite e2e: `npx vitest run test/frida-app-walkthrough/e2e.test.ts` — 7/7 (tour feliz 5 pantallas/8 pasos/5 kinds con dedup, corte budget con checkpoint, corte wall-clock con `date` falsificado, escritor mentiroso/flaky, sesión muerta, inventario determinista deep-equal).
- ✓ Baseline completa: `npm run typecheck && npm run typecheck:test && npm test` — todo en verde.
- ✓ R10 cero deps: `git diff --exit-code package.json package-lock.json` — exit 0.
- ✓ No se detectaron regresiones.

### Code Review Findings

#### Matches Plan

- `src/tools/frida-app-walkthrough/skills.ts` — `WALKTHROUGH_STAGES` (explore/analyze/judge), prompts defaults es-MX, `WALKTHROUGH_PREAMBLE` con el veto de irreversibles; el test del resolver certifica que el veto vive SOLO en el preamble (inalcanzable para `stages.json`, D8).
- `src/tools/frida-app-walkthrough/resolver.ts:16` — reuso de `createLayeredStageResolver` de frida-aidd (tercer consumidor del customize-layer), rutas `.frida/app-walkthrough/stages.json` → `~/.frida/app-walkthrough/stages.json`.
- `src/tools/frida-app-walkthrough/workflow.ts` — validación eager idéntica al plan (`maxScreens` requerido con error que instruye `ask_user_question` pre-launch, 0=todo, rangos 0-200/1-240, `review` manual|auto); script de 5 fases secuenciales con cortes de presupuesto (budget/time/stepLimit) ANTES de la llamada `agent()`, snapshot post-error para `validate` (D11), `shq()` en todo posicional variable, `outputSchema` con los 5 kinds, IDs `padStart(2,"0")`, `invWrite()` tras cada registro.
- `src/tools/frida-app-walkthrough/index.ts` — `APP_WALKTHROUGH_PATTERN` con `meta.requiredTools: ["shell"]` + `executionHints.autonomous: true`, cwd lazy en `resolve()`, factory idempotente por nombre (test-asserted).
- `src/pi-session.ts:122,682-685` — wiring exacto en los anclajes del plan (import tras `createFridaTea`, entrada tras el bloque frida-tea), sin gate propio.
- `src/extension.ts:4052-4063` — entrada HELP_TOOLS data-only con los 7 aliases del plan.
- Docs fieles al patrón locked: juez PASS/CONCERNS/FAIL, entregables en `docs/funcional/`, sesión pre-autenticada, `maxScreens` requerido (0=todo); honestidad de alcance verificada (`app-rewalk` presentado como "patrón futuro", HAR diferido a M9, sin vender login automatizado ni navegación paralela).
- El delta del working tree sobre los 7 archivos del pack es reformato post-commit puro (verificado: los 4 archivos fuente son idénticos normalizando whitespace; los 3 tests difieren solo por line-wrapping + comas finales de prettier, no-ops semánticos) — typecheck y las 3 suites corren en verde contra el árbol reformateado, y los greps estructurales de Fase 2 siguen cuadrando.

#### Deviations from Plan

None. Implementation is a faithful realization of the plan.

#### Pattern Conformance

- ✓ El pack replica el molde frida-tea/frida-aidd 1:1: estructura `skills/resolver/workflow/index` + 3 suites, registro en runtime vía `registerBuiltinPattern`, sin tools propios ni ciclo de vida de sesión, entrada HELP_TOOLS data-only, fila README + doc técnica + how-to.
- ✓ Tests siguen las convenciones del repo: `HOME` aislado en tmpdir, `clearRegisteredBuiltinPatterns()` en afterEach, catálogo verificado con `toContain` (nunca conteo global), mocks honestos que escriben archivos reales (lesson bffd6f1).
- Minor observation (acceptable variation, not a deviation): el reformato pi-lens post-commit introduce indentación mixta espacios/tabs en fragmentos de `skills.ts` (objeto `DEFAULT_STAGE_PROMPTS`) — es el output del formateador y sigue la convención de commits `style: reformato pi-lens post-commit` ya establecida en el historial (ea1f0e7, 3cb5fc3, 262dc76); pendiente aterrizarlo como commit style propio.

#### Potential Issues

- Working tree con cambios fuera del write-set del plan: `docs/roadmap-extensiones.md` (modificado, +116 líneas — integración de la Pista M al roadmap) y `docs/modernization-apps.md` (untracked — investigación que origina esa actualización). NO forman parte del commit de implementación `d958d4f` ni del plan; parecen trabajo adyacente de roadmap. No bloquean (el plan no declara criterio de alcance del árbol y ninguna verificación los toca), pero deben aterrizar en commits propios y no cabalgar en commits de corrección del pack.
- Timing e2e (informativo): la MV de Fase 5 pide "<5 s por test (timeouts 30-45 s)". Standalone se cumple (~0.3-3.7 s; happy path ~2.2 s), pero bajo la suite completa el happy path sube a ~9.6 s por carga paralela — los timeouts siguen holgados y la suite es estable; sin acción requerida.

### Manual Testing Required

1. Superficie de UI (tras `/reload`):
   - [ ] `/help app-walkthrough` aterriza en el how-to y `/help walkthrough referencia` abre la doc técnica.
   - [ ] El picker `/wf` lista `app-walkthrough` bajo "Patrones agénticos" (sección dinámica del catálogo, sin wiring extra).
2. Smoke FRD (VN §8) — única verificación que los mocks no sustituyen:
   - [ ] Servidor local con login simple; pre-autenticar con `agent_browser({args: ["--session", "app-walkthrough", "open", url]})`; corrida `workflow({ name: "app-walkthrough", args: { url, maxScreens: 5 } })` produce README + 4 md + index.html + ≥1 screenshot y termina sin interacción post-bootstrap.
3. Presupuesto verificable ex-post:
   - [ ] `grep -c '"id": "P' docs/funcional/artifacts/inventory.json` ≤ maxScreens tras una corrida real.

### Recommendations

- Aterrizar el reformato pi-lens de los 7 archivos del pack como commit `style` propio (convención del repo), separado del trabajo de roadmap (`docs/roadmap-extensiones.md` + `docs/modernization-apps.md`) que merece su propio commit documental.
- El issue #133 queda en condiciones de cierre por parte del agente (implementación + verificación verde + commit `Refs #133`), dejando el smoke FRD de la app real como validación posterior del usuario si así lo decide.
- Verdict pass: implementación completa y validada; el commit atómico ya existe (`d958d4f`).
