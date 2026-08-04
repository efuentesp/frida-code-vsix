---
date: 2026-08-03T21:38:12-0600
author: Edgar F. Fuentes Perea
commit: c90ad1a
branch: main
repository: frida-code
topic: "Frida Usage Dashboard + Export (frida-usage-report/v1)"
tags: [design, usage, telemetry, dashboard, export, sdlc]
status: ready
parent: ".rpiv/artifacts/research/2026-08-03_21-38-12_frida-usage-telemetry.md"
last_updated: 2026-08-03T21:38:12-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Design: Frida Usage Dashboard + Export (frida-usage-report/v1)

## Summary

Un **dashboard de uso + exportación de telemetría** dentro de Frida. Un indexer (que modela `src/session-stats.ts`) barre `globalStorage/sessions/*.jsonl` y produce un snapshot agregado por periodo, cacheado en `globalStorage/usage-index.json`. Un nuevo tab **"Uso"** del `SettingsHub` muestra 6 KPIs + gráficas (SVG/CSS hechos a mano, 0 dependencias). Un comando `frida.exportUsage` arma el reporte versionado **`frida-usage-report/v1`** (con opt-in inline al exportar) para que lo consuma una **app concentradora externa**.

Principio rector: **Frida solo produce/etiqueta datos; nunca los cruza** contra fuentes externas (tiempo del management, KLOCs de git, defectos). El contrato `v1` incluye los campos de fases posteriores (F2–F4) como opcionales, de modo que lo aditivo sigue siendo `v1` y solo un cambio breaking sube a `v2`.

## Requirements

- **R1 — Dashboard personal completo**: tab "Uso" con 6 KPIs (tokens in/out, costo, sesiones, turnos, cache hit %, tiempo activo) + 6 gráficas (tokens/costo por día, uso por modelo, top herramientas, artefactos por lenguaje, heatmap hora×día, top sesiones). Selector Hoy/7d/30d/Todo.
- **R2 — Export `frida-usage-report/v1`**: JSON versionado, con identidad (email en claro + org + proyecto + repo + rol), KPIs, breakdowns, comportamiento, adopción, effectiveness y quality. Niveles `aggregated | structured | detailed`.
- **R3 — "Etiqueta, no cruces"**: Frida aporta insumos (`assistedKloc`, `bySdlcPhase`, `bugFixSignals`, `role`, series por fase); el concentrador hace los cruces.
- **R4 — Clasificador por metadatos únicamente**: tool name / skill / comando bash / extensión → fase. Nunca contenido del prompt.
- **R5 — Contrato `v1` estable**: campos de F2–F4 opcionales en `v1`.
- **R6 — Identidad**: `frida.user.email` (claro, opt-in), `frida.org`, `frida.user.role`; proyecto del workspace, repo de `git remote`.

## Current State Analysis

### Key Discoveries (ground truth @ `c90ad1a`)

- **JSONL de sesión = fuente de verdad**. 23 sesiones / 11 MB en `globalStorage/sessions/`. `entry.type` ∈ {session, message, custom_message, model_change, thinking_level_change, compaction}; `entry.timestamp` ISO-8601 string.
- **`usage`** en `entry.message.usage` (assistant msgs), keys `input/output/cacheRead/cacheWrite/reasoning/totalTokens/cost`; **`cost` es objeto** `{input,output,cacheRead,cacheWrite,total}`. `compaction` lleva `usage` toplevel.
- **CRÍTICO — tool calls = bloques `toolCall`** (no `tool_use`): `message.content[]` con `{type:"toolCall", id, name, arguments}`. `write`→`{path, content}`, `edit`→`{path, edits:[{oldText,newText}]}`, `bash`→`{command}`. → `assistedKloc` contable desde `arguments` sin retener contenido.
- **`session` entry trae `cwd`** → identifica el proyecto de la sesión.
- **Indexer a modelar**: `src/session-stats.ts:84` `readSessionStats` (caché por mtime + bucle de acumulación).
- **KPIs ya calculados** en `extension.ts:706` `postUsage`; posteados con `post({type:"usage"})`.
- **Webview**: store reducer puro `webview/store.ts`; tipos en `webview/types.ts`; `SettingsHub.tsx:22` `TABS` + `:51` fetch-on-open; handler `extension.ts:1590` `handleWebviewMessage`.
- **Display de uso existente**: `ContextBar.tsx` (sesión viva) — reusar `fmt()`, no duplicar.
- **Stack**: React 18 + Vite + plain CSS (`webview/styles.css`) + lucide-react. **Sin lib de gráficas**.
- **Gateway no expone identidad** (`softtek-provider.ts`: solo `X-Api-Key` + `GET /models`) → org/email son settings.
- **Señales existentes**: `approval-logger.ts` (allow/block), `activity-tracker.ts:112` (tokens por subagente).
- **Greenfield**: no hay telemetría/export previa.

## Scope

### Building (F1 MVP)

- Contrato `frida-usage-report/v1` + tipos (`report-schema.ts`).
- Indexer multi-sesión incremental (caché mtime) + clasificador de artefactos (extensión → lenguaje/tipo).
- Identidad (settings + fallback git) + opt-in inline.
- Report builder (ensambla `v1`).
- Comando `frida.exportUsage` (previsualización + opt-in + `showSaveDialog`).
- Capa webview (mensajes `list_usage` / `usage_report`).
- Tab "Uso" con 6 KPIs + 6 gráficas SVG/CSS + selector de periodo.

### Not Building

- Concentrador/agregador, rankings centralizados, panel de admin (responsabilidad de la app externa).
- ROI, benchmarks por rol, cohortes (app externa).
- Clasificador SDLC real (campo `bySdlcPhase` previsto en `v1` pero **vacío en F1**; se llena en F2).
- `bugFixSignals`, `rework`, `codeQuality` reales (campos previstos, `0` en F1; F2–F3).
- Subida directa al concentrador (F5).
- El cruce contra métricas externas (tiempo/KLOCs/defectos).

## Decisions

### D1 — Gráficas hand-rolled SVG/CSS (0 dependencias)

**Ambigüedad**: no existe lib de gráficas; `.vsix` ya pesa 42 MB. **Explorado**: (A) SVG/CSS a mano — 0 deps, consistente con `webview/styles.css`, control total de tema en el webview de VS Code; (B) `recharts` (~130 KB gzip) — charts más ricos pero suma superficie y peleas de tema. **Decisión**: (A) hand-rolled. Evidencia: `package.json` sin libs de gráficas; `ContextBar.tsx` ya dibuja barras con CSS plano (`ctx-fill`).

### D2 — Snapshot cache en `globalStorage/usage-index.json`

**Ambigüedad**: dónde persistir el agregado. **Explorado**: (A) JSON en `globalStorage` — sin límite, consistente con `sessions/` que vive ahí, reescritura atómica; (B) `globalState` (como `frida.activeModel`, `extension.ts:95`) — pensado para valores pequeños. **Decisión**: (A). El snapshot (series por día + breakdowns) puede crecer más allá del uso cómodo de `globalState`.

### D3 — Opt-in inline al exportar

**Ambigüedad**: dónde pedir el opt-in (el export lleva email en claro). **Explorado**: (A) inline al ejecutar `frida.exportUsage`; (B) toggle en el tab Uso; (C) onboarding inicial. **Decisión**: (A). El dashboard personal (tab) es solo lectura local → no requiere opt-in; el opt-in solo aplica al export con identidad. Menos intrusivo.

### D4 — Indexer incremental por mtime, modela `session-stats.ts`

**Decisión**: el indexer generaliza el patrón de `readSessionStats` (`session-stats.ts:27` caché por mtime, `:84` bucle de parseo) a multi-sesión. Solo reindexa sesiones con mtime nuevo. Retroactivo al primer arranque (indexa las 23 sesiones existentes).

### D5 — `assistedKloc` desde `arguments`, sin retener contenido

**Decisión**: `write.arguments.content.split("\n").length` y `Σ edit.arguments.edits[].newText.split("\n").length`. Conteo por lenguaje (extensión de `arguments.path`). El reporte `structured`/`aggregated` **no** incluye contenido, solo enteros + extensión.

### D6 — Identidad desde settings + git; gateway no aporta org

**Decisión**: `frida.user.email` (fallback `git config user.email` para pre-llenar), `frida.org`, `frida.user.role`. El gateway DevEngine no devuelve tenant/usuario (`softtek-provider.ts`).

### D7 — Contrato `v1` con campos F2–F4 opcionales

**Decisión**: `report-schema.ts` define todos los campos desde F1; los de F2–F4 (`bySdlcPhase`, `bugFixSignals`, `rework`, `quality.*`, etc.) existen como opcionales con default `0`/`[]`/`false`. Aditivo = `v1`; breaking = `v2`.

## Architecture

> Los code fences se llenan slice por slice (Step 6) al aprobar cada checkpoint. Vacíos = pendiente.

### src/usage/report-schema.ts — NEW

Tipos TS del contrato `frida-usage-report/v1` (todos los campos; F2–F4 opcionales) + constantes de schema + helpers de defaults + guard de versión.

