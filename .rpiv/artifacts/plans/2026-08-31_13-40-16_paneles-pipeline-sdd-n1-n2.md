---
date: 2026-08-31T13:40:16-0600
author: Edgar F. Fuentes Perea
commit: d46ed97
branch: main
repository: frida-code
topic: "Paneles de pipeline SDD (N1 planeación + N2 ejecución) con monitor HTML por método"
tags: [plan, frida-workflow, pipeline-panels, features-json, monitor-server, panel-spec, welcome]
status: ready
parent: .rpiv/artifacts/designs/2026-08-31_08-17-40_pipeline-panels-sdd-n1-n2.md
phase_count: 8
phases:
  - { n: 1, title: "Dominio features — tipos y persistencia", files: ["src/tools/frida-workflow/features.ts", "test/frida-workflow/features.test.ts", "src/tools/frida-workflow/index.ts"], depends_on: [] }
  - { n: 2, title: "Reconciler — auto-adopción y vinculación", files: ["src/tools/frida-workflow/features.ts", "test/frida-workflow/features.test.ts"], depends_on: [1] }
  - { n: 3, title: "Acciones — avance temprano y ship N1→N2", files: ["src/tools/frida-workflow/features.ts", "test/frida-workflow/features.test.ts"], depends_on: [1, 2] }
  - { n: 4, title: "Motor declarativo PanelSpec", files: ["src/tools/frida-workflow/panel-spec.ts", "test/frida-workflow/panel-spec.test.ts", "src/tools/frida-workflow/index.ts"], depends_on: [1] }
  - { n: 5, title: "Overlay N1 — /pipeline absorbe el comando", files: ["src/tools/frida-workflow/features-ui.tsx", "webview/styles.css", "src/extension.ts", "src/tools/frida-pipeline/banner.tsx", "src/tools/frida-pipeline/panel.ts", "src/tools/frida-pipeline/index.ts", "test/frida-workflow/pipeline-wiring.test.ts"], depends_on: [1, 2, 3, 4] }
  - { n: 6, title: "Servidor HTTP+SSE + watcher", files: ["src/tools/frida-workflow/monitor-server.ts", "test/frida-workflow/monitor-server.test.ts", "src/extension.ts", "src/tools/frida-workflow/index.ts"], depends_on: [1, 2, 3, 4, 5] }
  - { n: 7, title: "HTML del monitor — hub de métodos + /sdd", files: ["src/tools/frida-workflow/monitor-html.ts", "src/tools/frida-workflow/monitor-server.ts", "src/tools/frida-workflow/index.ts", "test/frida-workflow/monitor-html.test.ts"], depends_on: [6] }
  - { n: 8, title: "Hub Welcome + URL monitor + encadenamiento parent", files: ["webview/components/Welcome.tsx", "webview/types.ts", "webview/store.ts", "webview/App.tsx", "src/extension.ts", "src/tools/frida-pipeline/skills/discover/SKILL.md", "src/tools/frida-pipeline/skills/research/SKILL.md", "src/tools/frida-pipeline/skills/design/SKILL.md", "src/tools/frida-pipeline/skills/plan/SKILL.md", "test/welcome.test.ts"], depends_on: [5, 6] }
last_updated: 2026-08-31T13:40:16-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Plan de implementación: Paneles de pipeline SDD (N1 planeación + N2 ejecución) con monitor HTML por método

## Overview

Implementa el ecosistema de paneles que hace visible la fábrica SDD en dos niveles: overlay `/pipeline` (N1, planeación — features avanzando `discover | research | design | plan | 🚀 ready-to-ship`) movido por el dominio `features.ts` con estado propio `features.json` (auto-adopción de FRDs, patrón atómico de board), unido al board N2 existente por un ship manual; un motor declarativo `PanelSpec` del cual SDD-N1 es la primera configuración; y un servidor HTTP+SSE embebido (puerto efímero 127.0.0.1, token, POST 401) activo en `activate` que sirve un monitor HTML con una página por método (`/sdd` = N1+N2 juntos) y refleja cambios en <1s vía watcher recursivo de `.frida/artifacts/`.

Las 8 fases se heredan 1:1 de los slices del diseño (verificados por slice-verifier): dominio → reconciler → acciones → PanelSpec → overlay → servidor → HTML → Welcome/skills. Diseño fuente: `.rpiv/artifacts/designs/2026-08-31_08-17-40_pipeline-panels-sdd-n1-n2.md`.

## Desired End State

```text
Usuario (VS Code):
  > /pipeline
  ── overlay footer: Pipeline · 5 columnas discover|research|design|plan|🚀 ready-to-ship
     tarjeta: [●●▸○○] pipeline-panels-sdd-n1-n2-html  · botón «Continuar a research →»
     (click ▶) → chat recibe /skill:research .frida/artifacts/discover/2026-…_x.md
              → la tarjeta YA está en research (movimiento temprano)
     tras /skill:plan listo: tarjeta en ready-to-ship, botón «Ship → fases a ejecución»
     (click ship) → /board del plan muestra F01…Fn en backlog, cero ejecución
     tarjeta post-ship: badge «2/7 fases commit» vivo (subscribeBoardChanges)

  Welcome (transcript vacío) → «Desarrollo Autónomo» (submit /pipeline) + «Abrir monitor ↗»

Navegador (http://127.0.0.1:<puerto-efímero>/):
  /  → hub de métodos: [SDD ● activo] [AiDD · próximamente] [TEA · próximamente]
  /sdd → N1 (features en vivo por SSE) + N2 (board espejo) juntos
       · click en tarjeta → detalle: timeline completo + FRD/research/design/plan
         con estado individual + ámbar «desincronizado» si el FS va adelante
       · botones ▶/Ship → POST /api/advance (401 sin token; con token dispara igual
         que el overlay: mismo runCustomCommand)

features.json (multi-escritor, atómico):
  { "v": 1, "features": [ { "id": ".frida/artifacts/discover/2026-…_x.md",
      "stage": "research", "paused": false, "artifacts": {…}, "planPath": "…",
      "history": [ { "to": "discover", "ts": "…", "source": "reconciler" }, … ] } ] }
```

## What We're NOT Doing

Del `Scope → Not Building` del diseño:

- Panel/página AiDD funcional (sólo motor genérico + entrada «próximamente» en hub/Welcome).
- WIP limits en N1/HTML (decisión del FRD).
- Pulso «en ejecución» por runs en N1 (limitación documentada `extractPhaseId` plan-utils.ts:80-97 — fuera de fase 1 del FRD).
- Rediseño del board N2 (sólo hereda badge puente ya existente y espejo en HTML).
- Kanban de tareas manuales libres (#191 — sustituido por este diseño; gestión de issues aparte).
- Watch sobre `.rpiv/` (seed de solo-lectura, se lee en cada reconciliación pero no se vigila).
- Persistencia del dismissal del banner ámbar entre sesiones (memoria de sesión suficiente).
- `order` explícito de features (diferido hasta >5 simultáneas, FRD follow-up).

---

## Phase 1: Dominio features — tipos y persistencia

### Overview

Crea el dominio del pipeline N1: tipos (`PipelineFeature`/`FeaturesFile`), etapas (`PIPELINE_STAGES`/`STAGE_BUCKET`), listeners in-process (`subscribeFeaturesChanges`) y persistencia atómica tmp+rename en `.frida/artifacts/pipeline/features.json` (espejo del patrón board.ts #159), con sus tests de fixture tmp. Este archivo es el estado de verdad que overlay (Fase 5), SSE/HTML (Fases 6-7) consumirán. Las Fases 2 y 3 extienden este mismo archivo con las secciones Reconciler y Acciones (marcadas al final del fence).

### Changes Required

#### 1. Dominio features (sección Etapas/Tipos/Listeners/Persistencia)

**File**: `src/tools/frida-workflow/features.ts`
**Changes**: NEW. Tipos, etapas, listeners espejo board.ts:213-227, persistencia atómica espejo board.ts:233-265 (decisión D1).

Código de la sección Etapas/Tipos/Listeners/Persistencia de `features.ts` (Architecture del diseño). El import de `node:fs` está acotado a los símbolos de esta fase; las Fases 2 y 3 lo extienden (`readdirSync`/`statSync` y el import de `./board`) junto con sus secciones:

```ts
// features.ts — pipeline N1 (planeación): dominio de features SDD.
//
// Espejo del patrón de board.ts (#159/#163): persistencia atómica multi-escritor
// (tmp+rename), listeners in-process para overlays vivos y versionado `v`.
// La unidad es la FEATURE (un FRD); las etapas son las skills del pipeline RPIV
// (discover→research→design→plan) más la columna terminal ready-to-ship, cuyo
// gesto de entrada es el SHIP manual (crea fases en backlog del board N2 — ver
// shipFeature, Slice 3).
//
// Contrato multi-escritor (extension-api.ts:8-16, heredado del board):
// - features.json es el estado de verdad: overlay, SSE y HTML leen SÓLO aquí.
// - Escritores: UI (▶ del overlay), reconciler (auto-adopción de FRDs) y POST
//   autenticado del monitor HTML — todos vía saveFeatures.
// - id canónico = ruta relativa del FRD normalizada (dedup trivial; lección #1
//   del área: la sincronización derivada duplica sin id canónico).
import {
 existsSync,
 mkdirSync,
 readFileSync,
 renameSync,
 writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// ── Etapas ──────────────────────────────────────────────────────────────────

/** Columnas del pipeline N1 en orden de avance (espejo 1:1 de los comandos). */
export const PIPELINE_STAGES = [
 "discover",
 "research",
 "design",
 "plan",
 "ready-to-ship",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Etapa con skill asociada (ready-to-ship es terminal: el gesto es el ship). */
export type SkillStage = Exclude<PipelineStage, "ready-to-ship">;

/** Bucket de artefactos por etapa (raíz .frida/artifacts/<bucket>/). Los skills
 *  bundled escriben en PLURAL (designs/, plans/) — ver research §7. */
export const STAGE_BUCKET: Record<SkillStage, string> = {
 discover: "discover",
 research: "research",
 design: "designs",
 plan: "plans",
};

/** Índice ordinal de la etapa (discover=0 … ready-to-ship=4). */
export function stageIndex(stage: PipelineStage): number {
 return PIPELINE_STAGES.indexOf(stage);
}

/** Etapa siguiente; undefined en ready-to-ship (terminal). */
export function nextStage(stage: PipelineStage): PipelineStage | undefined {
 const i = stageIndex(stage);
 return i >= 0 && i < PIPELINE_STAGES.length - 1
  ? PIPELINE_STAGES[i + 1]
  : undefined;
}

// ── Tipos ───────────────────────────────────────────────────────────────────

/** Movimiento de la feature (historial ligero append-only; NO BoardTransition
 *  completo: failed/regress/blocked/runId no aplican a un pipeline lineal). */
export interface FeatureTransition {
 to: PipelineStage;
 ts: string;
 /** Escritor: "pipeline-ui" (▶ overlay), "reconciler" (auto-adopción),
 *  "monitor" (POST del HTML), "skill" (skills nivel 1 FS-API). */
 source?: string;
}

/** Una feature del pipeline: un FRD avanzando por las etapas de planeación. */
export interface PipelineFeature {
 /** Id canónico: ruta relativa del FRD (`.frida/artifacts/discover/<slug>_<topic>.md`
 *  o `.rpiv/artifacts/discover/…` para el seed histórico). */
 id: string;
 /** Título corto (topic del filename); opcional: la UI deriva del basename. */
 title?: string;
 stage: PipelineStage;
 /** Pausada por el usuario: timeline en ámbar; NO bloquea el avance (FR#14). */
 paused?: boolean;
 /** Artefacto enlazado por etapa (ruta relativa; resuelto por el reconciler). */
 artifacts?: Partial<Record<SkillStage, string>>;
 /** Ruta del plan (token del board N2) — se fija al ship (Slice 3). */
 planPath?: string;
 /** ISO del ship (la tarjeta permanece en ready-to-ship con badge n/m). */
 shippedAt?: string;
 history: FeatureTransition[];
}

/** Estado persistido en `.frida/artifacts/pipeline/features.json`. */
export interface FeaturesFile {
 v: number;
 features: PipelineFeature[];
 updatedAt: string;
 /** Escritor principal (trazabilidad multi-escritor; no excluyente). */
 source?: string;
}

// ── Overlay vivo: listeners (espejo board.ts:213-227) ───────────────────────

const featuresListeners = new Set<() => void>();

/** Suscripción para re-render del overlay /pipeline y broadcast del SSE
 *  cuando features.json cambia (sólo escrituras in-process; las externas
 *  las atrapa el watcher del monitor — monitor-server.ts). */
export function subscribeFeaturesChanges(fn: () => void): () => void {
 featuresListeners.add(fn);
 return () => {
  featuresListeners.delete(fn);
 };
}

function emitFeaturesChange(): void {
 for (const l of [...featuresListeners]) {
  try {
   l();
  } catch {
   /* listener roto: no bloquear a los demás */
  }
 }
}

// ── Persistencia (espejo board.ts:233-265) ──────────────────────────────────

/** `.frida/artifacts/pipeline/features.json` — un solo archivo para TODAS las
 *  features del proyecto (a diferencia de boardFilePath, que es por plan). */
export function featuresFilePath(cwd: string): string {
 return join(cwd, ".frida", "artifacts", "pipeline", "features.json");
}

/** Carga el estado; null si no existe; degrada a vacío si está corrupto
 *  (NFR reliability: el panel arranca vacío sin error). */
export function loadFeatures(cwd: string): FeaturesFile | null {
 const file = featuresFilePath(cwd);
 if (!existsSync(file)) return null;
 try {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as FeaturesFile;
  if (typeof parsed.v !== "number") parsed.v = 1;
  if (!Array.isArray(parsed.features)) parsed.features = [];
  return parsed;
 } catch {
  return null;
 }
}

/** Escritura atómica multi-escritor (tmp PID + rename) + emit del cambio. */
export function saveFeatures(cwd: string, state: FeaturesFile): void {
 const file = featuresFilePath(cwd);
 mkdirSync(dirname(file), { recursive: true });
 state.updatedAt = new Date().toISOString();
 const tmp = `${file}.${process.pid}.tmp`;
 writeFileSync(tmp, JSON.stringify(state, null, "\t") + "\n", "utf8");
 renameSync(tmp, file);
 emitFeaturesChange();
}

/** Busca una feature por id canónico. */
export function findFeature(
 state: FeaturesFile,
 id: string,
): PipelineFeature | undefined {
 return state.features.find((f) => f.id === id);
}

// (La Fase 2 añade aquí la sección ── Reconciler ──; la Fase 3 la sección
//  ── Acciones ── — ver Architecture del diseño.)
```

#### 2. Tests del dominio

**File**: `test/frida-workflow/features.test.ts`
**Changes**: NEW. Fixture tmp + mkdtemp (molde board.test.ts): persistencia atómica, listeners, etapas.

Import acotado a los símbolos de esta fase (crece en Fases 2-3):

```ts
// features.test.ts — dominio del pipeline N1 (features.json).
// Molde: test/frida-workflow/board.test.ts (fixture tmp + mkdtemp; atomicidad).
import {
 existsSync,
 mkdirSync,
 mkdtempSync,
 readdirSync,
 writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
 PIPELINE_STAGES,
 STAGE_BUCKET,
 featuresFilePath,
 findFeature,
 loadFeatures,
 nextStage,
 saveFeatures,
 stageIndex,
 subscribeFeaturesChanges,
 type FeaturesFile,
 type PipelineFeature,
} from "../../src/tools/frida-workflow/features";

let tmp: string;

beforeEach(() => {
 tmp = mkdtempSync(path.join(tmpdir(), "features-test-"));
});

afterEach(() => {
 vi.restoreAllMocks();
});

function sampleFeature(
 overrides: Partial<PipelineFeature> = {},
): PipelineFeature {
 return {
  id: ".frida/artifacts/discover/2026-08-31_07-08-47_mi-feature.md",
  stage: "discover",
  history: [],
  ...overrides,
 };
}

describe("features — persistencia atómica (espejo board)", () => {
 it("loadFeatures devuelve null si features.json no existe", () => {
  expect(loadFeatures(tmp)).toBeNull();
 });

 it("saveFeatures crea el directorio pipeline/ y persiste con v=1", () => {
  const state: FeaturesFile = {
   v: 1,
   features: [sampleFeature()],
   updatedAt: "",
   source: "test",
  };
  saveFeatures(tmp, state);
  const file = featuresFilePath(tmp);
  expect(existsSync(file)).toBe(true);
  const round = loadFeatures(tmp);
  expect(round).not.toBeNull();
  expect(round!.v).toBe(1);
  expect(round!.features).toHaveLength(1);
  expect(round!.features[0]!.id).toBe(sampleFeature().id);
  expect(round!.updatedAt).not.toBe("");
 });

 it("saveFeatures no deja archivos .tmp huérfanos", () => {
  const state: FeaturesFile = { v: 1, features: [], updatedAt: "" };
  saveFeatures(tmp, state);
  saveFeatures(tmp, state);
  const dir = path.dirname(featuresFilePath(tmp));
  const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  expect(leftovers).toEqual([]);
 });

 it("loadFeatures degrada a vacío ante JSON corrupto (NFR reliability)", () => {
  const file = featuresFilePath(tmp);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "{ esto no es json", "utf8");
  expect(loadFeatures(tmp)).toBeNull();
 });

 it("loadFeatures normaliza v ausente y features no-array", () => {
  const file = featuresFilePath(tmp);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ features: {} }), "utf8");
  const loaded = loadFeatures(tmp);
  expect(loaded).not.toBeNull();
  expect(loaded!.v).toBe(1);
  expect(loaded!.features).toEqual([]);
 });

 it("findFeature resuelve por id canónico", () => {
  const state: FeaturesFile = {
   v: 1,
   features: [sampleFeature()],
   updatedAt: "",
  };
  expect(findFeature(state, sampleFeature().id)?.stage).toBe("discover");
  expect(findFeature(state, "otra")).toBeUndefined();
 });
});

describe("features — listeners (overlay vivo)", () => {
 it("saveFeatures emite el cambio a los suscritos", () => {
  const fn = vi.fn();
  const off = subscribeFeaturesChanges(fn);
  saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
  expect(fn).toHaveBeenCalledTimes(1);
  off();
  saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
  expect(fn).toHaveBeenCalledTimes(1); // desuscrito: no vuelve a disparar
 });

 it("un listener que lanza no bloquea a los demás", () => {
  const broken = vi.fn(() => {
   throw new Error("roto");
  });
  const ok = vi.fn();
  subscribeFeaturesChanges(broken);
  const off = subscribeFeaturesChanges(ok);
  saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
  expect(ok).toHaveBeenCalledTimes(1);
  off();
 });
});

describe("features — etapas", () => {
 it("PIPELINE_STAGES tiene las 5 columnas del FRD en orden", () => {
  expect([...PIPELINE_STAGES]).toEqual([
   "discover",
   "research",
   "design",
   "plan",
   "ready-to-ship",
  ]);
 });

 it("STAGE_BUCKET mapea a los buckets plurales de los skills bundled", () => {
  expect(STAGE_BUCKET).toEqual({
   discover: "discover",
   research: "research",
   design: "designs",
   plan: "plans",
  });
 });

 it("nextStage avanza y termina en ready-to-ship", () => {
  expect(nextStage("discover")).toBe("research");
  expect(nextStage("research")).toBe("design");
  expect(nextStage("design")).toBe("plan");
  expect(nextStage("plan")).toBe("ready-to-ship");
  expect(nextStage("ready-to-ship")).toBeUndefined();
  expect(stageIndex("ready-to-ship")).toBe(4);
 });
});
```

#### 3. Reexports para el bundle DSL y el host

**File**: `src/tools/frida-workflow/index.ts`
**Changes**: MODIFY. Añade el bloque de reexports de features (crece en Fases 4/6/7).

```ts
// Pipeline N1 (features.json) — dominio de planeación espejo del board (#159).
export {
 PIPELINE_STAGES,
 STAGE_BUCKET,
 featuresFilePath,
 findFeature,
 loadFeatures,
 saveFeatures,
 stageIndex,
 nextStage,
 subscribeFeaturesChanges,
} from "./features";
export type {
 PipelineFeature,
 PipelineStage,
 SkillStage,
 FeatureTransition,
 FeaturesFile,
} from "./features";
```

### Success Criteria

#### Automated Verification

- [x] Tests del dominio pasan: `npx vitest run test/frida-workflow/features.test.ts`
- [x] Typecheck del proyecto verde: `npm run typecheck`
- [x] `grep -c "renameSync" src/tools/frida-workflow/features.ts` retorna >= 1 (patrón tmp+rename heredado del board)
- [x] `grep -n "export function subscribeFeaturesChanges" src/tools/frida-workflow/features.ts` retorna una línea (listeners espejo board.ts:213)

#### Manual Verification

- [x] En un workspace sin `.frida/`, `loadFeatures(cwd)` no lanza y devuelve null (NFR arranque vacío — cubierto por test unitario a nivel dominio)

---

## Phase 2: Reconciler — auto-adopción y vinculación

### Overview

Añade el reconciler al dominio: escaneo fresco por mtime de los buckets de planeación en las dos raíces (`.frida/` primaria, `.rpiv/` seed histórico de solo-lectura — decisión D2/checkpoint research), vinculación híbrida `parent` + fallback topic (D6), auto-adopción persistente de FRDs nuevos (D4/FR#3) y reporte de desincronización para el ámbar FR#12. Idempotente: re-scan idéntico no duplica ni re-escribe (lección #1 del área: id canónico + dedup).

### Changes Required

#### 1. Sección Reconciler

**File**: `src/tools/frida-workflow/features.ts`
**Changes**: MODIFY. Añade la sección `── Reconciler ──` tras `findFeature`; añade `readdirSync`/`statSync` al import de `node:fs`.

Import de `node:fs` tras la Fase 2 (añade `readdirSync`/`statSync`):

```ts
import {
 existsSync,
 mkdirSync,
 readFileSync,
 readdirSync,
 renameSync,
 statSync,
 writeFileSync,
} from "node:fs";
```

Sección nueva tras `findFeature`:

```ts
// ── Reconciler: FS ↔ features.json (FR#3/FR#12; decisiones D4/D6) ──────────

/** Raíces escaneadas por el reconciler. Orden = prioridad: `.frida/` es la
 *  raíz primaria donde escriben los skills bundled; `.rpiv/` es el seed
 *  histórico de solo-lectura (se lee en cada reconciliación; NO se vigila). */
export const PIPELINE_ROOTS = [".frida/artifacts", ".rpiv/artifacts"] as const;

/** `<slug-de-fecha>_<topic>.md` — el slug admite fecha sola (seed histórico,
 *  p. ej. 2025-07-31_porte.md) o fecha+hora (skills actuales). */
const TOPIC_RE = /^\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?_(.+)\.md$/;

/** Artefacto .md escaneado del FS (lectura FRESCA por mtime en cada pase —
 *  molde readFreshVerdict sdd-factory.ts:84; nunca un snapshot, #174). */
export interface ScannedArtifact {
 /** Ruta relativa normalizada (separador `/`): id del FRD / valor de link. */
 rel: string;
 /** Segmento del filename tras el slug de fecha (fallback de vinculación). */
 topic: string | undefined;
 /** Frontmatter `parent` (ruta relativa del upstream; comillas stripped). */
 parent: string | undefined;
 mtimeMs: number;
}

/** Mapa etapa → ruta del artefacto enlazado (el FRD es la propia feature). */
export type StageArtifacts = Partial<Record<SkillStage, string>>;

/** Frontmatter plano del head YAML: pares `key: value` (split("---")[1] +
 *  regex por línea — molde readFreshVerdict, sin parser YAML completo).
 *  Tolerante: archivo ilegible o sin frontmatter ⇒ objeto vacío. */
function readFrontmatter(file: string): Record<string, string> {
 try {
  const head = readFileSync(file, "utf8").split("---")[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of head.split("\n")) {
   const m = line.match(/^([\w-]+):\s*(.*)$/);
   if (!m) continue;
   out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "").replace(/^\.\//, "");
  }
  return out;
 } catch {
  return {};
 }
}

/** Escanea un bucket en TODAS las raíces (readdir + statSync por mtime;
 *  bucket inexistente en una raíz es normal y se salta). */
function scanBucket(cwd: string, bucket: string): ScannedArtifact[] {
 const out: ScannedArtifact[] = [];
 for (const root of PIPELINE_ROOTS) {
  const dir = join(cwd, root, bucket);
  let files: string[];
  try {
   files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
   continue;
  }
  for (const f of files) {
   const abs = join(dir, f);
   try {
    out.push({
     rel: `${root}/${bucket}/${f}`,
     topic: f.match(TOPIC_RE)?.[1],
     parent: readFrontmatter(abs).parent,
     mtimeMs: statSync(abs).mtimeMs,
    });
   } catch {
    continue; // TOCTOU: el .md desapareció entre readdir y stat (tmp+rename)
   }
  }
 }
 return out;
}

/** Instantánea fresca de los buckets de planeación. */
export interface PipelineScan {
 frds: ScannedArtifact[];
 byStage: Record<SkillStage, ScannedArtifact[]>;
}

/** Escanea discover/research/designs/plans en las raíces del pipeline. */
export function scanPipeline(cwd: string): PipelineScan {
 const byStage = {} as Record<SkillStage, ScannedArtifact[]>;
 for (const stage of Object.keys(STAGE_BUCKET) as SkillStage[]) {
  byStage[stage] = scanBucket(cwd, STAGE_BUCKET[stage]);
 }
 return { frds: byStage.discover, byStage };
}

/** Vinculación híbrida (D6): parent explícito primero; fallback por topic del
 *  filename; entre candidatos empatados gana el mtime más reciente. */
function pickArtifact(
 candidates: ScannedArtifact[],
 parent: string | undefined,
 topic: string | undefined,
): ScannedArtifact | undefined {
 const byParent = parent
  ? candidates.filter((c) => c.parent === parent)
  : [];
 const pool = byParent.length
  ? byParent
  : topic
   ? candidates.filter((c) => c.topic === topic)
   : [];
 return [...pool].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

/** Resuelve la cadena FRD → research → design → plan de una feature:
 *  cada etapa enlaza por parent contra el artefacto resuelto de la etapa
 *  previa (el parent del design apunta al research, etc.); sin upstream
 *  resuelto cae al fallback por topic. */
export function linkArtifacts(
 scan: PipelineScan,
 frd: ScannedArtifact,
): StageArtifacts {
 const research = pickArtifact(scan.byStage.research, frd.rel, frd.topic);
 const design = pickArtifact(scan.byStage.design, research?.rel, frd.topic);
 const plan = pickArtifact(scan.byStage.plan, design?.rel, frd.topic);
 const out: StageArtifacts = {};
 if (research) out.research = research.rel;
 if (design) out.design = design.rel;
 if (plan) out.plan = plan.rel;
 return out;
}

/** Etapa respaldada por el FS: el artefacto enlazado más avanzado (por
 *  EXISTENCIA, no por status del enum — research §7). Techo "plan":
 *  ready-to-ship sólo se alcanza por el ship manual (FR#5). */
export function deriveStageFromArtifacts(
 artifacts: StageArtifacts,
): SkillStage {
 if (artifacts.plan) return "plan";
 if (artifacts.design) return "design";
 if (artifacts.research) return "research";
 return "discover";
}

/** Reconciliación de UNA feature (FR#12: insumo del ámbar «desincronizado»). */
export interface FeatureReconcile {
 id: string;
 /** Etapa que el FS respalda; undefined si el FRD desapareció. */
 derivedStage: PipelineStage | undefined;
 /** true si el FS va MÁS adelante que features.json. El early-move (tarjeta
  *  por delante del artefacto pendiente) NO cuenta como desync. */
 desync: boolean;
}

function buildReport(
 state: FeaturesFile,
 scan: PipelineScan,
): FeatureReconcile[] {
 return state.features.map((f) => {
  const frd = scan.frds.find((a) => a.rel === f.id);
  if (!frd) return { id: f.id, derivedStage: undefined, desync: false };
  const derived = deriveStageFromArtifacts(linkArtifacts(scan, frd));
  return {
   id: f.id,
   derivedStage: derived,
   desync: stageIndex(derived) > stageIndex(f.stage),
  };
 });
}

/** Reporte de reconciliación SIN efectos (cero escrituras): lo consumen el
 *  snapshot del monitor (Slice 6/7) y la UI (Slice 5) para pintar el ámbar
 *  sin adoptar nada. */
export function computeFeatureReconcile(cwd: string): FeatureReconcile[] {
 const scan = scanPipeline(cwd);
 const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
 return buildReport(state, scan);
}

/** Resultado de un pase del reconciler con efectos. */
export interface ReconcileResult {
 /** FRDs adoptados como features nuevas en este pase (FR#3). */
 adopted: string[];
 /** Features cuyo mapa `artifacts` cambió (FR#16: detalle HTML vivo). */
 relinked: string[];
 /** true si hubo adopción/relink ⇒ saveFeatures ya corrió. */
 changed: boolean;
 /** Reporte por feature tras el pase (mismo shape que compute). */
 report: FeatureReconcile[];
}

/** Pase del reconciler (D4: auto-adopción persistente). Adopta FRDs nuevos
 *  con la etapa DERIVADA de sus artefactos encadenados (Migration Notes: la
 *  etapa refleja el más avanzado con artefacto), re-vincula artefactos y
 *  reporta desync. NO adelanta stages de features existentes: ese hueco lo
 *  pinta el ámbar (FR#12) y el avance lo dispara el ▶ (Slice 3).
 *  Idempotente: sin cambios no escribe (lección #1: re-scan no duplica). */
export function reconcileFeatures(cwd: string): ReconcileResult {
 const scan = scanPipeline(cwd);
 const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
 const adopted: string[] = [];
 const relinked: string[] = [];
 const now = new Date().toISOString();

 // 1) Auto-adopción (FR#3): FRD sin feature ⇒ tarjeta con etapa derivada.
 for (const frd of scan.frds) {
  if (findFeature(state, frd.rel)) continue;
  const artifacts = linkArtifacts(scan, frd);
  const stage = deriveStageFromArtifacts(artifacts);
  state.features.push({
   id: frd.rel,
   title: frd.topic,
   stage,
   artifacts,
   history: [{ to: stage, ts: now, source: "reconciler" }],
  });
  adopted.push(frd.rel);
 }

 // 2) Re-vinculación: el mapa artifacts refleja el FS (histórico auditable:
 //    la feature sobrevive aunque el FRD desaparezca).
 for (const f of state.features) {
  const frd = scan.frds.find((a) => a.rel === f.id);
  if (!frd) continue;
  const artifacts = linkArtifacts(scan, frd);
  const unchanged = (["research", "design", "plan"] as const).every(
   (k) => f.artifacts?.[k] === artifacts[k],
  );
  if (!unchanged) {
   f.artifacts = artifacts;
   relinked.push(f.id);
  }
 }

 if (adopted.length > 0 || relinked.length > 0) {
  state.source = "reconciler";
  saveFeatures(cwd, state);
 }

 return {
  adopted,
  relinked,
  changed: adopted.length > 0 || relinked.length > 0,
  report: buildReport(state, scan),
 };
}

// (La Fase 3 añade aquí la sección ── Acciones ──.)
```

#### 2. Tests del reconciler

**File**: `test/frida-workflow/features.test.ts`
**Changes**: MODIFY. Añade helpers `writeArtifact`/`setMtime`, la constante `FRD` y los tres describes de reconciler; añade `rmSync`/`utimesSync` al import de `node:fs` y `computeFeatureReconcile`/`reconcileFeatures` al import de features.

Deltas de imports — `node:fs` añade `rmSync`/`utimesSync`; el import de features añade `computeFeatureReconcile`/`reconcileFeatures`:

```ts
import {
 existsSync,
 mkdirSync,
 mkdtempSync,
 readdirSync,
 rmSync,
 utimesSync,
 writeFileSync,
} from "node:fs";
```

Adiciones al cuerpo del test (helpers + FRD + tres describes):

```ts
// ── Reconciler (Slice 2) ────────────────────────────────────────────────────

/** Escribe un artefacto .md con frontmatter bajo tmp (ruta relativa con `/`). */
function writeArtifact(
 rel: string,
 frontmatter: Record<string, string> = {},
): string {
 const abs = path.join(tmp, ...rel.split("/"));
 mkdirSync(path.dirname(abs), { recursive: true });
 const fm = Object.entries(frontmatter)
  .map(([k, v]) => `${k}: ${v}`)
  .join("\n");
 writeFileSync(abs, `---\n${fm}\n---\n\n# doc\n`, "utf8");
 return abs;
}

/** Fuerza el mtime (orden determinista entre candidatos). */
function setMtime(abs: string, ms: number): void {
 const d = new Date(ms);
 utimesSync(abs, d, d);
}

const FRD = ".frida/artifacts/discover/2026-01-01_10-00-00_mi-feature.md";

describe("reconciler — auto-adopción (FR#3/D4)", () => {
 it("adopta un FRD nuevo como feature en discover con source reconciler", () => {
  writeArtifact(FRD, { status: "ready" });
  const r = reconcileFeatures(tmp);
  expect(r.adopted).toEqual([FRD]);
  const state = loadFeatures(tmp)!;
  expect(state.features).toHaveLength(1);
  expect(state.features[0]!.stage).toBe("discover");
  expect(state.features[0]!.title).toBe("mi-feature");
  expect(state.features[0]!.history).toEqual([
   { to: "discover", ts: expect.any(String), source: "reconciler" },
  ]);
  expect(state.source).toBe("reconciler");
 });

 it("adopta FRDs del seed .rpiv (slug de fecha sola) con id de la raíz", () => {
  const seed = ".rpiv/artifacts/discover/2025-07-31_porte-rpiv.md";
  writeArtifact(seed, { status: "ready" });
  const r = reconcileFeatures(tmp);
  expect(r.adopted).toEqual([seed]);
  expect(loadFeatures(tmp)!.features[0]!.title).toBe("porte-rpiv");
 });

 it("workspace vacío: no escribe features.json y changed=false (NFR arranque)", () => {
  const r = reconcileFeatures(tmp);
  expect(r.changed).toBe(false);
  expect(existsSync(featuresFilePath(tmp))).toBe(false);
 });

 it("re-scan idéntico no duplica ni re-escribe (lección #1: dedup por id)", () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  const r2 = reconcileFeatures(tmp);
  expect(r2.adopted).toEqual([]);
  expect(r2.changed).toBe(false);
  const state = loadFeatures(tmp)!;
  expect(state.features).toHaveLength(1);
  expect(state.features[0]!.history).toHaveLength(1);
 });

 it("md sin frontmatter no rompe el escaneo (parent undefined, topic del nombre)", () => {
  const abs = path.join(tmp, ...FRD.split("/"));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "sin frontmatter\n", "utf8");
  expect(() => reconcileFeatures(tmp)).not.toThrow();
  expect(loadFeatures(tmp)!.features[0]!.title).toBe("mi-feature");
 });
});

