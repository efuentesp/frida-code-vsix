---
date: 2026-08-28T23:57:41-0600
author: Edgar F. Fuentes Perea
commit: 202751d
branch: main
repository: frida-code
topic: "M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens"
tags: [intent, frd, m2, pista-m, webview, settingshub, pi-lens, frida-app-walkthrough, project-map]
status: ready
last_updated: 2026-08-28T23:57:41-0600
last_updated_by: Edgar F. Fuentes Perea
---

# FRD: M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens

## Summary

Tab nuevo "Mapa del proyecto" en el SettingsHub de la webview de Frida, con dos vistas conmutables renderizadas en React nativo: **Funcional** (grafo de journeys de M8 desde `docs/funcional/artifacts/inventory.json`) y **Técnica** (mapa del proyecto vía `projectReport` de pi-lens, import dinámico host-side). Clic en nodo abre su evidencia en el editor; overlay de riesgo en la vista técnica; cruce técnico↔funcional cuando exista la matriz de M9; export HTML autónomo para compartir. Apunta a un stakeholder que no leerá markdown.

## Problem & Intent

Palabras del developer (Step 2, entrevista): **"Stakeholder / demo — alguien que no va a leer markdown: necesita VER el entendimiento de la app en una pantalla y entenderla en minutos."**

Hoy M8/M1/M9/M10 ya generan el entendimiento de una app desconocida, pero vive como documentos (markdown, JSON) fuera de la UI: no hay forma de comunicarlo a un equipo o stakeholder sin salir a leer archivos. El éxito se ve la primera vez que esa persona abre el panel y entiende la app en minutos.

## Goals

- Un stakeholder no técnico entiende la app desde UNA pantalla dentro de Frida, en minutos, sin leer markdown.
- Ambos mapas (funcional journeys · técnico pi-lens) explorables con el mouse, con estética nativa VS Code.
- Todo nodo trazable a evidencia: clic → archivo fuente, documento o screenshot.
- Llevable fuera de VS Code: export del mapa como HTML autónomo para presentaciones.

## Non-Goals

- Edición del grafo — las vistas son de solo lectura.
- Sustituir el `index.html` autónomo que M8 ya escribe en `docs/funcional/` (sigue existiendo como artefacto).
- Actualización en vivo (watchers de archivos) — fuera de alcance v1.
- Generar entendimiento nuevo — M2 visualiza lo que M8/M9/pi-lens ya produjeron; no explora ni analiza.

## Functional Requirements

1. El sistema SHALL registrar un tab `projectMap` en el SettingsHub (unión `SettingsTab` + array `TABS` + rama de render), con el contrato `{ state, post }` de los tabs existentes.
2. El sistema SHALL ofrecer dos vistas conmutables dentro del tab: **Funcional** y **Técnica**.
3. La vista funcional SHALL construir el grafo de journeys desde `docs/funcional/artifacts/inventory.json` (screens `P01..` + `actionLog` step→screenId→kind/outcome), agrupado por journey y **colapsado por defecto**, con toggle "mostrar todo".
4. La vista técnica SHALL obtener el mapa del proyecto llamando `projectReport(cwd)` de pi-lens vía import dinámico host-side de `dist/clients/lens-engine.js` (patrón moat-factories), renderizando subsystems (directorios + edges), hubs y entryPoints, acotado por defecto (top N) con toggle.
5. La vista técnica SHALL sobreponer el riesgo: `riskHotspots` resaltados sobre el grafo; `deadWeight` listado sutil.
6. El clic en nodo SHALL emitir `{ type: "open_file", file, line? }` que el host resuelve invocando `openAtLine()` — nodos técnicos abren fuente; nodos funcionales abren su evidencia (screenshot, snapshot de paso o documento en `docs/funcional/`).
7. El sistema SHALL mostrar estados vacíos accionables: sin `docs/funcional/` → "corre `/walkthrough` para generar el mapa funcional"; grafo pi-lens en build → estado "construyendo…" que se resuelve solo (re-poll automático mientras `available:false`); sin matriz M9 → el cruce se omite con nota, sin error.
8. Cuando exista la matriz funcionalidad↔endpoint↔módulo de M9 para la app, el sistema SHALL enlazar pantallas↔módulos entre ambas vistas (cruce técnico↔funcional).
9. El sistema SHALL exportar la vista actual del mapa como HTML autónomo (patrón del generador de M8: JSON embebido, sin dependencias externas), vía diálogo de guardado.
10. La vista funcional SHALL cargar al abrir el tab y contar con botón de refresh manual; sin watcher del host.

## Non-Functional Requirements

