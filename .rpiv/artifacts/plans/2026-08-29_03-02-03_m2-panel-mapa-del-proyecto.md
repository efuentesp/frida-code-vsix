---
date: 2026-08-29T03:02:03-0600
author: Edgar F. Fuentes Perea
commit: 202751d
branch: main
repository: frida-code
topic: "M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens"
tags: [plan, m2, webview, settingshub, pi-lens, project-map, frida-app-walkthrough, frida-traffic2api]
status: ready
parent: ".rpiv/artifacts/designs/2026-08-29_00-48-43_m2-panel-mapa-del-proyecto.md"
phase_count: 5
phases:
  - { n: 1, title: "Contrato del tab + mapa funcional host + lista honesta", files: ["src/project-map/functional-inventory.ts", "src/project-map/journeys.ts", "webview/components/ProjectMapTab.tsx", "test/project-map-lib.test.ts", "test/project-map-tab.test.ts", "webview/types.ts", "webview/store.ts", "webview/components/SettingsHub.tsx", "src/extension.ts", "package.json", "webview/styles.css", "test/webview-store.test.ts"], depends_on: [] }
  - { n: 2, title: "Grafo SVG funcional + evidencia", files: ["webview/components/project-map/GraphCanvas.tsx", "webview/components/project-map/FunctionalView.tsx", "webview/components/ProjectMapTab.tsx", "webview/types.ts", "webview/store.ts", "src/extension.ts", "src/project-map/functional-inventory.ts", "webview/styles.css", "test/project-map-tab.test.ts", "test/webview-store.test.ts", "test/project-map-lib.test.ts"], depends_on: [1] }
  - { n: 3, title: "Vista técnica (pi-lens) + re-poll", files: ["src/project-map/lens-project-report.ts", "webview/components/project-map/TechnicalView.tsx", "src/extension.ts", "webview/types.ts", "webview/components/ProjectMapTab.tsx", "webview/styles.css", "test/project-map-lib.test.ts", "test/project-map-tab.test.ts", "src/project-map/functional-inventory.ts"], depends_on: [2] }
  - { n: 4, title: "Cruce técnico↔funcional (matriz M9)", files: ["src/project-map/matrix-cross.ts", "src/extension.ts", "webview/types.ts", "webview/components/project-map/FunctionalView.tsx", "webview/components/project-map/TechnicalView.tsx", "webview/components/ProjectMapTab.tsx", "webview/styles.css", "test/project-map-lib.test.ts", "test/project-map-tab.test.ts", "src/project-map/functional-inventory.ts"], depends_on: [3] }
  - { n: 5, title: "Export HTML autónomo + aterrizaje", files: ["src/project-map/export-html.ts", "webview/types.ts", "webview/components/ProjectMapTab.tsx", "webview/components/project-map/FunctionalView.tsx", "webview/components/project-map/TechnicalView.tsx", "src/extension.ts", "docs/webview-ui-styles.md", "test/project-map-lib.test.ts", "test/project-map-tab.test.ts"], depends_on: [4] }
last_updated: 2026-08-29T03:02:03-0600
last_updated_by: Edgar F. Fuentes Perea
---

# M2 — panel Mapa del proyecto (webview): journeys M8 + mapa técnico pi-lens — Implementation Plan

## Overview

Implementa el tab `projectMap` ("Mapa") en el SettingsHub de la webview de Frida (issue #143) con dos vistas conmutables renderizadas en React nativo: **Funcional** (journeys `J01..` derivados determinísticamente del `actionLog` de `docs/funcional/artifacts/inventory.json` de M8, con corte por goto) y **Técnica** (subsystems/hubs/entryPoints/riskHotspots vía `projectReport(cwd)` de pi-lens con import dinámico host-side de `dist/clients/lens-engine.js`). El host vive como lib pura `src/project-map/*` + cases delgados en `extension.ts`; la verdad del estado queda en el host (convención #111) publicada por push `project_map_state`. Clic en nodo → `open_file` (texto vía `openAtLine`, binarios vía `vscode.open`, siempre rebase + guard de contención); screenshots como data-URI on-demand; cruce técnico↔funcional condicionado a la matriz M9; export HTML autónomo híbrido (webview serializa layout, host ensambla + inlina PNGs base64). Grafo SVG propio por columnas con scroll bidireccional, colapsado por defecto.

Fuente de verdad: `.rpiv/artifacts/designs/2026-08-29_00-48-43_m2-panel-mapa-del-proyecto.md`. Las 5 fases se heredan 1:1 de sus `## Slices`; los Success Criteria pasan sin reautorar. **Orden estrictamente secuencial 1→5** (Ordering Constraints del diseño): cada fase deja typecheck + tests verdes antes de la siguiente; los archivos compartidos evolucionan por fragmentos marcados.

**Precondición ANTES del primer commit de M2** (Ordering Constraint 1 del diseño): aterrizar el estado actual del working tree — commit conjunto con `test/dist-bundle-integrity.test.ts` (hoy sin trackear) + rebuild de `dist-webview/assets/index-gE2gVxhC.js` (hoy modificado sin commitear). La guarda del FRD debe existir en git antes de tocar `webview/`.

## Desired End State

```typescript
// Stakeholder abre el panel (comando de paleta o chip "Mapa"):
//   > Frida: Mapa del proyecto
// y ve el SettingsHub en el tab "Mapa" con la vista Funcional:
//   J01 · acceso y dashboard        [▸ colapsado]
//   J02 · administración de usuarios [▾ expandido]
//        P01 Login ──▶ P02 Dashboard ──▶ P03 Filtros
//        (clic en P02 → abre docs/funcional/screenshots/P02-*.png en el editor)
//   [ 2 journeys · 5 pantallas · badge "cobertura parcial: budget" ]
//
// Conmuta a Técnica:
//   [ Construyendo mapa… reintentando (2s→5s→10s) ]   ← cache fría, resuelve sola
//   → columnas: src/ · webview/ · test/ con edges 12·8·3
//     hubs: extension.ts (fanIn 38) · types.ts (fanIn 22)…
//     [⚠ riskHotspots: extension.ts score 1140 · store.ts score 640]
//
// Clic en un hub técnico → abre el archivo en el editor (openAtLine).
// Botón "Exportar HTML" → diálogo de guardado → frida-mapa-2026-08-29.html
//   que se abre en cualquier navegador SIN Frida instalado (screenshots inlinados).
//
// Sin docs/funcional/ en el workspace:
//   "Sin mapa funcional — corre el patrón app-walkthrough (M8) para generar docs/funcional/"
//   [Recargar]
```

Verificación de "done": `npm run typecheck` limpio (host + webview), `npm test` en verde (baseline completo en Fase 5), `npm run build:webview` + `test/dist-bundle-integrity.test.ts` en verde con commit conjunto fuente+bundle, `git diff --stat src/tools/frida-extensible-workflows/core/` vacío, y el smoke manual de cada fase (panel angosto, temas, con y sin insumos).

## What We're NOT Doing

- Edición del grafo (vistas de solo lectura).
- Sustituir el `index.html` autónomo de M8 (sigue existiendo como artefacto independiente).
- Watchers / actualización en vivo.
- Generar entendimiento nuevo (M2 visualiza lo producido por M8/M9/pi-lens).
- Participación en la búsqueda global del SettingsHub (género dashboard-visual, como usage/productivity/codebaseIndex).
- Deps webview pesadas (d3/reactflow) — layout SVG propio.
- Vista de deuda/código muerto propia (deadWeight queda como listado sutil; follow-up).
- Motor `frida-extensible-workflows`: 0 líneas (congelado, `REGISTRY_FROZEN`).
- Virtualización / React.memo / content-visibility (0 precedentes en el repo).

## Phase 1: Contrato del tab + mapa funcional host + lista honesta

### Overview

Aterriza el contrato completo del tab (`projectMap` en unión `SettingsTab` + `TABS` + rama de render `{state, post}`), la lib host pura que lee/valida `docs/funcional/artifacts/inventory.json` de M8 y deriva los journeys `J01..` (corte por goto), el seam mensaje→reducer→render completo en un solo commit (#126: `project_map` Out → case dispatcher → case reducer `project_map_state` → render), el comando de paleta `frida.projectMap`, y la "lista honesta": journeys colapsados por defecto que al expandir muestran chips de pantallas, con badge `stoppedBy` y degradación digna (missing/corrupt → workaround accionable, sin spinner eterno). Incluye la precondición de working tree (Ordering Constraint 1).

**Files** (12): `src/project-map/functional-inventory.ts`, `src/project-map/journeys.ts`, `webview/components/ProjectMapTab.tsx`, `test/project-map-lib.test.ts`, `test/project-map-tab.test.ts`, `webview/types.ts`, `webview/store.ts`, `webview/components/SettingsHub.tsx`, `src/extension.ts`, `package.json`, `webview/styles.css`, `test/webview-store.test.ts`

### Changes Required

#### 1. Lib host — `src/project-map/functional-inventory.ts` (NEW)

**File**: `src/project-map/functional-inventory.ts`
**Changes**: Lectura/validación host-side del inventario funcional de M8 (probe `existsSync`, `JSON.parse` en try/catch, canon de forma `screens`/`actionLog`, huérfanos, badge `stoppedBy`) + tipos canónicos del payload y `ProjectMapHostState`. Versión base de la Fase 1: las Fases 2-4 añaden `safeResolveWithin`/`readScreenshotDataUri`, `technical?` y `cross?` sobre esta base (fragmentos marcados en cada fase).

```typescript
// M2 (#143) — Mapa del proyecto: lectura/validación host-side del inventario
// funcional de M8 (docs/funcional/artifacts/inventory.json).
//
// Fuente de verdad determinista: el writer de app-walkthrough (src/tools/
// frida-app-walkthrough/workflow.ts:313-330) serializa {run, screens,
// actionLog, stoppedBy, stoppedByTime} con invSerialize()/invWrite(). Este
// módulo NO parsea markdown ni journeys.md (los IDs J01.. se derivan en
// ./journeys.ts). Degradación digna (FR-7 / R7 de M9): sin docs/funcional →
// empty accionable con workaround textual; JSON corrupto → empty/corrupt.
// Nunca un spinner eterno (#142).

import fs from "node:fs";
import path from "node:path";

import { deriveJourneys, type PmJourney, type PmAction } from "./journeys";

/** Pantalla M8 normalizada para la UI (paths relativos al cwd de la corrida). */
export interface PmScreen {
 id: string;
 title: string;
 canon: string;
 origin: string;
 firstSeenStep: number;
 /** Snapshot del primer paso en esta pantalla (relativo; "" si no aplica). */
 snapshot: string;
 /** PNG (relativo; "" si el screenshot falló al capturar). */
 screenshot: string;
 purpose: string;
 userRoles: string[];
}

export interface PmFunctionalData {
 screens: PmScreen[];
 journeys: PmJourney[];
 /** "" | "budget" | "time" | "stepLimit" | "done" — badge de cobertura parcial. */
 stoppedBy: string;
 /** screenIds del actionLog que no existen en screens (edición manual). */
 orphans: string[];
 runUrl: string;
}

export type PmFunctionalState =
 | { status: "loading" }
 | {
   status: "empty";
   /** missing | corrupt — para el copy accionable. */
   reason: "missing" | "corrupt";
   hint: string;
  }
 | { status: "error"; hint: string }
 | { status: "ready"; data: PmFunctionalData; loadedAt: number };

/** Estado completo del tab (espejo UI en webview/types.ts — builds separados). */
export interface ProjectMapHostState {
 functional?: PmFunctionalState;
 busy?: "functional" | null;
 /** Epoch ms del inicio de la acción (#111): sobrevive re-montes del tab. */
 busySince?: number | null;
}

export type FunctionalLoadResult = PmFunctionalState;

const INVENTORY_REL = path.join("docs", "funcional", "artifacts", "inventory.json");

/** Texto del workaround (molde traffic2api/workflow.ts:795). */
export const MISSING_WORKAROUND =
 "corre el patrón app-walkthrough (M8) para generar docs/funcional/";

function asString(v: unknown): string {
 return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
 return Array.isArray(v)
  ? v.filter((x): x is string => typeof x === "string")
  : [];
}

/** Carga, valida y deriva el mapa funcional. SIEMPRE resuelve (nunca throw). */
export function loadFunctionalMap(cwd: string): FunctionalLoadResult {
 const invPath = path.join(cwd, INVENTORY_REL);
 if (!fs.existsSync(invPath)) {
  return {
   status: "empty",
   reason: "missing",
   hint: `Sin mapa funcional — ${MISSING_WORKAROUND}`,
  };
 }
 let raw: unknown;
 try {
  raw = JSON.parse(fs.readFileSync(invPath, "utf8"));
 } catch {
  return {
   status: "empty",
   reason: "corrupt",
   hint: "inventory.json de M8 ilegible — regenera docs/funcional/ con el patrón app-walkthrough (M8)",
  };
 }
 // Canon de validación (traffic2api/workflow.ts:996-1002): forma mínima.
 const inv = raw as {
  run?: unknown;
  screens?: unknown;
  actionLog?: unknown;
  stoppedBy?: unknown;
 };
 if (!Array.isArray(inv.screens) || !Array.isArray(inv.actionLog)) {
  return {
   status: "empty",
   reason: "corrupt",
   hint: "inventory.json de M8 sin forma esperada (screens/actionLog) — regenera docs/funcional/",
  };
 }

 const screens: PmScreen[] = [];
 const knownIds = new Set<string>();
 for (const s of inv.screens) {
  const rec = s as Record<string, unknown>;
  const id = asString(rec.id);
  if (!id) continue; // sin id no hay nodo estable — se excluye
  knownIds.add(id);
  screens.push({
   id,
   title: asString(rec.title) || id,
   canon: asString(rec.canon),
   origin: asString(rec.origin),
   firstSeenStep: Number(rec.firstSeenStep) || 0,
   snapshot: asString(rec.snapshot),
   screenshot: asString(rec.screenshot),
   purpose: asString(rec.purpose),
   userRoles: asStringArray(rec.userRoles),
  });
 }

 // Huérfanos: screenIds del actionLog sin pantalla registrada (imposible del
 // writer, posible por edición manual) — se marcan y excluyen, nunca
 // undefined en el layout.
 const orphans = new Set<string>();
 const actions: PmAction[] = [];
 for (const a of inv.actionLog) {
  const rec = a as Record<string, unknown>;
  const screenId = asString(rec.screenId);
  if (!screenId || !knownIds.has(screenId)) {
   if (screenId) orphans.add(screenId);
   continue;
  }
  actions.push({
   step: Number(rec.step) || 0,
   screenId,
   kind: asString(rec.kind),
   description: asString(rec.description),
   outcome: asString(rec.outcome),
  });
 }

 return {
  status: "ready",
  data: {
   screens,
   journeys: deriveJourneys(actions),
   stoppedBy: asString(inv.stoppedBy),
   orphans: [...orphans],
   runUrl: asString((inv.run as Record<string, unknown> | undefined)?.url),
  },
  loadedAt: Date.now(),
 };
}
```

#### 2. Lib host — `src/project-map/journeys.ts` (NEW)

**File**: `src/project-map/journeys.ts`
**Changes**: Derivación determinista de journeys `J01..` desde el actionLog plano (corte por goto + clasificación de aristas M9 re-implementada). Completo en esta fase (no evoluciona).

```typescript
// M2 (#143) — Mapa del proyecto: derivación determinista de journeys J01..
// desde el actionLog plano de M8.
//
// Los IDs J01.. NO existen en ningún JSON (journeys.md lo escribe un LLM,
// frida-app-walkthrough/workflow.ts:182-186): la vista los deriva. Semántica
// fijada en checkpoint de design: CORTE POR GOTO — un journey es la secuencia
// maximal de aristas traversed entre gotos que progresan; el goto marca una
// entrada explícita (nueva intención del explorador); clicks/forms navegan
// dentro de la intención; los fails NO cortan (quedan como attempted-failed
// del journey en curso). Fiel al timeline: una pantalla puede aparecer en
// varios journeys.
//
// Clasificación de aristas = algoritmo canónico M9 re-implementado
// (frida-traffic2api/workflow.ts:1053-1064): outcome "fail:" solo certifica el
// COMANDO; la navegación la certifica la progresión inter-paso.

/** ActionLog normalizado (tras validación en functional-inventory.ts). */
export interface PmAction {
 step: number;
 screenId: string;
 kind: string;
 description: string;
 outcome: string;
}

export interface PmJourneyEdge {
 type: "traversed" | "attempted-failed";
 /** Pantalla origen (siempre registrada). */
 from: string;
 /** Pantalla destino ("" en attempted-failed sin progresión). */
 to: string;
 /** Acción que produjo la arista. */
 kind: string;
 description: string;
 step: number;
 /** attempted-failed: shell-error | app-validation | no-progression. */
 cause?: string;
 /** attempted-failed: detalle acotado (≤200 chars). */
 detail?: string;
}

export interface PmJourney {
 id: string;
 /** Paso de la acción que abrió el journey. */
 startStep: number;
 /** Pantallas en orden de primera visita DENTRO del journey. */
 screenIds: string[];
 edges: PmJourneyEdge[];
}

/** Deriva journeys del actionLog (determinista, sin estado). */
export function deriveJourneys(log: PmAction[]): PmJourney[] {
 const journeys: PmJourney[] = [];
 let cur: PmJourney | null = null;
 const openJourney = (step: number, screenId: string): PmJourney => {
  const j: PmJourney = {
   id: `J${String(journeys.length + 1).padStart(2, "0")}`,
   startStep: step,
   screenIds: [screenId],
   edges: [],
  };
  journeys.push(j);
  return j;
 };
 const visit = (screenId: string): void => {
  if (cur && !cur.screenIds.includes(screenId)) cur.screenIds.push(screenId);
 };

 for (let i = 0; i < log.length; i++) {
  const a = log[i];
  const next = log[i + 1] ?? null;
  const progressed = !!(next && next.screenId !== a.screenId);

  // Corte por goto (checkpoint): SOLO un goto que progresa abre journey.
  // La primera acción (goto o no) abre J01 si aún no hay ninguno.
  if (!cur) {
   cur = openJourney(a.step, a.screenId);
  } else if (a.kind === "goto" && progressed) {
   cur = openJourney(a.step, a.screenId);
  } else {
   visit(a.screenId);
  }

  // Clasificación canónica M9 — el edge pertenece al journey en curso.
  if (a.outcome.indexOf("fail:") === 0) {
   cur.edges.push({
    type: "attempted-failed",
    from: a.screenId,
    to: progressed && next ? next.screenId : "",
    kind: a.kind,
    description: a.description,
    step: a.step,
    cause: "shell-error",
    detail: a.outcome.slice(0, 200),
   });
  } else if (a.kind === "validate") {
   cur.edges.push({
    type: "attempted-failed",
    from: a.screenId,
    to: "",
    kind: a.kind,
    description: a.description,
    step: a.step,
    cause: "app-validation",
    detail: "regla de validación reportada como fallida",
   });
  } else if ((a.kind === "click" || a.kind === "form") && !progressed) {
   cur.edges.push({
    type: "attempted-failed",
    from: a.screenId,
    to: "",
    kind: a.kind,
    description: a.description,
    step: a.step,
    cause: "no-progression",
    detail: next
     ? "la pantalla no cambió tras la acción"
     : "última acción sin paso siguiente",
   });
  } else if (
   (a.kind === "click" || a.kind === "goto" || a.kind === "form") &&
   progressed &&
   next
  ) {
   cur.edges.push({
    type: "traversed",
    from: a.screenId,
    to: next.screenId,
    kind: a.kind,
    description: a.description,
    step: a.step,
   });
   visit(next.screenId);
  }
  // kind "done" (y kinds desconocidos sin fail): no producen arista.
 }
 return journeys;
}
```

#### 3. Seam de tipos — `webview/types.ts` (MODIFY)

**File**: `webview/types.ts`
**Changes**: Espejo UI de los tipos productores (unión discriminada), campo `State.projectMap`, variante In `project_map_state` y variante Out `project_map` (con `view` desde esta fase — el diseño la declara en el corte del slice 1).

```typescript
// ══ Fase 1: tipos espejo (insertar tras CodebaseIndexUiState, ~linea 900) ══

// ── M2 (#143): estado del tab "Mapa del proyecto" — espeja los productores
// de src/project-map/* del host (builds separados, molde UsageReportView).
// Unión DISCRIMINADA igual que el productor (fix del slice-verifier: un espejo
// plano rompe el narrowing del consumidor — TS2345).
export interface PmScreen {
 id: string;
 title: string;
 canon: string;
 origin: string;
 firstSeenStep: number;
 /** Snapshot (relativo al cwd de la corrida; "" si no aplica). */
 snapshot: string;
 /** PNG (relativo; "" si el screenshot falló). */
 screenshot: string;
 purpose: string;
 userRoles: string[];
}
export interface PmJourneyEdge {
 type: "traversed" | "attempted-failed";
 from: string;
 to: string;
 kind: string;
 description: string;
 step: number;
 cause?: string;
 detail?: string;
}
export interface PmJourney {
 id: string;
 startStep: number;
 screenIds: string[];
 edges: PmJourneyEdge[];
}
export interface PmFunctionalData {
 screens: PmScreen[];
 journeys: PmJourney[];
 stoppedBy: string;
 orphans: string[];
 runUrl: string;
}
export type PmFunctionalState =
 | { status: "loading" }
 | { status: "empty"; reason: "missing" | "corrupt"; hint: string }
 | { status: "error"; hint: string }
 | { status: "ready"; data: PmFunctionalData; loadedAt: number };
/** Estado del tab Mapa publicado por el host (la vista activa NO vive aquí:
 *  es estado local del componente, análogo period/scope de ProductivityTab). */
export interface ProjectMapUiState {
 functional?: PmFunctionalState;
 busy?: "functional" | null;
 /** Epoch ms del inicio de la acción (#111): sobrevive re-montes. */
 busySince?: number | null;
}

// ══ dentro de interface State, tras el campo codebaseIndex (~linea 853) ══
 /** M2 (#143) — estado del tab "Mapa del proyecto". */
 projectMap?: ProjectMapUiState;

// ══ dentro de la unión InMessage, junto a codebase_index_state (~linea 1044) ══
 | { type: "project_map_state"; state: ProjectMapUiState }

// ══ dentro de la unión OutMessage, junto a codebase_index_action (~linea 1190) ══
 | { type: "project_map"; view: "functional" | "technical"; limit?: number }
```

#### 4. Reducer — `webview/store.ts` (MODIFY)

**File**: `webview/store.ts`
**Changes**: Case reducer `project_map_state` (la Fase 2 añade `project_map_shot` junto a este).

```typescript
// ══ Fase 1: junto al case codebase_index_state (~linea 608) ══

 // M2 (#143) — estado del tab Mapa del proyecto (lib src/project-map/* del
 // host; espejo UI en types.ts). #126: el mensaje DEBE caer al dispatch.
 // (fix del triage Step 5: merge — el host nunca envía shots; un replace
 //  borraría la cache de data-URIs en cada push, contradiciendo el criterio
 //  manual de re-monte de la Fase 2)
 case "project_map_state":
  return {
   ...state,
   projectMap: { ...msg.state, shots: state.projectMap?.shots },
  };
```

#### 5. Registro del tab — `webview/components/SettingsHub.tsx` (MODIFY)

**File**: `webview/components/SettingsHub.tsx`
**Changes**: Los 3 toques del registro del tab (contrato `{state, post}`).

```tsx
// ══ Fase 1: los 3 toques del registro del tab (contrato {state, post}) ══

// (import, junto a los demás componentes — ~linea 11)
import { ProjectMapTab } from "./ProjectMapTab";

// (unión SettingsTab — nuevo miembro antes de "environment", ~linea 21)
 | "codebaseIndex"
 | "projectMap"
 | "environment";

// (array TABS — nueva fila antes de environment, ~linea 33)
 { id: "projectMap", label: "Mapa", iconName: "map" },

// (rama de render — junto a las demás, ~linea 460)
      {tab === "projectMap" && <ProjectMapTab state={state} post={post} />}
```

#### 6. Componente del tab — `webview/components/ProjectMapTab.tsx` (NEW, versión Fase 1 "lista honesta")

**File**: `webview/components/ProjectMapTab.tsx`
**Changes**: Shell del tab con Recargar + estados loading/empty/error + la "lista honesta": journeys colapsados por defecto que al expandir muestran chips de pantallas (`.pm-screen-chip`), badge de cobertura parcial y nota de huérfanos. NOTA DE DESCOMPOSICIÓN: el diseño publica este archivo en su estado FINAL (conmutador + export); esta versión base se deriva retirando los fragmentos marcados para las Fases 2-5 (el cuerpo ready delega a `FunctionalView` desde la Fase 2, el conmutador llega en la Fase 3, `cross` en la 4 y Exportar en la 5). La fase de cierre deja el archivo idéntico al fence final del diseño.

```tsx
import { useEffect, useState } from "react";
import type { OutMessage, State } from "../types";
import { Codicon } from "./Codicon";

// M2 (#143) — tab "Mapa del proyecto". Contrato {state, post} de los tabs del
// SettingsHub; la carga vive en el componente (molde ProductivityTab.tsx:44-47)
// y la verdad del estado en el host (#111 — busySince) publicada por push
// project_map_state. Fase 1: "lista honesta" — journeys colapsados por
// defecto; al expandir, chips de pantallas. El plegado (open) sigue siendo
// estado LOCAL del componente — NO campo del store global (análogo
// period/scope de ProductivityTab.tsx:37-38).

const STOP_REASON: Record<string, string> = {
 budget: "tope de pantallas",
 time: "tiempo",
 stepLimit: "límite de pasos",
};

export function ProjectMapTab({
 state,
 post,
}: {
 state: State;
 post: (m: OutMessage) => void;
}) {
 // FR-3: colapsado por defecto — solo los journeys abiertos muestran sus
 // pantallas (render condicional real, molde TreePanel.visibleIds).
 const [open, setOpen] = useState<Set<string>>(new Set());
 const fn = state.projectMap?.functional;
 // Spinner del host (#111).
 const busy = state.projectMap?.busy === "functional";
 const data = fn?.status === "ready" ? fn.data : null;
 const stop = data?.stoppedBy ?? "";
 const partial = !!data && stop !== "" && stop !== "done";
 const allOpen =
  !!data &&
  data.journeys.length > 0 &&
  data.journeys.every((j) => open.has(j.id));
 const byId = new Map((data?.screens ?? []).map((s) => [s.id, s]));

 // FR-10: carga al abrir + refresh manual (re-enviar el mismo mensaje).
 useEffect(() => {
  post({ type: "project_map", view: "functional" });
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 const toggleOpen = (id: string): void => {
  setOpen((prev) => {
   const next = new Set(prev);
   if (next.has(id)) next.delete(id);
   else next.add(id);
   return next;
  });
 };

 const toggleAll = (all: boolean): void => {
  if (!fn || fn.status !== "ready") return;
  setOpen(all ? new Set(fn.data.journeys.map((j) => j.id)) : new Set());
 };

 return (
  <div className="pm-tab">
   <div className="pm-head">
    <button
     type="button"
     className="pc-save"
     disabled={busy}
     onClick={() => post({ type: "project_map", view: "functional" })}
    >
     <Codicon name="refresh" size={13} spin={busy} />
     <span>{busy ? "Cargando…" : "Recargar"}</span>
    </button>
   </div>

   {!fn || fn.status === "loading" ? (
    <div className="cfg-stub">
     <Codicon name="loading" size={14} spin /> Cargando mapa funcional...
    </div>
   ) : fn.status === "empty" || fn.status === "error" ? (
    <div className="cfg-stub pm-empty">
     <Codicon name={fn.status === "error" ? "warning" : "map"} size={16} />
     <span>{fn.hint}</span>
    </div>
   ) : data ? (
    <>
     <div className="pm-meta">
      <span>
       {data.journeys.length}{" "}
       {data.journeys.length === 1 ? "journey" : "journeys"}
      </span>
      <span className="pm-dot">·</span>
      <span>
       {data.screens.length}{" "}
       {data.screens.length === 1 ? "pantalla" : "pantallas"}
      </span>
      {data.journeys.length > 0 && (
       <button
        type="button"
        className="pm-expand-all"
        onClick={() => toggleAll(!allOpen)}
       >
        {allOpen ? "Colapsar todo" : "Mostrar todo"}
       </button>
      )}
      {partial && (
       <span
        className="pm-badge partial"
        title="La corrida de M8 se detuvo antes de recorrer todo — la pantalla que rebasó el corte no se registró"
       >
        cobertura parcial: {STOP_REASON[stop] ?? stop}
       </span>
      )}
     </div>
     {data.runUrl && <div className="pm-meta">Recorrido de {data.runUrl}</div>}
     {data.journeys.length === 0 ? (
      <div className="cfg-stub">
       Sin journeys derivables del actionLog
       {data.screens.length > 0
        ? ` — ${data.screens.length} pantalla(s) registradas sin navegación registrada`
        : ""
       }
       .
      </div>
     ) : (
      data.journeys.map((j) => {
       const isOpen = open.has(j.id);
       return (
        <div key={j.id} className="pm-journey">
         <button
          type="button"
          className="pm-journey-head"
          onClick={() => toggleOpen(j.id)}
          aria-expanded={isOpen}
         >
          <Codicon
           name={isOpen ? "chevron-down" : "chevron-right"}
           size={12}
          />
          <span className="pm-journey-title">
           {j.id} · {j.screenIds[0]} → {j.screenIds[j.screenIds.length - 1]}
          </span>
          <span className="pm-journey-count">
           {j.screenIds.length} pantallas · {j.edges.length} aristas
          </span>
         </button>
         {isOpen && (
          <div className="pm-journey-body">
           {j.screenIds.map((sid) => {
            const s = byId.get(sid);
            return (
             <span key={sid} className="pm-screen-chip">
              {sid} {s?.title ?? sid}
             </span>
            );
           })}
          </div>
         )}
        </div>
       );
      })
     )}
     {data.orphans.length > 0 && (
      <div className="pm-orphan-note">
       <Codicon name="warning" size={12} />
       <span>
        {data.orphans.length} screenId(s) del actionLog sin pantalla
        registrada ({data.orphans.join(", ")}) — se excluyeron del mapa.
       </span>
      </div>
     )}
    </>
   ) : null}
  </div>
 );
}
```

#### 7. Wiring host — `src/extension.ts` (MODIFY)

**File**: `src/extension.ts`
**Changes**: Import de la lib, `let pmState` + `postProjectMapState()` en la clausura `activate()`, re-posteo en `webview_ready`, case `project_map` (rama Funcional) y comando `frida.projectMap`. Las Fases 2-5 añaden casos y funciones sobre esta base (fragmentos marcados).

```typescript
// ══ Fase 1: wiring host del mapa funcional (lib src/project-map/*) ══

// (imports, junto a los demás ./ locales — ~linea 115)
import {
 loadFunctionalMap,
 type ProjectMapHostState,
} from "./project-map/functional-inventory";

// (tras las lets ci* / pendingSettingsTab / webviewReady — ~linea 617)
 // M2 (#143) — estado del tab "Mapa del proyecto" (lib src/project-map/*).
 // La verdad vive en el host (#111): busySince sobrevive re-montes del tab;
 // la vista activa NO vive aquí (estado local del componente).
 let pmState: ProjectMapHostState = {};

// (junto a postCodebaseIndexState — ~linea 655)
 function postProjectMapState(): void {
  post({ type: "project_map_state", state: pmState });
 }

// (en webview_ready, justo tras postCodebaseIndexState() — ~linea 2533)
    // M2 (#143) — re-posteo del estado del mapa para re-montes fríos del
    // tab (hueco que lensStatus NO cubre — no repetirlo).
    postProjectMapState();

// (nuevo case en handleWebviewMessage, tras el bloque codebase_index_* y
//  antes de check_environment — ~linea 3446)
   // M2 (#143) — carga/refresh del mapa Funcional. Read-only síncrono
   // (lectura de inventory.json M8 + derivación de journeys): try/catch
   // que SIEMPRE responde; busy/epoch para el spinner del botón (#111/#142).
   // (La rama Técnica de este case llega en la Fase 3.)
   case "project_map": {
    pmState = {
     ...pmState,
     functional: { status: "loading" },
     busy: "functional",
     busySince: Date.now(),
    };
    postProjectMapState();
    try {
     pmState = {
      ...pmState,
      functional: loadFunctionalMap(workspaceCwd()),
      busy: null,
      busySince: null,
     };
    } catch (e: any) {
     pmState = {
      ...pmState,
      functional: { status: "error", hint: e?.message ?? String(e) },
      busy: null,
      busySince: null,
     };
    }
    postProjectMapState();
    break;
   }

// (registro del comando, junto a frida.codebaseIndex — ~linea 5967)
  // M2 (#143) — abre el SettingsHub en el tab Mapa (molde frida.codebaseIndex:
  // post directo en caliente, flush de webview_ready en frío).
  vscode.commands.registerCommand("frida.projectMap", () => {
   pendingSettingsTab = "projectMap";
   void vscode.commands.executeCommand("frida.openPanel").then(() => {
    if (webviewReady) {
     post({ type: "open_settings", tab: "projectMap" });
     pendingSettingsTab = undefined;
    }
   });
  }),
```

#### 8. Comando de paleta — `package.json` (MODIFY)

**File**: `package.json`
**Changes**: Nueva entrada en `contributes.commands`.

```json
// (Fase 1: nueva entrada tras frida.codebaseIndex — ajustar comas al fusionar)
{
 "command": "frida.projectMap",
 "title": "Frida: Mapa del proyecto"
}
```

#### 9. Estilos — `webview/styles.css` (MODIFY)

**File**: `webview/styles.css`
**Changes**: Bloque `.pm-*` de la Fase 1 (shell, meta, badges, journeys). NOTA DE DESCOMPOSICIÓN: el fence final del diseño agrupa `.pm-expand-all`/`.pm-empty`/`.pm-orphan-note` bajo el corte del slice 2 — aquí se adelantan a la Fase 1 porque la lista honesta ya los usa (el fence final queda idéntico tras la Fase 2, que retira los chips provisionales y añade el bloque del grafo). El `:hover` de `.pm-journey-head` ya incorpora la revisión en cascada ratificada en el slice 5 del diseño.

```css
/* ══ Fase 1: tab Mapa del proyecto (.pm-*) — adición al final ══ */
.pm-tab {
 display: flex;
 flex-direction: column;
 gap: 10px;
}
.pm-head {
 display: flex;
 align-items: center;
 justify-content: space-between;
 gap: 8px;
 flex-wrap: wrap;
}
.pm-meta {
 font-size: 11px;
 color: var(--vscode-descriptionForeground);
 display: flex;
 gap: 6px;
 flex-wrap: wrap;
 align-items: center;
}
.pm-dot {
 opacity: 0.6;
}
.pm-badge {
 font-size: 10px;
 padding: 1px 6px;
 border-radius: 8px;
 border: 1px solid var(--vscode-panel-border);
 color: var(--vscode-descriptionForeground);
}
.pm-badge.partial {
 border-color: var(--vscode-charts-yellow, #cca700);
 color: var(--vscode-charts-yellow, #cca700);
}
.pm-journey {
 border: 1px solid var(--vscode-panel-border);
 border-radius: 8px;
 overflow: hidden;
}
.pm-journey-head {
 display: flex;
 align-items: center;
 gap: 6px;
 padding: 6px 8px;
 width: 100%;
 cursor: pointer;
 background: var(--vscode-list-hoverBackground);
 border: none;
 color: inherit;
 text-align: left;
}
/* (revisión en cascada ratificada en el slice 5 del diseño: background
   declarado en el propio :hover — (0,2,0) vence al button:hover global
   (0,1,1) que inyectaba el azul primario; ver docs/webview-ui-styles.md) */
.pm-journey-head:hover {
 background: var(--vscode-list-hoverBackground);
 filter: brightness(1.1);
}
.pm-journey-title {
 font-size: 12px;
 font-weight: 600;
}
.pm-journey-count {
 font-size: 10px;
 color: var(--vscode-descriptionForeground);
}
/* (provisional de la lista honesta de la Fase 1: fila de chips — la Fase 2
   sustituye los chips por el grafo SVG y deja el body en column) */
.pm-journey-body {
 padding: 6px 8px;
 display: flex;
 flex-direction: row;
 flex-wrap: wrap;
 gap: 4px;
}
.pm-screen-chip {
 font-size: 10px;
 font-family: var(--vscode-editor-font-family, monospace);
 padding: 1px 6px;
 border-radius: 8px;
 border: 1px solid var(--vscode-panel-border);
 color: var(--vscode-foreground);
 background: transparent;
}
.pm-expand-all {
 font-size: 10px;
 padding: 1px 8px;
 border-radius: 8px;
 border: 1px solid var(--vscode-panel-border);
 background: transparent;
 color: var(--vscode-descriptionForeground);
}
.pm-expand-all:hover {
 color: var(--vscode-foreground);
 background: var(--vscode-list-hoverBackground);
}
.pm-empty {
 display: flex;
 align-items: center;
 gap: 8px;
}
.pm-orphan-note {
 font-size: 11px;
 color: var(--vscode-charts-yellow, #cca700);
 display: flex;
 gap: 4px;
 align-items: flex-start;
}
@media (prefers-reduced-motion: reduce) {
 .pm-journey-head {
  transition: none !important;
 }
}
```

#### 10. Test de contrato reducer — `test/webview-store.test.ts` (MODIFY)

**File**: `test/webview-store.test.ts`
**Changes**: Describe del contrato `project_map_state` (la Fase 2 añade el it de `project_map_shot` dentro del mismo describe).

```typescript
// ══ Fase 1: adición al final del archivo ══

// M2 (#143): project_map_state llena state.projectMap (condición de render
// del ProjectMapTab) — el mensaje DEBE caer al dispatch general (#126).
describe("webview store · project_map_state/project_map_shot llegan al reducer", () => {
 it("project_map_state llena state.projectMap", () => {
  const s = reduce(initialState, {
   type: "project_map_state",
   state: {
    functional: {
     status: "empty",
     reason: "missing",
     hint: "sin docs/funcional",
    },
    busy: null,
   },
  });
  expect(s.projectMap?.functional?.status).toBe("empty");
  expect(s.projectMap?.functional).toMatchObject({
   reason: "missing",
  });
 });
});
```

#### 11. Test de lib host — `test/project-map-lib.test.ts` (NEW)

**File**: `test/project-map-lib.test.ts`
**Changes**: Lib host pura (Node puro, sin vscode) — Fase 1: fixtures honestos del inventory M8 + journeys corte-por-goto + degradación digna. Helpers `tmpDirs`/`makeCwd` ya en forma final a nivel de archivo (como los dejó la fusión del slice 2 del diseño — las Fases 2-4 los reutilizan).

```typescript
// M2 (#143) — lib host del Mapa del proyecto (Node puro, sin vscode).
// Fixtures honestos (lecciones 30ef616/9d6d8bb): reproducen el schema REAL
// del writer M8 (src/tools/frida-app-walkthrough/workflow.ts:313-330) con
// TODOS los campos que M2 lee.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadFunctionalMap } from "../src/project-map/functional-inventory";
import { deriveJourneys, type PmAction } from "../src/project-map/journeys";

// Timeline canónico del ejemplo de design (corte por goto):
//   J01: abre en paso 1 · traversed P01→P02 (form, paso 2) · traversed
//        P02→P03 (click, paso 3) · attempted-failed P03 (form sin progresión)
//   J02: abre con goto P03→P04 (paso 5) · fail shell-error (paso 6) ·
//        no-progression (paso 7) · done sin arista (paso 8)
const ACTION_LOG: PmAction[] = [
 { step: 1, screenId: "P01", kind: "goto", description: "abrir /login", outcome: "ok" },
 { step: 2, screenId: "P01", kind: "form", description: "creds", outcome: "ok" },
 { step: 3, screenId: "P02", kind: "click", description: "dashboard", outcome: "ok" },
 { step: 4, screenId: "P03", kind: "form", description: "filtro", outcome: "ok" },
 { step: 5, screenId: "P03", kind: "goto", description: "a /admin", outcome: "ok" },
 { step: 6, screenId: "P04", kind: "click", description: "usuarios", outcome: "fail: timeout" },
 { step: 7, screenId: "P04", kind: "click", description: "usuario-1", outcome: "ok" },
 { step: 8, screenId: "P04", kind: "done", description: "fin", outcome: "ok" },
];

function screenFixture(
 id: string,
 title: string,
 canon: string,
 firstSeenStep: number,
) {
 return {
  id,
  canon,
  origin: `${canon}?utm=x`,
  title,
  firstSeenStep,
  snapshot: `docs/funcional/artifacts/steps/${String(firstSeenStep).padStart(3, "0")}-snapshot.json`,
  screenshot: `docs/funcional/screenshots/${id}-${title.toLowerCase()}.png`,
  purpose: `propósito de ${title}`,
  userRoles: ["operador"],
  mainElements: ["form"],
  validationEvidence: [],
 };
}

const INVENTORY = {
 run: {
  pattern: "app-walkthrough",
  url: "https://demo.local/",
  session: "s1",
  language: "es",
  // 4 pantallas + budget: alcanzable por el writer real (workflow.ts:396
  // corta ANTES de registrar la 5ª cuando maxScreens=4) — fixture honesto.
  maxScreens: 4,
  maxMinutes: 0,
  startedAt: "2026-08-29 00:00:00 -0600",
  startedAtEpoch: 1,
  finishedAt: "2026-08-29 00:05:00 -0600",
 },
 screens: [
  screenFixture("P01", "Login", "https://demo.local/login", 1),
  screenFixture("P02", "Dashboard", "https://demo.local/dashboard", 3),
  screenFixture("P03", "Filtros", "https://demo.local/filtros", 4),
  screenFixture("P04", "Admin", "https://demo.local/admin", 6),
 ],
 actionLog: ACTION_LOG.map((a, i) => ({
  ...a,
  ref: a.kind === "goto" ? "" : `@e${i}`,
  url: a.kind === "goto" ? "https://demo.local/x" : "",
 })),
 stoppedBy: "budget",
 stoppedByTime: false,
};

describe("journeys · corte por goto (semántica fijada en design)", () => {
 it("deriva J01/J02: el goto que progresa abre journey", () => {
  const js = deriveJourneys(ACTION_LOG);
  expect(js.map((j) => j.id)).toEqual(["J01", "J02"]);
  expect(js[0].screenIds).toEqual(["P01", "P02", "P03"]);
  expect(
   js[0].edges
    .filter((e) => e.type === "traversed")
    .map((e) => `${e.from}->${e.to}#${e.step}`),
  ).toEqual(["P01->P02#2", "P02->P03#3"]);
  expect(js[1].screenIds).toEqual(["P03", "P04"]);
  expect(
   js[1].edges
    .filter((e) => e.type === "traversed")
    .map((e) => `${e.from}->${e.to}#${e.step}`),
  ).toEqual(["P03->P04#5"]);
 });

 it("goto SIN progresión no abre journey ni produce arista", () => {
  const js = deriveJourneys([
   { step: 1, screenId: "P01", kind: "goto", description: "x", outcome: "ok" },
   { step: 2, screenId: "P01", kind: "goto", description: "recarga", outcome: "ok" },
  ]);
  expect(js).toHaveLength(1); // solo J01 (primera acción)
  expect(js[0].edges).toHaveLength(0);
 });

 it("fails NO cortan el journey — quedan como attempted-failed en curso", () => {
  const js = deriveJourneys(ACTION_LOG);
  const failEdges = js[1].edges.filter((e) => e.cause === "shell-error");
  expect(failEdges).toHaveLength(1);
  expect(failEdges[0]?.detail).toContain("timeout");
 });

 it("click/form sin progresión → attempted-failed no-progression (canon M9)", () => {
  const js = deriveJourneys(ACTION_LOG);
  const noProg = js
   .flatMap((j) => j.edges)
   .filter((e) => e.cause === "no-progression");
  expect(noProg.map((e) => e.step)).toEqual([4, 7]);
 });

 it("validate → attempted-failed app-validation", () => {
  const js = deriveJourneys([
   { step: 1, screenId: "P01", kind: "validate", description: "regla", outcome: "ok" },
  ]);
  expect(js[0].edges[0]?.cause).toBe("app-validation");
 });
});