```typescript
// Contrato del reporte de uso de Frida (frida-usage-report/v1).
//
// Única fuente de verdad del formato que Frida exporta para que lo consuma la
// app concentradora externa. Todos los campos existen desde v1; los de fases
// posteriores (F2–F4: bySdlcPhase, bugFixSignals, rework, quality.*) son
// opcionales con default 0/[]/false en F1. Regla de versionado: lo aditivo
// sigue siendo v1; solo un cambio breaking sube a v2.
//
// Diseño: .rpiv/artifacts/designs/2026-08-03_21-38-12_frida-usage-telemetry.md

/** Identificador de schema. Subir a "v2" solo ante un cambio breaking. */
export const USAGE_REPORT_SCHEMA = "frida-usage-report/v1" as const;

/** Granularidad del bucket temporal del periodo consultado. */
export type PeriodGranularity = "day" | "week" | "month";

/** Nivel de detalle expuesto en el reporte (privacidad creciente). */
export type DetailLevel = "aggregated" | "structured" | "detailed";

/** Rol declarado del usuario (lo evalúa el concentrador; Frida no juzga). */
export type UserRole = "dev" | "qa" | "architect" | "lead" | "devops" | "other";

/** Fases del SDLC (el clasificador de F2 etiqueta por metadatos). */
export type SdlcPhase =
 | "analysis"
 | "design"
 | "construction"
 | "testing"
 | "release"
 | "maintenance"
 | "unclassified";

export interface ReportPeriod {
 /** ISO-8601 (inclusive). */
 from: string;
 /** ISO-8601 (inclusive). */
 to: string;
 granularity: PeriodGranularity;
}

export interface ReportIdentity {
 org: string;
 /** En claro (opt-in); "" si no hay consentimiento. */
 email: string;
 project: string;
 repo: string;
 repoRemote: string;
 /** Hash estable de la máquina (sha256) para desduplicar en el concentrador. */
 hostFingerprint: string;
 /** IANA (p.ej. "America/Mexico_City"). */
 timezone: string;
 role: UserRole;
}

export interface ReportConsent {
 telemetryOptIn: boolean;
 detailLevel: DetailLevel;
}

export interface ReportKpis {
 tokensIn: number;
 tokensOut: number;
 cacheRead: number;
 cacheWrite: number;
 /** USD (0 si el gateway no factura). */
 cost: number;
 sessions: number;
 turns: number;
 /** Tiempo activo (firstTs→lastTs) sumado por sesión. */
 activeMs: number;
 /** 0–100 (del último request, como postUsage). */
 cacheHitPct: number;
 avgTurnTokens: number;
}

// --- Breakdowns ---

export interface ByModel {
 model: string;
 provider: string;
 tokens: number;
 cost: number;
 turns: number;
}
export interface ByProvider {
 provider: string;
 tokens: number;
 cost: number;
}
export interface ByTool {
 tool: string;
 count: number;
}
export interface ByLanguage {
 language: string;
 files: number;
 edits: number;
 /** Miles de líneas asistidas por Frida (write.content / edit.newText). */
 assistedKloc: number;
}
export interface ByArtifact {
 /** markdown | code | config | doc | data | other. */
 kind: string;
 count: number;
}
export interface ByDay {
 /** YYYY-MM-DD (zona horaria del host). */
 date: string;
 tokens: number;
 cost: number;
 turns: number;
}
export interface BySdlcPhase {
 phase: SdlcPhase;
 tokens: number;
 turns: number;
 activeMs: number;
 assistedKloc: number;
}

export interface ReportBreakdowns {
 byModel: ByModel[];
 byProvider: ByProvider[];
 byTool: ByTool[];
 byLanguage: ByLanguage[];
 byArtifact: ByArtifact[];
 byDay: ByDay[];
 /** 24 buckets (0–23, hora local). */
 byHour: number[];
 /** 7 buckets (0=Dom..6=Sáb). */
 byDow: number[];
 /** F2 — previsto en v1, [] en F1. */
 bySdlcPhase: BySdlcPhase[];
}

export interface ReportBehavior {
 compactations: number;
 /** F2 — sin traza en disco; contador en sesión (ver Research Q4). */
 aborts: number;
 approvals: { allow: number; block: number };
 subagentsLaunched: number;
 skillsInvoked: number;
 questionsAsked: number;
 /** F2 — proxy de actividad de corrección de defectos. */
 bugFixSignals: number;
 /** F3 — ediciones repetidas sobre el mismo archivo. */
 rework: number;
}

export interface ReportAdoption {
 skillsUsed: string[];
 browserUsed: boolean;
 mcpUsed: boolean;
 subagentsUsed: boolean;
 contextToolUsed: boolean;
 autoApprovalUsed: boolean;
}

export interface ReportEffectiveness {
 /** 0–100 cada uno. */
 volume: number;
 breadth: number;
 efficiency: number;
 autonomy: number;
 depth: number;
 advanced: number;
 overall: number;
}

export interface ReportQuality {
 /** F3 — diagnostics emitidos al escribir. */
 diagnosticsOnWrite: number;
 testsAdded: number;
 testsPassing: number;
}

/** Contrato completo frida-usage-report/v1. */
export interface UsageReport {
 schema: typeof USAGE_REPORT_SCHEMA;
 /** ISO-8601. */
 generatedAt: string;
 clientVersion: string;
 period: ReportPeriod;
 identity: ReportIdentity;
 consent: ReportConsent;
 kpis: ReportKpis;
 breakdowns: ReportBreakdowns;
 behavior: ReportBehavior;
 adoption: ReportAdoption;
 effectiveness: ReportEffectiveness;
 quality: ReportQuality;
}

/** KPIs en cero (punto de partida para acumular). */
export function emptyKpis(): ReportKpis {
 return {
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  sessions: 0,
  turns: 0,
  activeMs: 0,
  cacheHitPct: 0,
  avgTurnTokens: 0,
 };
}

/** Breakdowns vacíos (arrays en [], byHour(24)/byDow(7) en ceros). */
export function emptyBreakdowns(): ReportBreakdowns {
 return {
  byModel: [],
  byProvider: [],
  byTool: [],
  byLanguage: [],
  byArtifact: [],
  byDay: [],
  byHour: new Array(24).fill(0),
  byDow: new Array(7).fill(0),
  bySdlcPhase: [],
 };
}

/** Behavior en defaults (campos F2–F3 en 0). */
export function emptyBehavior(): ReportBehavior {
 return {
  compactations: 0,
  aborts: 0,
  approvals: { allow: 0, block: 0 },
  subagentsLaunched: 0,
  skillsInvoked: 0,
  questionsAsked: 0,
  bugFixSignals: 0,
  rework: 0,
 };
}

/** Adoption en defaults (false / []). */
export function emptyAdoption(): ReportAdoption {
 return {
  skillsUsed: [],
  browserUsed: false,
  mcpUsed: false,
  subagentsUsed: false,
  contextToolUsed: false,
  autoApprovalUsed: false,
 };
}

/** Effectiveness en ceros (F3/F4 los llenan). */
export function emptyEffectiveness(): ReportEffectiveness {
 return {
  volume: 0,
  breadth: 0,
  efficiency: 0,
  autonomy: 0,
  depth: 0,
  advanced: 0,
  overall: 0,
 };
}

/** Quality en ceros (F3). */
export function emptyQuality(): ReportQuality {
 return { diagnosticsOnWrite: 0, testsAdded: 0, testsPassing: 0 };
}

/** Guard de contrato: rechaza (throw) un objeto que no sea v1 conocido. El
 *  concentrador debe poder confiar en `schema`; evolución controlada. */
export function assertUsageReport(obj: unknown): asserts obj is UsageReport {
 const o = obj as Partial<UsageReport> | null;
 if (!o || o.schema !== USAGE_REPORT_SCHEMA) {
  throw new Error(
   `usage-report: schema inesperado "${o?.schema}" (esperado "${USAGE_REPORT_SCHEMA}")`,
  );
 }
}
```

### test/usage/report-schema.test.ts — NEW

Test del contrato: schema estable, defaults bien dimensionados, guard de versión.

```typescript
import { describe, it, expect } from "vitest";
import {
 USAGE_REPORT_SCHEMA,
 assertUsageReport,
 emptyKpis,
 emptyBreakdowns,
 emptyBehavior,
 emptyAdoption,
 emptyEffectiveness,
 emptyQuality,
 type UsageReport,
} from "../../src/usage/report-schema";

describe("report-schema (frida-usage-report/v1)", () => {
 it("USAGE_REPORT_SCHEMA es la versión v1 estable", () => {
  expect(USAGE_REPORT_SCHEMA).toBe("frida-usage-report/v1");
 });

 it("emptyBreakdowns inicializa byHour(24) y byDow(7) en ceros", () => {
  const b = emptyBreakdowns();
  expect(b.byHour).toHaveLength(24);
  expect(b.byDow).toHaveLength(7);
  expect(b.byHour.every((n) => n === 0)).toBe(true);
 });

 it("los defaults exponen los campos F2–F3 en 0/false/[]", () => {
  expect(emptyBehavior().bugFixSignals).toBe(0);
  expect(emptyBehavior().rework).toBe(0);
  expect(emptyAdoption().skillsUsed).toEqual([]);
  expect(emptyQuality().diagnosticsOnWrite).toBe(0);
  expect(emptyBreakdowns().bySdlcPhase).toEqual([]);
 });

 it("assertUsageReport acepta un v1 bien formado", () => {
  const report: UsageReport = {
   schema: USAGE_REPORT_SCHEMA,
   generatedAt: "2026-08-03T21:38:12-0600",
   clientVersion: "0.6.0",
   period: { from: "2026-08-01", to: "2026-08-03", granularity: "day" },
   identity: {
    org: "softtek",
    email: "a@b.com",
    project: "p",
    repo: "r",
    repoRemote: "",
    hostFingerprint: "h",
    timezone: "America/Mexico_City",
    role: "dev",
   },
   consent: { telemetryOptIn: true, detailLevel: "structured" },
   kpis: emptyKpis(),
   breakdowns: emptyBreakdowns(),
   behavior: emptyBehavior(),
   adoption: emptyAdoption(),
   effectiveness: emptyEffectiveness(),
   quality: emptyQuality(),
  };
  expect(() => assertUsageReport(report)).not.toThrow();
 });

 it("assertUsageReport rechaza schema desconocido / null", () => {
  expect(() => assertUsageReport({ schema: "frida-usage-report/v2" })).toThrow();
  expect(() => assertUsageReport(null)).toThrow();
 });
});
```

### src/usage/indexer.ts — NEW

Agregador multi-sesión: barre `sessions/*.jsonl`, caché por mtime, produce `UsageSnapshot` por periodo.