describe("reconciler — vinculación híbrida parent+topic (D6)", () => {
 it("encadena por parent explícito (research ← frd; design ← research)", () => {
  const RESEARCH = ".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
  const DESIGN = ".frida/artifacts/designs/2026-01-03_10-00-00_mi-feature.md";
  writeArtifact(FRD);
  writeArtifact(RESEARCH, { parent: FRD });
  // parent con comillas estilo YAML: el parser las pela
  writeArtifact(DESIGN, { parent: `"${RESEARCH}"` });
  reconcileFeatures(tmp);
  const f = loadFeatures(tmp)!.features[0]!;
  expect(f.stage).toBe("design"); // adopción: etapa derivada del más avanzado
  expect(f.artifacts).toEqual({ research: RESEARCH, design: DESIGN });
 });

 it("fallback por topic cuando no hay parent (seed histórico)", () => {
  const RESEARCH = ".rpiv/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
  writeArtifact(FRD);
  writeArtifact(RESEARCH); // sin parent
  reconcileFeatures(tmp);
  expect(loadFeatures(tmp)!.features[0]!.artifacts?.research).toBe(RESEARCH);
 });

 it("topic distinto no vincula (sin colisiones del fallback)", () => {
  writeArtifact(FRD);
  writeArtifact(".frida/artifacts/research/2026-01-02_10-00-00_otra-cosa.md");
  reconcileFeatures(tmp);
  expect(
   loadFeatures(tmp)!.features[0]!.artifacts?.research,
  ).toBeUndefined();
 });

 it("entre candidatos empatados gana el mtime más reciente", () => {
  writeArtifact(FRD);
  const a = writeArtifact(
   ".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md",
   { parent: FRD },
  );
  const b = writeArtifact(
   ".frida/artifacts/research/2026-01-02_11-00-00_mi-feature.md",
   { parent: FRD },
  );
  setMtime(a, 1_000);
  setMtime(b, 2_000);
  reconcileFeatures(tmp);
  expect(loadFeatures(tmp)!.features[0]!.artifacts?.research).toContain(
   "11-00-00",
  );
 });

 it("cadena completa frd→research→design→plan adopta en plan (techo manual)", () => {
  const RESEARCH = ".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
  const DESIGN = ".frida/artifacts/designs/2026-01-03_10-00-00_mi-feature.md";
  const PLAN = ".frida/artifacts/plans/2026-01-04_10-00-00_mi-feature.md";
  writeArtifact(FRD);
  writeArtifact(RESEARCH, { parent: FRD });
  writeArtifact(DESIGN, { parent: RESEARCH });
  writeArtifact(PLAN, { parent: DESIGN, phase_count: "8" });
  reconcileFeatures(tmp);
  const f = loadFeatures(tmp)!.features[0]!;
  expect(f.stage).toBe("plan");
  expect(f.artifacts?.plan).toBe(PLAN);
 });
});

describe("reconciler — desync y relink (FR#12)", () => {
 it("desync true cuando el FS va más adelante que features.json", () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp); // adopta en discover
  writeArtifact(".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md", {
   parent: FRD,
  });
  expect(computeFeatureReconcile(tmp)).toEqual([
   { id: FRD, derivedStage: "research", desync: true },
  ]);
 });

 it("computeFeatureReconcile es puro: cero escrituras (snapshot del monitor)", () => {
  writeArtifact(FRD);
  computeFeatureReconcile(tmp);
  expect(existsSync(featuresFilePath(tmp))).toBe(false);
 });

 it("early-move (etapa por delante del artefacto) NO es desync", () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  const state = loadFeatures(tmp)!;
  state.features[0]!.stage = "research"; // simula el ▶ (Slice 3)
  saveFeatures(tmp, state);
  expect(computeFeatureReconcile(tmp)[0]!.desync).toBe(false);
 });

 it("relink actualiza artifacts sin adelantar la etapa, y es idempotente", () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  writeArtifact(".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md", {
   parent: FRD,
  });
  const r1 = reconcileFeatures(tmp);
  expect(r1.relinked).toEqual([FRD]);
  const f1 = loadFeatures(tmp)!.features[0]!;
  expect(f1.artifacts?.research).toBeDefined();
  expect(f1.stage).toBe("discover"); // relink NO adelanta
  expect(r1.report[0]!.desync).toBe(true); // el ámbar cubre el hueco
  const r2 = reconcileFeatures(tmp);
  expect(r2.relinked).toEqual([]);
  expect(r2.changed).toBe(false);
 });

 it("feature en ready-to-ship nunca marca desync (ship manual, FR#5)", () => {
  writeArtifact(FRD);
  writeArtifact(".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md", {
   parent: FRD,
  });
  reconcileFeatures(tmp);
  const state = loadFeatures(tmp)!;
  state.features[0]!.stage = "ready-to-ship";
  saveFeatures(tmp, state);
  expect(computeFeatureReconcile(tmp)[0]!.desync).toBe(false);
 });

 it("FRD desaparecido: la feature sobrevive sin desync (histórico)", () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  rmSync(path.join(tmp, ...FRD.split("/")));
  expect(computeFeatureReconcile(tmp)).toEqual([
   { id: FRD, derivedStage: undefined, desync: false },
  ]);
 });
});
```

### Success Criteria

#### Automated Verification

- [ ] Tests del dominio + reconciler pasan: `npx vitest run test/frida-workflow/features.test.ts`
- [ ] Typecheck del proyecto verde: `npm run typecheck`
- [ ] `grep -n "export function reconcileFeatures" src/tools/frida-workflow/features.ts` retorna una línea (pase con efectos, D4)
- [ ] `grep -c "desync" src/tools/frida-workflow/features.ts` retorna >= 3 (FR#12: campo + cálculo + doc)
- [ ] `grep -n "re-scan idéntico no duplica" test/frida-workflow/features.test.ts` retorna una línea (lección #1 de Verification Notes)

#### Manual Verification

- [ ] En scratch contra este workspace real, `reconcileFeatures(cwd)` adopta los FRDs del seed `.rpiv/artifacts/discover/` sin duplicar en un segundo pase, y el FRD `2026-08-31_07-08-47_pipeline-panels-sdd-n1-n2-html.md` queda en etapa `design` (research por topic, design por `parent:`)

---

## Phase 3: Acciones — avance temprano y ship N1→N2

### Overview

Añade las acciones del dominio: `advanceFeature` (movimiento temprano FR#4 — escribe la etapa al clic y computa el comando `/skill:<etapa> <frd>` ANTES del movimiento), `shipFeature` (FR#5 — fases `## FN` del plan como unidades backlog del board N2 vía `openBoard`→`saveBoard`, espejo del escalón `/board` extension.ts:5115-5123, cero ejecución), `setFeaturePaused` (FR#11) y `shipBadge` (badge n/m fases FR#6 con `isUnitDone`).

### Changes Required

#### 1. Sección Acciones

**File**: `src/tools/frida-workflow/features.ts`
**Changes**: MODIFY. Añade la sección `── Acciones ──` al final; añade el import `import { isUnitDone, loadBoard, openBoard, saveBoard } from "./board";`.

Import nuevo junto a los existentes (fase 3):

```ts
import { isUnitDone, loadBoard, openBoard, saveBoard } from "./board";
```

Sección nueva al final del archivo:

```ts
// ── Acciones: ▶ del overlay y POST del monitor (FR#4/FR#5/FR#6/FR#11/FR#14) ─

/** Resultado de advanceFeature. */
export interface AdvanceResult {
 /** false: feature inexistente, etapa plan (el gesto terminal es el ship) o
  *  ya en ready-to-ship. */
 moved: boolean;
 /** FR#14: el INSUMO de la etapa actual existía en el FS. Sólo informativo —
  *  el movimiento NUNCA se bloquea (advertencia, no bloqueo). */
 prerequisitesMet: boolean;
 /** Etapa destino efectiva. */
 to?: PipelineStage;
 /** Comando que el handler inyecta al chat para ESTE avance (FR#4), computado
  *  del stage ANTES del movimiento: `/skill:<etapa-destino> <frd>`. El handler
  *  NO debe recomputarlo sobre `feature` (ya movida: daría la etapa siguiente
  *  equivocada — footgun de la auditoría 1, cerrada por diseño). */
 command?: string;
 /** Feature tras el intento (refrescada también cuando moved=false). */
 feature?: PipelineFeature;
}

/** Insumo que la etapa siguiente consume (FR#14): el FRD en discover y el
 *  artefacto enlazado de la etapa actual en las demás. */
function stageInput(f: PipelineFeature): string | undefined {
 switch (f.stage) {
  case "discover":
   return f.id;
  case "research":
   return f.artifacts?.research;
  case "design":
   return f.artifacts?.design;
  case "plan":
   return f.artifacts?.plan;
  default:
   return undefined; // ready-to-ship: terminal
 }
}

/** Movimiento temprano (FR#4): el handler del ▶ llama esto AL MOMENTO DEL
 *  clic y luego inyecta `result.command` al chat — el comando llega computado
 *  (etapa destino correcta) sin importar que la feature ya esté movida.
 *  Idempotente en los extremos; registra history con el escritor. */
export function advanceFeature(
 cwd: string,
 id: string,
 source = "pipeline-ui",
): AdvanceResult {
 const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
 const f = findFeature(state, id);
 if (!f) return { moved: false, prerequisitesMet: false };
 const input = stageInput(f);
 const prerequisitesMet = !!input && existsSync(join(cwd, input));
 const target = nextStage(f.stage);
 // plan → ready-to-ship NO es advance: es el ship manual (FR#5).
 if (!target || f.stage === "plan") {
  return { moved: false, prerequisitesMet, feature: f };
 }
 const command = `/skill:${target} ${f.id}`;
 f.stage = target;
 const ts = new Date().toISOString();
 f.history.push({ to: target, ts, source });
 state.source = source;
 saveFeatures(cwd, state);
 return { moved: true, prerequisitesMet, to: target, command, feature: f };
}

/** Comando del ▶ para una feature SIN moverla (FR#4/FR#13): la UI lo usa para
 *  rotular el botón («Continuar a research →») antes del clic. undefined en
 *  plan (el gesto es el ship) y en ready-to-ship. */
export function featureAdvanceCommand(f: PipelineFeature): string | undefined {
 const target = nextStage(f.stage);
 if (!target || target === "ready-to-ship") return undefined;
 return `/skill:${target} ${f.id}`;
}

/** Motivo de un ship sin efecto. */
export type ShipFailure = "missing" | "no-plan" | "already-shipped";

/** Resultado de shipFeature. */
export interface ShipResult {
 moved: boolean;
 failure?: ShipFailure;
 /** Token del plan (board N2) fijado en la feature. */
 planPath?: string;
 /** Fases raíz del plan ahora en backlog del board N2 (FR#5: SIN ejecución). */
 phaseCount: number;
 feature?: PipelineFeature;
}

/** Ship manual N1→N2 (FR#5/FR#13): replica el flujo exacto del escalón /board
 *  (mountBoardOverlay: openBoard → saveBoard) — las fases `## FN` del plan
 *  nacen como unidades en backlog con CERO transiciones, y la tarjeta pasa a
 *  ready-to-ship con planPath+shippedAt (el badge n/m vive en shipBadge
 *  consultando ese board). Idempotente: re-ship no duplica nada. */
export function shipFeature(
 cwd: string,
 id: string,
 source = "pipeline-ui",
): ShipResult {
 const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
 const f = findFeature(state, id);
 if (!f) return { moved: false, failure: "missing", phaseCount: 0 };
 if (f.stage === "ready-to-ship") {
  return {
   moved: false,
   failure: "already-shipped",
   planPath: f.planPath,
   phaseCount: 0,
   feature: f,
  };
 }
 const planRel = f.artifacts?.plan;
 if (!planRel || !existsSync(join(cwd, planRel))) {
  return { moved: false, failure: "no-plan", phaseCount: 0, feature: f };
 }
 const planContent = readFileSync(join(cwd, planRel), "utf8");
 const board = openBoard(cwd, planRel, planContent);
 saveBoard(cwd, planRel, board);
 const ts = new Date().toISOString();
 f.stage = "ready-to-ship";
 f.planPath = planRel;
 f.shippedAt = ts;
 f.history.push({ to: "ready-to-ship", ts, source });
 state.source = source;
 saveFeatures(cwd, state);
 return {
  moved: true,
  planPath: planRel,
  phaseCount: board.units.filter((u) => u.parentId === undefined).length,
  feature: f,
 };
}

/** Pausa/reanuda una feature (FR#11 punto ámbar; FR#14: NO bloquea el
 *  avance — es una señal visual persistida). */
export function setFeaturePaused(
 cwd: string,
 id: string,
 paused: boolean,
 source = "monitor",
): PipelineFeature | undefined {
 const state = loadFeatures(cwd);
 if (!state) return undefined;
 const f = findFeature(state, id);
 if (!f) return undefined;
 f.paused = paused;
 state.source = source;
 saveFeatures(cwd, state);
 return f;
}

/** Badge «n/m fases commit» post-ship (FR#6): n = fases raíz done del board
 *  N2 (isUnitDone resuelve la jerarquía de splits), m = total de raíces. Se
 *  consulta FRESCO en cada render — el overlay reacciona vía
 *  subscribeBoardChanges (el board emite en cada transición del run). */
export interface ShipBadge {
 done: number;
 total: number;
}

export function shipBadge(
 cwd: string,
 feature: PipelineFeature,
): ShipBadge | undefined {
 if (!feature.planPath) return undefined;
 const board = loadBoard(cwd, feature.planPath);
 if (!board || board.units.length === 0) return undefined;
 const roots = board.units.filter((u) => u.parentId === undefined);
 const pool = roots.length > 0 ? roots : board.units;
 return {
  done: pool.filter((u) => isUnitDone(board, u)).length,
  total: pool.length,
 };
}
```

#### 2. Tests de acciones y badge

**File**: `test/frida-workflow/features.test.ts`
**Changes**: MODIFY. Añade constantes de cadena, helpers `seedFullChain`/`writePlan` y los describes de advanceFeature/shipFeature/setFeaturePaused/shipBadge; añade `advanceFeature`/`featureAdvanceCommand`/`setFeaturePaused`/`shipBadge`/`shipFeature` al import de features y `applyStageTransition`/`DEFAULT_BOARD_COLUMNS`/`loadBoard`/`saveBoard`/`subscribeBoardChanges` al import de board.

Deltas de imports — features añade `advanceFeature`/`featureAdvanceCommand`/`setFeaturePaused`/`shipBadge`/`shipFeature`; import NUEVO de board:

```ts
import {
 applyStageTransition,
 DEFAULT_BOARD_COLUMNS,
 loadBoard,
 saveBoard,
 subscribeBoardChanges,
} from "../../src/tools/frida-workflow/board";
```

Adiciones al cuerpo del test (constantes + helpers + cuatro describes):

```ts
// ── Acciones (Slice 3) ──────────────────────────────────────────────────────

const RESEARCH_REL =
 ".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
const DESIGN_REL = ".frida/artifacts/designs/2026-01-03_10-00-00_mi-feature.md";
const PLAN_REL = ".frida/artifacts/plans/2026-01-04_10-00-00_mi-feature.md";

/** FRD→research→design→plan encadenados por parent (adopta en plan). */
function seedFullChain(): void {
 writeArtifact(FRD);
 writeArtifact(RESEARCH_REL, { parent: FRD });
 writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
 writeArtifact(PLAN_REL, { parent: DESIGN_REL });
}

/** Plan con fases `## FN` reales (syncUnitsFromPlan sólo parsea headers). */
function writePlan(rel: string, parent: string, titles: string[]): void {
 const abs = writeArtifact(rel, { parent });
 const body = titles.map((t, i) => `## F0${i + 1} — ${t}`).join("\n");
 writeFileSync(abs, `---\nparent: ${parent}\n---\n\n${body}\n`, "utf8");
}

describe("acciones — advanceFeature (FR#4 movimiento temprano)", () => {
 it("avanza una etapa, registra history con el escritor y emite el cambio", () => {
  writeArtifact(FRD);
  saveFeatures(tmp, {
   v: 1,
   features: [sampleFeature({ id: FRD })],
   updatedAt: "",
  });
  const fn = vi.fn();
  const off = subscribeFeaturesChanges(fn);
  const r = advanceFeature(tmp, FRD, "pipeline-ui");
  off();
  expect(r.moved).toBe(true);
  expect(r.to).toBe("research");
  expect(r.prerequisitesMet).toBe(true); // el FRD existe
  expect(r.command).toBe(`/skill:research ${FRD}`); // FR#4: pre-move
  expect(fn).toHaveBeenCalledTimes(1);
  const f = loadFeatures(tmp)!.features[0]!;
  expect(f.stage).toBe("research");
  expect(f.history).toEqual([
   { to: "research", ts: expect.any(String), source: "pipeline-ui" },
  ]);
 });

 it("feature inexistente: moved false y NO crea features.json", () => {
  const r = advanceFeature(tmp, "no-existe.md");
  expect(r.moved).toBe(false);
  expect(existsSync(featuresFilePath(tmp))).toBe(false);
 });

 it("en plan NO avanza: el gesto terminal es el ship (FR#5)", () => {
  seedFullChain();
  reconcileFeatures(tmp); // adopta en plan
  const r = advanceFeature(tmp, FRD);
  expect(r.moved).toBe(false);
  expect(loadFeatures(tmp)!.features[0]!.stage).toBe("plan");
  expect(loadFeatures(tmp)!.features[0]!.history).toHaveLength(1);
 });

 it("prerequisitesMet false cuando el insumo falta (FR#14) pero MUEVE igual", () => {
  saveFeatures(tmp, {
   v: 1,
   features: [sampleFeature({ id: FRD, stage: "research" })], // sin research real
   updatedAt: "",
  });
  const r = advanceFeature(tmp, FRD);
  expect(r.moved).toBe(true);
  expect(r.to).toBe("design");
  expect(r.prerequisitesMet).toBe(false);
  expect(r.command).toBe(`/skill:design ${FRD}`);
 });

 it("featureAdvanceCommand arma /skill:<etapa> <frd> sin mover (FR#4/FR#13)", () => {
  expect(featureAdvanceCommand(sampleFeature({ id: FRD }))).toBe(
   `/skill:research ${FRD}`,
  );
  expect(
   featureAdvanceCommand(sampleFeature({ id: FRD, stage: "plan" })),
  ).toBeUndefined();
  expect(
   featureAdvanceCommand(sampleFeature({ id: FRD, stage: "ready-to-ship" })),
  ).toBeUndefined();
 });
});

describe("acciones — shipFeature (FR#5)", () => {
 it("crea unidades backlog del plan SIN transiciones (cero ejecución)", () => {
  writeArtifact(FRD);
  writeArtifact(RESEARCH_REL, { parent: FRD });
  writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
  writePlan(PLAN_REL, DESIGN_REL, ["alpha", "beta", "gamma"]);
  reconcileFeatures(tmp); // adopta en plan con artifacts.plan
  const r = shipFeature(tmp, FRD, "pipeline-ui");
  expect(r.moved).toBe(true);
  expect(r.phaseCount).toBe(3);
  expect(r.planPath).toBe(PLAN_REL);
  const f = loadFeatures(tmp)!.features[0]!;
  expect(f.stage).toBe("ready-to-ship");
  expect(f.planPath).toBe(PLAN_REL);
  expect(f.shippedAt).toEqual(expect.any(String));
  // Board N2: fases en backlog, columnas default (espejo /board sin spec)
  const board = loadBoard(tmp, PLAN_REL)!;
  expect(board.columns).toEqual([...DEFAULT_BOARD_COLUMNS]);
  expect(board.units).toHaveLength(3);
  for (const u of board.units) {
   expect(u.status).toBe("backlog");
   expect(u.transitions).toEqual([]); // FR#5: sin ejecutar nada
  }
 });

 it("emite el cambio del board (overlay N2 vivo)", () => {
  writeArtifact(FRD);
  writeArtifact(RESEARCH_REL, { parent: FRD });
  writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
  writePlan(PLAN_REL, DESIGN_REL, ["alpha"]);
  reconcileFeatures(tmp);
  const fn = vi.fn();
  const off = subscribeBoardChanges(fn);
  const r = shipFeature(tmp, FRD);
  off();
  expect(r.moved).toBe(true);
  expect(fn).toHaveBeenCalled();
 });

 it("sin plan enlazado: failure no-plan y features.json intacto", () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp); // adopta en discover, sin artifacts.plan
  const r = shipFeature(tmp, FRD);
  expect(r.moved).toBe(false);
  expect(r.failure).toBe("no-plan");
  const f = loadFeatures(tmp)!.features[0]!;
  expect(f.stage).toBe("discover");
  expect(f.shippedAt).toBeUndefined();
  expect(f.history).toHaveLength(1);
 });

 it("re-ship en ready-to-ship: already-shipped, idempotente", () => {
  writeArtifact(FRD);
  writeArtifact(RESEARCH_REL, { parent: FRD });
  writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
  writePlan(PLAN_REL, DESIGN_REL, ["alpha", "beta"]);
  reconcileFeatures(tmp);
  shipFeature(tmp, FRD);
  const r = shipFeature(tmp, FRD);
  expect(r.moved).toBe(false);
  expect(r.failure).toBe("already-shipped");
  expect(loadBoard(tmp, PLAN_REL)!.units).toHaveLength(2);
  expect(loadFeatures(tmp)!.features[0]!.history).toHaveLength(2);
 });

 it("feature inexistente: failure missing", () => {
  expect(shipFeature(tmp, "no-existe.md")).toEqual({
   moved: false,
   failure: "missing",
   phaseCount: 0,
  });
 });
});

describe("acciones — setFeaturePaused (FR#11)", () => {
 it("persiste el flag y emite el cambio", () => {
  writeArtifact(FRD);
  saveFeatures(tmp, {
   v: 1,
   features: [sampleFeature({ id: FRD })],
   updatedAt: "",
  });
  const fn = vi.fn();
  const off = subscribeFeaturesChanges(fn);
  const f = setFeaturePaused(tmp, FRD, true, "monitor");
  off();
  expect(f?.paused).toBe(true);
  expect(loadFeatures(tmp)!.features[0]!.paused).toBe(true);
  expect(fn).toHaveBeenCalledTimes(1);
 });

 it("feature inexistente: undefined sin crear features.json", () => {
  expect(setFeaturePaused(tmp, "no-existe.md", true)).toBeUndefined();
  expect(existsSync(featuresFilePath(tmp))).toBe(false);
 });
});

describe("badge — shipBadge (FR#6)", () => {
 it("n/m fases done del board N2 (raíces; jerarquía splits vía isUnitDone)", () => {
  writeArtifact(FRD);
  writeArtifact(RESEARCH_REL, { parent: FRD });
  writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
  writePlan(PLAN_REL, DESIGN_REL, ["alpha", "beta", "gamma"]);
  reconcileFeatures(tmp);
  shipFeature(tmp, FRD);
  // Fase F01 commiteada (transición real del lifecycle N2)
  const board = loadBoard(tmp, PLAN_REL)!;
  applyStageTransition(board, "F01", { stage: "commit", runId: "t1", ts: "t1" });
  saveBoard(tmp, PLAN_REL, board);
  const f = loadFeatures(tmp)!.features[0]!;
  expect(shipBadge(tmp, f)).toEqual({ done: 1, total: 3 });
 });

 it("undefined sin planPath o sin board (feature no shipped)", () => {
  expect(shipBadge(tmp, sampleFeature())).toBeUndefined();
  expect(
   shipBadge(tmp, sampleFeature({ planPath: ".frida/artifacts/plans/nada.md" })),
  ).toBeUndefined();
 });
});
```

### Success Criteria

#### Automated Verification

- [ ] Tests del dominio + reconciler + acciones pasan: `npx vitest run test/frida-workflow/features.test.ts`
- [ ] Typecheck del proyecto verde: `npm run typecheck`
- [ ] `grep -n "export function advanceFeature" src/tools/frida-workflow/features.ts` retorna una línea (movimiento temprano FR#4)
- [ ] `grep -n "export function shipFeature" src/tools/frida-workflow/features.ts` retorna una línea (FR#5)
- [ ] `grep -c "openBoard" src/tools/frida-workflow/features.ts` retorna >= 1 (ship espeja el flujo /board: openBoard → saveBoard)

#### Manual Verification

- [ ] En un scratch tmp con FRD→research→design→plan (parent) y un plan de 3 fases `## FN`, `shipFeature` crea `.frida/artifacts/board/<slug>.json` con las 3 unidades en `backlog` y `transitions: []` (cero ejecución), y la feature queda `ready-to-ship` con `planPath`+`shippedAt`