// ── Helpers de tmpdir compartidos (a nivel de archivo; las Fases 2-4 los
//    reutilizan — forma final de la fusión del slice 2 del diseño) ──
const tmpDirs: string[] = [];
function makeCwd(inventory?: unknown): string {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pm-"));
 tmpDirs.push(dir);
 if (inventory !== undefined) {
  fs.mkdirSync(path.join(dir, "docs/funcional/artifacts"), {
   recursive: true,
  });
  fs.writeFileSync(
   path.join(dir, "docs/funcional/artifacts/inventory.json"),
   typeof inventory === "string" ? inventory : JSON.stringify(inventory),
  );
 }
 return dir;
}

describe("loadFunctionalMap · degradación digna y payload honesto", () => {
 afterEach(() => {
  for (const d of tmpDirs.splice(0))
   fs.rmSync(d, { recursive: true, force: true });
 });

 it("sin docs/funcional → empty/missing con workaround accionable", () => {
  const r = loadFunctionalMap(makeCwd());
  expect(r.status).toBe("empty");
  if (r.status === "empty") {
   expect(r.reason).toBe("missing");
   expect(r.hint).toContain("app-walkthrough (M8)");
  }
 });

 it("JSON corrupto → empty/corrupt, sin throw", () => {
  const r = loadFunctionalMap(makeCwd("{no-json"));
  expect(r.status).toBe("empty");
  if (r.status === "empty") expect(r.reason).toBe("corrupt");
 });

 it("sin screens/actionLog arrays → empty/corrupt (canon de forma)", () => {
  const r = loadFunctionalMap(makeCwd({ run: {}, screens: "x" }));
  expect(r.status).toBe("empty");
 });

 it("inventory válido → ready con journeys, stoppedBy y runUrl", () => {
  const r = loadFunctionalMap(makeCwd(INVENTORY));
  expect(r.status).toBe("ready");
  if (r.status === "ready") {
   expect(r.data.journeys.map((j) => j.id)).toEqual(["J01", "J02"]);
   expect(r.data.stoppedBy).toBe("budget");
   expect(r.data.runUrl).toBe("https://demo.local/");
   expect(r.data.screens).toHaveLength(4);
  }
 });

 it("screenId huérfano del actionLog se excluye y se reporta", () => {
  const bad = {
   ...INVENTORY,
   actionLog: [
    ...INVENTORY.actionLog,
    {
     step: 9,
     screenId: "P99",
     kind: "click",
     description: "fantasma",
     ref: "@e9",
     url: "",
     outcome: "ok",
    },
   ],
  };
  const r = loadFunctionalMap(makeCwd(bad));
  expect(r.status).toBe("ready");
  if (r.status === "ready") {
   expect(r.data.orphans).toEqual(["P99"]);
   expect(
    r.data.journeys.every((j) =>
     j.screenIds.every((sid) => sid !== "P99"),
    ),
   ).toBe(true);
  }
 });
});
```

#### 12. Test de componente — `test/project-map-tab.test.ts` (NEW)

**File**: `test/project-map-tab.test.ts`
**Changes**: Componente con `renderToStaticMarkup` + `post = vi.fn()` (molde productivity-tab.test.ts; los efectos NO corren — documentado en IndexTab.tsx:701-704). Fase 1: estados del tab (loading/empty/error/ready-lista honesta). El fixture `fnData` aún SIN el edge attempted-failed (la Fase 2 lo añade junto a sus describes).

```typescript
// M2 (#143) — componente ProjectMapTab (molde productivity-tab.test.ts:
// renderToStaticMarkup + post=vi.fn(); los efectos NO corren — la carga al
// montar se prueba en vivo, documentado en IndexTab.tsx:701-704).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectMapTab } from "../webview/components/ProjectMapTab";
import type { PmFunctionalData, State } from "../webview/types";

const baseState: State = {
 keyNeeded: false,
 busy: false,
 mode: "manual",
 turns: [],
 approvals: [],
 modelChanges: [],
 uiRequests: [],
 queued: [],
 isCompacting: false,
 compactions: [],
 branchSummaries: [],
 nextId: 1,
};

const fnData: PmFunctionalData = {
 screens: [
  {
   id: "P01",
   title: "Login",
   canon: "https://demo.local/login",
   origin: "https://demo.local/login",
   firstSeenStep: 1,
   snapshot: "docs/funcional/artifacts/steps/001-snapshot.json",
   screenshot: "docs/funcional/screenshots/P01-login.png",
   purpose: "",
   userRoles: [],
  },
  {
   id: "P02",
   title: "Dashboard",
   canon: "https://demo.local/dashboard",
   origin: "https://demo.local/dashboard",
   firstSeenStep: 3,
   snapshot: "",
   screenshot: "",
   purpose: "",
   userRoles: [],
  },
 ],
 journeys: [
  {
   id: "J01",
   startStep: 1,
   screenIds: ["P01", "P02"],
   edges: [
    {
     type: "traversed",
     from: "P01",
     to: "P02",
     kind: "form",
     description: "creds",
     step: 2,
    },
   ],
  },
 ],
 stoppedBy: "budget",
 orphans: [],
 runUrl: "https://demo.local/",
};

function render(state: State): string {
 const post = vi.fn();
 return renderToStaticMarkup(
  React.createElement(ProjectMapTab, { state, post }),
 );
}

describe("ProjectMapTab · estados", () => {
 it("sin estado → cargando (sin spinner eterno: el host SIEMPRE responde)", () => {
  const html = render(baseState);
  expect(html).toContain("Cargando mapa funcional");
 });

 it("empty/missing → workaround accionable del M8", () => {
  const html = render({
   ...baseState,
   projectMap: {
    functional: {
     status: "empty",
     reason: "missing",
     hint: "Sin mapa funcional — corre el patrón app-walkthrough (M8) para generar docs/funcional/",
    },
    busy: null,
   },
  });
  expect(html).toContain("app-walkthrough (M8)");
 });

 it("error → hint visible, no silencio", () => {
  const html = render({
   ...baseState,
   projectMap: {
    functional: { status: "error", hint: "EACCES" },
    busy: null,
   },
  });
  expect(html).toContain("EACCES");
 });

 it("ready → lista de journeys con badge de cobertura parcial", () => {
  const html = render({
   ...baseState,
   projectMap: {
    functional: { status: "ready", data: fnData, loadedAt: 1 },
    busy: null,
   },
  });
  expect(html).toContain("J01");
  expect(html).toContain("1 journey");
  expect(html).toContain("cobertura parcial: tope de pantallas");
  // FR-3: colapsado por defecto — los chips NO renderizan sin expandir.
  expect(html).not.toContain("pm-screen-chip");
 });
});
```

### Success Criteria

#### Automated Verification

- [x] Aterrizaje previo del working tree ANTES del primer commit de M2: commit conjunto con `test/dist-bundle-integrity.test.ts` trackeado + rebuild de `dist-webview/` (`npm run build:webview`); `git status --porcelain` sin residuos en dist-webview tras ese commit (be7dc1c)
- [x] Bundle en el MISMO commit que la fuente: tras el cambio, `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` en verde
- [x] Diff funcional limpio (sin config biome en el repo): `git diff --check` sin errores y el diff del commit no contiene reformatos ajenos al cambio
- [x] Typecheck limpio (host + webview): `npm run typecheck`
- [x] Tests del slice en verde: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts` (25/25)
- [x] Seam completo (grep): `grep -c '"project_map_state"' webview/store.ts` devuelve ≥1 (1), `grep -c '"project_map"' src/extension.ts` devuelve ≥1 (1) y `grep -c 'ProjectMapTab' webview/components/SettingsHub.tsx` devuelve ≥2 (2: import + render)
- [x] Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` vacío

#### Manual Verification

- [ ] Paleta: "Frida: Mapa del proyecto" abre el SettingsHub en el tab "Mapa" (en frío y en caliente)
- [ ] Sin `docs/funcional/` en el workspace: estado vacío con workaround "corre el patrón app-walkthrough (M8)", sin spinner eterno
- [ ] Con inventory M8 válido: journeys J01.. en lista colapsada por defecto; clic en el encabezado expande los chips de pantallas; badge "cobertura parcial: tope de pantallas" cuando stoppedBy="budget"
- [ ] Cambiar de pestaña del hub y volver: el mapa persiste sin "Cargando…" eterno (re-posteo en webview_ready)

---

## Phase 2: Grafo SVG funcional + evidencia

### Overview

Reemplaza la lista honesta por el grafo SVG por columnas: `GraphCanvas` (renderer compartido, determinista, colapsado = columnas fuera del DOM), `FunctionalView` (journey expandido → pantallas como columnas, aristas bezier, attempted-failed listados bajo el grafo), clic en nodo → `open_file` con evidencia (screenshot > snapshot; texto vía `openAtLine`, binario vía `vscode.open`), y screenshots data-URI on-demand con dedup por ref (mensaje `project_map_shot` + case reducer de cache merge).

**Files** (11): `webview/components/project-map/GraphCanvas.tsx`, `webview/components/project-map/FunctionalView.tsx`, `webview/components/ProjectMapTab.tsx`, `webview/types.ts`, `webview/store.ts`, `src/extension.ts`, `src/project-map/functional-inventory.ts`, `webview/styles.css`, `test/project-map-tab.test.ts`, `test/webview-store.test.ts`, `test/project-map-lib.test.ts`

*(Nota de fusión del diseño: `webview/store.ts` + `test/webview-store.test.ts` + `src/project-map/functional-inventory.ts` + `test/project-map-lib.test.ts` se añadieron sobre el skeleton — completan el seam "cases project_map_state/shot" que Architecture/File Map prometen, la tríada dispatcher+reducer+render (#126) y el NFR Security con guard testeable en Node.)*

### Changes Required

#### 1. Renderer SVG compartido — `webview/components/project-map/GraphCanvas.tsx` (NEW)

**File**: `webview/components/project-map/GraphCanvas.tsx`
**Changes**: Renderer SVG compartido: columnas fijas (~140px), nodos apilados, aristas bezier (misma columna vertical / cruzada horizontal con sag + lanes), previews de screenshot en 3 estados, navegación teclado (Tab/↑↓/Enter/Espacio), reduced-motion, colapso real (fuera del DOM — el consumidor decide qué columnas manda). Completo en esta fase (la Fase 3 lo reutiliza con `tone:"danger"`).

```typescript
import { Fragment, useRef } from "react";

// M2 (#143) — renderer SVG compartido de las vistas del tab Mapa: columnas
// fijas (~140 px) + nodos apilados + aristas bezier + scroll bidireccional en
// un contenedor overflow:auto. Presentacional y determinista, sin deps de
// grafo (decisión de design; precedentes SVG manuales DonutChart.tsx:22-53 /
// FridaRobotIcon.tsx:21). Colapso: las columnas cerradas NO llegan aquí (render
// condicional del consumidor, molde TreePanel.visibleIds) — nunca CSS hide.
// La Fase 3 (vista Técnica) reutiliza este canvas: columnas = subsystems con
// title, nodos apilados por fila, tone:"danger" en riskHotspots.
// Nota del slice-verifier: Fragment importado NOMBRADO (jsx: "react-jsx",
// molde App.tsx:2,561) — nunca React.Fragment sin import (TS2686).

export interface GraphNode {
 id: string;
 title: string;
 /** data-URI del screenshot (preview bajo el nodo). "" = respondido sin captura. */
 preview?: string;
 /** Preview pedido y aún sin respuesta (placeholder punteado). */
 previewPending?: boolean;
 /** danger = borde rojo (overlay de riesgo de la Fase 3). */
 tone?: "default" | "danger";
}

export interface GraphEdge {
 from: string;
 to: string;
 /** Tooltip del path (hover nativo SVG <title>). */
 label?: string;
}

export interface GraphColumn {
 id: string;
 /** Título sobre la columna (se omite si vacío — vista Funcional). */
 title?: string;
 nodes: GraphNode[];
}

const COL_W = 140;
const GAP_X = 26;
const NODE_H = 36;
const PREVIEW_H = 66;
const GAP_Y = 26;
const PAD = 10;