```typescript
// Indexer de uso de Frida: agrega sesiones JSONL en un snapshot por periodo.
//
// Modela src/session-stats.ts (caché por mtime + parseo defensivo), elevado de
// "sesión actual" a "todas las sesiones del periodo". Atribuye el usage al modelo
// activo (trackeando model_change), cuenta los toolCall (byTool, assistedKloc por
// lenguaje, flags de adopción) y bucketiza por día/hora/dow en zona horaria del host.

import * as fs from "node:fs";
import {
 emptyKpis,
 type ReportKpis,
 type ReportBehavior,
 type ReportAdoption,
 type ByModel,
 type ByProvider,
 type ByTool,
 type ByLanguage,
 type ByArtifact,
 type ByDay,
} from "./report-schema";
import { classifyLanguage, classifyArtifactKind, countLines } from "./artifact-classifier";

export type Period = "today" | "7d" | "30d" | "all";

export interface SessionSummary {
 path: string;
 cwd: string;
 firstTs: number;
 lastTs: number;
 tokensIn: number;
 tokensOut: number;
 cost: number;
 turns: number;
 assistedKloc: number;
}

export interface UsageSnapshot {
 kpis: ReportKpis;
 breakdowns: {
  byModel: ByModel[];
  byProvider: ByProvider[];
  byTool: ByTool[];
  byLanguage: ByLanguage[];
  byArtifact: ByArtifact[];
  byDay: ByDay[];
  byHour: number[];
  byDow: number[];
  bySdlcPhase: never[]; // F2 — [] en F1
 };
 behavior: ReportBehavior;
 adoption: ReportAdoption;
 sessions: SessionSummary[];
}

export interface IndexOptions {
 sessionsDir: string;
 period?: Period;
 /** IANA. Default: zona del host. */
 timezone?: string;
 /** Epoch ms; default Date.now(). Para tests deterministas. */
 now?: number;
}

export interface IndexResult {
 snapshot: UsageSnapshot;
 periodFrom: number;
 periodTo: number;
}

// --- Caché por (file, mtime) — modelo de session-stats.ts ---

interface Parsed {
 mtime: number;
 firstTs: number;
 lastTs: number;
 rows: Row[];
}
interface Row {
 ts: number | null;
 kind: "session" | "model" | "compaction" | "assistant" | "other";
 cwd?: string;
 model?: string;
 provider?: string;
 usage?: any;
 tools?: { name: string; args: any }[];
}
const parseCache = new Map<string, Parsed>();

function toMs(ts: unknown): number | null {
 if (typeof ts === "number" && Number.isFinite(ts)) return ts;
 if (typeof ts === "string" && ts) {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
 }
 return null;
}
function toCost(c: unknown): number {
 if (typeof c === "number" && Number.isFinite(c)) return c;
 if (c && typeof c === "object" && "total" in c) {
  const t = (c as { total: unknown }).total;
  return typeof t === "number" && Number.isFinite(t) ? t : 0;
 }
 return 0;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Bucket temporal local (zona horaria del host o la indicada). */
function localParts(ms: number, tz: string | undefined) {
 const d = new Date(ms);
 const zone = tz;
 const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
 }).format(d); // en-CA → YYYY-MM-DD
 let hour = Number(
  new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hour12: false }).format(d),
 );
 if (hour === 24) hour = 0; // algunos runtimes emiten "24"
 const dow = WEEKDAY.indexOf(
  new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(d),
 );
 return { date, hour: Number.isFinite(hour) ? hour : 0, dow: dow >= 0 ? dow : 0 };
}

/** Parsea el JSONL a rows planos (cacheado por mtime). La agregación va aparte. */
function parseRows(file: string): Parsed | null {
 try {
  const st = fs.statSync(file);
  if (!st.isFile()) return null;
  const hit = parseCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const raw = fs.readFileSync(file, "utf8");
  const rows: Row[] = [];
  let first = Infinity;
  let last = 0;
  for (const line of raw.split("\n")) {
   const t = line.trim();
   if (!t) continue;
   let e: any;
   try {
    e = JSON.parse(t);
   } catch {
    continue; // línea malformada: ignorar sin abortar
   }
   const ts = toMs(e?.timestamp);
   if (ts !== null) {
    if (ts < first) first = ts;
    if (ts > last) last = ts;
   }
   const row: Row = { ts, kind: "other" };
   if (e?.type === "session") {
    row.kind = "session";
    row.cwd = typeof e?.cwd === "string" ? e.cwd : undefined;
   } else if (e?.type === "model_change") {
    row.kind = "model";
    row.model = String(e?.modelId ?? "");
    row.provider = String(e?.provider ?? "");
   } else if (e?.type === "compaction") {
    row.kind = "compaction";
    row.usage = e?.usage;
   } else if (e?.type === "message" && e?.message?.role === "assistant") {
    row.kind = "assistant";
    row.usage = e?.message?.usage;
    const tools: Row["tools"] = [];
    const content = e?.message?.content;
    if (Array.isArray(content)) {
     for (const b of content) {
      if (b && b.type === "toolCall" && typeof b.name === "string") {
       tools.push({ name: b.name, args: b.arguments ?? {} });
      }
     }
    }
    row.tools = tools;
   }
   rows.push(row);
  }
  const parsed: Parsed = {
   mtime: st.mtimeMs,
   firstTs: first === Infinity ? 0 : first,
   lastTs: last,
   rows,
  };
  parseCache.set(file, parsed);
  return parsed;
 } catch {
  return null;
 }
}

interface SessionAgg {
 summary: SessionSummary;
 byModel: Map<string, ByModel>;
 byProvider: Map<string, ByProvider>;
 byTool: Map<string, number>;
 byLanguage: Map<string, ByLanguage>;
 byArtifact: Map<string, number>;
 byDay: Map<string, ByDay>;
 byHour: number[];
 byDow: number[];
 compactations: number;
 subagentsLaunched: number;
 questionsAsked: number;
 browserUsed: boolean;
 subagentsUsed: boolean;
 contextToolUsed: boolean;
}

function aggregate(parsed: Parsed, file: string, tz: string | undefined): SessionAgg {
 const agg: SessionAgg = {
  summary: { path: file, cwd: "", firstTs: parsed.firstTs, lastTs: parsed.lastTs,
   tokensIn: 0, tokensOut: 0, cost: 0, turns: 0, assistedKloc: 0 },
  byModel: new Map(), byProvider: new Map(), byTool: new Map(),
  byLanguage: new Map(), byArtifact: new Map(), byDay: new Map(),
  byHour: new Array(24).fill(0), byDow: new Array(7).fill(0),
  compactations: 0, subagentsLaunched: 0, questionsAsked: 0,
  browserUsed: false, subagentsUsed: false, contextToolUsed: false,
 };
 let model = "";
 let provider = "";
 const addUsage = (u: any, isTurn: boolean) => {
  if (!u) return;
  const input = Number(u.input ?? 0) || 0;
  const output = Number(u.output ?? 0) || 0;
  const cacheRead = Number(u.cacheRead ?? 0) || 0;
  const cacheWrite = Number(u.cacheWrite ?? 0) || 0;
  const cost = toCost(u.cost);
  const tk = input + output + cacheRead + cacheWrite;
  agg.summary.tokensIn += input;
  agg.summary.tokensOut += output;
  agg.summary.cost += cost;
  if (isTurn) agg.summary.turns += 1;
  if (model || provider) {
   const mk = model || "(unknown)";
   const m = agg.byModel.get(mk) ?? { model: mk, provider, tokens: 0, cost: 0, turns: 0 };
   m.tokens += tk; m.cost += cost;
   if (isTurn) m.turns += 1;
   if (provider) m.provider = provider;
   agg.byModel.set(mk, m);
  }
  if (provider) {
   const p = agg.byProvider.get(provider) ?? { provider, tokens: 0, cost: 0 };
   p.tokens += tk; p.cost += cost;
   agg.byProvider.set(provider, p);
  }
 };
 for (const r of parsed.rows) {
  if (r.kind === "session" && r.cwd) agg.summary.cwd = r.cwd;
  else if (r.kind === "model") {
   if (r.model) model = r.model;
   if (r.provider) provider = r.provider;
  } else if (r.kind === "compaction") {
   agg.compactations += 1;
   addUsage(r.usage, false);
  } else if (r.kind === "assistant") {
   addUsage(r.usage, true);
   if (r.ts !== null) {
    const { date, hour, dow } = localParts(r.ts, tz);
    agg.byHour[hour] += 1;
    agg.byDow[dow] += 1;
    const u = r.usage ?? {};
    const tk = (Number(u.input ?? 0) || 0) + (Number(u.output ?? 0) || 0) +
     (Number(u.cacheRead ?? 0) || 0) + (Number(u.cacheWrite ?? 0) || 0);
    const cost = toCost(u.cost);
    const day = agg.byDay.get(date) ?? { date, tokens: 0, cost: 0, turns: 0 };
    day.tokens += tk; day.cost += cost; day.turns += 1;
    agg.byDay.set(date, day);
   }
   for (const tool of r.tools ?? []) {
    const name = tool.name;
    agg.byTool.set(name, (agg.byTool.get(name) ?? 0) + 1);
    const a = tool.args ?? {};
    if (name === "write" || name === "edit") {
     const fp = String(a.path ?? a.file_path ?? a.filePath ?? "");
     let lines = 0;
     if (name === "write") lines = countLines(a.content);
     else if (Array.isArray(a.edits)) for (const ed of a.edits) lines += countLines(ed?.newText);
     if (fp) {
      const lang = classifyLanguage(fp);
      const kind = classifyArtifactKind(fp);
      const L = agg.byLanguage.get(lang) ?? { language: lang, files: 0, edits: 0, assistedKloc: 0 };
      if (name === "write") L.files += 1; else L.edits += 1;
      L.assistedKloc += lines / 1000;
      agg.byLanguage.set(lang, L);
      agg.byArtifact.set(kind, (agg.byArtifact.get(kind) ?? 0) + 1);
     }
     agg.summary.assistedKloc += lines / 1000;
    }
    if (name === "ask_user_question") agg.questionsAsked += 1;
    if (name === "Agent") { agg.subagentsLaunched += 1; agg.subagentsUsed = true; }
    if (name === "get_subagent_result") agg.subagentsUsed = true;
    if (name === "agent_browser" || name === "web_search" || name === "web_fetch") agg.browserUsed = true;
    if (name === "context" || name === "project_project") agg.contextToolUsed = true;
   }
  }
 }
 return agg;
}

/** Rango [from,to] (epoch ms) para un periodo relativo a `now`. */
function periodRange(period: Period, now: number): { from: number; to: number } {
 const to = now;
 const day = 86_400_000;
 if (period === "today") {
  const d = new Date(now);
  return { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), to };
 }
 if (period === "7d") return { from: now - 7 * day, to };
 if (period === "30d") return { from: now - 30 * day, to };
 return { from: 0, to };
}

/** Indexa todas las sesiones del dir en el periodo. */
export function indexUsage(opts: IndexOptions): IndexResult {
 const period: Period = opts.period ?? "all";
 const now = opts.now ?? Date.now();
 const tz = opts.timezone;
 const { from, to } = periodRange(period, now);

 const kpis = emptyKpis();
 const byModel = new Map<string, ByModel>();
 const byProvider = new Map<string, ByProvider>();
 const byTool = new Map<string, number>();
 const byLanguage = new Map<string, ByLanguage>();
 const byArtifact = new Map<string, number>();
 const byDay = new Map<string, ByDay>();
 const byHour = new Array(24).fill(0);
 const byDow = new Array(7).fill(0);
 const sessions: SessionSummary[] = [];
 let compactations = 0, subagentsLaunched = 0, questionsAsked = 0;
 let browserUsed = false, subagentsUsed = false, contextToolUsed = false;

 let files: string[] = [];
 try {
  files = fs.readdirSync(opts.sessionsDir)
   .filter((f) => f.endsWith(".jsonl"))
   .map((f) => opts.sessionsDir + "/" + f);
 } catch {
  files = [];
 }

 for (const file of files) {
  const parsed = parseRows(file);
  if (!parsed || !parsed.firstTs) continue;
  if (parsed.firstTs < from || parsed.firstTs > to) continue; // fuera de periodo
  const agg = aggregate(parsed, file, tz);
  kpis.tokensIn += agg.summary.tokensIn;
  kpis.tokensOut += agg.summary.tokensOut;
  kpis.cost += agg.summary.cost;
  kpis.turns += agg.summary.turns;
  kpis.sessions += 1;
  kpis.activeMs += agg.summary.firstTs && agg.summary.lastTs ? agg.summary.lastTs - agg.summary.firstTs : 0;
  sessions.push(agg.summary);
  compactations += agg.compactations;
  subagentsLaunched += agg.subagentsLaunched;
  questionsAsked += agg.questionsAsked;
  browserUsed = browserUsed || agg.browserUsed;
  subagentsUsed = subagentsUsed || agg.subagentsUsed;
  contextToolUsed = contextToolUsed || agg.contextToolUsed;
  for (const [k, v] of agg.byModel) {
   const cur = byModel.get(k);
   byModel.set(k, cur ? { ...cur, tokens: cur.tokens + v.tokens, cost: cur.cost + v.cost, turns: cur.turns + v.turns } : v);
  }
  for (const [k, v] of agg.byProvider) {
   const cur = byProvider.get(k);
   byProvider.set(k, cur ? { ...cur, tokens: cur.tokens + v.tokens, cost: cur.cost + v.cost } : v);
  }
  for (const [k, v] of agg.byTool) byTool.set(k, (byTool.get(k) ?? 0) + v);
  for (const [k, v] of agg.byLanguage) {
   const cur = byLanguage.get(k);
   byLanguage.set(k, cur ? { ...cur, files: cur.files + v.files, edits: cur.edits + v.edits, assistedKloc: cur.assistedKloc + v.assistedKloc } : v);
  }
  for (const [k, v] of agg.byArtifact) byArtifact.set(k, (byArtifact.get(k) ?? 0) + v);
  for (const [k, v] of agg.byDay) {
   const cur = byDay.get(k);
   byDay.set(k, cur ? { ...cur, tokens: cur.tokens + v.tokens, cost: cur.cost + v.cost, turns: cur.turns + v.turns } : v);
  }
  for (let i = 0; i < 24; i++) byHour[i] += agg.byHour[i];
  for (let i = 0; i < 7; i++) byDow[i] += agg.byDow[i];
 }

 kpis.avgTurnTokens = kpis.turns > 0 ? Math.round((kpis.tokensIn + kpis.tokensOut) / kpis.turns) : 0;
 // cacheHitPct agregado: F1 lo deja en 0 (no hay desglose cacheRead/Write por sesión
 // consolidado; byModel.tokens lo aproxima). Se refina en F2 si se requiere exactitud.

 const byToolArr: ByTool[] = [...byTool.entries()]
  .map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count);
 const byArtifactArr: ByArtifact[] = [...byArtifact.entries()]
  .map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
 const topSessions = [...sessions]
  .sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut)).slice(0, 20);

 return {
  snapshot: {
   kpis,
   breakdowns: {
    byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
    byProvider: [...byProvider.values()].sort((a, b) => b.tokens - a.tokens),
    byTool: byToolArr, byLanguage: [...byLanguage.values()].sort((a, b) => b.assistedKloc - a.assistedKloc),
    byArtifact: byArtifactArr, byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    byHour, byDow, bySdlcPhase: [],
   },
   behavior: { compactations, aborts: 0, approvals: { allow: 0, block: 0 },
    subagentsLaunched, skillsInvoked: 0, questionsAsked, bugFixSignals: 0, rework: 0 },
   adoption: { skillsUsed: [], browserUsed, mcpUsed: false, subagentsUsed, contextToolUsed, autoApprovalUsed: false },
   sessions: topSessions,
  },
  periodFrom: from, periodTo: to,
 };
}
```

