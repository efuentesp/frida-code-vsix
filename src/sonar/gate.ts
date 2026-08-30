// M3 (#144) — frida-sonar: quality gate local tipo SonarQube sobre pi-lens.
//
// Lib host PURA (Node-only, sin vscode — molde src/project-map/lens-project-report.ts:
// SIEMPRE resuelve, coerción defensiva, catch ruidoso en el caller). El veredicto
// por turno sale de los AGREGADOS `details` de lens_diagnostics mode=all (la tool
// la invoca el host con la sesión viva); el detalle per-issue sale del BUS crudo
// `pilens:diagnostics` consolidado aquí (segundo consumidor fan-out junto a
// mergeLens — decisión D2 del design).
//
// Contrato congelado contra ~/.frida/npm/node_modules/pi-lens@3.8.72 (runtime real
// por ADR-0010 — igual que M2), verificado en vivo (design 2026-08-29):
// - Shape REAL del bus (dist/index.js:56918 toPilensDiagnosticEntry):
//   {severity, message, tool, ruleId?, line?, col?, fixable?}. La interface
//   LensDiagnostic del bridge declara range/code/source/semantic que el bus NUNCA
//   envía (hallazgo "el contrato del externo miente") — aquí se consumen sólo los
//   campos reales vía BusDiagnostic.
// - Cap del productor: MAX_DIAGNOSTICS_PER_FILE_EVENT=12 por archivo/evento
//   (diagnostics-publish.js:68), `seq` contador monótono global (:73), semántica
//   full-replace por archivo (`diagnostics: []` = limpio explícito).
// - details de mode=all (lens-diagnostics.js:1138-1266): {mode, filesWithIssues,
//   totalBlocking, totalErrors, totalWarnings, staleDropped?, filesChecked?} — SIN
//   desglose por familia. mode=full añade coldRunners (siempre presente, incluso
//   vacío — :1040-1049), timedOut? (sólo wall-clock abort — :1085-1108) y
//   partial: true (:914 — booleano; el design citó "aborted" string, corregido
//   plan-local). failedAnalyzers/coldReasons NO existen en 3.8.72
//   (existen en 4.1.2) — parse lenient: se omiten si no llegan (FR-4).
// - Blocking ⇔ severity error (:480,:522).
//
// NFR secrets (FRD): SonarIssue NUNCA transporta `message` de diagnóstico — sólo
// refs {path, line?, rule?, tool}; severidades info/hint ("other") no participan
// del gate y se descartan del consolidado.
//
// Design: .rpiv/artifacts/designs/2026-08-29_12-33-30_m3-frida-sonar.md (D1-D9)

import path from "node:path";
import {
  classifySeverity,
  type LensDiagnosticsPayload,
  type LensSeverity,
} from "../lens-diagnostics-bridge";

/** Identificador de schema del snapshot. Regla (molde frida-usage-report/v1):
 *  lo aditivo sigue siendo v1; sólo un cambio breaking sube a v2. CONGELADA por test. */
export const SONAR_GATE_SCHEMA = "frida-sonar-gate/v1" as const;

// ── Familias (FR-3) ──────────────────────────────────────────────────────────

/** Familias bloqueantes (FAIL) y de warning (WARN). dup/ciclos/dead-code sólo
 *  aportan totales en el gate completo (jscpd/madge/knip nunca viajan per-issue
 *  por el bus — asimetría del full-scan, Key Discovery del design). */
export type SonarFamily =
  | "errores"
  | "secrets"
  | "cve"
  | "warnings"
  | "complejidad"
  | "dup"
  | "ciclos"
  | "dead-code";

/** Todas las familias, en orden de presentación. CONGELADA por test. */
export const SONAR_FAMILIES: readonly SonarFamily[] = [
  "errores",
  "secrets",
  "cve",
  "warnings",
  "complejidad",
  "dup",
  "ciclos",
  "dead-code",
];

/** Familias bloqueantes — jamás deshabilitables (D3: FAIL siempre sobre totales). */
export const BLOCKING_FAMILIES: readonly SonarFamily[] = [
  "errores",
  "secrets",
  "cve",
];

/** Umbrales del gate como PARÁMETROS de datos (molde policy.ts evaluate — la lib
 *  jamás lee settings; el host inyecta el getter fresco, D7). */