function clip(t: string, max: number): string {
 return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

interface Placed {
 x: number;
 y: number;
 h: number;
}

/** Layout determinista: x por columna, y acumulado por nodo (el preview
 *  alarga el nodo; el título de columna baja el arranque). Los ids de nodo
 *  deben ser ÚNICOS en el canvas. */
function layout(columns: GraphColumn[]): {
 placed: Map<string, Placed>;
 w: number;
 h: number;
} {
 const placed = new Map<string, Placed>();
 let maxY = PAD;
 columns.forEach((col, ci) => {
  let y = PAD + (col.title ? 26 : 14);
  col.nodes.forEach((n) => {
   const h =
    NODE_H + (n.preview !== undefined || n.previewPending ? PREVIEW_H : 0);
   placed.set(n.id, { x: PAD + ci * (COL_W + GAP_X), y, h });
   y += h + GAP_Y;
  });
  maxY = Math.max(maxY, y - GAP_Y);
 });
 const w = Math.max(PAD * 2 + columns.length * (COL_W + GAP_X) - GAP_X, 160);
 return { placed, w, h: Math.max(maxY + PAD, 110) };
}

/** Navegación por teclado (NFR a11y): ↑↓ mueve el foco entre nodos en orden
 *  DOM (columnas de izquierda a derecha, nodos de arriba abajo); Tab lo da el
 *  navegador vía tabIndex; Enter/Espacio activa el nodo enfocado. */
export function GraphCanvas({
 columns,
 edges,
 onNodeClick,
 ariaLabel = "Grafo del mapa",
}: {
 columns: GraphColumn[];
 /** Aristas globales del canvas (from/to = node ids únicos). */
 edges: GraphEdge[];
 onNodeClick?: (nodeId: string) => void;
 ariaLabel?: string;
}) {
 const wrapRef = useRef<HTMLDivElement>(null);
 const { placed, w, h } = layout(columns);

 const focusSibling = (id: string, delta: number): void => {
  const root = wrapRef.current;
  if (!root) return;
  const nodes = Array.from(root.querySelectorAll<SVGGElement>(".pm-node"));
  const idx = nodes.findIndex((n) => n.dataset.nodeId === id);
  nodes[idx + delta]?.focus();
 };

 return (
  <div className="pm-canvas" ref={wrapRef}>
   <svg
    className="pm-graph"
    width={w}
    height={h}
    viewBox={`0 0 ${w} ${h}`}
    role="group"
    aria-label={ariaLabel}
   >
    <defs>
     <marker
      id="pm-arrow"
      viewBox="0 0 8 8"
      refX={7}
      refY={4}
      markerWidth={6}
      markerHeight={6}
      orient="auto-start-reverse"
     >
      <path d="M 0 0 L 8 4 L 0 8 z" className="pm-arrow" />
     </marker>
    </defs>
    {edges.map((e, ei) => {
     const a = placed.get(e.from);
     const b = placed.get(e.to);
     if (!a || !b) return null;
     const lane = ((ei % 4) - 1.5) * 7; // separa aristas paralelas
     const sameCol = a.x === b.x;
     const x1 = sameCol ? a.x + COL_W / 2 : a.x + COL_W;
     const y1 = sameCol ? a.y + a.h : a.y + NODE_H / 2 + lane;
     const x2 = sameCol ? b.x + COL_W / 2 : b.x;
     const y2 = sameCol ? b.y : b.y + NODE_H / 2 + lane;
     const sag = sameCol
      ? Math.max((y2 - y1) / 2, 14)
      : Math.max(Math.abs(x2 - x1) * 0.45, 18);
     const c1x = sameCol ? x1 : x1 + sag;
     const c1y = sameCol ? y1 + sag : y1;
     const c2x = sameCol ? x2 : x2 - sag;
     const c2y = sameCol ? y2 - sag : y2;
     return (
      <path
       key={ei}
       className="pm-edge"
       d={`M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`}
       markerEnd="url(#pm-arrow)"
      >
       <title>{e.label ?? `${e.from} → ${e.to}`}</title>
      </path>
     );
    })}
    {columns.map((col, ci) => (
     <Fragment key={col.id}>
      {col.title && (
       <text
        x={PAD + ci * (COL_W + GAP_X)}
        y={PAD + 12}
        className="pm-col-title"
       >
        {clip(col.title, 18)}
       </text>
      )}
      {col.nodes.map((n) => {
       const p = placed.get(n.id);
       if (!p) return null;
       const clickable = !!onNodeClick;
       return (
        <g
         key={n.id}
         className={"pm-node" + (clickable ? " is-clickable" : "")}
         data-node-id={n.id}
         tabIndex={clickable ? 0 : -1}
         role={clickable ? "button" : undefined}
         aria-label={`${n.id} ${n.title}`}
         onClick={clickable ? () => onNodeClick!(n.id) : undefined}
         onKeyDown={
          clickable
           ? (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
               ev.preventDefault();
               onNodeClick!(n.id);
              } else if (ev.key === "ArrowDown") {
               ev.preventDefault();
               focusSibling(n.id, 1);
              } else if (ev.key === "ArrowUp") {
               ev.preventDefault();
               focusSibling(n.id, -1);
              }
            }
           : undefined
         }
        >
         <rect
          x={p.x}
          y={p.y}
          width={COL_W}
          height={NODE_H}
          rx={6}
          className={
           "pm-node-box" + (n.tone === "danger" ? " is-danger" : "")
          }
         />
         <text x={p.x + 6} y={p.y + 13} className="pm-node-id">
          {n.id}
         </text>
         <text x={p.x + 6} y={p.y + 26} className="pm-node-title">
          {clip(n.title, 20)}
         </text>
         {n.previewPending && (
          <g>
           <rect
            x={p.x + 4}
            y={p.y + NODE_H + 4}
            width={COL_W - 8}
            height={PREVIEW_H - 10}
            rx={4}
            className="pm-shot-pending"
           />
           <text
            x={p.x + COL_W / 2}
            y={p.y + NODE_H + PREVIEW_H / 2}
            className="pm-shot-label"
            textAnchor="middle"
           >
            capturando…
           </text>
          </g>
         )}
         {!n.previewPending && n.preview === "" && (
          <g>
           <rect
            x={p.x + 4}
            y={p.y + NODE_H + 4}
            width={COL_W - 8}
            height={PREVIEW_H - 10}
            rx={4}
            className="pm-shot-missing"
           />
           <text
            x={p.x + COL_W / 2}
            y={p.y + NODE_H + PREVIEW_H / 2}
            className="pm-shot-label"
            textAnchor="middle"
           >
            sin captura
           </text>
          </g>
         )}
         {!n.previewPending && n.preview && (
          <image
           x={p.x + 4}
           y={p.y + NODE_H + 4}
           width={COL_W - 8}
           height={PREVIEW_H - 10}
           preserveAspectRatio="xMidYMin meet"
           href={n.preview}
           className="pm-shot"
          />
         )}
        </g>
       );
      })}
     </Fragment>
    ))}
   </svg>
  </div>
 );
}
```

#### 2. Vista Funcional — `webview/components/project-map/FunctionalView.tsx` (NEW, versión base Fase 2)

**File**: `webview/components/project-map/FunctionalView.tsx`
**Changes**: Journey expandido → pantallas como COLUMNAS del grafo en fila horizontal; colapsado por defecto; badge stoppedBy; attempted-failed listados bajo el grafo; clic→evidencia (screenshot > snapshot); shots on-demand con dedup por ref. NOTA DE DESCOMPOSICIÓN: versión base sin el fragmento del cruce M9 (Fase 4: prop `cross` + notas + chips) ni el serializador de export (Fase 5: `serializeFunctionalExport`) — ambos fragmentos marcados en sus fases.

```tsx
import { useEffect, useRef } from "react";
import type {
 OutMessage,
 PmFunctionalData,
 PmJourney,
 PmScreen,
} from "../../types";
import { Codicon } from "../Codicon";
import { GraphCanvas, type GraphColumn, type GraphEdge } from "./GraphCanvas";

// M2 (#143) — vista Funcional (slice 2): journey expandido → sus pantallas
// como COLUMNAS del grafo en fila horizontal (fiel al Desired End State del
// diseño: P01 ──▶ P02 ──▶ P03 con scroll-x en panel angosto); colapsado por
// defecto = la columna no se renderiza (molde TreePanel.visibleIds). Los
// attempted-failed NO se dibujan como aristas (to=""): se listan bajo el
// grafo (legibles en panel angosto, evita geometría frágil de self-loops).
//
// Screenshots data-URI on-demand: al abrir un journey se piden SOLO los PNGs
// de sus pantallas (decisión de design — base64 infla +33%, jamás el set
// completo). El ref deduplica pedidos; dataUri "" = "sin captura" definitivo
// (sin retry infinito). Clic en nodo → open_file con la evidencia primaria
// (screenshot > snapshot; el host resuelve texto vs binario).

const STOP_REASON: Record<string, string> = {
 budget: "tope de pantallas",
 time: "tiempo",
 stepLimit: "límite de pasos",
};

const CAUSE_LABEL: Record<string, string> = {
 "shell-error": "error de comando",
 "app-validation": "validación de app",
 "no-progression": "sin progresión",
};

function columnsOf(
 j: PmJourney,
 screens: PmScreen[],
 shots: Record<string, string>,
): { columns: GraphColumn[]; edges: GraphEdge[] } {
 const byId = new Map(screens.map((s) => [s.id, s]));
 return {
  // Una columna por pantalla (orden de primera visita DENTRO del journey).
  columns: j.screenIds.map((sid) => {
   const s = byId.get(sid);
   const shot = shots[sid];
   return {
    id: sid,
    nodes: [
     {
      id: sid,
      title: s?.title ?? sid,
      // undefined = aún sin respuesta; "" = respondido sin captura
      preview: s?.screenshot ? shot : undefined,
      previewPending: !!s?.screenshot && shot === undefined,
     },
    ],
   };
  }),
  edges: j.edges
   .filter((e) => e.type === "traversed")
   .map((e) => ({
    from: e.from,
    to: e.to,
    label: `#${e.step} ${e.kind}: ${e.description}`,
   })),
 };
}

export function FunctionalView({
 data,
 loadedAt,
 shots,
 open,
 onToggle,
 onToggleAll,
 post,
}: {
 data: PmFunctionalData;
 loadedAt: number;
 shots: Record<string, string>;
 open: Set<string>;
 onToggle: (id: string) => void;
 onToggleAll: (all: boolean) => void;
 post: (m: OutMessage) => void;
}) {
 const requested = useRef<Set<string>>(new Set());

 // Nueva corrida del mapa (loadedAt cambió) → los PNGs pueden ser otros:
 // reset de dedup para re-pedir on-demand.
 // (fix del triage Step 5: loadedAt viaja como prop — PmFunctionalData no lo
 //  lleva; vive en la variante ready de PmFunctionalState)
 useEffect(() => {
  requested.current.clear();
 }, [loadedAt]);

 // On-demand: pide UNA vez cada screenshot de los journeys ABIERTOS.
 useEffect(() => {
  const byId = new Map(data.screens.map((s) => [s.id, s]));
  for (const j of data.journeys) {
   if (!open.has(j.id)) continue;
   for (const sid of j.screenIds) {
    const s = byId.get(sid);
    if (!s?.screenshot) continue;
    if (requested.current.has(sid)) continue;
    if (shots[sid] !== undefined) continue;
    requested.current.add(sid);
    post({ type: "project_map_shot", screenId: sid });
   }
  }
 }, [open, data, shots, post]);

 const stop = data.stoppedBy;
 const partial = stop !== "" && stop !== "done";
 const edgeCount = data.journeys.reduce((acc, j) => acc + j.edges.length, 0);
 const allOpen =
  data.journeys.length > 0 && data.journeys.every((j) => open.has(j.id));

 const evidenceOf = (sid: string): string => {
  const s = data.screens.find((x) => x.id === sid);
  if (!s) return "";
  return s.screenshot || s.snapshot || "";
 };

 return (
  <>
   <div className="pm-meta">
    <span>
     {data.journeys.length}{" "}
     {data.journeys.length === 1 ? "journey" : "journeys"}
    </span>
    <span className="pm-dot">·</span>
    <span>
     {data.screens.length}{" "}
     {data.screens.length === 1 ? "pantalla" : "pantallas"}
    </span>
    <span className="pm-dot">·</span>
    <span>{edgeCount} aristas</span>
    {data.journeys.length > 0 && (
     <button
      type="button"
      className="pm-expand-all"
      onClick={() => onToggleAll(!allOpen)}
     >
      {allOpen ? "Colapsar todo" : "Mostrar todo"}
     </button>
    )}
    {partial && (
     <span
      className="pm-badge partial"
      title="La corrida de M8 se detuvo antes de recorrer todo — la pantalla que rebasó el corte no se registró"
     >
      cobertura parcial: {STOP_REASON[stop] ?? stop}
     </span>
    )}
   </div>
   {data.runUrl && <div className="pm-meta">Recorrido de {data.runUrl}</div>}
   {data.journeys.length === 0 ? (
    <div className="cfg-stub">
     Sin journeys derivables del actionLog
     {data.screens.length > 0
      ? ` — ${data.screens.length} pantalla(s) registradas sin navegación registrada`
      : ""
     }
     .
    </div>
   ) : (
    data.journeys.map((j) => {
     const isOpen = open.has(j.id);
     const fails = j.edges.filter((e) => e.type === "attempted-failed");
     const { columns, edges } = columnsOf(j, data.screens, shots);
     return (
      <div key={j.id} className="pm-journey">
       <button
        type="button"
        className="pm-journey-head"
        onClick={() => onToggle(j.id)}
        aria-expanded={isOpen}
       >
        <Codicon
         name={isOpen ? "chevron-down" : "chevron-right"}
         size={12}
        />
        <span className="pm-journey-title">
         {j.id} · {j.screenIds[0]} → {j.screenIds[j.screenIds.length - 1]}
        </span>
        <span className="pm-journey-count">
         {j.screenIds.length} pantallas · {j.edges.length} aristas
        </span>
       </button>
       {isOpen && (
        <div className="pm-journey-body">
         <GraphCanvas
          columns={columns}
          edges={edges}
          ariaLabel={`Grafo del journey ${j.id}`}
          onNodeClick={(sid) => {
           const file = evidenceOf(sid);
           if (file) post({ type: "open_file", file });
          }}
         />
         {fails.length > 0 && (
          <div className="pm-fails">
           {fails.map((e) => (
            <div key={e.step} className="pm-fail-row" title={e.detail}>
             <Codicon name="warning" size={11} />
             <span>
              #{e.step} {e.description || e.kind} —{" "}
              {CAUSE_LABEL[e.cause ?? ""] ?? e.cause ?? "fallo"}
             </span>
            </div>
           ))}
          </div>
         )}
        </div>
       )}
      </div>
     );
    })
   )}
   {data.orphans.length > 0 && (
    <div className="pm-orphan-note">
     <Codicon name="warning" size={12} />
     <span>
      {data.orphans.length} screenId(s) del actionLog sin pantalla
      registrada ({data.orphans.join(", ")}) — se excluyeron del mapa.
     </span>
    </div>
   )}
  </>
 );
}
```

#### 3. Shell del tab — `webview/components/ProjectMapTab.tsx` (MODIFY — versión Fase 2)

**File**: `webview/components/ProjectMapTab.tsx`
**Changes**: El cuerpo ready delega a `FunctionalView` — la lista honesta (chips, STOP_REASON, byId, meta) se retira del shell y vive en la vista; añade `shots` del store. Estado final de esta fase (el conmutador llega en Fase 3):

```tsx
import { useEffect, useState } from "react";
import type { OutMessage, State } from "../types";
import { Codicon } from "./Codicon";
import { FunctionalView } from "./project-map/FunctionalView";

// M2 (#143) — tab "Mapa del proyecto" (Fase 2): el cuerpo ready delega a
// FunctionalView (grafo SVG por columnas + evidencia) — la lista honesta de
// chips de la Fase 1 se retira. El conmutador Funcional/Técnica llega en la
// Fase 3 y el botón Exportar en la Fase 5. Contrato {state, post}; la carga
// vive en el componente (molde ProductivityTab.tsx:44-47) y la verdad del
// estado en el host (#111 — busySince) publicada por push
// project_map_state. El plegado (open) sigue siendo estado LOCAL del
// componente — NO campo del store global (análogo period/scope de
// ProductivityTab.tsx:37-38).