---

## Phase 4: Motor declarativo PanelSpec

### Overview

Crea el motor declarativo de paneles de método (FR#9): tipos `PanelSpec`/`PanelColumnSpec`, validación eager (falla en el wiring, no en el render), registro runtime idempotente consumidor→motor (espejo `registerBuiltinPattern` builtin-patterns.ts:481) y la primera configuración `SDD_PANEL_SPEC`. El test registra una fixture AJENA (aidd) sin tocar el motor — acceptance criterion del FRD — y afirma la consistencia de columnas con `PIPELINE_STAGES` de la Fase 1 (el motor queda puro: no importa features.ts).

### Changes Required

#### 1. Motor PanelSpec

**File**: `src/tools/frida-workflow/panel-spec.ts`
**Changes**: NEW. PanelSpec + validación + registro runtime + SDD_PANEL_SPEC (cero imports).

```ts
// panel-spec.ts — motor declarativo de paneles de método (FR#9).
//
// SDD-N1 es la PRIMERA configuración; un método nuevo entra como spec
// registrada en runtime por su extensión consumidora (dirección de
// dependencia consumidor → motor), sin que el motor la conozca — espejo
// exacto de registerBuiltinPattern (builtin-patterns.ts:481-505), el patrón
// con que una extensión registra hoy sus workflows sin tocar el motor (#38).
//
// Qué es declarativo aquí y qué vive en el dominio del método (anti-drift):
// - Columnas, etiquetas de avance, gesto por columna, etiquetas de artefacto
//   y estado vacío son DATOS del spec (FR#1/FR#13/FR#15/FR#16).
// - El COMANDO de avance NO se declara: es behavior del dominio (features.ts
//   lo computa pre-move en AdvanceResult.command); duplicarlo aquí crearía
//   dos fuentes destinadas a diverger.
// - La DETECCIÓN de artefactos tampoco: cada método escanea sus raíces
//   (para SDD, el reconciler de features.ts con STAGE_BUCKET).
//
// Contrato de ids: las columnas de SDD_PANEL_SPEC espejan PIPELINE_STAGES
// (features.ts) 1:1 — la UI mapea feature.stage → columna por id. La
// consistencia la afirma panel-spec.test.ts; derivar aquí sería importar el
// dominio al motor (rompe la independencia del registro).

/** Gesto que dispara el botón de avance de una columna (FR#9 disparadores):
 *  "skill" inyecta el comando de la etapa siguiente (advanceFeature);
 *  "ship" ejecuta el gesto terminal del método (shipFeature → board N2). */
export type PanelAdvanceKind = "skill" | "ship";

/** Una columna del panel, en orden de avance (FR#1). */
export interface PanelColumnSpec {
 /** Id estable de la columna. Para SDD coincide con PipelineStage de
  *  features.ts (la UI resuelve la columna de una tarjeta por stage). */
 id: string;
 /** Etiqueta visible de la columna (FR#1: `🚀 ready-to-ship`). */
 label: string;
 /** Columna terminal: sin botón de avance — la entrada es un gesto manual
  *  del dominio (para SDD, el ship la POBLA; luego vive con el badge n/m,
  *  FR#6). Validación: exactamente una por spec (pipeline lineal). */
 terminal?: boolean;
 /** Etiqueta del botón de avance DESDE esta columna (FR#13: «Continuar a
  *  research →», «Ship → fases a ejecución»). Obligatoria si la columna
  *  no es terminal; prohibida si lo es (validación eager). */
 advanceLabel?: string;
 /** Gesto del botón (FR#9). Default "skill" cuando se omite; prohibido en
  *  la columna terminal. */
 advanceKind?: PanelAdvanceKind;
 /** Nombre visible del artefacto que respalda la etapa, para el detalle
  *  del monitor (FR#16: «FRD», «Research», «Design», «Plan»). Opcional:
  *  la columna terminal no produce artefacto. */
 artifactLabel?: string;
}

/** Comando que llena el estado vacío del panel (FR#15). */
export interface PanelEmptyStateSpec {
 /** Comando accionable que crea la primera unidad (para SDD:
  *  `/skill:discover <idea>` — el placeholder lo completa el usuario). */
 command: string;
 /** Explicación corta del vacío, junto al botón. */
 hint?: string;
}

/** Definición declarativa de un panel de método (FR#9). */
export interface PanelSpec {
 /** Id estable del método. Dobla como segmento de ruta de su página en el
  *  monitor (`sdd` → `/sdd`, FR#7) y como llave del registro. */
 id: string;
 /** Título corto (header del overlay / título de página del monitor). */
 title: string;
 /** Columnas en orden de avance (FR#1). */
 columns: PanelColumnSpec[];
 /** Comando del estado vacío (FR#15). */
 emptyState: PanelEmptyStateSpec;
}

// ── Validación eager (falla en el wiring, no en el render) ─────────────────

/** Nombre del spec para mensajes (tolera specs a medio construir). */
function specName(spec: PanelSpec): string {
 const id = (spec as { id?: unknown } | undefined)?.id;
 return typeof id === "string" && id ? id : "<sin id>";
}

/**
 * Valida un spec ANTES de registrarlo/usarlo (espejo de la validación eager
 * de los patrones: error accionable en el wiring, no un render roto después).
 * Reglas: id y title no vacíos; columns no vacío con ids únicos y labels no
 * vacíos; EXACTAMENTE una columna terminal (pipeline lineal); advanceLabel y
 * advanceKind prohibidos en la terminal, advanceLabel obligatorio en las
 * demás (FR#13); emptyState.command no vacío (FR#15).
 */
export function validatePanelSpec(spec: PanelSpec): void {
 const name = `PanelSpec «${specName(spec)}»`;
 if (!spec || typeof spec !== "object") {
  throw new Error(`${name}: se requiere un objeto PanelSpec.`);
 }
 if (typeof spec.id !== "string" || !spec.id.trim()) {
  throw new Error(`${name}: id debe ser un string no vacío.`);
 }
 if (typeof spec.title !== "string" || !spec.title.trim()) {
  throw new Error(`${name}: title debe ser un string no vacío.`);
 }
 if (!Array.isArray(spec.columns) || spec.columns.length === 0) {
  throw new Error(`${name}: columns debe ser un arreglo no vacío.`);
 }
 const seen = new Set<string>();
 for (const c of spec.columns) {
  if (!c || typeof c !== "object") {
   throw new Error(`${name}: toda columna debe ser un objeto.`);
  }
  if (typeof c.id !== "string" || !c.id.trim()) {
   throw new Error(`${name}: toda columna necesita id no vacío.`);
  }
  if (seen.has(c.id)) {
   throw new Error(`${name}: id de columna duplicado «${c.id}».`);
  }
  seen.add(c.id);
  if (typeof c.label !== "string" || !c.label.trim()) {
   throw new Error(
    `${name}: la columna «${c.id}» necesita label no vacío.`,
   );
  }
  if (
   c.advanceKind !== undefined &&
   c.advanceKind !== "skill" &&
   c.advanceKind !== "ship"
  ) {
   throw new Error(
    `${name}: advanceKind de «${c.id}» debe ser "skill" | "ship".`,
   );
  }
 }
 const terminals = spec.columns.filter((c) => c.terminal);
 if (terminals.length !== 1) {
  throw new Error(
   `${name}: se requiere EXACTAMENTE una columna terminal (pipeline lineal); hay ${terminals.length}.`,
  );
 }
 for (const c of spec.columns) {
  if (c.terminal) {
   if (c.advanceLabel !== undefined) {
    throw new Error(
     `${name}: la columna terminal «${c.id}» no lleva advanceLabel (no hay avance desde ella).`,
    );
   }
   if (c.advanceKind !== undefined) {
    throw new Error(
     `${name}: la columna terminal «${c.id}» no lleva advanceKind.`,
    );
   }
  } else if (
   typeof c.advanceLabel !== "string" ||
   !c.advanceLabel.trim()
  ) {
   throw new Error(
    `${name}: la columna «${c.id}» necesita advanceLabel (FR#13: el botón nombra el movimiento).`,
   );
  }
 }
 if (
  !spec.emptyState ||
  typeof spec.emptyState.command !== "string" ||
  !spec.emptyState.command.trim()
 ) {
  throw new Error(
   `${name}: emptyState.command debe ser un string no vacío (FR#15).`,
  );
 }
}

// ── Registro runtime (espejo builtin-patterns.ts:481-505) ──────────────────

/** Specs registradas en runtime por extensiones consumidoras (FR#9): un
 *  método futuro inyecta su panel aquí sin que el motor dependa de él.
 *  Dirección de dependencia consumidor → motor (patrón #38). */
const REGISTERED_PANEL_SPECS: PanelSpec[] = [];

/** Registra un spec en runtime: validación eager, idempotente por id, gana
 *  el último (espejo registerBuiltinPattern). */
export function registerPanelSpec(spec: PanelSpec): void {
 validatePanelSpec(spec);
 const i = REGISTERED_PANEL_SPECS.findIndex((p) => p.id === spec.id);
 if (i >= 0) REGISTERED_PANEL_SPECS.splice(i, 1);
 REGISTERED_PANEL_SPECS.push(spec);
}

/** Sólo tests: vacía las specs registradas en runtime (los defaults sobreviven). */
export function _resetPanelSpecs(): void {
 REGISTERED_PANEL_SPECS.length = 0;
}

// ── Primera configuración: SDD-N1 ───────────────────────────────────────────

/** SDD-N1 (FR#1): `discover | research | design | plan | 🚀 ready-to-ship`.
 *  Los ids espejan PIPELINE_STAGES (features.ts) 1:1. El botón de `plan`
 *  nombra el ship (FR#13): el gesto que CRUZA a ready-to-ship creando las
 *  fases en backlog del board N2 (FR#5); post-ship la tarjeta vive en la
 *  terminal con el badge n/m (FR#6), sin botón. */
export const SDD_PANEL_SPEC: PanelSpec = {
 id: "sdd",
 title: "Pipeline SDD",
 columns: [
  {
   id: "discover",
   label: "discover",
   advanceKind: "skill",
   advanceLabel: "Continuar a research →",
   artifactLabel: "FRD",
  },
  {
   id: "research",
   label: "research",
   advanceKind: "skill",
   advanceLabel: "Continuar a design →",
   artifactLabel: "Research",
  },
  {
   id: "design",
   label: "design",
   advanceKind: "skill",
   advanceLabel: "Continuar a plan →",
   artifactLabel: "Design",
  },
  {
   id: "plan",
   label: "plan",
   advanceKind: "ship",
   advanceLabel: "Ship → fases a ejecución",
   artifactLabel: "Plan",
  },
  {
   id: "ready-to-ship",
   label: "🚀 ready-to-ship",
   terminal: true,
  },
 ],
 emptyState: {
  command: "/skill:discover <idea>",
  hint: "Genera el FRD de una feature para abrirle camino en el pipeline.",
 },
};

/** Defaults con que el motor arranca: la primera configuración es un DATO
 *  del módulo, no código del motor. Una extensión puede pisar el id "sdd"
 *  registrando el suyo (los registrados van primero — espejo allPatterns). */
const DEFAULT_PANEL_SPECS: readonly PanelSpec[] = [SDD_PANEL_SPEC];

/** Registradas primero (la extensión gana), defaults después. */
function allSpecs(): readonly PanelSpec[] {
 return [...REGISTERED_PANEL_SPECS, ...DEFAULT_PANEL_SPECS];
}

/** Busca un spec por id exacto (estable; registradas ganan a los defaults). */
export function resolvePanelSpec(id: string): PanelSpec | undefined {
 return allSpecs().find((p) => p.id === id);
}

/** Catálogo de specs para el monitor (página por método, FR#7). Deduplicado
 *  por id — un override registrado no lista el default que pisa (delta
 *  amigable vs allPatterns: el hub no debe pintar un método dos veces). */
export function listPanelSpecs(): readonly PanelSpec[] {
 const seen = new Set<string>();
 const out: PanelSpec[] = [];
 for (const s of allSpecs()) {
  if (seen.has(s.id)) continue;
  seen.add(s.id);
  out.push(s);
 }
 return out;
}
```

#### 2. Tests del motor

**File**: `test/frida-workflow/panel-spec.test.ts`
**Changes**: NEW. Tres frentes: SDD_PANEL_SPEC, registro runtime (fixture ajena), validatePanelSpec.

```ts
// panel-spec.test.ts — motor declarativo de paneles de método (FR#9).
//
// Molde: test/frida-workflow/board.test.ts (aislamiento por test con _reset*,
// espejo de _resetRegistry en los tests del comando /wf). Tres frentes:
// 1) SDD_PANEL_SPEC — la primera configuración (FR#1/FR#13/FR#15/FR#16).
// 2) Registro runtime — fixture AJENA al motor (AC del FRD: definir un panel
//    nuevo NO modifica el motor).
// 3) validatePanelSpec — contrato eager del spec.
//
// NOTA: el import de PIPELINE_STAGES (features.ts, Slice 1) es una AFIRMACIÓN
// de consistencia cross-módulo (columnas del spec ↔ etapas del dominio), no
// una dependencia del motor: panel-spec.ts no importa features.ts.
import { beforeEach, describe, expect, it } from "vitest";
import {
 SDD_PANEL_SPEC,
 _resetPanelSpecs,
 listPanelSpecs,
 registerPanelSpec,
 resolvePanelSpec,
 validatePanelSpec,
 type PanelSpec,
} from "../../src/tools/frida-workflow/panel-spec";
import { PIPELINE_STAGES } from "../../src/tools/frida-workflow/features";

/** Columna de SDD_PANEL_SPEC por id (falla ruidoso si el spec deriva). */
function col(id: string) {
 const c = SDD_PANEL_SPEC.columns.find((x) => x.id === id);
 if (!c) throw new Error(`SDD_PANEL_SPEC no tiene columna «${id}»`);
 return c;
}

/** Fixture AJENA al motor (FR#9): un hipotético panel de planeación con
 *  columnas propias — registrar esto no toca panel-spec.ts (AC del FRD). */
const AIDD_PANEL: PanelSpec = {
 id: "aidd",
 title: "AiDD",
 columns: [
  {
   id: "brief",
   label: "brief",
   advanceLabel: "Continuar a PRD →",
   artifactLabel: "Brief",
  },
  {
   id: "prd",
   label: "prd",
   advanceLabel: "Continuar a arquitectura →",
   artifactLabel: "PRD",
  },
  { id: "architecture", label: "architecture", terminal: true },
 ],
 emptyState: {
  command: "/wf aidd-plan",
  hint: "Arranca la planeación por historias.",
 },
};

beforeEach(() => {
 _resetPanelSpecs();
});

describe("SDD_PANEL_SPEC — la primera configuración (FR#1)", () => {
 it("las columnas espejan PIPELINE_STAGES 1:1, mismo orden (contrato UI↔dominio)", () => {
  expect(SDD_PANEL_SPEC.columns.map((c) => c.id)).toEqual([
   ...PIPELINE_STAGES,
  ]);
 });

 it("labels visibles del FRD: discover | research | design | plan | 🚀 ready-to-ship", () => {
  expect(SDD_PANEL_SPEC.columns.map((c) => c.label)).toEqual([
   "discover",
   "research",
   "design",
   "plan",
   "🚀 ready-to-ship",
  ]);
 });

 it("exactamente una terminal: ready-to-ship, sin botón de avance (FR#6)", () => {
  const terminals = SDD_PANEL_SPEC.columns.filter((c) => c.terminal);
  expect(terminals.map((t) => t.id)).toEqual(["ready-to-ship"]);
  expect(terminals[0]!.advanceLabel).toBeUndefined();
  expect(terminals[0]!.advanceKind).toBeUndefined();
 });

 it("el botón nombra el movimiento (FR#13): research desde discover, ship desde plan", () => {
  expect(col("discover").advanceLabel).toBe("Continuar a research →");
  expect(col("research").advanceLabel).toBe("Continuar a design →");
  expect(col("design").advanceLabel).toBe("Continuar a plan →");
  expect(col("plan").advanceLabel).toBe("Ship → fases a ejecución");
 });

 it("advanceKind declara el disparador por etapa (FR#9): skill en etapas, ship en plan", () => {
  expect(col("discover").advanceKind).toBe("skill");
  expect(col("plan").advanceKind).toBe("ship");
 });

 it("emptyState declara el comando que llena el panel (FR#15)", () => {
  expect(SDD_PANEL_SPEC.emptyState.command).toBe("/skill:discover <idea>");
  expect(SDD_PANEL_SPEC.emptyState.hint).toBeDefined();
 });

 it("artifactLabel por etapa para el detalle del monitor (FR#16)", () => {
  expect(col("discover").artifactLabel).toBe("FRD");
  expect(col("research").artifactLabel).toBe("Research");
  expect(col("design").artifactLabel).toBe("Design");
  expect(col("plan").artifactLabel).toBe("Plan");
  expect(col("ready-to-ship").artifactLabel).toBeUndefined();
 });

 it("validatePanelSpec la acepta (fixture sana)", () => {
  expect(() => validatePanelSpec(SDD_PANEL_SPEC)).not.toThrow();
 });
});

describe("registro runtime — espejo registerBuiltinPattern (FR#9)", () => {
 it("resolvePanelSpec('sdd') funciona SIN registro: el default del motor", () => {
  expect(resolvePanelSpec("sdd")).toBe(SDD_PANEL_SPEC);
 });

 it("fixture ajena (aidd) registra y resuelve sin tocar el motor (AC del FRD)", () => {
  registerPanelSpec(AIDD_PANEL);
  expect(resolvePanelSpec("aidd")).toBe(AIDD_PANEL);
  expect(listPanelSpecs().map((s) => s.id)).toContain("aidd");
 });

 it("idempotente por id: re-registrar no duplica y gana el último", () => {
  registerPanelSpec(AIDD_PANEL);
  registerPanelSpec({ ...AIDD_PANEL, title: "AiDD v2" });
  const aidds = listPanelSpecs().filter((s) => s.id === "aidd");
  expect(aidds).toHaveLength(1);
  expect(aidds[0]!.title).toBe("AiDD v2");
 });

 it("una extensión puede pisar el default: registrado gana a 'sdd' (dedup por id)", () => {
  const override: PanelSpec = {
   ...SDD_PANEL_SPEC,
   title: "Pipeline SDD (custom)",
  };
  registerPanelSpec(override);
  expect(resolvePanelSpec("sdd")).toBe(override);
  expect(listPanelSpecs().filter((s) => s.id === "sdd")).toHaveLength(1);
 });

 it("_resetPanelSpecs vacía el runtime; los defaults sobreviven", () => {
  registerPanelSpec(AIDD_PANEL);
  _resetPanelSpecs();
  expect(resolvePanelSpec("aidd")).toBeUndefined();
  expect(resolvePanelSpec("sdd")).toBe(SDD_PANEL_SPEC);
 });

 it("registrar un spec inválido lanza y NO queda registrado", () => {
  const broken = { ...AIDD_PANEL, columns: [] } as PanelSpec;
  expect(() => registerPanelSpec(broken)).toThrow(/columns/);
  expect(resolvePanelSpec("aidd")).toBeUndefined();
 });
});

describe("validatePanelSpec — contrato eager", () => {
 it("requiere columns no vacío", () => {
  expect(() =>
   validatePanelSpec({ ...AIDD_PANEL, columns: [] }),
  ).toThrow(/no vacío/);
 });

 it("rechaza ids de columna duplicados", () => {
  expect(() =>
   validatePanelSpec({
    ...AIDD_PANEL,
    columns: [
     { id: "brief", label: "brief", advanceLabel: "→" },
     { id: "brief", label: "brief 2", advanceLabel: "→" },
     { id: "done", label: "done", terminal: true },
    ],
   }),
  ).toThrow(/duplicado/);
 });

 it("exige EXACTAMENTE una terminal (pipeline lineal): ni cero ni dos", () => {
  const sinTerminal = {
   ...AIDD_PANEL,
   columns: AIDD_PANEL.columns.map((c) => ({
    ...c,
    terminal: false,
    advanceLabel: c.advanceLabel ?? "→",
   })),
  };
  expect(() => validatePanelSpec(sinTerminal)).toThrow(/terminal/);
  const dosTerminales = {
   ...AIDD_PANEL,
   columns: [
    ...AIDD_PANEL.columns,
    { id: "epicas", label: "epicas", terminal: true },
   ],
  };
  expect(() => validatePanelSpec(dosTerminales)).toThrow(/terminal/);
 });

 it("no-terminal exige advanceLabel (FR#13); terminal la prohíbe", () => {
  expect(() =>
   validatePanelSpec({
    ...AIDD_PANEL,
    columns: [
     { id: "brief", label: "brief" }, // sin advanceLabel
     { id: "done", label: "done", terminal: true },
    ],
   }),
  ).toThrow(/advanceLabel/);
  expect(() =>
   validatePanelSpec({
    ...AIDD_PANEL,
    columns: [
     { id: "brief", label: "brief", advanceLabel: "→" },
     { id: "done", label: "done", terminal: true, advanceLabel: "¿y esto?" },
    ],
   }),
  ).toThrow(/terminal/);
 });

 it("advanceKind sólo admite skill|ship; prohibido en la terminal", () => {
  const kindInvalido = {
   ...AIDD_PANEL,
   columns: [
    { id: "brief", label: "brief", advanceLabel: "→", advanceKind: "teleport" },
    { id: "done", label: "done", terminal: true },
   ],
  } as unknown as PanelSpec;
  expect(() => validatePanelSpec(kindInvalido)).toThrow(/advanceKind/);
  const kindEnTerminal = {
   ...AIDD_PANEL,
   columns: [
    { id: "brief", label: "brief", advanceLabel: "→" },
    { id: "done", label: "done", terminal: true, advanceKind: "skill" },
   ],
  };
  expect(() => validatePanelSpec(kindEnTerminal)).toThrow(/advanceKind/);
 });

 it("columnas sin advanceKind son válidas (default skill)", () => {
  expect(() => validatePanelSpec(AIDD_PANEL)).not.toThrow();
 });

 it("id, title y emptyState.command no vacíos", () => {
  expect(() => validatePanelSpec({ ...AIDD_PANEL, id: " " })).toThrow(
   /id debe ser/,
  );
  expect(() => validatePanelSpec({ ...AIDD_PANEL, title: "" })).toThrow(
   /title debe ser/,
  );
  expect(() =>
   validatePanelSpec({ ...AIDD_PANEL, emptyState: { command: "" } }),
  ).toThrow(/emptyState\.command/);
 });
});
```

#### 3. Reexports

**File**: `src/tools/frida-workflow/index.ts`
**Changes**: MODIFY. Añade el bloque de reexports de panel-spec tras el de features.

```ts
// Motor declarativo de paneles de método (FR#9): SDD-N1 es la primera
// configuración; un método nuevo registra su spec en runtime sin tocar el
// motor (dirección consumidor→motor, patrón #38).
export {
 SDD_PANEL_SPEC,
 listPanelSpecs,
 registerPanelSpec,
 resolvePanelSpec,
 validatePanelSpec,
 _resetPanelSpecs,
} from "./panel-spec";
export type {
 PanelSpec,
 PanelColumnSpec,
 PanelEmptyStateSpec,
 PanelAdvanceKind,
} from "./panel-spec";
```

### Success Criteria

#### Automated Verification

- [ ] Tests del motor pasan: `npx vitest run test/frida-workflow/panel-spec.test.ts`
- [ ] Typecheck del proyecto verde: `npm run typecheck`
- [ ] `grep -n "export function registerPanelSpec" src/tools/frida-workflow/panel-spec.ts` retorna una línea (registro idempotente consumidor→motor, espejo builtin-patterns.ts:481)
- [ ] `grep -n "export const SDD_PANEL_SPEC" src/tools/frida-workflow/panel-spec.ts` retorna una línea y `grep -c "SDD_PANEL_SPEC" src/tools/frida-workflow/index.ts` retorna >= 1 (fixture expuesta al host)
- [ ] `grep -ci "aidd" src/tools/frida-workflow/panel-spec.ts` retorna 0 y `grep -ci "aidd" test/frida-workflow/panel-spec.test.ts` retorna >= 2 (FR#9: la configuración ajena vive en el test, no en el motor)

#### Manual Verification

- [ ] La fixture aidd del test registra/resuelve vía `registerPanelSpec`/`resolvePanelSpec` con cero cambios en panel-spec.ts (AC del FRD: «Definir un panel nuevo… NO requiere modificar el motor»)
- [ ] `SDD_PANEL_SPEC` lee `discover | research | design | plan | 🚀 ready-to-ship` con `plan.advanceKind: "ship"` y botón «Ship → fases a ejecución» (FR#1/FR#9/FR#13 — inspección del objeto o del test del spec)

---

## Phase 5: Overlay N1 — /pipeline absorbe el comando

### Overview

Construye el overlay N1 y absorbe `/pipeline` (D5): `features-ui.tsx` (PipelinePanel con columnas del spec, FeatureCard de 3 renglones con mini-timeline FR#11/ámbar desinc FR#12/badge n/m FR#6/botón nombrado FR#13, WarningBanner FR#14, EmptyState FR#15, OrchestratorSection D5), CSS `pl-*`, wiring del host en extension.ts (3a-3g: case nuevo `mountPipelineOverlay` con suscripciones vivas features+board, cascada de re-montaje D8 N1→N2→workflow, re-montaje idempotente en webview_ready — lección ba40da0, `runEmptyPipelineCommand` con InputBox) y la baja atómica del banner del orquestador (`banner.tsx`/`panel.ts` eliminados junto a sus reexports; `computePipelineStatus`/`formatPipelineStatus` sobreviven en setup-command.ts).

### Changes Required

#### 1. Overlay UI

**File**: `src/tools/frida-workflow/features-ui.tsx`
**Changes**: NEW. Contrato `PipelineOverlayData`/`PipelineOverlayActions` espejo board-ui.tsx:32-50 + PipelinePanel/FeatureCard/MiniTimeline/WarningBanner/EmptyState/OrchestratorSection.

```tsx
// features-ui.tsx — overlay N1 del pipeline SDD: /pipeline (FR#1).
//
// Espejo del contrato de board-ui.tsx (#169): panel colapsable del footer
// montado vía mountPersistent, con la preferencia de vista (colapsado) a
// nivel de módulo — el overlay vivo re-monta en cada cambio de features.json
// y el usuario no debe perderla. El host (mountPipelineOverlay, extension.ts)
// es el único que lee FS: suscribe subscribeFeaturesChanges +
// subscribeBoardChanges y re-monta este elemento con datos frescos (snapshot
// completo por cambio, patrón /board).
//
// Qué es DATO aquí y qué vive en el dominio (anti-drift, espejo panel-spec):
// - Columnas, etiquetas del botón y estado vacío vienen del SPEC
//   (resolvePanelSpec("sdd"); un override registrado gana), no hardcodeados.
// - El COMANDO de avance lo computa el dominio (advanceFeature pre-move,
//   AdvanceResult.command): la UI sólo dispara actions.onAdvance.
// - desync/badge/paused los aporta el host frescos en cada re-mount
//   (computeFeatureReconcile/shipBadge): la UI no toca el FS.
import { useState } from "react";
import type { ReactElement } from "react";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";
import {
 SDD_PANEL_SPEC,
 resolvePanelSpec,
 type PanelSpec,
 type PanelColumnSpec,
} from "./panel-spec";
import type { PipelineFeature, ShipBadge } from "./features";

// ── Contrato con el host (espejo BoardOverlayActions board-ui.tsx:32-50) ────

/** Feature + derivados que el host computa frescos en cada re-mount. */
export interface PipelineFeatureView extends PipelineFeature {
 /** FR#12: el FS tiene artefactos más avanzados que la tarjeta (ámbar). */
 desync: boolean;
 /** FR#6: badge «n/m fases» post-ship (shipBadge del dominio; el host lo
  *  refresca vía subscribeBoardChanges — el board emite en cada run). */
 badge?: ShipBadge;
}

/** Banner ámbar FR#14: avance disparado sin el insumo previo en el FS. */
export interface PipelineWarning {
 /** Id de la feature que lo disparó (llave de la memoria de dismiss). */
 id: string;
 text: string;
}

/** Sección compacta del orquestador (D5): nivel + resumen, detalle en tooltip. */
export interface PipelineOrchestratorView {
 level: "ready" | "degraded" | "empty";
 /** Línea visible (ej. «orquestador v3.4.1 · hermanas 5/5»). */
 summary: string;
 /** Tooltip: conteos empaquetados + hermanas faltantes. */
 detail: string;
}

/** Snapshot fresco que el host inyecta en cada re-mount. */
export interface PipelineOverlayData {
 features: PipelineFeatureView[];
 status: PipelineOrchestratorView;
 /** FR#14 — activos (no dismissados) al momento del re-mount. */
 warnings: PipelineWarning[];
}

