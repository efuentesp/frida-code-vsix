---
date: 2026-08-29T08:13:28-0600
author: Edgar F. Fuentes Perea
commit: 0af904d
branch: main
repository: frida-code
topic: "Validation of M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-29_03-02-03_m2-panel-mapa-del-proyecto.md"
tags: [validation, m2, webview, settingshub, pi-lens, project-map, frida-app-walkthrough, frida-traffic2api]
last_updated: 2026-08-29T08:13:28-0600
---

## Validation Report: M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens

2ª corrida incremental (convención del repo; 1ª corrida 07-51-25 validó la Fase 1 en `pass`). Alcance de este run: **Fases 1-2** — las marcadas `- [x]` en el plan. Fase 1 commiteada (0af904d, ya verificada en la 1ª corrida y re-verificada aquí); Fase 2 implementada en el working tree SIN commitear, con su rebuild conjunto de `dist-webview/` listo para el commit. El veredicto aplica a las fases marcadas; las Fases 3-5 se listan como pendientes — no se evaluaron sus criterios. Implementación = 2/5 fases.

### Implementation Status

- ✓ Phase 1: Contrato del tab + mapa funcional host + lista honesta — Fully implemented (be7dc1c aterrizaje previo + 0af904d; verificado en la corrida 07-51-25, re-verificado aquí)
- ✓ Phase 2: Grafo SVG funcional + evidencia — Fully implemented en working tree (`GraphCanvas.tsx` + `FunctionalView.tsx` nuevos; cases `open_file`/`project_map_shot`; guard `safeResolveWithin`/`readScreenshotDataUri`; reducer de shots con merge; chips de la lista honesta retirados; 11 tests nuevos)
- ⚠️ Phase 3: Vista técnica (pi-lens) + re-poll — Not implemented (pendiente; sin `src/project-map/lens-project-report.ts` ni `TechnicalView` ni conmutador)
- ⚠️ Phase 4: Cruce técnico↔funcional (matriz M9) — Not implemented (pendiente; sin `src/project-map/matrix-cross.ts` ni `refreshPmCross`)
- ⚠️ Phase 5: Export HTML autónomo + aterrizaje — Not implemented (pendiente; fase terminal que corre el baseline `npm test` y documenta `docs/webview-ui-styles.md`)

### Automated Verification Results

Comandos ejecutados tal como los codifica el plan (criterios de Fases 1-2 marcadas), contra HEAD 0af904d + working tree de la Fase 2:

- ✓ Typecheck limpio (host + webview): `npm run typecheck` — exit 0 (ambos tsconfig)
- ✓ Tests del slice: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts` — 36/36 (lib 16 · tab 8 · store 12; la Fase 2 añadió 11 sobre los 25/25 de la Fase 1)
- ✓ Seam reducer Fase 2: `grep -c '"project_map_shot"' webview/store.ts` = 1 (≥1)
- ✓ Seam dispatcher Fase 2: `grep -c '"open_file"' src/extension.ts` = 1 (≥1); `grep -c '"project_map_shot"' src/extension.ts` = 3 (≥1: import de lectores + case + respuesta)
- ✓ Seam Fase 1 (re-verificado): `"project_map_state"` en `webview/store.ts` = 1; `"project_map"` en `src/extension.ts` = 1; `ProjectMapTab` en `webview/components/SettingsHub.tsx` = 2 (import + render)
- ✓ Bundle íntegro: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` — 2/2 en verde; el rebuild es reproducible (mismos hashes `index-Dqf14gfn.js`/`index-D8XPV0AQ.css` ya presentes en el working tree: fuente y bundle listos para el commit conjunto que exige el criterio)
- ✓ Diff funcional limpio: `git diff --check` sin errores; el diff de la Fase 2 toca exactamente los 11 archivos declarados (9 modificados + 2 nuevos en `webview/components/project-map/`) + `dist-webview/` + el propio plan (checks `[x]`)
- ✓ Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` vacío
- ✓ Sin regresiones — baseline `npm test`: 211 archivos pasados / 2335 tests (19 skipped), 0 fallos; sin recurrencia del flake `ENOTEMPTY` de la corrida anterior (preexistente y ambiental)

### Code Review Findings

#### Matches Plan

- `webview/components/project-map/GraphCanvas.tsx:1-262` — fiel al fence: `Fragment` importado nombrado (fix del slice-verifier aplicado), layout determinista por columnas (constantes COL_W 140/NODE_H 36/PREVIEW_H 66), aristas bezier con lanes `((ei % 4) - 1.5) * 7` y mismo-columna vertical con sag, previews en 3 estados (pendiente punteado "capturando…"/"sin captura"/data-URI), navegación por teclado ↑↓/Enter/Espacio vía `focusSibling` con `data-node-id`, colapso por render condicional del consumidor
- `webview/components/project-map/FunctionalView.tsx:1-238` — fiel al fence: `columnsOf` (una columna por pantalla en orden de primera visita, aristas solo `traversed`), shots on-demand con dedup por `requested` (ref) + reset en `[loadedAt]` (fix del triage Step 5 aplicado: prop `loadedAt: number`), `fails` listados bajo el grafo con `CAUSE_LABEL`, `evidenceOf` screenshot > snapshot, clic → `open_file`
- `webview/components/ProjectMapTab.tsx` — el cuerpo ready delega a `FunctionalView`; la lista honesta (chips, `STOP_REASON`, `byId`) se retiró del shell como manda la descomposición; `shots` del store viaja como prop
- `src/extension.ts:3495-3555` — cases `open_file` (rebase + guard de contención SIEMPRE, texto vía `openAtLine` / binario vía `vscode.open` con `BINARY_EXT` existente, try/catch que degrada a `showErrorMessage`) y `project_map_shot` (resuelve el path desde el inventory cargado — cero confianza en paths del cliente — y responde SIEMPRE, `dataUri: ""` = sin captura)
- `src/project-map/functional-inventory.ts:175-208` — `safeResolveWithin` (molde safeJoin re-implementado: `null` si el path sale del cwd) + `readScreenshotDataUri` (mime por extensión, techo 4 MB anti-postMessage, `""` ante cualquier fallo)
- `webview/store.ts:623-636` — case `project_map_shot` con merge (no replace): conserva `functional` y los shots ya cacheados (#126: cae al dispatch general)
- `webview/types.ts` — variante In `project_map_shot` (respuesta) + variantes Out `project_map_shot` (petición) y `open_file` con `line?`; espejo de la semántica undefined/""/data-URI documentado en `shots?`
- `webview/styles.css:11481-11600` — bloque del grafo SVG completo (`.pm-canvas` overflow auto max-height 56vh, `.pm-edge`/`.pm-arrow` textLink, focus visible en `:focus .pm-node-box`, `.pm-shot-pending` punteado, `.pm-fails`/`.pm-fail-row`); `.pm-journey-body` vuelve a `column`; `.pm-screen-chip` retirado; bloque reduced-motion extendido a nodos/aristas
- Tests — los 3 archivos extienden exactamente lo que publica el plan: lib (guard: dentro/../escape/absoluto; PNG: data-URI/no-imagen/inexistente/>4 MB), tab (fixture `fnData` con el edge attempted-failed `#3`, `renderFn` con `open` inyectado, 4 its del grafo), store (merge del shot sin perder `functional`)

#### Deviations from Plan

- Ninguna funcional. La Fase 2 está sin commitear (working tree): es el estado esperado pre-`/skill:commit` — el criterio "bundle en el MISMO commit que la fuente" está materializado a nivel de working tree (fuente + rebuild juntos, integridad 2/2) y se consuma en el commit conjunto. Nota de housekeeping: el comentario en `types.ts` "Campo adelantado de la Fase 2" (desviación tolerada en la 1ª corrida) se retiró correctamente ahora que la Fase 2 aterrizó — el código quedó como el plan final publica.