- **Performance**: cientos de pantallas (`maxScreens` "Todo"=0) renderizan sin bloquear la webview — el colapso por defecto carga pereozamente; `projectReport` corre en el host, no en la webview.
- **Security**: solo lectura de archivos del workspace; el export escribe únicamente con diálogo de guardado confirmado; sin red.
- **UX / Accessibility**: tokens `--vscode-*` + Codicons + filas planas (nada de cajas pesadas); navegable por teclado (Tab/Enter); `prefers-reduced-motion` respetado; usable en panel angosto.
- **Reliability**: sin insumo o con insumo corrupto → estado vacío accionable, **nunca un spinner eterno** (lección del issue #142); el contrato no-bloqueante de cache fría de pi-lens se respeta.

## Constraints & Assumptions

- Convenciones del repo: UI en es-MX, Conventional Commits con `Refs #143`, TDD, motor `frida-extensible-workflows` intocado (congelado).
- Sin dependencias webview pesadas nuevas (no d3/reactflow) — layout de grafo propio en SVG.
- `dist-webview/` se rebuild-a determinista y va prístino (guarda: `test/dist-bundle-integrity.test.ts`).
- Supuesto: el path `pi-lens/dist/clients/lens-engine.js` en el agentDir instalado se mantiene estable; el schema de `inventory.json` (screens/actionLog) es estable tal como lo escribe M8 hoy.
- Supuesto a verificar en research: ubicación/formato exactos de la matriz M9 para el cruce; CSP de la webview para referenciar screenshots locales; política de `webview` para recursos `vscode-resource`/`vscode-webview-resource`.

## Acceptance Criteria

- [ ] Tab "Mapa" visible en el SettingsHub; al abrirlo muestra las dos vistas conmutables.
- [ ] Con `docs/funcional/` de una app demo: la vista funcional renderiza journeys agrupados y colapsados por defecto; el toggle expande todo.
- [ ] La vista técnica renderiza subsystems/hubs del proyecto activo con cache caliente; con cache fría muestra "construyendo…" y resuelve sola sin intervención.
- [ ] Clic en un nodo técnico abre el archivo fuente en el editor; clic en un nodo funcional abre su evidencia.
- [ ] Sin `docs/funcional/`: estado vacío con la acción "corre /walkthrough" — sin spinner eterno.
- [ ] El export produce un HTML autónomo que se abre en navegador sin Frida instalado.
- [ ] `npm test` en verde (incluidos tests nuevos del tab) · `npm run typecheck` limpio.
- [ ] Smoke en vivo en panel angosto, temas oscuro y claro.

## Recommended Approach

Componente `ProjectMapTab` nuevo en `webview/components/` (contrato `{ state, post }`, registro en `SettingsHub.tsx:13-33`/`:415-462`) con dos vistas hijas y un renderer de grafo SVG propio; wiring host: par `OutMessage`/`InMessage` (`project_map` + `open_file`) en el dispatcher existente (`extension.ts:2521`) invocando `projectReport` vía import dinámico de `lens-engine.js` (patrón `moat-factories.ts:59-92`) y un lector de `inventory.json`; export reusando el patrón HTML autónomo de M8 (`workflow.ts:581`). Sin persistencia nueva, sin watchers, sin deps pesadas.

## Decisions

### Intención — ¿a quién le duele?

**Question**: ¿A quién le duele que el entendimiento viva solo en markdown, y cómo se ve el éxito la primera vez que abre el panel?
**Recommended**: n/a — pregunta `intent`.
**Chosen**: Stakeholder / demo — alguien que no va a leer markdown; necesita VER el entendimiento en una pantalla y entenderlo en minutos.
**Rationale**: El framing del developer angostó el probe hacia la experiencia de visualización sobre la exhaustividad técnica.

### El panel vive como tab del SettingsHub

**Question**: Pre-resuelto de evidencia — confirmado en lote (Step 4).
**Recommended**: Tab nuevo en `SettingsHub` (unión + `TABS` + rama de render).
**Chosen**: Confirmar.
**Rationale**: evidence: `webview/components/SettingsHub.tsx:13-33` + `:415-462` (patrón `{ state, post }` de ProductivityTab/UsageDashboard) + confirmado.

### Clic en nodo → `open_file` conectado a `openAtLine`

**Question**: Pre-resuelto de evidencia — confirmado en lote (Step 4).
**Recommended**: `OutMessage` nuevo `{type:"open_file", file, line?}` + case en el dispatcher que invoque `openAtLine()`.
**Chosen**: Confirmar.
**Rationale**: evidence: `src/extension.ts:4691-4698` (`openAtLine` reutilizable, hoy solo desde QuickPick) + `webview/types.ts:1062` (`OutMessage`) + confirmado.

### Mapa técnico vía import dinámico de `lens-engine.js`

**Question**: Pre-resuelto de evidencia — confirmado en lote (Step 4).
**Recommended**: Import dinámico host-side de `pi-lens/dist/clients/lens-engine.js` llamando `projectReport(cwd)`; sin MCP ni subprocess.
**Chosen**: Confirmar (frente a alternativas MCP stdio / CLI).
**Rationale**: evidence: patrón vigente en `src/tools/frida-extensible-workflows/moat-factories.ts:59-92`; contrato JSON documentado en `dist/clients/project-report.js:536-562` + confirmado.

### Fuente del mapa funcional = `inventory.json` de M8

**Question**: Pre-resuelto de evidencia — confirmado en lote (Step 4).
**Recommended**: Leer `docs/funcional/artifacts/inventory.json` (fuente de verdad determinista); no parsear markdown.
**Chosen**: Confirmar.
**Rationale**: evidence: `src/tools/frida-app-walkthrough/workflow.ts:313-321` (escritor determinista: screens + actionLog con IDs estables) + confirmado.

### Alcance v1 — núcleo + hotspots + cruce + export

**Question**: Además del núcleo (dos vistas + clic→archivo + estados vacíos), ¿qué entra en v1?
**Recommended**: Dos vistas núcleo.
**Chosen**: Núcleo + overlay de hotspots + cruce técnico↔funcional + export/compartir.
**Rationale**: v1 ambicioso elegido por el developer; el cruce queda condicionado a la existencia de la matriz M9 de esa app (degradación digna sin ella, FR-7/FR-8).

### Render React nativo vs embeber el `index.html` de M8

**Question**: ¿React nativo en la webview o embeber el index.html autónomo que M8 genera?
**Recommended**: React nativo.
**Chosen**: React nativo.
**Rationale**: Optimiza theming nativo `--vscode-*`, clic→archivo integrado y el cruce en UNA superficie; sacrifica mantener layout de grafo propio (SVG, sin lib pesada). El embed (workflow.ts:581) habría bloqueado el cruce y duplicado el lenguaje visual.

### Presentación por defecto con inventarios grandes

**Question**: ¿Colapsado con toggle o todo expandido?
**Recommended**: Colapsado con toggle.
**Chosen**: Colapsado con toggle.
**Rationale**: Optimiza la legibilidad de la demo a primera vista con cientos de nodos (`maxScreens` "Todo"=0); cuesta lógica de colapso perezoso.

### Cache fría de pi-lens

**Question**: ¿Re-poll automático o reintento manual?
**Recommended**: Re-poll automático.
**Chosen**: Re-poll automático.
**Rationale**: El contrato de pi-lens ya es no-bloqueante (`available:false` + hint + build en background); el re-poll resuelve solo sin fricción para el stakeholder.

### Refresh del mapa funcional

**Question**: ¿Recarga al abrir + botón manual, o watcher automático?
**Recommended**: Al abrir + manual.
**Chosen**: Al abrir + manual.
**Rationale**: Patrón vigente `useEffect`+`post` del SettingsHub (SettingsHub.tsx:54-64); el watcher añade wiring host y re-renders sorpresivos sin valor para la demo.

## Open Questions

- Ninguna — todas las ramas del árbol quedaron con decisión (los supuestos a verificar — matriz M9, CSP de screenshots — viven en Constraints & Assumptions para `research`).

## Suggested Follow-ups

- El `index.html` autónomo de M8 (`src/tools/frida-app-walkthrough/workflow.ts:581`) ya da una vista funcional compartible fuera de VS Code — el export de M2 lo supera para demos, pero conviene referenciarlo desde la vista para no bifurcar manteniendo dos generadores.
- `deadWeight` del contrato de pi-lens queda solo listado sutil (FR-5); una vista de deuda/código muerto propia sería follow-up, no v1.
- El lector de la matriz M9 podría compartirse: `frida-traffic2api/workflow.ts:792-802` ya consume `inventory.json` vía shell dentro de workflows.

## References

- Issue #143 — "M2: panel Mapa del proyecto" (github.com/efuentesp/frida-code-vsix/issues/143)
- `docs/roadmap-extensiones.md` — Pista M, orden 5 (M2)
- `docs/modernization-apps.md` — marco de la Pista M
- Issues hermanos: #133 (M8), #134 (M1), #135 (M9), #139 (M10)
- Probe (Step 3): codebase-locator "m2-webview-seam" · codebase-analyzer "m2-data-sources" (reportes en contexto de sesión)