export interface PipelineOverlayActions {
 /** ▶ skill (FR#4): movimiento temprano + inyección del comando (host). */
 onAdvance: (id: string) => void;
 /** ▶ ship (FR#5): fases del plan → backlog del board N2, sin ejecución. */
 onShip: (id: string) => void;
 /** FR#15 — comando del estado vacío; el host resuelve el `<placeholder>`. */
 onRunEmptyCommand: (template: string) => void;
 /** FR#14 — dismiss del banner (memoria de sesión en el host). */
 onDismissWarning: (id: string) => void;
 /** Cierra el panel (unmount + desuscripciones). */
 onClose: () => void;
}

// ── Estado de módulo (sobrevive re-mounts; espejo board-ui.tsx:42) ──────────

/** Preferencia de vista del usuario (colapsado/expandido). */
let pipelinePanelCollapsed = false;

/** Título visible de una feature: reconciler topic > segmento tras el slug
 *  de fecha > basename. Compartido con el host (mensajes warn/ship). */
export function featureTitle(f: { id: string; title?: string }): string {
 if (f.title) return f.title;
 const base = f.id.split("/").pop() ?? f.id;
 return (
  base
   .replace(/\.md$/, "")
   .replace(/^\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?_/, "") || base
 );
}

/** Factory del elemento raíz del overlay N1 (mountPersistent "footer"). */
export function createPipelineOverlayElement(
 data: PipelineOverlayData,
 actions: PipelineOverlayActions,
): ReactElement {
 return <PipelinePanel data={data} actions={actions} />;
}

// ── Acentos por columna (lenguaje visual /board: charts-* por etapa) ────────

const STAGE_ACCENT: Record<string, string> = {
 discover: "var(--vscode-charts-blue, #58a6ff)",
 research: "var(--vscode-charts-purple, #c586c0)",
 design: "var(--vscode-charts-yellow, #dcdcaa)",
 plan: "var(--vscode-charts-orange, #d18616)",
 "ready-to-ship": "var(--vscode-charts-green, #4ec9b0)",
};

// ── Panel raíz ──────────────────────────────────────────────────────────────

function PipelinePanel({
 data,
 actions,
}: {
 data: PipelineOverlayData;
 actions: PipelineOverlayActions;
}): ReactElement {
 const [collapsed, setCollapsed] = useState(pipelinePanelCollapsed);
 const toggleCollapsed = (): void => {
  pipelinePanelCollapsed = !pipelinePanelCollapsed;
  setCollapsed(pipelinePanelCollapsed);
 };
 // El panel es SDD-N1 (FR#9): un override registrado gana al default.
 const spec = resolvePanelSpec("sdd") ?? SDD_PANEL_SPEC;
 const desyncCount = data.features.filter((f) => f.desync).length;

 return (
  <CollapsiblePanel
   collapsed={collapsed}
   onToggle={toggleCollapsed}
   padding={6}
   gap={6}
   cls="pl-panel"
   header={
    <fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
     <ficon
      name="rocket"
      size={12}
      color="var(--vscode-textLink-foreground, #4daafc)"
     />
     <ftext bold size={12}>
      Pipeline
     </ftext>
     <ftext
      size={11}
      cls="pl-metric"
      color="var(--vscode-descriptionForeground)"
     >
      ({data.features.length})
     </ftext>
     {desyncCount > 0 ? (
      <fbox
       flexDirection="row"
       gap={2}
       alignItems="center"
       cls="pl-desync"
       title={`${desyncCount} feature(s) desincronizada(s): el FS va por delante de la tarjeta — usa ▶ para alcanzarla`}
      >
       <ficon name="sync" size={10} />
       <ftext size={10}>{desyncCount}</ftext>
      </fbox>
     ) : null}
    </fbox>
   }
   actions={
    <fbox onClick={actions.onClose} cls="pl-close" title="Cerrar pipeline">
     <ficon name="x" size={12} color="#8b949e" />
    </fbox>
   }
  >
   {data.warnings.map((w) => (
    <WarningBanner key={w.id} warning={w} actions={actions} />
   ))}

   {data.features.length === 0 ? (
    <EmptyState spec={spec} actions={actions} />
   ) : (
    <fbox flexDirection="row" gap={8} cls="pl-board">
     {spec.columns.map((col) => {
      // Contrato spec↔dominio: feature.stage === columna por id.
      const inCol = data.features.filter((f) => f.stage === col.id);
      return (
       <fbox key={col.id} flexDirection="column" gap={6} cls="pl-col">
        <fbox
         flexDirection="row"
         gap={4}
         alignItems="center"
        >
         <fbox
          cls="pl-col-dot"
          background={STAGE_ACCENT[col.id] ?? "#888"}
         />
         <ftext
          size={11}
          bold
          color="var(--vscode-descriptionForeground)"
         >
          {col.label}
         </ftext>
         <ftext
          size={10}
          cls="pl-metric"
          color="var(--vscode-descriptionForeground)"
         >
          ({inCol.length})
         </ftext>
        </fbox>
        {inCol.map((f) => (
         <FeatureCard
          key={f.id}
          feature={f}
          spec={spec}
          actions={actions}
         />
        ))}
       </fbox>
      );
     })}
    </fbox>
   )}

   <OrchestratorSection status={data.status} />
  </CollapsiblePanel>
 );
}

// ── FR#14 — Banner ámbar dismissible ────────────────────────────────────────

function WarningBanner({
 warning,
 actions,
}: {
 warning: PipelineWarning;
 actions: PipelineOverlayActions;
}): ReactElement {
 return (
  <fbox
   flexDirection="row"
   gap={6}
   alignItems="center"
   cls="pl-warn"
   title={warning.text}
  >
   <ficon name="triangle-alert" size={11} />
   <ftext size={10} cls="pl-warn-text">
    {warning.text}
   </ftext>
   <fbox
    onClick={() => actions.onDismissWarning(warning.id)}
    cls="pl-warn-dismiss"
    title="Descartar por esta sesión"
   >
    <ficon
     name="x"
     size={10}
     color="var(--vscode-descriptionForeground)"
    />
   </fbox>
  </fbox>
 );
}

// ── FR#15 — Estado vacío: el comando que lo llena, accionable ───────────────

function EmptyState({
 spec,
 actions,
}: {
 spec: PanelSpec;
 actions: PipelineOverlayActions;
}): ReactElement {
 return (
  <fbox flexDirection="column" gap={4} cls="pl-empty">
   <ftext size={11} color="var(--vscode-descriptionForeground)">
    {spec.emptyState.hint}
   </ftext>
   <fbox flexDirection="row" gap={6} alignItems="center">
    <ftext size={10} cls="pl-cmd">
     {spec.emptyState.command}
    </ftext>
    <fbutton
     variant="secondary"
     onClick={() => actions.onRunEmptyCommand(spec.emptyState.command)}
     title={`${spec.emptyState.command} — el host pide el valor del placeholder`}
    >
     <ficon name="play" size={10} />
     <ftext size={11}>Ejecutar</ftext>
    </fbutton>
   </fbox>
  </fbox>
 );
}

// ── D5 — Sección compacta del orquestador (ex-banner) ───────────────────────

const ORCH_ICON: Record<PipelineOrchestratorView["level"], string> = {
 ready: "check",
 degraded: "triangle-alert",
 empty: "circle",
};

const ORCH_COLOR: Record<PipelineOrchestratorView["level"], string> = {
 ready: "var(--vscode-gitDecoration-addedResourceForeground, #3fb950)",
 degraded: "var(--vscode-list-warningForeground, #cca700)",
 empty: "var(--vscode-descriptionForeground)",
};

function OrchestratorSection({
 status,
}: {
 status: PipelineOrchestratorView;
}): ReactElement {
 return (
  <fbox
   flexDirection="row"
   gap={4}
   alignItems="center"
   cls="pl-orch"
   title={status.detail}
  >
   <ficon
    name={ORCH_ICON[status.level]}
    size={10}
    color={ORCH_COLOR[status.level]}
   />
   <ftext size={10} color={ORCH_COLOR[status.level]}>
    {status.summary}
   </ftext>
  </fbox>
 );
}

// ── Tarjeta de feature (FR#4/#5/#6/#11/#12/#13) ─────────────────────────────

function FeatureCard({
 feature,
 spec,
 actions,
}: {
 feature: PipelineFeatureView;
 spec: PanelSpec;
 actions: PipelineOverlayActions;
}): ReactElement {
 // Contrato spec↔dominio: la columna de la tarjeta es feature.stage por id.
 const col = spec.columns.find((c) => c.id === feature.stage);
 const currentIndex = spec.columns.findIndex((c) => c.id === feature.stage);
 const accent = STAGE_ACCENT[feature.stage] ?? "#888";

 return (
  <fbox
   flexDirection="column"
   gap={4}
   cls={`pl-card${feature.desync ? " pl-card-desync" : ""}`}
  >
   {/* Renglón 1: barra de acento + título (ellipsis) + pausa (FR#11). */}
   <fbox flexDirection="row" gap={6} alignItems="center" title={feature.id}>
    <fbox cls="pl-card-bar" background={accent} />
    <ftext size={11} bold cls="pl-card-title">
     {featureTitle(feature)}
    </ftext>
    {feature.paused ? (
     <fbox
      flexDirection="row"
      alignItems="center"
      cls="pl-paused"
      title="Pausada — el avance NO está bloqueado (FR#14)"
     >
      <ficon name="debug-pause" size={10} />
     </fbox>
    ) : null}
   </fbox>

   {/* Renglón 2: mini-timeline (FR#11) + ámbar desync (FR#12) + badge
    *  n/m post-ship (FR#6) — badges indivisibles (patrón kb-badges). */}
   <fbox flexDirection="row" gap={6} alignItems="center" cls="pl-badges">
    <MiniTimeline
     spec={spec}
     currentIndex={currentIndex}
     paused={feature.paused}
    />
    {feature.desync ? (
     <fbox
      flexDirection="row"
      gap={2}
      alignItems="center"
      cls="pl-desync"
      title="El FS tiene artefactos más avanzados que la tarjeta — usa ▶ para alcanzarla (el reconciler no adelanta stages)"
     >
      <ficon name="sync" size={9} />
      <ftext size={10}>desinc</ftext>
     </fbox>
    ) : null}
    {feature.badge ? (
     <fbox
      title={`${feature.badge.done}/${feature.badge.total} fases raíz commiteadas en el board N2`}
     >
      <ftext
       size={10}
       cls="pl-metric"
       color="var(--vscode-charts-green, #4ec9b0)"
      >
       {feature.badge.done}/{feature.badge.total} fases
      </ftext>
     </fbox>
    ) : null}
   </fbox>

   {/* Renglón 3: botón nombrado por el spec (FR#13); la terminal no
    *  lleva botón (FR#6: post-ship vive con el badge). */}
   {col && !col.terminal ? (
    <fbutton
     variant={col.advanceKind === "ship" ? "primary" : "secondary"}
     onClick={() =>
      col.advanceKind === "ship"
       ? actions.onShip(feature.id)
       : actions.onAdvance(feature.id)
     }
     title={advanceTooltip(col, feature)}
    >
     <ficon name={col.advanceKind === "ship" ? "rocket" : "play"} size={10} />
     <ftext size={11} bold={col.advanceKind === "ship"}>
      {col.advanceLabel}
     </ftext>
    </fbutton>
   ) : null}
  </fbox>
 );
}

/** Tooltip del botón según el gesto declarado por el spec (FR#9/FR#13). */
function advanceTooltip(
 col: PanelColumnSpec,
 feature: PipelineFeatureView,
): string {
 if (col.advanceKind === "ship") {
  return feature.artifacts?.plan
   ? `Crear las fases de ${feature.artifacts.plan} como unidades backlog del board N2 (sin ejecutar nada)`
   : "Ship: no hay plan enlazado — completa /skill:plan primero";
 }
 return "Inyectar el comando de la skill al chat y mover la tarjeta al instante (movimiento temprano)";
}

/** FR#11 — mini-timeline de las etapas del spec: 4 estados por punto
 *  (completada, actual, próxima, pausada-ámbar cuando la feature está
 *  paused — el punto ACTUAL pasa a ámbar sin bloquear el avance). */
function MiniTimeline({
 spec,
 currentIndex,
 paused,
}: {
 spec: PanelSpec;
 currentIndex: number;
 paused?: boolean;
}): ReactElement {
 return (
  <fbox flexDirection="row" gap={2} alignItems="center">
   {spec.columns.map((c, i) => {
    const state =
     i < currentIndex
      ? "done"
      : i === currentIndex
       ? paused
        ? "paused"
        : "current"
       : "next";
    return (
     <fbox
      key={c.id}
      cls={`pl-dot ${state}`}
      title={`${c.label} — ${dotLabel(state)}`}
     />
    );
   })}
  </fbox>
 );
}