export interface SonarThresholds {
  /** Warnings toleradas antes de WARN (frida.sonar.maxWarnings, default 0). */
  maxWarnings: number;
  /** Familias excluidas del conteo WARN (best-effort), diff y desglose (D3). */
  disabledFamilies: SonarFamily[];
}

/** Valor neutro para tests/entornos sin settings (molde EMPTY_GATE_PATTERNS). */
export const EMPTY_SONAR_THRESHOLDS: SonarThresholds = {
  maxWarnings: 0,
  disabledFamilies: [],
};

/** Sanitiza la lista de familias deshabilitadas: sólo familias conocidas y NO
 *  bloqueantes (una exclusión de "errores"/"secrets"/"cve" se ignora — jamás se
 *  silencia el lado FAIL, D3). */
export function sanitizeDisabledFamilies(
  raw: readonly string[],
): SonarFamily[] {
  const blocking = new Set<string>(BLOCKING_FAMILIES);
  const known = new Set<string>(SONAR_FAMILIES);
  return [...new Set(raw)].filter(
    (f): f is SonarFamily => known.has(f) && !blocking.has(f),
  );
}

// ── Issues ───────────────────────────────────────────────────────────────────

export type SonarSeverity = "error" | "warning";

/** Issue consolidada — refs SIN message (NFR secrets). */
export interface SonarIssue {
  /** Identidad canónica (convención diagnosticDedupKey de pi-lens,
   *  lens-diagnostics.js:551): `${path}:${line ?? "?"}:${ruleId|tool}`. */
  key: string;
  /** Path relativo al cwd del workspace. */
  path: string;
  line?: number;
  /** ruleId del diagnóstico (si venía). */
  rule?: string;
  /** Tool/runner que lo emitió (biome, ruff, ast-grep, gitleaks, …). */
  tool: string;
  severity: SonarSeverity;
  family: SonarFamily;
}

/** Shape REAL del diagnóstico del bus (subconjunto verdadero de LensDiagnostic). */
interface BusDiagnostic {
  severity?: LensSeverity;
  message?: string;
  tool?: string;
  ruleId?: string;
  line?: number;
  col?: number;
  fixable?: boolean;
}

/** Normaliza un rule id para dedup — convención normalizeRuleForDedup de pi-lens
 *  (lens-diagnostics.js:545-550): strip prefijo "ast-grep:" y sufijo "-js" para
 *  que LSP sweep y runner napi no doble-reporten la misma violación. */
export function normalizeRuleForDedup(ruleId: string): string {
  return ruleId.replace(/^ast-grep:/, "").replace(/-js$/, "");
}

/** Clave canónica de identidad de issue (convención diagnosticDedupKey :551). */
export function issueKey(
  issuePath: string,
  line: number | undefined,
  rule: string | undefined,
  tool: string,
): string {
  return `${issuePath}:${line ?? "?"}:${normalizeRuleForDedup(rule ?? tool)}`;
}

/** runner/tool id → familia (para coldRunners y atribución de issues). */
export function runnerToFamily(runner: string): SonarFamily | undefined {
  const r = runner.toLowerCase();
  if (r.includes("gitleaks")) return "secrets";
  if (r.includes("trivy") || r.includes("govulncheck")) return "cve";
  if (r.includes("jscpd")) return "dup";
  if (r.includes("madge")) return "ciclos";
  if (r.includes("knip") || r.includes("dead-code") || r.includes("deadcode"))
    return "dead-code";
  return undefined;
}

/** Atribuye familia por severidad + tool/rule (FR-3). Determinística y pura. */
export function familyOf(
  severity: SonarSeverity,
  tool: string,
  rule?: string,
): SonarFamily {
  if (severity === "error") {
    const f = runnerToFamily(tool);
    return f === "secrets" || f === "cve" ? f : "errores";
  }
  const f = runnerToFamily(tool);
  if (f === "secrets" || f === "cve") return "warnings";
  if (f) return f;
  const r = (rule ?? "").toLowerCase();
  if (
    r.includes("complex") ||
    r.includes("cyclomatic") ||
    r.includes("cognitive")
  )
    return "complejidad";
  if (tool.toLowerCase().includes("fact-rules")) return "complejidad";
  return "warnings";
}

// ── Consolidación del bus (D2) ───────────────────────────────────────────────

/** Estado por archivo del consolidado (semántica del productor: full-replace por
 *  archivo; `seq` monótono — "mayor seq visto gana" ante out-of-order). */
