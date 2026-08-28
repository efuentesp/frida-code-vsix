// frida-size-app — generador del script de workflow (issue #139, M10 Pista M).
//
// Genera el script JS determinista que corre en el sandbox de
// frida-extensible-workflows (agent/shell/parallel/checkpoint/phase/log).
// Los prompts (resueltos 3 capas por el resolver) se interpolan del lado del
// host; el script queda declarativo. Contrato de artefactos: los agentes
// ESCRIBEN a disco con sus tools de archivo y devuelven JSON (outputSchema)
// — la cadena de custodia es el filesystem (mismo contrato que M1/M8/M9).
//
// Estructura del script generado (fases estrictamente secuenciales):
//   bootstrap  — determinista: mkdir -p de docs/dimensionamiento/**, fecha/
//                epoch vía shell (Date tapado en el sandbox), gate
//                CAPABILITIES.scc con degradación determinista (D2).
//   metrics    — determinista: sondas del scc pineado (by-file→archivo con
//                redirect + helper node host-side por el límite RPC de 10 MB,
//                -a, --hotspots/--coupling/--by-author si hay git) + lizard
//                solo si existe en PATH; normalización a metrics.json con
//                writer único — la ÚNICA fuente de verdad numérica (D3/D10).
//   analyze    — fanout de 3 escritores FIJOS de anexos interpretativos
//                bajo analisis/ (hotspots, deuda-modulos, riesgos-tamano);
//                toda cifra está en metrics.json o se re-deriva con fórmula
//                declarada (juez de números).
//   synthesize — determinista: dimensionamiento.md + README.md derivados
//                EXCLUSIVAMENTE de metrics.json (D3/D9): KLOC efectivos,
//                percentiles nearest-rank, SQALE proxy, COCOMO 3 corridas
//                EAF 0.85/1.00/1.15 (constantes scc exactas, D6), olas
//                strangler-fig, bus factor, exclusiones con volumen.
//   judge      — auditor detached PASS/CONCERNS/FAIL (familia declarada sin
//                sustento = FAIL; degradada o corte por presupuesto =
//                CONCERNS — la regla vive DOS veces, prompt + runtime, D11)
//                + checkpoint final solo si review=manual.
//
// metrics.json (docs/dimensionamiento/artifacts/metrics.json) es el registro
// auditable: run, capabilities, exclusiones con volumen, familias,
// degradaciones[], derived — grep-verificable ex-post. maxMinutes es el
// backstop wall-clock: corta el DESCUBRIMIENTO (analyze), jamás salta
// synthesize/judge sobre lo alcanzado (FR-11).

import { SCC_PIN } from "./constants";
import type { ResolvedSizeAppStage } from "./resolver";
import {
 DEFAULT_ARTIFACT_LANGUAGE,
 SIZE_APP_ARTIFACTS_DIR,
 SIZE_APP_PREAMBLE,
 type SizeAppStage,
} from "./skills";

// ── Args ─────────────────────────────────────────────────────────────

/** Modos Basic COCOMO 81 (Boehm); constantes exactas por modo viajan con la
 *  fase synthesize del script (D6: replica a·KSLOC^b·EAF de scc). */
export type CocomoType = "organic" | "semi-detached" | "embedded";

const COCOMO_TYPES: readonly CocomoType[] = [
 "organic",
 "semi-detached",
 "embedded",
];

export interface SizeAppArgs {
 /**
  * Salario MENSUAL por persona (> 0; decimales válidos — SIN
  * Number.isInteger). Requerido A PROPÓSITO (D7/D13): la corrida es
  * desatendida tras el launch, así que el presupuesto se pregunta ANTES
  * con ask_user_question en la sesión principal.
  */
 wage: number;
 /** Etiqueta de moneda del informe (default "USD") — PURA etiqueta, sin
  *  conversión (D7). */
 currency: string;
 /** Modo Basic COCOMO 81 (default "semi-detached"). */
 cocomoType: CocomoType;
 /** Directorios adicionales a excluir: AMPLÍAN la default curada que se
  *  aplica SIEMPRE (D8); [] = solo defaults. Nombres de directorio
  *  (--exclude-dir de scc), no rutas. */
 exclude: string[];
 /** Backstop wall-clock en minutos: 0 = sin tope (FR-11/D13). */
 maxMinutes: number;
 /** Idioma (BCP-47) de los entregables. */
 language: string;
 review: "manual" | "auto";
}

/**
 * Capacidades detectadas host-side en launch (D2): la resolución flag→factory
 * vive en el motor; el generador solo recibe el resultado como datos
 * declarativos (JSON-safe) y lo interpola al sandbox. scc es la sonda síncrona
 * propia del pack (marker al pin + binario presente); lens/codebaseIndex son
 * el moat declarado en meta (FR-1).
 */
export interface SizeAppCapabilities {
 /** scc instalado AL PIN en el agentDir (isSccInstalledAtPin). */
 scc: boolean;
 /** pi-lens disponible para las sesiones hijas (misma sonda que M1). */
 lens: boolean;
 /** frida-codebase-index instalado Y habilitado (isInstalledAtPin + toggle). */
 codebaseIndex: boolean;
}

function asRecord(args: unknown): Record<string, unknown> {
 return args && typeof args === "object" && !Array.isArray(args)
  ? (args as Record<string, unknown>)
  : {};
}

function parseReview(
 record: Record<string, unknown>,
 pattern: string,
): "manual" | "auto" {
 if (record.review === undefined) return "manual";
 if (record.review === "manual" || record.review === "auto")
  return record.review;
 throw new Error(
  `Patrón "${pattern}": args.review debe ser "manual" o "auto".`,
 );
}