function dotLabel(state: string): string {
 if (state === "done") return "completada";
 if (state === "current") return "actual";
 if (state === "paused") return "pausada (el avance no se bloquea)";
 return "próxima";
}
```

#### 2. CSS del overlay

**File**: `webview/styles.css`
**Changes**: MODIFY. Bloque `pl-*` tras las `kb-*` (patrón de adiciones 12561+).

```css
/* ── Pipeline SDD N1 (/pipeline, panel colapsable footer) — espejo kb-* ── */
.pl-panel {
 border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
 border-radius: 6px;
 background: var(--vscode-sideBar-background, rgba(0, 0, 0, 0.1));
}
.pl-metric {
 font-variant-numeric: tabular-nums;
}
.pl-board {
 overflow-x: auto;
 scrollbar-width: thin;
 padding-bottom: 4px;
}
.pl-col {
 min-width: 190px;
 max-width: 260px;
 flex: 1 1 190px;
 gap: 6px;
}
.pl-col-dot {
 width: 8px;
 height: 8px;
 border-radius: 50%;
 flex-shrink: 0;
}
.pl-card {
 padding: 6px 8px;
 border-radius: 6px;
 background: var(--vscode-editor-background, #1e1e1e);
 border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
 transition:
  border-color 0.15s ease,
  background-color 0.15s ease;
}
.pl-card:hover {
 border-color: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.4));
 background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.06));
}
/* FR#12 — tarjeta desincronizada: borde ámbar sutil (patrón kb-gap). */
.pl-card.pl-card-desync {
 border-color: var(--vscode-list-warningForeground, #cca700);
 box-shadow: 0 0 0 1px var(--vscode-list-warningForeground, #cca700) inset;
}
.pl-card-bar {
 width: 3px;
 align-self: stretch;
 border-radius: 2px;
 flex-shrink: 0;
}
.pl-card-title {
 flex: 1;
 min-width: 0;
 white-space: nowrap;
 overflow: hidden;
 text-overflow: ellipsis;
}
/* FR#11 — mini-timeline: 4 estados por punto. */
.pl-dot {
 width: 7px;
 height: 7px;
 border-radius: 50%;
 flex-shrink: 0;
 background: var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
 transition: background-color 0.2s ease;
}
.pl-dot.done {
 background: var(--vscode-charts-green, #4ec9b0);
}
.pl-dot.current {
 background: var(--vscode-focusBorder, #58a6ff);
 box-shadow: 0 0 0 1px var(--vscode-focusBorder, #58a6ff) inset;
}
.pl-dot.paused {
 background: var(--vscode-list-warningForeground, #cca700);
 box-shadow: 0 0 0 1px var(--vscode-list-warningForeground, #cca700) inset;
}
.pl-dot.next {
 background: var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
}
.pl-badges {
 flex-wrap: wrap;
 row-gap: 2px;
}
.pl-badges > * {
 flex-shrink: 0;
 white-space: nowrap;
}
/* FR#12 — ámbar desincronizado (contador del header y badge de tarjeta). */
.pl-desync {
 color: var(--vscode-list-warningForeground, #cca700);
 user-select: none;
}
/* FR#11 — icono de pausa en la tarjeta. */
.pl-paused {
 color: var(--vscode-list-warningForeground, #cca700);
}
/* FR#14 — banner ámbar dismissible. */
.pl-warn {
 display: flex;
 align-items: center;
 gap: 6px;
 padding: 4px 8px;
 border-radius: 4px;
 border: 1px solid var(--vscode-list-warningForeground, #cca700);
 background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.1));
 color: var(--vscode-list-warningForeground, #cca700);
}
.pl-warn-text {
 flex: 1;
 min-width: 0;
 overflow: hidden;
 white-space: nowrap;
 text-overflow: ellipsis;
}
.pl-warn-dismiss {
 display: inline-flex;
 align-items: center;
 cursor: pointer;
 opacity: 0.7;
 padding: 2px;
 border-radius: 4px;
}
.pl-warn-dismiss:hover {
 opacity: 1;
 background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15));
}
/* FR#15 — estado vacío: comando monospace (patrón wf-cmd-hint). */
.pl-cmd {
 font-family: var(--vscode-editor-font-family, monospace);
 font-size: 10px;
 color: var(--vscode-descriptionForeground);
 opacity: 0.85;
}
/* FR#15 — contenedor del estado vacío. */
.pl-empty {
 padding: 4px 8px;
}
/* D5 — sección compacta del orquestador. */
.pl-orch {
 user-select: none;
 opacity: 0.9;
}
.pl-close {
 display: inline-flex;
 align-items: center;
 cursor: pointer;
 padding: 3px;
 border-radius: 4px;
 opacity: 0.7;
}
.pl-close:hover {
 opacity: 1;
 background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15));
}
```

#### 3. Wiring del host (3a-3g)

**File**: `src/extension.ts`
**Changes**: MODIFY. (3a) limpiar imports de frida-pipeline; (3b) imports nuevos de features-ui/features; (3c) descripción en BUILTIN_COMMANDS; (3d) case "pipeline"; (3e) `boardRemount` hermano en mountBoardOverlay; (3f) `pipelineRemount?.()` en webview_ready; (3g) eliminar `postPipelineCommand` y reemplazar por `mountPipelineOverlay` + `runEmptyPipelineCommand`.

```ts
// (3a) Import block de frida-pipeline (~147-162): quitar `formatPipelineStatus,`
// y `wirePipelinePanel,`. Queda:
import {
 computePipelineStatus,
 getModelsConfigPath,
 loadModelsConfig,
 invalidateModelsConfigCache,
 modelsConfigTemplate,
 syncBundledAgents,
 formatSyncReport,
 getBundledSkillNames,
} from "./tools/frida-pipeline";

// (3b) Imports nuevos junto al de board-ui (~133 — el host perfora
// submódulos de frida-workflow, patrón board-ui/store/plan-utils):
import {
 createPipelineOverlayElement,
 featureTitle,
} from "./tools/frida-workflow/features-ui";
import type { PipelineOverlayData } from "./tools/frida-workflow/features-ui";
import {
 advanceFeature,
 computeFeatureReconcile,
 loadFeatures,
 reconcileFeatures,
 shipBadge,
 shipFeature,
 subscribeFeaturesChanges,
} from "./tools/frida-workflow/features";

// (3c) BUILTIN_COMMANDS (~4225):
{
 name: "pipeline",
 description: "Pipeline SDD de planeación (features en discover→🚀 ready-to-ship)",
},

// (3d) case "pipeline" (~4351):
case "pipeline":
 await mountPipelineOverlay();
 break;

// (3e) mountBoardOverlay (~5071): declaración hermana de los handles del board
// + limpieza en onClose + asignación tras la suscripción:
let boardOverlayHandle: { unmount: () => void } | undefined;
let boardUnsubscribe: (() => void) | undefined;
/** Re-monta el board abierto con datos frescos: /pipeline (N1) lo invoca tras
 *  cada montaje suyo para quedar ARRIBA (orden de footers D8). */
let boardRemount: (() => void) | undefined;
// … en el onClose de las actions del board añadir `boardRemount = undefined;`
// y tras boardUnsubscribe = subscribeBoardChanges(…) añadir:
  // D8 — orden de footers: /pipeline (N1) re-monta el board abierto tras
  // cada montaje suyo para quedar ARRIBA (el board re-monta el workflow).
  boardRemount = () => {
   const fresh = loadBoard(cwd, planToken);
   mount(fresh ?? board);
  };

// (3f) webview_ready (~3062), tras `remountWorkflowPanel(s.webBridge);`:
    // Pipeline N1 (lección ba40da0): re-montaje idempotente si estaba
    // abierto; su cascada re-ordena board/workflow debajo (D8).
    pipelineRemount?.();

// (3g) ELIMINAR postPipelineCommand completo (~5543-5557) y reemplazar por:
 // /pipeline — overlay N1 del pipeline SDD (FR#1): TODAS las features de un
 // solo features.json (sin escalera de resolución del /board). El reconciler
 // adopta FRDs nuevos antes del primer render (FR#3); las suscripciones
 // (features + board N2) re-montan con datos frescos: movimiento temprano,
 // relink y badge n/m en vivo. Orden de footers (D8): N1 → N2 → workflow —
 // cada montaje de N1 re-monta la cascada completa (board si está abierto,
 // workflow SIEMPRE).
 let pipelineOverlayHandle: { unmount: () => void } | undefined;
 let pipelineUnsubscribe: (() => void) | undefined;
 /** Re-monta el overlay N1 con datos frescos si está abierto (webview_ready). */
 let pipelineRemount: (() => void) | undefined;
 /** FR#14 — banner ámbar de avance con prerrequisitos incompletos. Memoria
  *  de sesión del panel (D8): el dismiss persiste hasta un nuevo disparo. */
 const pipelineWarnings = new Map<string, string>();
 const pipelineWarningsDismissed = new Set<string>();

 async function mountPipelineOverlay(): Promise<void> {
  const s = await ensureSession();
  const cwd = workspaceCwd();
  pipelineOverlayHandle?.unmount();
  pipelineUnsubscribe?.();
  // FR#3 — adopción de FRDs antes del primer render (idempotente; si
  // adopta, su saveFeatures emite y la suscripción monta sola — el mount
  // final re-monta igual con datos frescos).
  reconcileFeatures(cwd);

  const buildData = (): PipelineOverlayData => {
   const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
   const desyncById = new Map(
    computeFeatureReconcile(cwd).map((r) => [r.id, r.desync]),
   );
   const status = computePipelineStatus();
   return {
    features: state.features.map((f) => ({
     ...f,
     desync: desyncById.get(f.id) ?? false,
     badge: shipBadge(cwd, f),
    })),
    status: {
     level: status.level,
     summary: `orquestador v${status.siblings.fridaVersion} · hermanas ${status.siblings.presentCount}/${status.siblings.expectedCount}`,
     detail:
      `Skills ${status.counts.skills.present}/${status.counts.skills.expected}` +
      ` · Agentes ${status.counts.agents.present}/${status.counts.agents.expected}` +
      ` · Workflows ${status.counts.workflows.present}/${status.counts.workflows.expected}` +
      (status.siblings.allPresent
       ? ""
       : ` — faltan: ${status.siblings.siblings
         .filter((x) => !x.present)
         .map((x) => x.id)
         .join(", ")}`),
    },
    warnings: [...pipelineWarnings.entries()]
     .filter(([id]) => !pipelineWarningsDismissed.has(id))
     .map(([id, text]) => ({ id, text })),
   };
  };

  const sRef = s;
  const mount = (data: PipelineOverlayData): void => {
   pipelineOverlayHandle?.unmount();
   pipelineOverlayHandle = sRef.webBridge.mountPersistent(
    () =>
     createPipelineOverlayElement(data, {
      onAdvance: (id) => {
      // FR#4 — movimiento temprano (#171): la tarjeta se mueve AL
      // CLIC y el comando viaja por el mismo pipeline que un submit
      // (runPrompt intercepta built-ins; /skill: pasa por B1). El
      // comando llega computado PRE-move (AdvanceResult.command).
      const r = advanceFeature(cwd, id, "pipeline-ui");
      if (r.moved && r.command) {
       void vscode.commands.executeCommand("frida.codeView.focus");
       runCustomCommand(r.command);
       // FR#14 — el emit SÍNCRONO de advanceFeature (dentro de
       // saveFeatures) ya re-montó ANTES de armar el warning:
       // si la memoria cambió, re-montamos para que el banner
       // ámbar sea visible AL DISPARO (el watcher llega en S6).
       let warningsChanged = false;
       if (!r.prerequisitesMet) {
        pipelineWarnings.set(
         id,
         `«${featureTitle(r.feature ?? { id })}» → ${r.to}: el artefacto previo no está en el FS — la skill podría no encontrarlo.`,
        );
        pipelineWarningsDismissed.delete(id);
        warningsChanged = true;
       } else if (pipelineWarnings.delete(id)) {
        warningsChanged = true;
       }
       if (warningsChanged) mount(buildData());
      }
     },
     onShip: (id) => {
      // FR#5 — ship manual N1→N2: fases del plan en backlog, CERO
      // ejecución (espejo del escalón /board: openBoard→saveBoard).
      const r = shipFeature(cwd, id, "pipeline-ui");
      if (r.moved) {
       post({
        type: "info",
        text: `🚀 Ship listo: ${r.phaseCount} fase(s) en backlog del board — /board ${r.planPath}`,
       });
      } else if (r.failure === "no-plan") {
       post({
        type: "warning",
        text: `«${featureTitle(r.feature ?? { id })}» no tiene plan enlazado — completa /skill:plan antes de shipear.`,
       });
      }
     },
     onRunEmptyCommand: runEmptyPipelineCommand,
     onDismissWarning: (id) => {
      pipelineWarningsDismissed.add(id);
      mount(buildData());
     },
     onClose: () => {
      pipelineOverlayHandle?.unmount();
      pipelineUnsubscribe?.();
      pipelineRemount = undefined;
     },
    }),
    "footer",
   );
   // D8 — orden de footers: N1 arriba → N2 (si abierto; su re-montaje lo
   // deja debajo de N1) → workflow SIEMPRE re-montado al final (el mount
   // interno del board NO lo re-monta — D8 manda AND, no OR).
   if (boardRemount) boardRemount();
   remountWorkflowPanel(sRef.webBridge);
  };

  pipelineRemount = () => mount(buildData());
  const offFeatures = subscribeFeaturesChanges(() => mount(buildData()));
  const offBoard = subscribeBoardChanges(() => mount(buildData()));
  pipelineUnsubscribe = () => {
   offFeatures();
   offBoard();
  };
  mount(buildData());
 }

 /** FR#15 — comando del estado vacío: el `<placeholder>` se completa con un
  *  InputBox (molde postWfCommand) y se inyecta por el canal estándar. */
 function runEmptyPipelineCommand(template: string): void {
  const ph = template.match(/<([^>]+)>/);
  if (!ph) {
   runCustomCommand(template);
   return;
  }
  void vscode.window
   .showInputBox({
    title: `Comando: ${template}`,
    prompt: `Valor para <${ph[1]}>`,
    placeHolder: `Ej. ${ph[1]}>`,
   })
   .then((val) => {
    if (!val || !val.trim()) return;
    void vscode.commands.executeCommand("frida.codeView.focus");
    runCustomCommand(template.replace(`<${ph[1]}>`, val.trim()));
   });
 }
```

#### 4. Baja del banner

**File**: `src/tools/frida-pipeline/banner.tsx`
**Changes**: DELETE. El banner del orquestador muere (D5): su estado pasa a OrchestratorSection.

```bash
rm src/tools/frida-pipeline/banner.tsx
# El banner del orquestador muere (D5): su estado pasa a OrchestratorSection
# del overlay N1 (features-ui.tsx). Sin consumidores restantes: la baja de
# postPipelineCommand (extension.ts, cambio 3g) y del reexport (index.ts) es
# ATÓMICA con el case nuevo — nunca ambos wiring vivos (Ordering Constraint S5).
# Verificado por slice-verifier: grep global src/ + test/ con cero imports de
# bannerStore/createPipelineBannerElement fuera de banner.tsx/panel.ts.
```

#### 5. Baja del panel del orquestador

**File**: `src/tools/frida-pipeline/panel.ts`
**Changes**: DELETE. wirePipelinePanel/mountPipelinePanel sin consumidor tras la absorción.

```bash
rm src/tools/frida-pipeline/panel.ts
# wirePipelinePanel/mountPipelinePanel/_resetPipelinePanel/PipelineWebBridge
# quedan sin consumidor: el montaje del overlay N1 lo hace mountPipelineOverlay
# (extension.ts) vía sRef.webBridge.mountPersistent — el archivo (y su patrón
# de wiring idempotente) ya fueron absorbidos por mountPipelineOverlay.
# computePipelineStatus/formatPipelineStatus sobreviven en setup-command.ts
# (los consume mountPipelineOverlay y siblings.test.ts/skills-lote*.test.ts).
```

#### 6. Reexports limpios

**File**: `src/tools/frida-pipeline/index.ts`
**Changes**: MODIFY. Quita el bloque de reexports de banner/panel; conserva todo lo demás.

```ts
// ELIMINAR el bloque completo de reexports del wire del banner (index.ts:62-68):
// // Wire del banner
// export {
//  wirePipelinePanel,
//  mountPipelinePanel,
//  _resetPipelinePanel,
// } from "./panel";
// export type { PipelineWebBridge } from "./panel";
//
// Conservar TODO lo demás sin cambios: computePipelineStatus/formatPipelineStatus
// (setup-command), siblings, guidance, git-context, session-hooks,
// pipeline-pointer, agents-sync, skills-sync, models-config, session-capture,
// skill-bracket, constants, workflows. Verificado: siblings.test.ts y
// skills-lote*.test.ts importan de setup-command/siblings DIRECTAMENTE (no
// del index) — cero consumidores de los símbolos eliminados (grep src/ + test/).
```

#### 7. Test de cableado del overlay (contrato que monta `case "pipeline"`)

**File**: `test/frida-workflow/pipeline-wiring.test.ts`
**Changes**: NEW. (Fix Step 4 — precedente 32d874d: «tests punta a punta del cableado desde el inicio».) `extension.ts` no es importable desde vitest (clausuras dentro de `activate`); este test afirma el CONTRATO que el case monta y que los handlers consumen.

```ts
// pipeline-wiring.test.ts — contrato de cableado del overlay N1 (fix Step 4;
// precedente 32d874d: «tests punta a punta del cableado desde el inicio»).
// extension.ts no es importable desde vitest (clausuras dentro de activate):
// este test afirma el CONTRATO que el case "pipeline" monta y que los
// handlers onAdvance/onShip consumen — el elemento del overlay renderiza
// desde spec + dominio, y advanceFeature entrega el comando pre-move exacto
// que el handler reenvía por runCustomCommand.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
 createPipelineOverlayElement,
 type PipelineFeatureView,
 type PipelineOverlayActions,
 type PipelineOverlayData,
} from "../../src/tools/frida-workflow/features-ui";
import { advanceFeature, saveFeatures } from "../../src/tools/frida-workflow/features";

let tmp: string;

beforeEach(() => {
 tmp = mkdtempSync(path.join(tmpdir(), "pipeline-wiring-"));
});

const actions: PipelineOverlayActions = {
 onAdvance: () => {},
 onShip: () => {},
 onRunEmptyCommand: () => {},
 onDismissWarning: () => {},
 onClose: () => {},
};

const STATUS = {
 level: "ready" as const,
 summary: "orquestador v3.4.1 · hermanas 5/5",
 detail: "Skills 5/5 · Agentes 4/4 · Workflows 3/3",
};

function view(overrides: Partial<PipelineFeatureView>): PipelineFeatureView {
 return {
  id: ".frida/artifacts/discover/2026-01-01_10-00-00_wiring.md",
  stage: "discover",
  history: [],
  desync: false,
  ...overrides,
 };
}

function data(features: PipelineFeatureView[]): PipelineOverlayData {
 return { features, status: STATUS, warnings: [] };
}

describe("wiring — el elemento que monta case \"pipeline\"", () => {
 it("renderiza las 5 columnas del spec y el botón nombrado (FR#1/FR#13)", () => {
  const html = renderToStaticMarkup(
   createPipelineOverlayElement(data([view({})]), actions),
  );
  for (const label of [
   "discover",
   "research",
   "design",
   "plan",
   "ready-to-ship",
  ])
   expect(html).toContain(label);
  expect(html).toContain("Continuar a research →");
 });

 it("pinta ámbar desinc, badge n/m y sección orquestador (FR#12/FR#6/D5)", () => {
  const html = renderToStaticMarkup(
   createPipelineOverlayElement(
    data([view({ stage: "ready-to-ship", desync: true, badge: { done: 2, total: 3 } })]),
    actions,
   ),
  );
  expect(html).toContain("desinc");
  expect(html).toContain("2/3 fases");
  expect(html).toContain("orquestador");
 });

 it("EmptyState con el comando accionable cuando no hay features (FR#15)", () => {
  const html = renderToStaticMarkup(
   createPipelineOverlayElement(data([]), actions),
  );
  expect(html).toContain("/skill:discover");
 });
});

describe("wiring — el comando exacto que onAdvance reenvía (FR#4)", () => {
 it("advanceFeature entrega /skill:<etapa-destino> <frd> computado PRE-move", () => {
  const rel = ".frida/artifacts/discover/2026-01-01_10-00-00_wiring.md";
  const abs = path.join(tmp, ...rel.split("/"));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "---\nstatus: ready\n---\n\n# doc\n", "utf8");
  saveFeatures(tmp, {
   v: 1,
   features: [{ id: rel, stage: "discover", history: [] }],
   updatedAt: "",
  });
  const r = advanceFeature(tmp, rel, "pipeline-ui");
  expect(r.moved).toBe(true);
  expect(r.command).toBe(`/skill:research ${rel}`); // lo que va a runCustomCommand
 });
});
```

### Success Criteria

#### Automated Verification

- [ ] Typecheck del proyecto verde: `npm run typecheck`
- [ ] Suites del ecosistema afectado pasan: `npx vitest run test/frida-workflow test/frida-pipeline`
- [ ] Test de cableado del overlay N1 pasa (contrato que monta `case "pipeline"`): `npx vitest run test/frida-workflow/pipeline-wiring.test.ts`
- [ ] `grep -n "await mountPipelineOverlay();" src/extension.ts` retorna una línea (case pipeline absorbido — nunca ambos wiring vivos)
- [ ] `grep -c "wirePipelinePanel\|postPipelineCommand\|formatPipelineStatus" src/extension.ts` retorna 0 (baja atómica del banner en el host)
- [ ] `test ! -f src/tools/frida-pipeline/banner.tsx && test ! -f src/tools/frida-pipeline/panel.ts` pasa (archivos eliminados)
- [ ] `grep -n "export function createPipelineOverlayElement" src/tools/frida-workflow/features-ui.tsx` retorna una línea (contrato espejo board-ui.tsx:37)
- [ ] `grep -c "\.pl-" webview/styles.css` retorna >= 12 (CSS del overlay N1)
- [ ] `grep -n "pipelineRemount?.();" src/extension.ts` retorna una línea (re-montaje webview_ready, lección ba40da0)

#### Manual Verification

- [ ] `/pipeline` abre overlay colapsable con 5 columnas discover|research|design|plan|🚀 ready-to-ship, lenguaje visual de /board (FR#1)
- [ ] Workspace limpio: EmptyState muestra `/skill:discover <idea>` y el botón pide la idea (InputBox) antes de inyectar (FR#15)
- [ ] ▶ «Continuar a research →»: tarjeta se mueve AL CLIC y el chat recibe `/skill:research <ruta-frd>` (FR#4)
- [ ] Avance sin insumo previo: banner ámbar dismissible; el dismiss persiste en re-mounts y un nuevo disparo lo re-arma (FR#14)
- [ ] Con plan listo: ▶ «Ship → fases a ejecución» crea fases en backlog (`/board <plan>`: transiciones vacías) y la tarjeta pasa a 🚀 ready-to-ship con badge n/m (FR#5/FR#6)
- [ ] Transición de un run del board N2: el badge n/m de la tarjeta shipeada se refresca en vivo (suscripción board)
- [ ] Feature con `paused: true`: punto actual del mini-timeline en ámbar + icono pausa con tooltip «no bloquea» (FR#11)
- [ ] Artefacto nuevo en el FS sin tarjeta movida: ámbar «desinc» en la tarjeta + contador en el header (FR#12)
- [ ] Sección orquestador compacta al fondo: nivel + versión + hermanas; conteos en tooltip (D5)
- [ ] Developer: Reload Webviews con el panel abierto: reaparece (ba40da0) y el orden de footers queda Pipeline → Board → Workflow (D8)
- [ ] Pass de pulido visual presupuestado tras la primera sesión de uso (precedente /board: 5 fixes el mismo día)

---

## Phase 6: Servidor HTTP+SSE + watcher

### Overview

Crea el servidor HTTP+SSE loopback del monitor (FR#7/FR#8): bind 127.0.0.1 puerto efímero, token `randomUUID` por proceso, GET abiertos (`/` y `/sdd` con página mínima autocontenida que la Fase 7 reemplaza, `/api/state` con reconcile por GET, `/events` SSE con replay Last-Event-ID y heartbeat unref), POST autenticado con 401-sin-token (delta consciente vs 403 de la plantilla ui-server.ts:634), funnel debounce 250ms que funde señales in-process (suscripciones features+board) y externas (watcher recursivo sobre `.frida/artifacts/` con tolerancia tmp+rename y fallback plano, D2), y su wiring como Disposable en `context.subscriptions` desde activate (3h, D3). Nota de orden: el diseño exige Slice 6 tras 1-4; esta fase añade dependencia de la Fase 5 porque comparten `src/extension.ts` y `src/tools/frida-workflow/index.ts` (evita conflictos en worktrees paralelos).

### Changes Required

#### 1. Servidor del monitor

**File**: `src/tools/frida-workflow/monitor-server.ts`
**Changes**: NEW. Snapshot `MonitorSnapshot`, servidor HTTP+SSE, watcher recursivo con debounce, POST advance/pause/ship. La página mínima (`monitorBootstrapPage`) se retira en la Fase 7.

Variante **intermedia de la Fase 6** (la página mínima autocontenida `monitorBootstrapPage` sirve `/` y `/sdd`; el resto es verbatim del Architecture). La Fase 7 retira esta sección y sirve las páginas reales de `monitor-html.ts` (verificado por el AC `grep -c "monitorBootstrapPage" … = 0`):

```ts
// monitor-server.ts — servidor HTTP+SSE loopback del monitor del pipeline (FR#7/FR#8).
//
// Espejo de la plantilla node_modules/pi-mcp-adapter/ui-server.ts: token
// randomUUID por proceso, SSE Set + replay Last-Event-ID, heartbeat .unref()
// y listen en puerto efímero de 127.0.0.1. Tres deltas deliberados:
// - GET/SSE SIN token (el monitor es un espejo de sólo lectura en loopback);
//   POST exige token y responde 401 sin él (el FRD manda 401; la plantilla
//   responde 403 — delta consciente, ver Verification Notes).
// - Vida larga (D3): activo desde activate() como Disposable en
//   context.subscriptions (patrón status bar extension.ts:6874-6901), no
//   efímero por tool-call como la plantilla.
// - Watcher propio (D2): fs.watch recursivo sobre .frida/artifacts/ con
//   funnel debounce 250ms (una reconciliación + broadcast por ráfaga) y
//   tolerancia tmp+rename (eventos *.tmp se ignoran; el rename del archivo
//   final dispara el re-escaneo). .rpiv/ NO se vigila (seed sólo-lectura).
//   Fallback a watchers planos si recursive no está soportado (Linux
//   pre-Node-20) y re-arme por request si .frida aún no existe.
//
// Páginas / y /sdd (FR#7): Slice 6 — página MÍNIMA autocontenida
// (monitorBootstrapPage: título "Frida Monitor" + snapshot legible). El
// Slice 7 (monitor-html.ts) la REEMPLAZA: hub de métodos (D7) en / y N1+N2
// juntos con detalle por feature (FR#16) en /sdd, con el token embebido para
// los POST autenticados (FR#8); GET/SSE siguen abiertos. El contrato
// servidor↔HTML es el snapshot (MonitorSnapshot) + los POST /api/*.

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
 isUnitDone,
 subscribeBoardChanges,
 validateFails,
 type Board,
 type BoardUnit,
} from "./board";
import {
 advanceFeature,
 computeFeatureReconcile,
 loadFeatures,
 reconcileFeatures,
 setFeaturePaused,
 shipBadge,
 shipFeature,
 subscribeFeaturesChanges,
 type PipelineFeature,
 type ShipBadge,
} from "./features";
import { listPanelSpecs, type PanelSpec } from "./panel-spec";

// ── Constantes ──────────────────────────────────────────────────────────────

/** Debounce del funnel (D2/Performance: un solo re-escaneo por ráfaga). */
export const MONITOR_DEBOUNCE_MS = 250;

/** Heartbeat SSE (plantilla ui-server.ts:513-522): limpia conexiones muertas. */
const HEARTBEAT_MS = 30_000;

/** Replay Last-Event-ID: cada evento es un snapshot COMPLETO ⇒ 20 sobran. */
const MAX_EVENT_LOG = 20;

/** Cuerpos JSON chicos (ids/comandos); protege contra bodies basura. */
const MAX_BODY_BYTES = 64 * 1024;

/** Raíz vigilada por el watcher (`.rpiv/` NO se vigila — D2). */
const ARTIFACTS_REL = ".frida/artifacts";

// ── Snapshot (contrato servidor↔HTML; FR#7/FR#12/FR#16) ────────────────────

/** Unidad N2 vista por el monitor (jerarquía de splits vía parentId). */
export interface MonitorUnitView {
 id: string;
 title?: string;
 parentId?: string;
 status: string;
 /** done resuelto con isUnitDone (columna done o todas las hojas done). */
 done: boolean;
 /** Zigzags de validate (badge del tablero; board.ts validateFails). */
 validateFails: number;
 /** Nº de transiciones (densidad de trabajo de la fase). */
 transitions: number;
}

/** Board N2 espejo (uno por `.frida/artifacts/board/<slug>.json`). */
export interface MonitorBoardView {
 /** planPath del board (token del board N2; feature.planPath apunta aquí). */
 path: string;
 columns: string[];
 doneColumn: string;
 units: MonitorUnitView[];
}

/** Feature N1 con derivados frescos (los mismos que el host del overlay). */
export interface MonitorFeatureView extends PipelineFeature {
 title: string;
 /** FR#12 — el FS va más adelante que la tarjeta. */
 desync: boolean;
 /** FR#6 — badge «n/m fases» post-ship. */
 badge?: ShipBadge;
}

/** Estado completo del ecosistema servido por /api/state y cada evento SSE. */
export interface MonitorSnapshot {
 generatedAt: string;
 /** FR#9/FR#7 — catálogo de métodos del motor (hub del monitor). */
 specs: PanelSpec[];
 features: MonitorFeatureView[];
 boards: MonitorBoardView[];
}

// ── Derivados ───────────────────────────────────────────────────────────────

/** Mismo derivado que featureTitle (features-ui.tsx). Duplicado AQUÍ a
 *  propósito: el servidor vive en el bundle del DSL (dist/frida-workflow.js)
 *  y no debe importar módulos de UI (features-ui arrastra React al bundle). */
function featureTitleOf(f: { id: string; title?: string }): string {
 if (f.title) return f.title;
 const base = f.id.split("/").pop() ?? f.id;
 return (
  base
   .replace(/\.md$/, "")
   .replace(/^\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?_/, "") || base
 );
}

/** Boards N2: readdir + parse defensivo (corrupto/a-medias ⇒ skip, no rompe). */
function readBoardsSnapshot(cwd: string): MonitorBoardView[] {
 const dir = join(cwd, ".frida", "artifacts", "board");
 let files: string[];
 try {
  files = readdirSync(dir).filter((f) => f.endsWith(".json"));
 } catch {
  return [];
 }
 const out: MonitorBoardView[] = [];
 for (const f of files) {
  try {
   const board = JSON.parse(readFileSync(join(dir, f), "utf8")) as Board;
   if (!Array.isArray(board.units) || !Array.isArray(board.columns)) continue;
   out.push({
    path: board.planPath ?? f,
    columns: [...board.columns],
    doneColumn: board.doneColumn,
    units: board.units.map((u: BoardUnit) => ({
     id: u.id,
     title: u.title,
     parentId: u.parentId,
     status: u.status,
     done: isUnitDone(board, u),
     validateFails: validateFails(u),
     transitions: Array.isArray(u.transitions) ? u.transitions.length : 0,
    })),
   });
  } catch {
   continue; // board corrupto o tmp+rename a medias de otro escritor
  }
 }
 return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Snapshot fresco del ecosistema (una sola fuente para GET/SSE/Slice 7). */
export function buildMonitorSnapshot(cwd: string): MonitorSnapshot {
 const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
 const desyncById = new Map(
  computeFeatureReconcile(cwd).map((r) => [r.id, r.desync] as const),
 );
 return {
  generatedAt: new Date().toISOString(),
  specs: [...listPanelSpecs()],
  features: state.features.map((f) => ({
   ...f,
   title: featureTitleOf(f),
   desync: desyncById.get(f.id) ?? false,
   badge: shipBadge(cwd, f),
  })),
  boards: readBoardsSnapshot(cwd),
 };
}

// ── Helpers HTTP (plantilla ui-server.ts, adaptados) ────────────────────────

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
 res.writeHead(status, {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
 });
 res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
 res.writeHead(200, {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
 });
 res.end(html);
}

/** POST auth: header propio o Bearer (FR#8). 401 lo decide el caller. */
function authorized(req: IncomingMessage, token: string): boolean {
 const h = req.headers["x-frida-monitor-token"];
 if (typeof h === "string") return h === token;
 return req.headers.authorization === `Bearer ${token}`;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
 return new Promise((resolve, reject) => {
  let size = 0;
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => {
   size += chunk.length;
   if (size > MAX_BODY_BYTES) {
    req.destroy();
    reject(new Error("cuerpo demasiado grande"));
    return;
   }
   chunks.push(chunk);
  });
  req.on("end", () => {
   try {
    resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
   } catch (e) {
    reject(e);
   }
  });
  req.on("error", reject);
 });
}

/** Cierre total aunque queden keep-alives (molde oauth.ts closeServerGracefully). */
function closeServerGracefully(server: http.Server): void {
 const s = server as http.Server & { closeAllConnections?: () => void };
 if (typeof s.closeAllConnections === "function") s.closeAllConnections();
 server.close();
}

// ── Página mínima (Slice 7 — monitor-html.ts la reemplaza: hub D7 en / y
//    /sdd real con token embebido; retiro verificado por grep -c
//    "monitorBootstrapPage" = 0) ──────────────────────────────────────────

/** Página autocontenida mínima del Slice 6: título "Frida Monitor" +
 *  resumen del snapshot. Los tests de arranque asumen
 *  toContain("Frida Monitor") en AMBAS rutas (/ y /sdd) — la página real
 *  del Slice 7 conserva ese título (monitor-html.test.ts lo afirma). */
function monitorBootstrapPage(snapshot: MonitorSnapshot): string {
 return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frida Monitor</title>
<style>
body{margin:24px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;
color:#3b3b3b;background:#ffffff}
@media (prefers-color-scheme: dark){body{color:#cccccc;background:#1e1e1e}}
h1{font-size:16px;margin:0 0 4px}.sub{opacity:.7}
ul{margin:8px 0;padding-left:18px}code{font-family:ui-monospace,monospace;font-size:11px}
</style>
</head>
<body>
<h1>Frida Monitor</h1>
<p class="sub">Página mínima del servidor (Slice 6) — la página real llega en el Slice 7.</p>
<ul>
<li>Métodos: ${snapshot.specs.map((s) => s.id).join(", ")}</li>
<li>Features: ${snapshot.features.length} · Boards N2: ${snapshot.boards.length} · snapshot ${snapshot.generatedAt}</li>
</ul>
<p>API: <code>/api/state</code> · SSE: <code>/events</code> · POST: <code>/api/advance|pause|ship</code> (token).</p>
</body>
</html>`;
}

// ── Servidor ────────────────────────────────────────────────────────────────

export interface PipelineMonitorOptions {
 cwd: string;
 /** FR#4 por POST (Desired End State): el host inyecta el comando al chat
  *  por el MISMO canal que el overlay (focus + runCustomCommand). */
 onCommand?: (command: string) => void;
}

export interface PipelineMonitorHandle {
 /** `http://127.0.0.1:<puerto-efímero>/` (Slice 8 la envía al webview). */
 url: string;
 port: number;
 /** Token por proceso: POST lo exige; el HTML lo recibe embebido (Slice 7). */
 token: string;
 dispose(): void;
}

export async function startPipelineMonitor(
 options: PipelineMonitorOptions,
): Promise<PipelineMonitorHandle> {
 const cwd = options.cwd;
 const token = randomUUID();
 let disposed = false;

 // ── SSE: clientes, log con replay y broadcast (plantilla ui-server) ──────
 const sseClients = new Set<ServerResponse>();
 const eventLog: Array<{ id: number; data: string }> = [];
 let eventSeq = 0;

 const sseFrame = (id: number, data: string): string =>
  `id: ${id}\nevent: snapshot\ndata: ${data}\n\n`;

 const dropClient = (res: ServerResponse): void => {
  sseClients.delete(res);
  try {
   res.end();
  } catch {
   /* ya muerta */
  }
 };

 /** Registra el evento en el log (replay) y lo devuelve sin fanout. */
 const pushEvent = (data: string): { id: number; data: string } => {
  const id = ++eventSeq;
  eventLog.push({ id, data });
  if (eventLog.length > MAX_EVENT_LOG)
   eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
  return { id, data };
 };

 const broadcastSnapshot = (): void => {
  if (disposed) return;
  const ev = pushEvent(JSON.stringify(buildMonitorSnapshot(cwd)));
  const chunk = sseFrame(ev.id, ev.data);
  for (const c of sseClients) {
   try {
    c.write(chunk);
   } catch {
    dropClient(c);
   }
  }
 };

 // ── Funnel debounce: TODAS las señales (emit in-process + watcher)
 //    convergen aquí — un solo reconcile+broadcast por ráfaga. El guard
 //    `flushing` evita que el emit SÍNCRONO de reconcileFeatures (dentro de
 //    saveFeatures) re-agende el flush que ya está corriendo. ───────────────
 let flushTimer: ReturnType<typeof setTimeout> | null = null;
 let flushing = false;

 const flush = (): void => {
  if (disposed) return;
  flushing = true;
  try {
   // D4 — adopción/relink idempotente ante escritores EXTERNOS (.md nuevos,
   // features.json tocado por bash); su propio emit no re-agenda (guard).
   reconcileFeatures(cwd);
  } finally {
   flushing = false;
  }
  if (watchMode === "flat") syncFlatWatchers(); // buckets nuevos (fallback)
  broadcastSnapshot();
 };

 const scheduleFlush = (): void => {
  if (disposed || flushTimer || flushing) return;
  flushTimer = setTimeout(() => {
   flushTimer = null;
   flush();
  }, MONITOR_DEBOUNCE_MS);
  flushTimer.unref?.();
 };

 // ── Watcher (D2) ─────────────────────────────────────────────────────────
 const watchers: FSWatcher[] = [];
 let watchMode: "none" | "recursive" | "flat" = "none";

 const closeWatchers = (): void => {
  for (const w of watchers) {
   try {
    w.close();
   } catch {
    /* ya cerrado */
   }
  }
  watchers.length = 0;
 };

 /** Evento bajo la raíz vigilada: filtra tmp y fuera de .frida/artifacts. */
 const onFsEvent = (rootRel: string, filename: string | Buffer | null): void => {
  if (disposed) return;
  if (typeof filename !== "string") {
   scheduleFlush(); // sin nombre: conservador
   return;
  }
  let rel = filename.replace(/\\/g, "/");
  if (rootRel !== ARTIFACTS_REL) {
   // vigilando .frida: sólo importa lo que vive bajo artifacts/
   if (!rel.startsWith("artifacts/") && rel !== "artifacts") return;
   rel = `${rootRel}/${rel}`;
  }
  if (rel.endsWith(".tmp")) return; // tmp+rename: el rename dispara el re-escaneo
  scheduleFlush();
 };

 /** Evento de un watcher PLANO (fallback): filename es basename. */
 const onFlatEvent = (filename: string | Buffer | null): void => {
  if (typeof filename === "string" && filename.endsWith(".tmp")) return;
  scheduleFlush();
 };

 /** Re-arma los watchers planos (artifacts + cada bucket existente). */
 const syncFlatWatchers = (): void => {
  closeWatchers();
  const artifactsDir = join(cwd, ARTIFACTS_REL);
  try {
   watchers.push(watch(artifactsDir, (_e, f) => onFlatEvent(f)));
   for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    watchers.push(
     watch(join(artifactsDir, entry.name), (_e, f) => onFlatEvent(f)),
    );
   }
  } catch {
   /* sin watchers esta ronda: el GET /api/state sigue reconciliando */
  }
 };

 /** Idempotente; barato; el handler lo llama por request para re-armar
  *  cuando .frida aparece tarde (workspace limpio). */
 const armWatcher = (): void => {
  if (disposed || watchMode !== "none") return;
  const artifactsDir = join(cwd, ARTIFACTS_REL);
  try {
   if (existsSync(artifactsDir)) {
    watchers.push(
     watch(artifactsDir, { recursive: true }, (_e, f) =>
      onFsEvent(ARTIFACTS_REL, f),
     ),
    );
    watchMode = "recursive";
    return;
   }
   const fridaDir = join(cwd, ".frida");
   if (existsSync(fridaDir)) {
    // artifacts aún no existe: vigilar el padre para capturar su creación.
    watchers.push(
     watch(fridaDir, { recursive: true }, (_e, f) => onFsEvent(".frida", f)),
    );
    watchMode = "recursive";
    return;
   }
   return; // ni .frida: se rearma en el próximo request
  } catch {
   // recursive no soportado (Linux pre-Node-20): fallback plano por bucket
  }
  try {
   if (!existsSync(artifactsDir)) return;
   syncFlatWatchers();
   watchMode = "flat";
  } catch {
   /* sin watcher: el snapshot por GET sigue vivo */
  }
 };

 // ── Suscripciones in-process (overlay ▶, runs del board N2, POST) ────────
 const offFeatures = subscribeFeaturesChanges(scheduleFlush);
 const offBoard = subscribeBoardChanges(scheduleFlush);

 // ── Heartbeat (plantilla ui-server.ts:513-522, unref) ────────────────────
 const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
  for (const c of sseClients) {
   try {
    c.write(": hb\n\n");
   } catch {
    dropClient(c);
   }
  }
 }, HEARTBEAT_MS);
 heartbeat.unref?.();

 // ── Rutas ────────────────────────────────────────────────────────────────
 const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
 ): Promise<void> => {
  armWatcher(); // idempotente; rearma cuando .frida aparece
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  // GET abiertos (D8): páginas del monitor (Slice 6: página mínima; Slice 7:
  // monitor-html), snapshot y SSE — sin token. El token viaja EMBEBIDO en
  // /sdd para los POST (FR#8) cuando llega la página real (Slice 7).
  if (method === "GET" && url.pathname === "/") {
   // Slice 6: página mínima; el Slice 7 sirve renderMonitorHubPage().
   sendHtml(res, monitorBootstrapPage(buildMonitorSnapshot(cwd)));
   return;
  }

  if (method === "GET" && url.pathname === "/sdd") {
   // Slice 6: página mínima; el Slice 7 sirve renderSddPage(token).
   sendHtml(res, monitorBootstrapPage(buildMonitorSnapshot(cwd)));
   return;
  }

  if (method === "GET" && url.pathname === "/api/state") {
   // FR#3 también por GET: adopción visible al refrescar aunque el watcher
   // no pudiera armarse (idempotente: sin cambios no escribe).
   reconcileFeatures(cwd);
   sendJson(res, 200, buildMonitorSnapshot(cwd));
   return;
  }

  if (method === "GET" && url.pathname === "/events") {
   res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
   });
   res.write(": connected\n\n");
   sseClients.add(res);
   // Replay Last-Event-ID (plantilla replayEvents): cada evento es un
   // snapshot completo ⇒ re-entregar lo perdido alcanza. Sin header (o log
   // podado / servidor reiniciado con id mayor) se envía el snapshot actual
   // SOLO a este cliente como primer evento.
   const header = req.headers["last-event-id"];
   const parsed = header ? Number(header) : Number.NaN;
   const missed = Number.isFinite(parsed)
    ? eventLog.filter((e) => e.id > parsed)
    : [];
   if (missed.length > 0) {
    for (const e of missed) {
     try {
      res.write(sseFrame(e.id, e.data));
     } catch {
      dropClient(res);
      break;
     }
    }
   } else {
    const ev = pushEvent(JSON.stringify(buildMonitorSnapshot(cwd)));
    try {
     res.write(sseFrame(ev.id, ev.data));
    } catch {
     dropClient(res);
    }
   }
   req.on("close", () => {
    sseClients.delete(res);
   });
   return;
  }

  if (method !== "POST") {
   sendJson(res, 404, { error: "no encontrado" });
   return;
  }

  // POST: token SIEMPRE primero (FR#8 — 401; delta consciente vs 403).
  if (!authorized(req, token)) {
   sendJson(res, 401, {
    error: "token requerido (x-frida-monitor-token o Authorization Bearer)",
   });
   return;
  }

  let body: unknown;
  try {
   body = await readJsonBody(req);
  } catch {
   sendJson(res, 400, { error: "cuerpo JSON inválido" });
   return;
  }
  const id = (body as { id?: unknown }).id;
  if (typeof id !== "string" || !id.trim()) {
   sendJson(res, 400, { error: "id requerido (ruta relativa del FRD)" });
   return;
  }

  if (url.pathname === "/api/advance") {
   const r = advanceFeature(cwd, id, "monitor");
   if (r.moved && r.command) options.onCommand?.(r.command);
   sendJson(res, 200, {
    moved: r.moved,
    prerequisitesMet: r.prerequisitesMet,
    to: r.to,
    command: r.command,
    warning:
     r.moved && !r.prerequisitesMet
      ? `«${featureTitleOf(r.feature ?? { id })}» → ${r.to}: el artefacto previo no está en el FS — la skill podría no encontrarlo.`
      : undefined,
   });
   return;
  }

  if (url.pathname === "/api/pause") {
   const paused = (body as { paused?: unknown }).paused;
   if (typeof paused !== "boolean") {
    sendJson(res, 400, { error: "paused requiere boolean" });
    return;
   }
   const f = setFeaturePaused(cwd, id, paused, "monitor");
   sendJson(
    res,
    200,
    f ? { ok: true, paused: f.paused } : { ok: false, error: "missing" },
   );
   return;
  }

  if (url.pathname === "/api/ship") {
   const r = shipFeature(cwd, id, "monitor");
   sendJson(res, 200, {
    moved: r.moved,
    failure: r.failure,
    phaseCount: r.phaseCount,
    planPath: r.planPath,
    warning:
     r.failure === "no-plan"
      ? `«${featureTitleOf(r.feature ?? { id })}» no tiene plan enlazado — completa /skill:plan antes de shipear.`
      : undefined,
   });
   return;
  }

  sendJson(res, 404, { error: "no encontrado" });
 };

 const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e: unknown) => {
   try {
    sendJson(res, 500, {
     error: e instanceof Error ? e.message : String(e),
    });
   } catch {
    /* respuesta ya volada */
   }
  });
 });

 const dispose = (): void => {
  if (disposed) return;
  disposed = true;
  if (flushTimer) {
   clearTimeout(flushTimer);
   flushTimer = null;
  }
  clearInterval(heartbeat);
  offFeatures();
  offBoard();
  closeWatchers();
  for (const c of sseClients) {
   try {
    c.end();
   } catch {
    /* ya muerta */
   }
  }
  sseClients.clear();
  closeServerGracefully(server);
 };

 armWatcher(); // primer intento (workspace ya con .frida)
 return await new Promise<PipelineMonitorHandle>((resolve, reject) => {
  server.once("error", (e: Error) => {
   dispose();
   reject(e);
  });
  server.listen(0, "127.0.0.1", () => {
   const address = server.address();
   if (!address || typeof address === "string") {
    dispose();
    reject(new Error("dirección del monitor inválida"));
    return;
   }
   resolve({
    url: `http://127.0.0.1:${address.port}/`,
    port: address.port,
    token,
    dispose,
   });
  });
 });
}
```

#### 2. Tests del servidor

**File**: `test/frida-workflow/monitor-server.test.ts`
**Changes**: NEW. Arranque loopback, auth 401/400/404, snapshot por GET, POST advance/pause/ship, SSE broadcast+replay, watcher externo y tmp+rename, workspace limpio.

```ts
// monitor-server.test.ts — servidor HTTP+SSE + watcher del monitor (FR#7/FR#8).
// Molde: test/frida-workflow/board.test.ts (fixture tmp + mkdtemp). La
// plantilla del servidor es node_modules/pi-mcp-adapter/ui-server.ts; los
// deltas del FRD (401 sin token en POST, GET abierto, vida larga) se afirman
// aquí. Los tests de SSE usan fetch-streaming con un lector en background y
// márgenes derivados de MONITOR_DEBOUNCE_MS (NFR <1s con debounce incluido).
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
 MONITOR_DEBOUNCE_MS,
 startPipelineMonitor,
 type PipelineMonitorHandle,
} from "../../src/tools/frida-workflow/monitor-server";
import {
 featuresFilePath,
 loadFeatures,
 reconcileFeatures,
 saveFeatures,
} from "../../src/tools/frida-workflow/features";