### src/usage/artifact-classifier.ts — NEW

Extensión de path → lenguaje/tipo de artefacto (para `byLanguage`/`byArtifact`/`assistedKloc`).

```typescript
// Clasificador de artefactos: extensión de path → lenguaje/tipo. Usado por el
// indexer para byLanguage/byArtifact y assistedKloc (write/edit).

export type ArtifactKind = "markdown" | "code" | "config" | "doc" | "data" | "other";

/** Extensión (sin punto, lowercase) → lenguaje canónico. */
const EXT_TO_LANG: Record<string, string> = {
 ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
 js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
 py: "python", pyi: "python", go: "go", rs: "rust", java: "java", kt: "kotlin",
 kts: "kotlin", scala: "scala", clj: "clojure", cljs: "clojure", ex: "elixir",
 exs: "elixir", heex: "elixir", erl: "erlang", rb: "ruby", php: "php", c: "c",
 h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", cs: "csharp", vb: "vb",
 fs: "fsharp", swift: "swift", m: "objc", mm: "objc", lua: "lua", r: "r",
 dart: "dart", elm: "elm", hs: "haskell", ml: "ocaml", vim: "vim", html: "html",
 htm: "html", xml: "xml", svg: "xml", css: "css", scss: "css", sass: "css",
 less: "css", vue: "vue", svelte: "svelte", astro: "astro", json: "json",
 jsonc: "json", yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", cfg: "ini",
 conf: "ini", sql: "sql", graphql: "graphql", gql: "graphql", sh: "shell",
 bash: "shell", zsh: "shell", fish: "shell", ps1: "powershell", bat: "batch",
 cmd: "batch", proto: "protobuf",
};

function extOf(filePath: string): string {
 const base = (filePath.split(/[/\\]/).pop() ?? filePath).toLowerCase();
 if (base === "dockerfile") return "dockerfile";
 if (base === "makefile") return "makefile";
 const i = base.lastIndexOf(".");
 return i >= 0 ? base.slice(i + 1) : "";
}

/** Clasifica un path a un lenguaje canónico (o "other"). */
export function classifyLanguage(filePath: string): string {
 return EXT_TO_LANG[extOf(filePath)] ?? "other";
}

/** Clasifica un path a un tipo de artefacto para byArtifact. */
export function classifyArtifactKind(filePath: string): ArtifactKind {
 const ext = extOf(filePath);
 if (ext === "md" || ext === "mdx" || ext === "markdown") return "markdown";
 if (["json", "yaml", "yml", "toml", "ini", "cfg", "conf", "env"].includes(ext)) return "config";
 if (["sql", "csv", "tsv"].includes(ext)) return "data";
 if (ext in EXT_TO_LANG) return "code";
 const p = filePath.toLowerCase();
 if (p.includes("license") || p.includes("changelog") || p.includes("readme") || ext === "txt") return "doc";
 return "other";
}

/** Cuenta líneas (para assistedKloc). */
export function countLines(text: string | undefined | null): number {
 if (!text) return 0;
 const n = text.split("\n").length;
 return n > 0 ? n : 0;
}
```

### test/usage/indexer.test.ts — NEW

Test del indexer con un fixture determinista (tz UTC, timestamps fijos).

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { indexUsage } from "../../src/usage/indexer";

const FIXTURE = [
 '{"type":"session","version":3,"id":"s1","timestamp":"2026-08-01T10:00:00.000Z","cwd":"/proj/demo"}',
 '{"type":"model_change","id":"m1","timestamp":"2026-08-01T10:00:00.000Z","provider":"zai","modelId":"glm-5"}',
 '{"type":"message","id":"a1","timestamp":"2026-08-01T10:01:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hola"},{"type":"toolCall","id":"call_1","name":"write","arguments":{"path":"src/a.ts","content":"line1\\nline2\\nline3"}}],"usage":{"input":100,"output":50,"cacheRead":200,"cacheWrite":0,"cost":{"total":0}}}}',
 '{"type":"message","id":"r1","timestamp":"2026-08-01T10:01:05.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"write","content":[{"type":"text","text":"Successfully wrote 30 bytes to src/a.ts"}]}}',
 '{"type":"message","id":"a2","timestamp":"2026-08-01T10:02:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"usage":{"input":20,"output":10,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}',
].join("\n");