function optionalString(
 record: Record<string, unknown>,
 key: string,
): string | undefined {
 const value = record[key];
 return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Array de strings no vacíos que ACEPTA [] (D8: exclude vacío = solo la
 * default curada). requireStringArray del motor es privada y rechaza []
 * (builtin-patterns.ts:57-68) — semántica inadecuada para exclude; helper
 * local del pack (D12).
 */
function requireStringArrayAllowEmpty(
 value: unknown,
 argName: string,
 patternName: string,
): string[] {
 if (
  !Array.isArray(value) ||
  !value.every((v) => typeof v === "string" && v.trim())
 ) {
  throw new Error(
   `Patrón "${patternName}" requiere args.${argName} como array (vacío permitido) de strings no vacíos.`,
  );
 }
 return value as string[];
}

/**
 * Validación eager (molde validateUnderstandAppArgs, workflow.ts:99-136):
 * falla ANTES de lanzar el run, con mensajes accionables. wage requerido con
 * error que instruye ask_user_question pre-launch (FR-2/D7/D13);
 * Number.isFinite SIN Number.isInteger para wage (decimales válidos — molde
 * adversarial-review.threshold, builtin-patterns.ts: número 0-1 sin chequeo
 * de enteridad); maxMinutes SÍ entero 1-240 (0/omiso = sin tope, molde M1).
 */
export function validateSizeAppArgs(args: unknown): SizeAppArgs {
 const record = asRecord(args);
 if (record.wage === undefined) {
  throw new Error(
   'Patrón "size-app": falta args.wage (número > 0 — salario MENSUAL por persona). Pregunta el salario al usuario con ask_user_question en la sesión principal ANTES de lanzar (opciones: "MXN $35,000" (wage 35000, currency "MXN"), "USD $6,000" (wage 6000, currency "USD"), o un monto propio) y relanza el workflow con el valor resuelto — tras el launch la corrida es desatendida y no puede preguntar.',
  );
 }
 if (
  typeof record.wage !== "number" ||
  !Number.isFinite(record.wage) ||
  record.wage <= 0
 ) {
  throw new Error(
   'Patrón "size-app": args.wage debe ser un número > 0 (salario mensual por persona; decimales válidos, p. ej. 35000.50).',
  );
 }
 if (
  record.cocomoType !== undefined &&
  (typeof record.cocomoType !== "string" ||
   !COCOMO_TYPES.includes(record.cocomoType as CocomoType))
 ) {
  throw new Error(
   `Patrón "size-app": args.cocomoType debe ser uno de ${COCOMO_TYPES.map(
    (t) => `"${t}"`,
   ).join(", ")} (default "semi-detached").`,
  );
 }
 if (
  record.maxMinutes !== undefined &&
  (typeof record.maxMinutes !== "number" ||
   !Number.isInteger(record.maxMinutes) ||
   record.maxMinutes < 1 ||
   record.maxMinutes > 240)
 ) {
  throw new Error(
   'Patrón "size-app": args.maxMinutes debe ser entero 1-240 (minutos) u omitirse (0 = sin tope).',
  );
 }
 return {
  wage: record.wage,
  currency: optionalString(record, "currency") ?? "USD",
  cocomoType:
   record.cocomoType === undefined
    ? "semi-detached"
    : (record.cocomoType as CocomoType),
  exclude:
   record.exclude === undefined
    ? []
    : requireStringArrayAllowEmpty(record.exclude, "exclude", "size-app"),
  maxMinutes: record.maxMinutes ?? 0,
  language: optionalString(record, "language") ?? DEFAULT_ARTIFACT_LANGUAGE,
  review: parseReview(record, "size-app"),
 };
}

// ── Constantes interpoladas (fase metrics, D8/D10) ────────────────────────

/** Default curada de exclusiones (D8): SIEMPRE aplicada, aditiva a los
 *  defaults git de scc ([.git,.hg,.svn]) y al .gitignore (que scc respeta
 *  por defecto). node_modules NO es caso especial para scc — por eso la
 *  curada es necesaria. El volumen excluido se mide con la 2ª pasada raw. */
const CURATED_EXCLUDE_DIRS: readonly string[] = [
 "dist",
 "build",
 "node_modules",
 "vendor",
 "target",
 "out",
 ".next",
 "coverage",
];

/** Lista final de --exclude-dir (D8): curada SIEMPRE + exclude[] del
 *  usuario AMPLIANDO (requireStringArrayAllowEmpty acepta []; vacío = solo
 *  curada). Entradas user se sanitizan a [A-Za-z0-9._+-]+ (van a un flag
 *  shell y a la regex -x de lizard) y se deduplican contra la curada. */
function excludeDirsFor(args: SizeAppArgs): string[] {
 const seen = new Set(CURATED_EXCLUDE_DIRS);
 const out = [...CURATED_EXCLUDE_DIRS];
 for (const dir of args.exclude) {
  if (!/^[A-Za-z0-9._+-]+$/.test(dir) || seen.has(dir)) continue;
  seen.add(dir);
  out.push(dir);
 }
 return out;
}

/**
 * Agregador de métricas (D10): corre EN EL HOST vía `node` desde shell() —
 * el sandbox no tiene Date/require y `scc --by-file --format json` de un
 * repo grande rebasa el límite RPC de 10 MB: los redirects van a disco y
 * ESTE helper lee la evidencia gorda, agrega (por lenguaje, por módulo,
 * percentiles nearest-rank, insumo SQALE) y devuelve SOLO un JSON delgado
 * por stdout (molde carve/spec de M9). Tolerante por familia: archivo
 * ausente / salida vacía / no-parseable → {status, causa, hint}, nunca
 * crash (FR-7). El smoke real de scc v4.0.0 (Verification Note V1, paso
 * del plan) congela el contrato observado para los mocks del e2e.
 */
const METRICS_AGG_SOURCE = String.raw`"use strict";
// metrics-agg.js — helper host-side del patrón size-app (frida-size-app #139).
// Lee la evidencia cruda en docs/dimensionamiento/artifacts/ y devuelve por
// stdout UN JSON delgado {exclusions, families}.
const fs = require("fs");
const a = process.argv.slice(2);
const P = {
 byFileCurated: a[0], byFileRaw: a[1], sccA: a[2],
 hotspots: a[3], coupling: a[4], byAuthor: a[5],
 lizard: a[6] || "", appliedDirs: a[7] || "",
};
const APPLIED_DIRS = P.appliedDirs.split(",").map(function (s) { return s.trim() }).filter(Boolean);
const MIN_JS = /\.min\.js$/i;
const SQALE_THRESHOLD = 15; // complejidad cognitiva alta (estándar SonarQube, D9)
const SQALE_HOURS_PER_POINT = 0.5;
const TOP_ROWS = 200, TOP_AUTHORS = 100, TOP_WORST = 10;
function readIfExists(p) { try { return fs.readFileSync(p, "utf8") } catch (e) { return null } }
function toNum(v) { const n = Number(v); return isFinite(n) ? n : 0 }
function round1(x) { return Math.round(x * 10) / 10 }
// Percentil nearest-rank (D9): sorted ASC → sorted[ceil(p·N)−1].
function pct(sorted, p) {
 if (!sorted.length) return null;
 const i = Math.ceil(p * sorted.length) - 1;
 return sorted[Math.max(0, Math.min(i, sorted.length - 1))]
}
function debtHours(cognitive) { return Math.max(0, toNum(cognitive) - SQALE_THRESHOLD) * SQALE_HOURS_PER_POINT }
function moduleOf(location) {
 const s = String(location || "").replace(/^\.?\//, "");
 const i = s.indexOf("/");
 return i > 0 ? s.slice(0, i) : "(raíz)"
}
// scc --by-file --format json: array de LanguageSummary con Files[] de
// FileJob {Location, Language, Lines, Code, Comment, Blank, Complexity,
// Cognitive} (contrato v4.0.0 documentado en el research). Tolerante a un
// objeto suelto en lugar de array.
function parseByFile(text) {
 let j = null;
 try { j = JSON.parse(text) } catch (e) { return null }
 if (!Array.isArray(j)) j = [j];
 const files = [];
 for (const ls of j) {
  const list = Array.isArray(ls && ls.Files) ? ls.Files : [];
  for (const f of list) {
   if (!f || typeof f !== "object" || !f.Location) continue;
   files.push({ location: String(f.Location), language: String(f.Language || (ls && (ls.Language || ls.Name)) || ""), lines: toNum(f.Lines), loc: toNum(f.Code), comment: toNum(f.Comment), blank: toNum(f.Blank), complexity: toNum(f.Complexity), cognitive: toNum(f.Cognitive) });
  }
 }
 return files
}
// Agregación: min.js se excluye aquí (D8) midiendo su volumen; debtHours
// usa cognitive POR ARCHIVO (la función max no distribuye sobre sumas —
// no es derivable de Σcognitive del módulo).
function aggregate(files0) {
 const minJs = files0.filter(function (f) { return MIN_JS.test(f.location) });
 const files = files0.filter(function (f) { return !MIN_JS.test(f.location) });
 const byLang = {}, byMod = {};
 let loc = 0, comment = 0, blank = 0, complexity = 0, cognitive = 0, debt = 0;
 const comps = [];
 for (const f of files) {
  loc += f.loc; comment += f.comment; blank += f.blank; complexity += f.complexity; cognitive += f.cognitive;
  debt += debtHours(f.cognitive);
  comps.push(f.complexity);
  const L = byLang[f.language] || (byLang[f.language] = { name: f.language, files: 0, loc: 0 });
  L.files++; L.loc += f.loc;
  const m = moduleOf(f.location);
  const M = byMod[m] || (byMod[m] = { name: m, files: 0, loc: 0, cognitive: 0, debtHours: 0 });
  M.files++; M.loc += f.loc; M.cognitive += f.cognitive; M.debtHours += debtHours(f.cognitive);
 }
 comps.sort(function (x, y) { return x - y });
 const languages = Object.keys(byLang).map(function (k) { return byLang[k] }).sort(function (x, y) { return y.loc - x.loc || (x.name < y.name ? -1 : 1) });
 const modules = Object.keys(byMod).map(function (k) { return byMod[k] }).map(function (M) { return { name: M.name, files: M.files, loc: M.loc, cognitive: M.cognitive, debtHours: round1(M.debtHours) } }).sort(function (x, y) { return y.loc - x.loc || (x.name < y.name ? -1 : 1) });
 return {
  files: files.length, loc: loc, comment: comment, blank: blank, complexity: complexity, cognitive: cognitive, debtHours: round1(debt),
  languages: languages, modules: modules,
  percentiles: { complexity: { p50: pct(comps, 0.5), p90: pct(comps, 0.9), p99: pct(comps, 0.99), samples: comps.length } },
  minifiedExcluded: { files: minJs.length, loc: minJs.reduce(function (s, f) { return s + f.loc }, 0) },
 }
}
function rawVolumes(files) {
 const by = {};
 for (const f of files) { const m = moduleOf(f.location); const M = by[m] || (by[m] = { files: 0, loc: 0 }); M.files++; M.loc += f.loc }
 return by
}
// scc -a: DRYness/ULOC — la salida json lleva el bloque adicional; regex
// tolerante a ambas formas (json quoted y texto plano).
function parseDuplication(text) {
 if (text === null) return { status: "absent", causa: "scc -a no corrió (binario ausente o falló)", hint: "revisa metrics.json.degradations — la descarga fire-and-forget puede seguir en curso" };
 const dry = text.match(/"DRYness"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)%?"/) || text.match(/DRYness[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*%/);
 // Contrato v4.0.0 observado (smoke V1): el JSON de -a es un array de
 // LanguageSummary con "ULOC" POR LENGUAJE y Files:[] — SIN ULOC total ni
 // DRYness global (la tabla de texto plano sí trae DRYness). Se suman
 // TODOS los ULOC del JSON; el patrón texto-plano queda como fallback.
 const jsonUlocs = text.match(/"ULOC"\s*:\s*"?([0-9]+)"?/g);
 let uloc = null;
 if (jsonUlocs) {
  let sum = 0;
  for (let i = 0; i < jsonUlocs.length; i++) { sum += Number(jsonUlocs[i].replace(/[^0-9]/g, "")) }
  uloc = sum;
 } else {
  const plain = text.match(/ULOC[^0-9]*([0-9]+)/);
  if (plain) uloc = Number(plain[1]);
 }
 if (!dry && uloc === null) return { status: "parse-error", causa: "sin DRYness/ULOC en la salida de scc -a", hint: "revisa artifacts/scc-a.json — run.sccVersion declara la versión usada (¿contrato cambió?)" };
 return { status: "ok", drynessPercent: dry ? Number(dry[1]) : null, uloc: uloc }
}
// CSVs scc: split tolerante con conteo skipped — los reportes churn llevan
// una 1ª línea de comentario "# window: depth=... commits=..." ANTES del
// header (contrato v4.0.0 observado en el smoke V1) que se salta aquí;
// hotspots/coupling aceptan solo ancho exacto (paths con coma, raros, se
// descartan contados); by-author parsea desde la derecha y fusiona los
// primeros campos (autores con coma SÍ ocurren) — Author,Email,Code,
// Complexity,Comment,Files,OwnsPercent,LastCommit,BeforeWindow = 9 columnas.
function csvBody(text) {
 const all = String(text || "").trim().split("\n").map(function (l) { return l.trim() }).filter(Boolean).filter(function (l) { return l.charAt(0) !== "#" });
 if (!all.length) return { rows: [], skipped: 0 };
 const head = all[0].toLowerCase();
 const body = head.indexOf("file") === 0 || head.indexOf("author") === 0 ? all.slice(1) : all;
 return { rows: body, skipped: all.length - body.length }
}
function parseHotspots(text) {
 if (text === null) return { status: "absent", causa: "reporte --hotspots ausente (sin repo git o scc no corrió)", hint: "las familias churn requieren historial git con commits" };
 const b = csvBody(text);
 const rows = []; let skipped = b.skipped;
 for (const l of b.rows) {
  const c = l.split(",");
  if (c.length !== 9) { skipped++; continue }
  rows.push({ file: c[0], language: c[1], complexity: toNum(c[2]), commits: toNum(c[3]), linesChanged: toNum(c[4]), authors: toNum(c[5]), codeChurn: toNum(c[6]), commentChurn: toNum(c[7]), score: toNum(c[8]) });
 }
 if (!rows.length) return { status: "empty", causa: "0 filas de hotspots (¿repo sin commits en la ventana?)", hint: "revisa artifacts/scc-hotspots.csv" };
 rows.sort(function (x, y) { return y.score - x.score || (x.file < y.file ? -1 : 1) });
 return { status: "ok", rows: rows.slice(0, TOP_ROWS), total: rows.length, truncated: rows.length > TOP_ROWS, skipped: skipped }
}
function parseCoupling(text) {
 if (text === null) return { status: "absent", causa: "reporte --coupling ausente (sin repo git o scc no corrió)", hint: "la familia coupling requiere historial git con commits" };
 const b = csvBody(text);
 const rows = []; let skipped = b.skipped;
 for (const l of b.rows) {
  const c = l.split(",");
  if (c.length !== 6) { skipped++; continue }
  rows.push({ fileA: c[0], fileB: c[1], shared: toNum(c[2]), commitsA: toNum(c[3]), commitsB: toNum(c[4]), degree: toNum(c[5]) });
 }
 if (!rows.length) return { status: "empty", causa: "0 pares acoplados (¿repo sin commits?)", hint: "revisa artifacts/scc-coupling.csv" };
 rows.sort(function (x, y) { return y.degree - x.degree || (x.fileA < y.fileA ? -1 : 1) });
 return { status: "ok", rows: rows.slice(0, TOP_ROWS), total: rows.length, truncated: rows.length > TOP_ROWS, skipped: skipped }
}
function parseAuthors(text) {
 if (text === null) return { status: "absent", causa: "reporte --by-author ausente (sin repo git o scc no corrió)", hint: "la familia autores requiere historial git con commits" };
 const b = csvBody(text);
 const rows = []; let skipped = b.skipped;
 for (const l of b.rows) {
  const c = l.split(",");
  if (c.length < 9) { skipped++; continue }
  const n = c.length;
  rows.push({ author: c.slice(0, n - 8).join(","), email: c[n - 8], code: toNum(c[n - 7]), complexity: toNum(c[n - 6]), comment: toNum(c[n - 5]), files: toNum(c[n - 4]), ownsPercent: toNum(c[n - 3]), lastCommit: c[n - 2] });
 }
 if (!rows.length) return { status: "empty", causa: "0 autores (¿repo sin commits?)", hint: "revisa artifacts/scc-by-author.csv" };
 rows.sort(function (x, y) { return y.code - x.code || (x.author < y.author ? -1 : 1) });
 return { status: "ok", rows: rows.slice(0, TOP_AUTHORS), total: rows.length, truncated: rows.length > TOP_AUTHORS, skipped: skipped }
}
// lizard --csv: NLOC,CCN,Tokens,Param,Length,Location (start:end@file:func).
function parseLizard(path) {
 if (!path) return { status: "absent", causa: "lizard ausente del PATH (familia opcional)", hint: "pip install lizard — CCN por función; sin él el informe marca 'no disponible'" };
 const text = readIfExists(path);
 if (text === null) return { status: "absent", causa: "lizard.csv no existe (corrida de lizard falló)", hint: "revisa artifacts/lizard.stderr" };
 const ccns = [];
 const rows = [];
 for (const l of String(text).trim().split("\n")) {
  const c = l.split(",");
  if (c.length < 6 || !/^\d+$/.test(c[0]) || !/^\d+$/.test(c[1])) continue;
  const ccn = toNum(c[1]);
  ccns.push(ccn);
  rows.push({ ccn: ccn, location: c.slice(5).join(",") });
 }
 if (!ccns.length) return { status: "parse-error", causa: "0 filas parseables de lizard --csv", hint: "revisa artifacts/lizard.csv (se espera NLOC,CCN,Tokens,Param,Length,Location)" };
 ccns.sort(function (x, y) { return x - y });
 rows.sort(function (x, y) { return y.ccn - x.ccn || (x.location < y.location ? -1 : 1) });
 return { status: "ok", functions: ccns.length, percentiles: { ccn: { p50: pct(ccns, 0.5), p90: pct(ccns, 0.9), p99: pct(ccns, 0.99), samples: ccns.length } }, worst: rows.slice(0, TOP_WORST) }
}
// ── Main ─────────────────────────────────────────────────────────────────
const curatedText = readIfExists(P.byFileCurated);
const rawText = readIfExists(P.byFileRaw);
let byFileFam = null;
let exclusions = [];
let rawBy = {};
let minified = { files: 0, loc: 0 };
if (curatedText === null) {
 byFileFam = { status: "absent", causa: "scc --by-file no corrió (binario ausente o falló)", hint: "revisa metrics.json.degradations — la descarga fire-and-forget puede seguir en curso" };
} else {
 const files = parseByFile(curatedText);
 if (!files) {
  byFileFam = { status: "parse-error", causa: "scc-by-file.json no es JSON válido", hint: "revisa artifacts/scc-by-file.json — run.sccVersion declara la versión usada" };
 } else if (!files.length) {
  byFileFam = { status: "empty", causa: "0 archivos medidos por scc (¿cwd vacío o sobre-excluido?)", hint: "corre sobre la raíz del proyecto y revisa exclude[] y la curada" };
 } else {
  byFileFam = Object.assign({ status: "ok" }, aggregate(files));
  minified = byFileFam.minifiedExcluded;
 }
}
if (rawText !== null) rawBy = rawVolumes(parseByFile(rawText) || []);
if (byFileFam.status === "ok") {
 // FR-6/D8: declara CADA exclusión aplicada con el volumen medido por el
 // delta de la 2ª pasada raw (sin curada) + el patrón min.js.
 exclusions = APPLIED_DIRS.map(function (d) {
  const v = rawBy[d] || { files: 0, loc: 0 };
  return { what: d, kind: "dir", files: v.files, loc: v.loc };
 });
 exclusions.push({ what: "*.min.js", kind: "pattern", files: minified.files, loc: minified.loc });
}
process.stdout.write(JSON.stringify({
 exclusions: exclusions,
 families: {
  "by-file": byFileFam,
  duplication: parseDuplication(readIfExists(P.sccA)),
  hotspots: parseHotspots(readIfExists(P.hotspots)),
  coupling: parseCoupling(readIfExists(P.coupling)),
  authors: parseAuthors(readIfExists(P.byAuthor)),
  "ccn-funcion": parseLizard(P.lizard),
 },
}));
`;

/** Escape de backslash/backtick/${ para interpolar strings en template literal. */
function lit(value: string): string {
 return value
  .replaceAll("\\", "\\\\")
  .replaceAll("`", "\\`")
  .replaceAll("${", "\\${");
}

/** Emite las constantes de prompt del script (preamble no-stage + 2 stages). */
function stageConsts(stages: ResolvedSizeAppStage[]): string {
 const preamble = `\t// Preamble no-stage (D11): veto de solo-escritura + juez de números viven\n\t// AQUÍ, fuera del mapa de stages — un override 3-capas REEMPLAZA el prompt\n\t// completo del stage y no puede tocar esto.\n\tconst PREAMBLE = \`${lit(SIZE_APP_PREAMBLE)}\`;`;
 const names: Record<string, SizeAppStage> = {
  ANALYZE: "analyze",
  JUDGE: "judge",
 };
 const lines = Object.entries(names).map(([constName, stage]) => {
  const found = stages.find((s) => s.stage === stage);
  if (!found) {
   throw new Error(`frida-size-app: falta el stage '${stage}' en el resolver.`);
  }
  return `\t// ${stage} — fuente del prompt: ${found.source}\n\tconst ${constName} = \`${lit(found.prompt)}\`;`;
 });
 return [preamble, ...lines].join("\n");
}

// ── COCOMO + anexos (fases analyze/synthesize, D3/D6/D9) ────────────

/** Constantes Basic COCOMO 81 por modo — réplica EXACTA de scc v4.0.0
 *  (processor/cocomo.go): E = a·KSLOC^b·EAF (persona-mes), TDEV = c·E^d
 *  (meses), personas pico = E/TDEV. Exportadas para el test de dominio
 *  (fixtures precomputadas V2) — d VARIABLE por modo (0.35 semi-detached). */
export const COCOMO_CONSTANTS: Readonly<
 Record<CocomoType, { a: number; b: number; c: number; d: number }>
> = {
 organic: { a: 2.4, b: 1.05, c: 2.5, d: 0.38 },
 "semi-detached": { a: 3.0, b: 1.12, c: 2.5, d: 0.35 },
 embedded: { a: 3.6, b: 1.2, c: 2.5, d: 0.32 },
};

/** Overhead de costo de scc: costo = E·wageMensual·overhead (el wage nativo
 *  de scc es anual y divide /12; el nuestro ya es mensual ≡ anual/12 —
 *  números idénticos a la salida nativa de scc). */
export const COCOMO_OVERHEAD = 2.4;

/** Spread EAF del informe (D6): supuesto conservador del analista,
 *  etiquetado explícito "no estándar" (lo documentado: 0.9–1.4 típico). */
export const COCOMO_EAF_SPREAD: readonly number[] = [0.85, 1.0, 1.15];

/**
 * Escritores del fanout de análisis (D3): 3 anexos interpretativos FIJOS
 * bajo analisis/ — sus cifras están en metrics.json o se re-derivan con
 * fórmula declarada; dimensionamiento.md los cita por ruta (análogo
 * ANALYZE_WRITERS de M1). Interpolados al sandbox como specs planas.
 */
export const ANNEX_WRITERS: ReadonlyArray<{
 key: string;
 file: string;
 brief: string;
}> = [
 {
  key: "hotspots",
  file: "analisis/hotspots.md",
  brief:
   "Narrativa interpretativa de los hotspots (families.hotspots de metrics.json + artifacts/scc-hotspots.csv): qué son los archivos con mayor score, por qué concentran riesgo (complejidad × churn × autores), patrones comunes entre ellos y atención priorizada. Si la familia está degradada, decláralo explícitamente y documenta el vacío — nunca repitas números que no puedas rastrear.",
 },
 {
  key: "deuda-modulos",
  file: "analisis/deuda-modulos.md",
  brief:
   "Interpretación de la deuda por módulo (families.by-file.modules y derived.modulesDebt/waves de metrics.json): qué módulos concentran debtHours y por qué importa, relación LOC/deuda (¿deuda por tamaño o por densidad?), y cómo conecta con las olas de migración. Declara las familias degradadas que uses.",
 },
 {
  key: "riesgos-tamano",
  file: "analisis/riesgos-tamano.md",
  brief:
   "Riesgos derivados del tamaño (families.by-file + derived de metrics.json): KLOC vs COCOMO (¿el tamaño sostiene el modo elegido?), percentiles de complejidad p50/p90/p99 (colas), bus factor (concentración de conocimiento), duplicación DRYness/ULOC si está disponible — riesgos accionables para la preventa, cada uno trazable a metrics.json.",
 },
];

/**
 * Genera el script del workflow `size-app` (5 fases estrictamente
 * secuenciales: bootstrap → metrics → analyze → synthesize → judge; FR-11:
 * maxMinutes corta el descubrimiento —analyze—, jamás salta
 * synthesize/judge sobre lo alcanzado). `sccBin` es la ruta ABSOLUTA del
 * binario pineado (sccBinPath(defaultAgentDir()) en la factory): el script
 * lo invoca shq-quoted por ruta absoluta — JAMÁS del PATH
 * (reproducibilidad del pin).
 */
export function generateSizeAppWorkflow(
 stages: ResolvedSizeAppStage[],
 args: SizeAppArgs,
 capabilities: SizeAppCapabilities,
 sccBin: string,
): string {
 return `// Patrón builtin: size-app (frida-size-app #139, M10 Pista M).
// Args estructurales (wage/currency/cocomoType/exclude) son CONST interpoladas
// host-side (canon M9): validados eager en resolve(); los escalares
// (maxMinutes/language/review) mantienen el canon defensivo del motor.
const wage = ${JSON.stringify(args.wage)}
const currency = ${JSON.stringify(args.currency)}
const cocomoType = ${JSON.stringify(args.cocomoType)}
const USER_EXCLUDE = ${JSON.stringify(args.exclude)}
const CURATED = ${JSON.stringify(CURATED_EXCLUDE_DIRS)}
const EXCLUDE_DIRS = ${JSON.stringify(excludeDirsFor(args))}
const maxMinutes = (args && typeof args.maxMinutes === "number") ? args.maxMinutes : ${JSON.stringify(args.maxMinutes)}
const language = (args && args.language) || ${JSON.stringify(args.language)}
const review = (args && (args.review === "manual" || args.review === "auto")) ? args.review : ${JSON.stringify(args.review)}
const ART = ${JSON.stringify(SIZE_APP_ARTIFACTS_DIR)}
const SCC_BIN = ${JSON.stringify(sccBin)}
const SCC_PIN = ${JSON.stringify(SCC_PIN)}
const CAPABILITIES = ${JSON.stringify({ scc: capabilities.scc === true, lens: capabilities.lens === true, codebaseIndex: capabilities.codebaseIndex === true })}
const SCC_FAMILIES = ["by-file", "duplication", "hotspots", "coupling", "authors"]
const COCOMO = ${JSON.stringify(COCOMO_CONSTANTS[args.cocomoType])} // constantes EXACTAS del modo elegido (D6)
const EAF_SPREAD = ${JSON.stringify(COCOMO_EAF_SPREAD)}
const OVERHEAD = ${JSON.stringify(COCOMO_OVERHEAD)}
const WRITER_SPECS = ${JSON.stringify(ANNEX_WRITERS)}
const AGG_JS = ${JSON.stringify(METRICS_AGG_SOURCE)}
${stageConsts(stages)}
const WRITER_SCHEMA = { type: "object", properties: { doc: { type: "string" }, sections: { type: "array", items: { type: "string" } }, summary: { type: "string" } }, required: ["doc", "summary"] }
const JUDGE_SCHEMA = { type: "object", properties: { decision: { type: "string", enum: ["PASS", "CONCERNS", "FAIL"] }, findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }, evidence: { type: "string" }, fix: { type: "string" } }, required: ["severity", "evidence", "fix"] } }, summary: { type: "string" } }, required: ["decision", "findings", "summary"] }

function wkCtx(prompt, blocks) {
 return PREAMBLE + "\\n\\n" + prompt + "\\n\\n---\\n\\n## Runtime context\\n" + blocks.join("\\n")
}

async function tryRun(command) {
 return await shell(command)
}
async function run(command) {
 const r = await shell(command)
 if (r.exitCode !== 0) throw new Error("shell falló (" + r.exitCode + "): " + command + " — " + String(r.stderr || "").slice(0, 500))
 return r.stdout
}
// Writer determinista (D12): heredoc con fence-guard propio SA_EOF — molde
// writeText de M8/M9. NADA más escribe metrics.json / entregables / helpers.
async function writeText(path, content) {
 let text = String(content)
 if (text.indexOf("SA_EOF") >= 0) throw new Error("writeText: contenido no puede contener SA_EOF: " + path)
 if (text.charAt(text.length - 1) !== "\\n") text = text + "\\n"
 await run("mkdir -p $(dirname " + shq(path) + ")")
 const r = await tryRun("cat > " + shq(path) + " << 'SA_EOF'\\n" + text + "SA_EOF")
 if (r.exitCode !== 0) throw new Error("writeText falló: " + path + " — " + String(r.stderr || "").slice(0, 500))
}

// Quoting shell POSIX para TODO argumento con metacaracteres (SCC_BIN puede
// vivir en un agentDir con espacios; patrones y CSVs de usuario igual).
function shq(value) {
 return "'" + String(value).replace(/'/g, "'\\\\''") + "'"
}

async function epochNow() {
 return parseInt((await run("date +%s")).trim(), 10)
}

function outOf(r) {
 return String((r && r.stdout) || "").trim() || String((r && r.stderr) || "").trim()
}

function asArray(value) {
 return Array.isArray(value) ? value : []
}

function round1(x) {
 return Math.round((Number(x) || 0) * 10) / 10
}

function fmt(n, d) {
 const x = Number(n)
 if (!isFinite(x)) return "n/d"
 return x.toFixed(d === undefined ? 1 : d)
}

// Separador de miles SIN Intl (sandbox sin Date/Intl — Current State):
// agrupación manual con regex sobre el entero (escapes doblados, lección S4).
function fmtInt(n) {
 const x = Math.round(Number(n) || 0)
 const sign = x < 0 ? "-" : ""
 const grouped = String(x < 0 ? -x : x).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",")
 return sign + grouped
}

// Celda segura para tablas markdown (molde M1 mdCell — el pipe escapa).
function mdCell(value) {
 return String(value === null || value === undefined ? "" : value).replace(/\\|/g, "\\\\|")
}

// ── metrics.json: writer único el script (única fuente de verdad, D3) ──────
const inv = {
 run: { pattern: "size-app", language: language, wage: wage, currency: currency, cocomoType: cocomoType, exclude: USER_EXCLUDE, curatedExclude: CURATED, maxMinutes: maxMinutes, review: review, sccVersion: "", startedAt: "", startedAtEpoch: 0, finishedAt: "", stoppedBy: "", stoppedByTime: false },
 capabilities: { scc: CAPABILITIES.scc, sccPin: SCC_PIN, git: false, lizard: false, lens: CAPABILITIES.lens, codebaseIndex: CAPABILITIES.codebaseIndex },
 exclusions: [],
 families: {},
 degradations: [],
 annexes: [],
 derived: null, // se llena en synthesize
}
function invSerialize() {
 return JSON.stringify(inv, null, 2) + "\\n"
}
async function invWrite() {
 await writeText(ART + "/artifacts/metrics.json", invSerialize())
}

// Degradación honesta (FR-7): {familia, causa, hint} — el informe deriva
// "no disponible" de aquí, nunca repone con supuestos. hasDegradation evita
// duplicar la causa de un gate de bootstrap con la del helper de agregación.
function hasDegradation(familia) {
 for (let i = 0; i < inv.degradations.length; i++) { if (inv.degradations[i].familia === String(familia)) return true }
 return false
}
function registerDegradation(familia, causa, hint) {
 inv.degradations.push({ familia: String(familia), causa: String(causa), hint: String(hint) })
}

// Resumen delgado de familias para el runtime context de los escritores:
// el detalle vive en metrics.json, que el agente lee de disco (prompt D3).
function familiesSummary() {
 const names = Object.keys(inv.families)
 if (!names.length) return "(sin familias — scc/lizard no disponibles; revisa degradations)"
 return names.map(function (k) {
  const f = inv.families[k]
  return "- " + k + ": " + (f && f.status ? f.status : "unknown")
 }).join("\\n")
}

// Evidencia cruda listada SOLO si su fuente corrió (status !== "absent").
function evidenceFor(name, file) {
 const f = inv.families[name]
 return f && f.status && f.status !== "absent" ? "- " + file : null
}

function evidenceListing() {
 const ev = [
  evidenceFor("by-file", ART + "/artifacts/scc-by-file.json (grande — consúltalo con grep, no lo imprimas completo)"),
  evidenceFor("duplication", ART + "/artifacts/scc-a.json"),
  evidenceFor("hotspots", ART + "/artifacts/scc-hotspots.csv"),
  evidenceFor("coupling", ART + "/artifacts/scc-coupling.csv"),
  evidenceFor("authors", ART + "/artifacts/scc-by-author.csv"),
  evidenceFor("ccn-funcion", ART + "/artifacts/lizard.csv"),
 ].filter(function (x) { return x !== null })
 return ev.length ? ev.join("\\n") : "(sin evidencia en artifacts/ — scc y lizard no corrieron)"
}

log("size-app: cwd [cocomoType=" + cocomoType + " wage=" + wage + " " + currency + " exclude=" + (USER_EXCLUDE.length || "solo-curada") + (maxMinutes > 0 ? " maxMinutes=" + maxMinutes : "") + "]")

// ── bootstrap (determinista) ───────────────────────────────────────────────
phase("bootstrap")
// mkdir -p de TODOS los directorios AL ARRANQUE (lesson bffd6f1).
await run("mkdir -p " + shq(ART + "/artifacts") + " " + shq(ART + "/analisis"))
inv.run.startedAt = (await run("date '+%Y-%m-%d %H:%M:%S %z'")).trim()
inv.run.startedAtEpoch = await epochNow()
// FR-11: deadline wall-clock del DESCUBRIMIENTO (analyze); synthesize/judge
// corren siempre sobre lo alcanzado.
const deadline = maxMinutes > 0 ? inv.run.startedAtEpoch + maxMinutes * 60 : 0
// Gates deterministas por familia (FR-7): git para churn/coupling/autores,
// lizard para CCN por función. Una capacidad ausente NUNCA aborta la corrida
// (D2): degrada con causa+hint y las fases siguientes corren sobre lo
// alcanzado — el juez (parte 3) reporta los gaps como CONCERNS.
inv.capabilities.git = (await tryRun("git rev-parse --is-inside-work-tree")).exitCode === 0
inv.capabilities.lizard = (await tryRun("command -v lizard")).exitCode === 0
if (!CAPABILITIES.scc) {
 for (let i = 0; i < SCC_FAMILIES.length; i++) {
  registerDegradation(SCC_FAMILIES[i], "scc v" + SCC_PIN + " no instalado al pin (CAPABILITIES.scc=false: descarga fire-and-forget en curso o fallida)", "espera unos minutos y reintenta (la descarga se dispara al iniciar la sesión), o instala manual siguiendo docs/tools/frida-size-app.md")
 }
}
if (!inv.capabilities.git) {
 const GIT_FAMILIES = ["hotspots", "coupling", "authors"]
 for (let i = 0; i < GIT_FAMILIES.length; i++) {
  registerDegradation(GIT_FAMILIES[i], "sin repo git (git rev-parse falló): churn/coupling/autores no derivables", "corre el patrón sobre un clone con historial git para habilitar la familia")
 }
}
if (!inv.capabilities.lizard) {
 registerDegradation("ccn-funcion", "lizard ausente del PATH (familia opcional)", "pip install lizard — CCN por función; sin él el informe marca 'no disponible'")
}
await invWrite()

// ── metrics (determinista: sondas scc/lizard → metrics.json, FR-5) ────────
phase("metrics")
if (CAPABILITIES.scc) {
 inv.run.sccVersion = outOf(await tryRun(shq(SCC_BIN) + " --version")).trim().slice(0, 80)
 const EXCLUDE_FLAG = "--exclude-dir " + shq(EXCLUDE_DIRS.join(","))
 // By-file JAMÁS vuelve por stdout del sandbox (RPC 10 MB, D10): redirect
 // a disco y el helper host-side lo agrega. --cognitive habilita el
 // conteo cognitivo por archivo (insumo SQALE, D9 — flag v4.0.0; el
 // smoke V1 congela el contrato real antes de los mocks del e2e).
 await run(shq(SCC_BIN) + " --by-file --format json --cognitive " + EXCLUDE_FLAG + " > " + shq(ART + "/artifacts/scc-by-file.json"))
 // 2ª pasada raw SIN la curada (solo defaults git de scc): mide el volumen
 // excluido por directorio (FR-6/D8). Ambas pasadas ~segundos en ~1M LOC.
 await run(shq(SCC_BIN) + " --by-file --format json > " + shq(ART + "/artifacts/scc-by-file-raw.json"))
 // -a global (ULOC/DRYness) CON exclusiones — UNA corrida, sin by-file
 // (penaliza ~2× runtime, Performance Considerations).
 await run(shq(SCC_BIN) + " -a --format json " + EXCLUDE_FLAG + " > " + shq(ART + "/artifacts/scc-a.json"))
 if (inv.capabilities.git) {
  await run(shq(SCC_BIN) + " --hotspots --format csv " + EXCLUDE_FLAG + " > " + shq(ART + "/artifacts/scc-hotspots.csv"))
  await run(shq(SCC_BIN) + " --coupling --format csv " + EXCLUDE_FLAG + " > " + shq(ART + "/artifacts/scc-coupling.csv"))
  await run(shq(SCC_BIN) + " --by-author --format csv " + EXCLUDE_FLAG + " > " + shq(ART + "/artifacts/scc-by-author.csv"))
 }
}
if (inv.capabilities.lizard) {
 // lizard no respeta gitignore: exclusiones vía -x (regex de ruta) con la
 // MISMA lista + min.js. tryRun — familia opcional: un fallo degrada, no
 // aborta (el gate de stdout/parseo lo decide el helper).
 const dotEsc = function (s) { return String(s).replace(/\\./g, "\\\\.") }
 const lizardPat = "(^|/)(" + EXCLUDE_DIRS.map(dotEsc).join("|") + ")/|\\\\.min\\\\.js$"
 await tryRun("lizard --csv -x " + shq(lizardPat) + " . > " + shq(ART + "/artifacts/lizard.csv") + " 2> " + shq(ART + "/artifacts/lizard.stderr"))
}
// Agregación EN EL HOST (D10): el helper lee la evidencia gorda de disco y
// devuelve stdout delgado — el sandbox nunca parsea el by-file completo.
if (CAPABILITIES.scc || inv.capabilities.lizard) {
 await writeText(ART + "/artifacts/metrics-agg.js", AGG_JS)
 const aggRaw = await run("node " + shq(ART + "/artifacts/metrics-agg.js") + " " + shq(ART + "/artifacts/scc-by-file.json") + " " + shq(ART + "/artifacts/scc-by-file-raw.json") + " " + shq(ART + "/artifacts/scc-a.json") + " " + shq(ART + "/artifacts/scc-hotspots.csv") + " " + shq(ART + "/artifacts/scc-coupling.csv") + " " + shq(ART + "/artifacts/scc-by-author.csv") + " " + shq(ART + "/artifacts/lizard.csv") + " " + shq(EXCLUDE_DIRS.join(",")))
 let agg = null
 try { agg = JSON.parse(aggRaw) } catch (e) { agg = null }
 if (agg && agg.families) {
  inv.families = agg.families
  inv.exclusions = asArray(agg.exclusions)
  // FR-7: familia con fuente ausente/vacía/corrupta → degradación con
  // la causa del helper, SIN duplicar la de un gate de bootstrap.
  Object.keys(agg.families).forEach(function (name) {
   const fam = agg.families[name]
   if (fam && fam.status === "ok") return
   if (hasDegradation(name)) return
   registerDegradation(name, String((fam && fam.causa) || "familia no disponible"), String((fam && fam.hint) || "revisa docs/dimensionamiento/artifacts/"))
  })
 } else {
  throw new Error("size-app: el agregador de métricas falló (salida no-JSON de node) — inspecciona " + ART + "/artifacts/ corriendo node metrics-agg.js a mano")
 }
 await invWrite()
 const famOk = Object.keys(inv.families).filter(function (k) { return inv.families[k] && inv.families[k].status === "ok" }).length
 log("size-app: metrics — " + famOk + "/" + Object.keys(inv.families).length + " familias ok; " + inv.degradations.length + " degradaciones; " + inv.exclusions.length + " exclusiones declaradas")
}

// ── analyze: fan-out de 3 escritores de anexos interpretativos (D3/FR-8) ─
phase("analyze")
// FR-11: el wall-clock corta el DESCUBRIMIENTO (analyze); synthesize/judge
// SIEMPRE corren sobre lo alcanzado (el corte NO aborta — espejo M1/M8).
if (deadline > 0 && (await epochNow()) >= deadline) {
 inv.run.stoppedBy = "time"
 inv.run.stoppedByTime = true
 log("size-app: deadline alcanzado antes de analyze — anexos no generados; synthesize/judge sí corren (FR-11)")
 await invWrite()
} else {
 const WRITERS = WRITER_SPECS.map(function (w0) { return { key: w0.key, file: ART + "/" + w0.file, brief: w0.brief } })
 const annexTasks = {}
 WRITERS.forEach(function (w1) {
  annexTasks[w1.key] = function () {
   return agent(
    wkCtx(ANALYZE, [
     "## Tu anexo\\nRuta EXACTA donde escribirlo: " + w1.file,
     "## Especificación de contenido\\n" + w1.brief,
     "## Fuente de verdad numérica (léela de disco)\\nRuta: " + ART + "/artifacts/metrics.json\\n\\nEstado de familias:\\n" + familiesSummary(),
     "## Evidencias crudas disponibles\\n" + evidenceListing(),
     "## Idioma\\n" + language,
    ]),
    { label: "analyze " + w1.key, outputSchema: WRITER_SCHEMA }
   )
  }
 })
 const annexResults = await parallel("annexes", annexTasks)

 // Gate de artefacto por anexo (lesson d203630) + reintento informado una
 // vez (lesson 619d9e7) — molde spec-retry M1/M8/M9.
 const annexGate = "for f in " + WRITERS.map(function (w2) { return shq(w2.file) }).join(" ") + "; do test -s \\"$f\\" || echo \\"missing:$f\\"; done"
 let aGate = await shell(annexGate)
 if ((aGate.stdout || "").trim()) {
  const aMissing = aGate.stdout.trim().split("\\n").map(function (l) { return l.replace(/^missing:/, "") })
  log("size-app: analyze sin escribir " + aMissing.join(", ") + " — reintento informado")
  const retryTasks = {}
  WRITERS.forEach(function (w3) {
   if (aMissing.indexOf(w3.file) === -1) return
   retryTasks[w3.key] = function () {
    return agent(
     wkCtx(ANALYZE, [
      "## Tu anexo\\nRuta EXACTA donde escribirlo: " + w3.file,
      "## Especificación de contenido\\n" + w3.brief,
      "## Fuente de verdad numérica (léela de disco)\\nRuta: " + ART + "/artifacts/metrics.json\\n\\nEstado de familias:\\n" + familiesSummary(),
      "## Evidencias crudas disponibles\\n" + evidenceListing(),
      "## Idioma\\n" + language,
      "## FALLA ANTERIOR — última oportunidad\\nTu intento anterior NO escribió " + w3.file + " (verificado con test -s). Tu summary fue: \\"" + String((annexResults[w3.key] && annexResults[w3.key].summary) || "").slice(0, 300) + "\\"\\nESCRÍBELO de verdad ahora con tus file tools — sin el archivo en disco el stage falla.",
     ]),
     { label: "analyze " + w3.key + " (reintento)", outputSchema: WRITER_SCHEMA }
    )
   }
  })
  const retried = await parallel("annexes-retry", retryTasks)
  Object.assign(annexResults, retried)
  aGate = await shell(annexGate)
  if ((aGate.stdout || "").trim()) {
   const diag = await shell("ls -la " + shq(ART + "/analisis"))
   throw new Error("size-app: tras reintentos los escritores NO escribieron:\\n" + aGate.stdout.trim() + "\\n$ ls -la " + ART + "/analisis\\n" + String(diag.stdout || diag.stderr || "(sin salida)"))
  }
 }
 // Registro de anexos ESCRITOS (claims verificables en disco).
 inv.annexes = WRITERS.map(function (w4) { return { key: w4.key, file: w4.file, status: "written" } })
 await invWrite()
 log("size-app: " + inv.annexes.length + " anexos interpretativos escritos")
}

// ── synthesize: derived + dimensionamiento.md + README.md (D3/D9) ────────
phase("synthesize")
// derived se computa EXCLUSIVAMENTE de inv.families/inv.run (D3/D9): cero
// números nuevos — cada fórmula viaja declarada junto al valor para el
// juez de números y la auditoría grep-verificable ex-post.
const BF = inv.families["by-file"] && inv.families["by-file"].status === "ok" ? inv.families["by-file"] : null
const AU = inv.families.authors && inv.families.authors.status === "ok" ? inv.families.authors : null
const CO = inv.families.coupling && inv.families.coupling.status === "ok" ? inv.families.coupling : null
const HS = inv.families.hotspots && inv.families.hotspots.status === "ok" ? inv.families.hotspots : null
const LZ = inv.families["ccn-funcion"] && inv.families["ccn-funcion"].status === "ok" ? inv.families["ccn-funcion"] : null
const DU = inv.families.duplication && inv.families.duplication.status === "ok" ? inv.families.duplication : null

// Rating SQALE (D9): ratio = deudaHoras / (0.5h × NCLOC); umbrales
// SonarQube A ≤0.05 · B ≤0.10 · C ≤0.20 · D ≤0.50 · E >0.50.
function sqaleRating(ratio) {
 if (ratio === null || ratio === undefined || !isFinite(ratio)) return null
 if (ratio <= 0.05) return "A"
 if (ratio <= 0.1) return "B"
 if (ratio <= 0.2) return "C"
 if (ratio <= 0.5) return "D"
 return "E"
}

// Bus factor (D9): rows ya ordenadas por Code desc; acumula hasta cubrir
// ≥50% del Code de los autores considerados (top-100 del helper host-side).
function computeBusFactor() {
 if (!AU || !AU.rows || !AU.rows.length) return null
 let total = 0
 AU.rows.forEach(function (r0) { total += Number(r0.code) || 0 })
 if (!(total > 0)) return null
 let acc = 0
 let count = 0
 for (let i = 0; i < AU.rows.length; i++) {
  acc += Number(AU.rows[i].code) || 0
  count = count + 1
  if (acc >= 0.5 * total) break
 }
 return { count: count, authorsConsidered: AU.rows.length, codeConsidered: total, truncated: Boolean(AU.truncated) }
}

// Olas strangler-fig (D9): módulos = top-level dirs con LOC ≥ 1% del total;
// orden por debtHours desc; ola 1 hasta ~1/3 de la deuda considerada, ola 2
// hasta ~2/3 acumulado, ola 3 el resto — reservando ≥1 módulo por ola
// restante; semanas = share × TDEV central (EAF 1.00) × 52/12. La fórmula
// completa queda en derived.waves para auditoría.
function buildWaves(modules, totalLoc, tdevCentralMonths) {
 const eligible = (modules || []).filter(function (m0) { return Number(m0.loc) >= 0.01 * totalLoc })
 const sorted = eligible.slice().sort(function (x, y) { return (Number(y.debtHours) || 0) - (Number(x.debtHours) || 0) || (String(x.name) < String(y.name) ? -1 : 1) })
 let considered = 0
 sorted.forEach(function (m1) { considered += Number(m1.debtHours) || 0 })
 const out = { eligibleModules: sorted.length, consideredDebtHours: round1(considered), tdevCentralMonths: tdevCentralMonths, weeksPerMonth: 52 / 12, waves: [] }
 if (!sorted.length || !(considered > 0) || !(tdevCentralMonths > 0)) return out
 const buckets = [[], [], []]
 const limits = [considered / 3, (2 * considered) / 3]
 let idx = 0
 let acc = 0
 for (let i = 0; i < sorted.length; i++) {
  buckets[idx].push(sorted[i])
  acc += Number(sorted[i].debtHours) || 0
  if (idx < 2 && acc >= limits[idx] && sorted.length - i - 1 >= 2 - idx) idx = idx + 1
 }
 for (let w = 0; w < 3; w++) {
  if (!buckets[w].length) continue
  let debt = 0
  buckets[w].forEach(function (m2) { debt += Number(m2.debtHours) || 0 })
  const share = debt / considered
  out.waves.push({ wave: w + 1, modules: buckets[w].map(function (m3) { return m3.name }), moduleCount: buckets[w].length, debtHours: round1(debt), share: share, weeks: round1(share * tdevCentralMonths * (52 / 12)) })
 }
 return out
}

function buildDerived() {
 const busFactor = computeBusFactor()
 const duplication = DU ? { drynessPercent: DU.drynessPercent !== undefined ? DU.drynessPercent : null, uloc: DU.uloc !== undefined ? DU.uloc : null } : null
 const ccnPct = LZ && LZ.percentiles && LZ.percentiles.ccn ? LZ.percentiles.ccn : null
 if (!BF || !(Number(BF.loc) > 0)) {
  const fam = inv.families["by-file"]
  const causa = BF ? "by-file ok pero 0 LOC medidos" : "familia by-file " + (fam && fam.status ? fam.status : "ausente") + (fam && fam.causa ? ": " + fam.causa : "")
  return { computed: false, causa: causa, kloc: null, cocomo: null, sqale: null, waves: null, modulesDebt: null, percentiles: { complexity: null, ccn: ccnPct }, busFactor: busFactor, duplication: duplication }
 }
 const kloc = BF.loc / 1000
 // COCOMO (D6): constantes EXACTAS de scc — E = a·KSLOC^b·EAF (PM),
 // TDEV = c·E^d (meses), personas pico = E/TDEV, costo = E·wage mensual·
 // overhead. Números idénticos a la salida nativa de scc.
 const rows = EAF_SPREAD.map(function (eaf) {
  const effort = COCOMO.a * Math.pow(kloc, COCOMO.b) * eaf
  const tdev = COCOMO.c * Math.pow(effort, COCOMO.d)
  return { eaf: eaf, effort: round1(effort), tdev: round1(tdev), people: tdev > 0 ? round1(effort / tdev) : null, cost: Math.round(effort * wage * OVERHEAD) }
 })
 const centralTdev = rows.length > 1 ? rows[1].tdev : null
 // SQALE proxy (D9): debtHours ya agregada POR ARCHIVO por el helper
 // host-side (Σ max(0, cognitive−15) × 0.5h); rating sobre NCLOC (= Code).
 const debtHours = Number(BF.debtHours) || 0
 const ratio = debtHours / (0.5 * BF.loc)
 return {
  computed: true,
  kloc: kloc,
  files: BF.files,
  loc: BF.loc,
  debtHours: BF.debtHours,
  sqale: { ratio: Math.round(ratio * 1000) / 1000, rating: sqaleRating(ratio), formula: "deudaHoras / (0.5h × NCLOC)", thresholds: { A: 0.05, B: 0.1, C: 0.2, D: 0.5 } },
  cocomo: { type: cocomoType, constants: COCOMO, overhead: OVERHEAD, wageMonthly: wage, currency: currency, klocSource: "families['by-file'].loc / 1000 (SLOC con exclusiones)", rows: rows },
  percentiles: { complexity: BF.percentiles && BF.percentiles.complexity ? BF.percentiles.complexity : null, ccn: ccnPct },
  busFactor: busFactor,
  waves: buildWaves(BF.modules, BF.loc, centralTdev),
  modulesDebt: (BF.modules || []).slice().sort(function (x, y) { return (Number(y.debtHours) || 0) - (Number(x.debtHours) || 0) || (String(x.name) < String(y.name) ? -1 : 1) }),
  duplication: duplication,
 }
}

const derived = buildDerived()
inv.derived = derived
inv.run.finishedAt = (await run("date '+%Y-%m-%d %H:%M:%S %z'")).trim()
await invWrite()
const projectLabel = (await run("basename \\"$PWD\\"")).trim()

// dimensionamiento.md — 100% derivado de metrics.json (D3): aquí NO se
// computa ninguna cifra nueva; las tablas pintan inv.families/inv.derived.
const dm = []
dm.push("# Dimensionamiento cuantitativo — " + projectLabel)
dm.push("")
dm.push("> Generado por el patrón \`size-app\` (frida-size-app). FUENTE DE VERDAD: \`artifacts/metrics.json\` — toda cifra de este informe está ahí tal cual o se re-deriva con la fórmula declarada junto a ella.")
dm.push("")
dm.push("## Corrida")
dm.push("")
dm.push("- Inicio: " + inv.run.startedAt + " · Fin: " + inv.run.finishedAt)
dm.push("- Wage: " + currency + " " + fmt(wage, 2) + "/mes por persona · COCOMO: " + cocomoType + " · overhead " + fmt(OVERHEAD, 1))
dm.push("- scc: " + (inv.run.sccVersion || "(no corrió)") + (USER_EXCLUDE.length ? " · excl. adicionales: " + USER_EXCLUDE.join(", ") : "") + (maxMinutes > 0 ? " · tope " + maxMinutes + " min" : " · sin tope de tiempo"))
dm.push("- Corte: " + (inv.run.stoppedBy ? inv.run.stoppedBy + (inv.run.stoppedByTime ? " (wall-clock)" : "") : "sin corte"))
dm.push("")
if (derived.computed) {
 dm.push("## Resumen ejecutivo")
 dm.push("")
 dm.push("- KLOC efectivos: **" + fmt(derived.kloc, 1) + "** (" + fmtInt(derived.files) + " archivos · SLOC con exclusiones)")
 dm.push("- Deuda SQALE (proxy): **" + fmt(derived.debtHours, 1) + " h** · rating **" + (derived.sqale.rating || "n/d") + "**")
 dm.push("- COCOMO (" + cocomoType + "): **" + fmt(derived.cocomo.rows[0].effort, 1) + "–" + fmt(derived.cocomo.rows[derived.cocomo.rows.length - 1].effort, 1) + " PM** · costo **" + currency + " $" + fmtInt(derived.cocomo.rows[0].cost) + " – $" + fmtInt(derived.cocomo.rows[derived.cocomo.rows.length - 1].cost) + "** (EAF 0.85–1.15)")
 dm.push("- Bus factor: " + (derived.busFactor ? "**" + derived.busFactor.count + "**" : "no disponible") + " · Olas de migración: " + derived.waves.waves.length)
 dm.push("")
 dm.push("## COCOMO — Basic COCOMO 81 (Boehm), tipo " + cocomoType)
 dm.push("")
 dm.push("| EAF | Esfuerzo (PM) | TDEV (meses) | Personas pico | Costo (" + currency + ") |")
 dm.push("| --- | --- | --- | --- | --- |")
 derived.cocomo.rows.forEach(function (row) {
  const cells = [fmt(row.eaf, 2), fmt(row.effort, 1), fmt(row.tdev, 1), row.people === null || row.people === undefined ? "n/d" : fmt(row.people, 1), "$" + fmtInt(row.cost)]
  const central = Number(row.eaf) === 1
  dm.push("| " + cells.map(function (c) { return central ? "**" + c + "**" : c }).join(" | ") + " |")
 })
 dm.push("")
 dm.push("> E = " + COCOMO.a + "·KSLOC^" + COCOMO.b + "·EAF · TDEV = " + COCOMO.c + "·E^" + COCOMO.d + " · personas pico = E/TDEV · costo = PM·wage mensual·" + OVERHEAD + " (overhead).")
 dm.push("> KSLOC efectivos = " + fmt(derived.kloc, 1) + " (\`derived.kloc\`, SLOC con exclusiones). Spread EAF 0.85/1.00/1.15: supuesto conservador del analista, NO un estándar (lo documentado: típicamente 0.9–1.4).")
 dm.push("")
 dm.push("## Complejidad — percentiles nearest-rank")
 dm.push("")
 dm.push("| Serie | Muestra | p50 | p90 | p99 |")
 dm.push("| --- | --- | --- | --- | --- |")
 const cp = derived.percentiles.complexity
 if (cp) dm.push("| Complejidad por archivo (scc) | " + fmtInt(cp.samples) + " | " + fmt(cp.p50, 0) + " | " + fmt(cp.p90, 0) + " | " + fmt(cp.p99, 0) + " |")
 else dm.push("| Complejidad por archivo (scc) | no disponible | | | |")
 const lp = derived.percentiles.ccn
 if (lp) dm.push("| CCN por función (lizard) | " + fmtInt(lp.samples) + " | " + fmt(lp.p50, 0) + " | " + fmt(lp.p90, 0) + " | " + fmt(lp.p99, 0) + " |")
 else dm.push("| CCN por función (lizard) | no disponible | | | |")
 dm.push("")
 dm.push("## Deuda técnica — SQALE proxy (NO es SonarQube)")
 dm.push("")
 dm.push("- deudaHoras = Σ por archivo max(0, cognitiva − 15) × 0.5 h = **" + fmt(derived.debtHours, 1) + " h** (umbral 15 = complejidad cognitiva alta, estándar SonarQube).")
 dm.push("- rating = deudaHoras / (0.5 h × NCLOC) = " + fmt(derived.sqale.ratio, 3) + " → **" + derived.sqale.rating + "** (A ≤0.05 · B ≤0.10 · C ≤0.20 · D ≤0.50 · E >0.50).")
 dm.push("")
 dm.push("## Deuda por módulo (top-level)")
 dm.push("")
 dm.push("| Módulo | Archivos | LOC | Deuda (h) |")
 dm.push("| --- | --- | --- | --- |")
 derived.modulesDebt.forEach(function (m4) {
  dm.push("| \`" + mdCell(m4.name) + "\` | " + fmtInt(m4.files) + " | " + fmtInt(m4.loc) + " | " + fmt(m4.debtHours, 1) + " |")
 })
 dm.push("")
 dm.push("## Olas de migración (strangler-fig, priorizadas por deuda)")
 dm.push("")
 if (derived.waves.waves.length) {
  dm.push("| Ola | Módulos | Deuda (h) | % deuda | Semanas (TDEV central) |")
  dm.push("| --- | --- | --- | --- | --- |")
  derived.waves.waves.forEach(function (w5) {
   dm.push("| O" + w5.wave + " (" + w5.moduleCount + ") | \`" + mdCell(w5.modules.join(", ")) + "\` | " + fmt(w5.debtHours, 1) + " | " + Math.round(w5.share * 100) + "% | " + fmt(w5.weeks, 1) + " |")
  })
  dm.push("")
  dm.push("> Módulos elegibles: top-level dirs con LOC ≥ 1% del total (" + derived.waves.eligibleModules + " elegibles · deuda considerada " + fmt(derived.waves.consideredDebtHours, 1) + " h). Semanas = share × TDEV central (" + fmt(derived.waves.tdevCentralMonths, 1) + " meses, EAF 1.00) × 52/12 — fórmula en \`derived.waves\`.")
 } else {
  dm.push("No computable: sin módulos con deuda sobre el umbral (ver \`derived.waves\` en metrics.json).")
 }
 dm.push("")
} else {
 dm.push("## Dimensionamiento no computable")
 dm.push("")
 dm.push("La familia by-file no está disponible (" + mdCell(derived.causa) + "): sin SLOC medidos no hay KLOC, COCOMO, SQALE ni olas. Las familias independientes que sí corrieron siguen abajo; el juez audita este vacío como CONCERNS (familia degradada declarada).")
 dm.push("")
}
dm.push("## Autores y bus factor")
dm.push("")
if (derived.busFactor) {
 dm.push("Bus factor: **" + derived.busFactor.count + "** — autores necesarios para cubrir ≥50% del Code de los " + fmtInt(derived.busFactor.authorsConsidered) + " autores medidos" + (derived.busFactor.truncated ? " (top-100 truncado — cota sobre el subconjunto)" : "") + ".")
 dm.push("")
 dm.push("| Autor | Code | Complejidad | Archivos | % propiedad |")
 dm.push("| --- | --- | --- | --- | --- |")
 AU.rows.slice(0, 10).forEach(function (r1) {
  dm.push("| " + mdCell(r1.author) + " | " + fmtInt(r1.code) + " | " + fmtInt(r1.complexity) + " | " + fmtInt(r1.files) + " | " + fmt(r1.ownsPercent, 1) + "% |")
 })
} else {
 dm.push("No disponible (familia authors degradada — ver Degradaciones).")
}
dm.push("")
dm.push("## Hotspots (complejidad × churn)")
dm.push("")
if (HS) {
 dm.push("Top 10 de " + fmtInt(HS.total) + " archivos" + (HS.truncated ? " (CSV completo en artifacts/)" : "") + ":")
 dm.push("")
 dm.push("| Archivo | Complejidad | Commits | Autores | Score |")
 dm.push("| --- | --- | --- | --- | --- |")
 HS.rows.slice(0, 10).forEach(function (r2) {
  dm.push("| \`" + mdCell(r2.file) + "\` | " + fmtInt(r2.complexity) + " | " + fmtInt(r2.commits) + " | " + fmtInt(r2.authors) + " | " + fmtInt(r2.score) + " |")
 })
} else {
 dm.push("No disponible (familia hotspots degradada — ver Degradaciones).")
}
dm.push("")
dm.push("## Acoplamiento (co-cambio)")
dm.push("")
if (CO) {
 dm.push("Top 10 de " + fmtInt(CO.total) + " pares por grado:")
 dm.push("")
 dm.push("| Par | Co-cambios | Grado |")
 dm.push("| --- | --- | --- |")
 CO.rows.slice(0, 10).forEach(function (r3) {
  dm.push("| \`" + mdCell(r3.fileA) + "\` ↔ \`" + mdCell(r3.fileB) + "\` | " + fmtInt(r3.shared) + " | " + fmtInt(r3.degree) + " |")
 })
} else {
 dm.push("No disponible (familia coupling degradada — ver Degradaciones).")
}
dm.push("")
dm.push("## Duplicación")
dm.push("")
if (derived.duplication) {
 dm.push("- DRYness: " + (derived.duplication.drynessPercent !== null && derived.duplication.drynessPercent !== undefined ? fmt(derived.duplication.drynessPercent, 1) + "%" : "n/d") + " · ULOC: " + (derived.duplication.uloc !== null && derived.duplication.uloc !== undefined ? fmtInt(derived.duplication.uloc) : "n/d") + " (scc -a).")
} else {
 dm.push("No disponible (familia duplication degradada — ver Degradaciones).")
}
dm.push("")
dm.push("## Exclusiones aplicadas (volumen medido)")
dm.push("")
dm.push("| Qué | Tipo | Archivos | LOC |")
dm.push("| --- | --- | --- | --- |")
inv.exclusions.forEach(function (e1) {
 dm.push("| \`" + mdCell(e1.what) + "\` | " + mdCell(e1.kind) + " | " + fmtInt(e1.files) + " | " + fmtInt(e1.loc) + " |")
})
dm.push("")
if (inv.degradations.length) {
 dm.push("## Degradaciones (familias no disponibles)")
 dm.push("")
 inv.degradations.forEach(function (d2) {
  dm.push("- **" + mdCell(d2.familia) + "**: " + mdCell(d2.causa) + " — _hint: " + mdCell(d2.hint) + "_")
 })
 dm.push("")
}
dm.push("## Anexos interpretativos")
dm.push("")
if (inv.annexes.length) {
 inv.annexes.forEach(function (a1) {
  dm.push("- [" + a1.file.slice(ART.length + 1) + "](" + a1.file.slice(ART.length + 1) + ")")
 })
} else {
 dm.push("No generados — corte por tiempo antes de analyze. synthesize/judge corrieron sobre lo alcanzado (FR-11).")
}
dm.push("")
dm.push("## Cómo auditar")
dm.push("")
dm.push("- Toda cifra vive en \`artifacts/metrics.json\` (writer único) o se re-deriva con la fórmula declarada junto a ella (COCOMO en \`derived.cocomo\`, SQALE en \`derived.sqale\`, olas en \`derived.waves\`)")
dm.push("- La salida del workflow incluye el veredicto del juez detached (stage final), que muestrea estas cifras contra los archivos reales.")
dm.push("")
await writeText(ART + "/dimensionamiento.md", dm.join("\\n"))

// README.md — índice determinista de la corrida (D3): mismas fuentes que el
// informe; sin veredicto del juez (corre después y NO se escribe aquí).
const rd = []
rd.push("# Dimensionamiento — " + projectLabel)
rd.push("")
rd.push("> Índice de la corrida \`size-app\` (frida-size-app). FUENTE DE VERDAD: \`artifacts/metrics.json\`.")
rd.push("")
rd.push("## Documentos")
rd.push("")
rd.push("| Documento | Contenido |")
rd.push("| --- | --- |")
rd.push("| [dimensionamiento.md](dimensionamiento.md) | Informe: KLOC, COCOMO ±rango EAF, SQALE proxy, olas, hotspots |")
inv.annexes.forEach(function (a2) {
 rd.push("| [" + a2.file.slice(ART.length + 1) + "](" + a2.file.slice(ART.length + 1) + ") | Anexo interpretativo (" + a2.key + ") |")
})
rd.push("| [artifacts/metrics.json](artifacts/metrics.json) | Fuente de verdad numérica (writer único) |")
rd.push("")
rd.push("## Corrida")
rd.push("")
rd.push("- " + inv.run.startedAt + " → " + inv.run.finishedAt + " · wage " + currency + " " + fmt(wage, 2) + "/mes · COCOMO " + cocomoType)
rd.push("- scc " + (inv.run.sccVersion || "(no corrió)") + (inv.run.stoppedBy ? " · corte: " + inv.run.stoppedBy : ""))
rd.push("")
rd.push("## Familias")
rd.push("")
rd.push("| Familia | Estado |")
rd.push("| --- | --- |")
Object.keys(inv.families).forEach(function (k2) {
 const f1 = inv.families[k2]
 rd.push("| \`" + mdCell(k2) + "\` | " + (f1 && f1.status ? f1.status : "unknown") + " |")
})
if (inv.degradations.length) {
 rd.push("")
 rd.push(inv.degradations.length + " degradaciones registradas — detalle en [dimensionamiento.md](dimensionamiento.md#degradaciones-familias-no-disponibles).")
}
rd.push("")
rd.push("## Capacidades")
rd.push("")
rd.push("- scc: " + (inv.capabilities.scc ? "instalado al pin " + inv.capabilities.sccPin : "NO disponible") + " · git: " + (inv.capabilities.git ? "sí" : "no") + " · lizard: " + (inv.capabilities.lizard ? "sí" : "no") + " · lens: " + (inv.capabilities.lens ? "sí" : "no") + " · codebaseIndex: " + (inv.capabilities.codebaseIndex ? "sí" : "no"))
rd.push("")
await writeText(ART + "/README.md", rd.join("\\n"))
log("size-app: dimensionamiento.md + README.md sintetizados desde metrics.json")

// ── judge: auditor detached PASS/CONCERNS/FAIL (FR-10) ────────────────────
phase("judge")
// D11: la regla corte→CONCERNS vive DOS veces — prompt default (skills.ts,
// overrideable) y ESTE runtime block (incondicional — molde M9).
const judge = await agent(
 wkCtx(JUDGE, [
  "## Entregables a auditar (lee los archivos REALES)\\n- " + ART + "/dimensionamiento.md\\n- " + ART + "/README.md\\n- " + ART + "/artifacts/metrics.json (fuente de verdad)\\n- " + ART + "/artifacts/ (evidencia cruda: scc-by-file*.json, CSVs, lizard.csv)\\n- " + (inv.annexes.length ? inv.annexes.map(function (a3) { return a3.file }).join("\\n- ") : "(anexos NO generados: corte por tiempo antes de analyze)"),
  "## Contexto de corrida — REGLAS RUNTIME (sobreviven a overrides)\\nstoppedBy=" + JSON.stringify(inv.run.stoppedBy) + " · degradations=" + inv.degradations.length + " · maxMinutes=" + maxMinutes + "\\n- Corte por presupuesto de tiempo (stoppedBy=time) que truncó el alcance: CONCERNS, no FAIL — y nunca justifica auditar menos lo que SÍ se entregó.\\n- Familia degradada (degradations[] con causa declarada): CONCERNS.\\n- FAIL solo si una claim es falsa: cifra que no está en metrics.json ni se re-deriva, familia declarada sin sustento, tabla de exclusiones que miente sobre el volumen.",
 ]),
 { label: "judge", outputSchema: JUDGE_SCHEMA }
)
log("size-app: judge=" + judge.decision + " findings=" + (judge.findings || []).length)

// Checkpoint final SOLO si review=manual (FR-10) — el veredicto viaja en el
// return sin abortar la corrida (molde M1 e2e juez FAIL).
if (review === "manual") {
 const cp = await checkpoint({ name: "size-app-final", prompt: "Dimensionamiento listo en " + ART + " (" + (derived.computed ? fmt(derived.kloc, 1) + " KLOC efectivos, " : "") + inv.degradations.length + " degradaciones, " + inv.annexes.length + " anexos). Juez: " + judge.decision + " con " + (judge.findings || []).length + " findings. ¿Apruebas para terminar?", context: { dir: ART, kloc: derived.computed ? derived.kloc : null, degradations: inv.degradations.length, annexes: inv.annexes.length, judge: judge.decision, findings: (judge.findings || []).length } })
 if (cp !== "approved") throw new Error("size-app: checkpoint rechazado — workflow detenido")
}

return {
 pattern: "size-app",
 language: language,
 wage: wage,
 currency: currency,
 cocomoType: cocomoType,
 kloc: derived.computed ? derived.kloc : null,
 sqale: derived.computed ? derived.sqale.rating : null,
 cocomoRange: derived.computed ? { effortLow: derived.cocomo.rows[0].effort, effortHigh: derived.cocomo.rows[derived.cocomo.rows.length - 1].effort, costLow: derived.cocomo.rows[0].cost, costHigh: derived.cocomo.rows[derived.cocomo.rows.length - 1].cost } : null,
 familiesOk: Object.keys(inv.families).filter(function (k3) { return inv.families[k3] && inv.families[k3].status === "ok" }).length,
 familiesTotal: Object.keys(inv.families).length,
 degradations: inv.degradations.length,
 exclusions: inv.exclusions.length,
 annexes: inv.annexes.length,
 stoppedBy: inv.run.stoppedBy,
 judge: judge,
 docs: { informe: ART + "/dimensionamiento.md", readme: ART + "/README.md", metrics: ART + "/artifacts/metrics.json" },
}
`;
}
