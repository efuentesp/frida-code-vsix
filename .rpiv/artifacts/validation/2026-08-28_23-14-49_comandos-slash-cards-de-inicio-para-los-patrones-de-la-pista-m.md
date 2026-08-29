---
date: 2026-08-28T23:14:49-0600
author: Edgar F. Fuentes Perea
commit: 897389c
branch: main
repository: frida-code
topic: "Validation of Comandos slash + cards de inicio para los patrones de la Pista M"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-28_19-58-41_pista-m-slash-commands-welcome.md"
tags: [validation, pista-m, slash-commands, welcome, register-command, send-user-message, frida-app-walkthrough, frida-understand-app, frida-size-app, starter-cards]
last_updated: 2026-08-28T23:14:49-0600
---

## Validation Report: Comandos slash + cards de inicio para los patrones de la Pista M

Validación incremental (4ª corrida; convención de las corridas 21:24:49 → Fases 1-2, 21:47:56 → 1-3, 21:54:00 → 1-4): el veredicto aplica a las fases marcadas `- [x]` en el plan (Fases 1-5); la Fase 6 está sin implementar y se lista como pendiente.

### Implementation Status

- ✓ Phase 1: Molde slash command — frida-app-walkthrough (foundation) — Fully implemented (commit 7494428; verificada en la corrida 21:54:00 y `src/` sin cambios desde entonces)
- ✓ Phase 2: Réplica — frida-understand-app — Fully implemented (commit 7494428; ídem)
- ✓ Phase 3: Réplica — frida-size-app — Fully implemented (commit 7494428; ídem)
- ✓ Phase 4: Fix del host — descripciones en autocompletado / — Fully implemented (commit 7494428; ídem)
- ✓ Phase 5: Cards de Welcome — Fully implemented (árbol de trabajo, sin commitear; ver Potential Issues para el estado del bundle)
- ○ Phase 6: Alineación de textos — validadores y how-tos — Not implemented (pendiente: marcadores `- [ ]` en el plan; textos viejos aún presentes en `workflow.ts`/how-tos; fuera del alcance verificado de este reporte)

### Automated Verification Results