let tmp: string;
let handle: PipelineMonitorHandle | undefined;
let sse: SseConnection | undefined;

beforeEach(() => {
 tmp = mkdtempSync(path.join(tmpdir(), "monitor-test-"));
});

afterEach(async () => {
 await sse?.close();
 sse = undefined;
 handle?.dispose(); // idempotente
 handle = undefined;
 vi.restoreAllMocks();
});

async function startMonitor(
 onCommand?: (command: string) => void,
): Promise<PipelineMonitorHandle> {
 handle = await startPipelineMonitor({ cwd: tmp, onCommand });
 return handle;
}

/** POST JSON (con o sin token). */
async function postJson(
 h: PipelineMonitorHandle,
 pathname: string,
 body: unknown,
 token?: string,
): Promise<Response> {
 const headers: Record<string, string> = {};
 if (token) headers["x-frida-monitor-token"] = token;
 return fetch(`${h.url}${pathname}`, {
   method: "POST",
   headers,
   body: JSON.stringify(body),
  });
}

const sleep = (ms: number): Promise<void> =>
 new Promise((r) => setTimeout(r, ms));

/** Escribe un artefacto .md con frontmatter bajo tmp (ruta relativa con `/`). */
function writeArtifact(
 rel: string,
 frontmatter: Record<string, string> = {},
): string {
 const abs = path.join(tmp, ...rel.split("/"));
 mkdirSync(path.dirname(abs), { recursive: true });
 const fm = Object.entries(frontmatter)
  .map(([k, v]) => `${k}: ${v}`)
  .join("\n");
 writeFileSync(abs, `---\n${fm}\n---\n\n# doc\n`, "utf8");
 return abs;
}

const FRD = ".frida/artifacts/discover/2026-01-01_10-00-00_mi-feature.md";
const RESEARCH_REL =
 ".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
const DESIGN_REL = ".frida/artifacts/designs/2026-01-03_10-00-00_mi-feature.md";
const PLAN_REL = ".frida/artifacts/plans/2026-01-04_10-00-00_mi-feature.md";

/** Plan con fases `## FN` reales (syncUnitsFromPlan sólo parsea headers). */
function writePlan(rel: string, parent: string, titles: string[]): void {
 const abs = writeArtifact(rel, { parent });
 const body = titles.map((t, i) => `## F0${i + 1} — ${t}`).join("\n");
 writeFileSync(abs, `---\nparent: ${parent}\n---\n\n${body}\n`, "utf8");
}

// ── SSE: lector en background + waitFor ─────────────────────────────────

type SseEvent = { id: number; event: string; data: string };

interface SseConnection {
 events: SseEvent[];
 waitFor(pred: (e: SseEvent) => boolean, timeoutMs?: number): Promise<SseEvent>;
 close(): Promise<void>;
}

function parseFrame(frame: string): SseEvent | undefined {
 let id: number | undefined;
 let event: string | undefined;
 let data: string | undefined;
 for (const line of frame.split("\n")) {
  if (line.startsWith(":")) continue; // heartbeat/comentarios
  if (line.startsWith("id: ")) id = Number(line.slice(4));
  else if (line.startsWith("event: ")) event = line.slice(7);
  else if (line.startsWith("data: ")) data = line.slice(6);
 }
 return id !== undefined && event !== undefined && data !== undefined
  ? { id, event, data }
  : undefined;
}

async function connectSse(
 base: string,
 lastEventId?: number,
): Promise<SseConnection> {
 const res = await fetch(`${base}events`, {
  headers:
   lastEventId !== undefined
    ? { "Last-Event-ID": String(lastEventId) }
    : {},
 });
 expect(res.status).toBe(200);
 expect(res.headers.get("content-type")).toContain("text/event-stream");
 const reader = res.body!.getReader();
 const decoder = new TextDecoder();
 const events: SseEvent[] = [];
 let buf = "";
 let stop = false;
 const pump = (async () => {
  try {
   while (!stop) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf("\n\n");
    while (idx >= 0) {
     const frame = buf.slice(0, idx);
     buf = buf.slice(idx + 2);
     const ev = parseFrame(frame);
     if (ev) events.push(ev);
     idx = buf.indexOf("\n\n");
    }
   }
  } catch {
   /* conexión cerrada */
  }
 })();
 async function waitFor(
  pred: (e: SseEvent) => boolean,
  timeoutMs = 3000,
 ): Promise<SseEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
   const hit = [...events].reverse().find(pred);
   if (hit) return hit;
   if (Date.now() > deadline) throw new Error("timeout esperando evento SSE");
   await sleep(25);
  }
 }
 return {
  events,
  waitFor,
  close: async () => {
   stop = true;
   try {
    await reader.cancel();
   } catch {
    /* ya cerrado */
   }
   await pump;
  },
 };
}

/** data de un evento como snapshot tipado (fields usados por los tests). */
function snapshotOf(e: SseEvent): {
 specs: Array<{ id: string }>;
 features: Array<{
  id: string;
  stage: string;
  title?: string;
  desync?: boolean;
  paused?: boolean;
 }>;
 boards: Array<{
  path: string;
  units: Array<{ status: string; done: boolean; validateFails: number }>;
 }>;
} {
 return JSON.parse(e.data);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("servidor — arranque loopback puerto efímero (D3/NFR)", () => {
 it("127.0.0.1 efímero, token UUID por proceso y dispose cierra", async () => {
  const h = await startMonitor();
  expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  expect(h.port).toBeGreaterThan(0);
  expect(h.token).toMatch(
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect((await fetch(`${h.url}api/state`)).status).toBe(200);
  h.dispose();
  await expect(fetch(`${h.url}api/state`)).rejects.toThrow();
 });

 it("workspace sin .frida arranca sin error; / y /sdd sirven la página mínima", async () => {
  const h = await startMonitor();
  for (const p of ["", "sdd"]) {
   const res = await fetch(`${h.url}${p}`);
   expect(res.status).toBe(200);
   expect(res.headers.get("content-type")).toContain("text/html");
   expect(await res.text()).toContain("Frida Monitor");
  }
  const state = await (
   await fetch(`${h.url}api/state`)
  ).json();
  expect(state.features).toEqual([]);
  expect(state.specs.map((s: { id: string }) => s.id)).toContain("sdd");
 });
});

describe("auth — POST exige token, 401 sin él (FR#8; delta vs 403 plantilla)", () => {
 it("sin token o token inválido → 401; header propio y Bearer válidos → 200", async () => {
  const h = await startMonitor();
  expect((await postJson(h, "api/advance", { id: FRD })).status).toBe(401);
  expect(
   (await postJson(h, "api/advance", { id: FRD }, "token-equivocado")).status,
  ).toBe(401);
  expect(
   (await postJson(h, "api/advance", { id: "no-existe.md" }, h.token)).status,
  ).toBe(200);
  const bearer = await fetch(`${h.url}api/pause`, {
   method: "POST",
   headers: { Authorization: `Bearer ${h.token}` },
   body: JSON.stringify({ id: "no-existe.md", paused: true }),
  });
  expect(bearer.status).toBe(200);
 });

 it("cuerpo inválido o sin id → 400; ruta POST desconocida → 404", async () => {
  const h = await startMonitor();
  const bad = await fetch(`${h.url}api/advance`, {
   method: "POST",
   headers: { "x-frida-monitor-token": h.token },
   body: "{no-json",
  });
  expect(bad.status).toBe(400);
  expect((await postJson(h, "api/advance", {}, h.token)).status).toBe(400);
  expect((await postJson(h, "api/nada", { id: "x" }, h.token)).status).toBe(
   404,
  );
 });
});

describe("GET /api/state — snapshot del ecosistema (FR#7/FR#12)", () => {
 it("adopta FRDs escritos al FS (reconcile por GET, FR#3) con title y desync", async () => {
  const h = await startMonitor();
  writeArtifact(FRD, { status: "ready" });
  const state = await (await fetch(`${h.url}api/state`)).json();
  expect(state.features).toHaveLength(1);
  expect(state.features[0]).toMatchObject({
   id: FRD,
   stage: "discover",
   title: "mi-feature",
   desync: false,
  });
 });
});

describe("POST /api/advance — mismo disparo que el overlay (FR#4)", () => {
 it("avanza, entrega el comando pre-move al host (onCommand) y responde", async () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  const onCommand = vi.fn();
  const h = await startMonitor(onCommand);
  const res = await (
   await postJson(h, "api/advance", { id: FRD }, h.token)
  ).json();
  expect(res).toMatchObject({
   moved: true,
   to: "research",
   prerequisitesMet: true,
   command: `/skill:research ${FRD}`,
  });
  expect(onCommand).toHaveBeenCalledTimes(1);
  expect(onCommand).toHaveBeenCalledWith(`/skill:research ${FRD}`);
  expect(loadFeatures(tmp)!.features[0]!.stage).toBe("research");
 });

 it("sin insumo previo: mueve igual y responde warning FR#14", async () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  const state = loadFeatures(tmp)!;
  state.features[0]!.stage = "research"; // sin artefacto research real
  saveFeatures(tmp, state);
  const h = await startMonitor();
  const res = await (
   await postJson(h, "api/advance", { id: FRD }, h.token)
  ).json();
  expect(res.moved).toBe(true);
  expect(res.to).toBe("design");
  expect(res.prerequisitesMet).toBe(false);
  expect(res.warning).toContain("no está en el FS");
 });
});

describe("POST /api/pause — flag persistido (FR#11)", () => {
 it("pausa y reanuda; feature inexistente → ok:false", async () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  const h = await startMonitor();
  const on = await (
   await postJson(h, "api/pause", { id: FRD, paused: true }, h.token)
  ).json();
  expect(on).toEqual({ ok: true, paused: true });
  expect(loadFeatures(tmp)!.features[0]!.paused).toBe(true);
  const off = await (
   await postJson(h, "api/pause", { id: FRD, paused: false }, h.token)
  ).json();
  expect(off).toEqual({ ok: true, paused: false });
  expect(loadFeatures(tmp)!.features[0]!.paused).toBe(false);
  const miss = await (
   await postJson(
    h,
    "api/pause",
    { id: "no-existe.md", paused: true },
    h.token,
   )
  ).json();
  expect(miss).toEqual({ ok: false, error: "missing" });
 });
});

describe("POST /api/ship — fases a backlog N2 sin ejecución (FR#5)", () => {
 it("crea el board con las fases raíz y responde phaseCount; el snapshot lo refleja", async () => {
  writeArtifact(FRD);
  writeArtifact(RESEARCH_REL, { parent: FRD });
  writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
  writePlan(PLAN_REL, DESIGN_REL, ["alpha", "beta", "gamma"]);
  reconcileFeatures(tmp);
  const h = await startMonitor();
  const res = await (
   await postJson(h, "api/ship", { id: FRD }, h.token)
  ).json();
  expect(res).toMatchObject({
   moved: true,
   phaseCount: 3,
   planPath: PLAN_REL,
  });
  expect(loadFeatures(tmp)!.features[0]!.stage).toBe("ready-to-ship");
  const state = await (await fetch(`${h.url}api/state`)).json();
  expect(state.boards).toHaveLength(1);
  expect(state.boards[0].path).toBe(PLAN_REL);
  expect(state.boards[0].units).toHaveLength(3);
  expect(
   state.boards[0].units.every(
    (u: { status: string; done: boolean; validateFails: number }) =>
     u.status === "backlog" && u.done === false && u.validateFails === 0,
   ),
  ).toBe(true);
 });

 it("sin plan enlazado: failure no-plan + warning", async () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  const h = await startMonitor();
  const res = await (
   await postJson(h, "api/ship", { id: FRD }, h.token)
  ).json();
  expect(res).toMatchObject({
   moved: false,
   failure: "no-plan",
   phaseCount: 0,
  });
  expect(res.warning).toContain("/skill:plan");
 });
});

describe("SSE — /events: snapshot inicial, broadcast vivo y replay (FR#8/NFR <1s)", () => {
 it("primer evento = snapshot actual; un POST se refleja <1.5s (debounce incluido)", async () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  const h = await startMonitor();
  sse = await connectSse(h.url);
  const first = await sse.waitFor((e) => e.event === "snapshot");
  expect(snapshotOf(first).features[0]!.stage).toBe("discover");
  await postJson(h, "api/advance", { id: FRD }, h.token);
  const moved = await sse.waitFor(
   (e) => {
    try {
     return snapshotOf(e).features[0]!.stage === "research";
    } catch {
     return false;
    }
   },
   MONITOR_DEBOUNCE_MS * 6,
  );
  expect(moved.id).toBeGreaterThan(first.id);
 });

 it("replay Last-Event-ID: al reconectar recibe lo perdido (plantilla replayEvents)", async () => {
  writeArtifact(FRD);
  reconcileFeatures(tmp);
  const h = await startMonitor();
  const a = await connectSse(h.url);
  sse = a;
  const first = await a.waitFor((e) => e.event === "snapshot");
  // Dos POST coalescen en UN broadcast (debounce): stage research + paused.
  await postJson(h, "api/advance", { id: FRD }, h.token);
  await postJson(h, "api/pause", { id: FRD, paused: true }, h.token);
  await sleep(MONITOR_DEBOUNCE_MS + 200); // aterriza el broadcast (al log)
  await a.close();
  const b = await connectSse(h.url, first.id);
  sse = b;
  // El replay entrega SOLO lo perdido: el primer evento de B tiene id > first
  // (sin snapshot extra de conexión). Espera a que aterrice ≥1 frame antes de
  // asertar (el primer chunk depende de microtasks de undici — 1ª pasada).
  await b.waitFor(() => true, 1500);
  expect(b.events[0]!.id).toBeGreaterThan(first.id);
  const missed = await b.waitFor((e) => e.id > first.id, 1500);
  expect(snapshotOf(missed).features[0]).toMatchObject({
   stage: "research",
   paused: true,
  });
 });

 it("watcher: escritura EXTERNA de un FRD se adopta y transmite <1.5s (sin writers in-process)", async () => {
  // El bucket debe existir ANTES de conectar: el watcher se arma por request.
  mkdirSync(path.join(tmp, ".frida", "artifacts", "discover"), {
   recursive: true,
  });
  const h = await startMonitor();
  sse = await connectSse(h.url);
  await sse.waitFor((e) => e.event === "snapshot"); // inicial
  // Escritura externa (bash/skill de otro proceso): nadie emite in-process.
  writeFileSync(
   path.join(tmp, ...FRD.split("/")),
   "---\nstatus: ready\n---\n\n# doc\n",
   "utf8",
  );
  const adopted = await sse.waitFor(
   (e) => {
    try {
     return snapshotOf(e).features.length === 1;
    } catch {
     return false;
    }
   },
   MONITOR_DEBOUNCE_MS * 6,
  );
  expect(snapshotOf(adopted).features[0]!.id).toBe(FRD);
 });

 it("tmp+rename: el .tmp no emite; el rename SÍ — una sola señal por ráfaga (D2)", async () => {
  mkdirSync(path.join(tmp, ".frida", "artifacts", "pipeline"), {
   recursive: true,
  });
  const h = await startMonitor();
  sse = await connectSse(h.url);
  const first = await sse.waitFor((e) => e.event === "snapshot");
  // Ráfaga multi-escritor: tmp + rename (el evento del .tmp se IGNORA).
  const file = featuresFilePath(tmp);
  const tmpFile = `${file}.4242.tmp`;
  writeFileSync(
   tmpFile,
   JSON.stringify({
    v: 1,
    features: [{ id: "externo.md", stage: "discover", history: [] }],
    updatedAt: new Date().toISOString(),
   }),
   "utf8",
  );
  renameSync(tmpFile, file);
  const got = await sse.waitFor(
   (e) => {
    try {
     return snapshotOf(e).features.some((f) => f.id === "externo.md");
    } catch {
     return false;
    }
   },
   MONITOR_DEBOUNCE_MS * 6,
  );
  // Exactamente UN evento entre el inicial y el rename (tmp ignorado +
  // coalescencia del funnel).
  expect(got.id).toBe(first.id + 1);
  await sleep(MONITOR_DEBOUNCE_MS + 400); // ventana de silencio
  expect(sse.events.filter((e) => e.id > got.id)).toEqual([]);
 });
});

describe("workspace limpio — adopción diferida (NFR reliability)", () => {
 it("sin .frida arranca; al aparecer el árbol, el GET adopta (rearme por request)", async () => {
  const h = await startMonitor();
  const empty = await (await fetch(`${h.url}api/state`)).json();
  expect(empty.features).toEqual([]);
  writeArtifact(FRD); // crea .frida/artifacts/… (el watcher no podía armarse)
  const adopted = await (await fetch(`${h.url}api/state`)).json();
  expect(adopted.features).toHaveLength(1);
  expect(adopted.features[0].id).toBe(FRD);
 });
});
```

#### 3. Wiring en activate (3h)

**File**: `src/extension.ts`
**Changes**: MODIFY. Import de monitor-server + IIFE Disposable tras el ítem del status bar (~6901); `onCommand` → focus + `runCustomCommand` (mismo canal que el overlay). La publicación `monitor_url` llega en la Fase 8 (i-3).

```ts
// (3h) Monitor HTTP+SSE (D3 — wiring de la Fase 6; la Fase 8 añade i-3).
// Import junto al bloque de frida-workflow (~133; el host perfora
// submódulos, patrón board-ui/store):
import { startPipelineMonitor } from "./tools/frida-workflow/monitor-server";
import type { PipelineMonitorHandle } from "./tools/frida-workflow/monitor-server";

// … y dentro del bloque context.subscriptions.push(…) de activate (~6798),
// IIFE Disposable inmediatamente DESPUÉS del ítem del status bar (~6901) —
// mismo patrón: el Disposable se pushea SÍNCRONO aunque el listen sea async
// (un deactivate temprano no deja un handle huérfano):
 // D3 — Monitor HTTP+SSE del pipeline (FR#7/FR#8): servidor loopback puerto
 // efímero activo desde activate. El ▶ del HTML dispara el MISMO canal que
 // el overlay (onCommand → focus + runCustomCommand, Desired End State).
 // Sin servidor el host sigue vivo (NFR degradación: el HTML es un espejo).
 (() => {
  let disposed = false;
  let monitor: PipelineMonitorHandle | undefined;
  void startPipelineMonitor({
   cwd: workspaceCwd(),
   onCommand: (command) => {
    void vscode.commands.executeCommand("frida.codeView.focus");
    runCustomCommand(command);
   },
  }).then(
   (handle) => {
    if (disposed) {
     handle.dispose();
     return;
    }
    monitor = handle;
    // (i-3, Fase 8) — aquí se publica la URL al webview (monitorUrl +
    // post monitor_url, FR#10) cuando llegue la Fase 8.
   },
   (err) => {
    /* sin monitor: /pipeline y /board siguen operativos — pero se registra
       UNA vez para que un monitor muerto sea diagnosticable durante la
       verificación manual (curl 401 / navegador dejarán de responder;
       fix del Step 4). */
    console.warn(
     "startPipelineMonitor falló — monitor no disponible:",
     err instanceof Error ? err.message : String(err),
    );
   },
  );
  return new vscode.Disposable(() => {
   disposed = true;
   monitor?.dispose();
  });
 })(),
```

#### 4. Reexports

**File**: `src/tools/frida-workflow/index.ts`
**Changes**: MODIFY. Añade el bloque de reexports de monitor-server.

```ts
// Monitor HTTP+SSE del pipeline (FR#7/FR#8): servidor loopback que sirve el
// espejo HTML del ecosistema (N1 features + N2 boards) con broadcast SSE.
export { MONITOR_DEBOUNCE_MS, startPipelineMonitor } from "./monitor-server";
export type {
 MonitorBoardView,
 MonitorFeatureView,
 MonitorSnapshot,
 MonitorUnitView,
 PipelineMonitorHandle,
 PipelineMonitorOptions,
} from "./monitor-server";
```

### Success Criteria

#### Automated Verification

- [ ] Tests del servidor pasan: `npx vitest run test/frida-workflow/monitor-server.test.ts`
- [ ] Typecheck del proyecto verde: `npm run typecheck`
- [ ] `grep -n "export async function startPipelineMonitor" src/tools/frida-workflow/monitor-server.ts` retorna una línea (D3: Disposable desde activate)
- [ ] `grep -c "127.0.0.1" src/tools/frida-workflow/monitor-server.ts` retorna >= 2 (bind loopback + URL — NFR)
- [ ] `grep -n "randomUUID()" src/tools/frida-workflow/monitor-server.ts` retorna una línea (token por proceso, plantilla ui-server.ts)
- [ ] `grep -c "watch(" src/tools/frida-workflow/monitor-server.ts` retorna >= 3 (recursivo + fallback plano por bucket, D2)
- [ ] `grep -n "401" src/tools/frida-workflow/monitor-server.ts` retorna >= 1 (FR#8: delta consciente vs 403 de la plantilla)
- [ ] `grep -n "startPipelineMonitor" src/extension.ts` retorna >= 2 (import + wiring en subscriptions, D3)

#### Manual Verification

- [ ] F5 (extension host) arranca sin errores de consola; el monitor vive desde activate sin bloquear el arranque (D3)
- [ ] `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:<puerto>/api/advance -d '{"id":"x"}'` responde 401 sin token y 200 con `x-frida-monitor-token` (FR#8)
- [ ] Navegador en `http://127.0.0.1:<puerto>/`: la página mínima muestra el snapshot; escribir features.json desde bash se refleja <1s (SSE + watcher + debounce 250ms — Verification Notes)
- [ ] POST /api/advance con token desde el navegador dispara el mismo canal que el overlay: el chat recibe `/skill:<etapa> <frd>` (Desired End State)
- [ ] Un `*.tmp` bajo .frida/artifacts/ no genera broadcast; el rename subsiguiente sí — una sola señal por ráfaga

---

## Phase 7: HTML del monitor — hub de métodos + /sdd

### Overview

