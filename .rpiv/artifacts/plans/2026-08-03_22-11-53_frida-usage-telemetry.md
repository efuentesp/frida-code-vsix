---
date: 2026-08-03T22:11:53-0600
author: Edgar F. Fuentes Perea
commit: c90ad1a
branch: main
repository: frida-code
topic: "Frida Usage Dashboard + Export (frida-usage-report/v1)"
tags: [plan, usage, telemetry, dashboard, export, sdlc]
status: ready
parent: ".rpiv/artifacts/designs/2026-08-03_21-38-12_frida-usage-telemetry.md"
phase_count: 7
phases:
  - { n: 1, title: "Contrato v1 + tipos (foundation)", files: ["src/usage/report-schema.ts", "test/usage/report-schema.test.ts"], depends_on: [] }
  - { n: 2, title: "Indexer + clasificador de artefactos", files: ["src/usage/indexer.ts", "src/usage/artifact-classifier.ts", "test/usage/indexer.test.ts", "test/usage/fixtures/sample-a.jsonl"], depends_on: [1] }
  - { n: 3, title: "Identidad + opt-in + settings", files: ["src/usage/identity.ts", "src/settings.ts", "package.json"], depends_on: [1] }
  - { n: 4, title: "Report builder", files: ["src/usage/report-builder.ts", "test/usage/report-builder.test.ts"], depends_on: [2, 3] }
  - { n: 5, title: "Comando export + opt-in inline", files: ["src/extension.ts", "package.json"], depends_on: [3, 4] }
  - { n: 6, title: "Capa webview (mensajes)", files: ["webview/types.ts", "webview/store.ts", "src/extension.ts"], depends_on: [2] }
  - { n: 7, title: "Tab Uso + gráficas SVG/CSS", files: ["webview/components/SettingsHub.tsx", "webview/components/UsageDashboard.tsx", "webview/components/usage/KPICard.tsx", "webview/components/usage/BarChart.tsx", "webview/components/usage/DonutChart.tsx", "webview/components/usage/Heatmap.tsx", "webview/styles.css"], depends_on: [6] }
last_updated: 2026-08-03T22:11:53-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Frida Usage Dashboard + Export — Implementation Plan

## Overview

Implementa el **MVP (F1)** del dashboard de uso + export de Frida: un indexer que agrega `sessions/*.jsonl`, un tab "Uso" en el webview (6 KPIs + 6 gráficas SVG/CSS), y un comando `frida.exportUsage` que produce el reporte versionado `frida-usage-report/v1` para una app concentradora externa. Hereda 1:1 los 7 slices del diseño (`## Slices`); las decisiones (D1–D7) y el código copy-pasteable están en el design padre (`## Architecture`), que es la fuente canónica del código.

## Desired End State

Un usuario abre el tab "Uso" y ve, sobre sus sesiones reales, 6 KPIs + 6 gráficas con selector Hoy/7d/30d/Todo. Al ejecutar `Frida: Exportar reporte de uso`, se le pide opt-in inline, previsualiza el JSON `frida-usage-report/v1` y lo guarda. Ese JSON alimenta al concentrador. Verificación: `npm test` pasa, `npm run build` compila, y el reporte de una sesión real pasa `assertUsageReport`.

## What We're NOT Doing

- Concentrador/agregador, rankings centralizados, panel de admin (app externa).
- Clasificador SDLC real, `bugFixSignals`, `rework`, `codeQuality` reales (campos previstos en `v1`, `0`/`[]`/`false` en F1; F2–F4).
- Matriz cruzada 7×24 del heatmap (F1 produce `byHour[24]`/`byDow[7]` marginales → strips; F2 la matriz).
- Cruce contra métricas externas (tiempo/KLOCs/defectos) — responsabilidad del concentrador.

## Phase 1: Contrato v1 + tipos (foundation)

### Overview

Define el contrato `frida-usage-report/v1` (todos los campos; F2–F4 opcionales con default) + helpers de defaults + guard de versión. Foundation: todo depende de sus tipos.

### Changes Required

#### Contrato + tipos

**File**: `src/usage/report-schema.ts` (NEW)
**Changes**: tipos del reporte `v1` (`UsageReport` + interfaces de bloque), `USAGE_REPORT_SCHEMA`, helpers `empty*()`, `assertUsageReport()`.
**Código**: ver Design §Architecture → `src/usage/report-schema.ts — NEW` (código copy-pasteable, verificado en design Step 6.2).