export function ProjectMapTab({
 state,
 post,
}: {
 state: State;
 post: (m: OutMessage) => void;
}) {
 // FR-3: colapsado por defecto — solo los journeys abiertos renderizan su
 // grafo (render condicional real, molde TreePanel.visibleIds).
 const [open, setOpen] = useState<Set<string>>(new Set());
 const fn = state.projectMap?.functional;
 // Spinner del host (#111).
 const busy = state.projectMap?.busy === "functional";
 const shots = state.projectMap?.shots ?? {};

 // FR-10: carga al abrir + refresh manual (re-enviar el mismo mensaje).
 useEffect(() => {
  post({ type: "project_map", view: "functional" });
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 const toggleOpen = (id: string): void => {
  setOpen((prev) => {
   const next = new Set(prev);
   if (next.has(id)) next.delete(id);
   else next.add(id);
   return next;
  });
 };

 const toggleAll = (all: boolean): void => {
  if (!fn || fn.status !== "ready") return;
  setOpen(all ? new Set(fn.data.journeys.map((j) => j.id)) : new Set());
 };

 return (
  <div className="pm-tab">
   <div className="pm-head">
    <button
     type="button"
     className="pc-save"
     disabled={busy}
     onClick={() => post({ type: "project_map", view: "functional" })}
    >
     <Codicon name="refresh" size={13} spin={busy} />
     <span>{busy ? "Cargando…" : "Recargar"}</span>
    </button>
   </div>

   {!fn || fn.status === "loading" ? (
    <div className="cfg-stub">
     <Codicon name="loading" size={14} spin /> Cargando mapa funcional...
    </div>
   ) : fn.status === "empty" || fn.status === "error" ? (
    <div className="cfg-stub pm-empty">
     <Codicon name={fn.status === "error" ? "warning" : "map"} size={16} />
     <span>{fn.hint}</span>
    </div>
   ) : (
    <FunctionalView
     data={fn.data}
     loadedAt={fn.loadedAt}
     shots={shots}
     open={open}
     onToggle={toggleOpen}
     onToggleAll={toggleAll}
     post={post}
    />
   )}
  </div>
 );
}
```

#### 4. Seam de tipos — `webview/types.ts` (MODIFY)

**File**: `webview/types.ts`
**Changes**: `shots?` en `ProjectMapUiState`; variante In `project_map_shot` (respuesta); variantes Out `project_map_shot` (petición) y `open_file`.

```typescript
// ══ Fase 2: adición dentro de interface ProjectMapUiState (tras busySince) ══
 // ══ Fase 2: cache de screenshots on-demand ══
 /**
  * Cache de screenshots on-demand (data-URI por screenId). Lo llena el
  * reducer con project_map_shot (In) — el host NUNCA lo manda en
  * project_map_state; "" = respondido sin captura.
  */
 shots?: Record<string, string>;

// ══ dentro de la unión InMessage, tras project_map_state (Fase 1) ══
 // ══ Fase 2: respuesta del shot on-demand (molde codebase_index_files
 //    #112: consulta read-only separada del estado) ══
 | {
   type: "project_map_shot";
   screenId: string;
   /** "" = sin captura (definitivo para la UI). */
   dataUri: string;
  }

// ══ dentro de la unión OutMessage, tras project_map (Fase 1) ══
 // ══ Fase 2: petición de shot on-demand + apertura de evidencia (FR-6) ══
 | { type: "project_map_shot"; screenId: string }
 | { type: "open_file"; file: string; line?: number }
```

#### 5. Reducer — `webview/store.ts` (MODIFY)

**File**: `webview/store.ts`
**Changes**: Case `project_map_shot` (cache merge — no replace), junto al case de la Fase 1.

```typescript
// ══ Fase 2: junto al case anterior (Fase 1) — cache del shot on-demand ══

 // M2 (#143) — shot on-demand del mapa (molde codebase_index_files #112:
 // consulta read-only separada del estado). Merge — no replace — para no
 // perder los ya cacheados ni el functional; #126: el mensaje DEBE caer al
 // dispatch general.
 case "project_map_shot":
  return {
   ...state,
   projectMap: {
    ...state.projectMap,
    shots: {
     ...(state.projectMap?.shots ?? {}),
     [msg.screenId]: msg.dataUri,
    },
   },
  };
```

#### 6. Wiring host — `src/extension.ts` (MODIFY)

**File**: `src/extension.ts`
**Changes**: Extiende el import de la Fase 1 con `safeResolveWithin`/`readScreenshotDataUri`; añade los cases `open_file` (texto vía `openAtLine` / binario vía `vscode.open` con `BINARY_EXT` ya existente a nivel módulo, `src/extension.ts:284`) y `project_map_shot` (respuesta SIEMPRE).

```typescript
// ══ Fase 2: evidencia + screenshots on-demand (FR-6/FR-3) ══

// (el import de la Fase 1 se extiende — mismo bloque, junto a los demás ./ locales)
import {
 loadFunctionalMap,
 readScreenshotDataUri,
 safeResolveWithin,
 type ProjectMapHostState,
} from "./project-map/functional-inventory";

// (nuevo case en handleWebviewMessage, tras el case project_map de la Fase 1)

   // M2 (#143) — abrir evidencia desde el mapa. Paths del inventory relativos
   // al cwd de la corrida → rebase + guard de contención SIEMPRE; texto vía
   // openAtLine, binario (PNG) vía vscode.open (BINARY_EXT, nivel módulo).
   // Try/catch degrada a showErrorMessage — nunca silencio.
   case "open_file": {
    const file = typeof msg.file === "string" ? msg.file : "";
    if (!file) break;
    const abs = safeResolveWithin(workspaceCwd(), file);
    if (!abs) {
     void vscode.window.showErrorMessage(
      "Frida: ruta fuera del workspace — " + file,
     );
     break;
    }
    const ext = path.extname(abs).slice(1).toLowerCase();
    void (async () => {
     try {
      if (BINARY_EXT.has(ext)) {
       await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(abs));
      } else {
       await openAtLine(
        abs,
        typeof msg.line === "number" ? msg.line : undefined,
       );
      }
     } catch (e: any) {
      void vscode.window.showErrorMessage(
       "No se pudo abrir " + file + ": " + String(e?.message ?? e),
      );
     }
    })();
    break;
   }

   // M2 (#143) — screenshot on-demand: el webview manda SOLO el screenId; el
   // host resuelve el path desde el inventory YA cargado en pmState (cero
   // confianza en paths del cliente) y responde SIEMPRE (dataUri "" = sin
   // captura → la UI no reintenta; #142 sin espera eterna).
   case "project_map_shot": {
    const screenId = String(msg.screenId ?? "");
    if (!screenId) break;
    const rel =
     pmState.functional?.status === "ready"
      ? (pmState.functional.data.screens.find(
         (s) => s.id === screenId,
        )?.screenshot ?? "")
      : "";
    if (!rel) {
     post({ type: "project_map_shot", screenId, dataUri: "" });
     break;
    }
    post({
     type: "project_map_shot",
     screenId,
     dataUri: readScreenshotDataUri(workspaceCwd(), rel),
    });
    break;
   }
```

#### 7. Lib host — `src/project-map/functional-inventory.ts` (MODIFY)

**File**: `src/project-map/functional-inventory.ts`
**Changes**: Fragmento marcado `══ Slice 2 ══` del diseño: guard de contención `safeResolveWithin` + lector de PNGs como data-URI `readScreenshotDataUri` (al final del archivo).

```typescript
// ══ Fase 2: guard de contención + lector de PNGs como data-URI (al final del archivo) ══

/** Guard de contención (molde safeJoin de frida-pipeline/agents-sync.ts:89-94,
 *  función PRIVADA ahí — patrón re-implementado, no importado): resolve
 *  (root, rel) que NO escapa de root. null si el path sale del cwd. */
export function safeResolveWithin(cwd: string, rel: string): string | null {
 const resolved = path.resolve(cwd, rel);
 const root = path.resolve(cwd) + path.sep;
 return resolved.startsWith(root) ? resolved : null;
}

const IMG_MIME: Record<string, string> = {
 png: "image/png",
 jpg: "image/jpeg",
 jpeg: "image/jpeg",
 gif: "image/gif",
 webp: "image/webp",
 bmp: "image/bmp",
};

/** Lee una captura del workspace como data-URI (CSP img-src data: ya lo
 *  permite — webview-html-core.ts:17, probado en Turn.tsx:76). "" ante
 *  cualquier fallo: escape del cwd, extensión no-imagen, ausente, o >4 MB
 *  (techo anti-postMessage: base64 infla +33%). */
export function readScreenshotDataUri(cwd: string, rel: string): string {
 const abs = safeResolveWithin(cwd, rel);
 if (!abs) return "";
 const mime = IMG_MIME[path.extname(abs).slice(1).toLowerCase()];
 if (!mime) return "";
 try {
  const st = fs.statSync(abs);
  if (!st.isFile() || st.size > 4 * 1024 * 1024) return "";
  return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
 } catch {
  return "";
 }
}
```

#### 8. Estilos — `webview/styles.css` (MODIFY)

**File**: `webview/styles.css`
**Changes**: Bloque del grafo SVG del diseño (`// ══ Slice 2 ══` — "donde estaban los chips"): retira `.pm-screen-chip`, devuelve `.pm-journey-body` a `column` (como el fence final) y añade `.pm-canvas`…`.pm-fail-row` + el bloque `reduced-motion` completo (reemplaza al mínimo de la Fase 1).

```css
/* ══ Fase 2: grafo SVG (.pm-canvas/.pm-graph/…) — donde estaban los chips ══ */
.pm-canvas {
 overflow: auto;
 max-height: 56vh;
 border: 1px solid var(--vscode-panel-border);
 border-radius: 6px;
 background: var(--vscode-editor-background);
}
.pm-graph {
 display: block;
}
.pm-edge {
 fill: none;
 stroke: var(--vscode-textLink-foreground, #4daafc);
 stroke-width: 1.4;
}
.pm-arrow {
 fill: var(--vscode-textLink-foreground, #4daafc);
}
.pm-node.is-clickable {
 cursor: pointer;
}
.pm-node:focus {
 outline: none;
}
.pm-node:focus .pm-node-box,
.pm-node.is-clickable:hover .pm-node-box {
 stroke: var(--vscode-focusBorder, #007fd4);
 stroke-width: 2;
}
.pm-node-box {
 fill: var(--vscode-editorWidget-background, rgba(127, 127, 127, 0.08));
 stroke: var(--vscode-panel-border);
}
.pm-node-box.is-danger {
 stroke: var(--vscode-testing-iconFailed, #f85149);
}
.pm-node-id {
 font-size: 9px;
 font-weight: 700;
 fill: var(--vscode-descriptionForeground);
 font-family: var(--vscode-editor-font-family, monospace);
}
.pm-node-title {
 font-size: 10.5px;
 fill: var(--vscode-foreground);
}
.pm-col-title {
 font-size: 10px;
 font-weight: 600;
 fill: var(--vscode-descriptionForeground);
}
.pm-shot-pending {
 fill: none;
 stroke: var(--vscode-panel-border);
 stroke-dasharray: 3 3;
}
.pm-shot-missing {
 fill: rgba(127, 127, 127, 0.06);
 stroke: var(--vscode-panel-border);
}
.pm-shot-label {
 font-size: 9px;
 fill: var(--vscode-descriptionForeground);
}
.pm-fails {
 display: flex;
 flex-direction: column;
 gap: 3px;
 padding-top: 4px;
}
.pm-fail-row {
 font-size: 10.5px;
 color: var(--vscode-editorWarning-foreground, #cca700);
 display: flex;
 gap: 4px;
 align-items: flex-start;
}
/* (.pm-journey-body vuelve a column — forma final del fence del diseño;
   retirar .pm-screen-chip de la Fase 1) */
.pm-journey-body {
 padding: 6px 8px;
 display: flex;
 flex-direction: column;
 gap: 4px;
}
/* (reemplaza el bloque reduced-motion mínimo de la Fase 1) */
@media (prefers-reduced-motion: reduce) {
 .pm-journey-head,
 .pm-node,
 .pm-node-box,
 .pm-edge {
  transition: none !important;
 }
}
```

#### 9. Test de componente — `test/project-map-tab.test.ts` (MODIFY)

**File**: `test/project-map-tab.test.ts`
**Changes**: Añade el edge attempted-failed al fixture `fnData` (comentado `Fase 2`), el import de `FunctionalView`, el helper `renderFn` y el describe "FunctionalView · grafo SVG por columnas" (4 its).

```typescript
// (import añadido junto al de ProjectMapTab)
import { FunctionalView } from "../webview/components/project-map/FunctionalView";

// (dentro del fixture fnData, tras el edge traversed — forma final del diseño)
    // Fase 2: edge attempted-failed para el test de la lista de fallos.
    {
     type: "attempted-failed",
     from: "P01",
     to: "",
     kind: "form",
     description: "filtro x",
     step: 3,
     cause: "no-progression",
     detail: "la pantalla no cambió tras la acción",
    },

// (adición al final del archivo)

// ══ Fase 2: FunctionalView directo (open inyectado — el toggle vive en
//    ProjectMapTab y renderToStaticMarkup no corre efectos NI handlers) ══

function renderFn(
 data: PmFunctionalData,
 shots: Record<string, string>,
 open: string[],
): string {
 return renderToStaticMarkup(
  React.createElement(FunctionalView, {
   data,
   loadedAt: 1,
   shots,
   open: new Set(open),
   onToggle: () => {},
   onToggleAll: () => {},
   post: vi.fn(),
  }),
 );
}

describe("FunctionalView · grafo SVG por columnas (slice 2)", () => {
 it("journey cerrado → cabecera plegable SIN grafo en el DOM (render condicional)", () => {
  const html = renderFn(fnData, {}, []);
  expect(html).toContain("pm-journey-head");
  expect(html).toContain("J01");
  expect(html).not.toContain("pm-graph");
 });

 it("journey abierto → columnas por pantalla + arista bezier", () => {
  const html = renderFn(fnData, {}, ["J01"]);
  expect(html).toContain("pm-graph");
  expect(html).toContain(">P01<");
  expect(html).toContain(">P02<");
  expect(html).toContain("pm-edge");
  expect(html).toContain("pm-node");
 });

 it("shots on-demand: pendiente → capturando…; cacheado → data-URI; fallido → sin captura", () => {
  expect(renderFn(fnData, {}, ["J01"])).toContain("capturando…");
  expect(
   renderFn(fnData, { P01: "data:image/png;base64,QUJD" }, ["J01"]),
  ).toContain("data:image/png;base64,QUJD");
  expect(renderFn(fnData, { P01: "" }, ["J01"])).toContain("sin captura");
 });

 it("attempted-failed se lista bajo el grafo con su causa", () => {
  const html = renderFn(fnData, {}, ["J01"]);
  expect(html).toContain("pm-fail-row");
  expect(html).toContain("#3");
  expect(html).toContain("sin progresión");
 });
});
```

#### 10. Test de contrato reducer — `test/webview-store.test.ts` (MODIFY)

**File**: `test/webview-store.test.ts`
**Changes**: It de `project_map_shot` dentro del describe de la Fase 1.

```typescript
 // ══ Fase 2: cache del shot on-demand (merge, no replace) — dentro del
 //    describe de la Fase 1 ══
 it("project_map_shot cachea el data-URI (merge, sin perder functional)", () => {
  const s0 = reduce(initialState, {
   type: "project_map_state",
   state: { functional: { status: "loading" }, busy: "functional" },
  });
  const s1 = reduce(s0, {
   type: "project_map_shot",
   screenId: "P02",
   dataUri: "data:image/png;base64,AAA",
  });
  expect(s1.projectMap?.functional?.status).toBe("loading"); // conservado
  expect(s1.projectMap?.shots?.["P02"]).toBe("data:image/png;base64,AAA");
  const s2 = reduce(s1, {
   type: "project_map_shot",
   screenId: "P03",
   dataUri: "",
  });
  expect(s2.projectMap?.shots?.["P02"]).toBeDefined(); // merge
  expect(s2.projectMap?.shots?.["P03"]).toBe("");
 });
```

#### 11. Test de lib host — `test/project-map-lib.test.ts` (MODIFY)

**File**: `test/project-map-lib.test.ts`
**Changes**: Extiende el import con `readScreenshotDataUri`/`safeResolveWithin` y añade los describes del guard de contención y del lector de PNGs (reutilizan los helpers `tmpDirs`/`makeCwd` de la Fase 1).

```typescript
// (import extendido)
import {
 loadFunctionalMap,
 readScreenshotDataUri,
 safeResolveWithin,
} from "../src/project-map/functional-inventory";

// (adición al final del archivo)

// ══ Fase 2: guard de contención + lector de PNGs como data-URI ══

describe("safeResolveWithin · guard de contención (molde agents-sync safeJoin)", () => {
 it("rel dentro del cwd → abs resuelto", () => {
  const cwd = makeCwd();
  expect(safeResolveWithin(cwd, "docs/a.png")).toBe(
   path.resolve(cwd, "docs/a.png"),
  );
 });
 it("escape ../ → null", () => {
  expect(safeResolveWithin(makeCwd(), "../escape.png")).toBeNull();
 });
 it("path absoluto → null (nunca sale del workspace)", () => {
  expect(safeResolveWithin(makeCwd(), "/etc/passwd")).toBeNull();
 });
});

describe("readScreenshotDataUri · data-URI on-demand", () => {
 it("PNG del workspace → data:image/png;base64", () => {
  const cwd = makeCwd();
  fs.mkdirSync(path.join(cwd, "docs/funcional/screenshots"), {
   recursive: true,
  });
  fs.writeFileSync(
   path.join(cwd, "docs/funcional/screenshots/P01.png"),
   "png-fake",
  );
  expect(
   readScreenshotDataUri(cwd, "docs/funcional/screenshots/P01.png"),
  ).toBe("data:image/png;base64," + Buffer.from("png-fake").toString("base64"));
 });
 it("escape del cwd / extensión no-imagen / inexistente → \"\"", () => {
  const cwd = makeCwd();
  expect(readScreenshotDataUri(cwd, "../../etc/passwd")).toBe("");
  expect(readScreenshotDataUri(cwd, "docs/funcional/x.json")).toBe("");
  expect(readScreenshotDataUri(cwd, "no-existe.png")).toBe("");
 });
 it("> 4MB → \"\" (techo anti-postMessage)", () => {
  const cwd = makeCwd();
  fs.mkdirSync(path.join(cwd, "shots"), { recursive: true });
  fs.writeFileSync(
   path.join(cwd, "shots/big.png"),
   Buffer.alloc(4 * 1024 * 1024 + 1),
  );
  expect(readScreenshotDataUri(cwd, "shots/big.png")).toBe("");
 });
});
```

### Success Criteria

#### Automated Verification

- [x] Typecheck limpio (host + webview): `npm run typecheck`
- [x] Tests del slice en verde: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts`
- [x] Seam reducer completo: `grep -c '"project_map_shot"' webview/store.ts` devuelve ≥ 1
- [x] Seam dispatcher: `grep -c '"open_file"' src/extension.ts` devuelve ≥ 1 y `grep -c '"project_map_shot"' src/extension.ts` devuelve ≥ 1
- [x] Bundle en el MISMO commit que la fuente: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` en verde
- [x] Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` vacío

#### Manual Verification

- [ ] Journey colapsado por defecto; clic en la cabecera expande el grafo SVG horizontal (pantallas como columnas ~140px) con aristas bezier y scroll bidireccional en panel angosto (~350px)
- [ ] Clic en nodo abre la evidencia: PNG en el visor de imágenes (vscode.open) cuando hay screenshot; snapshot .json en el editor de texto cuando no; ruta fuera del workspace rechazada con mensaje
- [ ] Expandir un journey pide SOLO los screenshots de sus pantallas (data-URI on-demand): "capturando…" → imagen; pantalla sin captura muestra "sin captura" y no se re-pide
- [ ] "Mostrar todo" / "Colapsar todo" expanden y colapsan todos los journeys
- [ ] Teclado: Tab entra a los nodos, ↑↓ mueve el foco, Enter abre la evidencia del nodo enfocado
- [ ] prefers-reduced-motion: sin transiciones ni animaciones en nodos/aristas del grafo
- [ ] Cambiar de pestaña del hub y volver: el tab re-monta con los journeys re-colapsados (el plegado es estado local del componente, molde period/scope de ProductivityTab.tsx:37-38), el mapa re-carga en <1 s (lectura síncrona del host — sin "Cargando…" eterno) y los screenshots en cache (store) NO se re-piden: al re-expandir un journey solo viajan los PNGs que falten

---

## Phase 3: Vista técnica (pi-lens) + re-poll

### Overview

Añade la vista Técnica: `lens-project-report.ts` (import dinámico host-side de `lens-engine.js` con sonda existsSync + catch ruidoso, parse lenient de hints size-skip vs cache fría), `TechnicalView` (subsystems como columnas, hubs/entryPoints/riesgo clicables, deadWeight sutil, trust header, toggle límite 10/25/50), el conmutador Funcional/Técnica en el tab, y el re-poll de cache fría con backoff 2s→5s→10s cap ~10 intentos con epoch de invalidación (sin timers huérfanos).

**Files** (9): `src/project-map/lens-project-report.ts`, `webview/components/project-map/TechnicalView.tsx`, `src/extension.ts`, `webview/types.ts`, `webview/components/ProjectMapTab.tsx`, `webview/styles.css`, `test/project-map-lib.test.ts`, `test/project-map-tab.test.ts`, `src/project-map/functional-inventory.ts`

*(Nota de fusión del diseño: `src/project-map/functional-inventory.ts` se añadió sobre el skeleton — `ProjectMapHostState` gana `technical?: PmTechnicalState` y su unión `busy` se amplía a `"technical"` (punto de estado host que Architecture/File Map prometen); el resto del archivo locked queda intacto y `lens-project-report.ts` no importa de `functional-inventory` — sin ciclo.)*

### Changes Required

#### 1. Lib host — `src/project-map/lens-project-report.ts` (NEW)

**File**: `src/project-map/lens-project-report.ts`
**Changes**: Import dinámico host-side de `lens-engine.js` (pathToFileURL + sonda existsSync + catch ruidoso), parse de hints (size-skip vs cache fría), tipos espejo del payload `projectReport` 3.8.72, schedule `TECH_POLL_DELAYS_MS` congelado por test. Completo en esta fase.

```typescript
// M2 (#143) — Mapa del proyecto: mapa técnico vía pi-lens.
//
// Seam declarado para host adapters: dist/clients/lens-engine.js (header del
// propio módulo — "host adapters talk ONLY to this module"), que re-exporta
// projectReport. La entry dist/index.js que usa el moat (piLensEntryPath de
// moat-factories.ts) es la entry de EXTENSIÓN (factory que recibe pi): NO
// sirve para invocar projectReport sin sesión pi — de ahí el path propio.
//
// Import dinámico host-side (lección #57, probado desde M1): import() ESM
// exige URL — pathToFileURL().href SIEMPRE. Sonda existsSync → estado "no
// instalado" sin throw; catch ruidoso (console.warn + estado visible), nunca
// silencio (f3112ec). El caller DEBE atrapar rechazos de la llamada completa:
// el await import("./review-graph/builder.js") interno de projectReport no
// está envuelto upstream.
//
// Contrato verificado contra ~/.frida/npm/node_modules/pi-lens@3.8.72
// (dist/clients/project-report.js:501-567):
// - available:false ×2 con semántica OPUESTA — size-skip permanente (hint
//   "review graph disabled: …", NO re-polear) vs cache fría transitoria (hint
//   "retry this call shortly" → re-poll). El hint es el único discriminador
//   accesible desde el seam: parse lenient /^review graph disabled/i, sin
//   hardcodear strings completos (en 4.1.2 cambiaron de texto).
// - available:true = {trust, hubs, entryPoints, subsystems, riskHotspots,
//   deadWeight}; options.limit clampea TODAS las secciones rankeadas
//   (DEFAULT_LIMIT=10); subsystems.directories viene UNCAPPED.
// - El size-skip puede tardar DOS polls en revelarse (1ª llamada → build
//   kicked off; el build graba el verdict in-memory TTL 15 min → 2ª →
//   disabled): el re-poll del host lo cubre naturalmente.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** trust del payload projectReport (subconjunto que la UI lee). */
export interface PmTrust {
 graphBuiltAt: string;
 filesCovered: number;
 filesTotal: number;
 coverage: number;
 stale: boolean;
 lowCoverage: boolean;
 notes: string[];
}

export interface PmHub {
 file: string;
 fanIn: number;
 blastRadius: number;
 role?: string;
}

export interface PmEntryPoint {
 file: string;
 fanIn: number;
 fanOut: number;
}

export interface PmSubsystems {
 directories: string[];
 edges: { from: string; to: string; count: number }[];
 cycles: { dirs: string[]; edgeCount: number }[];
 violations: {
  from: string;
  to: string;
  count: number;
  dominantCount: number;
 }[];
}

export interface PmRiskHotspot {
 file: string;
 fanIn: number;
 maxComplexity: number;
 score: number;
}

export interface PmTechnicalData {
 trust: PmTrust;
 hubs: PmHub[];
 entryPoints: PmEntryPoint[];
 subsystems: PmSubsystems;
 riskHotspots: PmRiskHotspot[];
 deadWeight: { files: { file: string }[]; disclaimer: string };
}

export type PmTechnicalState =
 | { status: "loading" }
 | { status: "building"; hint: string; attempts: number }
 | {
   status: "empty";
   reason: "not-installed" | "disabled" | "exhausted" | "error";
   hint: string;
  }
 | { status: "ready"; data: PmTechnicalData; loadedAt: number; limit: number };

/** Payload crudo del seam (mirror del contrato 3.8.72; sin .d.ts upstream). */
interface PmLensRawReport {
 available?: boolean;
 hint?: string;
 trust?: PmTrust;
 hubs?: PmHub[];
 entryPoints?: PmEntryPoint[];
 subsystems?: PmSubsystems;
 riskHotspots?: PmRiskHotspot[];
 deadWeight?: PmTechnicalData["deadWeight"];
}

/** Schedule del re-poll de cache fría (decisión de design: backoff
 *  2s→5s→10s, cap ~10 intentos ≈ 69 s de sleeps worst-case). Constante
 *  CONGELADA por test (length/monotonía) — la UI espeja su largo
 *  (PM_TECH_MAX_ATTEMPTS en TechnicalView). */
export const TECH_POLL_DELAYS_MS: readonly number[] = [
 2000, 2000, 5000, 5000, 5000, 10000, 10000, 10000, 10000, 10000,
];

/** Entry del seam de host adapters bajo <agentDir>/npm (layout espejo del
 *  piLensEntryPath de moat-factories.ts:59-66 — única fuente del layout dist/). */
export function lensEnginePath(agentDir: string): string {
 return path.join(
  agentDir,
  "npm",
  "node_modules",
  "pi-lens",
  "dist",
  "clients",
  "lens-engine.js",
 );
}

/** size-skip permanente — paro de re-poll inmediato. Parse lenient: los hints
 *  cambiaron de texto entre 3.8.72 y 4.1.2; solo el prefijo es estable. */
export function isSizeSkipHint(hint: string): boolean {
 return /^review graph disabled/i.test(hint);
}

function num(v: unknown, fallback = 0): number {
 return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string {
 return typeof v === "string" ? v : "";
}

/** Carga el mapa técnico. SIEMPRE resuelve (nunca throw): sin instalación →
 *  empty/not-installed; cache fría → building (el host re-polea); size-skip →
 *  empty/disabled; disponible → ready con payload normalizado. */
export async function loadTechnicalMap(
 cwd: string,
 agentDir: string,
 limit: number,
): Promise<PmTechnicalState> {
 const entry = lensEnginePath(agentDir);
 if (!fs.existsSync(entry)) {
  return {
   status: "empty",
   reason: "not-installed",
   hint: "pi-lens no está instalado en ~/.frida/npm — el mapa técnico necesita el moat de lens (instálalo y recarga Frida)",
  };
 }
 try {
  // #57: import() ESM exige URL. Export nombrado (re-export del seam).
  const { projectReport } = (await import(pathToFileURL(entry).href)) as {
   projectReport: (
    cwd: string,
    options?: { limit?: number },
   ) => Promise<PmLensRawReport>;
  };
  // La llamada completa puede rechazar (imports internos sin envolver).
  const rep = await projectReport(cwd, { limit });
  if (!rep || rep.available !== true) {
   const hint =
    typeof rep?.hint === "string" && rep.hint
     ? rep.hint
     : "pi-lens no devolvió reporte";
   return isSizeSkipHint(hint)
    ? { status: "empty", reason: "disabled", hint }
    : { status: "building", hint, attempts: 0 };
  }
  return {
   status: "ready",
   data: {
    trust: {
     graphBuiltAt: str(rep.trust?.graphBuiltAt),
     filesCovered: num(rep.trust?.filesCovered),
     filesTotal: num(rep.trust?.filesTotal),
     coverage: num(rep.trust?.coverage),
     stale: !!rep.trust?.stale,
     lowCoverage: !!rep.trust?.lowCoverage,
     notes: Array.isArray(rep.trust?.notes)
      ? rep.trust!.notes!.filter(
        (n: unknown) => typeof n === "string",
       )
      : [],
    },
    hubs: Array.isArray(rep.hubs) ? rep.hubs : [],
    entryPoints: Array.isArray(rep.entryPoints) ? rep.entryPoints : [],
    subsystems: rep.subsystems ?? {
     directories: [],
     edges: [],
     cycles: [],
     violations: [],
    },
    riskHotspots: Array.isArray(rep.riskHotspots)
     ? rep.riskHotspots
     : [],
    deadWeight: rep.deadWeight ?? { files: [], disclaimer: "" },
   },
   loadedAt: Date.now(),
   limit,
  };
 } catch (e: any) {
  // f3112ec: catch ruidoso — el defecto de la feature no puede ser invisible.
  console.warn(
   "[frida-project-map] pi-lens no pudo cargar:",
   e?.message ?? e,
  );
  return {
   status: "empty",
   reason: "error",
   hint: "pi-lens no pudo generar el mapa técnico: " + String(e?.message ?? e),
  };
 }
}
```

#### 2. Vista Técnica — `webview/components/project-map/TechnicalView.tsx` (NEW, versión base Fase 3)

**File**: `webview/components/project-map/TechnicalView.tsx`
**Changes**: Subsystems como columnas del GraphCanvas (rankeados por peso, cap = límite), overlay de riesgo (`tone:"danger"`), listas clicables hubs/entryPoints/riesgo, deadWeight plegado, trust header, toggle límite 10/25/50, estados building/disabled/exhausted/not-installed/error con Reintentar condicionado. NOTA DE DESCOMPOSICIÓN: versión base sin el fragmento del cruce M9 (Fase 4: prop `cross` + sección + nota) ni el serializador (Fase 5: `serializeTechnicalExport`).

```tsx
import type { OutMessage, PmTechnicalState } from "../../types";
import { Codicon } from "../Codicon";
import { GraphCanvas, type GraphColumn, type GraphEdge } from "./GraphCanvas";

// M2 (#143) — vista Técnica (slice 3): mapa técnico de pi-lens (projectReport
// vía lens-engine.js, import dinámico host-side). Estructura fiel al Desired
// End State del diseño: grafo de subsystems (directorio = columna con UN nodo,
// aristas = subsystems.edges con conteo) + listas clicables de hubs /
// entryPoints + overlay de riesgo (tone:"danger" en directorios que hospedan
// hotspots) + deadWeight sutil (<details>) + trust header + toggle de límite
// 10/25/50 (re-pide con options.limit — clampea las secciones rankeadas).
//
// Estados FR-7 (sin spinner eterno #142): building = cache fría con re-poll
// automático del HOST (backoff 2s→5s→10s, intentos visibles n/10 — resuelve
// solo); disabled = size-skip permanente (hint verbatim, SIN re-poll, botón
// Reintentar para después de subir el tope); exhausted = re-poll agotado
// (hint verbatim + Reintentar); not-installed / error = hint accionable.
// Clic en archivo → open_file (paths cwd-relativos; el host rebasa siempre).

/** Tope de reintentos — espejo del host (TECH_POLL_DELAYS_MS.length en
 *  src/project-map/lens-project-report.ts; congelado por test de lib). */
const PM_TECH_MAX_ATTEMPTS = 10;

const LIMITS: readonly number[] = [10, 25, 50];

/** Directorios del grafo: rankeados por peso en edges, tope = límite elegido
 *  (subsystems.directories viene UNCAPPED upstream — cap visual local). */
function subsystemColumns(
 tech: Extract<PmTechnicalState, { status: "ready" }>,
): { columns: GraphColumn[]; edges: GraphEdge[] } {
 const { subsystems, riskHotspots } = tech.data;
 const weight = new Map<string, number>();
 for (const e of subsystems.edges) {
  weight.set(e.from, (weight.get(e.from) ?? 0) + e.count);
  weight.set(e.to, (weight.get(e.to) ?? 0) + e.count);
 }
 // Overlay de riesgo (FR-5): directorio danger si hospeda un hotspot. Los
 // clusters upstream son 1 segmento (o 2 si el top domina ≥40%) — aquí se
 // aproxima por prefijos: se marcan todos los ancestros del archivo.
 const dangerDirs = new Set<string>();
 for (const h of riskHotspots) {
  const segs = h.file.split("/").filter(Boolean);
  if (segs.length <= 1) {
   dangerDirs.add("(root)");
   continue;
  }
  for (let i = 1; i < segs.length; i++) {
   dangerDirs.add(segs.slice(0, i).join("/"));
  }
 }
 const dirs = [...subsystems.directories]
  .sort(
   (a, b) =>
    (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a.localeCompare(b),
  )
  .slice(0, tech.limit);
 const inGraph = new Set(dirs);
 return {
  columns: dirs.map((d) => ({
   id: d,
   title: d,
   nodes: [
    {
     id: d,
     title: d,
     tone: dangerDirs.has(d) ? ("danger" as const) : undefined,
    },
   ],
  })),
  edges: subsystems.edges
   .filter((e) => inGraph.has(e.from) && inGraph.has(e.to))
   .map((e) => ({
    from: e.from,
    to: e.to,
    label: `${e.count} import(s): ${e.from} → ${e.to}`,
   })),
 };
}

export function TechnicalView({
 tech,
 busy,
 post,
}: {
 tech: PmTechnicalState | undefined;
 busy: boolean;
 post: (m: OutMessage) => void;
}) {
 const currentLimit = tech?.status === "ready" ? tech.limit : undefined;

 if (!tech || tech.status === "loading") {
  return (
   <div className="cfg-stub">
    <Codicon name="loading" size={14} spin /> Cargando mapa técnico...
   </div>
  );
 }

 if (tech.status === "building") {
  return (
   <div className="cfg-stub pm-empty">
    <Codicon name="loading" size={14} spin />
    <span>
     Construyendo mapa técnico… reintentando ({tech.attempts}/
     {PM_TECH_MAX_ATTEMPTS}) — resuelve solo.
    </span>
    <span className="pm-note">{tech.hint}</span>
   </div>
  );
 }

 if (tech.status === "empty") {
  return (
   <div className="cfg-stub pm-empty">
    <Codicon
     name={tech.reason === "not-installed" ? "package" : "warning"}
     size={16}
    />
    <span>{tech.hint}</span>
    {tech.reason !== "not-installed" && tech.reason !== "error" && (
     <button
      type="button"
      className="pm-expand-all"
      disabled={busy}
      onClick={() =>
       post({
        type: "project_map",
        view: "technical",
        limit: currentLimit,
       })
      }
     >
      Reintentar
     </button>
    )}
   </div>
  );
 }

 const { columns, edges } = subsystemColumns(tech);
 const t = tech.data.trust;
 const sys = tech.data.subsystems;

 return (
  <>
   <div className="pm-meta">
    <span>
     Grafo: {t.graphBuiltAt || "—"} · cobertura{" "}
     {Math.round(t.coverage * 100)}% ({t.filesCovered}/{t.filesTotal}{" "}
     archivos)
    </span>
    {t.stale && (
     <span className="pm-badge partial" title={t.notes.join(" · ")}>
      desactualizado
     </span>
    )}
    {t.lowCoverage && (
     <span className="pm-badge partial" title={t.notes.join(" · ")}>
      cobertura baja
     </span>
    )}
   </div>
   <div className="pm-head">
    <div className="seg-toggle">
     {LIMITS.map((n) => (
      <button
       key={n}
       type="button"
       className={"seg" + (tech.limit === n ? " active" : "")}
       disabled={busy}
       onClick={() =>
        post({ type: "project_map", view: "technical", limit: n })
       }
      >
       {n}
      </button>
     ))}
    </div>
    <span className="pm-note">top N por sección</span>
   </div>
   {columns.length === 0 ? (
    <div className="cfg-stub">Sin subsystems derivables del grafo</div>
   ) : (
    <GraphCanvas
     columns={columns}
     edges={edges}
     ariaLabel="Mapa de subsystems (directorios e imports)"
    />
   )}
   {sys.cycles.length > 0 && (
    <div className="pm-note-list">
     {sys.cycles.slice(0, 5).map((c, i) => (
      <div key={i} className="pm-note">
       <Codicon name="sync" size={11} />
       <span>
        ciclo: {c.dirs.join(" ↔ ")} ({c.edgeCount} aristas)
       </span>
      </div>
     ))}
    </div>
   )}
   {sys.violations.length > 0 && (
    <div className="pm-note-list">
     {sys.violations.slice(0, 5).map((v, i) => (
      <div key={i} className="pm-note">
       <Codicon name="arrow-swap" size={11} />
       <span>
        capa: {v.from} → {v.to} minoritario ({v.count} vs{" "}
        {v.dominantCount})
       </span>
      </div>
     ))}
    </div>
   )}
   {tech.data.hubs.length > 0 && (
    <section className="pm-list">
     <h4 className="pm-list-title">
      <Codicon name="hubot" size={12} /> Hubs (fan-in)
     </h4>
     {tech.data.hubs.map((h) => (
      <button
       key={h.file}
       type="button"
       className="pm-row"
       title={h.role ? `roles: ${h.role}` : undefined}
       onClick={() => post({ type: "open_file", file: h.file })}
      >
       <span className="pm-row-main">{h.file}</span>
       <span className="pm-row-meta">
        fanIn {h.fanIn} · impacto {h.blastRadius}
       </span>
      </button>
     ))}
    </section>
   )}
   {tech.data.entryPoints.length > 0 && (
    <section className="pm-list">
     <h4 className="pm-list-title">
      <Codicon name="play" size={12} /> Puntos de entrada
     </h4>
     {tech.data.entryPoints.map((p) => (
      <button
       key={p.file}
       type="button"
       className="pm-row"
       onClick={() => post({ type: "open_file", file: p.file })}
      >
       <span className="pm-row-main">{p.file}</span>
       <span className="pm-row-meta">fanOut {p.fanOut}</span>
      </button>
     ))}
    </section>
   )}
   {tech.data.riskHotspots.length > 0 && (
    <section className="pm-list">
     <h4 className="pm-list-title">
      <Codicon name="flame" size={12} /> Riesgo (fanIn × complejidad)
     </h4>
     {tech.data.riskHotspots.map((h) => (
      <button
       key={h.file}
       type="button"
       className="pm-row is-danger"
       title={`score = fanIn ${h.fanIn} × complejidad máx ${h.maxComplexity}`}
       onClick={() => post({ type: "open_file", file: h.file })}
      >
       <span className="pm-row-main">{h.file}</span>
       <span className="pm-row-meta">score {h.score}</span>
      </button>
     ))}
    </section>
   )}
   {tech.data.deadWeight.files.length > 0 && (
    <details className="pm-dead">
     <summary>
      <Codicon name="eye-closed" size={11} />
      <span>
       {tech.data.deadWeight.files.length} archivo(s) sin importadores
       conocidos
      </span>
     </summary>
     <div className="pm-note">{tech.data.deadWeight.disclaimer}</div>
     {tech.data.deadWeight.files.map((f) => (
      <button
       key={f.file}
       type="button"
       className="pm-row pm-row-dim"
       onClick={() => post({ type: "open_file", file: f.file })}
      >
       <span className="pm-row-main">{f.file}</span>
      </button>
     ))}
    </details>
   )}
  </>
 );
}
```

#### 3. Shell del tab — `webview/components/ProjectMapTab.tsx` (MODIFY — versión Fase 3)

**File**: `webview/components/ProjectMapTab.tsx`
**Changes**: Añade el conmutador Funcional/Técnica (`.seg-toggle .seg`), `view` como estado local, `busy` acotado a la vista activa, efecto `[view]` que dispara la carga de la vista con límite conservado, y la rama Técnica que delega a `TechnicalView`. Estado final de esta fase:

```tsx
import { useEffect, useState } from "react";
import type { OutMessage, State } from "../types";
import { Codicon } from "./Codicon";
import { FunctionalView } from "./project-map/FunctionalView";
import { TechnicalView } from "./project-map/TechnicalView";

// M2 (#143) — tab "Mapa del proyecto". Contrato {state, post} de los tabs del
// SettingsHub; la carga vive en el componente (molde ProductivityTab.tsx:44-47)
// y la verdad del estado en el host (#111 — busySince) publicada por push
// project_map_state. El cuerpo ready delega a FunctionalView (grafo SVG por
// columnas + evidencia); conmutador Funcional/Técnica — la vista Técnica
// delega a TechnicalView (pi-lens) y su carga dispara el MISMO mensaje
// project_map con view:"technical" (el efecto de [view] re-dispara al
// conmutar). La vista activa y el plegado (open) siguen siendo estado
// LOCAL del componente — NO campos del store global (análogo period/scope de
// ProductivityTab.tsx:37-38).

export function ProjectMapTab({
 state,
 post,
}: {
 state: State;
 post: (m: OutMessage) => void;
}) {
 // La vista activa es estado LOCAL (análogo period/scope de
 // ProductivityTab.tsx:37-38) — NO campo del store global.
 const [view, setView] = useState<"functional" | "technical">("functional");
 // FR-3: colapsado por defecto — solo los journeys abiertos renderizan su
 // grafo (render condicional real, molde TreePanel.visibleIds).
 const [open, setOpen] = useState<Set<string>>(new Set());
 const fn = state.projectMap?.functional;
 const tech = state.projectMap?.technical;
 // Spinner solo de la vista activa (busy del host #111).
 const busy = state.projectMap?.busy === view;
 const shots = state.projectMap?.shots ?? {};

 // FR-10: carga al abrir + refresh manual (re-enviar el mismo mensaje). El
 // switch de vista también dispara la carga de esa vista (mismo efecto);
 // en Técnica se conserva el límite elegido (10/25/50) al re-disparar.
 useEffect(() => {
  post({
   type: "project_map",
   view,
   limit:
    view === "technical" && tech?.status === "ready"
     ? tech.limit
     : undefined,
  });
 }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

 const toggleOpen = (id: string): void => {
  setOpen((prev) => {
   const next = new Set(prev);
   if (next.has(id)) next.delete(id);
   else next.add(id);
   return next;
  });
 };

 const toggleAll = (all: boolean): void => {
  if (!fn || fn.status !== "ready") return;
  setOpen(all ? new Set(fn.data.journeys.map((j) => j.id)) : new Set());
 };

 return (
  <div className="pm-tab">
   <div className="pm-head">
    <div className="seg-toggle">
     <button
      type="button"
      className={"seg" + (view === "functional" ? " active" : "")}
      onClick={() => setView("functional")}
     >
      Funcional
     </button>
     <button
      type="button"
      className={"seg" + (view === "technical" ? " active" : "")}
      onClick={() => setView("technical")}
     >
      Técnica
     </button>
    </div>
    <button
     type="button"
     className="pc-save"
     disabled={busy}
     onClick={() =>
      post({
       type: "project_map",
       view,
       limit:
        view === "technical" && tech?.status === "ready"
         ? tech.limit
         : undefined,
      })
     }
    >
     <Codicon name="refresh" size={13} spin={busy} />
     <span>{busy ? "Cargando…" : "Recargar"}</span>
    </button>
   </div>

   {view === "functional" ? (
    !fn || fn.status === "loading" ? (
     <div className="cfg-stub">
      <Codicon name="loading" size={14} spin /> Cargando mapa funcional...
     </div>
    ) : fn.status === "empty" || fn.status === "error" ? (
     <div className="cfg-stub pm-empty">
      <Codicon name={fn.status === "error" ? "warning" : "map"} size={16} />
      <span>{fn.hint}</span>
     </div>
    ) : (
     <FunctionalView
      data={fn.data}
      loadedAt={fn.loadedAt}
      shots={shots}
      open={open}
      onToggle={toggleOpen}
      onToggleAll={toggleAll}
      post={post}
     />
    )
   ) : (
    <TechnicalView tech={tech} busy={busy} post={post} />
   )}
  </div>
 );
}
```

#### 4. Seam de tipos — `webview/types.ts` (MODIFY)

**File**: `webview/types.ts`
**Changes**: Espejo técnico (contrato congelado pi-lens 3.8.72 — idéntico campo a campo) + campo `technical?` en `ProjectMapUiState` + ampliación de la unión `busy`.

```typescript
// ══ Fase 3: espejo técnico (productor src/project-map/lens-project-report.ts;
//    contrato congelado pi-lens 3.8.72 — idéntico campo a campo) ══
export interface PmTrust {
 graphBuiltAt: string;
 filesCovered: number;
 filesTotal: number;
 coverage: number;
 stale: boolean;
 lowCoverage: boolean;
 notes: string[];
}
export interface PmHub {
 file: string;
 fanIn: number;
 blastRadius: number;
 role?: string;
}
export interface PmEntryPoint {
 file: string;
 fanIn: number;
 fanOut: number;
}
export interface PmSubsystems {
 directories: string[];
 edges: { from: string; to: string; count: number }[];
 cycles: { dirs: string[]; edgeCount: number }[];
 violations: {
  from: string;
  to: string;
  count: number;
  dominantCount: number;
 }[];
}
export interface PmRiskHotspot {
 file: string;
 fanIn: number;
 maxComplexity: number;
 score: number;
}
export interface PmTechnicalData {
 trust: PmTrust;
 hubs: PmHub[];
 entryPoints: PmEntryPoint[];
 subsystems: PmSubsystems;
 riskHotspots: PmRiskHotspot[];
 deadWeight: { files: { file: string }[]; disclaimer: string };
}
export type PmTechnicalState =
 | { status: "loading" }
 | { status: "building"; hint: string; attempts: number }
 | {
   status: "empty";
   reason: "not-installed" | "disabled" | "exhausted" | "error";
   hint: string;
  }
 | { status: "ready"; data: PmTechnicalData; loadedAt: number; limit: number };

// ══ adiciones dentro de interface ProjectMapUiState ══
 // ══ Fase 3: vista Técnica (pi-lens) ══
 technical?: PmTechnicalState;
 // (la unión busy se amplía de "functional" | null a:)
 busy?: "functional" | "technical" | null;
```

#### 5. Wiring host — `src/extension.ts` (MODIFY)

**File**: `src/extension.ts`
**Changes**: Import de la lib técnica, `let pmTechEpoch`, `startTechnicalLoad()` (re-poll con epoch — SIN la llamada `refreshPmCross()` que llega en Fase 4) y la rama Técnica al inicio del case `project_map`.

```typescript
// ══ Fase 3: mapa Técnico (pi-lens) — seam lens-engine.js ══

// (import añadido junto al de ./project-map/functional-inventory)
import {
 loadTechnicalMap,
 TECH_POLL_DELAYS_MS,
} from "./project-map/lens-project-report";

// (junto a let pmState — ~linea 617)
 // M2 (#143) — epoch del re-poll técnico: invalida corridas previas (Recargar
 // o cambio de límite mata el loop en su siguiente checkpoint sin tocar
 // estado — sin timers huérfanos: el setTimeout pendiente (≤10 s) resuelve y
 // el guard de epoch sale sin mutar).
 let pmTechEpoch = 0;

// (tras postProjectMapState — ~linea 655)
 // M2 (#143) — carga del mapa Técnico (pi-lens). Cache fría → re-poll con
 // backoff acotado (TECH_POLL_DELAYS_MS: 2s→5s→10s, 10 intentos ≈ 69 s de
 // sleeps); size-skip → paro inmediato (lo decide loadTechnicalMap devolviendo
 // empty/disabled — NO se re-polea: reintentar "shortly" sería guía
 // activamente errónea, project-report.js:512-515). #111: busySince vive aquí.
 // (Fase 4: la rama ready/empty añade refreshPmCross() — ver Changes de esa fase.)
 function startTechnicalLoad(limit: number): void {
  const epoch = ++pmTechEpoch;
  pmState = {
   ...pmState,
   technical: { status: "loading" },
   busy: "technical",
   busySince: Date.now(),
  };
  postProjectMapState();
  void (async () => {
   try {
    for (let attempt = 0; ; attempt++) {
     if (epoch !== pmTechEpoch) return; // suplantada — no tocar estado
     const st = await loadTechnicalMap(
      workspaceCwd(),
      defaultAgentDir(),
      limit,
     );
     if (epoch !== pmTechEpoch) return;
     if (st.status === "ready" || st.status === "empty") {
      pmState = { ...pmState, technical: st, busy: null, busySince: null };
      postProjectMapState();
      return;
     }
     if (attempt >= TECH_POLL_DELAYS_MS.length) {
      pmState = {
       ...pmState,
       technical: { status: "empty", reason: "exhausted", hint: st.hint },
       busy: null,
       busySince: null,
      };
      postProjectMapState();
      return;
     }
     pmState = {
      ...pmState,
      technical: { ...st, attempts: attempt + 1 },
     };
     postProjectMapState();
     await new Promise((r) => setTimeout(r, TECH_POLL_DELAYS_MS[attempt]));
    }
   } catch (e: any) {
    if (epoch !== pmTechEpoch) return;
    pmState = {
     ...pmState,
     technical: {
      status: "empty",
      reason: "error",
      hint: String(e?.message ?? e),
     },
     busy: null,
     busySince: null,
    };
    postProjectMapState();
   }
  })();
 }

// (rama nueva al INICIO del case project_map de la Fase 1 — el cuerpo
//  funcional queda intacto tras ella)
   case "project_map": {
    if (msg.view === "technical") {
     startTechnicalLoad(
      typeof msg.limit === "number" && msg.limit > 0 ? msg.limit : 10,
     );
     break;
    }
    // …cuerpo funcional de la Fase 1 sin cambios…
```

#### 6. Punto de estado host — `src/project-map/functional-inventory.ts` (MODIFY)

**File**: `src/project-map/functional-inventory.ts`
**Changes**: Fusión marcada `══ Slice 3 ══` del diseño: `ProjectMapHostState` gana `technical?: PmTechnicalState` (import type — sin ciclo: `lens-project-report` NO importa de `functional-inventory`) y la unión `busy` se amplía a `"technical"`. El resto del archivo queda intacto.

```typescript
// (import añadido tras el import de ./journeys)
// ══ Fase 3: fusión — estado técnico del tab (tipos del seam pi-lens; sin
//    ciclo: lens-project-report NO importa de functional-inventory) ══
import type { PmTechnicalState } from "./lens-project-report";

// (interface ProjectMapHostState — forma final)
export interface ProjectMapHostState {
 functional?: PmFunctionalState;
 // ══ Fase 3: vista Técnica (pi-lens) ══
 technical?: PmTechnicalState;
 busy?: "functional" | "technical" | null;
 /** Epoch ms del inicio de la acción (#111): sobrevive re-montes del tab. */
 busySince?: number | null;
}
```

#### 7. Estilos — `webview/styles.css` (MODIFY)

**File**: `webview/styles.css`
**Changes**: Bloque `.pm-list`/`.pm-row`/`.pm-note`/`.pm-dead` del diseño (`// ══ Slice 3 ══`).

```css
/* ══ Fase 3: vista Técnica (.pm-list/.pm-row/.pm-note/…) ══ */
.pm-list {
 display: flex;
 flex-direction: column;
 gap: 2px;
}
.pm-list-title {
 font-size: 11px;
 font-weight: 600;
 margin: 6px 0 2px;
 display: flex;
 gap: 4px;
 align-items: center;
 color: var(--vscode-foreground);
}
.pm-row {
 display: flex;
 justify-content: space-between;
 gap: 8px;
 align-items: baseline;
 width: 100%;
 padding: 2px 6px;
 border: none;
 border-radius: 4px;
 background: transparent;
 color: inherit;
 text-align: left;
 cursor: pointer;
}
.pm-row:hover {
 background: var(--vscode-list-hoverBackground);
}
.pm-row-main {
 font-size: 11px;
 font-family: var(--vscode-editor-font-family, monospace);
 overflow-wrap: anywhere;
}
.pm-row-meta {
 font-size: 10px;
 color: var(--vscode-descriptionForeground);
 white-space: nowrap;
}
.pm-row.is-danger .pm-row-main {
 color: var(--vscode-testing-iconFailed, #f85149);
}
.pm-row-dim {
 opacity: 0.7;
}
.pm-note {
 font-size: 10.5px;
 color: var(--vscode-descriptionForeground);
 display: flex;
 gap: 4px;
 align-items: flex-start;
 overflow-wrap: anywhere;
}
.pm-note-list {
 display: flex;
 flex-direction: column;
 gap: 2px;
}
.pm-dead {
 border-top: 1px solid var(--vscode-panel-border);
 padding-top: 4px;
}
.pm-dead summary {
 font-size: 11px;
 color: var(--vscode-descriptionForeground);
 cursor: pointer;
 display: flex;
 gap: 4px;
 align-items: center;
 padding: 2px 0;
}
```

#### 8. Test de lib host — `test/project-map-lib.test.ts` (MODIFY)

**File**: `test/project-map-lib.test.ts`
**Changes**: Import `vi` de vitest (requerido por `globals: false` — fix del slice-verifier), imports de la lib técnica, fixture `READY_REPORT`, helper `makeAgentDir` (mock honesto ESM espejo del real) y el describe del seam pi-lens (6 its).

```typescript
// (import de vitest extendido — fix del slice-verifier bajo globals: false)
import { afterEach, describe, expect, it, vi } from "vitest";

// (imports añadidos)
import {
 isSizeSkipHint,
 lensEnginePath,
 loadTechnicalMap,
 TECH_POLL_DELAYS_MS,
} from "../src/project-map/lens-project-report";

// (adición al final del archivo)

// ══ Fase 3: seam pi-lens — mock honesto del contrato (layout espejo del
//    real: package.json type:module porque el dist es ESM; hints verbatim del
//    contrato 3.8.72; lecciones 30ef616/9d6d8bb: congelar el contrato upstream)
// ══

const READY_REPORT = {
 available: true,
 trust: {
  graphBuiltAt: "2026-08-29T00:00:00.000Z",
  filesCovered: 90,
  filesTotal: 100,
  coverage: 0.9,
  stale: false,
  lowCoverage: false,
  notes: [],
 },
 hubs: [
  { file: "src/extension.ts", fanIn: 38, blastRadius: 12, role: "activate" },
 ],
 entryPoints: [{ file: "webview/main.tsx", fanIn: 0, fanOut: 22 }],
 subsystems: {
  directories: ["src", "test", "webview"],
  edges: [
   { from: "webview", to: "src", count: 12 },
   { from: "test", to: "src", count: 8 },
   { from: "src", to: "test", count: 3 },
  ],
  cycles: [{ dirs: ["src", "test"], edgeCount: 11 }],
  violations: [{ from: "src", to: "test", count: 3, dominantCount: 8 }],
 },
 riskHotspots: [
  { file: "src/extension.ts", fanIn: 38, maxComplexity: 30, score: 1140 },
 ],
 deadWeight: {
  files: [{ file: "docs/x.md" }],
  disclaimer: "Low confidence: verifica antes de borrar.",
 },
};

/** agentDir temporal con un lens-engine.js FAKE pero honesto (ESM espejo). */
function makeAgentDir(moduleBody?: string): string {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pm-lens-"));
 tmpDirs.push(dir);
 const pkgRoot = path.join(dir, "npm/node_modules/pi-lens");
 fs.mkdirSync(path.join(pkgRoot, "dist/clients"), { recursive: true });
 // Layout espejo del real: el dist de pi-lens es ESM ("type":"module").
 fs.writeFileSync(
  path.join(pkgRoot, "package.json"),
  JSON.stringify({ name: "pi-lens", type: "module", version: "0.0.0-test" }),
 );
 fs.writeFileSync(
  path.join(pkgRoot, "dist/clients/lens-engine.js"),
  moduleBody ??
   `export async function projectReport(cwd, options) {
 globalThis.__pmLensCall = { cwd, options };
 return ${JSON.stringify(READY_REPORT)};
}
`,
 );
 return dir;
}

describe("lens-project-report · seam pi-lens (mock honesto del contrato)", () => {
 afterEach(() => {
  for (const d of tmpDirs.splice(0))
   fs.rmSync(d, { recursive: true, force: true });
  delete (globalThis as any).__pmLensCall;
 });

 it("isSizeSkipHint: lenient por prefijo — size-skip sí, cache fría no", () => {
  expect(
   isSizeSkipHint(
    "review graph disabled: project has 12000 files, cap is 5000 — raise maxProjectFiles in .pi-lens.json or set PI_LENS_REVIEW_GRAPH_MAX_FILES",
   ),
  ).toBe(true);
  expect(isSizeSkipHint("Review graph disabled (otra redacción)")).toBe(true);
  expect(
   isSizeSkipHint(
    "No review graph cached for this workspace yet — a build was kicked off in the background; retry this call shortly.",
   ),
  ).toBe(false);
  expect(isSizeSkipHint("")).toBe(false);
 });

 it("TECH_POLL_DELAYS_MS congelado: 10 intentos, rampa 2s→5s→10s", () => {
  expect(TECH_POLL_DELAYS_MS).toHaveLength(10);
  for (let i = 1; i < TECH_POLL_DELAYS_MS.length; i++) {
   expect(TECH_POLL_DELAYS_MS[i]).toBeGreaterThanOrEqual(
    TECH_POLL_DELAYS_MS[i - 1],
   );
  }
  expect(TECH_POLL_DELAYS_MS[0]).toBe(2000);
  expect(TECH_POLL_DELAYS_MS[9]).toBe(10000);
 });

 it("lensEnginePath: layout espejo del piLensEntryPath del moat", () => {
  expect(lensEnginePath(path.join("X", "agent"))).toBe(
   path.join(
    "X",
    "agent",
    "npm",
    "node_modules",
    "pi-lens",
    "dist",
    "clients",
    "lens-engine.js",
   ),
  );
 });

 it("sin instalación → empty/not-installed (sonda sin throw)", async () => {
  const r = await loadTechnicalMap(makeCwd(), makeCwd(), 10);
  expect(r.status).toBe("empty");
  if (r.status === "empty") expect(r.reason).toBe("not-installed");
 });

 it("hint de cache fría → building (re-poll del host)", async () => {
  const agentDir = makeAgentDir(
   `export async function projectReport() {
 return { available: false, hint: "No review graph cached for this workspace yet — a build was kicked off in the background; retry this call shortly." };
}
`,
  );
  const r = await loadTechnicalMap(makeCwd(), agentDir, 10);
  expect(r.status).toBe("building");
 });

 it("hint de size-skip → empty/disabled (paro, no re-poll)", async () => {
  const agentDir = makeAgentDir(
   `export async function projectReport() {
 return { available: false, hint: "review graph disabled: project has 12000 files, cap is 5000 — raise maxProjectFiles in .pi-lens.json" };
}
`,
  );
  const r = await loadTechnicalMap(makeCwd(), agentDir, 10);
  expect(r.status).toBe("empty");
  if (r.status === "empty") expect(r.reason).toBe("disabled");
 });

 it("available:true → ready normalizado + options.limit viaja al seam", async () => {
  const cwd = makeCwd();
  const r = await loadTechnicalMap(cwd, makeAgentDir(), 25);
  expect(r.status).toBe("ready");
  if (r.status === "ready") {
   expect(r.limit).toBe(25);
   expect(r.data.hubs[0]?.file).toBe("src/extension.ts");
   expect(r.data.subsystems.directories).toEqual([
    "src",
    "test",
    "webview",
   ]);
   expect(r.data.riskHotspots[0]?.score).toBe(1140);
   expect(Math.round(r.data.trust.coverage * 100)).toBe(90);
  }
  expect((globalThis as any).__pmLensCall?.options?.limit).toBe(25);
 });

 it("rechazo del import/llamada → empty/error + warn ruidoso (f3112ec)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
   const agentDir = makeAgentDir(
    `export async function projectReport() { throw new Error("boom-lens"); }
`,
   );
   const r = await loadTechnicalMap(makeCwd(), agentDir, 10);
   expect(r.status).toBe("empty");
   if (r.status === "empty") {
    expect(r.reason).toBe("error");
    expect(r.hint).toContain("boom-lens");
   }
   expect(warn).toHaveBeenCalled();
  } finally {
   warn.mockRestore();
  }
 });
});
```

#### 9. Test de componente — `test/project-map-tab.test.ts` (MODIFY)

**File**: `test/project-map-tab.test.ts`
**Changes**: Imports de `TechnicalView` + tipo `PmTechnicalState`, fixture `techReady`, helper `renderTech`, describe del conmutador (1 it) y describe de estados de `TechnicalView` (5 its).

```typescript
// (imports añadidos)
import { TechnicalView } from "../webview/components/project-map/TechnicalView";
// (el import de tipos de la Fase 1 se extiende — solo PmTechnicalState es nuevo)
import type { PmFunctionalData, PmTechnicalState, State } from "../webview/types";

// (adición al final del archivo)

// ══ Fase 3: vista Técnica (TechnicalView directo — open/busy inyectados;
//    renderToStaticMarkup no corre efectos NI handlers, molde renderFn) ══

const techReady: PmTechnicalState = {
 status: "ready",
 limit: 10,
 loadedAt: 1,
 data: {
  trust: {
   graphBuiltAt: "2026-08-29T00:00:00.000Z",
   filesCovered: 90,
   filesTotal: 100,
   coverage: 0.9,
   stale: false,
   lowCoverage: false,
   notes: [],
  },
  hubs: [
   { file: "src/extension.ts", fanIn: 38, blastRadius: 12, role: "activate" },
  ],
  entryPoints: [{ file: "webview/main.tsx", fanIn: 0, fanOut: 22 }],
  subsystems: {
   directories: ["src", "test", "webview"],
   edges: [
    { from: "webview", to: "src", count: 12 },
    { from: "test", to: "src", count: 8 },
   ],
   cycles: [{ dirs: ["src", "test"], edgeCount: 11 }],
   violations: [{ from: "src", to: "test", count: 3, dominantCount: 8 }],
  },
  riskHotspots: [
   { file: "src/extension.ts", fanIn: 38, maxComplexity: 30, score: 1140 },
  ],
  deadWeight: {
   files: [{ file: "docs/x.md" }],
   disclaimer: "Low confidence: verifica antes de borrar.",
  },
 },
};

function renderTech(tech: PmTechnicalState | undefined): string {
 return renderToStaticMarkup(
  React.createElement(TechnicalView, {
   tech,
   busy: false,
   post: vi.fn(),
  }),
 );
}

describe("ProjectMapTab · conmutador de vistas (slice 3)", () => {
 it("render inicial: segmentos Funcional (activo) y Técnica presentes", () => {
  const html = render(baseState);
  expect(html).toContain("Funcional");
  expect(html).toContain("Técnica");
 });
});

describe("TechnicalView · estados (slice 3)", () => {
 it("sin estado → cargando", () => {
  expect(renderTech(undefined)).toContain("Cargando mapa técnico");
 });

 it("building → intentos visibles + hint verbatim (re-poll del host)", () => {
  const html = renderTech({
   status: "building",
   hint: "No review graph cached — retry this call shortly.",
   attempts: 3,
  });
  expect(html).toContain("Construyendo mapa técnico");
  expect(html).toContain("(3/10)");
  expect(html).toContain("retry this call shortly");
 });

 it("disabled (size-skip) → hint verbatim + botón Reintentar, sin re-poll", () => {
  const html = renderTech({
   status: "empty",
   reason: "disabled",
   hint: "review graph disabled: project has 12000 files, cap is 5000",
  });
  expect(html).toContain("review graph disabled");
  expect(html).toContain("Reintentar");
 });

 it("not-installed → hint accionable SIN botón Reintentar", () => {
  const html = renderTech({
   status: "empty",
   reason: "not-installed",
   hint: "pi-lens no está instalado en ~/.frida/npm",
  });
  expect(html).not.toContain("Reintentar");
 });

 it("ready → grafo de subsystems + listas + overlay + deadWeight", () => {
  const html = renderTech(techReady);
  expect(html).toContain("pm-graph");
  expect(html).toContain("12 import(s)");
  expect(html).toContain("src/extension.ts");
  expect(html).toContain("fanIn 38");
  expect(html).toContain("score 1140");
  expect(html).toContain("cobertura 90%");
  expect(html).toContain("sin importadores conocidos");
  expect(html).toContain("pm-node-box is-danger"); // dir "src" hospeda hotspot
 });
});
```

NOTA: en la forma final del diseño, `renderTech` acepta además el parámetro opcional `cross` (Fase 4) — esta versión base es la que el slice 3 verifica; la Fase 4 extiende la firma.

### Success Criteria

#### Automated Verification

- [ ] Typecheck limpio (host + webview): `npm run typecheck`
- [ ] Tests del slice en verde: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts`
- [ ] Seam técnico en el dispatcher: `grep -c 'loadTechnicalMap' src/extension.ts` devuelve ≥ 2 (import + invocación)
- [ ] Espejo técnico en tipos: `grep -c 'PmTechnicalState' webview/types.ts` devuelve ≥ 2 y `grep -c '"technical"' webview/types.ts` devuelve ≥ 2
- [ ] Parse lenient del size-skip (sin strings completos hardcodeados en src): `grep -c 'isSizeSkipHint' src/project-map/lens-project-report.ts` devuelve ≥ 2
- [ ] Schedule de re-poll congelado por test: el caso "TECH_POLL_DELAYS_MS congelado" afirma length 10, rampa no-decreciente 2000→10000
- [ ] Bundle en el MISMO commit que la fuente: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` en verde
- [ ] Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` vacío

#### Manual Verification

- [ ] Grafo caliente: conmutar a "Técnica" pinta columnas por directorio con aristas etiquetadas "N import(s)", directorios con hotspot en rojo (`is-danger`), listas de hubs/puntos de entrada/riesgo clicables que abren el archivo (open_file), deadWeight plegado con disclaimer
- [ ] Cache fría: borrar `~/.pi-lens/projects/<slug>/cache/review-graph.json` → "Construyendo mapa técnico… reintentando (n/10)" avanza solo y termina en el mapa sin recargar la ventana (#142)
- [ ] Repositorio sobre el tope: hint "review graph disabled: …" verbatim SIN avance del contador de reintentos y botón Reintentar visible
- [ ] Toggle 10/25/50 re-pide el reporte con el nuevo límite (badge activo se mueve; cambian los largos de listas y columnas)
- [ ] Cambio de vista y vuelta + re-monte del tab: el estado técnico sobrevive vía re-posteo en webview_ready; el spinner de Recargar refleja solo la vista activa

---

## Phase 4: Cruce técnico↔funcional (matriz M9)

### Overview

Añade el cruce condicionado a la matriz M9 (`docs/api/artifacts/inventory.json`): `matrix-cross.ts` con normalización de paths LLM, join funcional (`screenIds ⊆ screens M8` → danglingScreens) y join técnico (`dirname(modules[].path)` ↔ `subsystems.directories` por prefijo de segmentos completos); `refreshPmCross()` en el host que se recalcula al terminar cada carga; chips de módulo clicables en la vista Funcional y sección "Cruce funcional (M9)" por directorio en la Técnica; degradación digna sin docs/api (omitted/missing con nota, sin error).

**Files** (10): `src/project-map/matrix-cross.ts`, `src/extension.ts`, `webview/types.ts`, `webview/components/project-map/FunctionalView.tsx`, `webview/components/project-map/TechnicalView.tsx`, `webview/components/ProjectMapTab.tsx`, `webview/styles.css`, `test/project-map-lib.test.ts`, `test/project-map-tab.test.ts`, `src/project-map/functional-inventory.ts`

*(Nota de fusión del diseño: `webview/components/ProjectMapTab.tsx` + `test/project-map-tab.test.ts` añadidos sobre el skeleton — solo ProjectMapTab puede pasar `state.projectMap.cross` a las vistas hijas (FR-8) y los tests de componente siguen el molde de los slices 2-3. `src/project-map/functional-inventory.ts` añadido por fix del slice-verifier — `ProjectMapHostState` gana `cross?: PmCrossState` (import type desde ./matrix-cross, sin ciclo, molde de la fusión `technical?` del slice 3); sin él, `pmState = { ...pmState, cross }` rompía `npm run typecheck` del host (TS2353, invisible para vitest/esbuild). El resto del archivo locked queda intacto.)*

### Changes Required

#### 1. Lib host — `src/project-map/matrix-cross.ts` (NEW)

**File**: `src/project-map/matrix-cross.ts`
**Changes**: Cruce técnico↔funcional: lee `docs/api/artifacts/inventory.json` (M9), normaliza paths LLM, join funcional (`screenIds ⊆ screens M8` → danglingScreens) y join técnico (`dirname(modules[].path)` ↔ `subsystems.directories` por prefijo de segmentos completos). Completo en esta fase.

```typescript
// M2 (#143) — Mapa del proyecto: cruce técnico↔funcional vía matriz M9.
//
// Fuente: docs/api/artifacts/inventory.json (M9 — traffic2api). El agente
// correlacionador produce inv.matrix (writer src/tools/frida-traffic2api/
// workflow.ts:1266-1276, schema MATRIX_SCHEMA :605): {id:"M01".. por orden,
// functionality, screenIds[], endpoints[{id,method,path}],
// modules[{path,evidence}], evidence}. Los screenIds son los Pnn de M8
// (mismo generador cuando inv.siblings.funcional); los modules[].path son
// rutas cwd-relativas free-form del LLM → normalización defensiva (strip
// ./, backslashes→/, absolutos accidentales bajo el cwd relativizados).
//
// Joins (research, fijado en checkpoint de discover):
// - funcional: matrix[].screenIds ∩ Set(screens M8) — citados sin pantalla
//   registrada (matriz stale vs corrida M8 nueva) → danglingScreens.
// - técnico: dirname(modules[].path) ↔ subsystems.directories por PREFIJO
//   EXACTO DE SEGMENTOS COMPLETOS ("src/server.js" → "src"; "srca/x" NO
//   matchea "src" — fuzzy por basename produce falsos cruces). Un módulo
//   cuenta en TODOS los dirs ancestro presentes (consistente con el overlay
//   de riesgo de TechnicalView); archivo en raíz → "(root)"; path SIN
//   extensión (directorio citado tal cual) → el propio path. Sin Técnica
//   cargada (dirs=[]) el join técnico queda vacío y unmatchedModules []
//   (no hay "fuera de" sin referencia) — el cruce por pantalla funciona igual.
//
// Degradación digna (FR-7 / R7 de M9): sin docs/api → omitted/missing con
// workaround textual; JSON ilegible o sin matrix[] → omitted/corrupt.
// SIEMPRE resuelve (nunca throw) — molde loadFunctionalMap.

import fs from "node:fs";
import path from "node:path";

/** Entrada normalizada de la matriz M9 para la UI. */
export interface PmCrossEntry {
 id: string;
 functionality: string;
 /** screenIds citados por la fila (sin filtrar — el join vive en byScreen). */
 screenIds: string[];
 /** módulos cwd-relativos normalizados y deduplicados. */
 modules: string[];
 endpointCount: number;
}

export interface PmCrossData {
 entries: PmCrossEntry[];
 /** screenId M8 → módulos que lo implementan (dedup por módulo). */
 byScreen: Record<string, { entryId: string; module: string }[]>;
 /** directorio subsystem → screenIds cubiertos por módulos bajo él. */
 byDirectory: Record<string, string[]>;
 /** screenIds citados por la matriz sin pantalla registrada en M8. */
 danglingScreens: string[];
 /** módulos fuera de todo subsystem conocido ([] si Técnica no cargó). */
 unmatchedModules: string[];
}

export type PmCrossState =
 | { status: "omitted"; reason: "missing" | "corrupt"; hint: string }
 | { status: "ready"; data: PmCrossData; loadedAt: number };

/** Texto del workaround (molde MISSING_WORKAROUND de functional-inventory). */
export const CROSS_MISSING_HINT =
 "Sin matriz M9 — corre el patrón traffic2api (M9) para generar docs/api/ y enlazar pantallas↔módulos";

const INVENTORY_REL = path.join("docs", "api", "artifacts", "inventory.json");

function asString(v: unknown): string {
 return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
 return Array.isArray(v)
  ? v.filter((x): x is string => typeof x === "string")
  : [];
}

/** Normaliza un modules[].path free-form del LLM a cwd-relativa POSIX.
 *  "" = irrecuperable (vacío, o absoluto fuera del cwd). */
export function normalizeModulePath(cwd: string, raw: string): string {
 let p = String(raw ?? "").trim().replace(/\\/g, "/");
 if (!p) return "";
 while (p.startsWith("./")) p = p.slice(2);
 if (path.isAbsolute(p)) {
  const rel = path.relative(path.resolve(cwd), p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
   ? rel.split(path.sep).join("/")
   : "";
 }
 return p.replace(/^\/+/, "");
}

/** Directorio del módulo para el join técnico: dirname; archivo en raíz →
 *  "" (cluster "(root)"); path SIN extensión (directorio citado tal cual,
 *  p.ej. "src") → el propio path. */
function moduleDirOf(p: string): string {
 const d = path.posix.dirname(p);
 if (d !== ".") return d;
 return path.posix.extname(p) ? "" : p;
}

/** Prefijo exacto de segmentos completos: "src/a.ts" ∈ "src"; "srca/b" ∉. */
function dirCovers(dir: string, moduleDir: string): boolean {
 if (dir === "(root)") return moduleDir === "";
 return moduleDir === dir || moduleDir.startsWith(dir + "/");
}

/** Carga la matriz M9 y calcula ambos joins. SIEMPRE resuelve (nunca throw):
 *  sin docs/api → omitted/missing; ilegible/sin matrix → omitted/corrupt. */
export function loadCrossMap(
 cwd: string,
 knownScreenIds: string[],
 subsystemDirs: string[],
): PmCrossState {
 const invPath = path.join(cwd, INVENTORY_REL);
 if (!fs.existsSync(invPath)) {
  return { status: "omitted", reason: "missing", hint: CROSS_MISSING_HINT };
 }
 let raw: unknown;
 try {
  raw = JSON.parse(fs.readFileSync(invPath, "utf8"));
 } catch {
  return {
   status: "omitted",
   reason: "corrupt",
   hint: "inventory.json de M9 ilegible — regenera docs/api/ con el patrón traffic2api (M9)",
  };
 }
 const matrix = (raw as { matrix?: unknown }).matrix;
 if (!Array.isArray(matrix)) {
  return {
   status: "omitted",
   reason: "corrupt",
   hint: "inventory.json de M9 sin matriz (matrix[]) — regenera docs/api/ con el patrón traffic2api (M9)",
  };
 }

 const known = new Set(knownScreenIds);
 const dirs = [...new Set(subsystemDirs)];

 const entries: PmCrossEntry[] = matrix.map((r, i) => {
  const rec = (r ?? {}) as Record<string, unknown>;
  const mods = (Array.isArray(rec.modules) ? rec.modules : [])
   .map((m) =>
    normalizeModulePath(cwd, asString((m as Record<string, unknown>)?.path)),
   )
   .filter((p) => p !== "");
  const modules: string[] = [];
  for (const p of mods) if (!modules.includes(p)) modules.push(p);
  const screenIds = asStringArray(rec.screenIds).filter(
   (s, ix, arr) => arr.indexOf(s) === ix,
  );
  return {
   id: asString(rec.id) || `M${String(i + 1).padStart(2, "0")}`,
   functionality: asString(rec.functionality),
   screenIds,
   modules,
   endpointCount: Array.isArray(rec.endpoints)
    ? rec.endpoints.length
    : 0,
  };
 });

 const byScreen: PmCrossData["byScreen"] = {};
 const byDir = new Map<string, Set<string>>();
 const dangling = new Set<string>();
 const unmatched = new Set<string>();

 for (const e of entries) {
  // Join funcional: solo pantallas registradas en M8; el resto → dangling.
  for (const sid of e.screenIds) {
   if (!known.has(sid)) {
    dangling.add(sid);
    continue;
   }
   let list = byScreen[sid];
   if (!list) {
    list = [];
    byScreen[sid] = list;
   }
   for (const m of e.modules) {
    if (!list.some((l) => l.module === m)) {
     list.push({ entryId: e.id, module: m });
    }
   }
  }
  // Join técnico: prefijo de segmentos completos contra subsystems.
  for (const m of e.modules) {
   const md = moduleDirOf(m);
   let matched = false;
   for (const d of dirs) {
    if (!dirCovers(d, md)) continue;
    matched = true;
    for (const sid of e.screenIds) {
     if (!known.has(sid)) continue;
     let set = byDir.get(d);
     if (!set) {
      set = new Set();
      byDir.set(d, set);
     }
     set.add(sid);
    }
   }
   if (!matched && dirs.length > 0) unmatched.add(m);
  }
 }

 const byDirectory: Record<string, string[]> = {};
 for (const d of [...byDir.keys()].sort()) {
  byDirectory[d] = [...(byDir.get(d) ?? [])].sort();
 }

 return {
  status: "ready",
  data: {
   entries,
   byScreen,
   byDirectory,
   danglingScreens: [...dangling].sort(),
   unmatchedModules: [...unmatched].sort(),
  },
  loadedAt: Date.now(),
 };
}
```

#### 2. Wiring host — `src/extension.ts` (MODIFY)

**File**: `src/extension.ts`
**Changes**: Import de `loadCrossMap`, función `refreshPmCross()` y sus dos llamadas (tras la carga funcional en el case `project_map`, y en la rama ready/empty de `startTechnicalLoad`).

```typescript
// ══ Fase 4: cruce técnico↔funcional (matriz M9) ══

// (import añadido junto a los demás de ./project-map/*)
import { loadCrossMap } from "./project-map/matrix-cross";

// (tras postProjectMapState / startTechnicalLoad — ~linea 655)
 // ══ Fase 4: cruce técnico↔funcional (matriz M9) ══
 // Se recalcula con los insumos disponibles en cada completion: pantallas
 // M8 al terminar la carga funcional, subsystems al terminar la técnica.
 // Lectura síncrona barata (un JSON) — sin busy propio; viaja en el
 // SIEMPRE-posteado project_map_state. Sin Técnica cargada el join por
 // directorio queda vacío y el cruce por pantalla funciona igual (FR-8
 // antes de abrir Técnica).
 function refreshPmCross(): void {
  const fn = pmState.functional;
  const tech = pmState.technical;
  pmState = {
   ...pmState,
   cross: loadCrossMap(
    workspaceCwd(),
    fn?.status === "ready" ? fn.data.screens.map((s) => s.id) : [],
    tech?.status === "ready" ? tech.data.subsystems.directories : [],
   ),
  };
 }

// (llamada 1 — en el case project_map de la Fase 1, tras el try/catch y
//  ANTES del postProjectMapState() final)
    refreshPmCross(); // ══ Fase 4: pantallas disponibles → join funcional ══
    postProjectMapState();
    break;

// (llamada 2 — dentro de startTechnicalLoad de la Fase 3, rama ready/empty)
     if (st.status === "ready" || st.status === "empty") {
      pmState = { ...pmState, technical: st, busy: null, busySince: null };
      refreshPmCross(); // ══ Fase 4: dirs disponibles → join técnico ══
      postProjectMapState();
      return;
     }
```

#### 3. Seam de tipos — `webview/types.ts` (MODIFY)

**File**: `webview/types.ts`
**Changes**: Espejo del cruce (`PmCrossEntry`/`PmCrossData`/`PmCrossState`) + campo `cross?` en `ProjectMapUiState`.

```typescript
// ══ Fase 4: espejo del cruce técnico↔funcional (productor
//    src/project-map/matrix-cross.ts — builds separados) ══
export interface PmCrossEntry {
 id: string;
 functionality: string;
 screenIds: string[];
 modules: string[];
 endpointCount: number;
}
export interface PmCrossData {
 entries: PmCrossEntry[];
 byScreen: Record<string, { entryId: string; module: string }[]>;
 byDirectory: Record<string, string[]>;
 danglingScreens: string[];
 unmatchedModules: string[];
}
export type PmCrossState =
 | { status: "omitted"; reason: "missing" | "corrupt"; hint: string }
 | { status: "ready"; data: PmCrossData; loadedAt: number };

// ══ adición dentro de interface ProjectMapUiState (tras busySince) ══
 // ══ Fase 4: cruce técnico↔funcional (matriz M9) ══
 cross?: PmCrossState;
```

#### 4. Vista Funcional — `webview/components/project-map/FunctionalView.tsx` (MODIFY)

**File**: `webview/components/project-map/FunctionalView.tsx`
**Changes**: Prop `cross` (opcional — retro-compatible con los tests de las fases previas), notas de omisión FR-7 y de matriz stale, `crossOfJourney` y chips de módulo clicables (`open_file`) dentro del journey abierto.

```tsx
// (imports extendidos — añadir PmCrossData y PmCrossState a los de tipo)
import type {
 OutMessage,
 PmCrossData,
 PmCrossState,
 PmFunctionalData,
 PmJourney,
 PmScreen,
} from "../../types";

// (helper añadido tras columnsOf)
/** ══ Fase 4: filas de cruce del journey — solo pantallas con módulos
 *  (sin ruido para journeys sin cruce). */
function crossOfJourney(
 j: PmJourney,
 cross: PmCrossData,
): { sid: string; links: { entryId: string; module: string }[] }[] {
 return j.screenIds
  .filter((sid) => (cross.byScreen[sid] ?? []).length > 0)
  .map((sid) => ({ sid, links: cross.byScreen[sid] }));
}

// (firma del componente — prop nueva al final)
export function FunctionalView({
 data,
 loadedAt,
 shots,
 open,
 onToggle,
 onToggleAll,
 post,
 cross,
}: {
 data: PmFunctionalData;
 loadedAt: number;
 shots: Record<string, string>;
 open: Set<string>;
 onToggle: (id: string) => void;
 onToggleAll: (all: boolean) => void;
 post: (m: OutMessage) => void;
 /** ══ Fase 4: cruce técnico↔funcional (matriz M9) — opcional para no
  *  romper consumers sin cruce (tests de las fases previas). */
 cross?: PmCrossState;
}) {

// (JSX: notas del cruce tras la línea de runUrl)
   {/* ══ Fase 4: notas del cruce (FR-7 omisión + matriz stale) ══ */}
   {cross?.status === "omitted" && (
    <div className="pm-note pm-cross-note">
     <Codicon name="link" size={11} />
     <span>{cross.hint}</span>
    </div>
   )}
   {cross?.status === "ready" && cross.data.danglingScreens.length > 0 && (
    <div className="pm-note pm-cross-note">
     <Codicon name="warning" size={11} />
     <span>
      La matriz M9 cita {cross.data.danglingScreens.length} pantalla(s) no
      registrada(s) en M8 ({cross.data.danglingScreens.join(", ")}) —
      regenera M9 tras la corrida de M8.
     </span>
    </div>
   )}

// (JSX: dentro de pm-journey-body, tras el bloque pm-fails)
         {/* ══ Fase 4: chips de módulo (open_file) para las pantallas del
             journey con cruce M9 ══ */}
         {cross?.status === "ready" &&
          crossOfJourney(j, cross.data).length > 0 && (
           <div className="pm-cross">
            {crossOfJourney(j, cross.data).map(({ sid, links }) => (
             <div key={sid} className="pm-cross-row">
              <span className="pm-cross-screen">{sid}</span>
              <span>→</span>
              {links.map((l) => (
               <button
                key={l.entryId + l.module}
                type="button"
                className="pm-cross-chip"
                title={`implementa ${sid} (${l.entryId})`}
                onClick={() => post({ type: "open_file", file: l.module })}
               >
                {l.module}
               </button>
              ))}
             </div>
            ))}
           </div>
          )}
```

#### 5. Vista Técnica — `webview/components/project-map/TechnicalView.tsx` (MODIFY)

**File**: `webview/components/project-map/TechnicalView.tsx`
**Changes**: Prop `cross` (opcional), sección "Cruce funcional (M9)" con pantallas por directorio (cap coherente con el límite del grafo) y nota de módulos fuera de los subsystems.

```tsx
// (imports extendidos — añadir PmCrossState)
import type { OutMessage, PmCrossState, PmTechnicalState } from "../../types";

// (firma del componente — prop nueva al final)
export function TechnicalView({
 tech,
 busy,
 post,
 cross,
}: {
 tech: PmTechnicalState | undefined;
 busy: boolean;
 post: (m: OutMessage) => void;
 /** ══ Fase 4: cruce técnico↔funcional (matriz M9) — opcional para no
  *  romper consumers sin cruce (tests de la fase anterior). */
 cross?: PmCrossState;
}) {

// (JSX: tras el bloque de violations, antes de la sección de hubs)
   {/* ══ Fase 4: cruce funcional — pantallas cubiertas por directorio
       (cap coherente con el límite del grafo) + módulos fuera ══ */}
   {cross?.status === "ready" &&
    Object.keys(cross.data.byDirectory).length > 0 && (
     <section className="pm-list">
      <h4 className="pm-list-title">
       <Codicon name="link" size={12} /> Cruce funcional (M9)
      </h4>
      {Object.entries(cross.data.byDirectory)
       .slice(0, tech.limit)
       .map(([dir, sids]) => (
        <div key={dir} className="pm-cross-dir">
         <span className="pm-row-main">{dir}</span>
         <span className="pm-row-meta">{sids.join(" · ")}</span>
        </div>
       ))}
     </section>
    )}
   {cross?.status === "ready" && cross.data.unmatchedModules.length > 0 && (
    <div className="pm-note">
     <Codicon name="warning" size={11} />
     <span>
      {cross.data.unmatchedModules.length} módulo(s) de la matriz fuera de
      los subsystems del grafo.
     </span>
    </div>
   )}
```

#### 6. Shell del tab — `webview/components/ProjectMapTab.tsx` (MODIFY)

**File**: `webview/components/ProjectMapTab.tsx`
**Changes**: Solo el shell puede pasar `state.projectMap.cross` a las vistas hijas (FR-8): añade la const y la prop en ambas delegaciones.

```tsx
 const shots = state.projectMap?.shots ?? {};
 // ══ Fase 4: cruce técnico↔funcional (matriz M9) — se pasa a ambas vistas ══
 const cross = state.projectMap?.cross;

// (delegación funcional)
     <FunctionalView
      data={fn.data}
      loadedAt={fn.loadedAt}
      shots={shots}
      open={open}
      onToggle={toggleOpen}
      onToggleAll={toggleAll}
      post={post}
      cross={cross}
     />

// (delegación técnica)
    <TechnicalView tech={tech} busy={busy} post={post} cross={cross} />
```

#### 7. Punto de estado host — `src/project-map/functional-inventory.ts` (MODIFY)

**File**: `src/project-map/functional-inventory.ts`
**Changes**: Fusión marcada `══ Slice 4 ══` del diseño (fix del slice-verifier): `ProjectMapHostState` gana `cross?: PmCrossState` (import type desde ./matrix-cross, sin ciclo, molde de la fusión `technical?` de la Fase 3) — sin él, `pmState = { ...pmState, cross }` rompe `npm run typecheck` del host (TS2353, invisible para vitest/esbuild).

```typescript
// (import añadido tras el import type de ./lens-project-report)
// ══ Fase 4: fusión — estado del cruce (tipos del seam M9; sin ciclo:
//    matrix-cross NO importa de functional-inventory) ══
import type { PmCrossState } from "./matrix-cross";

// (interface ProjectMapHostState — forma final)
export interface ProjectMapHostState {
 functional?: PmFunctionalState;
 // ══ Fase 3: vista Técnica (pi-lens) ══
 technical?: PmTechnicalState;
 busy?: "functional" | "technical" | null;
 /** Epoch ms del inicio de la acción (#111): sobrevive re-montes del tab. */
 busySince?: number | null;
 // ══ Fase 4: cruce técnico↔funcional (matriz M9) ══
 cross?: PmCrossState;
}
```

#### 8. Estilos — `webview/styles.css` (MODIFY)

**File**: `webview/styles.css`
**Changes**: Bloque `.pm-cross*` del diseño (`// ══ Slice 4 ══`).

```css
/* ══ Fase 4: cruce técnico↔funcional (.pm-cross*) ══ */
.pm-cross {
 display: flex;
 flex-direction: column;
 gap: 3px;
 padding-top: 4px;
}
.pm-cross-row {
 display: flex;
 gap: 6px;
 align-items: baseline;
 flex-wrap: wrap;
 font-size: 10.5px;
}
.pm-cross-screen {
 font-family: var(--vscode-editor-font-family, monospace);
 font-weight: 700;
 color: var(--vscode-descriptionForeground);
}
.pm-cross-chip {
 font-size: 10px;
 font-family: var(--vscode-editor-font-family, monospace);
 padding: 0 6px;
 border-radius: 8px;
 border: 1px solid var(--vscode-panel-border);
 background: transparent;
 color: var(--vscode-textLink-foreground, #4daafc);
 cursor: pointer;
}
.pm-cross-chip:hover {
 background: var(--vscode-list-hoverBackground);
}
.pm-cross-chip:focus {
 outline: 1px solid var(--vscode-focusBorder, #007fd4);
}
.pm-cross-note {
 padding-top: 2px;
}
.pm-cross-dir {
 display: flex;
 justify-content: space-between;
 gap: 8px;
 align-items: baseline;
 padding: 2px 6px;
}
```

#### 9. Test de lib host — `test/project-map-lib.test.ts` (MODIFY)

**File**: `test/project-map-lib.test.ts`
**Changes**: Imports de la lib de cruce, helper `makeApiCwd`, fixtures `MATRIX_INV`/`KNOWN_SCREENS`/`DIRS` y los 3 describes de matrix-cross (normalización · degradación · joins).

```typescript
// (imports añadidos)
import {
 CROSS_MISSING_HINT,
 loadCrossMap,
 normalizeModulePath,
} from "../src/project-map/matrix-cross";

// (adición al final del archivo)

// ══ Fase 4: cruce técnico↔funcional — fixtures honestos del schema
//    MATRIX_SCHEMA del writer (traffic2api/workflow.ts:605, 1266-1276) ══

function makeApiCwd(inv?: unknown): string {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pm-x-"));
 tmpDirs.push(dir);
 if (inv !== undefined) {
  fs.mkdirSync(path.join(dir, "docs/api/artifacts"), { recursive: true });
  fs.writeFileSync(
   path.join(dir, "docs/api/artifacts/inventory.json"),
   typeof inv === "string" ? inv : JSON.stringify(inv),
  );
 }
 return dir;
}

const MATRIX_INV = {
 matrix: [
  {
   id: "M01",
   functionality: "inicio de sesión",
   screenIds: ["P01", "P02"],
   endpoints: [{ id: "E01", method: "POST", path: "/login" }],
   modules: [
    { path: "./src/auth.js", evidence: "route POST /login" },
    { path: "webview\\login-form.tsx", evidence: "form creds" },
   ],
   evidence: "walk step 2",
  },
  {
   // sin id — el normalizador asigna M02 por orden (defense del writer)
   functionality: "administración de usuarios",
   screenIds: ["P04", "P99"],
   endpoints: [{ id: "", method: "GET", path: "/users" }],
   modules: [
    { path: "src/admin/users.ts", evidence: "handler" },
    { path: "server.js", evidence: "bootstrap" },
   ],
   evidence: "",
  },
 ],
 orphans: { apiSinUi: [], uiSinCodigo: [] },
 deadZone: [],
 summary: "fixture honesto",
};

const KNOWN_SCREENS = ["P01", "P02", "P03", "P04"];
const DIRS = ["src", "webview", "(root)"];

describe("matrix-cross · normalización de módulos (paths LLM)", () => {
 afterEach(() => {
  for (const d of tmpDirs.splice(0))
   fs.rmSync(d, { recursive: true, force: true });
 });

 it("strip ./ y backslashes → cwd-relativa POSIX", () => {
  expect(normalizeModulePath("/x", "./src/a.ts")).toBe("src/a.ts");
  expect(normalizeModulePath("/x", "webview\\b.tsx")).toBe("webview/b.tsx");
 });

 it("absoluto bajo el cwd → relativiza; fuera o vacío → \"\"", () => {
  const cwd = makeCwd();
  expect(normalizeModulePath(cwd, path.resolve(cwd, "src/a.ts"))).toBe(
   "src/a.ts",
  );
  expect(normalizeModulePath(cwd, "/fuera/de/aqui.ts")).toBe("");
  expect(normalizeModulePath(cwd, "")).toBe("");
 });
});

describe("matrix-cross · degradación digna (FR-7)", () => {
 afterEach(() => {
  for (const d of tmpDirs.splice(0))
   fs.rmSync(d, { recursive: true, force: true });
 });

 it("sin docs/api → omitted/missing con workaround M9", () => {
  const r = loadCrossMap(makeApiCwd(), KNOWN_SCREENS, DIRS);
  expect(r.status).toBe("omitted");
  if (r.status === "omitted") {
   expect(r.reason).toBe("missing");
   expect(r.hint).toBe(CROSS_MISSING_HINT);
   expect(r.hint).toContain("traffic2api (M9)");
  }
 });

 it("JSON corrupto → omitted/corrupt, sin throw", () => {
  const r = loadCrossMap(makeApiCwd("{no-json"), KNOWN_SCREENS, DIRS);
  expect(r.status).toBe("omitted");
  if (r.status === "omitted") expect(r.reason).toBe("corrupt");
 });

 it("sin matrix[] → omitted/corrupt (canon de forma)", () => {
  const r = loadCrossMap(
   makeApiCwd({ orphans: MATRIX_INV.orphans, deadZone: [], summary: "x" }),
   KNOWN_SCREENS,
   DIRS,
  );
  expect(r.status).toBe("omitted");
  if (r.status === "omitted") expect(r.reason).toBe("corrupt");
 });
});

describe("matrix-cross · joins pantalla↔módulo↔subsystem", () => {
 afterEach(() => {
  for (const d of tmpDirs.splice(0))
   fs.rmSync(d, { recursive: true, force: true });
 });

 it("join funcional + ids normalizados por orden + dangling", () => {
  const r = loadCrossMap(makeApiCwd(MATRIX_INV), KNOWN_SCREENS, DIRS);
  expect(r.status).toBe("ready");
  if (r.status !== "ready") return;
  expect(r.data.entries.map((x) => x.id)).toEqual(["M01", "M02"]);
  expect(r.data.entries[0]?.modules).toEqual([
   "src/auth.js",
   "webview/login-form.tsx",
  ]);
  expect(r.data.entries[0]?.endpointCount).toBe(1);
  expect(
   r.data.byScreen["P01"]?.map((l) => l.module),
  ).toEqual(["src/auth.js", "webview/login-form.tsx"]);
  expect(r.data.byScreen["P04"]?.map((l) => l.module)).toEqual([
   "src/admin/users.ts",
   "server.js",
  ]);
  expect(r.data.byScreen["P99"]).toBeUndefined();
  expect(r.data.danglingScreens).toEqual(["P99"]);
 });

 it("join técnico por prefijo de segmentos completos + (root)", () => {
  const r = loadCrossMap(makeApiCwd(MATRIX_INV), KNOWN_SCREENS, DIRS);
  expect(r.status).toBe("ready");
  if (r.status !== "ready") return;
  expect(r.data.byDirectory["src"]).toEqual(["P01", "P02", "P04"]);
  expect(r.data.byDirectory["webview"]).toEqual(["P01", "P02"]);
  expect(r.data.byDirectory["(root)"]).toEqual(["P04"]); // server.js raíz
  expect(r.data.unmatchedModules).toEqual([]);
 });

 it("srca NO matchea src; módulo fuera → unmatched", () => {
  const r = loadCrossMap(
   makeApiCwd({
    matrix: [
     {
      id: "M01",
      functionality: "f",
      screenIds: ["P01"],
      endpoints: [],
      modules: [{ path: "srca/x.js" }],
     },
    ],
    orphans: MATRIX_INV.orphans,
    deadZone: [],
    summary: "",
   }),
   KNOWN_SCREENS,
   ["src"],
  );
  expect(r.status).toBe("ready");
  if (r.status !== "ready") return;
  expect(r.data.byDirectory).toEqual({});
  expect(r.data.unmatchedModules).toEqual(["srca/x.js"]);
 });

 it("directorio citado tal cual (sin extensión) matchea su subsystem", () => {
  const r = loadCrossMap(
   makeApiCwd({
    matrix: [
     {
      id: "M01",
      functionality: "f",
      screenIds: ["P01"],
      endpoints: [],
      modules: [{ path: "src" }],
     },
    ],
    orphans: MATRIX_INV.orphans,
    deadZone: [],
    summary: "",
   }),
   KNOWN_SCREENS,
   ["src", "(root)"],
  );
  expect(r.status).toBe("ready");
  if (r.status !== "ready") return;
  expect(r.data.byDirectory["src"]).toEqual(["P01"]);
 });

 it("módulo cuenta en TODOS los dirs ancestro presentes", () => {
  const r = loadCrossMap(
   makeApiCwd({
    matrix: [
     {
      id: "M01",
      functionality: "f",
      screenIds: ["P01"],
      endpoints: [],
      modules: [{ path: "src/admin/users.ts" }],
     },
    ],
    orphans: MATRIX_INV.orphans,
    deadZone: [],
    summary: "",
   }),
   KNOWN_SCREENS,
   ["src", "src/admin"],
  );
  expect(r.status).toBe("ready");
  if (r.status !== "ready") return;
  expect(r.data.byDirectory["src"]).toEqual(["P01"]);
  expect(r.data.byDirectory["src/admin"]).toEqual(["P01"]);
 });

 it("sin Técnica (dirs=[]) el cruce por pantalla funciona igual", () => {
  const r = loadCrossMap(makeApiCwd(MATRIX_INV), KNOWN_SCREENS, []);
  expect(r.status).toBe("ready");
  if (r.status !== "ready") return;
  expect(r.data.byDirectory).toEqual({});
  expect(r.data.unmatchedModules).toEqual([]); // sin referencia no hay "fuera de"
  expect(r.data.byScreen["P01"]?.length).toBe(2);
 });

 it("dedup: mismo módulo en dos entradas para la misma pantalla → un link", () => {
  const r = loadCrossMap(
   makeApiCwd({
    matrix: [
     {
      id: "M01",
      functionality: "a",
      screenIds: ["P01"],
      endpoints: [],
      modules: [{ path: "src/a.ts" }],
     },
     {
      id: "M02",
      functionality: "b",
      screenIds: ["P01"],
      endpoints: [],
      modules: [{ path: "./src/a.ts" }],
     },
    ],
    orphans: MATRIX_INV.orphans,
    deadZone: [],
    summary: "",
   }),
   KNOWN_SCREENS,
   ["src"],
  );
  expect(r.status).toBe("ready");
  if (r.status !== "ready") return;
  expect(r.data.byScreen["P01"]).toEqual([
   { entryId: "M01", module: "src/a.ts" },
  ]);
 });
});
```

#### 10. Test de componente — `test/project-map-tab.test.ts` (MODIFY)

**File**: `test/project-map-tab.test.ts`
**Changes**: Import de `PmCrossState`, fixture `crossReady`, extensión de `renderFn`/`renderTech` con el parámetro `cross` y los 2 describes del cruce (4 + 3 its).

```typescript
// (import de tipos extendido)
import type {
 PmCrossState,
 PmFunctionalData,
 PmTechnicalState,
 State,
} from "../webview/types";

// (renderFn y renderTech ganan el parámetro opcional cross — misma forma
//  que el diseño: cross?: PmCrossState, pasado al componente)
function renderFn(
 data: PmFunctionalData,
 shots: Record<string, string>,
 open: string[],
 cross?: PmCrossState,
): string {
 return renderToStaticMarkup(
  React.createElement(FunctionalView, {
   data,
   loadedAt: 1,
   shots,
   open: new Set(open),
   onToggle: () => {},
   onToggleAll: () => {},
   post: vi.fn(),
   cross,
  }),
 );
}

function renderTech(
 tech: PmTechnicalState | undefined,
 cross?: PmCrossState,
): string {
 return renderToStaticMarkup(
  React.createElement(TechnicalView, {
   tech,
   busy: false,
   post: vi.fn(),
   cross,
  }),
 );
}

// (adición al final del archivo)

// ══ Fase 4: cruce técnico↔funcional en ambas vistas ══

const crossReady: PmCrossState = {
 status: "ready",
 loadedAt: 1,
 data: {
  entries: [
   {
    id: "M01",
    functionality: "inicio de sesión",
    screenIds: ["P01", "P02"],
    modules: ["src/auth.js"],
    endpointCount: 1,
   },
  ],
  byScreen: { P01: [{ entryId: "M01", module: "src/auth.js" }] },
  byDirectory: { src: ["P01", "P02"] },
  danglingScreens: [],
  unmatchedModules: [],
 },
};

describe("FunctionalView · cruce M9 (slice 4)", () => {
 it("journey abierto con cruce → chips de módulo (open_file al clic)", () => {
  const html = renderFn(fnData, {}, ["J01"], crossReady);
  expect(html).toContain("pm-cross-chip");
  expect(html).toContain("src/auth.js");
 });

 it("omitted → nota de omisión FR-7, sin chips ni error", () => {
  const html = renderFn(fnData, {}, ["J01"], {
   status: "omitted",
   reason: "missing",
   hint: "Sin matriz M9 — corre el patrón traffic2api (M9) para generar docs/api/ y enlazar pantallas↔módulos",
  });
  expect(html).toContain("traffic2api (M9)");
  expect(html).not.toContain("pm-cross-chip");
 });

 it("pantallas colgantes → nota de matriz stale", () => {
  const html = renderFn(fnData, {}, ["J01"], {
   status: "ready",
   loadedAt: 1,
   data: {
    ...crossReady.data,
    byScreen: {},
    danglingScreens: ["P09"],
   },
  });
  expect(html).toContain("no registrada");
 });

 it("sin cruce (undefined) → sin sección ni nota (retro-compatible)", () => {
  const html = renderFn(fnData, {}, ["J01"]);
  expect(html).not.toContain("pm-cross");
 });
});

describe("TechnicalView · cruce M9 (slice 4)", () => {
 it("ready + cross → sección Cruce funcional con pantallas por directorio", () => {
  const html = renderTech(techReady, crossReady);
  expect(html).toContain("Cruce funcional (M9)");
  expect(html).toContain("P01 · P02");
 });

 it("unmatched → nota de módulos fuera del grafo", () => {
  const html = renderTech(techReady, {
   status: "ready",
   loadedAt: 1,
   data: {
    ...crossReady.data,
    byDirectory: {},
    unmatchedModules: ["vendor/x.js"],
   },
  });
  expect(html).toContain("fuera de los subsystems");
 });

 it("sin cross → sin sección (retro-compatible)", () => {
  expect(renderTech(techReady, undefined)).not.toContain("Cruce funcional");
 });
});
```

### Success Criteria

#### Automated Verification

- [ ] Typecheck limpio (host + webview): `npm run typecheck`
- [ ] Tests del slice en verde: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts`
- [ ] Cruce cableado en el host: `grep -c 'loadCrossMap' src/extension.ts` devuelve ≥ 2 (import + refreshPmCross) y `grep -c 'refreshPmCross' src/extension.ts` devuelve ≥ 3 (definición + carga funcional + técnica lista)
- [ ] Cruce en ambas vistas: `grep -c 'cross' webview/components/project-map/FunctionalView.tsx` devuelve ≥ 3 y `grep -c 'cross' webview/components/project-map/TechnicalView.tsx` devuelve ≥ 3
- [ ] Espejo de tipos del cruce: `grep -c 'PmCrossState' webview/types.ts` devuelve ≥ 2
- [ ] Join por prefijo de segmentos congelado por test: los casos "srca NO matchea src", "módulo raíz → (root)" y "directorio citado tal cual" del describe matrix-cross en verde
- [ ] Bundle en el MISMO commit que la fuente: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` en verde
- [ ] Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` vacío

#### Manual Verification

- [ ] Con docs/api + docs/funcional presentes: journey abierto muestra "Pnn → módulo" con chips clicables que abren el archivo; la vista Técnica muestra "Cruce funcional (M9)" con pantallas por directorio (cap coherente con el límite 10/25/50 del grafo)
- [ ] Sin docs/api: nota "Sin matriz M9 — corre el patrón traffic2api (M9)…" en la vista Funcional, sin error ni spinner
- [ ] Matriz stale (cita pantallas inexistentes en M8): nota de pantallas colgantes visible
- [ ] Módulo con "./" o path absoluto bajo el cwd: chip normalizado y el archivo abre correctamente
- [ ] El cruce por pantalla funciona sin abrir la vista Técnica; al cargar Técnica aparecen las secciones por directorio (recompute al ready técnico)

---

## Phase 5: Export HTML autónomo + aterrizaje

### Overview

Fase terminal: `export-html.ts` (HTML autónomo con molde M8 — escHtml, JSON embebido con escape de `</`, CSS inline paleta fija, render vanilla createElement, inlinado base64 de shots con semántica undefined/""/data-URI), serializadores `serializeFunctionalExport`/`serializeTechnicalExport` en las vistas, case `export_map` con orden DIÁLOGO→ensamblar→escribir (molde exportUsage), revisión en cascada del hover de `.pm-journey-head`, docs del tab en `docs/webview-ui-styles.md`, y el baseline completo del proyecto (`npm test`).

**Files** (9): `src/project-map/export-html.ts`, `webview/types.ts`, `webview/components/ProjectMapTab.tsx`, `webview/components/project-map/FunctionalView.tsx`, `webview/components/project-map/TechnicalView.tsx`, `src/extension.ts`, `docs/webview-ui-styles.md`, `test/project-map-lib.test.ts`, `test/project-map-tab.test.ts`

*(Nota de bookkeeping del diseño: `test/project-map-tab.test.ts` se AÑADIÓ sobre el skeleton — los serializadores `serializeFunctionalExport`/`serializeTechnicalExport` viven en componentes .tsx (reusan `columnsOf`/`subsystemColumns`) y son la mitad webview del seam FR-9; sin tests, la cobertura del criterio manual quedaba en vacío. `webview/styles.css` se RETIRÓ del skeleton — el botón Exportar reusa `.pc-save` (:7558) y `.pm-head` ya tiene `flex-wrap`: cero CSS nuevo en este slice. Revisión en cascada sobre el fence locked del slice 1: `.pm-journey-head:hover` gana `background: var(--vscode-list-hoverBackground)` — el `button:hover` global (:2759, (0,1,1)) le inyectaba el azul primario sobre la base (0,1,0); hallazgo del slice-verifier ratificado en el micro-checkpoint.)*

### Changes Required

#### 1. Lib host — `src/project-map/export-html.ts` (NEW)

**File**: `src/project-map/export-html.ts`
**Changes**: Armado del HTML autónomo (molde M8): `escHtml`, JSON embebido con escape de `</`, CSS inline paleta fija, render vanilla `createElement` embebido (`JS_RENDERER`), inlinado base64 de shots vía `resolveShot` (semántica: undefined = resolver vía host, "" = sin captura definitivo, data-URI = inlinado), degradación sin imagen. Aprobado en micro-checkpoint del slice 5 (dos pasadas de slice-verifier: orden diálogo→ensamblar→escribir; import muerto eliminado; frase de cascada del docs veraz).

```typescript
// M2 (#143) — Mapa del proyecto: export HTML autónomo (FR-9).
//
// Approach híbrido (decisión de design): la WEBVIEW serializa el layout de la
// vista activa (qué journeys abiertos, columnas/aristas del grafo, shots ya
// cacheados en el store); el HOST ensambla el documento e inlina los PNGs que
// falten resolviendo screenId → screenshot desde su inventory M8 cargado
// (cero confianza en paths del cliente — molde del shot on-demand de la Fase 2).
//
// Molde del documento: el index.html autónomo de M8
// (src/tools/frida-app-walkthrough/workflow.ts:576-615) — CSS inline con
// paleta FIJA (se abre fuera de VS Code: nada de --vscode-*), datos como JSON
// embebido con escape de "</" para no romper el <script>, render vanilla con
// createElement/textContent (nunca innerHTML con datos). La geometría del
// grafo replica la del GraphCanvas de la webview (columnas ~140 px, nodos
// apilados, aristas bezier con flecha, previews de screenshot) para que el
// export se vea como lo que el usuario ve.
//
// Semántica del shot en el payload: undefined = pedir al host que resuelva
// (nodo con screenId y sin respuesta cacheada); "" = SIN captura definitiva
// (placeholder textual); data-URI = imagen inlinada.

/** Nodo del grafo serializado (espejo UI en webview/types.ts — builds separados). */
export interface PmExportNode {
 id: string;
 title: string;
 /** Vista funcional: pantalla M8 — el host resuelve el PNG faltante. */
 screenId?: string;
 /** data-URI cacheada por la webview; "" = sin captura; undefined = resolver. */
 shot?: string;
 /** true = borde rojo (overlay de riesgo de la vista Técnica). */
 danger?: boolean;
}

export interface PmExportEdge {
 from: string;
 to: string;
 label?: string;
}

export interface PmExportColumn {
 id: string;
 title?: string;
 nodes: PmExportNode[];
}

/** Sección exportable: un journey (Funcional) o un bloque (Técnica). */
export interface PmExportSection {
 id: string;
 title: string;
 open: boolean;
 columns: PmExportColumn[];
 edges: PmExportEdge[];
 notes: string[];
}

export interface PmExportPayload {
 view: "functional" | "technical";
 generatedAt: string;
 title: string;
 meta: string[];
 sections: PmExportSection[];
 notes: string[];
}

export interface ExportHtmlOpts {
 /** Resuelve PNGs no cacheados (data-URI; ""/undefined = sin captura).
  *  Inyectado por extension.ts desde pmState — la lib no lee estado host. */
 resolveShot?: (screenId: string) => string | undefined;
}

/** Escape HTML para los pocos valores que viajan como texto del documento
 *  (title/h1) — molde M8. Los datos viajan por JSON + textContent. */
export function escHtml(v: unknown): string {
 return String(v === null || v === undefined ? "" : v)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
}

const JS_RENDERER = [
 "var SVGNS = 'http://www.w3.org/2000/svg';",
 "function el(t, p) { var n = document.createElement(t); if (p) p.appendChild(n); return n; }",
 "function sel(t, p) { var n = document.createElementNS(SVGNS, t); if (p) p.appendChild(n); return n; }",
 "function txt(n, s) { n.textContent = s; return n; }",
 "function clip(t, m) { t = String(t); return t.length > m ? t.slice(0, m - 1) + '\\u2026' : t; }",
 "function graph(sec) {",
 " var COL_W = 140, GAP_X = 26, NODE_H = 36, PREVIEW_H = 66, GAP_Y = 26, PAD = 10;",
 " var placed = {}, maxY = PAD;",
 " sec.columns.forEach(function (col, ci) {",
 "  var y = PAD + (col.title ? 26 : 14);",
 "  col.nodes.forEach(function (n) {",
 "   var h = NODE_H + (n.shot !== undefined ? PREVIEW_H : 0);",
 "   placed[n.id] = { x: PAD + ci * (COL_W + GAP_X), y: y, h: h };",
 "   y += h + GAP_Y;",
 "  });",
 "  maxY = Math.max(maxY, y - GAP_Y);",
 " });",
 " var w = Math.max(PAD * 2 + sec.columns.length * (COL_W + GAP_X) - GAP_X, 160);",
 " var h = Math.max(maxY + PAD, 110);",
 " var svg = sel('svg'); svg.setAttribute('width', w); svg.setAttribute('height', h);",
 " var defs = sel('defs', svg);",
 " var mk = sel('marker', defs);",
 " mk.setAttribute('id', 'pm-arrow'); mk.setAttribute('viewBox', '0 0 8 8');",
 " mk.setAttribute('refX', 7); mk.setAttribute('refY', 4);",
 " mk.setAttribute('markerWidth', 6); mk.setAttribute('markerHeight', 6);",
 " mk.setAttribute('orient', 'auto-start-reverse');",
 " var mp = sel('path', mk); mp.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z'); mp.setAttribute('class', 'arrow');",
 " (sec.edges || []).forEach(function (e, ei) {",
 "  var a = placed[e.from], b = placed[e.to]; if (!a || !b) return;",
 "  var lane = ((ei % 4) - 1.5) * 7;",
 "  var sameCol = a.x === b.x;",
 "  var x1 = sameCol ? a.x + COL_W / 2 : a.x + COL_W;",
 "  var y1 = sameCol ? a.y + a.h : a.y + NODE_H / 2 + lane;",
 "  var x2 = sameCol ? b.x + COL_W / 2 : b.x;",
 "  var y2 = sameCol ? b.y : b.y + NODE_H / 2 + lane;",
 "  var sag = sameCol ? Math.max((y2 - y1) / 2, 14) : Math.max(Math.abs(x2 - x1) * 0.45, 18);",
 "  var c1x = sameCol ? x1 : x1 + sag, c1y = sameCol ? y1 + sag : y1;",
 "  var c2x = sameCol ? x2 : x2 - sag, c2y = sameCol ? y2 - sag : y2;",
 "  var pe = sel('path', svg); pe.setAttribute('class', 'edge');",
 "  pe.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + x2 + ' ' + y2);",
 "  pe.setAttribute('marker-end', 'url(#pm-arrow)');",
 "  if (e.label) txt(sel('title', pe), e.label);",
 " });",
 " sec.columns.forEach(function (col, ci) {",
 "  if (col.title) {",
 "   var ct = sel('text', svg);",
 "   ct.setAttribute('x', PAD + ci * (COL_W + GAP_X)); ct.setAttribute('y', PAD + 12);",
 "   ct.setAttribute('class', 'col-title'); txt(ct, clip(col.title, 18));",
 "  }",
 "  col.nodes.forEach(function (n) {",
 "   var p = placed[n.id]; if (!p) return;",
 "   var g = sel('g', svg);",
 "   var r = sel('rect', g);",
 "   r.setAttribute('x', p.x); r.setAttribute('y', p.y);",
 "   r.setAttribute('width', COL_W); r.setAttribute('height', NODE_H); r.setAttribute('rx', 6);",
 "   r.setAttribute('class', 'node-box' + (n.danger ? ' danger' : ''));",
 "   var ti = sel('text', g); ti.setAttribute('x', p.x + 6); ti.setAttribute('y', p.y + 13);",
 "   ti.setAttribute('class', 'node-id'); txt(ti, n.id);",
 "   var tt = sel('text', g); tt.setAttribute('x', p.x + 6); tt.setAttribute('y', p.y + 26);",
 "   tt.setAttribute('class', 'node-title'); txt(tt, clip(n.title, 20));",
 "   if (n.shot === '') {",
 "    var rm = sel('rect', g);",
 "    rm.setAttribute('x', p.x + 4); rm.setAttribute('y', p.y + NODE_H + 4);",
 "    rm.setAttribute('width', COL_W - 8); rm.setAttribute('height', PREVIEW_H - 10); rm.setAttribute('rx', 4);",
 "    rm.setAttribute('class', 'shot-missing');",
 "    var lm = sel('text', g); lm.setAttribute('x', p.x + COL_W / 2); lm.setAttribute('y', p.y + NODE_H + PREVIEW_H / 2);",
 "    lm.setAttribute('text-anchor', 'middle'); lm.setAttribute('class', 'shot-label');",
 "    txt(lm, 'sin captura');",
 "   } else if (n.shot) {",
 "    var im = sel('image', g);",
 "    im.setAttribute('x', p.x + 4); im.setAttribute('y', p.y + NODE_H + 4);",
 "    im.setAttribute('width', COL_W - 8); im.setAttribute('height', PREVIEW_H - 10);",
 "    im.setAttribute('preserveAspectRatio', 'xMidYMin meet');",
 "    im.setAttribute('href', n.shot);",
 "   }",
 "  });",
 " });",
 " return svg;",
 "}",
 "document.getElementById('meta').textContent = DATA.meta.join(' · ');",
 "var app = document.getElementById('app');",
 "DATA.sections.forEach(function (sec) {",
 " var d = el('details', app);",
 " if (sec.open) d.setAttribute('open', '');",
 " var s = el('summary', d);",
 " txt(s, sec.title + (sec.columns.length ? ' · ' + sec.columns.length + ' columnas' : ''));",
 " if (sec.columns.length) {",
 "  var wrap = el('div', d); wrap.className = 'graph-wrap'; wrap.appendChild(graph(sec));",
 " }",
 " (sec.notes || []).forEach(function (nt) { txt(el('div', d), nt).className = 'note'; });",
 "});",
 "var foot = document.getElementById('foot');",
 "(DATA.notes || []).forEach(function (nt) { var f = el('div', foot); f.className = 'note'; txt(f, nt); });",
].join("\n");

/** Ensambla el HTML autónomo. Resuelve los shots faltantes vía opts (los
 *  cacheados viajan tal cual); nunca muta el payload recibido. */
export function buildExportHtml(
 payload: PmExportPayload,
 opts: ExportHtmlOpts = {},
): string {
 const sections: PmExportSection[] = payload.sections.map((sec) => ({
  ...sec,
  columns: sec.columns.map((col) => ({
   ...col,
   nodes: col.nodes.map((n) => ({
    ...n,
    shot:
     n.shot !== undefined
      ? n.shot
      : n.screenId !== undefined
       ? (opts.resolveShot?.(n.screenId) ?? "")
       : undefined,
   })),
  })),
 }));
 const resolved: PmExportPayload = { ...payload, sections };
 const dataJson = JSON.stringify(resolved).split("</").join("<\\/");
 const html: string[] = [];
 html.push("<!DOCTYPE html>");
 html.push('<html lang="es"><head><meta charset="utf-8">');
 html.push(
  "<title>" + escHtml(payload.title) + " · Frida — Mapa del proyecto</title>",
 );
 html.push("<style>");
 html.push(
  "body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#0f1117;color:#e6e8ee}",
 );
 html.push(
  "header{padding:24px 32px;background:linear-gradient(135deg,#1b2340,#0f1117)}",
 );
 html.push(
  "h1{margin:0 0 4px;font-size:22px}header p{margin:0;color:#9aa3b5;font-size:13px}",
 );
 html.push("main{padding:8px 32px 24px}footer{padding:0 32px 32px}");
 html.push(
  "details{background:#161a26;border:1px solid #232a3d;border-radius:10px;margin:10px 0;overflow:hidden}",
 );
 html.push(
  "summary{padding:10px 14px;cursor:pointer;font-weight:600;font-size:14px;color:#e6e8ee}",
 );
 html.push(".graph-wrap{overflow:auto;border-top:1px solid #232a3d}");
 html.push("svg{display:block;min-width:100%}");
 html.push(".edge{fill:none;stroke:#4daafc;stroke-width:1.4}");
 html.push(".arrow{fill:#4daafc}");
 html.push(".node-box{fill:#161a26;stroke:#3a4260}");
 html.push(".node-box.danger{stroke:#f85149}");
 html.push(
  ".node-id{font-size:9px;font-weight:700;fill:#9aa3b5;font-family:ui-monospace,monospace}",
 );
 html.push(".node-title{font-size:10.5px;fill:#e6e8ee}");
 html.push(".col-title{font-size:10px;font-weight:600;fill:#9aa3b5}");
 html.push(".shot-missing{fill:rgba(127,127,127,0.06);stroke:#3a4260}");
 html.push(".shot-label{font-size:9px;fill:#9aa3b5}");
 html.push(
  ".note{color:#9aa3b5;font-size:12px;padding:2px 14px;overflow-wrap:anywhere}",
 );
 html.push("footer .note{padding:2px 0}");
 html.push("</style></head><body>");
 html.push(
  "<header><h1>" +
   escHtml(payload.title) +
   "</h1><p id=\"meta\"></p></header>",
 );
 html.push("<main id=\"app\"></main>");
 html.push(
  "<footer id=\"foot\"><div class=\"note\" id=\"gen\"></div></footer>",
 );
 html.push("<script>var DATA = " + dataJson + ";");
 html.push(JS_RENDERER);
 html.push(
  "document.getElementById('gen').textContent = 'generado ' + DATA.generatedAt + ' · Frida';",
 );
 html.push("</script></body></html>");
 return html.join("\n");
}
```

#### 2. Seam de tipos — `webview/types.ts` (MODIFY)

**File**: `webview/types.ts`
**Changes**: Espejos `PmExport*` (productor `src/project-map/export-html.ts` — builds separados) + variante Out `export_map`.

```typescript
// ══ Fase 5: espejo del export HTML autónomo (productor
//    src/project-map/export-html.ts — builds separados) ══
export interface PmExportNode {
 id: string;
 title: string;
 /** Vista funcional: pantalla M8 — el host resuelve el PNG faltante. */
 screenId?: string;
 /** data-URI cacheada por la webview; "" = sin captura; undefined = resolver. */
 shot?: string;
 /** true = borde rojo (overlay de riesgo de la vista Técnica). */
 danger?: boolean;
}
export interface PmExportEdge {
 from: string;
 to: string;
 label?: string;
}
export interface PmExportColumn {
 id: string;
 title?: string;
 nodes: PmExportNode[];
}
/** Sección exportable: un journey (Funcional) o un bloque (Técnica). */
export interface PmExportSection {
 id: string;
 title: string;
 open: boolean;
 columns: PmExportColumn[];
 edges: PmExportEdge[];
 notes: string[];
}
export interface PmExportPayload {
 view: "functional" | "technical";
 generatedAt: string;
 title: string;
 meta: string[];
 sections: PmExportSection[];
 notes: string[];
}

// ══ dentro de la unión OutMessage, tras open_file (Fase 2) ══
 // ══ Fase 5: export HTML autónomo de la vista activa (FR-9) — la webview
 // serializa el layout; el host ensambla + inlina PNGs ══
 | { type: "export_map"; payload: PmExportPayload }
```

#### 3. Shell del tab — `webview/components/ProjectMapTab.tsx` (MODIFY — versión FINAL)

**File**: `webview/components/ProjectMapTab.tsx`
**Changes**: Botón "Exportar" (`.pc-save`, codicon `export`), `exportable` condicionado a vista lista, `doExport` que serializa la vista activa vía `serializeFunctionalExport`/`serializeTechnicalExport`. Con esto el archivo queda idéntico al fence final del diseño, salvo la prop `loadedAt` añadida por el fix del triage Step 5 (design follow-up pendiente):

```tsx
import { useEffect, useState } from "react";
import type { OutMessage, State } from "../types";
import { Codicon } from "./Codicon";
import {
 FunctionalView,
 serializeFunctionalExport,
} from "./project-map/FunctionalView";
import {
 TechnicalView,
 serializeTechnicalExport,
} from "./project-map/TechnicalView";

// M2 (#143) — tab "Mapa del proyecto". Contrato {state, post} de los tabs del
// SettingsHub; la carga vive en el componente (molde ProductivityTab.tsx:44-47)
// y la verdad del estado en el host (#111 — busySince) publicada por push
// project_map_state. El cuerpo ready delega a FunctionalView (grafo SVG por
// columnas + evidencia); conmutador Funcional/Técnica — la vista Técnica
// delega a TechnicalView (pi-lens) y su carga dispara el MISMO mensaje
// project_map con view:"technical" (el efecto de [view] re-dispara al
// conmutar). La vista activa y el plegado (open) siguen siendo estado
// LOCAL del componente — NO campos del store global (análogo
// period/scope de ProductivityTab.tsx:37-38).

export function ProjectMapTab({
 state,
 post,
}: {
 state: State;
 post: (m: OutMessage) => void;
}) {
 // La vista activa es estado LOCAL (análogo period/scope de
 // ProductivityTab.tsx:37-38) — NO campo del store global.
 const [view, setView] = useState<"functional" | "technical">("functional");
 // FR-3: colapsado por defecto — solo los journeys abiertos renderizan su
 // grafo (render condicional real, molde TreePanel.visibleIds).
 const [open, setOpen] = useState<Set<string>>(new Set());
 const fn = state.projectMap?.functional;
 const tech = state.projectMap?.technical;
 // Spinner solo de la vista activa (busy del host #111).
 const busy = state.projectMap?.busy === view;
 const shots = state.projectMap?.shots ?? {};
 // ══ Fase 4: cruce técnico↔funcional (matriz M9) — se pasa a ambas vistas ══
 const cross = state.projectMap?.cross;

 // FR-10: carga al abrir + refresh manual (re-enviar el mismo mensaje). El
 // switch de vista también dispara la carga de esa vista (mismo efecto);
 // en Técnica se conserva el límite elegido (10/25/50) al re-disparar.
 useEffect(() => {
  post({
   type: "project_map",
   view,
   limit:
    view === "technical" && tech?.status === "ready"
     ? tech.limit
     : undefined,
  });
 }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

 const toggleOpen = (id: string): void => {
  setOpen((prev) => {
   const next = new Set(prev);
   if (next.has(id)) next.delete(id);
   else next.add(id);
   return next;
  });
 };

 const toggleAll = (all: boolean): void => {
  if (!fn || fn.status !== "ready") return;
  setOpen(all ? new Set(fn.data.journeys.map((j) => j.id)) : new Set());
 };

 // ══ Fase 5 (FR-9): export HTML autónomo de la vista ACTIVA — la webview
 // serializa el layout (journeys abiertos/columnas/shots cacheados), el host
 // ensambla + inlina los PNGs faltantes. Solo con vista lista. ══
 const exportable =
  view === "functional" ? fn?.status === "ready" : tech?.status === "ready";
 const doExport = (): void => {
  if (view === "functional" && fn?.status === "ready") {
   post({
    type: "export_map",
    payload: serializeFunctionalExport(fn.data, open, shots, cross),
   });
  } else if (view === "technical" && tech?.status === "ready") {
   post({
    type: "export_map",
    payload: serializeTechnicalExport(tech, cross),
   });
  }
 };

 return (
  <div className="pm-tab">
   <div className="pm-head">
    <div className="seg-toggle">
     <button
      type="button"
      className={"seg" + (view === "functional" ? " active" : "")}
      onClick={() => setView("functional")}
     >
      Funcional
     </button>
     <button
      type="button"
      className={"seg" + (view === "technical" ? " active" : "")}
      onClick={() => setView("technical")}
     >
      Técnica
     </button>
    </div>
    <button
     type="button"
     className="pc-save"
     disabled={busy}
     onClick={() =>
      post({
       type: "project_map",
       view,
       limit:
        view === "technical" && tech?.status === "ready"
         ? tech.limit
         : undefined,
      })
     }
    >
     <Codicon name="refresh" size={13} spin={busy} />
     <span>{busy ? "Cargando…" : "Recargar"}</span>
    </button>
    {/* ══ Fase 5: export HTML autónomo (.pc-save primario, codicon export) ══ */}
    <button
     type="button"
     className="pc-save"
     disabled={!exportable}
     onClick={doExport}
     title="Exportar la vista actual como HTML autónomo"
    >
     <Codicon name="export" size={13} />
     <span>Exportar</span>
    </button>
   </div>

   {view === "functional" ? (
    !fn || fn.status === "loading" ? (
     <div className="cfg-stub">
      <Codicon name="loading" size={14} spin /> Cargando mapa funcional...
     </div>
    ) : fn.status === "empty" || fn.status === "error" ? (
     <div className="cfg-stub pm-empty">
      <Codicon name={fn.status === "error" ? "warning" : "map"} size={16} />
      <span>{fn.hint}</span>
     </div>
    ) : (
     <FunctionalView
      data={fn.data}
      loadedAt={fn.loadedAt}
      shots={shots}
      open={open}
      onToggle={toggleOpen}
      onToggleAll={toggleAll}
      post={post}
      cross={cross}
     />
    )
   ) : (
    <TechnicalView tech={tech} busy={busy} post={post} cross={cross} />
   )}
  </div>
 );
}
```

#### 4. Serializador Funcional — `webview/components/project-map/FunctionalView.tsx` (MODIFY)

**File**: `webview/components/project-map/FunctionalView.tsx`
**Changes**: Exporta `serializeFunctionalExport` (adición al final del archivo — reusa `columnsOf` y el criterio de shots del on-demand; fails y cruce viajan como notas de texto).

```tsx
// (imports de tipo extendidos — añadir PmExportPayload y PmExportSection)
import type {
 OutMessage,
 PmCrossData,
 PmCrossState,
 PmExportPayload,
 PmExportSection,
 PmFunctionalData,
 PmJourney,
 PmScreen,
} from "../../types";

// (adición al final del archivo)

// ══ Fase 5 (FR-9): serializa la vista Funcional para el export HTML.
// Reusa columnsOf (mismas columnas/aristas que el grafo en pantalla) y el
// criterio de shots del on-demand: solo pantallas CON screenshot path piden
// resolución al host (shot undefined); "" = sin captura definitiva. Los fails
// y el cruce viajan como notas de texto (el HTML autónomo no tiene clic). ══
export function serializeFunctionalExport(
 data: PmFunctionalData,
 open: Set<string>,
 shots: Record<string, string>,
 cross?: PmCrossState,
): PmExportPayload {
 const byId = new Map(data.screens.map((s) => [s.id, s]));
 const edgeCount = data.journeys.reduce((acc, j) => acc + j.edges.length, 0);
 const stop = data.stoppedBy;
 const sections: PmExportSection[] = data.journeys.map((j) => {
  const { columns, edges } = columnsOf(j, data.screens, shots);
  const fails = j.edges.filter((e) => e.type === "attempted-failed");
  return {
   id: j.id,
   title: `${j.id} · ${j.screenIds[0]} → ${j.screenIds[j.screenIds.length - 1]} (${j.screenIds.length} pantallas · ${j.edges.length} aristas)`,
   open: open.has(j.id),
   columns: columns.map((c) => {
    const s = byId.get(c.id);
    return {
     id: c.id,
     nodes: c.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      screenId: s?.screenshot ? n.id : undefined,
      shot: s?.screenshot ? shots[n.id] : undefined,
     })),
    };
   }),
   edges,
   notes: fails.map(
    (e) =>
     `#${e.step} ${e.description || e.kind} — ${CAUSE_LABEL[e.cause ?? ""] ?? e.cause ?? "fallo"}`,
   ),
  };
 });
 const notes: string[] = [];
 if (data.orphans.length > 0) {
  notes.push(
   `${data.orphans.length} screenId(s) del actionLog sin pantalla registrada (${data.orphans.join(", ")}) — se excluyeron del mapa`,
  );
 }
 if (cross?.status === "ready" && cross.data.danglingScreens.length > 0) {
  notes.push(
   `la matriz M9 cita ${cross.data.danglingScreens.length} pantalla(s) no registrada(s) en M8 (${cross.data.danglingScreens.join(", ")}) — regenera M9 tras la corrida de M8`,
  );
 }
 return {
  view: "functional",
  generatedAt: new Date().toISOString(),
  title: "Mapa funcional",
  meta: [
   `${data.journeys.length} journeys · ${data.screens.length} pantallas · ${edgeCount} aristas`,
   stop !== "" && stop !== "done"
    ? `cobertura parcial: ${STOP_REASON[stop] ?? stop}`
    : "",
   data.runUrl ? `recorrido de ${data.runUrl}` : "",
  ].filter(Boolean),
  sections,
  notes,
 };
}
```

#### 5. Serializador Técnico — `webview/components/project-map/TechnicalView.tsx` (MODIFY)

**File**: `webview/components/project-map/TechnicalView.tsx`
**Changes**: Exporta `serializeTechnicalExport` (adición al final del archivo — sección de grafo con overlay danger + secciones-lista como notas + deadWeight global; sin shots).

```tsx
// (imports de tipo extendidos — añadir PmExportPayload y PmExportSection)
import type {
 OutMessage,
 PmCrossState,
 PmExportPayload,
 PmExportSection,
 PmTechnicalState,
} from "../../types";

// (adición al final del archivo)

// ══ Fase 5 (FR-9): serializa la vista Técnica para el export HTML.
// Sección de grafo (subsystems con overlay danger, reusa subsystemColumns) +
// secciones-lista como notas (hubs/puntos de entrada/riesgo/cruce) +
// deadWeight global. Sin shots: la vista Técnica no tiene capturas. ══
export function serializeTechnicalExport(
 tech: Extract<PmTechnicalState, { status: "ready" }>,
 cross?: PmCrossState,
): PmExportPayload {
 const { columns, edges } = subsystemColumns(tech);
 const t = tech.data.trust;
 const sys = tech.data.subsystems;
 const sections: PmExportSection[] = [
  {
   id: "subsystems",
   title: `Subsystems (top ${tech.limit} por peso de imports)`,
   open: true,
   columns: columns.map((c) => ({
    id: c.id,
    title: c.title,
    nodes: c.nodes.map((n) => ({
     id: n.id,
     title: n.title,
     danger: n.tone === "danger" ? true : undefined,
    })),
   })),
   edges,
   notes: [
    ...sys.cycles
     .slice(0, 5)
     .map((c) => `ciclo: ${c.dirs.join(" ↔ ")} (${c.edgeCount} aristas)`),
    ...sys.violations
     .slice(0, 5)
     .map(
      (v) =>
       `capa: ${v.from} → ${v.to} minoritario (${v.count} vs ${v.dominantCount})`,
     ),
   ],
  },
  {
   id: "hubs",
   title: "Hubs (fan-in)",
   open: false,
   columns: [],
   edges: [],
   notes: tech.data.hubs.map(
    (h) => `${h.file} — fanIn ${h.fanIn} · impacto ${h.blastRadius}`,
   ),
  },
  {
   id: "entryPoints",
   title: "Puntos de entrada",
   open: false,
   columns: [],
   edges: [],
   notes: tech.data.entryPoints.map((p) => `${p.file} — fanOut ${p.fanOut}`),
  },
  {
   id: "risk",
   title: "Riesgo (fanIn × complejidad)",
   open: true,
   columns: [],
   edges: [],
   notes: tech.data.riskHotspots.map(
    (h) =>
     `${h.file} — score ${h.score} (fanIn ${h.fanIn} × complejidad ${h.maxComplexity})`,
   ),
  },
 ];
 if (
  cross?.status === "ready" &&
  Object.keys(cross.data.byDirectory).length > 0
 ) {
  sections.push({
   id: "cross",
   title: "Cruce funcional (M9)",
   open: false,
   columns: [],
   edges: [],
   notes: Object.entries(cross.data.byDirectory)
    .slice(0, tech.limit)
    .map(([dir, sids]) => `${dir}: ${sids.join(" · ")}`),
  });
 }
 const notes: string[] = [];
 if (tech.data.deadWeight.files.length > 0) {
  notes.push(tech.data.deadWeight.disclaimer);
  notes.push(
   ...tech.data.deadWeight.files.map((f) => `sin importadores: ${f.file}`),
  );
 }
 if (cross?.status === "ready" && cross.data.unmatchedModules.length > 0) {
  notes.push(
   `${cross.data.unmatchedModules.length} módulo(s) de la matriz fuera de los subsystems del grafo`,
  );
 }
 return {
  view: "technical",
  generatedAt: new Date().toISOString(),
  title: "Mapa técnico",
  meta: [
   `grafo: ${t.graphBuiltAt || "—"}`,
   `cobertura ${Math.round(t.coverage * 100)}% (${t.filesCovered}/${t.filesTotal} archivos)`,
   t.stale ? "desactualizado" : "",
   t.lowCoverage ? "cobertura baja" : "",
  ].filter(Boolean),
  sections,
  notes,
 };
}
```

#### 6. Wiring host — `src/extension.ts` (MODIFY)

**File**: `src/extension.ts`
**Changes**: Import de `buildExportHtml` + case `export_map` con orden DIÁLOGO→ensamblar→escribir (molde exportUsage :5872-5937 — las lecturas síncronas de PNGs solo ocurren tras confirmar; cancelar es no-op).

```typescript
// ══ Fase 5: export HTML autónomo de la vista activa (FR-9) ══

// (import añadido junto a los demás de ./project-map/*)
import { buildExportHtml } from "./project-map/export-html";

// (nuevo case en handleWebviewMessage, tras el case project_map_shot)

   // M2 (#143) — la webview serializa el layout; el host ensambla el
   // documento e inlina los PNGs faltantes resolviendo screenId → screenshot
   // desde SU inventory cargado (cero confianza en paths del cliente — molde
   // del shot on-demand de la Fase 2). Molde del diálogo: exportUsage
   // (:5872-5937) — DIÁLOGO PRIMERO: cancelar es no-op y el ensamblado
   // (lecturas síncronas de PNGs, techo 4 MB c/u) solo ocurre tras confirmar.
   // El try/catch SIEMPRE responde (toast de éxito/error, nunca silencio).
   case "export_map": {
    void (async () => {
     try {
      const p = msg.payload as {
       view?: unknown;
       sections?: unknown;
      } | null;
      if (
       !p ||
       (p.view !== "functional" && p.view !== "technical") ||
       !Array.isArray(p.sections)
      ) {
       throw new Error("payload de export sin forma esperada");
      }
      const uri = await vscode.window.showSaveDialog({
       defaultUri: vscode.Uri.file(
        `frida-mapa-${new Date().toISOString().slice(0, 10)}.html`,
       ),
       filters: { HTML: ["html"] },
      });
      if (!uri) return; // cancelar = no-op silencioso (molde exportUsage)
      const html = buildExportHtml(msg.payload, {
       resolveShot: (screenId) => {
        const fn = pmState.functional;
        if (fn?.status !== "ready") return undefined;
        const rel =
         fn.data.screens.find((s) => s.id === screenId)?.screenshot ?? "";
        return rel ? readScreenshotDataUri(workspaceCwd(), rel) : undefined;
       },
      });
      await vscode.workspace.fs.writeFile(uri, Buffer.from(html, "utf8"));
      void vscode.window.showInformationMessage(
       "Frida: mapa exportado a " + uri.fsPath,
      );
     } catch (e: any) {
      void vscode.window.showErrorMessage(
       "Frida: no se pudo exportar el mapa — " + String(e?.message ?? e),
      );
     }
    })();
    break;
   }
```

#### 7. Docs de estilos — `docs/webview-ui-styles.md` (MODIFY)

**File**: `docs/webview-ui-styles.md`
**Changes**: Documenta el tab Mapa y las clases `.pm-*` (fence llenado en el slice 5 del diseño — docs del tab completo + regla de cascada veraz según slice-verifier).

```markdown
## Tab "Mapa" del SettingsHub (M2 #143) — `.pm-*`

Tab de visualización (solo lectura) con dos vistas (Funcional/Técnica).
Estilos con prefijo propio `.pm-` (convención per-tab: `.ci-`/`.usage-`/`.prod-`/`.env-`).

- **Shell**: `.pm-tab` (columna, gap 10), `.pm-head` (flex wrap), `.pm-meta`
  (descripciónForeground 11px), `.pm-dot` separador, `.pm-badge`/
  `.pm-badge.partial` (borde + texto charts-yellow).
- **Conmutador**: reusa `.seg-toggle .seg` (SessionsPanel/UsageDashboard) —
  NO es una tab bar nueva.
- **Botones**: Recargar y Exportar reusan `.pc-save` (primario inventariado).
  Botones propios contra la cascada global `button:hover` (0,1,1):
  `.pm-journey-head:hover`, `.pm-expand-all:hover`, `.pm-row:hover` y
  `.pm-cross-chip:hover` declaran el fondo en el propio `:hover` de la clase
  ((0,2,0) > (0,1,1)); el texto lo gana siempre una regla propia — `inherit`
  (`.pm-journey-head`, `.pm-row`), textLink (`.pm-cross-chip`) o
  descriptionForeground→foreground al hover (`.pm-expand-all`) — nunca
  `button` (0,0,1). Sin azul primario inyectado.
  Nota: `.pm-journey-head:hover` originalmente (slice 1) solo declaraba
  `filter: brightness(1.1)` y el `button:hover` global le inyectaba el azul
  primario — corregido como revisión en cascada de una línea en el propio
  slice 5 (ver Design History).
- **Grafo SVG**: `.pm-canvas` (overflow auto, max-height 56vh), `.pm-graph`,
  `.pm-edge`/`.pm-arrow` (textLink), `.pm-node`/`.pm-node-box` (+`.is-danger`
  testing-iconFailed), `.pm-node-id` (mono 9px), `.pm-node-title`,
  `.pm-col-title`, `.pm-shot-pending` (punteado), `.pm-shot-missing`,
  `.pm-shot-label`, focus visible (`:focus .pm-node-box` stroke focusBorder).
- **Journeys**: `.pm-journey` (tarjeta borde panel-border),
  `.pm-journey-head` (botón fila completa), `.pm-journey-title`/
  `.pm-journey-count`, `.pm-journey-body`, `.pm-fails`/`.pm-fail-row`
  (editorWarning).
- **Listas técnicas**: `.pm-list`/`.pm-list-title`, `.pm-row` (+`.is-danger`,
  `.pm-row-dim`), `.pm-row-main` (mono, overflow-wrap anywhere),
  `.pm-row-meta`, `.pm-note`/`.pm-note-list`, `.pm-dead` (<details> sutil).
- **Cruce M9**: `.pm-cross`/`.pm-cross-row`/`.pm-cross-screen`/
  `.pm-cross-chip` (pill mono textLink)/`.pm-cross-note`/`.pm-cross-dir`.
- **Estados**: `.pm-empty` (fila hint+icono), `.pm-orphan-note`.
- **reduced-motion**: media query al final desactiva transiciones de nodos,
  aristas y cabeceras de journey.
- El botón Exportar produce HTML autónomo con paleta FIJA (fuera de VS Code),
  sin clases de este archivo.
```

#### 8. Test de lib host — `test/project-map-lib.test.ts` (MODIFY)

**File**: `test/project-map-lib.test.ts`
**Changes**: Imports de export-html, fixture `EXPORT_FN` y el describe del HTML autónomo (5 its — valida strings del documento; el render JS corre en el navegador al abrir el HTML).

```typescript
// (imports añadidos)
import {
 buildExportHtml,
 escHtml,
 type PmExportPayload,
} from "../src/project-map/export-html";

// (adición al final del archivo)

// ══ Fase 5: export HTML autónomo (molde M8: escHtml + JSON embebido con
//    escape de "</" + render vanilla — el test valida strings del documento,
//    el render JS corre en el navegador al abrir el HTML) ══

const EXPORT_FN: PmExportPayload = {
 view: "functional",
 generatedAt: "2026-08-29T00:00:00.000Z",
 title: "Mapa funcional",
 meta: ["2 journeys · 4 pantallas"],
 sections: [
  {
   id: "J01",
   title: "J01 · P01 → P03",
   open: true,
   columns: [
    { id: "P01", nodes: [{ id: "P01", title: "Login", screenId: "P01" }] },
    {
     id: "P02",
     nodes: [
      {
       id: "P02",
       title: "Dashboard",
       screenId: "P02",
       shot: "data:image/png;base64,QUJD",
      },
     ],
    },
    {
     id: "P03",
     nodes: [{ id: "P03", title: "Filtros", screenId: "P03", shot: "" }] },
   ],
   edges: [{ from: "P01", to: "P02", label: "#2 form: creds" }],
   notes: ["#4 filtro — sin progresión"],
  },
 ],
 notes: ["1 screenId(s) sin pantalla registrada (P99)"],
};

describe("export-html · HTML autónomo (molde M8)", () => {
 it("escHtml escapa &<>\" — nunca datos crudos en el documento", () => {
  expect(escHtml('<b a="x">&</b>')).toBe(
   "&lt;b a=&quot;x&quot;&gt;&amp;&lt;/b&gt;",
  );
 });

 it("documento base: DOCTYPE + charset + JSON embebido + JS vanilla", () => {
  const html = buildExportHtml(EXPORT_FN);
  expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain("var DATA = ");
  expect(html).toContain("createElementNS"); // render vanilla embebido
 });

 it("JSON embebido sin </ crudo (escape split del molde M8)", () => {
  const html = buildExportHtml({
   ...EXPORT_FN,
   title: "</script><b>x",
  });
  expect(html).not.toContain("</script><b>x");
  expect(html).toContain("&lt;/script&gt;"); // escapado en el <title>/h1
 });

 it("inlina el shot cacheado y resuelve el faltante vía resolveShot", () => {
  const html = buildExportHtml(EXPORT_FN, {
   resolveShot: (sid) =>
    sid === "P01" ? "data:image/png;base64,RESUELTO" : "",
  });
  expect(html).toContain("data:image/png;base64,QUJD"); // cacheada viaja
  expect(html).toContain("data:image/png;base64,RESUELTO"); // resuelta inlinada
 });

 it("shot \"\" conservado (sin captura definitiva) y sin mutar el payload", () => {
  const original = JSON.parse(JSON.stringify(EXPORT_FN));
  const html = buildExportHtml(EXPORT_FN, {
   resolveShot: () => "data:image/png;base64,X",
  });
  expect(html).toContain('"shot":""'); // P03 conserva su ""
  expect(EXPORT_FN).toEqual(original); // el payload no se muta
 });

 it("payload técnico → título de vista y notas de listas en el JSON", () => {
  const tech: PmExportPayload = {
   view: "technical",
   generatedAt: "2026-08-29T00:00:00.000Z",
   title: "Mapa técnico",
   meta: ["cobertura 90% (90/100 archivos)"],
   sections: [
    {
     id: "hubs",
     title: "Hubs (fan-in)",
     open: false,
     columns: [],
     edges: [],
     notes: ["src/extension.ts — fanIn 38 · impacto 12"],
    },
   ],
   notes: [],
  };
  const html = buildExportHtml(tech);
  expect(html).toContain("Mapa técnico");
  expect(html).toContain("fanIn 38");
 });
});
```

#### 9. Test de componente — `test/project-map-tab.test.ts` (MODIFY)

**File**: `test/project-map-tab.test.ts`
**Changes**: Describe de los serializadores del export (la mitad webview del seam FR-9; reusa los fixtures locked `fnData`/`techReady`/`crossReady`).

```typescript
// (imports extendidos — serializadores reexportados desde las vistas)
import {
 FunctionalView,
 serializeFunctionalExport,
} from "../webview/components/project-map/FunctionalView";
import {
 TechnicalView,
 serializeTechnicalExport,
} from "../webview/components/project-map/TechnicalView";

// (adición al final del archivo)

// ══ Fase 5: serializadores del export (la mitad webview del seam FR-9;
//    reusan los fixtures locked fnData/techReady/crossReady) ══

describe("serializeFunctionalExport · payload de la vista Funcional", () => {
 it("journey abierto viaja open, fails como notas, shot cacheado inlinado", () => {
  const p = serializeFunctionalExport(
   fnData,
   new Set(["J01"]),
   { P01: "data:image/png;base64,QUJD" },
   crossReady,
  );
  expect(p.view).toBe("functional");
  expect(p.sections[0]?.open).toBe(true);
  expect(p.sections[0]?.notes.join(" ")).toContain("sin progresión");
  const p01 = p.sections[0]?.columns[0]?.nodes[0];
  expect(p01?.screenId).toBe("P01");
  expect(p01?.shot).toBe("data:image/png;base64,QUJD");
 });

 it("pantalla SIN screenshot path → nodo compacto (sin screenId ni shot)", () => {
  const p = serializeFunctionalExport(
   fnData,
   new Set(["J01"]),
   {},
   undefined,
  );
  const p02 = p.sections[0]?.columns[1]?.nodes[0]; // P02 no tiene screenshot
  expect(p02?.screenId).toBeUndefined();
  expect(p02?.shot).toBeUndefined();
 });
});

describe("serializeTechnicalExport · payload de la vista Técnica", () => {
 it("sección de grafo + notas de hubs/riesgo + cruce por directorio", () => {
  const p = serializeTechnicalExport(techReady, crossReady);
  expect(p.view).toBe("technical");
  expect(p.sections[0]?.columns.length).toBeGreaterThan(0);
  expect(p.sections.some((s) => s.id === "hubs")).toBe(true);
  expect(
   p.sections.find((s) => s.id === "risk")?.notes.join(" "),
  ).toContain("score 1140");
  expect(
   p.sections.find((s) => s.id === "cross")?.notes.join(" "),
  ).toContain("P01 · P02");
 });
});
```

**Aterrizaje de la fase terminal**: `npm test` (baseline completo) + `git diff --check` + commit `feat(mapa): export HTML autónomo del mapa del proyecto` con `Refs #143` y rebuild conjunto de `dist-webview/`.

### Success Criteria

#### Automated Verification

- [ ] Typecheck limpio (host + webview): `npm run typecheck`
- [ ] Tests del slice en verde: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts`
- [ ] Baseline completo del proyecto (slice terminal): `npm test`
- [ ] Seam export cableado: `grep -c 'buildExportHtml' src/extension.ts` devuelve ≥ 2 (import + case) y `grep -c '"export_map"' webview/types.ts` devuelve ≥ 1
- [ ] Serializadores conectados al tab: `grep -c 'serializeFunctionalExport\|serializeTechnicalExport' webview/components/ProjectMapTab.tsx` devuelve ≥ 2
- [ ] Escape del JSON embebido congelado por test: los casos "escHtml escapa", "JSON embebido sin </ crudo" e "inlina el shot cacheado y resuelve el faltante" del describe export-html en verde
- [ ] Bundle en el MISMO commit que la fuente: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` en verde
- [ ] Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` vacío

#### Manual Verification

- [ ] Con vista Funcional lista: botón "Exportar" → diálogo con nombre por defecto `frida-mapa-AAAA-MM-DD.html` → guardar → toast con la ruta; el archivo abre en un navegador SIN Frida: journeys como bloques plegables (abiertos los que estaban abiertos), grafo SVG por columnas con aristas bezier y flechas, screenshots inlinados visibles
- [ ] Export de la vista Técnica: grafo de subsystems (directorios con hotspot en rojo) + secciones Hubs/Puntos de entrada/Riesgo/Cruce funcional como notas + deadWeight con disclaimer
- [ ] Pantalla sin captura (o PNG >4 MB / ruta fuera del workspace): el HTML muestra el placeholder "sin captura", sin error en el flujo de export
- [ ] Cancelar el diálogo de guardado: no-op — sin archivo escrito y sin toast de error
- [ ] Sin vista lista (loading/empty/building): botón Exportar deshabilitado

---

## Testing Strategy

### Automated

- Typecheck host + webview: `npm run typecheck` (cada fase).
- Tests del slice: `npx vitest run test/project-map-lib.test.ts test/project-map-tab.test.ts test/webview-store.test.ts` (cada fase).
- Baseline completo (fase terminal): `npm test`.
- Bundle íntegro: `npm run build:webview` + `npx vitest run test/dist-bundle-integrity.test.ts` — commit conjunto fuente+`dist-webview/` en CADA commit que toque `webview/**`.
- Motor congelado: `git diff --stat src/tools/frida-extensible-workflows/core/` vacío (cada fase).
- Seams por grep (ver Automated Verification por fase).

### Manual Testing Steps

1. Smoke del panel (todas las fases): panel angosto (~350 px), temas oscuro y claro, `prefers-reduced-motion`, con y sin `docs/funcional/`, cache fría y caliente de pi-lens (de Verification Notes del diseño; los checks puntuales viven en el Manual Verification de cada fase).
2. Paleta "Frida: Mapa del proyecto" en frío y en caliente (Fase 1).
3. Clic en nodo funcional (PNG vs snapshot) y técnico (fuente) (Fases 2-3).
4. Cache fría de pi-lens: borrar `~/.pi-lens/projects/<slug>/cache/review-graph.json` y observar el re-poll acotado (Fase 3).
5. Repositorio sobre el tope (size-skip): hint verbatim sin avance del contador (Fase 3).
6. Cruce con/sin `docs/api/`, matriz stale, módulos con "./" o absolutos (Fase 4).
7. Export en navegador sin Frida, cancelación del diálogo, placeholder sin captura (Fase 5).

## Performance Considerations

- Colapso por defecto: columnas fuera del DOM (render condicional real, molde `TreePanel.visibleIds`), no CSS hide — cientos de pantallas no bloquean.
- Caps `slice(0,N)` en listas (hubs/entryPoints ya limitados por `options.limit` de pi-lens; UI aplica cap adicional si `entryPointFiles` viene uncapped).
- Screenshots: data-URI on-demand (un solo PNG por expansión), cache en estado del componente; jamás el set completo (+33% base64).
- `projectReport` corre en el host (webview nunca bloquea); import de `lens-engine.js` es one-shot (árbol estático evaluado una vez, sin spawns de LSP al importar).
- Re-poll con backoff acotado (~10 intentos) — sin timers huérfanos (`finally` que limpia SIEMPRE).
- Sin virtualización/`React.memo` (0 precedentes — no introducir).

## Migration Notes

No aplica — M2 no cambia esquemas persistidos; solo lectura de artifacts existentes (M8/M9) y escritura exclusivamente vía diálogo de guardado (`export_map`).

## Plan Review (Step 4)

*Revisión independiente post-finalización por artifact-code-reviewer y artifact-coverage-reviewer contra el código vivo en HEAD (202751d). Hallazgos triaged en Step 5. Tally: 4 blockers, 3 concerns, 1 suggestion.*

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| -------- | ------------------------------- | ------------------ | ---------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| code | Phase 1 §6 (ProjectMapTab.tsx) | &lt;n/a&gt; | blocker | code-quality | El fence publica `<Codicon name={fn.status === "error" ? "warning" : "map" size={16} />` — el cierre `}` falta tras `"map"`, dejando `size={16}` dentro de la expresión JSX de `name` → error de sintaxis; `tsc -p tsconfig.webview.json` y `vite build` fallan en la propia Fase 1 | Cerrar la expresión: `name={fn.status === "error" ? "warning" : "map"} size={16}` (forma que la Fase 3 §3 y el diseño :1384 sí tienen) | applied: typo corregido en Fase 1 §6 (transcripción del plan; el diseño :1384 lo publica bien) |
| code | Phase 2 §2 (FunctionalView.tsx) | &lt;n/a&gt; | blocker | code-quality | `useEffect(() => { requested.current.clear(); }, [data.loadedAt])` con la prop `data: PmFunctionalData`, pero `loadedAt` vive en la variante `ready` de `PmFunctionalState`, no en `PmFunctionalData` → TS2339 "Property 'loadedAt' does not exist" y `npm run typecheck` falla en Fase 2 | Añadir prop `loadedAt: number` a FunctionalView (pasada como `fn.loadedAt` desde ProjectMapTab) y usarla como dep del efecto | applied (plan-local; design follow-up: designs/2026-08-29_00-48-43_m2-panel-mapa-del-proyecto.md — su Architecture usa [data.loadedAt] con PmFunctionalData sin el campo): prop `loadedAt: number` en FunctionalView (Fases 2 §2 y 4 §4), delegaciones `loadedAt={fn.loadedAt}` (Fases 2/3/4/5) y `loadedAt: 1` en renderFn (tests Fases 2 §9 y 4 §10) |
| code | Phase 2 §3 (ProjectMapTab.tsx) | &lt;n/a&gt; | blocker | code-quality | La versión completa de Fase 2 re-publica la misma línea malformada `<Codicon name={fn.status === "error" ? "warning" : "map" size={16} />` — la Fase 2 tampoco compila/typecheck | Aplicar el mismo fix de cierre de expresión que en Phase 1 §6 | applied: typo corregido en Fase 2 §3 (misma causa de transcripción que la fila 1) |
| code | Phase 5 §3 (ProjectMapTab.tsx) | &lt;n/a&gt; | blocker | code-quality | La versión FINAL reintroduce la línea malformada `: "map" size={16}` (Plan:5194) pese a que la Fase 3 la tenía correcta — además falsifica la nota "queda idéntico al fence final del diseño" (design :1384 la publica bien) → la fase terminal y el `npm test`/build de cierre fallan | Corregir el fence final a la forma del diseño (`: "map"} size={16}`) para que Fase 5 compile y el archivo final coincida con el diseño | applied: fence final corregido en Fase 5 §3; nota de identidad ajustada — "idéntico al diseño salvo la prop loadedAt del fix del triage" |
| code | Phase 1 §4 (store.ts) | webview/store.ts:608 | concern | code-quality | `case "project_map_state": return { ...state, projectMap: msg.state }` reemplaza todo `projectMap`, pero el `pmState` del host nunca lleva `shots` → cada push del host (cada Recargar, cada tick del re-poll técnico, cada refresh de cross) borra la cache de data-URIs y obliga a re-pedir los PNGs, contradiciendo el criterio manual de Fase 2 "los screenshots en cache (store) NO se re-piden" | Merge en el reducer: `projectMap: { ...msg.state, shots: state.projectMap?.shots }` | applied (plan-local; design follow-up: ídem diseño — su Architecture hace replace): merge de shots en el reducer (Fase 1 §4) `projectMap: { ...msg.state, shots: state.projectMap?.shots }`; trade-off aceptado en triage — tras un Recargar manual persisten PNGs previos en cache (mismo screenId) |
| code | Phase 3 §9 (test/project-map-tab.test.ts) | &lt;n/a&gt; | concern | actionability | El bloque "(imports añadidos)" agrega `import type { PmTechnicalState, PmFunctionalData, State }` cuando Fase 1 §12 ya importa `PmFunctionalData, State` del mismo módulo — aplicado literal produce duplicate identifier bajo `npm run typecheck` (invisible para vitest/esbuild) | Añadir solo `PmTechnicalState` o publicar la línea de import fusionada completa, como sí hace Fase 4 §10 ("import de tipos extendido") | applied: Fase 3 §9 publica solo la extensión `PmTechnicalState` del import existente (transcripción; la Fase 4 §10 ya publicaba la fusión correcta) |
| coverage | ## Verification Notes §5 | &lt;n/a&gt; | concern | verification-coverage | Note "construyendo… con reloj derivado de `busySince` del host" — las demás piezas de #142 aterrizan (Fase 1/3 Manual nombran "sin spinner eterno"; re-poll acotado congelado por test), pero el sub-mecanismo reloj está sin aterrizar: criteria NOT FOUND y code NOT FOUND — `busySince` se setea en el host y viaja en ambos builds pero NINGÚN componente lo consume (TechnicalView building muestra solo `attempts` n/10; campo escrito-sin-lector) | Consumir `busySince` en la rama `building` del fence de `TechnicalView` (Fase 3 §2: reloj mm:ss derivado del epoch del host) o, si el contador n/10 es la decisión ratificada, añadir a Fase 3 Manual Verification un bullet de progreso temporal derivado de `busySince` | deferred: el contador n/10 es la representación ratificada en el Architecture del diseño (TechnicalView building); `busySince` cumple su rol #111 (estado host que sobrevive re-montes vía re-posteo en webview_ready) sin lector de UI por diseño — consumirlo sería alcance nuevo, no corrección (follow-up opcional) |
| coverage | ## Verification Notes §9 | &lt;n/a&gt; | suggestion | verification-coverage | Note "al cerrar tras verificación, comentario de evidencia con commits (`Refs #143` en cada commit)" — criteria NOT FOUND y code NOT FOUND para las fases 1–4: solo el aterrizaje de Fase 5 especifica "commit … con `Refs #143`"; los commits de las fases 1–4 no llevan mensaje especificado y el paso de comentario de evidencia al cerrar #143 no existe en el plan | Añadir al aterrizaje de Fase 5 (o a Testing Strategy · Manual Testing Steps) el paso de cierre: comentario en el issue #143 con la lista de commits de las 5 fases, y extender la instrucción de commit a cada fase con `Refs #143` en el mensaje | deferred: la instrucción per-commit `Refs #143` y el cierre del issue con comentario de evidencia los gobierna el flujo operativo del repo (AGENTS.md: `/skill:implement` + `/skill:validate`) — la Fase 5 ya lleva `Refs #143` en su aterrizaje; no es contrato del plan |

## Developer Context

Triage Step 5 (2026-08-29, por Edgar F. Fuentes Perea): 8 hallazgos — 5 applied, 2 deferred, 0 dismissed.

- **Design follow-ups pendientes en el diseño padre** (aplicados plan-local vía opción (b) del skill — si se re-ejecuta `/skill:design`, parchear): (1) `FunctionalView` usa `[data.loadedAt]` pero `PmFunctionalData` no lleva `loadedAt` (TS2339) — el plan lo resuelve con prop `loadedAt: number` pasada como `fn.loadedAt`; (2) el reducer `project_map_state` hace replace y borraría la cache de `shots` en cada push del host — el plan usa merge `projectMap: { ...msg.state, shots: state.projectMap?.shots }` (trade-off aceptado: tras Recargar manual persisten PNGs previos, mismo screenId).
- **Deferred §5 (busySince)**: el contador n/10 del estado building es la representación ratificada; `busySince` es estado host #111 sin lector de UI por diseño. Follow-up opcional si se quiere reloj mm:ss.
- **Deferred §9 (Refs #143)**: commits por fase con `Refs #143` y cierre del issue con evidencia los gobierna el flujo operativo (AGENTS.md) durante implement/validate.
- Notas de descomposición: los fences de archivos que evolucionan entre fases (ProjectMapTab, FunctionalView, TechnicalView, types.ts, store.ts, extension.ts, styles.css, tests) se derivaron del estado FINAL del diseño retirando los fragmentos marcados `══ Slice N ══`; las NOTAS DE DESCOMPOSICIÓN en cada fase documentan las derivaciones (p.ej. lista honesta con `.pm-screen-chip` en Fase 1, retirada en Fase 2 — confirmado por el diseño: styles.css "donde estaban los chips", test "pm-screen-chip" ausente sin expandir).

## References

- Design: `.rpiv/artifacts/designs/2026-08-29_00-48-43_m2-panel-mapa-del-proyecto.md`
- Research: `.rpiv/artifacts/research/2026-08-29_00-04-25_m2-panel-mapa-del-proyecto.md`
- FRD: `.rpiv/artifacts/discover/2026-08-28_23-57-41_m2-panel-mapa-del-proyecto.md`
- Issue #143 — "M2: panel Mapa del proyecto" (github.com/efuentesp/frida-code-vsix/issues/143)
- Diseños hermanos: `designs/2026-08-24_15-21-15_app-walkthrough-m8.md`, `designs/2026-08-26_13-25-20_traffic2api-m9.md`
- Contrato pi-lens: `~/.frida/npm/node_modules/pi-lens/dist/clients/lens-engine.js` · `dist/clients/project-report.js:501-567`
