---
template_version: 1
date: 2026-08-28T21:24:49-0600
author: Edgar F. Fuentes Perea
commit: abb1640
branch: main
repository: frida-code
topic: "Validation of Comandos slash + cards de inicio para los patrones de la Pista M"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-28_19-58-41_pista-m-slash-commands-welcome.md"
tags: [validation, pista-m, slash-commands, welcome, register-command, send-user-message, frida-app-walkthrough, frida-understand-app, starter-cards]
last_updated: 2026-08-28T21:24:49-0600
---

## Validation Report: Comandos slash + cards de inicio para los patrones de la Pista M

Alcance de este run: **Fases 1-2** (implementadas en esta sesión bajo modo single-phase secuencial). Las fases restantes se listan como pendientes — no se evaluaron sus criterios.

### Implementation Status

- ✓ Phase 1: Molde slash command — frida-app-walkthrough (foundation) — Fully implemented
- ✓ Phase 2: Réplica — frida-understand-app — Fully implemented
- ⚠️ Phase 3: Réplica — frida-size-app — Not implemented (pendiente; sin marcar en el plan, archivos no creados)
- ⚠️ Phase 4: Fix del host — descripciones en autocompletado / — Not implemented (pendiente; depende de 1-3)
- ⚠️ Phase 5: Cards de Welcome — Not implemented (pendiente; depende de 1-3)
- ⚠️ Phase 6: Alineación de textos — validadores y how-tos — Not implemented (pendiente; fase terminal que corre el baseline `npm test`)

### Automated Verification Results

Comandos ejecutados tal como los codifica el plan, por fase marcada:

- ✓ F1 Type checking: `npm run typecheck` — exit 0 (ambos tsconfig: host + webview)
- ✓ F1 Tests del pack: `npx vitest run test/frida-app-walkthrough/` — 4 archivos, 35 tests pasando (patrón + comando + resolver + e2e)
- ✓ F1 Stubs migrados: `grep -c "{} as never" test/frida-app-walkthrough/pattern.test.ts` — devuelve `0`
- ✓ F1 command.ts sin vscode estático: `grep -c "import \* as vscode" src/tools/frida-app-walkthrough/command.ts` — devuelve `0`
- ✓ F2 Type checking: `npm run typecheck` — exit 0
- ✓ F2 Tests del pack: `npx vitest run test/frida-understand-app/` — 4 archivos, 43 tests pasando
- ✓ F2 Stubs migrados: `grep -c "{} as never" test/frida-understand-app/pattern.test.ts` — devuelve `0`
- ✓ F2 command.ts sin vscode estático: `grep -c "import \* as vscode" src/tools/frida-understand-app/command.ts` — devuelve `0`
- ✓ No regressions detected — sin referencias residuales a `maxScreens: 30`/`maxHotspots: 12` en `src/`; call sites `pi-session.ts:673/:681` intactos y compilando; `npm test` completo diferido por diseño a la fase terminal (Fase 6)

### Code Review Findings

#### Matches Plan

- `src/tools/frida-app-walkthrough/command.ts` — molde completo según fence: `MAX_SCREENS_OPTIONS` (10 rec · 5 · 25 · todo=0, D10/D15), adapter `SlashPickUI` (pick/input/warn, undefined = Esc), `createDefaultPickUI()` con vscode LAZY (`await import("vscode")`), `buildWalkthroughPrompt` con formato FR-7 exacto (`Ejecuta el workflow 'app-walkthrough' con los siguientes argumentos:\n{ url: …, maxScreens: N }`), handler con guard D12 (claim estrechado: patrón ausente del registro, warning con causa+remedio `/reload`) y seam D2 (`ctx.isIdle()` → sendUserMessage plano, si no `{ deliverAs: "followUp" }`)
- `src/tools/frida-app-walkthrough/index.ts` — header `Uso:` con la línea `/walkthrough [url]` + ejemplo del header subido `maxScreens: 30 → 10` (review Step 5); `CreateFridaAppWalkthroughOptions` con `ui?` (inline type import); setup registra patrón y comando incondicional juntos
- `test/frida-app-walkthrough/pattern.test.ts` — describe de registro migrado: los 4 sitios stub ahora usan `setupPi()` (fake mínimo con `registerCommand` no-op); el resto del archivo intacto
- `test/frida-app-walkthrough/command.test.ts` — 8 tests según fence: armado exacto del mensaje, registro con descripción es-MX, URL inline sin InputBox, URL por InputBox con "Todo" → `maxScreens: 0`, seam no-idle `followUp`, cancelación silenciosa FR-8 (Esc/Enter-vacío en URL y Esc en QuickPick), guard D12
- `src/tools/frida-understand-app/command.ts` — réplica fiel con la adaptación propia del pack: sin URL/InputBox ni lectura de args (D5: el target es el cwd), único paso = QuickPick `maxHotspots` ("8 hotspots (recomendado)" · "15 hotspots" · "Todo (sin tope)" = 0); `input` conservado sin uso en el adapter (uniformidad del molde D4)
- `src/tools/frida-understand-app/index.ts` — header con `/understand` + ejemplo `maxHotspots: 12 → 8` (maxMinutes: 90 intacto, D8); `ui?` agregado al final de `CreateFridaUnderstandAppOptions`; setup (antes `_pi` sin usar) registra `/understand` incondicional junto al patrón
- `test/frida-understand-app/pattern.test.ts` — describe final migrado: los 6 sitios stub → `setupPi()`; tests D5/D6 del agentDir y del getter intactos
- `test/frida-understand-app/command.test.ts` — 7 tests según fence, incluido el guard de que `input` LANZA si se invoca (D5 — /understand no usa InputBox)
- Checkboxes: exactamente los 8 ítems de Automated Verification de Fases 1-2 marcados; ninguna otra sección del plan tocada