#### Test del contrato

**File**: `test/usage/report-schema.test.ts` (NEW)
**Changes**: valida schema estable, defaults bien dimensionados (`byHour` 24 / `byDow` 7), guard de versión.
**Código**: ver Design §Architecture → `test/usage/report-schema.test.ts — NEW`.

### Success Criteria

#### Automated Verification

- [ ] Los tests del contrato pasan: `npx vitest run test/usage/report-schema.test.ts`
- [ ] Typechecking sin errores (incluye `src/usage/report-schema.ts`): `npx tsc --noEmit`

#### Manual Verification

- [ ] Los campos de `UsageReport` cubren el contrato `v1` boceteado en el research (§Desired End State) y los campos F2–F4 quedan como opcionales con default

---

## Phase 2: Indexer + clasificador de artefactos

### Overview

Agregador multi-sesión que modela `session-stats.ts` (caché por mtime + parseo defensivo), atribuye `usage` al modelo activo (trackea `model_change`), cuenta `toolCall` (`byTool`, `assistedKloc` por lenguaje, flags de adopción) y bucketiza por día/hora/dow.

### Changes Required

#### Indexer

**File**: `src/usage/indexer.ts` (NEW)
**Changes**: `indexUsage(opts)`, `UsageSnapshot`, `SessionSummary`, `Period`; caché por mtime, `parseRows`/`aggregate`, `periodRange`, `localParts` (Intl).
**Código**: ver Design §Architecture → `src/usage/indexer.ts — NEW`.

#### Clasificador de artefactos

**File**: `src/usage/artifact-classifier.ts` (NEW)
**Changes**: `classifyLanguage`, `classifyArtifactKind`, `countLines` (mapa extensión→lenguaje).
**Código**: ver Design §Architecture → `src/usage/artifact-classifier.ts — NEW`.

#### Test del indexer

**File**: `test/usage/indexer.test.ts` (NEW)
**Changes**: fixture determinista (tz UTC, timestamps fijos); valida conteo de sesiones/turnos, atribución de modelo, `assistedKloc`, buckets por hora, filtro por periodo.
**Código**: ver Design §Architecture → `test/usage/indexer.test.ts — NEW`.

#### Fixture

**File**: `test/usage/fixtures/sample-a.jsonl` (NEW)
**Changes**: sesión mínima (`session`/`model_change`/`assistant+usage+toolCall write`/`toolResult`).
**Código**: ver Design §Architecture → `test/usage/fixtures/sample-a.jsonl — NEW`.

### Success Criteria

#### Automated Verification

- [ ] Tests del indexer pasan (fixture determinista): `npx vitest run test/usage/indexer.test.ts`
- [ ] Typechecking sin errores: `npx tsc --noEmit`

#### Manual Verification

- [ ] Paridad: sobre una sesión real, los tokens/costo del snapshot coinciden con `readSessionStats` (`src/session-stats.ts`) para esa sesión

---

## Phase 3: Identidad + opt-in + settings

### Overview

Resuelve `ReportIdentity` (settings + git fallback + datos del host) y expone el flag de opt-in. **Paralelizable con Phase 2** (solo depende de Phase 1).

### Changes Required

#### Identidad

**File**: `src/usage/identity.ts` (NEW)
**Changes**: `resolveIdentity` (email con fallback `git config user.email`, repo de `git remote`, proyecto del workspace, `hostFingerprint` sha256, timezone), `git` inyectable para tests.
**Código**: ver Design §Architecture → `src/usage/identity.ts — NEW`.

#### Settings

**File**: `src/settings.ts` (MODIFY)
**Changes**: getters `getUserEmail`/`getOrg`/`getUserRole`/`isTelemetryOptIn` + setter `setTelemetryOptIn`; import de `UserRole`.
**Código**: ver Design §Architecture → `src/settings.ts — MODIFY`.

#### Configuración VS Code

**File**: `package.json` (MODIFY)
**Changes**: crear `contributes.configuration` con las 4 llaves `frida.user.email`/`org`/`user.role`/`telemetry.optIn`.
**Código**: ver Design §Architecture → `package.json — MODIFY` (bloque `configuration`; el `commands` se completa en Phase 5).

