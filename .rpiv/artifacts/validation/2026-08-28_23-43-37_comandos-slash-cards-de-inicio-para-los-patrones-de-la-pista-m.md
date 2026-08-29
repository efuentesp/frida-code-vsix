---
date: 2026-08-28T23:43:37-0600
author: Edgar F. Fuentes Perea
commit: 8a40bf4
branch: main
repository: frida-code
topic: "Validation of Comandos slash + cards de inicio para los patrones de la Pista M"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-28_19-58-41_pista-m-slash-commands-welcome.md"
tags: [validation, pista-m, slash-commands, welcome, register-command, send-user-message, frida-app-walkthrough, frida-understand-app, frida-size-app, starter-cards]
last_updated: 2026-08-28T23:43:37-0600
---

## Validation Report: Comandos slash + cards de inicio para los patrones de la Pista M

5ª corrida incremental (convención: 21:24:49 → fases 1-2, 21:47:56 → 1-3, 21:54:00 → 1-4, 23:14:49 → 1-5) — **corrida de cierre**: las 6 fases del plan están implementadas y verificadas; la Fase 6 vive en el árbol de trabajo lista para commit. El veredicto aplica a todas las fases marcadas `- [x]` (criterios automáticos); los criterios manuales (smoke e2e en vivo) quedan listados para el usuario.

### Implementation Status