#### Pattern Conformance

- ✓ `FunctionalView`/`GraphCanvas` siguen los precedentes SVG manuales del repo (DonutChart/FridaRobotIcon): sin deps de grafo, SVG declarativo con clases `.pm-*` y variables `--vscode-*`
- ✓ Componente con props inyectadas en tests (`renderFn` con `open`/`post`/handlers no-op) — molde `productivity-tab.test.ts` (`renderToStaticMarkup`; efectos y handlers no corren, documentado)
- ✓ Lib host Node puro (`node:fs`/`node:path`, cero import de `vscode`) — `safeResolveWithin`/`readScreenshotDataUri` testeables en Node como exige el NFR Security
- ✓ Sin drift: `pm-screen-chip` sin residuos en CSS/componentes/tests; `docs/webview-ui-styles.md` sin `.pm-*` (correcto — llega en Fase 5); `projectMap` referenciado en exactamente los 7 archivos esperados; `SettingsHub.tsx` sin cambios post-Fase 1; `dist-webview/index.html` solo re-referencia los hashes del rebuild

#### Potential Issues

- `.pi-lens.json` (untracked, raíz del repo) — ya registrado en la 1ª corrida: artefacto de entorno preexistente al plan, no trabajo de esta corrida. No requiere acción.

### Manual Testing Required

Criterios manuales de las fases marcadas (Fase 1 + Fase 2; sin marcar en el plan — smoke del usuario):

1. Fase 1 · Paleta:
   - [ ] "Frida: Mapa del proyecto" abre el SettingsHub en el tab "Mapa" (en frío y en caliente)
2. Fase 1 · Sin insumos:
   - [ ] Sin `docs/funcional/` en el workspace: estado vacío con workaround "corre el patrón app-walkthrough (M8)", sin spinner eterno
3. Fase 1 · Persistencia:
   - [ ] Cambiar de pestaña del hub y volver: el mapa persiste sin "Cargando…" eterno (re-posteo en webview_ready)
4. Fase 2 · Grafo:
   - [ ] Journey colapsado por defecto; clic en la cabecera expande el grafo SVG horizontal (pantallas como columnas ~140px) con aristas bezier y scroll bidireccional en panel angosto (~350px)
5. Fase 2 · Evidencia:
   - [ ] Clic en nodo abre la evidencia: PNG en el visor de imágenes (vscode.open) cuando hay screenshot; snapshot .json en el editor de texto cuando no; ruta fuera del workspace rechazada con mensaje
6. Fase 2 · Shots on-demand:
   - [ ] Expandir un journey pide SOLO los screenshots de sus pantallas: "capturando…" → imagen; pantalla sin captura muestra "sin captura" y no se re-pide
7. Fase 2 · Plegado y a11y:
   - [ ] "Mostrar todo" / "Colapsar todo" funcionan; Tab entra a los nodos, ↑↓ mueve el foco, Enter abre la evidencia; `prefers-reduced-motion` sin transiciones
8. Fase 2 · Re-monte:
   - [ ] Cambiar de pestaña y volver: journeys re-colapsados (estado local), mapa re-carga en <1 s, shots en cache NO se re-piden

### Recommendations

- Listo para `/skill:commit`: agrupar la Fase 2 (fuente + `dist-webview/` + checks del plan) en el commit conjunto con `Refs #143` — validate corre pre-commit por diseño, sin churn de amend
- Continuar con `/skill:implement` (Fase 3: vista técnica pi-lens + re-poll; luego 4→5 en orden estricto) y re-ejecutar `/skill:validate` por aterrizaje o al cierre
- El veredicto `pass` de este run NO cierra el issue #143: el cierre requiere las 5 fases verificadas + smoke manual del usuario (AGENTS.md)