### Success Criteria

#### Automated Verification

- [ ] Typechecking sin errores (settings + identity): `npx tsc --noEmit`
- [ ] `package.json` sigue siendo JSON válido: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`

#### Manual Verification

- [ ] Las 4 llaves (`frida.user.email`, `frida.org`, `frida.user.role`, `frida.telemetry.optIn`) aparecen en la Settings UI de VS Code bajo "Frida"; `telemetry.optIn` por defecto en `false`

---

## Phase 4: Report builder

### Overview

Ensambla `UsageReport` (`v1`) desde el snapshot + identidad + nivel de detalle; `aggregated` vacía los breakdowns (privacy creciente).

### Changes Required

#### Builder

**File**: `src/usage/report-builder.ts` (NEW)
**Changes**: `buildReport(opts)`, `BuildReportOptions`; rellena `schema`/`generatedAt`/`period`/`consent`; `effectiveness`/`quality` en defaults (F3/F4).
**Código**: ver Design §Architecture → `src/usage/report-builder.ts — NEW`.

#### Test del builder

**File**: `test/usage/report-builder.test.ts` (NEW)
**Changes**: valida `v1` que pasa `assertUsageReport` + nivel `aggregated` vacía breakdowns conservando KPIs.
**Código**: ver Design §Architecture → `test/usage/report-builder.test.ts — NEW`.

### Success Criteria

#### Automated Verification

- [ ] Tests del builder pasan: `npx vitest run test/usage/report-builder.test.ts`
- [ ] Typechecking sin errores: `npx tsc --noEmit`

#### Manual Verification

- [ ] El reporte `v1` para una sesión real pasa `assertUsageReport` y los campos cuadran con el contrato boceteado (§Desired End State)

---

## Phase 5: Comando export + opt-in inline

### Overview

Registra `frida.exportUsage`: pick de periodo → opt-in inline (si no dado) → `indexUsage` + `resolveIdentity` + `buildReport` → previsualización (doc untitled) + `showSaveDialog`. Exporta anónimo (`email=""`) si se rechaza el opt-in.

### Changes Required

#### Host (comando + handler)

**File**: `src/extension.ts` (MODIFY)
**Changes**: función `exportUsage` (period pick, opt-in inline con `setTelemetryOptIn`, snapshot+identity+buildReport, preview+save) + registro del comando `frida.exportUsage` + imports.
**Código**: ver Design §Architecture → `src/extension.ts — MODIFY` (comando `exportUsage`; el `case "list_usage"` se añade en Phase 6 — misma ubicación de fence, reescrito completo allí).

#### Comando VS Code

**File**: `package.json` (MODIFY)
**Changes**: añadir `{ "command": "frida.exportUsage", "title": "Frida: Exportar reporte de uso" }` a `contributes.commands`.
**Código**: ver Design §Architecture → `package.json — MODIFY` (bloque `commands`).

### Success Criteria

#### Automated Verification

- [ ] Typechecking sin errores: `npx tsc --noEmit`
- [ ] `package.json` válido y con el comando: `node -e "const p=require('./package.json'); console.log(p.contributes.commands.some(c=>c.command==='frida.exportUsage'))"` imprime `true`

#### Manual Verification

- [ ] `Frida: Exportar reporte de uso` pide periodo → opt-in (si no dado) → abre preview del JSON → permite guardarlo; el archivo resultante pasa `assertUsageReport` (email="" si se eligió anónimo)

---

## Phase 6: Capa webview (mensajes)

### Overview

Añade el par `list_usage` (webview→host) / `usage_report` (host→webview) modelando `list_resources`. El webview es build separado, así que los tipos del snapshot se espejan como `UsageReportView` en `webview/types.ts`.

### Changes Required

#### Tipos del webview

**File**: `webview/types.ts` (MODIFY)
**Changes**: `UsagePeriod`, `UsageReportView` + tipos view, `state.usageReport`; extender `InMessage` (`usage_report`) y `OutMessage` (`list_usage`).
**Código**: ver Design §Architecture → `webview/types.ts — MODIFY`.

#### Reducer

**File**: `webview/store.ts` (MODIFY)
**Changes**: `case "usage_report"` (modela `case "resources"`) + limpiarlo en `case "cleared"`.
**Código**: ver Design §Architecture → `webview/store.ts — MODIFY`.

#### Handler host

**File**: `src/extension.ts` (MODIFY)
**Changes**: `case "list_usage"` en `handleWebviewMessage` (valida periodo, `indexUsage`, `post({type:"usage_report", report:snapshot, ...})`).
**Código**: ver Design §Architecture → `src/extension.ts — MODIFY` (fence reescrito completo: comando de Phase 5 + `case` de Phase 6).

### Success Criteria

#### Automated Verification

- [ ] Typechecking del host sin errores: `npx tsc --noEmit`
- [ ] Typechecking del webview sin errores: `npx tsc --noEmit -p tsconfig.webview.json`

#### Manual Verification

- [ ] El host responde a `list_usage` con `usage_report` y el store actualiza `state.usageReport` (verificable al abrir el tab "Uso" en Phase 7)

---

## Phase 7: Tab "Uso" + gráficas SVG/CSS

### Overview

Registra el tab `"usage"` en `SettingsHub`; `UsageDashboard` gestiona el selector de periodo, hace `post({type:"list_usage"})` al cambiar, y renderiza 6 KPIs + 6 gráficas SVG/CSS (0 dependencias). Slice terminal: lleva los baseline checks.

### Changes Required

#### Registro del tab

**File**: `webview/components/SettingsHub.tsx` (MODIFY)
**Changes**: `SettingsTab += "usage"`, entrada en `TABS` (`BarChart3`), render `<UsageDashboard/>`.
**Código**: ver Design §Architecture → `webview/components/SettingsHub.tsx — MODIFY`.

#### Dashboard

**File**: `webview/components/UsageDashboard.tsx` (NEW)
**Changes**: selector de periodo + fetch on change, 6 `KPICard`, grid de 6 `usage-card` (BarChart/DonutChart/Heatmap + top sesiones).
**Código**: ver Design §Architecture → `webview/components/UsageDashboard.tsx — NEW`.

#### Subcomponentes SVG/CSS

**File**: `webview/components/usage/KPICard.tsx` (NEW) · `BarChart.tsx` (NEW) · `DonutChart.tsx` (NEW) · `Heatmap.tsx` (NEW)
**Changes**: `KPICard`, `BarChart` (SVG vertical / CSS horizontal), `DonutChart` (SVG `strokeDasharray` + leyenda), `Heatmap` (strips de intensidad hora/día).
**Código**: ver Design §Architecture → los 4 archivos `webview/components/usage/*.tsx — NEW`.

#### Estilos

**File**: `webview/styles.css` (MODIFY)
**Changes**: clases para KPI cards, gráficas SVG/CSS, selector de periodo, top sesiones.
**Código**: ver Design §Architecture → `webview/styles.css — MODIFY`.

### Success Criteria

#### Automated Verification

- [ ] Typechecking del webview sin errores: `npx tsc --noEmit -p tsconfig.webview.json`
- [ ] Build del webview compila: `npm run build` (vite)
- [ ] Suite de tests del proyecto pasa: `npm test` (baseline de phase terminal)

#### Manual Verification

- [ ] Abrir el tab "Uso" muestra 6 KPIs + 6 gráficas con datos reales; el selector de periodo (Hoy/7d/30d/Todo) recalcula; sin errores en la consola del webview

---

## Whole-Plan Verification

Una vez aplicadas las 7 fases (o tras `/skill:implement` sin arg):

- [ ] `npm test` pasa (vitest: contrato + indexer + builder).
- [ ] `npm run build` compila (esbuild host + vite webview → `dist/` + `dist-webview/`).
- [ ] `npx tsc --noEmit` (host) y `npx tsc --noEmit -p tsconfig.webview.json` (webview) sin errores.
- [ ] End-to-end manual: tab "Uso" con datos reales + `Frida: Exportar reporte de uso` produce un `frida-usage-report/v1` que pasa `assertUsageReport`.

## Testing Strategy

### Automated

- `npx vitest run test/usage/` — contrato (`report-schema`), indexer (con fixture determinista), builder. Cobertura: atribución por modelo, `assistedKloc` desde `arguments`, buckets temporales, filtro por periodo, guard de schema, niveles de detalle.
- Typechecking dual: host (`tsconfig.json`) y webview (`tsconfig.webview.json`).
- `npm run build` — esbuild (host) + vite (webview).

### Manual Testing Steps (referencia, del research/design)

1. Abrir el tab "Uso" sobre sesiones reales y validar que los KPIs de tokens/costo cuadran con `readSessionStats` por sesión (paridad).
2. Ejecutar `Frida: Exportar reporte de uso`, rechazar el opt-in, y verificar que el JSON tiene `identity.email === ""`.
3. Repetir aceptando el opt-in y verificar que el JSON incluye `identity.email` + `org`.
4. Validar que el JSON pasa `assertUsageReport` (campo `schema` correcto).
5. Cambiar el selector de periodo y confirmar que el tab recalcula sin reindexar todo.

## Performance Considerations

- Indexer incremental por mtime (solo reindexa sesiones modificadas); snapshot cacheable (en F1 se recompute on open; `globalStorage/usage-index.json` como cache persistente es mejora post-MVP).
- Parseo defensivo: líneas malformadas se ignoran (como `session-stats.ts`).
- Snapshot enviado al webview una sola vez al abrir el tab; el selector de periodo recalcula desde el snapshot.
- Gráficas SVG/CSS = 0 KB de bundle (sin `recharts`/`d3`).

## Migration Notes

No aplica (greenfield). Las ~23 sesiones JSONL existentes son retroactivamente indexables al primer arranque del indexer.

## Developer Context

- **Origen del código**: el design padre (`.rpiv/artifacts/designs/2026-08-03_21-38-12_frida-usage-telemetry.md`) contiene TODO el código copy-pasteable y verificado en su `## Architecture` (generado y aprobado slice por slice en design Step 6). Este plan replica los 7 slices 1:1 como fases y **referencia** el bloque exacto del design donde vive cada archivo, en vez de duplicar ~2000 líneas (lo que añadiría riesgo de drift sin ganancia — el código ya es canonical y completo). `implement` debe leer el cuerpo de cada archivo del design's `## Architecture` correspondiente al `**File**` de cada fase.
- **Decisiones (D1–D7)**: ver design §Decisions. Resumen: D1 SVG/CSS a mano · D2 snapshot en `globalStorage` · D3 opt-in inline · D4 indexer modelo `session-stats.ts` · D5 `assistedKloc` desde `arguments` · D6 identidad settings+git · D7 contrato `v1` con campos F2–F4 opcionales.
- **Paralelismo**: Phase 3 (Identidad) puede correr en paralelo a Phase 2 (Indexer) — ambas dependen sólo de Phase 1 y no comparten archivos. Phase 5 y la cadena Phase 6→7 son independientes entre sí (distintos archivos, salvo `extension.ts` que tocan Phase 5 y Phase 6 en ubicaciones distintas — fusionar en orden 5→6).
- **Archivos tocados por varias fases**: `src/extension.ts` (Phase 5 comando + Phase 6 case — el design ya entrega el fence fusionado) y `package.json` (Phase 3 configuration + Phase 5 commands). `implement` aplica las contribuciones de ambas fases al mismo archivo.
- **Verificación de slices**: el `slice-verifier` (design Step 6.2) estuvo bloqueado por el `pi-permission-system` (sub-agentes sin UI interactiva); la verificación de atomicidad/consistencia por slice la hizo el agente principal (forward-refs, conflictos cross-slice, alineación código↔criterios). Igual limitación aplica al Step 4 de este plan (`artifact-code-reviewer` + `artifact-coverage-reviewer` no disponibles).

## Plan Review (Step 4)

_Independent post-finalization review por artifact-code-reviewer + artifact-coverage-reviewer. **No disponible en este entorno**: ambos sub-agentes están bloqueados por el `pi-permission-system_ ("requires approval, but no interactive UI is available"), igual que slice-verifier y los research agents. Se procedió a la revisión del desarrollador (Step 5) sin findings automáticos; la responsabilidad de la revisión de código queda en`/skill:implement` + `/skill:validate` contra el codebase real._

## References

- Design: `.rpiv/artifacts/designs/2026-08-03_21-38-12_frida-usage-telemetry.md` (fuente canónica del código).
- Research: `.rpiv/artifacts/research/2026-08-03_21-38-12_frida-usage-telemetry.md`.
- Código fuente (HEAD `c90ad1a`): ver design §Pattern References y §Current State Analysis.