#### Deviations from Plan

- `test/frida-app-walkthrough/pattern.test.ts:147` y `test/frida-understand-app/pattern.test.ts:169` — el comentario migrado se rewordió respecto al fence ("el stub vacío (`as never`) ya no sirve" en vez del literal "el stub {} as never ya no sirve"): la cadena literal del fence hacía fallar el propio criterio automatizado de la fase (`grep -c "{} as never" … devuelve 0`). Mejora, no gap; cero impacto en comportamiento (solo comentario).

#### Pattern Conformance

- ✓ Adapter UI inyectable sigue el molde `WorktreeUI` (`src/worktree/command.ts:56-63`): métodos async que devuelven `undefined` al cancelar, default de producción separado
- ✓ `fakePi`/`fakeCtx` de los command.test.ts siguen los moldes citados por el plan (`test/frida-cc-plugins/presenter.test.ts:59-86`, `test/frida-goal/goal-runtime.test.ts:12-50`)
- ✓ Fences re-indentados de 1-espacio a tabs según la nota de estilo del propio plan (review Step 5); imports sin extensión (`./command`) consistentes con `./resolver` y hermanos
- Nota no-bloqueante: `SlashPickUI` se duplica por pack en vez de extraerse a un módulo compartido — decisión explícita del design (fakes copiables entre packs, D4), variación aceptable, no una desviación

#### Potential Issues

- None — el único riesgo conocido (guard D12 no cubre "motor apagado": el toggle `pi-session.ts:953-958` excluye el tool `workflow` pero no el registro de patrones) está documentado y aceptado en el propio plan (Developer Context, review Step 5); su remedio (getter `extensibleWorkflowsEnabled`) es un follow-up de design, no un defecto de esta implementación.

### Manual Testing Required

1. Fase 1 (sesión viva, F5 del host):
   - [ ] `/walkthrough https://app.ejemplo.com` abre el QuickPick "¿Cuántas pantallas únicas documentar?" con las 4 opciones del FRD
   - [ ] Esc en cualquier paso (InputBox de URL o QuickPick) no envía nada — sesión intacta (FR-8)
   - [ ] Smoke e2e por comando: 1 envío → 1 invocación del tool `workflow` → run visible en el panel (lesson 30ef616)
2. Fase 2 (sesión viva, F5 del host):
   - [ ] `/understand` abre el QuickPick "¿Cuántas áreas de riesgo (hotspots) explorar?" con las 3 opciones del FRD
   - [ ] Esc no envía nada (FR-8); smoke e2e ídem Fase 1

### Recommendations

- Continuar con `/skill:implement .rpiv/artifacts/plans/2026-08-28_19-58-41_pista-m-slash-commands-welcome.md Fase 3` (réplica frida-size-app) antes de commitear: el plan exige commit atómico final — handlers + cards + how-tos + stubs migrados + tests + `dist-webview/` aterrizan juntos (lessons 1ff6b0e/34d496a, Testing Strategy paso 9); el árbol actual de Fases 1-2 es verde pero parcial (2 de 6).
- El baseline completo `npm test` y el gate de diff vacío del motor (`git diff --stat src/tools/frida-extensible-workflows/`) corresponden a la fase terminal (Fase 6) — correrlos ahí, no ahora.
- Los smoke manuales listados arriba requieren el host desplegado con sesión viva; ejecutarlos tras completar las 6 fases (la validación M8/M10 los ejercitó en esa etapa del pipeline).
- Sin blockers: Fases 1-2 listas tal cual están.