- ✓ Type checking: `npm run typecheck` — sin errores (criterio de las Fases 1-5)
- ✓ Tests del Welcome: `npx vitest run test/welcome.test.ts` — 4 tests pasando (test de Starter Cards reemplazado conforme al fence de la Fase 5)
- ✓ Suites de los 3 packs: `npx vitest run test/frida-app-walkthrough/ test/frida-understand-app/ test/frida-size-app/` — 14 archivos / 149 tests pasando
- ✓ Guardas estructurales (Fases 1-3): `grep -c "{} as never" test/<pack>/pattern.test.ts` = 0 en los 3 packs; `grep -c "import \* as vscode" src/tools/<pack>/command.ts` = 0 en los 3 command.ts (vscode lazy)
- ✓ Fix del host (Fase 4): `grep -c 'description: ""' src/extension.ts` = 0; `grep -c 'description: String(e.commands?.get?.(n)?.description ?? "")' src/extension.ts` = 1
- ✓ Cards nuevas presentes (Fase 5): `grep -cE "Documentar una App|Entender el Código|Dimensionar para Preventa" webview/components/Welcome.tsx` = 3
- ✓ Las 4 existentes intactas (regresión FR-9/D6): `grep -cE "Planificar con AiDD|Diseñar Pruebas \(TEA\)|Auditar Codebase|Explicar Arquitectura" webview/components/Welcome.tsx` = 4
- ✓ Bundle rebuild refleja las cards (Fase 5): `npm run build:webview` exitoso y determinista (hash estable `index-gE2gVxhC.js`) con `grep -c "Documentar una App" dist-webview/assets/index-*.js` ≥ 1
- ✓ Motor congelado (AC #140): `git diff --stat src/tools/frida-extensible-workflows/` vacío — tanto en el árbol de trabajo como en `abb1640..HEAD`
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan

- `webview/components/Welcome.tsx` — STARTER_CARDS: exactamente las 3 cards del fence (`walkthrough`/`understand`/`size`, `actionType: "insert"`, prompt con espacio final solo en `/walkthrough`) agregadas al final del array tras "explain-arch"; las 4 existentes quedaron byte-idénticas (verificado por greps = 4 y asserts del test)
- `test/welcome.test.ts` — test de Starter Cards reemplazado íntegro conforme al fence: títulos + fragmento distintivo de cada desc nueva, asserts de las 4 existentes intactos; mantiene el patrón `renderToStaticMarkup` de la suite
- `dist-webview/` — rebuild determinista del bundle con las cards (criterio de la fase verificado sobre el output prístino del build)
- Fases 1-4 — verificadas en la corrida 21:54:00 (verdict pass) y sin deriva: `git diff` vacío en `src/` desde el commit 7494428; los greps de guardas estructurales y del fix del host siguen en verde
- Ámbito del árbol de trabajo — el dirty set (`Welcome.tsx`, `test/welcome.test.ts`, `dist-webview/` y los checkmarks del plan .md) está íntegro dentro de los archivos declarados de la Fase 5; sin writes fuera del write-set

#### Deviations from Plan

- None. Implementation is a faithful realization of the plan (Fases 1-5).

#### Pattern Conformance

- ✓ Las 3 cards siguen la forma exacta de sus hermanas existentes (`id`/`title`/`desc`/`iconName`/`prompt`/`actionType`, indentación a tabs); iconos `window` · `remote-explorer` · `graph` verificados en el set `@vscode/codicons` del repo
- ✓ `command.ts` por pack con adapter `SlashPickUI` inyectable y vscode lazy — misma forma que el molde `WorktreeUI` (`src/worktree/command.ts`); fakes `fakePi`/`fakeUi` calcan los moldes de `test/frida-cc-plugins/presenter.test.ts` y `test/frida-goal/goal-runtime.test.ts`

#### Potential Issues

- `dist-webview/assets/index-gE2gVxhC.js` — el hook post-comando de pi-lens biome-formatea el bundle generado cada vez que un comando bash lo toca: el output esbuild prístino (md5 `cac7932a84742a060404770d81bb2cfa`, 752201 B) muta al estado biome (md5 `a51f3352026de675e544a980dcf2ef5a`, 750517 B — el estado actual del árbol al momento de este reporte). La convención del repo es bundles prístinos (el bundle comprometido en HEAD tiene 0 firmas biome `=> {` y 22 esbuild `=>{`). **Antes de `/skill:commit`**: restaurar el prístino (copia en `/tmp/pristine-bundle.js`, o regenerar con `npm run build:webview`) y verificar el md5 antes de stagear. No bloquea la validación: los criterios de la fase (build exitoso + grep ≥ 1) se verificaron sobre el output prístino del build y la determinística está probada.
- Diagnósticos de pi-lens sobre el bundle (`no-cond-assign`, `switch_case`, `labeled_statement`) — preexisten verbatim en el bundle comprometido en HEAD (`index-Dx3bIQRL.js`, verificado con `git show`): internals minificados de react-dom, no defectos de este run. Ruido de herramienta sobre artefacto generado; el bundle no se reformatea ni se edita config del repo desde validate.

### Manual Testing Required

1. Smoke e2e por comando (sesión viva con F5 del host — los mocks no validan el AC principal, lesson 30ef616):
   - [ ] `/walkthrough https://app.ejemplo.com` → QuickPick "¿Cuántas pantallas únicas documentar?" (4 opciones del FRD); Esc en cualquier paso no envía nada (FR-8); mensaje → tool workflow → run visible en el panel
   - [ ] `/understand` → QuickPick "¿Cuántas áreas de riesgo (hotspots) explorar?" (3 opciones); flujo completo ídem
   - [ ] `/size` → "¿Modo Basic COCOMO 81?" y luego "¿Salario MENSUAL por persona?"; monto propio inválido (p. ej. "35,000") → error accionable sin envío (D15)
2. Autocompletado y Recursos (Fase 4 en vivo):
   - [ ] Dropdown `/` del Composer: `/walkthrough`, `/understand` y `/size` con descripción es-MX visible; los 25 built-in del host sin regresión visual
   - [ ] Recursos > Comandos: mismas entradas con su descripción
3. Welcome (sesión viva, transcript vacío):
   - [ ] 7 cards renderizadas (4 existentes idénticas + 3 nuevas); grid de 2 columnas se mantiene
   - [ ] Click en «Documentar una App» → inserta `/walkthrough` (con espacio) sin enviar; Enter abre el flujo del comando; ídem `/understand` y `/size` (sin espacio)
4. Commit del bundle junto a fuentes (criterio manual de la Fase 5):
   - [ ] `git status --porcelain dist-webview/` limpio tras el commit (restaurando antes el bundle prístino — ver Potential Issues)

### Recommendations

- Antes de `/skill:commit`: restaurar y verificar el bundle esbuild prístino (`/tmp/pristine-bundle.js` o rebuild) para no comprometer la variante biome-formateada que el hook dejó en el árbol.
- Fase 6 pendiente: implementarla (mensajes de los 2 validadores, string `args` de `SIZE_APP_PATTERN`, 3 how-tos espejo + `npm test` completo como fase terminal) y re-correr `/skill:validate` incremental.
- El smoke e2e en vivo queda como única brecha de verificación que los mocks no cubren — el usuario lo ejercita en su entorno.
- Listo para commitear el bloque Fases 1-5: implementación completa y validada en su alcance (commit atómico de Fase 5 según Testing Strategy paso 9 — handlers/stubs/tests ya aterrizaron juntos en 7494428; este commit cierra cards + bundle).