describe("indexer", () => {
 let dir: string;
 beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-usage-"));
  fs.writeFileSync(path.join(dir, "2026-08-01_s1.jsonl"), FIXTURE, "utf8");
 });
 afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

 const NOW = Date.parse("2026-08-03T00:00:00Z");

 it("cuenta sesiones/turnos y atribuye usage al modelo activo", () => {
  const { snapshot } = indexUsage({ sessionsDir: dir, period: "all", timezone: "UTC", now: NOW });
  expect(snapshot.kpis.sessions).toBe(1);
  expect(snapshot.kpis.turns).toBe(2); // a1, a2
  expect(snapshot.breakdowns.byModel[0].model).toBe("glm-5");
  expect(snapshot.breakdowns.byModel[0].provider).toBe("zai");
 });

 it("cuenta assistedKloc por lenguaje desde toolCall arguments", () => {
  const { snapshot } = indexUsage({ sessionsDir: dir, period: "all", timezone: "UTC", now: NOW });
  const ts = snapshot.breakdowns.byLanguage.find((l) => l.language === "typescript");
  expect(ts?.files).toBe(1);
  // 3 líneas = 0.003 kloc
  expect(ts?.assistedKloc).toBeCloseTo(0.003, 5);
 });

 it("bucketiza turnos por hora (UTC)", () => {
  const { snapshot } = indexUsage({ sessionsDir: dir, period: "all", timezone: "UTC", now: NOW });
  const total = snapshot.breakdowns.byHour.reduce((a, b) => a + b, 0);
  expect(total).toBe(2); // a1@10:01, a2@10:02 UTC
 });

 it("filtra por periodo (today excluye sesiones previas)", () => {
  const { snapshot } = indexUsage({ sessionsDir: dir, period: "today", timezone: "UTC", now: NOW });
  expect(snapshot.kpis.sessions).toBe(0);
 });
});
```

### test/usage/fixtures/sample-a.jsonl — NEW

Fixture de referencia (sesión mínima con session/model_change/assistant+usage+toolCall write/toolResult). El test incrusta su propio fixture equivalente para aislamiento; este archivo documenta la forma real y sirve para pruebas manuales de paridad.

```jsonl
{"type":"session","version":3,"id":"s1","timestamp":"2026-08-01T10:00:00.000Z","cwd":"/proj/demo"}
{"type":"model_change","id":"m1","timestamp":"2026-08-01T10:00:00.000Z","provider":"zai","modelId":"glm-5"}
{"type":"message","id":"a1","timestamp":"2026-08-01T10:01:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hola"},{"type":"toolCall","id":"call_1","name":"write","arguments":{"path":"src/a.ts","content":"line1\nline2\nline3"}}],"usage":{"input":100,"output":50,"cacheRead":200,"cacheWrite":0,"cost":{"total":0}}}}
{"type":"message","id":"r1","timestamp":"2026-08-01T10:01:05.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"write","content":[{"type":"text","text":"Successfully wrote 30 bytes to src/a.ts"}]}}
{"type":"message","id":"a2","timestamp":"2026-08-01T10:02:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"usage":{"input":20,"output":10,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}
```

### src/usage/identity.ts — NEW

Resuelve identidad (`email/org/project/repo/role`) desde settings + git; flag opt-in.

```typescript
// Resuelve la identidad del reporte de uso desde settings + git (fallback de email,
// remote del repo) + datos del host (fingerprint, timezone). `git` es inyectable para tests.

import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as vscode from "vscode";
import { getUserEmail, getOrg, getUserRole } from "../settings";
import type { ReportIdentity } from "./report-schema";

export interface IdentityResolveOptions {
 /** Ejecuta git (args + cwd) → stdout trim, o undefined si falla. Inyectado para tests. */
 git?: (args: string[], cwd: string) => string | undefined;
 workspaceName?: string;
}

function runGit(args: string[], cwd: string): string | undefined {
 try {
  const out = execSync(["git", ...args].join(" "), {
   cwd,
   encoding: "utf8",
   timeout: 4000,
   stdio: ["ignore", "pipe", "ignore"],
  });
  return out.trim() || undefined;
 } catch {
  return undefined;
 }
}

/** Hash estable de la máquina (sha256 de hostname + username). Para desduplicar
 *  usuarios en el concentrador sin exponer el hostname real. */
function hostFingerprint(): string {
 const raw = `${os.hostname()}|${os.userInfo().username}`;
 return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** Resuelve la identidad para el reporte. `email` queda "" si no hay setting ni fallback git. */
export function resolveIdentity(opts: IdentityResolveOptions = {}): ReportIdentity {
 const git = opts.git ?? runGit;
 const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
 const projectName =
  opts.workspaceName ??
  vscode.workspace.name ??
  (cwd ? (cwd.split(/[/\\]/).pop() ?? "") : "");
 let email = getUserEmail();
 if (!email && cwd) email = git(["config", "user.email"], cwd) ?? "";
 const repoRemote = cwd ? git(["remote", "get-url", "origin"], cwd) ?? "" : "";
 const repo = repoRemote
  ? (repoRemote.replace(/\.git$/, "").split(/[/\\]/).pop() ?? "")
  : projectName;
 return {
  org: getOrg(),
  email,
  project: projectName,
  repo,
  repoRemote,
  hostFingerprint: hostFingerprint(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  role: getUserRole(),
 };
}
```

### src/settings.ts — MODIFY

Añadir getters/setters para `frida.user.email`, `frida.org`, `frida.user.role`, `frida.telemetry.optIn`.

```typescript
// === AÑADIDO al inicio (junto al import existente de vscode): ===
import type { UserRole } from "./usage/report-schema";

// === AÑADIDO al final del archivo (mismo patrón que isAskUserQuestionEnabled / writeToolToggle): ===

/** Email del usuario para el reporte de uso (en claro; solo se incluye con opt-in).
 *  Default ""; si está vacío, identity.ts hace fallback a `git config user.email`. */
export function getUserEmail(): string {
 return vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>("user.email", "");
}

/** Organización/empresa para el reporte de uso. Default "". */
export function getOrg(): string {
 return vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>("org", "");
}

/** Rol declarado del usuario. Default "other". */
export function getUserRole(): UserRole {
 const r = vscode.workspace
  .getConfiguration(CONFIG_SECTION)
  .get<string>("user.role", "other");
 return (["dev", "qa", "architect", "lead", "devops", "other"].includes(r)
  ? r
  : "other") as UserRole;
}

/** ¿El usuario optó a incluir su identidad al exportar el reporte de uso? */
export function isTelemetryOptIn(): boolean {
 return vscode.workspace
  .getConfiguration(CONFIG_SECTION)
  .get<boolean>("telemetry.optIn", false);
}

/** Persiste el opt-in de telemetría (global). */
export async function setTelemetryOptIn(on: boolean): Promise<void> {
 await vscode.workspace
  .getConfiguration(CONFIG_SECTION)
  .update("telemetry.optIn", on, vscode.ConfigurationTarget.Global);
}
```

### src/usage/report-builder.ts — NEW

Ensambla `UsageReport` (`v1`) desde `UsageSnapshot` + identidad + nivel de detalle.

```typescript
// Ensambla frida-usage-report/v1 desde el snapshot del indexer + la identidad +
// el nivel de detalle (privacy creciente). effectiveness/quality quedan en defaults (F3/F4).

import {
 USAGE_REPORT_SCHEMA,
 emptyEffectiveness,
 emptyQuality,
 type UsageReport,
 type ReportIdentity,
 type DetailLevel,
 type PeriodGranularity,
} from "./report-schema";
import type { UsageSnapshot, Period } from "./indexer";

export interface BuildReportOptions {
 snapshot: UsageSnapshot;
 identity: ReportIdentity;
 detailLevel: DetailLevel;
 /** Periodo consultado (para period.granularity + from/to). */
 period: Period;
 periodFrom: number;
 periodTo: number;
 clientVersion: string;
 now?: number;
}

function periodGranularity(period: Period): PeriodGranularity {
 // F1 bucketiza por día en todos los modos; el concentrador puede re-agrupar.
 return "day";
}

/** Ensambla frida-usage-report/v1 desde el snapshot + identidad + nivel de detalle. */
export function buildReport(opts: BuildReportOptions): UsageReport {
 const { snapshot, identity, detailLevel, period } = opts;
 const now = opts.now ?? Date.now();
 const minimal = detailLevel === "aggregated";
 const consent = { telemetryOptIn: !!identity.email, detailLevel };
 return {
  schema: USAGE_REPORT_SCHEMA,
  generatedAt: new Date(now).toISOString(),
  clientVersion: opts.clientVersion,
  period: {
   from: new Date(opts.periodFrom).toISOString(),
   to: new Date(opts.periodTo).toISOString(),
   granularity: periodGranularity(period),
  },
  identity,
  consent,
  kpis: snapshot.kpis,
  breakdowns: minimal
   ? {
    ...snapshot.breakdowns,
    byModel: [],
    byProvider: [],
    byTool: [],
    byLanguage: [],
    byArtifact: [],
    byDay: [],
   }
   : snapshot.breakdowns,
  behavior: snapshot.behavior,
  adoption: minimal ? { ...snapshot.adoption, skillsUsed: [] } : snapshot.adoption,
  effectiveness: emptyEffectiveness(), // F4
  quality: emptyQuality(), // F3
 };
}
```

### test/usage/report-builder.test.ts — NEW

Test del builder: v1 válido (pasa `assertUsageReport`) + nivel `aggregated` vacía breakdowns.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildReport } from "../../src/usage/report-builder";
import { indexUsage } from "../../src/usage/indexer";
import {
 USAGE_REPORT_SCHEMA,
 assertUsageReport,
 type ReportIdentity,
} from "../../src/usage/report-schema";

const FIXTURE = [
 '{"type":"session","version":3,"id":"s1","timestamp":"2026-08-01T10:00:00.000Z","cwd":"/proj/demo"}',
 '{"type":"model_change","id":"m1","timestamp":"2026-08-01T10:00:00.000Z","provider":"zai","modelId":"glm-5"}',
 '{"type":"message","id":"a1","timestamp":"2026-08-01T10:01:00.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"write","arguments":{"path":"src/a.ts","content":"x\\ny\\nz"}}],"usage":{"input":100,"output":50,"cacheRead":200,"cacheWrite":0,"cost":{"total":0}}}}',
 '{"type":"message","id":"a2","timestamp":"2026-08-01T10:02:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"usage":{"input":20,"output":10,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}',
].join("\n");

const ID: ReportIdentity = {
 org: "softtek", email: "a@b.com", project: "p", repo: "r", repoRemote: "",
 hostFingerprint: "h", timezone: "UTC", role: "dev",
};

const NOW = Date.parse("2026-08-03T00:00:00Z");

describe("report-builder", () => {
 let dir: string;
 beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-rb-"));
  fs.writeFileSync(path.join(dir, "2026-08-01_s1.jsonl"), FIXTURE, "utf8");
 });
 afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

 it("ensambla un v1 válido que pasa assertUsageReport", () => {
  const { snapshot, periodFrom, periodTo } = indexUsage({ sessionsDir: dir, period: "all", timezone: "UTC", now: NOW });
  const report = buildReport({ snapshot, identity: ID, detailLevel: "structured", period: "all", periodFrom, periodTo, clientVersion: "0.6.0", now: NOW });
  expect(report.schema).toBe(USAGE_REPORT_SCHEMA);
  expect(() => assertUsageReport(report)).not.toThrow();
  expect(report.identity.email).toBe("a@b.com");
  expect(report.kpis.sessions).toBe(1);
 });

 it("nivel 'aggregated' vacía los breakdowns pero conserva KPIs", () => {
  const { snapshot, periodFrom, periodTo } = indexUsage({ sessionsDir: dir, period: "all", timezone: "UTC", now: NOW });
  const report = buildReport({ snapshot, identity: ID, detailLevel: "aggregated", period: "all", periodFrom, periodTo, clientVersion: "0.6.0" });
  expect(report.kpis.sessions).toBe(1);
  expect(report.breakdowns.byModel).toEqual([]);
  expect(report.breakdowns.byLanguage).toEqual([]);
 });
});
```

### src/extension.ts — MODIFY

Comando `frida.exportUsage` (Slice 5) + handler `case "list_usage"` (Slice 6). Ambos en el mismo archivo, ubicaciones distintas.

```typescript
// === IMPORTS añadidos (Slice 5): ===
import { indexUsage } from "./usage/indexer";
import { buildReport } from "./usage/report-builder";
import { resolveIdentity } from "./usage/identity";
import { isTelemetryOptIn, setTelemetryOptIn } from "./settings";

// === AÑADIDO en activate (Slice 5): comando exportUsage ===
async function exportUsage(): Promise<void> {
 const periodPick = await vscode.window.showQuickPick(
  [
   { label: "Todo", value: "all" as const },
   { label: "Últimos 30 días", value: "30d" as const },
   { label: "Últimos 7 días", value: "7d" as const },
   { label: "Hoy", value: "today" as const },
  ],
  { placeHolder: "Periodo del reporte de uso" },
 );
 if (!periodPick) return;
 const period = periodPick.value;

 let optIn = isTelemetryOptIn();
 if (!optIn) {
  const consent = await vscode.window.showQuickPick(
   [
    { label: "Sí, incluir mi email/org", value: true },
    { label: "No, exportar anónimo", value: false },
   ],
   { placeHolder: "¿Incluir tu email/organización en el reporte? (puedes cambiarlo después en Configuración)" },
  );
  if (consent === undefined) return;
  optIn = consent.value;
  if (optIn) await setTelemetryOptIn(true);
 }

 const { snapshot, periodFrom, periodTo } = indexUsage({ sessionsDir: sessionDirPath, period });
 const full = resolveIdentity();
 const identity = optIn ? full : { ...full, email: "" };
 const report = buildReport({ snapshot, identity, detailLevel: "structured", period, periodFrom, periodTo, clientVersion: fridaVersion });

 const json = JSON.stringify(report, null, 2);
 await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: json, language: "json" }));
 const uri = await vscode.window.showSaveDialog({
  defaultUri: vscode.Uri.file(`frida-usage-${new Date().toISOString().slice(0, 10)}.json`),
  filters: { JSON: ["json"] },
 });
 if (uri) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
  vscode.window.showInformationMessage(`Reporte de uso guardado en ${uri.fsPath}`);
 }
}
context.subscriptions.push(vscode.commands.registerCommand("frida.exportUsage", exportUsage));

// === AÑADIDO en handleWebviewMessage switch (Slice 6): case list_usage ===
  case "list_usage": {
   const period: "today" | "7d" | "30d" | "all" =
    msg.period === "today" || msg.period === "7d" || msg.period === "30d" || msg.period === "all"
     ? msg.period
     : "all";
   const { snapshot, periodFrom, periodTo } = indexUsage({ sessionsDir: sessionDirPath, period });
   post({ type: "usage_report", report: snapshot, period, periodFrom, periodTo });
   break;
  }
```

### package.json — MODIFY

`contributes.configuration` (settings nuevos) + `contributes.commands` (`frida.exportUsage`). El bloque `commands` se añade en Slice 5; aquí se crea `configuration`.

```jsonc
// Dentro de "contributes": añadir "configuration" (no existe hoy).
"configuration": {
  "title": "Frida",
  "properties": {
    "frida.user.email": {
      "type": "string",
      "default": "",
      "description": "Email para el reporte de uso (en claro; solo se incluye si activas el opt-in al exportar). Si está vacío, se usa `git config user.email`."
    },
    "frida.org": {
      "type": "string",
      "default": "",
      "description": "Organización/empresa para el reporte de uso."
    },
    "frida.user.role": {
      "type": "string",
      "enum": ["dev", "qa", "architect", "lead", "devops", "other"],
      "default": "other",
      "description": "Rol declarado para el reporte de uso."
    },
    "frida.telemetry.optIn": {
      "type": "boolean",
      "default": false,
      "description": "Permite incluir tu identidad (email/org) al exportar el reporte de uso."
    }
  }
}
// En "contributes.commands" (array existente), añadir la entrada:
//   { "command": "frida.exportUsage", "title": "Frida: Exportar reporte de uso" }
```

### webview/types.ts — MODIFY

`OutMessage` `| {type:"list_usage"; period}` + `InMessage` `| {type:"usage_report"; report}` + tipo `UsageReportView` + `UsagePeriod` + `state.usageReport`.

```typescript
// === AÑADIDO (tipos view; el webview es build separado, no importa de src/usage) ===

export type UsagePeriod = "today" | "7d" | "30d" | "all";

export interface UsageKpisView {
 tokensIn: number;
 tokensOut: number;
 cacheRead: number;
 cacheWrite: number;
 cost: number;
 sessions: number;
 turns: number;
 activeMs: number;
 cacheHitPct: number;
 avgTurnTokens: number;
}
export interface UsageByModel { model: string; provider: string; tokens: number; cost: number; turns: number; }
export interface UsageByTool { tool: string; count: number; }
export interface UsageByLanguage { language: string; files: number; edits: number; assistedKloc: number; }
export interface UsageByArtifact { kind: string; count: number; }
export interface UsageByDay { date: string; tokens: number; cost: number; turns: number; }
export interface UsageSession {
 path: string; cwd: string; firstTs: number; lastTs: number;
 tokensIn: number; tokensOut: number; cost: number; turns: number; assistedKloc: number;
}
export interface UsageReportView {
 kpis: UsageKpisView;
 breakdowns: {
  byModel: UsageByModel[];
  byProvider: { provider: string; tokens: number; cost: number }[];
  byTool: UsageByTool[];
  byLanguage: UsageByLanguage[];
  byArtifact: UsageByArtifact[];
  byDay: UsageByDay[];
  byHour: number[];
  byDow: number[];
 };
 behavior: { compactations: number; subagentsLaunched: number; questionsAsked: number };
 adoption: { browserUsed: boolean; subagentsUsed: boolean; contextToolUsed: boolean };
 sessions: UsageSession[];
}

// En `export interface State { ... }` añadir:
//   usageReport?: { report: UsageReportView; period: UsagePeriod; periodFrom: number; periodTo: number };

// En `export type InMessage` (host → webview) añadir:
//   | { type: "usage_report"; report: UsageReportView; period: UsagePeriod; periodFrom: number; periodTo: number }

// En `export type OutMessage` (webview → host) añadir:
//   | { type: "list_usage"; period: UsagePeriod }
```

### webview/store.ts — MODIFY

`case "usage_report"` en el reducer + limpiarlo en `cleared`.

```typescript
// En `reduce()`, añadir el case (modela `case "resources"`):
  case "usage_report":
   return {
    ...state,
    usageReport: {
     report: msg.report,
     period: msg.period,
     periodFrom: msg.periodFrom,
     periodTo: msg.periodTo,
    },
   };

// En el `case "cleared":`, añadir junto a `resources: undefined`:
//   usageReport: undefined,
```

### webview/components/SettingsHub.tsx — MODIFY

Entrada `"usage"` en `TABS` + render del componente `UsageDashboard`.

```typescript
// imports añadidos (a los de lucide-react existentes):
import { BarChart3 } from "lucide-react";
import { UsageDashboard } from "./UsageDashboard";

// SettingsTab: añadir "usage"
export type SettingsTab =
 | "providers"
 | "models"
 | "approval"
 | "resources"
 | "tools"
 | "usage";

// TABS: añadir la entrada
const TABS: { id: SettingsTab; label: string; icon: typeof Plug }[] = [
 { id: "providers", label: "Proveedores", icon: Plug },
 // ... existentes ...
 { id: "usage", label: "Uso", icon: BarChart3 },
];

// En cfg-body, junto a los demás `tab === "..."`:
    {tab === "usage" && <UsageDashboard state={state} post={post} />}
```

### webview/components/UsageDashboard.tsx — NEW

Tab "Uso": selector de periodo, fetch on open, 6 KPIs + 6 gráficas (compone subcomponentes SVG).

```tsx
import { useEffect, useState } from "react";
import type { OutMessage, State, UsagePeriod } from "../types";
import { KPICard } from "./usage/KPICard";
import { BarChart } from "./usage/BarChart";
import { DonutChart } from "./usage/DonutChart";
import { Heatmap } from "./usage/Heatmap";

const PERIODS: { id: UsagePeriod; label: string }[] = [
 { id: "today", label: "Hoy" },
 { id: "7d", label: "7 días" },
 { id: "30d", label: "30 días" },
 { id: "all", label: "Todo" },
];

function fmt(n: number): string {
 if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
 if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
 return String(n);
}
function fmtMs(ms: number): string {
 const h = ms / 3_600_000;
 if (h >= 1) return h.toFixed(1) + "h";
 const m = ms / 60_000;
 return m >= 1 ? m.toFixed(0) + "m" : "<1m";
}

export function UsageDashboard({
 state,
 post,
}: {
 state: State;
 post: (m: OutMessage) => void;
}) {
 const [period, setPeriod] = useState<UsagePeriod>("30d");
 useEffect(() => {
  post({ type: "list_usage", period });
 }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

 const ur = state.usageReport;
 if (!ur || ur.period !== period) return <div className="cfg-stub">Cargando uso…</div>;
 const report = ur.report;
 if (!report || report.kpis.sessions === 0)
  return (
   <div className="cfg-stub">Sin datos de uso en este periodo todavía.</div>
  );
 const k = report.kpis;
 return (
  <div className="usage-dashboard">
   <div className="usage-period">
    {PERIODS.map((p) => (
     <button
      key={p.id}
      className={"usage-period-btn" + (period === p.id ? " active" : "")}
      onClick={() => setPeriod(p.id)}
     >
      {p.label}
     </button>
    ))}
   </div>
   <div className="usage-kpis">
    <KPICard label="Tokens ↑↓" value={fmt(k.tokensIn + k.tokensOut)} />
    <KPICard label="Costo" value={"$" + k.cost.toFixed(2)} />
    <KPICard label="Sesiones" value={String(k.sessions)} />
    <KPICard label="Turnos" value={String(k.turns)} />
    <KPICard label="Cache hit" value={(k.cacheHitPct ?? 0).toFixed(0) + "%"} />
    <KPICard label="Tiempo activo" value={fmtMs(k.activeMs)} />
   </div>
   <div className="usage-grid">
    <div className="usage-card">
     <div className="usage-card-title">Tokens por día</div>
     <BarChart
      data={report.breakdowns.byDay.map((d) => ({ label: d.date.slice(5), value: d.tokens }))}
     />
    </div>
    <div className="usage-card">
     <div className="usage-card-title">Uso por modelo</div>
     <DonutChart
      data={report.breakdowns.byModel.map((m) => ({ label: m.model, value: m.tokens }))}
     />
    </div>
    <div className="usage-card">
     <div className="usage-card-title">Top herramientas</div>
     <BarChart
      horizontal
      data={report.breakdowns.byTool.slice(0, 8).map((t) => ({ label: t.tool, value: t.count }))}
     />
    </div>
    <div className="usage-card">
     <div className="usage-card-title">Artefactos por lenguaje (líneas)</div>
     <BarChart
      horizontal
      data={report.breakdowns.byLanguage
       .slice(0, 8)
       .map((l) => ({ label: l.language, value: Math.round(l.assistedKloc * 1000) }))}
     />
    </div>
    <div className="usage-card">
     <div className="usage-card-title">Actividad por hora / día</div>
     <Heatmap hours={report.breakdowns.byHour} dows={report.breakdowns.byDow} />
    </div>
    <div className="usage-card">
     <div className="usage-card-title">Top sesiones</div>
     <div className="usage-sessions">
      {report.sessions.slice(0, 8).map((s) => (
       <div key={s.path} className="usage-session-row">
        <span className="usage-session-name">
         {(s.path.split(/[/\\]/).pop() ?? s.path).replace(/\.jsonl$/, "")}
        </span>
        <span className="usage-session-meta">
         {fmt(s.tokensIn + s.tokensOut)} · {s.turns} turnos
        </span>
       </div>
      ))}
     </div>
    </div>
   </div>
  </div>
 );
}
```

### webview/components/usage/KPICard.tsx — NEW

Tarjeta KPI reutilizable (valor + etiqueta).

```tsx
export function KPICard({ label, value }: { label: string; value: string }) {
 return (
  <div className="kpi-card">
   <div className="kpi-value">{value}</div>
   <div className="kpi-label">{label}</div>
  </div>
 );
}
```

### webview/components/usage/BarChart.tsx — NEW

Barras horizontales (CSS) o verticales (SVG) para top tools, por lenguaje, tokens/costo por día.

```tsx
interface BarDatum {
 label: string;
 value: number;
}
export function BarChart({ data, horizontal }: { data: BarDatum[]; horizontal?: boolean }) {
 if (data.length === 0) return <div className="chart-empty">Sin datos</div>;
 const max = Math.max(...data.map((d) => d.value), 1);
 if (horizontal) {
  return (
   <div className="bar-h-list">
    {data.map((d) => (
     <div key={d.label} className="bar-h-row">
      <span className="bar-h-label" title={d.label}>
       {d.label}
      </span>
      <div className="bar-h-track">
       <div className="bar-h-fill" style={{ width: `${(d.value / max) * 100}%` }} />
      </div>
      <span className="bar-h-val">{d.value}</span>
     </div>
    ))}
   </div>
  );
 }
 const w = 100,
  h = 60,
  bw = w / data.length;
 return (
  <svg className="bar-v" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
   {data.map((d, i) => {
    const bh = (d.value / max) * h;
    return (
     <rect
      key={i}
      x={i * bw + 1}
      y={h - bh}
      width={Math.max(1, bw - 2)}
      height={bh}
      className="bar-v-fill"
     />
    );
   })}
  </svg>
 );
}
```

### webview/components/usage/DonutChart.tsx — NEW

Dona SVG con leyenda (uso por modelo/proveedor).

```tsx
interface DonutDatum {
 label: string;
 value: number;
}
const COLORS = ["#4f9cf9", "#22c55e", "#f59e0b", "#ec4899", "#a855f7", "#06b6d4", "#ef4444", "#6b7280"];
export function DonutChart({ data }: { data: DonutDatum[] }) {
 const total = data.reduce((a, b) => a + b.value, 0);
 if (total === 0) return <div className="chart-empty">Sin datos</div>;
 let acc = 0;
 const r = 18,
  cx = 25,
  cy = 25,
  C = 2 * Math.PI * r;
 return (
  <div className="donut-wrap">
   <svg className="donut" viewBox="0 0 50 50">
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--cfg-border,#333)" strokeWidth="8" />
    {data.slice(0, 8).map((d, i) => {
     const frac = d.value / total;
     const dash = `${frac * C} ${C}`;
     const off = -acc * C;
     acc += frac;
     return (
      <circle
       key={i}
       cx={cx}
       cy={cy}
       r={r}
       fill="none"
       stroke={COLORS[i % COLORS.length]}
       strokeWidth="8"
       strokeDasharray={dash}
       strokeDashoffset={off}
       transform={`rotate(-90 ${cx} ${cy})`}
      />
     );
    })}
   </svg>
   <div className="donut-legend">
    {data.slice(0, 8).map((d, i) => (
     <div key={i} className="donut-leg-row">
      <span className="donut-dot" style={{ background: COLORS[i % COLORS.length] }} />
      {d.label} <span className="muted">{Math.round((d.value / total) * 100)}%</span>
     </div>
    ))}
   </div>
  </div>
 );
}
```

### webview/components/usage/Heatmap.tsx — NEW

Strips de intensidad por hora (24) y por día de la semana (7). En F1 el indexer produce totales marginales (no la matriz cruzada 7×24); la matriz cruzada y `bySdlcPhase` son F2.

```tsx
const DOW = ["D", "L", "M", "X", "J", "V", "S"];
export function Heatmap({ hours, dows }: { hours: number[]; dows: number[] }) {
 const maxH = Math.max(...hours, 1);
 const maxD = Math.max(...dows, 1);
 return (
  <div className="heatmap">
   <div className="heatmap-strip">
    <span className="heatmap-label">Hora</span>
    <div className="heatmap-cells">
     {hours.map((v, i) => (
      <div
       key={i}
       className="heatmap-cell"
       title={`${i}:00 — ${v}`}
       style={{ opacity: 0.12 + (v / maxH) * 0.88 }}
      />
     ))}
    </div>
   </div>
   <div className="heatmap-strip">
    <span className="heatmap-label">Día</span>
    <div className="heatmap-cells dow">
     {dows.map((v, i) => (
      <div
       key={i}
       className="heatmap-cell dow"
       title={`${DOW[i]} — ${v}`}
       style={{ opacity: 0.12 + (v / maxD) * 0.88 }}
      >
       {DOW[i]}
      </div>
     ))}
    </div>
   </div>
  </div>
 );
}
```

### webview/styles.css — MODIFY

Clases para el tab Uso: KPI cards, gráficas SVG/CSS, selector de periodo, top sesiones.

```css
/* === Tab Uso === */
.usage-dashboard { display: flex; flex-direction: column; gap: 12px; }
.usage-period { display: flex; gap: 4px; }
.usage-period-btn {
 padding: 4px 10px; border: 1px solid var(--cfg-border, #333); border-radius: 6px;
 background: transparent; color: var(--cfg-fg, #ddd); cursor: pointer; font-size: 12px;
}
.usage-period-btn.active { background: var(--cfg-accent, #4f9cf9); color: #fff; border-color: transparent; }
.usage-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.kpi-card { padding: 10px; border: 1px solid var(--cfg-border, #333); border-radius: 8px; text-align: center; }
.kpi-value { font-size: 18px; font-weight: 600; }
.kpi-label { font-size: 11px; opacity: 0.7; margin-top: 2px; }
.usage-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.usage-card { border: 1px solid var(--cfg-border, #333); border-radius: 8px; padding: 10px; }
.usage-card-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; opacity: 0.85; }
.chart-empty { font-size: 12px; opacity: 0.5; padding: 12px 0; text-align: center; }
/* BarChart vertical (SVG) */
.bar-v { width: 100%; height: 60px; display: block; }
.bar-v-fill { fill: var(--cfg-accent, #4f9cf9); }
/* BarChart horizontal (CSS) */
.bar-h-list { display: flex; flex-direction: column; gap: 4px; }
.bar-h-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.bar-h-label { width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.8; }
.bar-h-track { flex: 1; height: 8px; background: var(--cfg-border, #333); border-radius: 4px; overflow: hidden; }
.bar-h-fill { height: 100%; background: var(--cfg-accent, #4f9cf9); }
.bar-h-val { width: 44px; text-align: right; opacity: 0.7; font-variant-numeric: tabular-nums; }
/* Donut */
.donut-wrap { display: flex; gap: 10px; align-items: center; }
.donut { width: 60px; height: 60px; flex-shrink: 0; }
.donut-legend { font-size: 11px; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.donut-leg-row { display: flex; align-items: center; gap: 4px; }
.donut-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.muted { opacity: 0.6; }
/* Heatmap strips */
.heatmap { display: flex; flex-direction: column; gap: 8px; }
.heatmap-strip { display: flex; align-items: center; gap: 6px; }
.heatmap-label { width: 32px; font-size: 11px; opacity: 0.7; }
.heatmap-cells { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; flex: 1; }
.heatmap-cells.dow { grid-template-columns: repeat(7, 1fr); }
.heatmap-cell { height: 16px; background: var(--cfg-accent, #4f9cf9); border-radius: 2px; }
.heatmap-cell.dow { display: flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; }
/* Top sesiones */
.usage-sessions { display: flex; flex-direction: column; gap: 4px; }
.usage-session-row { display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; border-bottom: 1px solid var(--cfg-border, #2a2a2a); }
.usage-session-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.85; }
.usage-session-meta { opacity: 0.6; font-variant-numeric: tabular-nums; flex-shrink: 0; }
```

## Slices

### Slice 1: Contrato v1 + tipos (foundation)

**Files**: `src/usage/report-schema.ts`, `test/usage/report-schema.test.ts`

#### Automated Verification

- [ ] Los tests del contrato pasan: `npx vitest run test/usage/report-schema.test.ts`
- [ ] Typechecking sin errores (incluye `src/usage/report-schema.ts`): `npx tsc --noEmit`

#### Manual Verification

- [ ] Los campos de `UsageReport` cubren el contrato `v1` boceteado en el research (§Desired End State) y los campos F2–F4 quedan como opcionales con default

### Slice 2: Indexer + clasificador de artefactos

**Files**: `src/usage/indexer.ts`, `src/usage/artifact-classifier.ts`, `test/usage/indexer.test.ts`, `test/usage/fixtures/sample-a.jsonl`

#### Automated Verification

- [ ] Tests del indexer pasan (fixture determinista): `npx vitest run test/usage/indexer.test.ts`
- [ ] Typechecking sin errores: `npx tsc --noEmit`

#### Manual Verification

- [ ] Paridad: sobre una sesión real, los tokens/costo del snapshot coinciden con `readSessionStats` (`src/session-stats.ts`) para esa sesión

### Slice 3: Identidad + opt-in + settings

**Files**: `src/usage/identity.ts`, `src/settings.ts`, `package.json`

#### Automated Verification

- [ ] Typechecking sin errores (settings + identity): `npx tsc --noEmit`
- [ ] `package.json` sigue siendo JSON válido: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`

#### Manual Verification

- [ ] Las 4 llaves (`frida.user.email`, `frida.org`, `frida.user.role`, `frida.telemetry.optIn`) aparecen en la Settings UI de VS Code bajo "Frida"; `telemetry.optIn` por defecto en `false`

### Slice 4: Report builder

**Files**: `src/usage/report-builder.ts`, `test/usage/report-builder.test.ts`

#### Automated Verification

- [ ] Tests del builder pasan: `npx vitest run test/usage/report-builder.test.ts`
- [ ] Typechecking sin errores: `npx tsc --noEmit`

#### Manual Verification

- [ ] El reporte `v1` para una sesión real pasa `assertUsageReport` y los campos cuadran con el contrato boceteado (§Desired End State)

### Slice 5: Comando export + opt-in inline

**Files**: `src/extension.ts`, `package.json`

#### Automated Verification

- [ ] Typechecking sin errores: `npx tsc --noEmit`
- [ ] `package.json` válido y con el comando: `node -e "const p=require('./package.json'); console.log(p.contributes.commands.some(c=>c.command==='frida.exportUsage'))"` imprime `true`

#### Manual Verification

- [ ] `Frida: Exportar reporte de uso` pide periodo → opt-in (si no dado) → abre preview del JSON → permite guardarlo; el archivo resultante pasa `assertUsageReport` (email="" si se eligió anónimo)

### Slice 6: Capa webview (mensajes)

**Files**: `webview/types.ts`, `webview/store.ts`, `src/extension.ts`

#### Automated Verification

- [ ] Typechecking del host sin errores: `npx tsc --noEmit`
- [ ] Typechecking del webview sin errores: `npx tsc --noEmit -p tsconfig.webview.json`

#### Manual Verification

- [ ] El host responde a `list_usage` con `usage_report` y el store actualiza `state.usageReport` (verificable al abrir el tab "Uso" en Slice 7)

### Slice 7: Tab "Uso" + gráficas SVG/CSS

**Files**: `webview/components/SettingsHub.tsx`, `webview/components/UsageDashboard.tsx`, `webview/components/usage/KPICard.tsx`, `webview/components/usage/BarChart.tsx`, `webview/components/usage/DonutChart.tsx`, `webview/components/usage/Heatmap.tsx`, `webview/styles.css`

#### Automated Verification

- [ ] Typechecking del webview sin errores: `npx tsc --noEmit -p tsconfig.webview.json`
- [ ] Build del webview compila: `npm run build` (vite)
- [ ] Suite de tests del proyecto pasa: `npm test` (baseline de slice terminal)

#### Manual Verification

- [ ] Abrir el tab "Uso" muestra 6 KPIs + 6 gráficas con datos reales; el selector de periodo (Hoy/7d/30d/Todo) recalcula; sin errores en la consola del webview

## Desired End State

Un usuario abre el tab "Uso" y ve, sobre sus sesiones reales: 6 KPIs (tokens in/out, costo, sesiones, turnos, cache hit %, tiempo activo) + gráficas SVG (tokens/costo por día, uso por modelo, top herramientas, artefactos por lenguaje, heatmap de actividad, top sesiones), con selector Hoy/7d/30d/Todo. Al ejecutar `Frida: Exportar reporte de uso`, se le pide opt-in inline (si aún no lo dio), previsualiza el JSON `frida-usage-report/v1` y lo guarda donde quiera. Ese JSON alimenta al concentrador externo.

```jsonc
// frida-usage-report/v1 (campos F2-F4 previstos, 0/vacíos en F1)
{ "schema": "frida-usage-report/v1", "generatedAt": "...", "clientVersion": "0.6.0",
  "period": { "from": "...", "to": "...", "granularity": "day" },
  "identity": { "org": "...", "email": "...", "project": "...", "repo": "...", "repoRemote": "...", "hostFingerprint": "...", "timezone": "...", "role": "dev" },
  "consent": { "telemetryOptIn": true, "detailLevel": "structured" },
  "kpis": { "tokensIn": 0, "tokensOut": 0, "cacheRead": 0, "cacheWrite": 0, "cost": 0, "sessions": 0, "turns": 0, "activeMs": 0, "cacheHitPct": 0, "avgTurnTokens": 0 },
  "breakdowns": { "byModel": [], "byProvider": [], "byTool": [], "byLanguage": [], "byArtifact": [], "byDay": [], "byHour": [0..23], "byDow": [0..6], "bySdlcPhase": [] },
  "behavior": { "compactations": 0, "aborts": 0, "approvals": { "allow": 0, "block": 0 }, "subagentsLaunched": 0, "skillsInvoked": 0, "questionsAsked": 0, "bugFixSignals": 0, "rework": 0 },
  "adoption": { "skillsUsed": [], "browserUsed": false, "mcpUsed": false, "subagentsUsed": false, "contextToolUsed": false, "autoApprovalUsed": false },
  "effectiveness": { "volume": 0, "breadth": 0, "efficiency": 0, "autonomy": 0, "depth": 0, "advanced": 0, "overall": 0 },
  "quality": { "diagnosticsOnWrite": 0, "testsAdded": 0, "testsPassing": 0 } }
```

## File Map

```
src/usage/report-schema.ts        # NEW — tipos del contrato v1
src/usage/indexer.ts              # NEW — agregador multi-sesión (caché mtime)
src/usage/artifact-classifier.ts  # NEW — extensión → lenguaje/tipo
src/usage/identity.ts             # NEW — email/org/project/repo/role + opt-in
src/usage/report-builder.ts       # NEW — ensambla frida-usage-report/v1
src/settings.ts                   # MODIFY — settings frida.user.*/org/optIn
src/extension.ts                  # MODIFY — handler list_usage + comando exportUsage
package.json                      # MODIFY — contributes.configuration + commands
webview/types.ts                  # MODIFY — OutMessage list_usage + InMessage usage_report
webview/store.ts                  # MODIFY — case usage_report
webview/components/SettingsHub.tsx        # MODIFY — tab "usage"
webview/components/UsageDashboard.tsx     # NEW — tab Uso
webview/components/usage/KPICard.tsx      # NEW — tarjeta KPI
webview/components/usage/BarChart.tsx     # NEW — barras SVG
webview/components/usage/DonutChart.tsx   # NEW — dona SVG
webview/components/usage/Heatmap.tsx      # NEW — heatmap CSS grid
webview/styles.css                # MODIFY — estilos del tab Uso
test/usage/report-schema.test.ts  # NEW — test del contrato
test/usage/indexer.test.ts        # NEW — test del indexer con fixtures
test/usage/report-builder.test.ts # NEW — test del report builder
test/usage/fixtures/sample-a.jsonl # NEW — fixture de sesión
```

## Ordering Constraints

- S1 (contrato) es foundation; todo depende de sus tipos.
- S2 (indexer) depende de S1.
- S3 (identidad) depende solo de S1 → **puede correr en paralelo a S2**.
- S4 (report builder) depende de S2 + S3.
- S5 (export) depende de S4 + S3.
- S6 (capa webview) depende de S2.
- S7 (tab Uso) depende de S6.
- Paralelismo realizable: S3 ‖ S2 (tras S1); S5 ‖ S7-chain (tras sus deps).

## Verification Notes

- **V1**: `jq -r '.type' <session.jsonl> | sort | uniq -c` confirma tipos de entry.
- **V2**: `jq -c 'select(.message.role=="assistant") | .message.content[].type'` muestra `thinking|text|toolCall`.
- **V3**: indexer sobre fixtures reproduce los KPIs de `postUsage` (`extension.ts:706`) para la sesión actual.
- **V4**: `grep -iE "recharts|d3|chart\.js" package.json` → 0 (sin libs de gráficas).
- **V5**: `npm test` (vitest) pasa; `npm run build` (esbuild + vite) compila sin errores.

## Performance Considerations

- Indexer incremental por mtime (solo reindexa sesiones modificadas); snapshot cacheado en `globalStorage/usage-index.json`.
- Parseo defensivo: líneas malformadas se ignoran (como `session-stats.ts`).
- Snapshot enviado al webview una sola vez al abrir el tab (fetch on open); el selector de periodo recalcula desde el snapshot cacheado, no reindexa.
- Gráficas SVG/CSS = 0 KB de bundle.

## Migration Notes

No aplica (greenfield). Las 23 sesiones existentes son retroactivamente indexables al primer arranque del indexer.

## Pattern References

- `src/session-stats.ts:27,84` — indexer (caché mtime + bucle de parseo).
- `webview/components/SettingsHub.tsx:22,51` — registro de tab + fetch on open.
- `webview/components/ResourcesPanel.tsx` — panel con secciones (modelo visual).
- `src/extension.ts:1590` — handler de mensajes webview.
- `src/settings.ts:13` — patrón de settings getter.
- `src/gates/approval-logger.ts` — JSONL append-only (señales de comportamiento, F2).

## Developer Context

Decisiones de producto (de sesiones de ideación + research): alcance = cliente puro (Frida produce, no cruza); identidad = email en claro opt-in; MVP = dashboard completo + export; contrato `v1` estable con campos F2–F4 opcionales; clasificador SDLC por metadatos.

Decisiones de diseño confirmadas en este checkpoint (Step 4): D1 SVG/CSS a mano, D2 snapshot en `globalStorage/usage-index.json`, D3 opt-in inline al exportar.

Proceso: los sub-agentes (`slice-verifier` en Step 6.2, `research` agents) están bloqueados por el `pi-permission-system` ("no interactive UI"). La verificación de atomicidad/consistencia por slice la hace el agente principal internamente (mismo rigor: forward-refs, conflictos cross-slice, alineación código↔criterios), declarada en cada checkpoint.

## Design History

- Slice 1: Contrato v1 + tipos (foundation) — approved as generated
- Slice 2: Indexer + clasificador de artefactos — approved as generated
- Slice 3: Identidad + opt-in + settings — approved as generated
- Slice 4: Report builder — approved as generated
- Slice 5: Comando export + opt-in inline — approved as generated
- Slice 6: Capa webview (mensajes) — approved as generated
- Slice 7: Tab "Uso" + gráficas SVG/CSS — approved as generated

## References

- Research: `.rpiv/artifacts/research/2026-08-03_21-38-12_frida-usage-telemetry.md`
- Código fuente (HEAD `c90ad1a`): ver §Pattern References y §Current State Analysis.