export interface SonarFileEntry {
  seq: number;
  issues: SonarIssue[];
  truncated: boolean;
}

/** Consolidado en memoria del host: path relativo → estado del archivo. */
export type SonarConsolidated = Map<string, SonarFileEntry>;

function relPath(p: string, cwd: string): string {
  try {
    return path.isAbsolute(p) ? path.relative(cwd, p) || p : p;
  } catch {
    return p;
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Consolida UN evento del bus `pilens:diagnostics` en el estado por archivo.
 * Replica la semántica del productor: cada evento con path P reemplaza TODO lo
 * conocido de P (`diagnostics: []` = archivo limpio → se elimina); si para P ya
 * se vio un `seq` MAYOR, el evento out-of-order se ignora. Severidades
 * info/hint ("other") se descartan (no participan del gate). Muta el Map
 * recibido (molde mergeLens) — sin otros efectos.
 */
export function mergeSonarPayload(
  state: SonarConsolidated,
  payload: LensDiagnosticsPayload,
  fallbackCwd: string,
): void {
  const cwd = payload.cwd || fallbackCwd;
  const seq = num(payload.seq);
  for (const f of payload.files ?? []) {
    if (!f || !f.path) continue;
    const rel = relPath(f.path, cwd);
    const prev = state.get(rel);
    if (prev && prev.seq > seq) continue; // out-of-order: mayor seq gana
    const issues: SonarIssue[] = [];
    for (const d of f.diagnostics ?? []) {
      const b = d as BusDiagnostic;
      const cat = classifySeverity(b?.severity);
      if (cat === "other") continue;
      const severity: SonarSeverity = cat;
      const tool = typeof b?.tool === "string" && b.tool ? b.tool : "?";
      const rule =
        typeof b?.ruleId === "string" && b.ruleId ? b.ruleId : undefined;
      const line = typeof b?.line === "number" ? b.line : undefined;
      issues.push({
        key: issueKey(rel, line, rule, tool),
        path: rel,
        line,
        rule,
        tool,
        severity,
        family: familyOf(severity, tool, rule),
      });
    }
    if (issues.length === 0) state.delete(rel);
    else state.set(rel, { seq, issues, truncated: !!f.truncated });
  }
}

/** Aplana el consolidado a lista ordenada (path, luego key) — determinístico. */
export function flattenIssues(state: SonarConsolidated): SonarIssue[] {
  const out: SonarIssue[] = [];
  for (const p of [...state.keys()].sort())
    out.push(...(state.get(p)?.issues ?? []));
  return out.sort(
    (a, b) => a.path.localeCompare(b.path) || a.key.localeCompare(b.key),
  );
}

/** ¿Algún archivo del consolidado llegó truncado al cap del bus (12)? Para el
 *  aviso honesto de la UI. */
export function anyTruncated(state: SonarConsolidated): boolean {
  for (const e of state.values()) if (e.truncated) return true;
  return false;
}

/** Cuenta issues por familia. */
export function countByFamily(
  issues: readonly SonarIssue[],
): Partial<Record<SonarFamily, number>> {
  const out: Partial<Record<SonarFamily, number>> = {};
  for (const i of issues) out[i.family] = (out[i.family] ?? 0) + 1;
  return out;
}

// ── Veredicto (D3) ───────────────────────────────────────────────────────────

/** Agregados `details` de lens_diagnostics (mode=all/full). Parse lenient:
 *  campos ausentes → undefined (3.8.72 no garantiza todos los campos). */
export interface LensDetailsAggregates {
  mode?: string;
  filesChecked?: number;
  filesWithIssues?: number;
  totalBlocking?: number;
  totalErrors?: number;
  totalWarnings?: number;
  staleDropped?: number;
  /** Sólo mode=full (siempre presente ahí, incluso vacío). */
  coldRunners?: string[];
  /** Sólo si abortó el wall-clock (timeout 5 min). */
  timedOut?: boolean;
  /** true si el escaneo quedó parcial/abortado (booleano del runtime :914). */
  partial?: boolean;
}

/** Extrae los agregados conocidos de un `details` crudo (unknown) sin lanzar. */
export function parseLensDetails(details: unknown): LensDetailsAggregates {
  if (!details || typeof details !== "object") return {};
  const d = details as Record<string, unknown>;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((s) => typeof s === "string") : undefined;
  return {
    mode: typeof d.mode === "string" ? d.mode : undefined,
    filesChecked:
      typeof d.filesChecked === "number" ? d.filesChecked : undefined,
    filesWithIssues:
      typeof d.filesWithIssues === "number" ? d.filesWithIssues : undefined,
    totalBlocking:
      typeof d.totalBlocking === "number" ? d.totalBlocking : undefined,
    totalErrors: typeof d.totalErrors === "number" ? d.totalErrors : undefined,
    totalWarnings:
      typeof d.totalWarnings === "number" ? d.totalWarnings : undefined,
    staleDropped:
      typeof d.staleDropped === "number" ? d.staleDropped : undefined,
    coldRunners: strArr(d.coldRunners),
    timedOut: d.timedOut === true ? true : undefined,
    partial: d.partial === true ? true : undefined,
  };
}

/** Extrae una línea de progreso ASCII de un callback `onUpdate` de
 *  lens_diagnostics mode=full (contrato 3.8.72, scan-progress.js): la barra
 *  de bloques del productor vive en content[0].text y está prohibida en la UI
 *  (NFR UX), así que la línea se deriva de details.completed/total, NUNCA del
 *  texto. Payload real: {content:[{type:"text",...}], details:{phase:
 *  "scanning", completed, total}} — throttled 250ms + tick final. Lenient:
 *  cualquier otro shape → undefined (el host no posta). */
export function progressLineFromUpdate(update: unknown): string | undefined {
  if (!update || typeof update !== "object") return undefined;
  const details = (update as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const d = details as {
    phase?: unknown;
    completed?: unknown;
    total?: unknown;
  };
  if (d.phase !== "scanning") return undefined;
  const completed =
    typeof d.completed === "number" && Number.isFinite(d.completed)
      ? d.completed
      : 0;
  const total =
    typeof d.total === "number" && Number.isFinite(d.total) ? d.total : 0;
  const pct =
    total > 0
      ? ` (${Math.min(100, Math.round((completed / total) * 100))}%)`
      : "";
  return `Escaneando diagnósticos del proyecto… ${completed}/${total}${pct}`;
}

export type SonarVerdict = "pass" | "warn" | "fail" | "no-data";

/** Resultado del veredicto (todo lo que el tab/badge/snapshot necesitan). */
export interface SonarVerdictResult {
  verdict: SonarVerdict;
  /** Gate completo: timedOut/partial → true, con causas legibles. */
  degraded: boolean;
  causes: string[];
  blocking: number;
  errors: number;
  /** totalWarnings de details (crudo). */
  warnings: number;
  /** Tras exclusión best-effort de familias deshabilitadas (D3). */
  effectiveWarnings: number;
  /** Familias "no disponible" con causa (coldRunners, FR-4). */
  familiesUnavailable: Array<{ family: string; cause: string }>;
}

export interface ComputeVerdictInput {
  details: LensDetailsAggregates;
  /** Consolidado aplanado SIN filtrar (la exclusión se computa aquí). */
  issues: readonly SonarIssue[];
  thresholds: SonarThresholds;
}

/**
 * Veredicto PASS/WARN/FAIL sobre los AGREGADOS de details (D3):
 * - FAIL si totalBlocking>0 || totalErrors>0 (bloqueantes jamás deshabilitables).
 * - WARN si warnings efectivas > maxWarnings. Warnings efectivas =
 *   totalWarnings − min(Σ warnings de familias deshabilitadas según el
 *   consolidado per-issue, totalWarnings) — clamp ≥0, fail-strict: si el bus
 *   sub-cuenta, resta menos y el gate se queda en el lado estricto.
 * - no-data si ni la tool ni el bus conocen archivos (nunca PASS silencioso).
 * PURA (molde policy.ts evaluate): umbrales por parámetro.
 */
export function computeVerdict(input: ComputeVerdictInput): SonarVerdictResult {
  const { details, issues, thresholds } = input;
  const blocking = num(details.totalBlocking);
  const errors = num(details.totalErrors);
  const warnings = num(details.totalWarnings);
  const disabled = new Set(thresholds.disabledFamilies);
  const disabledWarnings = issues.filter(
    (i) => i.severity === "warning" && disabled.has(i.family),
  ).length;
  const effectiveWarnings = Math.max(
    0,
    warnings - Math.min(disabledWarnings, warnings),
  );
  const causes: string[] = [];
  if (details.timedOut)
    causes.push(
      "el escaneo excedió su presupuesto de tiempo (5 min) — resultados parciales",
    );
  if (details.partial === true)
    causes.push("escaneo cancelado antes de completar — resultados parciales");
  const familiesUnavailable = (details.coldRunners ?? []).map((r) => ({
    family: runnerToFamily(r) ?? r,
    cause: `no corrió en esta pasada (frío): ${r}`,
  }));
  const base = {
    degraded: causes.length > 0,
    causes,
    blocking,
    errors,
    warnings,
    effectiveWarnings,
    familiesUnavailable,
  };
  const noData =
    num(details.filesChecked) === 0 &&
    num(details.filesWithIssues) === 0 &&
    issues.length === 0;
  if (noData) return { verdict: "no-data", ...base };
  if (blocking > 0 || errors > 0) return { verdict: "fail", ...base };
  if (effectiveWarnings > thresholds.maxWarnings)
    return { verdict: "warn", ...base };
  return { verdict: "pass", ...base };
}

// ── Diff por turno (FR-2) ────────────────────────────────────────────────────

export interface SonarDiff {
  added: number;
  resolved: number;
  addedByFamily: Partial<Record<SonarFamily, number>>;
  resolvedByFamily: Partial<Record<SonarFamily, number>>;
}

/** Diff por identidad de issue (archivo+línea+regla). Puro. */
export function diffIssues(
  prev: readonly SonarIssue[],
  curr: readonly SonarIssue[],
): SonarDiff {
  const prevKeys = new Set(prev.map((i) => i.key));
  const currKeys = new Set(curr.map((i) => i.key));
  const added = curr.filter((i) => !prevKeys.has(i.key));
  const resolved = prev.filter((i) => !currKeys.has(i.key));
  return {
    added: added.length,
    resolved: resolved.length,
    addedByFamily: countByFamily(added),
    resolvedByFamily: countByFamily(resolved),
  };
}

// ── Snapshot por turno (FR-9) ────────────────────────────────────────────────

/** Entrada del historial (append por turno, FIFO en snapshot-store). */
export interface SonarEntry {
  ts: number;
  verdict: SonarVerdict;
  degraded: boolean;
  blocking: number;
  errors: number;
  /** Warnings EFECTIVAS sobre las que se evaluó el veredicto (D3). */
  warnings: number;
  diff: { added: number; resolved: number };
  countsPorFamilia: Partial<Record<SonarFamily, number>>;
}

export interface TurnSnapshotInput {
  ts: number;
  /** result.details crudo de lens_diagnostics (unknown — parse lenient). */
  details: unknown;
  /** Consolidado aplanado vigente (SIN filtrar). */
  issues: readonly SonarIssue[];
  /** Issues persistidas del snapshot anterior (SIN filtrar). */
  prevIssues: readonly SonarIssue[];
  thresholds: SonarThresholds;
}

export interface TurnSnapshot {
  entry: SonarEntry;
  /** Issues a persistir (familias deshabilitadas excluidas — D3). */
  issues: SonarIssue[];
  verdict: SonarVerdictResult;
  diff: SonarDiff;
}

/**
 * Orquestador PURO del snapshot por turno: veredicto (details + consolidado),
 * diff vs. las issues persistidas (familias deshabilitadas excluidas de ambos
 * lados) y entrada de historial. Invariante (lección 40c7d20): la suma de
 * countsPorFamilia == issues.length — veredicto, diff y tendencia salen del
 * MISMO snapshot.
 */
export function buildTurnSnapshot(input: TurnSnapshotInput): TurnSnapshot {
  const disabled = new Set(input.thresholds.disabledFamilies);
  const keep = (i: SonarIssue): boolean => !disabled.has(i.family);
  const curr = input.issues.filter(keep);
  const prev = input.prevIssues.filter(keep);
  const verdict = computeVerdict({
    details: parseLensDetails(input.details),
    issues: input.issues,
    thresholds: input.thresholds,
  });
  const diff = diffIssues(prev, curr);
  return {
    entry: {
      ts: input.ts,
      verdict: verdict.verdict,
      degraded: verdict.degraded,
      blocking: verdict.blocking,
      errors: verdict.errors,
      warnings: verdict.effectiveWarnings,
      diff: { added: diff.added, resolved: diff.resolved },
      countsPorFamilia: countByFamily(curr),
    },
    issues: curr,
    verdict,
    diff,
  };
}