- ✓ Phase 1: Molde slash command — frida-app-walkthrough (foundation) — Fully implemented (commit 7494428; validada en la corrida 21:54:00)
- ✓ Phase 2: Réplica — frida-understand-app — Fully implemented (commit 7494428; ídem)
- ✓ Phase 3: Réplica — frida-size-app — Fully implemented (commit 7494428; ídem)
- ✓ Phase 4: Fix del host — descripciones en autocompletado / — Fully implemented (commit 7494428; ídem)
- ✓ Phase 5: Cards de Welcome — Fully implemented (commit d01621c, bundle esbuild prístino verificado por SHA; validada en la corrida 23:14:49)
- ✓ Phase 6: Alineación de textos — validadores y how-tos — Fully implemented (árbol de trabajo, sin commitear; verificación completa en verde)

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — sin errores (re-ejecutado en esta corrida; ambos tsconfig)
- ✓ Suite completa del repo (fase terminal, baseline del proyecto): `npm test` — 216 archivos (208 pasados · 8 saltados), 2326 tests (2307 pasados · 19 saltados), 0 fallos — ejecutada contra el estado final del código (sin cambios en `src/` posteriores a la corrida)
- ✓ Motor intacto (AC del issue #140): `git diff --stat src/tools/frida-extensible-workflows/` vacío
- ✓ Validador walkthrough alineado: `"30 pantallas"` = 0; `"10 pantallas (recomendado)"` = 1; `/walkthrough` = 1 (re-ejecutado)
- ✓ Validador understand alineado: `"10 hotspots"` = 0; `"8 hotspots (recomendado)"` = 1; `/understand` = 1 (re-ejecutado)
- ✓ String args de size-app alineado: `sugiere el comando /size` = 1
- ✓ How-to walkthrough: `Tú: /walkthrough` = 3 (≥2); `¿Cuántas pantallas únicas documentar?` = 2 (≥2); `maxScreens: 30` = 0 (re-ejecutado)
- ✓ How-to understand: `Tú: /understand` = 3 (≥2); `¿Cuántas áreas de riesgo (hotspots) explorar?` = 2 (≥2); `maxHotspots: 10` = 0 (re-ejecutado)
- ✓ How-to size: `Tú: /size` = 2 (≥2); `¿Modo Basic COCOMO 81?` = 2 (≥2); `¿Salario MENSUAL por persona?` = 2 (≥2)
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan

- `workflow.ts` ×2 — throws de presupuesto ausente alineados byte-exacto a los fences: causa+remedio con las opciones de los QuickPicks de las Fases 1-3 ("10 pantallas (recomendado)" · "5" · "25" · "Todo"=0 / "8 hotspots (recomendado)" · "15" · "Todo"=0), `ask_user_question` como vía primaria y mención del comando guiado (`/walkthrough`, `/understand`); el resto de ambos validadores intacto (diffs de 1 línea por archivo)
- `src/tools/frida-size-app/index.ts` — string `args` de `SIZE_APP_PATTERN` alineado al orden real del comando `/size` (modo COCOMO → salario, opciones QuickPick embebidas); único cambio del archivo
- How-tos ×3 — SOLO los bloques listados en los fences: flujos típicos vía comando slash, pasos 2-4/1-3/1-2 reescritos con los títulos de los QuickPicks, recetas espejo con los defaults recomendados (maxScreens 10, maxHotspots 8, wage MXN 35000 + semi-detached), `maxMinutes` fuera de los flujos (D8); el resto de cada documento intacto
- Ámbito del delta — el árbol sucio son exactamente los 6 archivos declarados de la Fase 6 (+83/−62) más los checkmarks del plan; sin writes fuera del write-set (el bundle `dist-webview/assets/index-gE2gVxhC.js` es suciedad preexistente del hook de pi-lens, adjudicada en la corrida 23:14:49)
- Fases 1-5 sin deriva — `src/` sin cambios desde d01621c salvo los 3 archivos de la Fase 6; headers de `index.ts` ×2 ya alineados a 10/8 desde las fases 1-2

#### Deviations from Plan

- None. Implementation is a faithful realization of the plan (las 6 fases).

#### Pattern Conformance

- ✓ Los mensajes de error siguen el molde del repo (causa+remedio accionable, vía primaria `ask_user_question` antes que el comando — espejo del texto existente en `workflow.ts` de traffic2api con las opciones nuevas del FRD)
- ✓ Alcance respetado por diseño del plan: el validador de traffic2api (M9) y el string `args` breve de `understand/index.ts` quedaron fuera de la Fase 6 (no son criterio ni archivo declarado)
- ✓ How-tos conservan estructura de hermanos (fences ```text, tablas de problemas frecuentes, recetas)

#### Potential Issues

- `dist-webview/assets/index-gE2gVxhC.js` — suciedad preexistente del hook post-comando de pi-lens (variante biome vs prístino en histórico, commit d01621c; disposición detallada en la validación 23:14:49). No bloquea; `/skill:commit` no debe stagearla.
- Diagnósticos de pi-lens sobre el bundle generado (`no-cond-assign`, etc.) — preexisten verbatim en el bundle comprometido en HEAD: ruido de herramienta sobre artefacto generado, no defectos del run.

### Manual Testing Required

1. Smoke e2e por comando (sesión viva con F5 — los mocks no validan el AC principal, lesson 30ef616):
   - [ ] `/walkthrough https://app.ejemplo.com` → QuickPick "¿Cuántas pantallas únicas documentar?" (4 opciones); Esc en cualquier paso no envía nada (FR-8); mensaje → tool workflow → run visible en el panel
   - [ ] `/understand` → QuickPick "¿Cuántas áreas de riesgo (hotspots) explorar?" (3 opciones); flujo completo ídem
   - [ ] `/size` → "¿Modo Basic COCOMO 81?" y luego "¿Salario MENSUAL por persona?"; monto propio inválido (p. ej. "35,000") → error accionable sin envío (D15)
2. Autocompletado y Recursos (Fase 4 en vivo):
   - [ ] Dropdown `/` del Composer: los 3 comandos con descripción es-MX visible; los 25 built-in sin regresión visual
   - [ ] Recursos > Comandos: mismas entradas con su descripción
3. Welcome (sesión viva, transcript vacío):
   - [ ] 7 cards (4 existentes idénticas + 3 nuevas); grid 2 columnas
   - [ ] Click en las nuevas → insert sin enviar; Enter abre el flujo del comando
4. Error accionable residual (Fase 6 en vivo):
   - [ ] Pedir en lenguaje natural "ejecuta el workflow app-walkthrough con url <https://app.ejemplo.com>" (sin maxScreens) → el error del validador nombra las 4 opciones y sugiere `/walkthrough`; sesión intacta
   - [ ] Ídem understand (sin maxHotspots) → error nombra las 3 opciones y sugiere `/understand`
   - [ ] Lectura cruzada de los 3 how-tos: opciones citadas 1:1 con los QuickPicks; ejemplos con los defaults recomendados

### Recommendations

- `/skill:commit` — feat con los 6 archivos de la Fase 6 (textos alineados) + docs de esta validación; NO stagear el bundle biome (suciedad preexistente del hook).
- Con el commit aterrizado, el issue #140 queda verificado en su totalidad automatizada; el smoke e2e en vivo (ítem 1 del checklist manual) es la única brecha restante — al validarlo el usuario, el issue es elegible para cierre con evidencia conforme a la política del repo.
- Plan completo: las 6 fases implementadas, sin desviaciones ni deuda de verificación automatizada.
