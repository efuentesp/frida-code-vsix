---
template_version: 1
date: 2026-08-28T21:47:56-0600
author: Edgar F. Fuentes Perea
commit: abb1640
branch: main
repository: frida-code
topic: "Validation of Comandos slash + cards de inicio para los patrones de la Pista M"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-28_19-58-41_pista-m-slash-commands-welcome.md"
tags: [validation, pista-m, slash-commands, welcome, register-command, send-user-message, frida-app-walkthrough, frida-understand-app, frida-size-app, starter-cards]
last_updated: 2026-08-28T21:47:56-0600
---

## Validation Report: Comandos slash + cards de inicio para los patrones de la Pista M

Alcance de este run: **Fases 1-3** (las marcadas `- [x]` en el plan; implementadas en modo single-phase secuencial — este run añade la Fase 3 sobre la validación previa 21:24:49, que cubrió 1-2). Las fases restantes se listan como pendientes — no se evaluaron sus criterios.

### Implementation Status

- ✓ Phase 1: Molde slash command — frida-app-walkthrough (foundation) — Fully implemented (validado en 21:24:49; re-verificado verde en este run)
- ✓ Phase 2: Réplica — frida-understand-app — Fully implemented (ídem)
- ✓ Phase 3: Réplica — frida-size-app — Fully implemented (nuevo en este run)
- ⚠️ Phase 4: Fix del host — descripciones en autocompletado / — Not implemented (pendiente; depende de 1-3, ya desbloqueadas)
- ⚠️ Phase 5: Cards de Welcome — Not implemented (pendiente)
- ⚠️ Phase 6: Alineación de textos — validadores y how-tos — Not implemented (pendiente; fase terminal que corre el baseline `npm test`)

### Automated Verification Results

Comandos ejecutados tal como los codifica el plan, por fase marcada:

- ✓ F1 Type checking: `npm run typecheck` — exit 0 (ambos tsconfig: host + webview)
- ✓ F1 Tests del pack: `npx vitest run test/frida-app-walkthrough/` — 4 archivos, 35 tests pasando
- ✓ F1 Stubs migrados: `grep -c "{} as never" test/frida-app-walkthrough/pattern.test.ts` — devuelve `0`
- ✓ F1 command.ts sin vscode estático: `grep -c "import \* as vscode" src/tools/frida-app-walkthrough/command.ts` — devuelve `0`
- ✓ F2 Type checking: `npm run typecheck` — exit 0
- ✓ F2 Tests del pack: `npx vitest run test/frida-understand-app/` — 4 archivos, 43 tests pasando
- ✓ F2 Stubs migrados: `grep -c "{} as never" test/frida-understand-app/pattern.test.ts` — devuelve `0`
- ✓ F2 command.ts sin vscode estático: `grep -c "import \* as vscode" src/tools/frida-understand-app/command.ts` — devuelve `0`
- ✓ F3 Type checking: `npm run typecheck` — exit 0
- ✓ F3 Tests del pack: `npx vitest run test/frida-size-app/` — 6 archivos, 71 tests pasando (patrón + comando + resolver + workflow + e2e)
- ✓ F3 Stubs migrados: `grep -c "{} as never" test/frida-size-app/pattern.test.ts` — devuelve `0`
- ✓ F3 command.ts sin vscode estático: `grep -c "import \* as vscode" src/tools/frida-size-app/command.ts` — devuelve `0`
- ✓ No regressions detected — call sites `pi-session.ts:673/:681/:708` intactos y compilando; motor congelado intacto (`git diff --stat src/tools/frida-extensible-workflows/` vacío — AC del issue #140, verificado como chequeo de regresión en este run); sin drift de defaults viejos (`maxScreens: 30`/`maxHotspots: 12` ausentes de `src/`); archivos de Fases 4-6 (`src/extension.ts`, `webview/components/Welcome.tsx`, `test/welcome.test.ts`, `dist-webview/`, validadores `workflow.ts`, how-tos) sin toques parciales; string `args` de SIZE_APP_PATTERN sin alinear (`sugiere el comando /size` = 0 — correcto: ese cambio pertenece a la Fase 6, archivo compartido con la Fase 3)

### Code Review Findings

#### Matches Plan

- `src/tools/frida-size-app/command.ts` — réplica fiel del molde con las adaptaciones del pack según fence: `COCOMO_OPTIONS` (semi-detached rec · organic · embedded) y `WAGE_OPTIONS` (MXN $35,000 wage 35000 + currency "MXN" · USD $6,000 wage 6000 + currency "USD" · monto propio con `custom: true`), adapter `SlashPickUI` con el 4º método `error` (adaptación D15: entrada numérica inválida del usuario ≠ warning D12 de entorno), `createDefaultPickUI()` con vscode LAZY (`await import("vscode")`), `buildSizeAppPrompt` con formato FR-7 (wage siempre; `currency` solo cuando la opción del pick la trae — "monto propio" deja el default "USD"; `cocomoType` siempre JSON-stringify'd), handler con DOS QuickPicks en orden D10 (modo COCOMO → salario), InputBox numérico solo para monto propio con formato estricto `/^\d+(?:\.\d+)?$/` ANTES del parseFloat (la coma "35,000" se rechaza con causa+remedio, sin envío), guard D12 con claim estrechado (patrón ausente del registro, warning accionable con `/reload`) y seam D2 (`ctx.isIdle()` → sendUserMessage plano, si no `{ deliverAs: "followUp" }`)
- `src/tools/frida-size-app/index.ts` — header `Uso:` con `/size → QuickPicks por modo COCOMO y salario` acompañando el ejemplo existente de `workflow({...})`; import de `registerSizeAppCommand`; `ui?: import("./command").SlashPickUI` agregado al final de `CreateFridaSizeAppOptions` (molde inline type import); el setup (antes `_pi` sin usar) registra `/size` incondicional junto al patrón y conserva ÍNTEGRO el disparo fire-and-forget de `ensureBinary` (gate `isSccInstalledAtPin`, log de éxito solo en producción, catch con guía accionable V6)
- `test/frida-size-app/pattern.test.ts` — describe final de registro migrado: los 8 sitios stub ahora usan `setupPi()` (fake mínimo con `registerCommand` no-op); los 7 tests del fence presentes (smoke de registro, catálogo con code-review, idempotencia por nombre, agentDir propio interpola CAPABILITIES+SCC_BIN D3/D12, getter codebaseIndexEnabled degrada D3, V6 registra aunque ensureBinary rechace, gate idempotente no dispara si ya instalado); el resto del archivo intacto (describes de validación eager, sonda, forma del script, e2e)
- `test/frida-size-app/command.test.ts` — 10 tests según fence: `buildSizeAppPrompt` MXN y sin-currency exactos, factory registra `/size` con descripción es-MX, armado completo MXN (args ignorados D5), USD $6,000, monto propio " 45000.50 " → `wage: 45000.5` sin currency, no-idle `followUp`, cancelación silenciosa FR-8 (Esc en cocomoType o wage; Esc/Enter-vacío en monto propio sin error), monto inválido (coma · texto · 0 · negativo) → error accionable D15 con 0 envíos, guard D12 con `/reload`. HERENCIA del pack aplicada: HOME aislado en `beforeEach`/`afterEach` + `noNetworkDeps` rechazante
- Checkboxes: exactamente los 12 ítems de Automated Verification de Fases 1-3 marcados `[x]`; ninguna otra sección del plan tocada

#### Deviations from Plan

- `test/frida-size-app/pattern.test.ts:355` — mismo reword benigno ya registrado para Fases 1-2 en la validación previa: el comentario migrado dice "stub vacío (`as never`)" en vez del literal "stub {} as never ya no sirve" del fence, porque la cadena literal del fence haría fallar el propio criterio automatizado de la fase (`grep -c "{} as never" … devuelve 0`). Mejora, no gap; cero impacto en comportamiento (solo comentario).

#### Pattern Conformance

- ✓ `command.test.ts` de size-app sigue el molde de walkthrough (fakePi/fakeCtx/fakeUi) y añade la herencia propia del pack (HOME aislado + ensureDeps rechazante) que el File Map del plan exige
- ✓ `SlashPickUI` de size-app agrega `error` como 4º método — adaptación explícita del plan (D15), no drift; re-indentación a tabs aplicada según la nota de estilo del propio plan (review Step 5)
- ✓ Tests con `await vi.waitFor` para los warns del fire-and-forget, consistentes con el estilo de `pattern.test.ts` del pack
- Nota no-bloqueante: `SlashPickUI` se duplica por pack (3 definiciones) en vez de extraerse a un módulo compartido — decisión explícita del design (fakes copiables entre packs, D4), variación aceptable, no una desviación

#### Potential Issues

None — el único riesgo conocido (guard D12 no cubre "motor apagado": el toggle `pi-session.ts:953-958` excluye el tool `workflow` pero no el registro de patrones) sigue documentado y aceptado en el propio plan (Developer Context, review Step 5); su remedio (getter `extensibleWorkflowsEnabled`) es un follow-up de design, no un defecto de esta implementación.

### Manual Testing Required

1. Fase 3 (sesión viva, F5 del host):
   - [ ] `/size` abre "¿Modo Basic COCOMO 81?" ("semi-detached (recomendado)" · "organic" · "embedded") y luego "¿Salario MENSUAL por persona?" (MXN $35,000 · USD $6,000 · monto propio)
   - [ ] Esc en cualquier paso (ambos QuickPicks, InputBox del monto propio) no envía nada — sesión intacta (FR-8)
   - [ ] Monto propio inválido (p. ej. "35,000") muestra error accionable sin envío (D15)
   - [ ] Smoke e2e por comando: 1 envío → 1 invocación del tool `workflow` → run visible en el panel (lesson 30ef616)
2. Fases 1-2 (sesión viva, F5 del host):
   - [ ] `/walkthrough https://app.ejemplo.com` abre el QuickPick de pantallas (4 opciones del FRD); Esc no envía nada (FR-8); smoke e2e ídem
   - [ ] `/understand` abre el QuickPick de hotspots (3 opciones del FRD); Esc no envía nada (FR-8); smoke e2e ídem

### Recommendations

- Continuar con `/skill:implement .rpiv/artifacts/plans/2026-08-28_19-58-41_pista-m-slash-commands-welcome.md Fase 4` (fix del host — descripciones en autocompletado `/`) antes de commitear: el plan exige commit atómico final — handlers + cards + how-tos + stubs migrados + tests + `dist-webview/` aterrizan juntos (lessons 1ff6b0e/34d496a, Testing Strategy paso 9); el árbol actual de Fases 1-3 es verde pero parcial (3 de 6).
- El baseline completo `npm test` y los gates de alineación de textos (greps de la Fase 6) corresponden a la fase terminal — correrlos ahí, no ahora.
- Los smoke manuales listados arriba requieren el host desplegado con sesión viva; ejecutarlos tras completar las 6 fases (la validación M8/M10 los ejercitó en esa etapa del pipeline).
- Sin blockers: Fases 1-3 listas tal cual están.