Crea las páginas self-contained del monitor: hub de métodos en `/` (D7 — espejo de «De cero»: SDD ● activo → /sdd; AiDD/TEA próximamente) y `/sdd` con N1 y N2 JUNTOS (columnas del spec del snapshot, tarjetas con timeline/ámbar/badge, N2 espejo read-only con splits y ciclos validate), detalle por feature en `<details data-fid>` que sobrevive re-renders SSE (FR#16), control POST con token embebido, banners ámbar FR#14, empty states FR#15 con botón Copiar, y claro/oscuro por prefers-color-scheme. Retira la página mínima `monitorBootstrapPage` de la Fase 6 (reemplazo documentado en su comentario).

### Changes Required

#### 1. Páginas del monitor

**File**: `src/tools/frida-workflow/monitor-html.ts`
**Changes**: NEW. `monitorCss()` + `renderMonitorHubPage()` + `renderSddPage(token)`.

```ts
// monitor-html.ts — páginas self-contained del monitor HTML (FR#7/FR#16).
//
// D7: la landing (/) es un HUB DE MÉTODOS propio de este módulo — espejo de
// la sección «De cero» de la Welcome (webview/components/Welcome.tsx:29-77,
// label real en :33): SDD ● activo → /sdd; AiDD/TEA «próximamente». No
// comparte CATEGORIES con la webview (bifurcación consciente, D7): el HTML
// define su lista de métodos.
//
// /sdd (FR#7): N1 y N2 JUNTOS —
//  · N1: columnas del spec del snapshot (snapshot.specs["sdd"], FR#9), tarjetas
//    con mini-timeline (FR#11), ámbar «desinc» (FR#12), badge n/m post-ship
//    (FR#6) y botones ▶/Ship/⏸ → POST /api/* del Slice 6 (FR#4/FR#5/FR#8).
//  · N2: espejo READ-ONLY del board (columnas + unidades + splits + ciclos
//    validate; SIN ▶ de fase — ese gesto vive en el overlay /board).
//  · Detalle por feature (FR#16): <details> en la tarjeta — timeline completo
//    de etapas, artefactos por etapa con estado individual (enlazado con ruta
//    / «pendiente») e historial de movimientos; el estado abierto sobrevive
//    los re-renders por SSE.
//
// Contrato con el servidor (Slice 6, locked): MonitorSnapshot por GET
// /api/state y evento SSE "snapshot" en /events; POST /api/advance|pause|ship
// con token embebido por el servidor al servir la página (renderSddPage). El
// JS del cliente es vanilla sin dependencias (misma línea que la página
// mínima que este slice reemplaza) y usa function()/concatenación ES5 — sin
// template literals cliente, para no pelear con el template literal TS.
//
// Estética (NFR): paleta espejo de --vscode-* (pl-*/kb-* del webview) con
// claro/oscuro por prefers-color-scheme; escala 10/11/12 (guía /board #169);
// tooltips en todo lo clicable.

/** CSS compartido por el hub y /sdd: variables espejo de --vscode-* con
 *  claro/oscuro (el navegador NO tiene las vars del webview — se definen
 *  aquí con los valores de cada esquema para conservar el lenguaje visual). */
function monitorCss(): string {
 return `:root{color-scheme:light dark;
--vscode-editor-background:#ffffff;--vscode-sideBar-background:#f8f8f8;
--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;
--vscode-widget-border:rgba(0,0,0,.16);--vscode-list-hoverBackground:rgba(0,0,0,.05);
--vscode-focusBorder:#005fb8;--vscode-textLink-foreground:#005fb8;
--vscode-charts-blue:#005fb8;--vscode-charts-purple:#843da0;
--vscode-charts-yellow:#b98500;--vscode-charts-orange:#d18616;
--vscode-charts-green:#107c10;--vscode-list-warningForeground:#8a6100;
--vscode-inputValidation-warningBackground:rgba(170,127,0,.12);
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff}
@media (prefers-color-scheme: dark){:root{
--vscode-editor-background:#1e1e1e;--vscode-sideBar-background:#252526;
--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;
--vscode-widget-border:rgba(128,128,128,.25);--vscode-list-hoverBackground:rgba(128,128,128,.12);
--vscode-focusBorder:#58a6ff;--vscode-textLink-foreground:#4daafc;
--vscode-charts-blue:#58a6ff;--vscode-charts-purple:#c586c0;
--vscode-charts-yellow:#dcdcaa;--vscode-charts-orange:#d18616;
--vscode-charts-green:#4ec9b0;--vscode-list-warningForeground:#cca700;
--vscode-inputValidation-warningBackground:rgba(204,167,0,.1);
--vscode-button-background:#0e639c;--vscode-button-foreground:#ffffff}}
*{box-sizing:border-box}
body{margin:24px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;
background:var(--vscode-editor-background);color:var(--vscode-foreground)}
a{color:var(--vscode-textLink-foreground)}
h1{font-size:16px;margin:0}
h2{font-size:12px;margin:0 0 8px}
code,.cmd{font-family:var(--vscode-editor-font-family,ui-monospace,monospace)}
.metric{font-variant-numeric:tabular-nums;color:var(--vscode-descriptionForeground);font-size:10px}
.metric.ok{color:var(--vscode-charts-green)}
/* Header de página + indicador de conexión (NFR degradación). */
.page-h{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.page-h .sub{color:var(--vscode-descriptionForeground)}
.back{text-decoration:none;font-size:11px}
.conn{margin-left:auto;font-size:10px;color:var(--vscode-descriptionForeground)}
.conn.live{color:var(--vscode-charts-green)}
.conn.retry{color:var(--vscode-list-warningForeground)}
/* Banners ámbar (FR#14 — espejo pl-warn) y toast. */
.warns{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.warn-banner{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;
border:1px solid var(--vscode-list-warningForeground);
background:var(--vscode-inputValidation-warningBackground);
color:var(--vscode-list-warningForeground)}
.wtext{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px}
.wx{background:none;border:none;color:inherit;cursor:pointer;font-size:10px;padding:2px 4px;opacity:.7}
.wx:hover{opacity:1}
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);
background:var(--vscode-button-background);color:var(--vscode-button-foreground);
padding:6px 14px;border-radius:6px;font-size:11px;opacity:0;pointer-events:none;
transition:opacity .2s ease;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toast.show{opacity:1}
.toast.warn{background:var(--vscode-list-warningForeground)}
/* Secciones N1/N2. */
.sec{display:flex;align-items:center;gap:8px;margin:18px 0 8px}
/* Hub (/): tarjetas de método (espejo starter-card de la Welcome). */
.methods{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;max-width:920px}
.method{display:block;border:1px solid var(--vscode-widget-border);border-radius:8px;
padding:14px;text-decoration:none;color:inherit;background:var(--vscode-sideBar-background)}
.method:hover{border-color:var(--vscode-focusBorder)}
.method.soon{opacity:.55}
.m-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.m-title{font-weight:600;font-size:12px}
.m-desc{margin:0 0 8px;color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.4}
.m-go{font-size:11px;color:var(--vscode-textLink-foreground)}
/* Columnas (espejo pl-col/kb-col). */
.cols{display:flex;gap:8px;overflow-x:auto;scrollbar-width:thin;padding-bottom:4px}
.col,.bcol{min-width:210px;max-width:280px;flex:1 1 210px}
.col-h{display:flex;align-items:center;gap:5px;margin-bottom:6px;font-size:11px;font-weight:600;
color:var(--vscode-descriptionForeground)}
.cdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
/* Tarjeta de feature (espejo pl-card). */
.card{padding:6px 8px;border-radius:6px;border:1px solid var(--vscode-widget-border);
background:var(--vscode-sideBar-background);display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
.card:hover{border-color:var(--vscode-focusBorder)}
.card.desync{border-color:var(--vscode-list-warningForeground);
box-shadow:0 0 0 1px var(--vscode-list-warningForeground) inset}
.card-head{display:flex;align-items:center;gap:6px;min-width:0}
.bar{width:3px;align-self:stretch;border-radius:2px;flex-shrink:0}
.title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
font-weight:600;font-size:11px}
.badges{display:flex;flex-wrap:wrap;align-items:center;gap:6px;row-gap:2px}
.badges>*{flex-shrink:0}
.dots{display:inline-flex;gap:2px;align-items:center}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;
background:var(--vscode-widget-border);transition:background-color .2s ease}
.dot.done{background:var(--vscode-charts-green)}
.dot.current{background:var(--vscode-focusBorder);
box-shadow:0 0 0 1px var(--vscode-focusBorder) inset}
.dot.paused{background:var(--vscode-list-warningForeground);
box-shadow:0 0 0 1px var(--vscode-list-warningForeground) inset}
.dot.next{background:var(--vscode-widget-border)}
.badge{font-size:10px;white-space:nowrap}
.badge.warn{color:var(--vscode-list-warningForeground)}
.badge.ok{color:var(--vscode-charts-green)}
.actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
/* Botones (espejo fbutton: primary/secondary del VS Code). */
.btn{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:4px;
font-size:11px;cursor:pointer;background:transparent;color:var(--vscode-foreground);
border:1px solid var(--vscode-widget-border)}
.btn:hover{border-color:var(--vscode-focusBorder)}
.btn.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);
border-color:var(--vscode-button-background);font-weight:600}
.btn.sm{padding:2px 8px;font-size:10px}
/* Detalle FR#16. */
.detail{font-size:10px}
.detail summary{cursor:pointer;color:var(--vscode-descriptionForeground);
user-select:none;margin-top:2px}
.detail summary:hover{color:var(--vscode-foreground)}
.dt-body{padding:6px 0 2px 2px;display:flex;flex-direction:column;gap:3px}
.dt-row{display:grid;grid-template-columns:10px 84px 130px 1fr;gap:6px;align-items:center}
.dt-row .dot{width:7px;height:7px}
.dt-stage{font-weight:600}
.dt-state{color:var(--vscode-descriptionForeground)}
.dt-art{min-width:0;word-break:break-word}
.dt-path{font-family:ui-monospace,monospace;font-size:9px;
color:var(--vscode-descriptionForeground)}
.dt-hist-t{margin-top:4px;color:var(--vscode-descriptionForeground);font-weight:600}
.dt-hist{color:var(--vscode-descriptionForeground)}
/* Estados vacíos (FR#15). */
.empty{padding:8px;border:1px dashed var(--vscode-widget-border);border-radius:6px;
color:var(--vscode-descriptionForeground);font-size:11px;max-width:640px}
.cmdrow{display:flex;align-items:center;gap:8px;margin-top:6px}
.cmd{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.9}
/* Board N2 (espejo kb-*). */
.board{margin-bottom:14px}
.board-h{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.btitle{font-weight:600;font-size:11px}
.ucard{padding:5px 8px;border-radius:6px;border:1px solid var(--vscode-widget-border);
background:var(--vscode-sideBar-background);display:flex;flex-direction:column;gap:3px;margin-bottom:5px}
.uhead{display:flex;align-items:center;gap:6px;min-width:0}
.uid{font-size:11px}
.utitle{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
color:var(--vscode-descriptionForeground);font-size:10px}
.ucard.done .uid{color:var(--vscode-charts-green)}
.bsub{font-size:10px;color:var(--vscode-descriptionForeground);padding-left:9px}
.bsub.done{color:var(--vscode-charts-green)}
.bsub b{font-weight:600}`;
}

/** Hub de métodos (/) — landing estática (D7): SDD ● activo → /sdd;
 *  AiDD/TEA «próximamente». Sin JS: no hay estado vivo aquí. */
export function renderMonitorHubPage(): string {
 return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frida Monitor</title>
<style>${monitorCss()}</style>
</head>
<body>
<header class="page-h">
 <h1>Frida Monitor</h1>
 <span class="sub">Espejo del ecosistema · loopback 127.0.0.1</span>
</header>
<main class="methods">
 <a class="method" href="/sdd" title="Abrir el pipeline SDD con N1 y N2 juntos">
  <div class="m-head">
   <span class="m-title">Desarrollo Autónomo (SDD)</span>
   <span class="badge ok">● activo</span>
  </div>
  <p class="m-desc">La fábrica: features avanzando discover → research → design → plan → 🚀 ready-to-ship, con su board de ejecución.</p>
  <span class="m-go">Abrir /sdd →</span>
 </a>
 <div class="method soon" title="Entrará por configuración del motor PanelSpec (FR#9) cuando el método exista">
  <div class="m-head">
   <span class="m-title">Planificar con AiDD</span>
   <span class="badge warn">próximamente</span>
  </div>
  <p class="m-desc">Brief, PRD, arquitectura y specs para una idea nueva.</p>
 </div>
 <div class="method soon" title="Entrará por configuración del motor PanelSpec (FR#9) cuando el método exista">
  <div class="m-head">
   <span class="m-title">Diseñar Pruebas (TEA)</span>
   <span class="badge warn">próximamente</span>
  </div>
  <p class="m-desc">Matriz de pruebas por escenarios y criterios de aceptación BDD.</p>
 </div>
</main>
</body>
</html>`;
}

/** Página /sdd (FR#7): N1 + N2 juntos, vivos por SSE, con control POST.
 *  El servidor embebe el token para los POST autenticados (FR#8). */
export function renderSddPage(token: string): string {
 return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pipeline SDD · Frida Monitor</title>
<style>${monitorCss()}</style>
</head>
<body>
<header class="page-h">
 <a class="back" href="/" title="Volver al hub de métodos">← Monitor</a>
 <h1>Pipeline SDD</h1>
 <span class="sub">N1 planeación + N2 ejecución</span>
 <span class="conn" id="conn" title="">conectando…</span>
</header>
<div class="warns" id="warns"></div>
<main id="root"><p class="empty">cargando estado…</p></main>
<div class="toast" id="toast"></div>
<script>
(function () {
"use strict";
var TOKEN = ${JSON.stringify(token)};

/* Fallback del spec SDD (espejo de SDD_PANEL_SPEC, panel-spec.ts): la página
 * renderiza algo razonable ANTES del primer snapshot (degradación NFR). */
var FALLBACK_SPEC = {
 id: "sdd", title: "Pipeline SDD",
 columns: [
  { id: "discover", label: "discover", advanceLabel: "Continuar a research →", artifactLabel: "FRD" },
  { id: "research", label: "research", advanceLabel: "Continuar a design →", artifactLabel: "Research" },
  { id: "design", label: "design", advanceLabel: "Continuar a plan →", artifactLabel: "Design" },
  { id: "plan", label: "plan", advanceKind: "ship", advanceLabel: "Ship → fases a ejecución", artifactLabel: "Plan" },
  { id: "ready-to-ship", label: "🚀 ready-to-ship", terminal: true }
 ],
 emptyState: {
  command: "/skill:discover <idea>",
  hint: "Genera el FRD de una feature para abrirle camino en el pipeline."
 }
};

/* Acentos — espejo de STAGE_ACCENT (features-ui.tsx) y COL_ACCENT (board-ui.tsx). */
var STAGE_ACCENT = {
 discover: "var(--vscode-charts-blue)",
 research: "var(--vscode-charts-purple)",
 design: "var(--vscode-charts-yellow)",
 plan: "var(--vscode-charts-orange)",
 "ready-to-ship": "var(--vscode-charts-green)"
};
var COL_ACCENT = {
 backlog: "var(--vscode-descriptionForeground)",
 elaborate: "var(--vscode-charts-blue)",
 implement: "var(--vscode-charts-purple)",
 validate: "var(--vscode-charts-yellow)",
 commit: "var(--vscode-charts-green)",
 elaborada: "var(--vscode-charts-blue)",
 implementada: "var(--vscode-charts-purple)",
 validada: "var(--vscode-charts-yellow)",
 commiteada: "var(--vscode-charts-green)"
};

var snapshot = null;
var conn = "connecting";
var warnings = {}; /* key → texto (memoria de sesión en JS, FR#14) */
var openDetails = {}; /* fid → true: <details> abiertos que sobreviven SSE */
var toast = null;
var toastTimer = null;

function esc(s) {
 return String(s).replace(/[&<>"']/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
 });
}
function spec() {
 if (snapshot && snapshot.specs) {
  for (var i = 0; i < snapshot.specs.length; i++)
   if (snapshot.specs[i].id === "sdd") return snapshot.specs[i];
 }
 return FALLBACK_SPEC;
}
function colIdx(sp, stage) {
 for (var i = 0; i < sp.columns.length; i++)
  if (sp.columns[i].id === stage) return i;
 return -1;
}
function colById(sp, stage) {
 var i = colIdx(sp, stage);
 return i >= 0 ? sp.columns[i] : null;
}
function accentOf(stage) {
 return STAGE_ACCENT[stage] || "var(--vscode-descriptionForeground)";
}
function colAccent(c) {
 return COL_ACCENT[c] || "var(--vscode-descriptionForeground)";
}
function fmtTs(ts) {
 if (!ts) return "";
 try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
}
function featureById(id) {
 var fs = (snapshot && snapshot.features) || [];
 for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i];
 return null;
}
/* Artefacto enlazado por etapa: el FRD ES la feature (discover); el resto
 * vive en f.artifacts (features.ts — sin discover en el mapa). */
function artifactOf(f, stageId) {
 if (stageId === "discover") return f.id;
 if (f.artifacts) return f.artifacts[stageId] || null;
 return null;
}

/* ── Render ─────────────────────────────────────────────────────────── */

function connLabel() {
 if (conn === "live") return "● en vivo";
 if (conn === "retry") return "● reconectando…";
 return "● conectando…";
}
function warningsHtml() {
 var keys = Object.keys(warnings);
 if (!keys.length) return "";
 var out = "";
 for (var i = 0; i < keys.length; i++) {
  out += '<div class="warn-banner" title="' + esc(warnings[keys[i]]) + '">' +
   '<span class="wtext">' + esc(warnings[keys[i]]) + '</span>' +
   '<button class="wx" data-action="dismiss" data-id="' + esc(keys[i]) +
   '" title="Descartar por esta sesión">✕</button></div>';
 }
 return out;
}
function timelineDots(sp, idx, paused) {
 var out = '<span class="dots" title="mini-timeline de etapas">';
 for (var i = 0; i < sp.columns.length; i++) {
  var st = i < idx ? "done" : i === idx ? (paused ? "paused" : "current") : "next";
  out += '<span class="dot ' + st + '" title="' + esc(sp.columns[i].label) + '"></span>';
 }
 return out + "</span>";
}
function detailHtml(f, sp) {
 var idx = colIdx(sp, f.stage);
 var rows = "";
 for (var i = 0; i < sp.columns.length; i++) {
  var c = sp.columns[i];
  var st, label;
  if (i < idx) { st = "done"; label = "completada"; }
  else if (i === idx) { st = f.paused ? "paused" : "current"; label = f.paused ? "pausada (no bloquea)" : "actual"; }
  else { st = "next"; label = "próxima"; }
  var artHtml;
  if (c.id === "ready-to-ship") {
   /* Terminal (FR#6): ship + plan + badge, no artefacto de etapa. */
   artHtml = f.shippedAt ? "✓ ship " + fmtTs(f.shippedAt) : "— pendiente de ship";
   if (f.planPath) artHtml += ' <span class="dt-path">' + esc(f.planPath) + "</span>";
   if (f.badge) artHtml += ' <span class="badge ok">' + f.badge.done + "/" + f.badge.total + " fases</span>";
  } else {
   var art = artifactOf(f, c.id);
   artHtml = art ? '✓ <span class="dt-path">' + esc(art) + "</span>" : "— pendiente";
  }
  rows += '<div class="dt-row"><span class="dot ' + st + '"></span>' +
   '<span class="dt-stage">' + esc(c.artifactLabel || c.label) + "</span>" +
   '<span class="dt-state">' + label + "</span>" +
   '<span class="dt-art">' + artHtml + "</span></div>";
 }
 var hist = "";
 if (f.history && f.history.length) {
  hist = '<div class="dt-hist-t">Historial</div>';
  for (var h = f.history.length - 1; h >= 0; h--) {
   var e = f.history[h];
   hist += '<div class="dt-hist">→ ' + esc(e.to || "") + " · " + fmtTs(e.ts) +
    (e.source ? " · " + esc(e.source) : "") + "</div>";
  }
 }
 return '<details class="detail" data-fid="' + esc(f.id) + '">' +
  "<summary>timeline y artefactos</summary>" +
  '<div class="dt-body">' + rows + hist + "</div></details>";
}
function cardHtml(f, sp) {
 var col = colById(sp, f.stage);
 var idx = colIdx(sp, f.stage);
 var badges = timelineDots(sp, idx, f.paused);
 if (f.desync) badges += ' <span class="badge warn" title="el FS tiene artefactos más avanzados que la tarjeta — usa ▶ para alcanzarla">desinc</span>';
 if (f.badge) badges += ' <span class="badge ok" title="fases raíz commiteadas en el board N2">' + f.badge.done + "/" + f.badge.total + " fases</span>";
 var actions = "";
 if (col && !col.terminal) {
  var isShip = col.advanceKind === "ship";
  actions += '<button class="btn' + (isShip ? " primary" : "") + '" data-action="' +
   (isShip ? "ship" : "advance") + '" data-id="' + esc(f.id) + '" title="' +
   (isShip
    ? "Crear las fases del plan como unidades backlog del board N2 (sin ejecutar nada)"
    : "Inyectar el comando de la skill al chat del host y mover la tarjeta") +
   '">' + (isShip ? "🚀 " : "▶ ") + esc(col.advanceLabel || "Avanzar") + "</button>";
 }
 actions += '<button class="btn sm" data-action="pause" data-id="' + esc(f.id) + '" title="' +
  (f.paused ? "Reanudar la feature" : "Pausar — señal visual, NO bloquea el avance (FR#14)") +
  '">' + (f.paused ? "▶ Reanudar" : "⏸ Pausar") + "</button>";
 return '<div class="card' + (f.desync ? " desync" : "") + '">' +
  '<div class="card-head"><span class="bar" style="background:' + accentOf(f.stage) + '"></span>' +
  '<span class="title" title="' + esc(f.id) + '">' + esc(f.title || f.id) + "</span>" +
  (f.paused ? '<span class="badge warn" title="Pausada — el avance NO está bloqueado">⏸</span>' : "") +
  "</div>" +
  '<div class="badges">' + badges + "</div>" +
  '<div class="actions">' + actions + "</div>" +
  detailHtml(f, sp) +
  "</div>";
}
function n1Html() {
 if (!snapshot) return '<p class="empty">cargando estado…</p>';
 var sp = spec();
 var feats = snapshot.features || [];
 var desyncCount = 0;
 for (var i = 0; i < feats.length; i++) if (feats[i].desync) desyncCount++;
 var head = '<h2 class="sec">N1 · Planeación <span class="metric">(' + feats.length + ")</span>" +
  (desyncCount ? ' <span class="badge warn" title="el FS va por delante de la tarjeta — usa ▶ para alcanzarla">desinc ' + desyncCount + "</span>" : "") +
  "</h2>";
 if (!feats.length) {
  /* FR#15: el comando que llena el vacío, con botón accionable (copiar). */
  return head + '<div class="empty"><p>' + esc(sp.emptyState.hint || "") + "</p>" +
   '<div class="cmdrow"><code class="cmd">' + esc(sp.emptyState.command) + "</code>" +
   '<button class="btn sm" data-action="copy" data-copy="' + esc(sp.emptyState.command) +
   '" title="Copiar el comando al portapapeles y pegarlo en el chat de Frida">Copiar</button></div></div>';
 }
 var cols = "";
 for (var c = 0; c < sp.columns.length; c++) {
  var col = sp.columns[c];
  var inCol = [];
  for (var j = 0; j < feats.length; j++) if (feats[j].stage === col.id) inCol.push(feats[j]);
  var cards = "";
  for (var k = 0; k < inCol.length; k++) cards += cardHtml(inCol[k], sp);
  cols += '<div class="col"><div class="col-h"><span class="cdot" style="background:' +
   accentOf(col.id) + '"></span>' + esc(col.label) + ' <span class="metric">(' + inCol.length +
   ")</span></div>" + cards + "</div>";
 }
 return head + '<div class="cols">' + cols + "</div>";
}
function unitHtml(u, kidsBy) {
 var kids = kidsBy[u.id] || [];
 var badges = "";
 if (kids.length) {
  var kd = 0;
  for (var i = 0; i < kids.length; i++) if (kids[i].done) kd++;
  badges += '<span class="metric" title="splits done">' + kd + "/" + kids.length + "</span>";
 }
 if (u.validateFails > 0) badges += '<span class="badge warn" title="' + u.validateFails +
  ' ciclo(s) de reintento (validate FAIL)">↻ ' + u.validateFails + "</span>";
 var subs = "";
 for (var s = 0; s < kids.length; s++) {
  subs += '<div class="bsub' + (kids[s].done ? " done" : "") + '" title="' +
   esc(kids[s].title || kids[s].id) + '">' + (kids[s].done ? "✓" : "·") + " <b>" +
   esc(kids[s].id) + "</b>" + (kids[s].title ? " " + esc(kids[s].title) : "") + "</div>";
 }
 return '<div class="ucard' + (u.done ? " done" : "") + '" title="' + esc(u.title || u.id) +
  " · " + (u.transitions || 0) + ' transiciones">' +
  '<div class="uhead"><span class="bar" style="background:' +
  (u.done ? "var(--vscode-charts-green)" : colAccent(u.status)) + '"></span>' +
  '<b class="uid">' + esc(u.id) + '</b><span class="utitle">' + esc(u.title || "") + "</span></div>" +
  (badges ? '<div class="badges">' + badges + "</div>" : "") + subs + "</div>";
}
function boardHtml(b) {
 var units = b.units || [];
 var roots = [], kidsBy = {};
 for (var i = 0; i < units.length; i++) {
  if (units[i].parentId) {
   (kidsBy[units[i].parentId] = kidsBy[units[i].parentId] || []).push(units[i]);
  } else roots.push(units[i]);
 }
 var done = 0;
 for (var r = 0; r < roots.length; r++) if (roots[r].done) done++;
 var base = (b.path || "").split("/").pop() || b.path || "";
 var cols = "";
 var colsArr = b.columns || [];
 for (var c = 0; c < colsArr.length; c++) {
  var inCol = [];
  for (var j = 0; j < roots.length; j++)
   if (roots[j].status === colsArr[c]) inCol.push(roots[j]);
  var cards = "";
  for (var k = 0; k < inCol.length; k++) cards += unitHtml(inCol[k], kidsBy);
  cols += '<div class="bcol"><div class="col-h"><span class="cdot" style="background:' +
   colAccent(colsArr[c]) + '"></span>' + esc(colsArr[c]) + ' <span class="metric">(' +
   inCol.length + ")</span></div>" + cards + "</div>";
 }
 return '<div class="board" title="plan: ' + esc(b.path || "") + '">' +
  '<div class="board-h"><span class="btitle">' + esc(base) + "</span>" +
  '<span class="metric ok" title="fases raíz commiteadas">' + done + "/" + roots.length + "</span></div>" +
  '<div class="cols">' + cols + "</div></div>";
}
function n2Html() {
 if (!snapshot) return "";
 var boards = snapshot.boards || [];
 var head = '<h2 class="sec">N2 · Ejecución <span class="metric">(' + boards.length +
  (boards.length === 1 ? " board" : " boards") + ")</span></h2>";
 if (!boards.length) {
  return head + '<div class="empty"><p>Sin boards todavía — un ▶ «Ship → fases a ejecución» desde N1 crea las fases del plan como backlog.</p></div>';
 }
 var out = "";
 for (var i = 0; i < boards.length; i++) out += boardHtml(boards[i]);
 return head + out;
}

/* <details> abiertos sobreviven el re-render por SSE (FR#16). */
function syncOpen() {
 var els = document.querySelectorAll("details[data-fid]");
 var fresh = {};
 for (var i = 0; i < els.length; i++)
  if (els[i].open) fresh[els[i].getAttribute("data-fid")] = true;
 openDetails = fresh;
}
function reopenDetails() {
 var els = document.querySelectorAll("details[data-fid]");
 for (var i = 0; i < els.length; i++)
  if (openDetails[els[i].getAttribute("data-fid")]) els[i].open = true;
}

function render() {
 syncOpen();
 var connEl = document.getElementById("conn");
 connEl.className = "conn " + conn;
 connEl.textContent = connLabel();
 connEl.title = snapshot && snapshot.generatedAt
  ? "último snapshot: " + snapshot.generatedAt : "";
 document.getElementById("warns").innerHTML = warningsHtml();
 document.getElementById("root").innerHTML = n1Html() + n2Html();
 reopenDetails();
 var toastEl = document.getElementById("toast");
 toastEl.className = "toast" + (toast ? " show" + (toast.kind ? " " + toast.kind : "") : "");
 toastEl.textContent = toast ? toast.text : "";
}

/* ── Datos: GET /api/state + SSE /events (contrato Slice 6) ─────────── */

function refresh() {
 fetch("/api/state")
  .then(function (r) { return r.json(); })
  .then(function (s) { snapshot = s; render(); })
  .catch(function () { render(); });
}
function post(path, body) {
 return fetch(path, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-frida-monitor-token": TOKEN },
  body: JSON.stringify(body)
 }).then(function (r) { return r.json(); });
}
function setToast(text, kind) {
 toast = { text: text, kind: kind || "" };
 render();
 if (toastTimer) clearTimeout(toastTimer);
 toastTimer = setTimeout(function () { toast = null; render(); }, 4000);
}

/* ── Acciones (delegación por data-action) ──────────────────────────── */

function doAdvance(id) {
 post("/api/advance", { id: id }).then(function (res) {
  if (res.warning) warnings["adv:" + id] = res.warning;
  else delete warnings["adv:" + id];
  if (res.moved && res.command) setToast("Comando enviado al chat de Frida: " + res.command);
  refresh();
 }).catch(function () { setToast("POST /api/advance falló — ¿host vivo?", "warn"); });
}
function doShip(id) {
 post("/api/ship", { id: id }).then(function (res) {
  if (res.failure === "no-plan") warnings["ship:" + id] = res.warning ||
   "No hay plan enlazado — completa /skill:plan antes de shipear.";
  else delete warnings["ship:" + id];
  if (res.moved) setToast("🚀 Ship listo: " + res.phaseCount + " fase(s) en backlog del board");
  refresh();
 }).catch(function () { setToast("POST /api/ship falló — ¿host vivo?", "warn"); });
}
function doPause(id) {
 var f = featureById(id);
 post("/api/pause", { id: id, paused: f ? !f.paused : true }).then(function (res) {
  if (res && res.ok === false) setToast("Feature no encontrada", "warn");
  refresh();
 }).catch(function () { setToast("POST /api/pause falló — ¿host vivo?", "warn"); });
}
function legacyCopy(text, done) {
 try {
  var ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  done();
 } catch (e) {
  setToast("No se pudo copiar — cópialo a mano", "warn");
 }
}
function doCopy(text) {
 function done() { setToast("Copiado: " + text); }
 if (navigator.clipboard && navigator.clipboard.writeText) {
  navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
 } else legacyCopy(text, done);
}

document.addEventListener("click", function (ev) {
 var el = ev.target.closest("[data-action]");
 if (!el) return;
 var a = el.getAttribute("data-action");
 var id = el.getAttribute("data-id");
 if (a === "advance") doAdvance(id);
 else if (a === "ship") doShip(id);
 else if (a === "pause") doPause(id);
 else if (a === "copy") doCopy(el.getAttribute("data-copy"));
 else if (a === "dismiss") { delete warnings[id]; render(); }
});

var es = new EventSource("/events");
es.onopen = function () { conn = "live"; render(); };
es.onerror = function () { conn = "retry"; render(); };
es.addEventListener("snapshot", function (e) {
 try { snapshot = JSON.parse(e.data); } catch (err) { return; }
 render();
});

refresh();
})();
</script>
</body>
</html>`;
}
```

#### 2. Retiro de la página mínima

**File**: `src/tools/frida-workflow/monitor-server.ts`
**Changes**: MODIFY. Elimina la sección `monitorBootstrapPage` completa (divisor incluido), añade el import de monitor-html y sirve las rutas `/` → `renderMonitorHubPage()` y `/sdd` → `renderSddPage(token)`.

Diff contra la Fase 6 — tres ediciones (la cuarta pieza del contrato, `renderMonitorHubPage`, se importa junto a `renderSddPage`):

**1.** Import nuevo junto al de `./panel-spec`:

```ts
import { renderMonitorHubPage, renderSddPage } from "./monitor-html";
```

**2.** Elimina la sección página mínima COMPLETA (divisor incluido) — el bloque `// ── Página mínima (Slice 7 …)` con `monitorBootstrapPage`. Ajusta el párrafo «Páginas / y /sdd» del header comment al texto final del Architecture:

```ts
// Páginas / y /sdd (FR#7/FR#16): servidas por monitor-html.ts — hub de
// métodos (D7) en / y N1+N2 juntos con detalle por feature en /sdd. El token
// se EMBEBE en /sdd para los POST autenticados (FR#8); GET/SSE siguen
// abiertos. El contrato servidor↔HTML es el snapshot (MonitorSnapshot) + los
// POST /api/*.
```

**3.** Rutas GET `/` y `/sdd` (reemplazo de los cuerpos de la Fase 6):

```ts
  if (method === "GET" && url.pathname === "/") {
   sendHtml(res, renderMonitorHubPage());
   return;
  }

  if (method === "GET" && url.pathname === "/sdd") {
   sendHtml(res, renderSddPage(token));
   return;
  }
```

(Verificado por los ACs: `grep -c "monitorBootstrapPage" = 0` y `grep -c "renderSddPage" >= 2`.)

#### 3. Reexports

**File**: `src/tools/frida-workflow/index.ts`
**Changes**: MODIFY. Añade el bloque de reexports de monitor-html.

```ts
// Páginas del monitor (FR#7): hub de métodos (D7) + /sdd con N1 y N2 juntos.
export { renderMonitorHubPage, renderSddPage } from "./monitor-html";
```

#### 4. Tests de las páginas

**File**: `test/frida-workflow/monitor-html.test.ts`
**Changes**: NEW. Hub espejo «De cero», token embebido y contrato servidor↔HTML, fallback y detalle FR#16.

```ts
// monitor-html.test.ts — páginas del monitor (FR#7/FR#16/D7).
//
// Las páginas son strings self-contained; los tests afirman el CONTRATO con
// el servidor (Slice 6): endpoints usados, token embebido para los POST,
// controles data-action y el hub espejo de «De cero» (D7). Molde de
// aislamiento: test/frida-workflow/panel-spec.test.ts.
import { describe, expect, it } from "vitest";
import {
 renderMonitorHubPage,
 renderSddPage,
} from "../../src/tools/frida-workflow/monitor-html";

const TOKEN = "11111111-2222-3333-4444-555555555555";

describe("hub (/) — espejo de «De cero» (D7/FR#7)", () => {
 it("título Frida Monitor + SDD activo enlazado a /sdd", () => {
  const html = renderMonitorHubPage();
  expect(html).toContain("Frida Monitor");
  expect(html).toContain('href="/sdd"');
  expect(html).toContain("SDD");
  expect(html).toContain("activo");
 });

 it("AiDD y TEA listados como próximamente (sin página)", () => {
  const html = renderMonitorHubPage();
  expect(html).toContain("AiDD");
  expect(html).toContain("TEA");
  expect(html).toContain("próximamente");
  expect(html).not.toContain('href="/aidd"');
 });

 it("estático: sin fetch ni EventSource (el estado vivo vive en /sdd)", () => {
  const html = renderMonitorHubPage();
  expect(html).not.toContain("fetch(");
  expect(html).not.toContain("EventSource");
 });
});

describe("/sdd — token embebido y contrato del servidor (FR#7/FR#8)", () => {
 it("embebe el token como string JSON para los POST autenticados", () => {
  const html = renderSddPage(TOKEN);
  expect(html).toContain(`var TOKEN = "${TOKEN}"`);
 });

 it("consume el contrato Slice 6: /api/state, SSE /events y POST /api/*", () => {
  const html = renderSddPage(TOKEN);
  expect(html).toContain("/api/state");
  expect(html).toContain('"/events"');
  expect(html).toContain("/api/advance");
  expect(html).toContain("/api/pause");
  expect(html).toContain("/api/ship");
  expect(html).toContain("EventSource");
  expect(html).toContain("x-frida-monitor-token");
 });

 it("controles POST y dismiss declarados por data-action", () => {
  const html = renderSddPage(TOKEN);
  for (const a of ['"advance"', '"ship"', '"pause"', '"copy"', '"dismiss"']) {
   expect(html).toContain(a);
  }
 });

 it("título del documento contiene Frida Monitor (test S6 del servidor)", () => {
  // El test locked de monitor-server.test.ts asume toContain("Frida Monitor")
  // en AMBAS rutas — esta página no debe romperlo.
  expect(renderSddPage(TOKEN)).toContain("Frida Monitor");
 });
});

describe("/sdd — fallback y detalle FR#16 (degradación sin host)", () => {
 it("fallback del spec SDD espeja SDD_PANEL_SPEC (columnas + emptyState)", () => {
  const html = renderSddPage(TOKEN);
  expect(html).toContain("/skill:discover <idea>");
  expect(html).toContain("ready-to-ship");
  expect(html).toContain("Continuar a research");
  expect(html).toContain("Ship → fases a ejecución");
 });

 it("detalle por feature: <details> con timeline, artefactos e historial", () => {
  const html = renderSddPage(TOKEN);
  expect(html).toContain("data-fid"); // <details> por feature + reapertura SSE
  expect(html).toContain("pendiente"); // estado individual del artefacto
  expect(html).toContain("Historial");
  expect(html).toContain("timeline y artefactos"); // summary del detalle
 });

 it("escape HTML presente (ids/rutas nunca rompen el markup)", () => {
  const html = renderSddPage(TOKEN);
  expect(html).toContain("&amp;"); // tabla de escape en esc()
 });
});
```

### Success Criteria

#### Automated Verification

- [ ] Tests de las páginas pasan: `npx vitest run test/frida-workflow/monitor-html.test.ts`
- [ ] Suite del servidor sigue verde con las páginas reales: `npx vitest run test/frida-workflow/monitor-server.test.ts`
- [ ] Typecheck del proyecto verde: `npm run typecheck`
- [ ] `grep -n "export function renderMonitorHubPage" src/tools/frida-workflow/monitor-html.ts` retorna una línea (hub D7)
- [ ] `grep -n "export function renderSddPage" src/tools/frida-workflow/monitor-html.ts` retorna una línea (FR#7)
- [ ] `grep -c "monitorBootstrapPage" src/tools/frida-workflow/monitor-server.ts` retorna 0 (página mínima retirada por S7 — reemplazo documentado en el comentario S6)
- [ ] `grep -c "renderSddPage" src/tools/frida-workflow/monitor-server.ts` retorna >= 2 (import + ruta /sdd con token)
- [ ] `grep -n "monitor-html" src/tools/frida-workflow/index.ts` retorna >= 1 (reexport anticipado por el fence)
- [ ] `grep -c "x-frida-monitor-token" src/tools/frida-workflow/monitor-html.ts` retorna >= 1 (POST autenticado FR#8)
- [ ] `grep -c "data-fid" src/tools/frida-workflow/monitor-html.ts` retorna >= 2 (detalle FR#16: markup + reapertura tras SSE)

#### Manual Verification

- [ ] Navegador en `http://127.0.0.1:<puerto>/`: hub espejo «De cero» — SDD ● activo → /sdd; AiDD/TEA próximamente (FR#7/D7)
- [ ] /sdd muestra N1 (columnas del spec) y N2 (boards espejo) JUNTOS; cambios reflejados <1s vía SSE (FR#7, debounce 250ms incluido)
- [ ] Click en «timeline y artefactos» abre el detalle FR#16: timeline completo + artefactos por etapa con estado individual (✓ ruta / — pendiente) + historial; permanece abierto tras refrescos SSE
- [ ] ▶ «Continuar a …» desde el HTML dispara POST con token; el chat de Frida recibe `/skill:<etapa> <frd>` (mismo canal que el overlay) y la tarjeta avanza al instante (FR#4)
- [ ] ▶ Ship con plan listo crea fases en backlog (badge n/m aparece); sin plan → banner ámbar «completa /skill:plan…» con ✕ dismissible (FR#5/FR#6/FR#14)
- [ ] ⏸/▶ Pausa persiste y el punto actual del timeline pasa a ámbar en el HTML y en el overlay N1 (FR#11)
- [ ] Modo claro/oscuro por prefers-color-scheme (NFR estética)
- [ ] Host muerto (deactivate): indicador «reconectando…» sin romper la página; al revivir, el SSE reconecta y refresca (NFR degradación)
- [ ] N1 vacío: `/skill:discover <idea>` + botón Copiar; N2 vacío: indicación de ship (FR#15)

---

## Phase 8: Hub Welcome + URL monitor + encadenamiento parent

### Overview

Fase terminal: retarjeta la sección «De cero» de la Welcome (FR#10/D8 — «Desarrollo Autónomo (SDD)» → submit `/pipeline`; «Planificar con AiDD» → roadmap PRÓXIMAMENTE), añade el ancla «Abrir monitor ↗» con la URL provista por el host (mensaje `monitor_url` host→webview, cache `monitorUrl` + re-post en webview_ready — molde lastGoalState; i-3 dentro del IIFE de la Fase 6) y encadena `parent:` en los 4 SKILL.md bundled (D6 — reconciler determinista; `syncBundledSkills` force-overwrite al arrancar). Cierra con la baseline completa del proyecto.

### Changes Required

#### 1. Retarjetado + ancla al monitor

**File**: `webview/components/Welcome.tsx`
**Changes**: MODIFY. Prop `monitorUrl`, tarjeta `sdd-autonomous` (submit `/pipeline`), `aidd-plan` → roadmap PRÓXIMAMENTE, ancla nativa `<a href>` con stopPropagation dentro de la tarjeta SDD.

```tsx
// Welcome.tsx — retarjetado «De cero» (FR#10/D8) + ancla al monitor.
//
// D7: títulos/descs espejan el hub del monitor (monitor-html.ts) verbatim;
// el badge usa la convención local de la Welcome («ROADMAP», :64) →
// «PRÓXIMAMENTE» (mayúsculas; el hub emite «próximamente» — cosmético,
// WARNING del slice-verifier ratificada como by-design).
// tea-test y team-packs quedan IGUAL (sin decisión que los toque).

// 1) Firma: añadir monitorUrl tras workspace.
export function Welcome({
 onPrompt,
 onInsert,
 onOpenSettings,
 workspace,
 monitorUrl,
}: {
 onPrompt?: (text: string) => void;
 onInsert?: (text: string) => void;
 onOpenSettings?: (tab: SettingsTab) => void;
 workspace?: WorkspaceInfo;
 /** FR#10 — URL del monitor del pipeline (mensaje monitor_url del host);
  *  habilita el ancla «Abrir monitor ↗» de la tarjeta SDD. */
 monitorUrl?: string;
}) {

// 2) Categoría «De cero» (greenfield) — reemplazo de las DOS primeras
//    tarjetas (aidd-ship → tarjeta SDD; aidd-plan → roadmap próximamente):
  cards: [
   {
    id: "sdd-autonomous",
    title: "Desarrollo Autónomo (SDD)",
    desc: "La fábrica: features avanzando discover → research → design → plan → 🚀 ready-to-ship, con su board de ejecución.",
    iconName: "tools",
    prompt: "/pipeline",
    actionType: "submit",
   },
   {
    id: "aidd-plan",
    title: "Planificar con AiDD",
    desc: "Brief, PRD, arquitectura y specs para una idea nueva.",
    iconName: "rocket",
    actionType: "roadmap",
    badge: "PRÓXIMAMENTE",
    badgeTitle:
     "Entrará con el motor de paneles (FR#9) cuando el método exista — /wf aidd-plan sigue disponible hoy",
   },
   // … tea-test y team-packs sin cambios …
  ],

// 3) Render de tarjetas — ancla al monitor DENTRO de la tarjeta SDD, tras
//    el <p className="starter-card-desc">{c.desc}</p> existente:
         {/* FR#10 — ancla al monitor del pipeline: la URL llega por el
             mensaje monitor_url (host → webview). Ancla nativa <a href>:
             abre en el navegador externo (patrón banner OAuth,
             App.tsx:494-510). stopPropagation: el click NO debe disparar
             el submit /pipeline de la tarjeta contenedora. Estilos inline:
             este slice no toca styles.css (sólo S5). */}
         {c.id === "sdd-autonomous" && monitorUrl && (
          <a
           href={monitorUrl}
           target="_blank"
           rel="noreferrer"
           title="Abrir el monitor del pipeline (N1 + N2) en el navegador"
           onClick={(e) => e.stopPropagation()}
           style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginTop: 2,
            width: "fit-content",
            fontSize: 11,
            color: "var(--vscode-textLink-foreground)",
            textDecoration: "none",
           }}
          >
           Abrir monitor ↗
          </a>
         )}
```

#### 2. InMessage monitor_url

**File**: `webview/types.ts`
**Changes**: MODIFY. `State.monitorUrl?: string` + variante `{ type: "monitor_url"; url: string }` en InMessage.

```ts
// types.ts — InMessage monitor_url (host→webview) + estado monitorUrl (FR#10).

// 1) Interface State — añadir tras `version?: string;`:
 /** FR#10 — URL del monitor del pipeline (servidor HTTP+SSE, D3): la
  *  Welcome la usa para el ancla «Abrir monitor ↗». undefined = sin monitor. */
 monitorUrl?: string;

// 2) InMessage — añadir tras la variante `{ type: "version"; version: string }`:
 // FR#10 — el host publica la URL del monitor al arrancar el servidor (D3)
 // y la re-publica en webview_ready (arranque frío, molde lastGoalState).
 | { type: "monitor_url"; url: string }
```

#### 3. Reducer

**File**: `webview/store.ts`
**Changes**: MODIFY. `case "monitor_url": return { ...state, monitorUrl: msg.url };` tras el case "version".

```ts
// store.ts — reducer case monitor_url → state.monitorUrl (FR#10).

// Añadir tras `case "version": return { ...state, version: msg.version };`:
  // FR#10 — URL del monitor del pipeline: persiste en el estado del host
  // (NO se limpia con "cleared": el monitor vive mientras el host viva).
  case "monitor_url":
   return { ...state, monitorUrl: msg.url };
```

#### 4. Prop a Welcome

**File**: `webview/App.tsx`
**Changes**: MODIFY. `monitorUrl={state.monitorUrl}` en el render de `<Welcome>`.

```tsx
// App.tsx — pasar monitorUrl como prop a Welcome (FR#10).

// Render de <Welcome> (turns vacío) — añadir la prop tras workspace:
     <Welcome
      onPrompt={(text) => post({ type: "submit", text, mode: "steer" })}
      onInsert={(text) =>
       dispatch({
        type: "composer_insert",
        text,
       })
      }
      onOpenSettings={(tab) => {
       setConfigOpen(true);
       setSettingsTab(tab);
      }}
      workspace={state.workspace}
      monitorUrl={state.monitorUrl}
     />
```

#### 5. Host: monitor_url (3i)

**File**: `src/extension.ts`
**Changes**: MODIFY. i-1 cache `let monitorUrl` junto a `webviewReady`; i-2 re-post en webview_ready; i-3 `monitorUrl = handle.url; post({type:"monitor_url",...})` en el `.then` del IIFE de la Fase 6.

```ts
// (3i) Monitor URL al webview (FR#10). Dos piezas más (la tercera
// es i-3, abajo dentro del IIFE 3h de la Fase 6):
//  i-1. Cache junto a los pendientes de arranque frío (~683, inmediatamente
//       tras `let webviewReady = false;` — molde lastGoalState: el post
//       inicial (i-3) puede perderse si el webview aún no montó listener):
// FR#10 — URL del monitor del pipeline (D3): el servidor resuelve async; se
// cachea aquí y webview_ready la re-envía (i-2).
let monitorUrl: string | undefined;

//  i-2. En el case "webview_ready" (handleWebviewMessage), junto al re-post
//       de lastGoalState/pendingSettingsTab:
    // Fase 8 (FR#10) — re-envía la URL del monitor si el servidor ya
    // resolvió (arranque frío: el post original no tenía listener).
    if (monitorUrl) {
     post({ type: "monitor_url", url: monitorUrl });
    }

//  i-3. Dentro del IIFE 3h (Fase 6), en el .then tras `monitor = handle;`
//       (reemplaza el comentario placeholder de esa fase):
    monitorUrl = handle.url;
    post({ type: "monitor_url", url: handle.url });
```

#### 6. Skill discover — parent raíz

**File**: `src/tools/frida-pipeline/skills/discover/SKILL.md`
**Changes**: MODIFY. Paso 7.2: frontmatter `status: ready` y `parent:` vacío (raíz de la cadena).

```md
<!-- Paso 7.2 — antes: "2. **Escribe el FRD** con el Write tool. Frontmatter
     `status: ready`." -->
2. **Escribe el FRD** con el Write tool. Frontmatter `status: ready` y
   `parent:` vacío (el FRD es la raíz de la cadena: las skills downstream
   enlazan contra esta ruta — el pipeline N1 de `/pipeline` encadena
   artefactos por `parent` con fallback al topic del filename).
```

#### 7. Skill research — parent = FRD

**File**: `src/tools/frida-pipeline/skills/research/SKILL.md`
**Changes**: MODIFY. Paso 5.2: `parent: <ruta-relativa-del-FRD>`.

```md
<!-- Paso 5.2 — antes: "2. **Escribe** con el Write tool. Frontmatter
     `status: ready`." -->
2. **Escribe** con el Write tool. Frontmatter `status: ready` y
   `parent: <ruta-relativa-del-FRD>` — el path del input del Paso 1 bajo
   `.frida/artifacts/discover/` (relativo al cwd, sin comillas).
   `parent:` vacío si la investigación no viene de un FRD: el reconciler
   del pipeline N1 enlaza por `parent` y cae al topic del filename como
   fallback.
```

#### 8. Skill design — parent = research

**File**: `src/tools/frida-pipeline/skills/design/SKILL.md`
**Changes**: MODIFY. Paso 5: `parent: <ruta-relativa-del-research>`.

```md
<!-- Paso 5 — antes: "Filename: `.frida/artifacts/designs/<slug>_<topic>.md`.
     Frontmatter `status: ready`." -->
Filename: `.frida/artifacts/designs/<slug>_<topic>.md`. Frontmatter
`status: ready` y `parent: <ruta-relativa-del-research>` — el path del
artefacto consumido en el Paso 1 (relativo al cwd, sin comillas): el
reconciler del pipeline N1 encadena research → design → plan por `parent`.
```

#### 9. Skill plan — parent = design

**File**: `src/tools/frida-pipeline/skills/plan/SKILL.md`
**Changes**: MODIFY. Paso 4: `parent: <ruta-relativa-del-design>`.

```md
<!-- Paso 4 — antes: "Filename: `.frida/artifacts/plans/<slug>_<topic>.md`.
     Frontmatter `status: ready`, `phase_count: N`." -->
Filename: `.frida/artifacts/plans/<slug>_<topic>.md`. Frontmatter
`status: ready`, `phase_count: N` y `parent: <ruta-relativa-del-design>` —
el path del artefacto consumido en el Paso 1 (relativo al cwd, sin
comillas): el reconciler del pipeline N1 encadena research → design → plan
por `parent`.
```

#### 10. Test de la Welcome — título nuevo de la tarjeta SDD

**File**: `test/welcome.test.ts`
**Changes**: MODIFY. El retarjetado de la §1 cambia el título «Desarrollar Autónomo» → «Desarrollo Autónomo (SDD)»; la aserción del test «renderiza las Starter Cards de la categoría activa por defecto (Greenfield)» (línea ~38) debe seguir al nuevo título para que la baseline `npm test` de esta fase quede verde (hallazgo blocker del Step 4, aplicado).

```ts
// Test «renderiza las Starter Cards de la categoría activa por defecto (Greenfield)» —
// antes: expect(html).toContain("Desarrollar Autónomo");
expect(html).toContain("Desarrollo Autónomo (SDD)");

// §10 (b) — cadena monitor_url (fix Step 4, precedente 32d874d): la Welcome
// renderiza el ancla «Abrir monitor ↗» con la URL publicada por el host.
it("renderiza el ancla al monitor cuando monitorUrl llegó por monitor_url", () => {
 const html = renderToStaticMarkup(
  React.createElement(Welcome, {
   monitorUrl: "http://127.0.0.1:45678/",
  }),
 );
 expect(html).toContain("http://127.0.0.1:45678/");
 expect(html).toContain("Abrir monitor");
});
```

### Success Criteria

#### Automated Verification

- [ ] Typecheck del proyecto (host + webview) verde: `npm run typecheck`
- [ ] Build del webview verde: `npm run build:webview`
- [ ] Baseline completa del proyecto (slice terminal): `npm test` verde
- [ ] Cadena monitor_url ejercida por test (Welcome renderiza el ancla con la URL del host): `npx vitest run test/welcome.test.ts`
- [ ] Suites del ecosistema afectado pasan: `npx vitest run test/frida-workflow test/frida-pipeline`
- [ ] `grep -c "monitor_url" webview/types.ts` retorna >= 1 (InMessage FR#10)
- [ ] `grep -n 'case "monitor_url"' webview/store.ts` retorna una línea (reducer)
- [ ] `grep -c "monitorUrl" webview/components/Welcome.tsx` retorna >= 3 (prop + condición + href)
- [ ] `grep -c "monitorUrl" webview/App.tsx` retorna >= 1 (prop)
- [ ] `grep -n 'prompt: "/pipeline"' webview/components/Welcome.tsx` retorna una línea (submit SDD, FR#10)
- [ ] `grep -c "PRÓXIMAMENTE" webview/components/Welcome.tsx` retorna >= 1 (AiDD, FR#10)
- [ ] `grep -c "monitor_url" src/extension.ts` retorna >= 2 (post al resolver + re-post webview_ready)
- [ ] `grep -l "parent:" src/tools/frida-pipeline/skills/discover/SKILL.md src/tools/frida-pipeline/skills/research/SKILL.md src/tools/frida-pipeline/skills/design/SKILL.md src/tools/frida-pipeline/skills/plan/SKILL.md` retorna las 4 rutas (D6)

#### Manual Verification

- [ ] Welcome con transcript vacío: «Desarrollo Autónomo (SDD)» abre el overlay /pipeline (submit) y — monitor vivo — el ancla «Abrir monitor ↗» abre el navegador en la URL del monitor (FR#10)
- [ ] «Planificar con AiDD» muestra badge PRÓXIMAMENTE sin acción; `/wf aidd-plan` escrito a mano sigue funcionando (D8)
- [ ] Developer: Reload Webviews con la Welcome visible: el ancla reaparece (re-post monitor_url en webview_ready)
- [ ] Tras F5, `grep -m1 "parent:" ~/.frida/skills/research/SKILL.md` muestra la instrucción (syncBundledSkills force-overwrite al arrancar)
- [ ] En un scratch, `/skill:research <frd>` produce un artefacto con `parent:` apuntando al FRD de entrada (encadenamiento D6)

---

## Testing Strategy

### Automated

- Cada fase corre SU suite acotada: `npx vitest run test/frida-workflow/<archivo>` (features / panel-spec / monitor-server / monitor-html) — sin depender de fases posteriores (Ordering Constraint del diseño).
- Typecheck del proyecto (host + webview) en todas las fases: `npm run typecheck`.
- Fases 5 y 8 además: `npx vitest run test/frida-workflow test/frida-pipeline` (ecosistema afectado por la baja del banner y el retarjetado).
- Fase 8 (terminal): baseline completa `npm test` + `npm run build:webview`.
- ACs grep por fase (ver Automated Verification por fase): afirman presencia de firmas/patrones clave en los archivos de la fase.

### Manual Testing Steps

1. Con el monitor abierto en el navegador, escribir features.json desde bash debe reflejarse en <1s (SSE + watcher + debounce 250ms incluido).
2. `curl -X POST` sin token → 401 (delta consciente vs 403 de la plantilla ui-server.ts:634 — el FRD manda 401).
3. Watcher tmp+rename: escribir un `*.tmp` bajo `.frida/artifacts/` no genera broadcast; el rename subsiguiente sí (una sola señal por ráfaga).
4. Developer: Reload Webviews con `/pipeline` abierto → el overlay reaparece (lección ba40da0) y el orden de footers queda Pipeline → Board → Workflow (D8).
5. Boot sin features.json: `/pipeline` en workspace limpio → EmptyState con `/skill:discover <idea>`, sin error (FR#15, NFR reliability).
6. Skills sync: tras modificar los SKILL.md, `syncBundledSkills` force-overwrite en el próximo arranque del host — verificar en `~/.frida/skills/`.
7. Presupuestar un pass de pulido visual tras la primera sesión de uso (precedente /board: 5 fixes el mismo día).

## Performance Considerations

- Debounce del watcher ~250ms agrupa ráfagas de escritura del agente; un solo re-escaneo por ráfaga.
- Escaneo de buckets = readdir + statSync por bucket (4 buckets × 2 raíces): barato al volumen esperado (<100 artefactos); el snapshot SSE se computa on-demand en cada cambio, no por tick.
- SSE: broadcast secuencial a un `Set` pequeño de clientes; heartbeat cada 30s `.unref()` (molde ui-server.ts:513-522) para limpiar conexiones muertas.
- El servidor escucha en puerto efímero: cero contención EADDRINUSE entre recargas del host.
- El overlay re-monta por cambio (commit snapshot completo, patrón /board) — costo aceptado y probado por N2.

## Migration Notes

- `features.json` es NUEVO: sin migración de schema existente. Primer arranque: `loadFeatures` devuelve vacío → reconciler adopta FRDs existentes de `.frida/artifacts/discover/` y del seed `.rpiv/artifacts/discover/`.
- Seed `.rpiv/`: solo-lectura; los artefactos históricos se adoptan como features con sus etapas derivadas (si tienen research/design/plan encadenados por topic, la etapa refleja el más avanzado con artefacto — ver reconcile).
- Rollback: borrar `.frida/artifacts/pipeline/features.json` + desinstalar la versión → estado pre-feature intacto (el board N2 no se toca salvo por ships explícitos del usuario).
- Los SKILL.md ganan `parent:` — compatible hacia atrás (el reconciler funciona sin parent vía topic; artefactos viejos no se reescriben).

## Developer Context

(Estructura para notas de interacción post-escritura y fallbacks del Step 4.)

**Nota para implement (Step 4 — indentación):** los fences de código provienen del `## Architecture` del diseño con indentación de 1 espacio; los archivos reales del repo usan tabs (`src/tools/frida-workflow/board.ts`, `src/extension.ts`, `webview/*`). Al aplicar cada fence, normalizar la indentación a tabs — el contenido (identificadores, cadenas, orden) es lo contractual, no el ancho de la indentación.

## Plan Review (Step 4)

_Revisión post-finalización independiente por los subagentes artifact-code-reviewer y artifact-coverage-reviewer contra el codebase vivo en HEAD (d46ed97). Hallazgos triados en el Step 5. Tally: 1 blocker, 2 concerns, 2 suggestions._

| source   | plan-loc                          | codebase-loc                        | severity   | dimension             | finding                                                                                                                                                                                                                                         | recommendation                                                                                                                              | resolution         |
| -------- | --------------------------------- | ----------------------------------- | ---------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| code     | Phase 8 §1 (Welcome.tsx)          | test/welcome.test.ts:38             | blocker    | actionability         | Retitling the aidd-ship card to `«Desarrollo Autónomo (SDD)»` breaks `test/welcome.test.ts` (`expect(html).toContain("Desarrollar Autónomo")` — not a substring of the new title), Phase 8's file list omits `test/welcome.test.ts`, and its AC demands `npm test` verde | Add `test/welcome.test.ts` to Phase 8's files and update the line-41 assertion to `"Desarrollo Autónomo (SDD)"`                               | applied: Fase 8 §10 nueva (test/welcome.test.ts en Files + fence con la aserción actualizada; frontmatter phases[8].files actualizado) |
| code     | Phase 8 §1 (Welcome.tsx)          | webview/App.tsx:501-505             | concern    | codebase-fit          | The «Abrir monitor ↗» anchor omits `target="_blank" rel="noreferrer"` while citing the OAuth `<a href>` pattern (App.tsx:501-505); VS Code webviews only open external http(s) links in the system browser when `target="_blank"` is set, so FR#10's "abre el navegador" manual check fails silently | Add `target="_blank"` and `rel="noreferrer"` to the anchor in the Phase 8 §1 fence                                                      | applied (plan-local; design follow-up: design 2026-08-31_08-17-40 §Architecture Welcome.tsx) — ancla con target="_blank" rel="noreferrer" en el fence §1 |
| coverage | Phase 5 Success Criteria (Automated) | <n/a>                            | concern    | verification-coverage | Lección «integrar motor nuevo a extension.ts rompe en las costuras — tests punta a punta del cableado desde el inicio» (Precedent 32d874d, fixes 3ee3b97/c1b6e5/09ce750): Phase 5/6/8 integran cableado nuevo en extension.ts (case `pipeline` → `mountPipelineOverlay`, `onAdvance`→`runCustomCommand`, IIFE Disposable 3h, cadena `monitor_url` 3i) pero el Automated Verification de esas fases es sólo typecheck + suites existentes + greps de presencia — cero test automatizado ejerce los seams | Añadir a Phase 5 `#### Automated Verification:` un bullet que corra un test de cableado mínimo (p. ej. `test/frida-workflow/pipeline-wiring.test.ts`) que afirme el contrato del handler `onAdvance`/`onShip` (advanceFeature + `AdvanceResult.command` → onCommand) y el dispatch `case "pipeline"`; replicar el bullet en Phase 8 para la cadena `monitor_url` (i-1/i-2/i-3) | applied (plan-local; design follow-up: design 2026-08-31_08-17-40 §Slices 5/8) — Fase 5 §7 pipeline-wiring.test.ts + AV nueva; Fase 8 §10(b) test del ancla + AV nueva |
| code     | Phase 6 §3 (extension.ts)         | <n/a>                               | suggestion | code-quality          | The monitor IIFE's rejection handler `() => { /* sin monitor: /pipeline y /board siguen operativos */ }` discards the listen/start `Error` with no logging, leaving a dead monitor undiagnosable during Phase 6's Manual Verification (curl 401 / browser checks) | Log the failure once (e.g. `console.warn` or a `post` info toast) in the rejection handler                                                    | applied (plan-local; design follow-up: design 2026-08-31_08-17-40 §Architecture 3h) — rejection handler registra el fallo una vez (console.warn) |
| code     | Phase 1 §1 (features.ts)          | src/tools/frida-workflow/board.ts:161 | suggestion | codebase-fit        | All 8 phases' code fences use single-space indentation while every neighbor in `src/tools/frida-workflow`, `src/extension.ts` and `webview/` uses tabs (board.ts saveBoard, board-ui.tsx, extension.ts), so verbatim application diverges from repo convention | Instruct the implementer (Developer Context) to normalize fence indentation to tabs on apply                                        | applied — nota de normalización a tabs en Developer Context |

_Coverage reviewer — resumen de cubiertos: design Verification Notes §1–§10 y Precedents/Lecciones P1–P9, L1–L6 verificados como cubiertos (criteria o code-fence); Migration Notes y Performance Considerations del diseño presentes verbatim como secciones top-level del plan._

## References

- Design: `.rpiv/artifacts/designs/2026-08-31_08-17-40_pipeline-panels-sdd-n1-n2.md`
- Research: `.rpiv/artifacts/research/2026-08-31_07-56-10_pipeline-panels-sdd-n1-n2-html.md`
- FRD: `.rpiv/artifacts/discover/2026-08-31_07-08-47_pipeline-panels-sdd-n1-n2-html.md`
- Issue origen: #191 `efuentesp/frida-code-vsix` (kanban de tareas — sustituido por este diseño)
