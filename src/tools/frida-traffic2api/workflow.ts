// frida-traffic2api — generador del script de workflow (issue #135, M9 Pista M).
//
// Genera el script JS determinista que corre en el sandbox de
// frida-extensible-workflows (agent/shell/parallel/checkpoint/phase/log).
// Los prompts (resueltos 3 capas por el resolver) se interpolan del lado del
// host; el script queda declarativo. Contrato de artefactos: los agentes
// ESCRIBEN a disco con sus tools de archivo y devuelven JSON (outputSchema) —
// la cadena de custodia es el filesystem (mismo contrato que M8/M1).
//
// Estructura del script generado (8 fases estrictamente secuenciales):
//   bootstrap  — determinista: mkdir -p de docs/api/**, gate de sesión viva
//                (modo walk, pin --session) O verificación+copia del HAR
//                externo (modo externo), sonda híbrida del moat (molde M1:
//                const CAPABILITIES + test -s del índice), sondas de docs
//                hermanos M8/M1 con degradaciones deterministas, fecha/epoch
//                vía shell (Date undefined). Sin agente LLM.
//   walk       — SOLO modo walk (la fase nace del phase() condicional, D10):
//                loop "script navega, agente decide" molde M8 con dos deltas:
//                captura HAR (salvage stop → network har start --content all
//                ANTES del open inicial → stop en try/finally con ruta
//                absoluta, D4) y epoch en cada actionLog/screen para el join
//                temporal pantalla↔petición (D5). Veto de irreversibles +
//                solo docs/api/** + seguridad HAR viven en
//                TRAFFIC2API_PREAMBLE (no-stage).
//   ingest     — determinista: carve `node` en el HOST (el sandbox no tiene
//                Date/require y shell>10MB mata): HAR crudo → requests.jsonl
//                + payloads.jsonl (delgados, una petición por línea, payload
//                acotado a 4 KB) + censo de dominios + join screenId por
//                epochs (timeline.json). Gate HAR vacío → error accionable
//                con el censo (NFR Reliability).
//   spec       — determinista: agregación OpenAPI 3.1 con paths colapsados
//                (numérico/UUID/ObjectId → {id}), TODOS los códigos observados
//                (4xx/5xx incluidos — documenta la API real), ejemplo de
//                request payload primero no-vacío scrubbeado, tabla delgada
//                endpoints.json con IDs estables E01.. Gate de forma
//                post-escritura (openapi 3.1/paths/operaciones). El archivo
//                lo escribe el helper node directamente (desviación de
//                "writeText heredoc" evaluada aceptable por slice-verifier:
//                preserva el invariante "puede pesar lo que pese, nunca por
//                stdout de vuelta" — el JSON ni siquiera pasa por el sandbox).
//   graph      — determinista desde la evidencia en disco (steps propios o
//                inventory de M8 en modo externo, req 12): nodos, aristas
//                traversed/attempted-failed (3 causas)/discovered (refs no
//                consumidas per-screen), frontera con MOTIVO (req 13),
//                errores por nodo citando step+archivo (req 15) →
//                nav-graph.json + navegacion.md (mermaid + tabla de frontera).
//                UN agente boundary clasifica las aristas descubiertas
//                (req 16) solo si existen.
//   matrix     — prep determinista de rutas CANDIDATAS de zona muerta (grep
//                multi-framework + semilla M1, D9) → 1 agente correlacionador
//                con moat: matriz funcionalidad↔endpoint↔módulo, huérfanos
//                bidireccionales, zona muerta calificada con evidencia
//                file:line. Degradación a endpoint↔módulo sin docs M8.
//   synthesize — determinista: matriz.md + README.md desde el MISMO
//                inventario serializado (writer único) + veredicto de
//                cobertura determinista (molde m4m5Verdict de M1).
//   judge      — auditor detached PASS/CONCERNS/FAIL contra artefactos
//                reales + bloque Contexto de corte con degradations=N (D10)
//                + checkpoint final opcional (review manual).
//
// Modos mutuamente excluyentes (D2): walk {url, maxScreens, ...} / externo
// {harPath, ...} — validados eager con errores que instruyen el flujo.
//
// El inventario (docs/api/artifacts/inventory.json) es el registro auditable
// híbrido M8+M1: run/capabilities/tools/degradations/siblings/screens/
// actionLog/endpoints/thirdParty/matrix/orphans/deadZone/graph/stoppedBy.

import type { ResolvedTraffic2ApiStage } from "./resolver";
import {
 DEFAULT_ARTIFACT_LANGUAGE,
 DEFAULT_SESSION_NAME,
 TRAFFIC2API_ARTIFACTS_DIR,
 TRAFFIC2API_PREAMBLE,
 type Traffic2ApiStage,
} from "./skills";

// ── Args (D2: modos mutuamente excluyentes) ────────────────────────────────

/** Args del modo walk: el workflow navega la app y graba el HAR. */
export interface Traffic2ApiWalkArgs {
 mode: "walk";
 /** URL base de la app (requerida). */
 url: string;
 /** Tope de pantallas únicas: 0 = "todo" (sin tope). Requerido (espejo M8 D4). */
 maxScreens: number;
 /** Backstop wall-clock en minutos: 0 = sin tope. Corta el walk, no los entregables. */
 maxMinutes: number;
 /** Nombre de la sesión pre-autenticada (pin --session). */
 session: string;
 /** Idioma (BCP-47) de los entregables. */
 language: string;
 review: "manual" | "auto";
}

/** Args del modo externo: ingiere un HAR ya capturado (devtools/mitmproxy). */
export interface Traffic2ApiExternalArgs {
 mode: "externo";
 /** Ruta al archivo HAR (absoluta o relativa al cwd del repo). */
 harPath: string;
 /** Backstop wall-clock en minutos: 0 = sin tope (sin efecto sin walk). */
 maxMinutes: number;
 /** Idioma (BCP-47) de los entregables. */
 language: string;
 review: "manual" | "auto";
}

export type Traffic2ApiArgs = Traffic2ApiWalkArgs | Traffic2ApiExternalArgs;

/**
 * Capacidades del moat detectadas host-side en launch (D3, molde M1): la
 * resolución flag→factory vive en el motor; el generador solo recibe el
 * resultado como datos declarativos (JSON-safe) y lo interpola al sandbox.
 */
export interface Traffic2ApiCapabilities {
 /** pi-lens instalado (existsSync de la entry, misma sonda que pi-session). */
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

function parseMaxMinutes(
 record: Record<string, unknown>,
 pattern: string,
): number {
 if (
  record.maxMinutes !== undefined &&
  (typeof record.maxMinutes !== "number" ||
   !Number.isInteger(record.maxMinutes) ||
   record.maxMinutes < 1 ||
   record.maxMinutes > 240)
 ) {
  throw new Error(
   `Patrón "${pattern}": args.maxMinutes debe ser entero 1-240 (minutos) u omitirse.`,
  );
 }
 return (record.maxMinutes as number | undefined) ?? 0;
}

/**
 * Validación eager de modos excluyentes (D2, molde validateAppWalkthroughArgs
 * app-walkthrough/workflow.ts:93). maxScreens es requerido A PROPÓSITO en
 * walk (espejo M8 D4): la corrida es desatendida tras el launch, así que el
 * presupuesto se pregunta ANTES y llega ya resuelto en args. Mezclar u
 * omitir url/harPath falla con un error que INSTRUYE el flujo correcto.
 */
export function validateTraffic2ApiArgs(args: unknown): Traffic2ApiArgs {
 const record = asRecord(args);
 const hasUrl = typeof record.url === "string" && record.url.trim() !== "";
 const hasHarPath =
  typeof record.harPath === "string" && record.harPath.trim() !== "";
 if (hasUrl && hasHarPath) {
  throw new Error(
   'Patrón "traffic2api": args.url y args.harPath son MUTUAMENTE EXCLUYENTES. Elige UN modo: walk (args.url + args.maxScreens — el workflow navega la app y graba el HAR) o externo (args.harPath — ingiere un HAR ya capturado con devtools/mitmproxy).',
  );
 }
 if (!hasUrl && !hasHarPath) {
  throw new Error(
   'Patrón "traffic2api": falta el origen del tráfico. Pasa args.url (modo walk: el workflow navega la app y graba el HAR) O args.harPath (modo externo: ruta a un HAR ya capturado).',
  );
 }
 if (hasUrl) {
  if (record.maxScreens === undefined) {
   throw new Error(
    'Patrón "traffic2api": falta args.maxScreens (entero 0-200; 0 = "todo"). Pregunta el presupuesto al usuario con ask_user_question en la sesión principal ANTES de lanzar (opciones: "30 pantallas", "todo" (= 0), o un número propio) y relanza el workflow con el valor resuelto — tras el launch la corrida es desatendida y no puede preguntar.',
   );
  }
  if (
   typeof record.maxScreens !== "number" ||
   !Number.isInteger(record.maxScreens) ||
   record.maxScreens < 0 ||
   record.maxScreens > 200
  ) {
   throw new Error(
    'Patrón "traffic2api": args.maxScreens debe ser entero 0-200 (0 = sin tope).',
   );
  }
  return {
   mode: "walk",
   url: record.url as string,
   maxScreens: record.maxScreens,
   maxMinutes: parseMaxMinutes(record, "traffic2api"),
   session: optionalString(record, "session") ?? DEFAULT_SESSION_NAME,
   language: optionalString(record, "language") ?? DEFAULT_ARTIFACT_LANGUAGE,
   review: parseReview(record, "traffic2api"),
  };
 }
 return {
  mode: "externo",
  harPath: (record.harPath as string).trim(),
  maxMinutes: parseMaxMinutes(record, "traffic2api"),
  language: optionalString(record, "language") ?? DEFAULT_ARTIFACT_LANGUAGE,
  review: parseReview(record, "traffic2api"),
 };
}

// ── Constantes interpoladas ────────────────────────────────────────────────

/** Catálogo declarativo del moat (10 tools) — molde MOAT_TOOL_CATALOG M1. */
const MOAT_TOOL_CATALOG: ReadonlyArray<{
 name: string;
 extension: "pi-lens" | "frida-codebase-index";
}> = [
 { name: "project_report", extension: "pi-lens" },
 { name: "symbol_search", extension: "pi-lens" },
 { name: "module_report", extension: "pi-lens" },
 { name: "read_symbol", extension: "pi-lens" },
 { name: "semantic_context", extension: "frida-codebase-index" },
 { name: "semantic_search", extension: "frida-codebase-index" },
 { name: "call_graph", extension: "frida-codebase-index" },
 { name: "implementation_lookup", extension: "frida-codebase-index" },
 { name: "index_codebase", extension: "frida-codebase-index" },
 { name: "index_status", extension: "frida-codebase-index" },
];

/**
 * Patrones de registro de rutas por framework (D9): la capa determinista de
 * matrix siembra las rutas CANDIDATAS de zona muerta. Todos con
 * --exclude-dir de node_modules/.git/docs (los docs hermanos citan rutas de
 * ejemplo que contaminarían el censo) y acotados con head -c (stdout >10 MB
 * mata el proceso llamador).
 */
const FRAMEWORK_ROUTE_PATTERNS: ReadonlyArray<{ name: string; cmd: string }> = [
 {
  name: "Express (app.METHOD / router.METHOD)",
  cmd: 'grep -rEn --include="*.js" --include="*.ts" --include="*.mjs" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs "app\\.(get|post|put|patch|delete)\\(|router\\.(get|post|put|patch|delete)\\(" .',
 },
 {
  name: "Flask (@app.route / @blueprint.route)",
  cmd: 'grep -rEn --include="*.py" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs "@(app|blueprint|bp)\\.route\\(" .',
 },
 {
  name: "Django (path( / re_path( en urls.py)",
  cmd: 'grep -rEn --include="urls.py" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs "(path|re_path)\\(" .',
 },
 {
  name: "Spring (@GetMapping / @PostMapping / @RequestMapping)",
  cmd: 'grep -rEn --include="*.java" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs "@(Get|Post|Put|Patch|Delete|Request)Mapping" .',
 },
 {
  name: "FastAPI (@app.get / @router.get)",
  cmd: 'grep -rEn --include="*.py" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs "@(app|router|api)\\.(get|post|put|patch|delete)\\(" .',
 },
 {
  name: "Laravel (Route::get / Route::post)",
  cmd: 'grep -rEn --include="*.php" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs "Route::(get|post|put|patch|delete|any)\\(" .',
 },
 {
  name: "Next.js (app/api/*/route.* / pages/api/*)",
  cmd: 'find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./docs -prune -o -type f \\( -path "*/app/api/*/route.*" -o -path "*/pages/api/*" \\) -print',
 },
];

/**
 * Carve del HAR (D6): corre en el HOST vía `node` desde shell() — el sandbox
 * no tiene Date ni require y un JSON.parse de un HAR de 40 MB rebasa el heap
 * de 128 MB; node está garantizado porque Frida corre sobre Node. Lee el HAR
 * de disco, escribe requests.jsonl + payloads.jsonl (delgados) y devuelve
 * SOLO un resumen JSON delgado por stdout (conteos + censo de dominios).
 * NUNCA extrae headers (garantía estructural: nada de autorización sale del
 * HAR) y acota los payloads a 4 KB.
 */
const HAR_CARVE_SOURCE = String.raw`"use strict";
const fs = require("fs");
const a = process.argv.slice(2);
const harPath = a[0], outReq = a[1], outPay = a[2], timelinePath = a[3], appOriginArg = a[4] || "";
const har = JSON.parse(fs.readFileSync(harPath, "utf8"));
const entries = har && har.log && Array.isArray(har.log.entries) ? har.log.entries : [];
let timeline = [];
try { const t = JSON.parse(fs.readFileSync(timelinePath, "utf8")); if (Array.isArray(t)) timeline = t; } catch (e) { timeline = []; }
// Join temporal (D5): epoch(petición) ∈ [epoch(N), epoch(N+1)) → screenId
// del paso N (la acción N y su resultado pertenecen a la pantalla origen N);
// el burst de hidratación previo a la primera acción → primera pantalla.
function screenFor(epoch) {
  if (!timeline.length) return "";
  if (epoch < timeline[0].epoch) return timeline[0].screenId;
  let sid = "";
  for (let i = 0; i < timeline.length; i++) { if (timeline[i].epoch <= epoch) sid = timeline[i].screenId; else break; }
  return sid;
}
const originCount = {};
let parsed = 0;
for (const e of entries) {
  try { const u = new URL(e.request.url); originCount[u.origin] = (originCount[u.origin] || 0) + 1; parsed++; } catch (err) {}
}
// Externo sin origin explícito: el más frecuente (determinista: conteo desc, luego alfabético).
let appOrigin = appOriginArg;
if (!appOrigin) {
  const ranked = Object.keys(originCount).sort(function (x, y) { return originCount[y] - originCount[x] || (x < y ? -1 : 1); });
  appOrigin = ranked[0] || "";
}
const reqLines = [];
const payLines = [];
let matched = 0, screenless = 0, idx = 0;
for (const e of entries) {
  let u; try { u = new URL(e.request.url) } catch (err) { continue }
  idx++;
  const dt = Date.parse(e.startedDateTime || "");
  const epoch = isNaN(dt) ? 0 : Math.floor(dt / 1000);
  const screenId = screenFor(epoch);
  if (screenId) matched++; else screenless++;
  if (u.origin !== appOrigin) continue;
  const status = e.response && typeof e.response.status === "number" ? e.response.status : 0;
  const mime = e.response && e.response.content && e.response.content.mimeType ? String(e.response.content.mimeType) : "";
  reqLines.push(JSON.stringify({ i: idx, startedDateTime: e.startedDateTime || "", startedEpoch: epoch, method: String(e.request.method || ""), url: u.origin + u.pathname, origin: u.origin, path: u.pathname, status: status, mimeType: mime, screenId: screenId }));
  const body = e.request && e.request.postData && typeof e.request.postData.text === "string" ? e.request.postData.text : "";
  if (body) payLines.push(JSON.stringify({ i: idx, method: String(e.request.method || ""), path: u.pathname, body: body.slice(0, 4096) }));
}
fs.writeFileSync(outReq, reqLines.length ? reqLines.join("\n") + "\n" : "");
fs.writeFileSync(outPay, payLines.length ? payLines.join("\n") + "\n" : "");
const origins = Object.keys(originCount).map(function (o) { return { origin: o, count: originCount[o] }; }).sort(function (x, y) { return y.count - x.count || (x.origin < y.origin ? -1 : 1); });
process.stdout.write(JSON.stringify({ appOrigin: appOrigin, total: entries.length, parsed: parsed, sameOrigin: reqLines.length, thirdPartyCount: parsed - reqLines.length, origins: origins, matched: matched, screenless: screenless }));
`;

/**
 * Agregador OpenAPI (D7): corre en el HOST vía `node`. Lee requests.jsonl +
 * payloads.jsonl de disco y escribe openapi.json + endpoints.json (tabla
 * delgada con pantallas por endpoint) directamente — la desviación del
 * "writeText heredoc" de D7 es deliberada y evaluada aceptable por el
 * slice-verifier: el helper escribe el archivo él mismo, sin cotas de tamaño
 * en ningún punto del pipeline (el JSON jamás entra al sandbox); writeText
 * queda para .md/inventario/helpers (escala KB). Paths colapsados (numérico,
 * UUID, ObjectId 24-hex → {id}), TODOS los códigos observados (4xx/5xx
 * incluidos), ejemplo de request payload primero no-vacío con scrub
 * determinista de secretos (el walk nunca hace login, pero un HAR externo
 * puede traerlos).
 */
const SPEC_BUILDER_SOURCE = String.raw`"use strict";
const fs = require("fs");
const a = process.argv.slice(2);
const reqPath = a[0], payPath = a[1], outSpec = a[2], outTable = a[3], appOrigin = a[4] || "";
const SECRET_KEY = /^(authorization|token|password|secret|api[-_]?key|cookie|session)$/i;
// Scrub determinista de secretos en ejemplos (NFR Security): claves
// sospechosas → "[REDACTADO]", recursivo en objetos anidados.
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = SECRET_KEY.test(k) ? "[REDACTADO]" : scrub(v[k]);
    return out;
  }
  return v;
}
function collapse(pathname) {
  const segs = String(pathname || "").split("/");
  const out = [];
  for (const seg of segs) {
    if (/^\d+$/.test(seg)) out.push("{id}");
    else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) out.push("{id}");
    else if (/^[0-9a-f]{24}$/i.test(seg)) out.push("{id}");
    else out.push(seg);
  }
  return out.join("/");
}
function readJsonl(p) {
  try {
    const text = fs.readFileSync(p, "utf8");
    if (!text.trim()) return [];
    return text.trim().split("\n").map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
const reqs = readJsonl(reqPath);
const pays = readJsonl(payPath);
const exampleByOp = {};
for (const p0 of pays) {
  const key = String(p0.method || "").toUpperCase() + " " + collapse(p0.path);
  if (!exampleByOp[key] && p0.body) exampleByOp[key] = p0.body;
}
const groups = {};
for (const r0 of reqs) {
  const method = String(r0.method || "").toUpperCase();
  const key = method + " " + collapse(r0.path);
  if (!groups[key]) groups[key] = { method: method, path: collapse(r0.path), count: 0, statuses: {}, statusMimes: {}, screens: [] };
  const g = groups[key];
  g.count++;
  const st = String(r0.status || 0);
  g.statuses[st] = (g.statuses[st] || 0) + 1;
  if (!g.statusMimes[st]) g.statusMimes[st] = {};
  const mm = String(r0.mimeType || "");
  if (mm) g.statusMimes[st][mm] = (g.statusMimes[st][mm] || 0) + 1;
  if (r0.screenId && g.screens.indexOf(r0.screenId) === -1) g.screens.push(r0.screenId);
}
const keys = Object.keys(groups).sort(function (x, y) {
  return groups[y].count - groups[x].count || (x < y ? -1 : 1);
});
const TABLE_CAP = 400;
const paths = {};
const table = [];
let ops = 0, withBody = 0, truncated = false;
keys.forEach(function (key, i) {
  const g = groups[key];
  const m = g.method.toLowerCase();
  if (!paths[g.path]) paths[g.path] = {};
  const responses = {};
  Object.keys(g.statuses).sort(function (x, y) { return g.statuses[y] - g.statuses[x] || (x < y ? -1 : 1); }).forEach(function (st) {
    const mimes = g.statusMimes[st] || {};
    const top = Object.keys(mimes).sort(function (x, y) { return mimes[y] - mimes[x]; })[0] || "";
    const r = { description: "observado " + g.statuses[st] + " vez/veces" };
    if (top) r.content = {};
    if (top) r.content[top] = {};
    responses[st === "0" ? "default" : st] = r;
  });
  const op = { summary: g.count + " llamada(s) observada(s)", responses: responses };
  const ex = exampleByOp[key];
  if (ex) {
    withBody++;
    let parsedBody = null;
    try { parsedBody = JSON.parse(ex); } catch (e) { parsedBody = null; }
    op.requestBody = { content: { "application/json": { example: parsedBody !== null ? scrub(parsedBody) : "[REDACTADO-por-seguridad]" } } };
  }
  paths[g.path][m] = op;
  ops++;
  if (i < TABLE_CAP) table.push({ method: g.method, path: g.path, count: g.count, statuses: Object.keys(g.statuses).sort(), screens: g.screens, hasPayload: !!ex });
  else truncated = true;
});
const spec = {
  openapi: "3.1.0",
  info: {
    title: appOrigin || "API observada",
    version: "0.1.0-observada",
    description: "Spec derivada DETERMINISTAMENTE del tráfico observado por traffic2api (frida-traffic2api). Documenta lo observado — errores 4xx/5xx incluidos; NO es una spec autorativa ni infiere schemas de ejemplos. Los ejemplos de payload están scrubbeados de secretos.",
  },
  servers: appOrigin ? [{ url: appOrigin }] : [],
  paths: paths,
};
fs.writeFileSync(outSpec, JSON.stringify(spec, null, 2) + "\n");
fs.writeFileSync(outTable, JSON.stringify(table, null, 2) + "\n");
process.stdout.write(JSON.stringify({ paths: Object.keys(paths).length, operations: ops, withRequestBody: withBody, endpoints: table.length, truncated: truncated }));
`;

/** Gate de forma de openapi.json (D7 capa 1, molde readLedger frida-aidd). */
const OPENAPI_GATE_SOURCE = String.raw`"use strict";
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (j.openapi !== "3.1.0") throw new Error("openapi != 3.1.0: " + String(j.openapi));
const p = Object.keys(j.paths || {});
if (!p.length) throw new Error("sin paths");
let ops = 0;
for (const k of p) ops += Object.keys(j.paths[k]).length;
if (!ops) throw new Error("sin operaciones");
console.log(JSON.stringify({ paths: p.length, ops: ops }));
`;

/** Extractor de refs por paso (D8): snapshots → tabla delgada por stdout.
 *  Contrato REAL del binario (results/envelope.ts, verificado 0.33.1):
 *  data.refs es un MAPA { "e1": { name, role } } — keys SIN "@" (el "@"
 *  es solo el id de comando). Se tolera además el array [{ref,id},…].
 *  (Fix cascade ratificado en el checkpoint del Slice 5: sin esto, cada
 *  snapshot aportaba 0 refs con exit 0 → frontera silenciosamente vacía.) */
const REFS_BY_STEP_SOURCE = String.raw`"use strict";
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const out = {};
let files = [];
try { files = fs.readdirSync(dir).sort(); } catch (e) { files = []; }
function toRefList(refs) {
  const list = [];
  if (Array.isArray(refs)) {
    for (const r of refs) {
      const o = r && typeof r === "object" ? r : {};
      list.push({ ref: String(o.ref || o.id || ""), text: String(o.text || o.label || o.name || ""), role: String(o.role || ""), href: String(o.href || o.url || "") });
    }
  } else if (refs && typeof refs === "object") {
    for (const k of Object.keys(refs)) {
      const o = refs[k] && typeof refs[k] === "object" ? refs[k] : {};
      list.push({ ref: String(k), text: String(o.name || o.text || o.label || ""), role: String(o.role || ""), href: String(o.href || o.url || "") });
    }
  }
  return list.filter(function (r) { return r.ref; });
}
for (const f of files) {
  if (!/snapshot\.json$/.test(f)) continue;
  const step = f.slice(0, 3);
  if (!/^\d{3}$/.test(step)) continue;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const d = j && j.data;
    if (d && d.refs) out[step] = toRefList(d.refs);
  } catch (e) {}
}
console.log(JSON.stringify(out));
`;

/** Escape de backslash/backtick/${ para interpolar strings en template literal. */
function lit(value: string): string {
 return value
  .replaceAll("\\", "\\\\")
  .replaceAll("`", "\\`")
  .replaceAll("${", "\\${");
}

/** Emite las constantes de prompt del script (preamble no-stage + 4 stages). */
function stageConsts(stages: ResolvedTraffic2ApiStage[]): string {
 const preamble = `\t// Preamble no-stage (D11): veto de irreversibles + solo docs/api/** +\n\t// seguridad del HAR viven AQUÍ, fuera del mapa de stages — un override\n\t// 3-capas REEMPLAZA el prompt completo del stage y no puede tocar esto.\n\tconst PREAMBLE = \`${lit(TRAFFIC2API_PREAMBLE)}\`;`;
 const names: Record<string, Traffic2ApiStage> = {
  WALK: "walk",
  BOUNDARY: "boundary",
  MATRIX: "matrix",
  JUDGE: "judge",
 };
 const lines = Object.entries(names).map(([constName, stage]) => {
  const found = stages.find((s) => s.stage === stage);
  if (!found) {
   throw new Error(
    `frida-traffic2api: falta el stage '${stage}' en el resolver.`,
   );
  }
  return `\t// ${stage} — fuente del prompt: ${found.source}\n\tconst ${constName} = \`${lit(found.prompt)}\`;`;
 });
 return [preamble, ...lines].join("\n");
}

/**
 * Tope absoluto de pasos del loop walk (guard anti-loop-infinito, espejo M8):
 * 3 pasos por pantalla presupuestada, piso 30, tope 200 (modo "todo").
 */
function stepLimitFor(maxScreens: number): number {
 if (maxScreens <= 0) return 200;
 return Math.min(Math.max(30, maxScreens * 3), 200);
}

/** Genera el script del workflow `traffic2api`. */
export function generateTraffic2ApiWorkflow(
 stages: ResolvedTraffic2ApiStage[],
 args: Traffic2ApiArgs,
 capabilities: Traffic2ApiCapabilities,
): string {
 const runInfo =
  args.mode === "walk"
   ? {
      pattern: "traffic2api",
      mode: "walk",
      url: args.url,
      session: args.session,
      harPath: "",
      language: args.language,
      maxScreens: args.maxScreens,
      maxMinutes: args.maxMinutes,
      review: args.review,
     }
   : {
      pattern: "traffic2api",
      mode: "externo",
      url: "",
      session: "",
      harPath: args.harPath,
      language: args.language,
      maxScreens: null,
      maxMinutes: args.maxMinutes,
      review: args.review,
     };
 const stepLimit = stepLimitFor(args.mode === "walk" ? args.maxScreens : 0);
 return `// Patrón builtin: traffic2api (frida-traffic2api #135, M9 Pista M).
// Modo y args estructurales (mode/url/harPath/maxScreens/session) son CONST
// interpoladas host-side: ya fueron validados eager en resolve() y el script
// entero (fases condicionales, prompts, capacidades) se resolvió para ellos —
// un override runtime los invalidaría. Los escalares (maxMinutes/language/
// review) mantienen el canon defensivo del motor (EAGER + in-script).
const mode = ${JSON.stringify(args.mode)}
const url = ${JSON.stringify(args.mode === "walk" ? args.url : "")}
const harPath = ${JSON.stringify(args.mode === "externo" ? args.harPath : "")}
const maxScreens = ${JSON.stringify(args.mode === "walk" ? args.maxScreens : 0)}
const session = ${JSON.stringify(args.mode === "walk" ? args.session : "")}
const maxMinutes = (args && typeof args.maxMinutes === "number") ? args.maxMinutes : ${JSON.stringify(args.maxMinutes)}
const language = (args && args.language) || ${JSON.stringify(args.language)}
const review = (args && (args.review === "manual" || args.review === "auto")) ? args.review : ${JSON.stringify(args.review)}
const ART = ${JSON.stringify(TRAFFIC2API_ARTIFACTS_DIR)}
const STEP_LIMIT = ${JSON.stringify(stepLimit)}
const CAPABILITIES = ${JSON.stringify({ lens: capabilities.lens === true, codebaseIndex: capabilities.codebaseIndex === true })}
const TOOL_CATALOG = ${JSON.stringify(MOAT_TOOL_CATALOG)}
const CARVE_JS = ${JSON.stringify(HAR_CARVE_SOURCE)}
const SPEC_JS = ${JSON.stringify(SPEC_BUILDER_SOURCE)}
const OPENAPI_GATE_JS = ${JSON.stringify(OPENAPI_GATE_SOURCE)}
const REFS_JS = ${JSON.stringify(REFS_BY_STEP_SOURCE)}
const FW_PATTERNS = ${JSON.stringify(FRAMEWORK_ROUTE_PATTERNS)}
${stageConsts(stages)}
const WALK_SCHEMA = { type: "object", properties: { purpose: { type: "string" }, userRoles: { type: "array", items: { type: "string" } }, mainElements: { type: "array", items: { type: "string" } }, nextAction: { type: "object", properties: { kind: { type: "string", enum: ["click", "form", "validate", "goto", "done"] }, ref: { type: "string" }, url: { type: "string" }, fields: { type: "array", items: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } }, required: ["selector", "value"] } }, description: { type: "string" } }, required: ["kind", "description"] }, vetoed: { type: "array", items: { type: "string" } } }, required: ["purpose", "userRoles", "mainElements", "nextAction"] }
const BOUNDARY_SCHEMA = { type: "object", properties: { classifications: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, fromScreen: { type: "string" }, category: { type: "string", enum: ["duplicada", "externa", "destructiva-vetada", "requiere-datos", "desconocida"] }, evidence: { type: "string" }, note: { type: "string" } }, required: ["ref", "fromScreen", "category", "evidence"] } }, summary: { type: "string" } }, required: ["classifications", "summary"] }
const MATRIX_SCHEMA = { type: "object", properties: { matrix: { type: "array", items: { type: "object", properties: { functionality: { type: "string" }, screenIds: { type: "array", items: { type: "string" } }, endpoints: { type: "array", items: { type: "object", properties: { id: { type: "string" }, method: { type: "string" }, path: { type: "string" } }, required: ["method", "path"] } }, modules: { type: "array", items: { type: "object", properties: { path: { type: "string" }, evidence: { type: "string" } }, required: ["path"] } }, evidence: { type: "string" } }, required: ["endpoints"] } }, orphans: { type: "object", properties: { apiSinUi: { type: "array", items: { type: "object", properties: { method: { type: "string" }, path: { type: "string" }, note: { type: "string" } }, required: ["method", "path"] } }, uiSinCodigo: { type: "array", items: { type: "object", properties: { functionality: { type: "string" }, note: { type: "string" } }, required: ["functionality"] } } }, required: ["apiSinUi", "uiSinCodigo"] }, deadZone: { type: "array", items: { type: "object", properties: { path: { type: "string" }, method: { type: "string" }, status: { type: "string", enum: ["probablemente-viva", "candidata-real", "desconocida"] }, evidence: { type: "string" } }, required: ["path", "status"] } }, toolsUsed: { type: "array", items: { type: "string" } }, degradations: { type: "array", items: { type: "object", properties: { phase: { type: "string" }, tool: { type: "string" }, reason: { type: "string" }, workaround: { type: "string" }, evidence: { type: "string" } }, required: ["reason"] } }, summary: { type: "string" } }, required: ["matrix", "orphans", "deadZone", "summary"] }
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
// Writer determinista (D14): heredoc con fence-guard propio T2A_EOF — molde
// writeText de M8/frida-aidd. NADA más escribe los .md/inventario/helpers.
async function writeText(path, content) {
 let text = String(content)
 if (text.indexOf("T2A_EOF") >= 0) throw new Error("writeText: contenido no puede contener T2A_EOF: " + path)
 if (text.charAt(text.length - 1) !== "\\n") text = text + "\\n"
 await run("mkdir -p $(dirname " + path + ")")
 const r = await tryRun("cat > " + path + " << 'T2A_EOF'\\n" + text + "T2A_EOF")
 if (r.exitCode !== 0) throw new Error("writeText falló: " + path + " — " + String(r.stderr || "").slice(0, 500))
}

// Quoting shell POSIX para todo argumento con metacaracteres (D14).
function shq(value) {
 return "'" + String(value).replace(/'/g, "'\\\\''") + "'"
}

// Comandos agent-browser: pin --session explícito en TODOS y --json SIEMPRE
// (canon M8). Rutas absolutas AL DAEMON, relativas al filesystem local.
function ab(cmd) {
 return "agent-browser --session " + shq(session) + " " + cmd + " --json"
}
async function abRun(cmd) {
 const r = await shell(ab(cmd))
 let env = null
 try { env = JSON.parse(r.stdout) } catch (e) { env = null }
 if (r.exitCode !== 0 || !env || env.success !== true) {
  const detail = String((env && env.error && (env.error.message || env.error)) || r.stderr || r.stdout || "").slice(0, 300)
  throw new Error("agent-browser falló (" + cmd + "): exit=" + r.exitCode + " " + detail)
 }
 return env
}

// Contrato del binario (smoke + M8): get url/title devuelven data TIPADO.
function strData(env, key) {
 const d = env && env.data
 if (typeof d === "string") return d
 if (d && typeof d === "object" && typeof d[key] === "string") return d[key]
 return ""
}

// Slug ASCII [a-z0-9-] máx 24 (lesson d397401). Sin Intl en el sandbox.
function slug(title) {
 const ACC = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n" }
 let s = String(title || "").toLowerCase()
 let out = ""
 for (let i = 0; i < s.length; i++) { const c = ACC[s.charAt(i)]; out += (c || s.charAt(i)) }
 out = out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
 return out || "pantalla"
}

// Celda segura para tablas markdown.
function mdCell(value) {
 return String(value === null || value === undefined ? "" : value).replace(/\\|/g, "\\\\|")
}

// Origin canónico: URL sin fragment NI query (molde M8).
function canonOrigin(u) {
 return String(u || "").split("#")[0].split("?")[0]
}

// Origin del host desde una URL absoluta, sin URL global (sandbox): protocolo
// + autoridad = primeros 3 segmentos de "https://host/path".
function hostOrigin(u) {
 const parts = String(u || "").split("/")
 return parts.length >= 3 ? parts.slice(0, 3).join("/") : String(u || "")
}

// Etiqueta segura para aristas mermaid.
function mermaidSafe(value) {
 return String(value || "").replace(/["\\\\\\[\\]<>|\\n\\r]/g, " ").replace(/\\s+/g, " ").trim().slice(0, 40)
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

// ── Inventario híbrido M8+M1: writer único el script (registro auditable) ──
const inv = {
 run: Object.assign(${JSON.stringify(runInfo)}, { appOrigin: "", startedAt: "", startedAtEpoch: 0, finishedAt: "" }),
 capabilities: { lensAvailable: CAPABILITIES.lens, codebaseIndexAvailable: CAPABILITIES.codebaseIndex, indexPresent: false, indexStatus: "desconocido", embeddingsProvider: "" },
 tools: TOOL_CATALOG.map(function (t0) { return { name: t0.name, extension: t0.extension, available: t0.extension === "pi-lens" ? CAPABILITIES.lens : CAPABILITIES.codebaseIndex, usedCount: 0, phases: [], degraded: false } }),
 degradations: [],
 siblings: { funcional: false, entendimiento: false },
 screens: [],
 actionLog: [],
 endpoints: [],
 thirdParty: [],
 matrix: [],
 orphans: { apiSinUi: [], uiSinCodigo: [] },
 deadZone: [],
 graph: { source: "ninguno", nodes: [], edges: [], frontier: { motive: "no-derivable", hasFailedInteractions: false, discovered: 0 }, nodeErrors: {} },
 boundary: null,
 stoppedBy: "",
 stoppedByTime: false,
}
function invSerialize() {
 return JSON.stringify(inv, null, 2) + "\\n"
}
async function invWrite() {
 await writeText(ART + "/artifacts/inventory.json", invSerialize())
}

function toolByName(name) {
 for (let i = 0; i < inv.tools.length; i++) { if (inv.tools[i].name === String(name)) return inv.tools[i] }
 return null
}
function registerToolUse(names, phase) {
 asArray(names).forEach(function (n) {
  const t = toolByName(n)
  if (!t) return
  t.usedCount = t.usedCount + 1
  if (t.phases.indexOf(phase) === -1) t.phases.push(phase)
 })
}
function registerDegradations(list, phase) {
 asArray(list).forEach(function (d0) {
  if (!d0 || typeof d0 !== "object") return
  const d = { phase: String(d0.phase || phase), tool: String(d0.tool || ""), reason: String(d0.reason || ""), workaround: String(d0.workaround || ""), evidence: String(d0.evidence || "") }
  inv.degradations.push(d)
  const t = d.tool ? toolByName(d.tool) : null
  if (t) t.degraded = true
 })
}
function capabilitiesForPrompt() {
 const avail = inv.tools.filter(function (t) { return t.available }).map(function (t) { return t.name })
 const absent = inv.tools.filter(function (t) { return !t.available }).map(function (t) { return t.name })
 return JSON.stringify(inv.capabilities, null, 2) + "\\nTools disponibles: " + (avail.join(", ") || "(ninguna)") + "\\nTools NO disponibles: " + (absent.join(", ") || "(ninguna)")
}

log("traffic2api: modo=" + mode + (mode === "walk" ? " url=" + url + " [maxScreens=" + (maxScreens === 0 ? "todo" : maxScreens) + "]" : " harPath=" + harPath) + (maxMinutes > 0 ? " maxMinutes=" + maxMinutes : ""))

// ── bootstrap (determinista) ───────────────────────────────────────────────
phase("bootstrap")
// mkdir -p de TODOS los directorios AL ARRANQUE (lesson bffd6f1).
await run("mkdir -p " + ART + "/artifacts/steps " + ART + "/screenshots")
const HAR_REL = ART + "/artifacts/raw.har"
if (mode === "walk") {
 // Gate de sesión viva (molde M8 D12): si el nombre pinneado no está
 // activo, el error instruye cómo pre-autenticar desde la sesión principal.
 try {
  await abRun("get url")
 } catch (e) {
  throw new Error("traffic2api: la sesión de navegador '" + session + "' no está viva. Autentica primero desde la sesión principal con agent_browser({args: [\\"--session\\", \\"" + session + "\\", \\"open\\", \\"" + url + "\\"]}) (o el comando agent-browser equivalente) y RELANZA este workflow. Detalle: " + String(e.message).slice(0, 200))
 }
} else {
 // Modo externo (R4): el HAR se verifica y se copia SIN abrir navegador.
 const hp = harPath.charAt(0) === "/" ? harPath : ((await run("pwd")).trim() + "/" + harPath)
 const hg = await shell("test -s " + shq(hp))
 if (hg.exitCode !== 0) throw new Error("traffic2api: no puedo leer el HAR externo '" + harPath + "' (test -s falló — ¿ruta abs/relativa al cwd del repo correcta? ¿archivo vacío?).")
 await run("cp " + shq(hp) + " " + shq(HAR_REL))
}
// Lesson daemon-cwd (30ef616): todo path que se pasa AL DAEMON va absoluto.
const runDir = (await run("pwd")).trim()
const harAbs = runDir + "/" + HAR_REL
inv.run.startedAt = (await run("date '+%Y-%m-%d %H:%M:%S %z'")).trim()
inv.run.startedAtEpoch = await epochNow()
const deadline = maxMinutes > 0 ? inv.run.startedAtEpoch + maxMinutes * 60 : 0
// Sonda híbrida del moat (D10, molde M1): mitad shell (presencia física del
// índice), mitad const CAPABILITIES interpolada host-side en launch.
inv.capabilities.indexPresent = (await shell("test -s .codebase-index/index/codebase.db")).exitCode === 0
if (!CAPABILITIES.codebaseIndex) {
 registerDegradations([{ phase: "bootstrap", tool: "index_codebase", reason: "frida-codebase-index no disponible en las sesiones hijas (CAPABILITIES.codebaseIndex=false)", workaround: "verifica instalación/pin y el toggle frida.codebaseIndex.enabled", evidence: "const CAPABILITIES interpolada host-side en launch" }], "bootstrap")
}
// Hermanos (D10): estado del repo → test -s in-sandbox (sobrevive resume).
inv.siblings.funcional = (await shell("test -s docs/funcional/catalogo-pantallas.md || test -s docs/funcional/artifacts/inventory.json")).exitCode === 0
inv.siblings.entendimiento = (await shell("test -s docs/entendimiento/artifacts/inventory.json")).exitCode === 0
if (!inv.siblings.funcional) {
 registerDegradations([{ phase: "matrix", reason: "sin docs/funcional (M8): la matriz degrada a endpoint↔módulo (sin columna de funcionalidad groundeada) y el walk navega sin catálogo", workaround: "corre el patrón app-walkthrough (M8) para generar docs/funcional/", evidence: "test -s docs/funcional/... en bootstrap" }], "bootstrap")
}
if (!inv.siblings.entendimiento) {
 registerDegradations([{ phase: "matrix", reason: "sin docs/entendimiento (M1): zona muerta sin semilla components[] (queda grep multi-framework)", workaround: "corre el patrón understand-app (M1) para generar docs/entendimiento/", evidence: "test -s docs/entendimiento/artifacts/inventory.json en bootstrap" }], "bootstrap")
}
let m8CatalogHead = ""
if (inv.siblings.funcional) {
 m8CatalogHead = outOf(await tryRun("head -c 12000 docs/funcional/catalogo-pantallas.md")) || outOf(await tryRun("head -c 12000 docs/funcional/artifacts/inventory.json"))
}
await invWrite()

// ── walk: solo modo walk (la fase nace del phase() condicional, D10) ──────
let steps = 0
if (mode !== "walk") {
 log("traffic2api: modo externo — fase walk omitida (HAR: " + harPath + ")")
} else {
 phase("walk")
 // D4: salvage stop defensivo ANTES del start — recupera capturas huérfanas
 // de corridas muertas (tryRun: fallar aquí es lo esperado).
 await tryRun(ab("network har stop " + shq(harAbs)))
 // D4: start tras el gate de sesión viva (bootstrap) y ANTES del open
 // inicial — el burst XHR de hidratación de la primera pantalla es parte
 // de la API real. --content all: la spec necesita request payloads.
 await abRun("network har start --content all")
 let done = false
 let walkError = null
 try {
  await abRun("open " + shq(url))
  await tryRun(ab("wait --load domcontentloaded"))
  while (!done) {
   steps = steps + 1
   const stepTag = ("00" + steps).slice(-3)

   // 1. Snapshot de la pantalla actual → disco + cuerpo a11y para el prompt.
   const snapPath = ART + "/artifacts/steps/" + stepTag + "-snapshot.json"
   const snapR = await shell(ab("snapshot -i") + " > " + snapPath)
   if (snapR.exitCode !== 0) throw new Error("traffic2api: snapshot falló en paso " + steps + " — " + String(snapR.stderr || "").slice(0, 300) + " (¿sigue viva la sesión '" + session + "'?)")
   const snapText = await run("head -c 24000 " + snapPath)
   let snapForPrompt = snapText
   try {
    const snapFull = await run("cat " + snapPath)
    const sj = JSON.parse(snapFull)
    if (sj && sj.data && typeof sj.data.snapshot === "string") {
     snapForPrompt = sj.data.snapshot + "\\n\\n## Refs\\n" + JSON.stringify(sj.data.refs)
    } else if (sj && sj.data) {
     snapForPrompt = JSON.stringify(sj.data).slice(0, 24000)
    }
   } catch (e2) { snapForPrompt = snapText }

   // 2. Identidad de la pantalla + dedup por origin canónico (molde M8).
   const urlR = await abRun("get url")
   const titleR = await abRun("get title")
   const origin = strData(urlR, "url")
   const title = strData(titleR, "title")
   const canon = canonOrigin(origin)
   let screen = null
   for (let si = 0; si < inv.screens.length; si++) {
    if (inv.screens[si].canon === canon) { screen = inv.screens[si]; break }
   }
   const isNew = !screen

   // 3. Cortes de presupuesto ANTES de gastar LLM (D7 M8): maxMinutes
   // corta el walk, nunca los entregables.
   if (maxScreens > 0 && inv.screens.length >= maxScreens) { inv.stoppedBy = "budget"; break }
   if (deadline > 0 && (await epochNow()) >= deadline) { inv.stoppedBy = "time"; inv.stoppedByTime = true; break }
   if (steps >= STEP_LIMIT) { inv.stoppedBy = "stepLimit"; break }

   // 4. Registro de pantalla nueva: ID estable P01.. + screenshot + epoch
   // (D5: firstSeenEpoch alimenta el join temporal del carve).
   if (isNew) {
    const id = "P" + String(inv.screens.length + 1).padStart(2, "0")
    const shot = ART + "/screenshots/" + id + "-" + slug(title) + ".png"
    // Contrato del binario (COMMAND_REFERENCE): screenshot --full captura
    // la página COMPLETA — sin el flag sale sólo el viewport y la evidencia
    // queda recortada (defecto reportado en el piloto real de #135).
    const shotR = await tryRun(ab("screenshot --full " + shq(runDir + "/" + shot)))
    screen = { id: id, canon: canon, origin: origin, title: title, firstSeenStep: steps, firstSeenEpoch: await epochNow(), snapshot: snapPath, screenshot: shotR.exitCode === 0 ? shot : "", purpose: "", userRoles: [], mainElements: [], validationEvidence: [] }
    inv.screens.push(screen)
    if (shotR.exitCode !== 0) log("traffic2api: screenshot falló para " + id + " — el juez lo reportará")
    await invWrite()
   }

   // 5. UN agente por paso: interpreta y decide la siguiente acción.
   const interp = await agent(
    wkCtx(WALK, [
     "## Paso\\n" + steps + " de " + STEP_LIMIT + (deadline > 0 ? " (deadline epoch " + deadline + ")" : ""),
     "## Presupuesto\\n" + (maxScreens === 0 ? "sin tope de pantallas (modo \\"todo\\")" : inv.screens.length + "/" + maxScreens + " pantallas únicas registradas"),
     "## Pantalla actual\\n" + (isNew ? "NUEVA — registrada como " + screen.id : "ya registrada (" + screen.id + ")") + "\\norigin: " + origin + "\\ntítulo: " + title,
     "## Inventario de pantallas registradas\\n" + (inv.screens.map(function (s2) { return s2.id + " · " + s2.title + " · " + s2.canon }).join("\\n") || "(ninguna)"),
     inv.siblings.funcional ? "## Catálogo M8 (docs/funcional — pendientes = catálogo − inventario)\\n" + m8CatalogHead : "",
     "## Snapshot actual (truncado a 24 KB; completo en " + snapPath + " — la captura de tráfico la maneja el script)\\n" + snapForPrompt,
    ]),
    { label: "walk paso " + steps, outputSchema: WALK_SCHEMA }
   )

   if (isNew || !screen.purpose) {
    screen.purpose = String(interp.purpose || "")
    screen.userRoles = interp.userRoles || []
    screen.mainElements = interp.mainElements || []
   }

   // 6. Ejecutar la acción decidida. D5: epoch ANTES de ejecutar — el
   // carve atribuye cada petición ∈ [epoch(N), epoch(N+1)) al paso N.
   const act = (interp && interp.nextAction) || { kind: "done", description: "(sin acción)" }
   const actEpoch = await epochNow()
   let outcome = "ok"
   if (act.kind === "done") {
    inv.stoppedBy = "done"
    done = true
   } else {
    try {
     if (act.kind === "click") {
      await abRun("click " + shq(act.ref))
     } else if (act.kind === "goto") {
      await abRun("open " + shq(act.url))
     } else if (act.kind === "form" || act.kind === "validate") {
      const fields = act.fields || []
      for (let fi = 0; fi < fields.length; fi++) {
       await abRun("fill " + shq(fields[fi].selector) + " " + shq(fields[fi].value))
      }
      await abRun("click " + shq(act.ref))
      await tryRun(ab("wait --load domcontentloaded"))
      if (act.kind === "validate") {
       const valPath = ART + "/artifacts/steps/" + stepTag + "-validation.json"
       const valR = await shell(ab("snapshot -i") + " > " + valPath)
       if (valR.exitCode === 0) screen.validationEvidence.push(valPath)
      }
     } else {
      outcome = "unknown-kind:" + act.kind
     }
    } catch (e) {
     outcome = "fail: " + String(e.message).slice(0, 200)
    }
   }
   inv.actionLog.push({ step: steps, screenId: screen.id, kind: act.kind, description: act.description || "", ref: act.ref || "", url: act.url || "", outcome: outcome, epoch: actEpoch })
   await invWrite()
   if (act.kind !== "done") await tryRun(ab("wait --load domcontentloaded"))
  }
 } catch (e) {
  walkError = e
 } finally {
  // D4: stop SIEMPRE — cubre cortes budget/time/stepLimit/done y muertes
  // a mitad del loop. Ruta absoluta (contrato del binario: path en stop).
  const stopR = await tryRun(ab("network har stop " + shq(harAbs)))
  if (stopR.exitCode !== 0) log("traffic2api: network har stop falló — " + outOf(stopR).slice(0, 300))
 }
 // Gates test -s por escritor + reintento informado UNA vez (lessons d203630/619d9e7).
 const harGate = await shell("test -s " + shq(HAR_REL))
 if (harGate.exitCode !== 0) throw new Error("traffic2api: el HAR capturado está vacío o ausente (" + HAR_REL + "). ¿La app hizo peticiones durante el walk? ¿La grabación start/stop sobre la sesión '" + session + "' funcionó? (evidencia del walk: " + ART + "/artifacts/steps/)")
 if (walkError) throw walkError
 if (!inv.screens.length) throw new Error("traffic2api: la exploración no registró ninguna pantalla — revisa que la sesión '" + session + "' esté viva y que " + url + " cargue (evidencia: " + ART + "/artifacts/steps/001-snapshot.json)")
 log("traffic2api: walk terminó — " + inv.screens.length + " pantallas únicas en " + steps + " pasos; stoppedBy=" + JSON.stringify(inv.stoppedBy))
 await invWrite()
}

// ── ingest (determinista: carve node en el host, D6) ──────────────────────
phase("ingest")
// Timeline para el join temporal (D5): [{epoch, screenId}] en orden de pasos.
const timeline = inv.actionLog.filter(function (a0) { return a0.epoch > 0 }).map(function (a1) { return { epoch: a1.epoch, screenId: a1.screenId } })
await writeText(ART + "/artifacts/timeline.json", JSON.stringify(timeline))
await writeText(ART + "/artifacts/carve.js", CARVE_JS)
const carveRaw = await run("node " + shq(ART + "/artifacts/carve.js") + " " + shq(HAR_REL) + " " + shq(ART + "/artifacts/requests.jsonl") + " " + shq(ART + "/artifacts/payloads.jsonl") + " " + shq(ART + "/artifacts/timeline.json") + " " + shq(mode === "walk" ? hostOrigin(url) : ""))
let carve = null
try { carve = JSON.parse(carveRaw) } catch (e) { carve = null }
if (!carve) throw new Error("traffic2api: el carve del HAR falló (salida no-JSON de node). Inspecciona " + HAR_REL + " — ¿es un HAR 1.2 válido (devtools/mitmproxy)?")
inv.run.appOrigin = String(carve.appOrigin || "")
inv.thirdParty = asArray(carve.origins).filter(function (o0) { return o0 && o0.origin && o0.origin !== carve.appOrigin })
if (Number(carve.total) === 0) throw new Error("traffic2api: el HAR está vacío (0 entradas) — " + HAR_REL + " no contiene tráfico capturado. En modo walk revisa el start/stop; en externo revisa la exportación.")
const jsonlGate = await shell("test -s " + shq(ART + "/artifacts/requests.jsonl"))
if (jsonlGate.exitCode !== 0) {
 // NFR Reliability: error accionable con censo de dominios, no silencio.
 const census = asArray(carve.origins).map(function (o1) { return o1.origin + " (" + o1.count + ")" }).join(", ") || "(ninguna)"
 throw new Error("traffic2api: el HAR tiene " + carve.total + " entradas pero 0 same-origin para el origin de la app (" + carve.appOrigin + "). Censo de dominios: " + census + ". ¿Es un HAR de otra app/dominio? (walk: el origin se toma de args.url; externo: se usa el origin más frecuente)")
}
log("traffic2api: ingest — " + carve.sameOrigin + " same-origin de " + carve.total + " entradas; appOrigin=" + carve.appOrigin + "; screenId asignado a " + carve.matched + (mode === "walk" ? "" : " (modo externo: sin correlación de walk)"))
await invWrite()

// ── spec (determinista: openapi.json con paths colapsados, D7) ────────────
phase("spec")
await writeText(ART + "/artifacts/spec.js", SPEC_JS)
const specRaw = await run("node " + shq(ART + "/artifacts/spec.js") + " " + shq(ART + "/artifacts/requests.jsonl") + " " + shq(ART + "/artifacts/payloads.jsonl") + " " + shq(ART + "/openapi.json") + " " + shq(ART + "/artifacts/endpoints.json") + " " + shq(inv.run.appOrigin))
let spec = null
try { spec = JSON.parse(specRaw) } catch (e) { spec = null }
if (!spec) throw new Error("traffic2api: la agregación OpenAPI falló (salida no-JSON de node) — revisa " + ART + "/artifacts/requests.jsonl")
// Gate de forma post-escritura (D7 capa 1, molde readLedger frida-aidd).
const openapiGate = await tryRun("node -e " + shq(OPENAPI_GATE_JS) + " " + shq(ART + "/openapi.json"))
if (openapiGate.exitCode !== 0) throw new Error("traffic2api: openapi.json no pasó el gate de forma (openapi 3.1 / paths / operaciones): " + outOf(openapiGate).slice(0, 300))
// Tabla delgada → inventario con IDs estables E01.. (orden: llamadas desc).
const epRaw = await run("cat " + shq(ART + "/artifacts/endpoints.json"))
let epTable = null
try { epTable = JSON.parse(epRaw) } catch (e) { epTable = null }
if (!epTable || !epTable.length) throw new Error("traffic2api: endpoints.json vacío o corrupto tras la agregación — el carve reportó " + carve.sameOrigin + " peticiones same-origin")
inv.endpoints = epTable.map(function (e0, i) { return { id: "E" + String(i + 1).padStart(2, "0"), method: String(e0.method || ""), path: String(e0.path || ""), count: Number(e0.count) || 0, statuses: asArray(e0.statuses).map(String), screens: asArray(e0.screens).map(String), hasPayload: e0.hasPayload === true } })
log("traffic2api: spec OpenAPI — " + spec.paths + " paths / " + spec.operations + " operaciones; " + inv.endpoints.length + " endpoints" + (spec.truncated ? " (tabla truncada a 400 — degradación visible en endpoints.json)" : ""))
await invWrite()

// ── graph (determinista desde steps propios o M8; boundary agéntico, D8) ──
phase("graph")
let graphInv = inv
let graphSource = "propio"
if (mode !== "walk") {
 let m8Inv = null
 if (inv.siblings.funcional) {
  try {
   const m8Raw = await run("cat docs/funcional/artifacts/inventory.json")
   m8Inv = JSON.parse(m8Raw)
   if (!m8Inv || !Array.isArray(m8Inv.screens) || !Array.isArray(m8Inv.actionLog)) m8Inv = null
  } catch (e3) { m8Inv = null }
 }
 if (m8Inv) {
  graphInv = m8Inv
  graphSource = "m8"
  log("traffic2api: grafo derivado de docs/funcional (M8) — " + m8Inv.screens.length + " pantallas")
 } else {
  registerDegradations([{ phase: "graph", reason: "sin steps propios (modo externo) y sin inventory M8 legible: grafo de navegación no derivable", workaround: "corre app-walkthrough (M8) o usa el modo walk para obtener steps de navegación", evidence: "cat docs/funcional/artifacts/inventory.json falló o sin screens/actionLog" }], "graph")
 }
}
if (mode !== "walk" && graphSource !== "m8") {
 inv.graph = { source: "ninguno", nodes: [], edges: [], frontier: { motive: "no-derivable", hasFailedInteractions: false, discovered: 0 }, nodeErrors: {} }
 await writeText(ART + "/artifacts/nav-graph.json", JSON.stringify(inv.graph, null, 2))
 const ngGap = []
 ngGap.push("# Navegación — (no derivable)")
 ngGap.push("")
 ngGap.push("> Generada por traffic2api. FUENTE DE VERDAD: artifacts/nav-graph.json.")
 ngGap.push("")
 ngGap.push("**Gap conocido**: sin steps propios (modo externo) y sin docs/funcional (M8) legible — el grafo de navegación no es derivable. Corre app-walkthrough (M8) o el modo walk para obtener evidencia de navegación.")
 ngGap.push("")
 await writeText(ART + "/navegacion.md", ngGap.join("\\n"))
 log("traffic2api: grafo degradado (no derivable) — gap registrado en el inventario")
} else {
 const G = graphInv
 const stepsDir = graphSource === "m8" ? "docs/funcional/artifacts/steps" : (ART + "/artifacts/steps")
 // Refs por paso vía node (thin): el union cubre TODOS los snapshots del
 // canon (una pantalla revisitada aporta sus snapshots posteriores, D8).
 // NFR Reliability (corrección post-verifier): una falla del extractor NO
 // degrada en silencio a frontera vacía — se registra como degradación y
 // navegacion.md lo reporta como "no evaluable".
 const refsR = await tryRun("node -e " + shq(REFS_JS) + " " + shq(stepsDir))
 let refsByStep = {}
 let refsFailed = false
 if (refsR.exitCode !== 0) {
  refsFailed = true
 } else {
  try { refsByStep = JSON.parse(refsR.stdout || "{}") } catch (e4) { refsFailed = true }
 }
 if (refsFailed) {
  registerDegradations([{ phase: "graph", reason: "extracción de refs de snapshots falló: aristas descubiertas (frontera) no derivables", workaround: "revisa el formato de los *-snapshot.json (se espera envelope con data.refs — mapa {e1:{name,role}} o array)", evidence: "node -e REFS_JS exit=" + refsR.exitCode + " " + outOf(refsR).slice(0, 200) }], "graph")
 }
 const nodes = asArray(G.screens).map(function (s3) { return { id: String(s3.id || ""), title: String(s3.title || ""), canon: String(s3.canon || "") } })
 const screenAtStep = {}
 asArray(G.actionLog).forEach(function (a2) { screenAtStep[a2.step] = String(a2.screenId || "") })
 // Aristas traversed / attempted-failed (D8: join inter-pasos — outcome:"ok"
 // solo certifica el COMANDO, la navegación la certifica la progresión).
 const log3 = asArray(G.actionLog)
 const edges = []
 for (let i = 0; i < log3.length; i++) {
  const a = log3[i]
  const next = log3[i + 1] || null
  const progressed = !!(next && next.screenId !== a.screenId)
  const via = { kind: String(a.kind || ""), ref: String(a.ref || ""), description: String(a.description || "") }
  if (String(a.outcome || "").indexOf("fail:") === 0) {
   edges.push({ type: "attempted-failed", from: String(a.screenId || ""), to: progressed && next ? String(next.screenId) : "", via: via, step: a.step, cause: "shell-error", detail: String(a.outcome).slice(0, 200) })
  } else if (a.kind === "validate") {
   const evPath = stepsDir + "/" + ("00" + a.step).slice(-3) + "-validation.json"
   const evGate = await shell("test -s " + shq(evPath))
   edges.push({ type: "attempted-failed", from: String(a.screenId || ""), to: "", via: via, step: a.step, cause: "app-validation", detail: evGate.exitCode === 0 ? evPath : "(sin snapshot de validación)" })
  } else if ((a.kind === "click" || a.kind === "form") && !progressed) {
   edges.push({ type: "attempted-failed", from: String(a.screenId || ""), to: "", via: via, step: a.step, cause: "no-progression", detail: next ? "la pantalla no cambió tras la acción" : "última acción sin paso siguiente" })
  } else if ((a.kind === "click" || a.kind === "goto" || a.kind === "form") && progressed && next) {
   edges.push({ type: "traversed", from: String(a.screenId || ""), to: String(next.screenId), via: via, step: a.step })
  }
 }
 // Aristas discovered: refs presentes en snapshots NO consumidas por
 // ningún actionLog[].ref CON ESE screenId (consumo per-screen, D8).
 // Contrato real (envelope.ts): keys de data.refs SIN "@" ("e1") vs el
 // agente que refiere CON "@" ("@e1") — registrar ambas formas para que
 // el consumo matchee cualquiera de las dos convenciones (fix cascade
 // ratificado en el checkpoint del Slice 5).
 const consumedByScreen = {}
 asArray(G.actionLog).forEach(function (a3) {
  const sid = String(a3.screenId || "")
  const ref = String(a3.ref || "")
  if (!sid || !ref) return
  if (!consumedByScreen[sid]) consumedByScreen[sid] = {}
  consumedByScreen[sid][ref] = true
  if (ref.charAt(0) === "@") consumedByScreen[sid][ref.slice(1)] = true
  else consumedByScreen[sid]["@" + ref] = true
 })
 const seenDiscovered = {}
 const discoveredEdges = []
 Object.keys(refsByStep).sort().forEach(function (stepKey) {
  const sid = screenAtStep[Number(stepKey)] || ""
  if (!sid) return
  asArray(refsByStep[stepKey]).forEach(function (r1) {
   if (!r1 || typeof r1 !== "object") return
   const ref = String(r1.ref || "")
   if (!ref) return
   const key = sid + "·" + ref
   if (seenDiscovered[key]) return
   if (consumedByScreen[sid] && consumedByScreen[sid][ref]) return
   seenDiscovered[key] = true
   discoveredEdges.push({ from: sid, ref: ref, text: String(r1.text || ""), role: String(r1.role || ""), href: String(r1.href || "") })
  })
 })
 // Frontera con MOTIVO (R13/D8): interacción-no-lograda coexiste (propiedad
 // de aristas), no es exclusiva. Con done, la frontera restante se explica
 // por las clasificaciones del boundary (requiere-datos, vetada, ...).
 let motive = "agotamiento-real"
 if (graphSource === "m8") motive = "derivado-de-m8"
 else if (inv.stoppedBy === "budget" || inv.stoppedBy === "time" || inv.stoppedBy === "stepLimit") motive = "corte-presupuesto"
 const hasFailedInteractions = edges.some(function (e5) { return e5.type === "attempted-failed" })
 // Errores por nodo (R15): evidencia de validación + acciones fallidas,
 // citando step y archivo.
 const errByNode = {}
 asArray(G.screens).forEach(function (s4) {
  asArray(s4.validationEvidence).forEach(function (ev) {
   const sid = String(s4.id || "")
   if (!sid) return
   if (!errByNode[sid]) errByNode[sid] = []
   errByNode[sid].push({ kind: "validation", evidence: String(ev) })
  })
 })
 log3.forEach(function (a4) {
  if (String(a4.outcome || "").indexOf("fail:") !== 0) return
  const sid = String(a4.screenId || "")
  if (!sid) return
  if (!errByNode[sid]) errByNode[sid] = []
  errByNode[sid].push({ kind: "failed-action", step: a4.step, detail: String(a4.outcome).slice(0, 200), evidence: stepsDir + "/" + ("00" + a4.step).slice(-3) + "-snapshot.json" })
 })
 // Boundary (req 16): UN agente clasifica las descubiertas — solo si hay.
 let classifications = []
 let boundarySummary = ""
 if (discoveredEdges.length) {
  const frontierForPrompt = discoveredEdges.slice(0, 150)
  if (frontierForPrompt.length < discoveredEdges.length) log("traffic2api: frontera truncada a 150 de " + discoveredEdges.length + " para clasificación")
  const bRes = await agent(
   wkCtx(BOUNDARY, [
    "## Aristas descubiertas (frontera)\\n" + JSON.stringify(frontierForPrompt, null, 2),
    "## Grafo derivado\\nNodos: " + JSON.stringify(nodes) + "\\nAristas recorridas/fallidas: " + JSON.stringify(edges.map(function (e6) { return { type: e6.type, from: e6.from, to: e6.to, cause: e6.cause || "" } })),
    "## actionLog del walk" + (graphSource === "m8" ? " (M8)" : "") + "\\n" + JSON.stringify(log3.map(function (a5) { return { step: a5.step, screenId: a5.screenId, kind: a5.kind, ref: a5.ref, outcome: a5.outcome } })),
    "## Origin de la app\\n" + (inv.run.appOrigin || "(desconocido)"),
   ]),
   { label: "boundary", outputSchema: BOUNDARY_SCHEMA }
  )
  classifications = asArray(bRes.classifications)
  boundarySummary = String(bRes.summary || "")
 }
 const clsByKey = {}
 classifications.forEach(function (c1) { if (c1 && c1.ref) { clsByKey[String(c1.fromScreen) + "·" + String(c1.ref)] = c1 } })
 const discoveredFinal = discoveredEdges.map(function (d1) {
  const c = clsByKey[d1.from + "·" + d1.ref] || null
  return { type: "discovered", from: d1.from, to: "", via: { ref: d1.ref, text: d1.text, role: d1.role, href: d1.href }, category: c ? String(c.category) : "desconocida", evidence: c ? String(c.evidence || "") : "" }
 })
 inv.graph = { source: graphSource, nodes: nodes, edges: edges.concat(discoveredFinal), frontier: { motive: motive, hasFailedInteractions: hasFailedInteractions, discovered: discoveredFinal.length }, nodeErrors: errByNode }
 inv.boundary = { classified: classifications.length, discovered: discoveredEdges.length, summary: boundarySummary }
 await writeText(ART + "/artifacts/nav-graph.json", JSON.stringify(inv.graph, null, 2))
 // navegacion.md: mermaid (solo aristas traversed — las fallidas y
 // descubiertas van en tablas, no tienen destino confiable) + frontera.
 const motiveText = motive === "corte-presupuesto" ? "corte de presupuesto (" + inv.stoppedBy + ")" : motive === "derivado-de-m8" ? "derivado de docs/funcional (M8) — motivo de ESA corrida no registrado aquí" : "agotamiento real (done)"
 const ng = []
 ng.push("# Navegación — " + (mode === "walk" ? url : (inv.run.appOrigin || harPath)))
 ng.push("")
 ng.push("> Generada por traffic2api desde " + (graphSource === "m8" ? "docs/funcional (M8)" : "el walk propio") + ". FUENTE DE VERDAD: artifacts/nav-graph.json.")
 ng.push("")
 ng.push("- Fuente: " + (graphSource === "m8" ? "inventory de M8 (modo externo)" : "walk propio (" + steps + " pasos)"))
 if (mode === "walk") ng.push("- Corte del walk: " + (inv.stoppedBy || "sin corte") + (inv.stoppedByTime ? " (wall-clock)" : ""))
 ng.push("- Motivo de la frontera: **" + motiveText + "**")
 ng.push("- Interacciones no logradas: " + (hasFailedInteractions ? "sí (ver aristas fallidas)" : "no"))
 ng.push("")
 ng.push("## Grafo (mermaid)")
 ng.push("")
 ng.push("\`\`\`mermaid")
 ng.push("graph TD")
 nodes.forEach(function (n1) { ng.push("  " + n1.id + "[\\"" + mermaidSafe(n1.title) + "\\"]") })
 edges.forEach(function (e7) {
  if (e7.type !== "traversed") return
  ng.push("  " + e7.from + " -->|" + mermaidSafe(e7.via.ref + " " + e7.via.description) + "|" + e7.to)
 })
 ng.push("\`\`\`")
 ng.push("")
 const failedEdges = edges.filter(function (e8) { return e8.type === "attempted-failed" })
 if (failedEdges.length) {
  ng.push("## Aristas fallidas (attempted-failed)")
  ng.push("")
  ng.push("| Paso | Desde | Vía | Causa | Detalle |")
  ng.push("| --- | --- | --- | --- | --- |")
  failedEdges.forEach(function (e9) { ng.push("| " + e9.step + " | " + e9.from + " | " + mdCell(e9.via.ref + " " + e9.via.description).slice(0, 60) + " | " + e9.cause + " | " + mdCell(e9.detail) + " |") })
  ng.push("")
 }
 if (discoveredFinal.length) {
  ng.push("## Frontera no explorada (" + discoveredFinal.length + " aristas descubiertas)")
  ng.push("")
  ng.push("| Desde | Ref | Texto | Clasificación | Evidencia |")
  ng.push("| --- | --- | --- | --- | --- |")
  discoveredFinal.forEach(function (d2) { ng.push("| " + d2.from + " | " + d2.via.ref + " | " + mdCell(d2.via.text).slice(0, 60) + " | " + d2.category + " | " + mdCell(d2.evidence).slice(0, 80) + " |") })
  ng.push("")
 } else if (refsFailed) {
  ng.push("## Frontera no explorada")
  ng.push("")
  ng.push("**No evaluable**: la extracción de refs de los snapshots falló (degradación registrada en el inventario) — la frontera vacía NO es evidencia de cobertura.")
  ng.push("")
 } else {
  ng.push("## Frontera no explorada")
  ng.push("")
  ng.push("Sin aristas descubiertas — todos los refs de los snapshots fueron ejercidos por el walk.")
  ng.push("")
 }
 const errKeys = Object.keys(errByNode)
 if (errKeys.length) {
  ng.push("## Errores por pantalla")
  ng.push("")
  ng.push("| Pantalla | Tipo | Evidencia |")
  ng.push("| --- | --- | --- |")
  errKeys.forEach(function (sid) {
   errByNode[sid].forEach(function (er) { ng.push("| " + sid + " | " + er.kind + " | " + mdCell(er.evidence) + (er.step ? " (paso " + er.step + ")" : "") + " |") })
  })
  ng.push("")
 }
 await writeText(ART + "/navegacion.md", ng.join("\\n"))
 log("traffic2api: grafo — " + nodes.length + " nodos, " + edges.length + " aristas recorridas/fallidas, " + discoveredFinal.length + " descubiertas (motivo: " + motive + ")")
 await invWrite()
}

// ── matrix (prep determinista D9 + correlacionador agéntico con moat) ─────
phase("matrix")
// Prep: rutas CANDIDATAS de zona muerta — grep multi-framework + semilla M1.
const CAND = ART + "/artifacts/deadzone-candidates.txt"
await writeText(CAND, "# Rutas candidatas de zona muerta (traffic2api — grep multi-framework + semilla M1)\\n\\n")
let candSections = 0
for (let fw = 0; fw < FW_PATTERNS.length; fw++) {
 const g = await tryRun(FW_PATTERNS[fw].cmd + " 2>/dev/null | head -c 12000")
 const body = String(g.stdout || "").trim()
 if (!body) continue
 candSections = candSections + 1
 await tryRun("{ printf '%s\\n' " + shq("## " + FW_PATTERNS[fw].name) + "; printf '%s\\n' " + shq(body) + "; printf '\\n\\n'; } >> " + shq(CAND))
}
let seedAdded = false
if (inv.siblings.entendimiento) {
 let seedLines = []
 try {
  const m1Raw = await run("cat docs/entendimiento/artifacts/inventory.json")
  const m1 = JSON.parse(m1Raw)
  asArray(m1.components).forEach(function (c2) {
   asArray(c2.entryPoints).concat(asArray(c2.hubs)).forEach(function (p1) {
    const p = String(p1 || "").trim()
    if (p) seedLines.push(p + "  # " + String(c2.name || "") + " (M1 " + String(c2.id || "") + ")")
   })
  })
 } catch (e6) { seedLines = [] }
 if (seedLines.length) {
  seedAdded = true
  await tryRun("{ printf '%s\\n' " + shq("## Semilla M1 (entryPoints/hubs de components[])") + "; printf '%s\\n' " + shq(seedLines.slice(0, 80).join("\\n")) + "; printf '\\n'; } >> " + shq(CAND))
 }
}
if (candSections === 0 && !seedAdded) {
 registerDegradations([{ phase: "matrix", reason: "zona muerta no enumerable: ningún patrón de framework matcheó y no hay semilla M1", workaround: "framework no reconocido — cursa las rutas manualmente o genera docs/entendimiento (M1) para sembrar components[]", evidence: "grep multi-framework sin matches en matrix" }], "matrix")
}
const matrixBlocks = [
 "## Modo de la corrida\\n" + (mode === "walk" ? "walk propio: cada endpoint trae screenId(s) del walk (correlación temporal por epochs)" : "externo: sin walk propio — la columna Funcionalidad sale de docs/funcional (M8)" + (inv.siblings.funcional ? " si existe" : " (NO existe: matriz endpoint↔módulo solamente — degradación registrada)")),
 "## Endpoints observados (E01.. — con pantallas que los llamaron)\\n" + JSON.stringify(inv.endpoints, null, 2),
 "## Pantallas del walk\\n" + (inv.screens.length ? JSON.stringify(inv.screens.map(function (s5) { return { id: s5.id, title: s5.title, purpose: s5.purpose } })) : "(ninguna — modo externo)"),
 "## Anexo: dominios de terceros (NO same-origin — contexto, fuera de la spec)\\n" + (inv.thirdParty.map(function (t1) { return t1.origin + " (" + t1.count + ")" }).join(", ") || "(ninguno)"),
 "## Rutas candidatas de zona muerta\\nArchivo: " + CAND + ((candSections > 0 || seedAdded) ? " (greps: " + candSections + " secciones; semilla M1: " + (seedAdded ? "sí" : "no") + ")" : " — VACÍO (degradación registrada): reporta deadZone: [] y dilo explícitamente"),
 "## Grafo de navegación (alcanzabilidad de zona muerta)\\n" + JSON.stringify({ frontier: inv.graph.frontier, discovered: inv.graph.edges.filter(function (e10) { return e10.type === "discovered" }) }),
 "## Capacidades del moat\\n" + capabilitiesForPrompt(),
 "## Inventario (fuente de verdad — léelo también de disco)\\nRuta: " + ART + "/artifacts/inventory.json",
 "## Idioma\\n" + language,
]
if (inv.siblings.funcional) {
 matrixBlocks.push("## Documentación funcional M8 (fuente de funcionalidades)\\nCatálogo: docs/funcional/catalogo-pantallas.md\\nInventario M8: docs/funcional/artifacts/inventory.json (screens[] con id/title/purpose — ÚSALOS para la columna Funcionalidad cuando no haya correlación de walk)")
}
const mx = await agent(wkCtx(MATRIX, matrixBlocks), { label: "matrix", outputSchema: MATRIX_SCHEMA })
inv.matrix = asArray(mx.matrix).map(function (r0, i) {
 return { id: "M" + String(i + 1).padStart(2, "0"), functionality: String(r0.functionality || ""), screenIds: asArray(r0.screenIds).map(String), endpoints: asArray(r0.endpoints).map(function (e11) { return { id: String(e11.id || ""), method: String(e11.method || ""), path: String(e11.path || "") } }), modules: asArray(r0.modules).map(function (m2) { return { path: String(m2.path || ""), evidence: String(m2.evidence || "") } }), evidence: String(r0.evidence || "") }
})
inv.orphans = {
 apiSinUi: asArray(mx.orphans && mx.orphans.apiSinUi).map(function (o2) { return { method: String(o2.method || ""), path: String(o2.path || ""), note: String(o2.note || "") } }),
 uiSinCodigo: asArray(mx.orphans && mx.orphans.uiSinCodigo).map(function (u1) { return { functionality: String(u1.functionality || ""), note: String(u1.note || "") } }),
}
inv.deadZone = asArray(mx.deadZone).map(function (d3) { return { method: String(d3.method || ""), path: String(d3.path || ""), status: String(d3.status || "desconocida"), evidence: String(d3.evidence || "") } })
registerToolUse(mx.toolsUsed, "matrix")
registerDegradations(mx.degradations, "matrix")
log("traffic2api: matrix — " + inv.matrix.length + " filas; huérfanos " + inv.orphans.apiSinUi.length + "/" + inv.orphans.uiSinCodigo.length + "; zona muerta " + inv.deadZone.length)
await invWrite()

// ── synthesize (determinista: matriz.md + README.md, writer único) ────────
phase("synthesize")
inv.run.finishedAt = (await run("date '+%Y-%m-%d %H:%M:%S %z'")).trim()
const hasFunctionality = mode === "walk" || inv.siblings.funcional
// Veredicto de cobertura determinista (molde m4m5Verdict M1): SOLO derivado
// del inventario — un gap que no está en el inventario no puede aparecer.
function coverageVerdict() {
 const signals = []
 if (mode !== "walk") signals.push("modo externo: sin correlación pantalla↔petición propia" + (inv.siblings.funcional ? " (funcionalidades desde M8)" : ""))
 if (!inv.siblings.funcional) signals.push("sin docs/funcional (M8): matriz sin columna de funcionalidad groundeada")
 if (!inv.siblings.entendimiento) signals.push("sin docs/entendimiento (M1): zona muerta sin semilla components[]")
 if (!inv.capabilities.lensAvailable) signals.push("pi-lens no disponible en las hijas — grounding estructural degradado")
 if (!inv.capabilities.codebaseIndexAvailable) signals.push("frida-codebase-index no disponible — búsqueda semántica degradada (¿toggle frida.codebaseIndex.enabled?)")
 const rowsNoModule = inv.matrix.filter(function (r1) { return !r1.modules.length }).length
 if (inv.matrix.length && rowsNoModule > 0) signals.push(rowsNoModule + " de " + inv.matrix.length + " filas de la matriz sin módulo localizable")
 if (inv.orphans.apiSinUi.length) signals.push(inv.orphans.apiSinUi.length + " endpoints sin UI que los llame (huérfanos)")
 if (inv.orphans.uiSinCodigo.length) signals.push(inv.orphans.uiSinCodigo.length + " funcionalidades sin código localizable (huérfanos)")
 if (inv.deadZone.length) signals.push("zona muerta: " + inv.deadZone.length + " rutas candidatas calificadas")
 if (!inv.deadZone.length && candSections === 0 && !seedAdded) signals.push("zona muerta no enumerable (framework desconocido o sin semilla)")
 if (inv.degradations.length) signals.push(inv.degradations.length + " degradaciones registradas")
 if (inv.stoppedBy) signals.push("corrida cortada por " + inv.stoppedBy + (inv.stoppedByTime ? " (wall-clock)" : ""))
 const coreMissing = !inv.capabilities.lensAvailable || !inv.capabilities.codebaseIndexAvailable
 let headline
 if (coreMissing || (inv.matrix.length && rowsNoModule * 2 >= inv.matrix.length) || inv.degradations.length >= 3) {
  headline = "COBERTURA PARCIAL — prioriza cerrar los gaps listados antes de decisiones de modernización"
 } else if (signals.length) {
  headline = "COBERTURA SUFICIENTE CON RESERVAS — revisa las señales antes de decidir"
 } else {
  headline = "COBERTURA COMPLETA — matriz correlacionada sin gaps conocidos en el inventario"
 }
 return { headline: headline, signals: signals }
}
const cov = coverageVerdict()

const mt = []
mt.push("# Matriz funcionalidad↔endpoint↔módulo — " + (inv.run.appOrigin || url || harPath))
mt.push("")
mt.push("> Generada por traffic2api. FUENTE DE VERDAD: \\"artifacts/inventory.json\\".")
mt.push("")
mt.push("## Modo y fuentes")
mt.push("")
mt.push("- Modo: " + mode + (mode === "walk" ? " (walk propio con correlación temporal pantalla↔petición)" : " (HAR externo" + (inv.siblings.funcional ? ", funcionalidades desde docs/funcional M8)" : ", sin docs/funcional — degradada a endpoint↔módulo)")))
mt.push("- Funcionalidades: " + (mode === "walk" ? "pantallas del walk (P01..)" : (inv.siblings.funcional ? "docs/funcional (M8)" : "(no disponibles — degradación)")))
mt.push("- Módulos: " + (inv.capabilities.lensAvailable || inv.capabilities.codebaseIndexAvailable ? "moat (pi-lens + frida-codebase-index) con evidencia file:line" : "degradado (moat ausente — evidencia limitada)"))
mt.push("")
mt.push("## Matriz")
mt.push("")
if (hasFunctionality) {
 mt.push("| Funcionalidad | Endpoints | Módulo(s) | Evidencia |")
 mt.push("| --- | --- | --- | --- |")
 inv.matrix.forEach(function (r2) {
  const eps = r2.endpoints.map(function (e12) { return (e12.id ? e12.id + " " : "") + e12.method + " " + e12.path }).join("<br>")
  const mods = r2.modules.map(function (m3) { return "\`" + m3.path + "\`" + (m3.evidence ? " (" + m3.evidence + ")" : "") }).join("<br>")
  mt.push("| " + (r2.functionality || "—") + (r2.screenIds.length ? " (" + r2.screenIds.join(", ") + ")" : "") + " | " + (eps || "—") + " | " + (mods || "— (sin código localizable)") + " | " + mdCell(r2.evidence) + " |")
 })
} else {
 mt.push("| Endpoint | Módulo(s) | Evidencia |")
 mt.push("| --- | --- | --- |")
 inv.matrix.forEach(function (r2) {
  const eps = r2.endpoints.map(function (e13) { return (e13.id ? e13.id + " " : "") + e13.method + " " + e13.path }).join("<br>")
  const mods = r2.modules.map(function (m4) { return "\`" + m4.path + "\`" + (m4.evidence ? " (" + m4.evidence + ")" : "") }).join("<br>")
  mt.push("| " + (eps || "—") + " | " + (mods || "—") + " | " + mdCell(r2.evidence) + " |")
 })
}
mt.push("")
mt.push("## Huérfanos")
mt.push("")
mt.push("### API sin UI (endpoints sin pantalla/funcionalidad que los llame)")
mt.push("")
mt.push("| Método | Path | Nota |")
mt.push("| --- | --- | --- |")
if (inv.orphans.apiSinUi.length) {
 inv.orphans.apiSinUi.forEach(function (o3) { mt.push("| " + o3.method + " | " + mdCell(o3.path) + " | " + mdCell(o3.note) + " |") })
} else {
 mt.push("| — | (ninguno) | |")
}
mt.push("")
mt.push("### Funcionalidad sin código localizable")
mt.push("")
mt.push("| Funcionalidad | Nota |")
mt.push("| --- | --- | --- |")
if (inv.orphans.uiSinCodigo.length) {
 inv.orphans.uiSinCodigo.forEach(function (u2) { mt.push("| " + mdCell(u2.functionality) + " | " + mdCell(u2.note) + " |") })
} else {
 mt.push("| (ninguna) | |")
}
mt.push("")
mt.push("## Zona muerta (rutas del código ausentes del tráfico)")
mt.push("")
mt.push("Calificación por alcanzabilidad (grafo): **probablemente viva** = su pantalla es alcanzable por una arista descubierta; **candidata real** = sin aristas entrantes descubiertas; **desconocida** = sin evidencia suficiente.")
mt.push("")
mt.push("| Método | Ruta | Estado | Evidencia |")
mt.push("| --- | --- | --- | --- |")
if (inv.deadZone.length) {
 inv.deadZone.forEach(function (d4) { mt.push("| " + (d4.method || "—") + " | " + mdCell(d4.path) + " | " + d4.status + " | " + mdCell(d4.evidence) + " |") })
} else {
 mt.push("| — | (sin candidatas o no enumerable — ver degradaciones) | | |")
}
mt.push("")
await writeText(ART + "/matriz.md", mt.join("\\n"))

const md = []
md.push("# Documentación de API — " + (inv.run.appOrigin || url || harPath))
md.push("")
md.push("> Generada por el patrón \`traffic2api\` (frida-traffic2api) a partir del tráfico HTTP REAL observado. FUENTE DE VERDAD: \`artifacts/inventory.json\`. La spec documenta lo observado (errores incluidos), no una API ideal.")
md.push("")
md.push("## Corrida")
md.push("")
md.push("- Modo: " + mode + (mode === "walk" ? " · App: " + url + " · Sesión: \`" + session + "\` (pre-autenticada)" : " · HAR: \`" + harPath + "\`"))
md.push("- Inicio: " + inv.run.startedAt + " · Fin: " + inv.run.finishedAt)
md.push("- Presupuesto: " + (mode === "walk" ? (maxScreens === 0 ? "sin tope (todo)" : maxScreens + " pantallas") + (maxMinutes > 0 ? " · " + maxMinutes + " min" : "") : (maxMinutes > 0 ? maxMinutes + " min (sin efecto en modo externo)" : "sin tope")))
md.push("- Tráfico: **" + carve.total + "** entradas · **" + carve.sameOrigin + "** same-origin · " + carve.thirdPartyCount + " de terceros")
md.push("- Pantallas: **" + inv.screens.length + "** en " + steps + " pasos · Endpoints: **" + inv.endpoints.length + "** · Paths: **" + spec.paths + "**")
md.push("- Corte: " + (inv.stoppedBy ? inv.stoppedBy + (inv.stoppedByTime ? " (wall-clock)" : "") : (mode === "walk" ? "sin corte registrado" : "no aplica (modo externo)")))
md.push("")
md.push("## Entregables")
md.push("")
md.push("| Archivo | Contenido |")
md.push("| --- | --- |")
md.push("| [openapi.json](openapi.json) | Spec OpenAPI 3.1 de la API observada |")
md.push("| [matriz.md](matriz.md) | Matriz funcionalidad↔endpoint↔módulo + huérfanos + zona muerta |")
md.push("| [navegacion.md](navegacion.md) | Grafo de navegación + frontera calificada |")
md.push("| [artifacts/inventory.json](artifacts/inventory.json) | Inventario auditable (fuente de verdad) |")
md.push("| [artifacts/requests.jsonl](artifacts/requests.jsonl) | Carve: una petición por línea con screenId |")
md.push("| [artifacts/raw.har](artifacts/raw.har) | HAR crudo preservado |")
md.push("")
md.push("## Endpoints observados")
md.push("")
md.push("| ID | Método | Path | Llamadas | Estados | Pantallas |")
md.push("| --- | --- | --- | --- | --- | --- |")
inv.endpoints.forEach(function (e14) {
 md.push("| " + e14.id + " | " + e14.method + " | " + mdCell(e14.path) + " | " + e14.count + " | " + e14.statuses.join(", ") + " | " + (e14.screens.join(", ") || "—") + " |")
})
md.push("")
if (inv.thirdParty.length) {
 md.push("## Anexo: dominios de terceros")
 md.push("")
 md.push("| Origin | Peticiones |")
 md.push("| --- | --- |")
 inv.thirdParty.forEach(function (t2) { md.push("| " + mdCell(t2.origin) + " | " + t2.count + " |") })
 md.push("")
}
md.push("## Capacidades del moat")
md.push("")
md.push("| Tool | Disponible | Usos | Degradada |")
md.push("| --- | --- | --- | --- |")
inv.tools.forEach(function (t3) {
 md.push("| \`" + t3.name + "\` | " + (t3.available ? "sí" : "no") + " | " + t3.usedCount + " | " + (t3.degraded ? "sí" : "no") + " |")
})
md.push("")
if (inv.degradations.length) {
 md.push("## Degradaciones")
 md.push("")
 inv.degradations.forEach(function (d5) {
  md.push("- [" + d5.phase + (d5.tool ? "/" + d5.tool : "") + "] " + mdCell(d5.reason) + (d5.workaround ? " — _" + mdCell(d5.workaround) + "_" : ""))
 })
 md.push("")
}
md.push("## Veredicto de cobertura")
md.push("")
md.push("> **" + cov.headline + "**")
md.push("")
if (cov.signals.length) {
 cov.signals.forEach(function (s6) { md.push("- " + s6) })
} else {
 md.push("- Sin señales negativas registradas en el inventario.")
}
md.push("")
md.push("## Cómo leer")
md.push("")
md.push("- IDs estables: pantallas \`P01..\`, endpoints \`E01..\`, filas de matriz \`M01..\`.")
md.push("- Los payloads se REFERENCIAN (\`artifacts/payloads.jsonl\`), nunca se inlinean completos; los ejemplos de la spec están scrubbeados de secretos.")
md.push("- Ningún entregable contiene headers de autorización, cookies ni tokens (auditable por el juez).")
md.push("")
await writeText(ART + "/README.md", md.join("\\n"))
log("traffic2api: matriz.md + README.md sintetizados desde el inventario")

// ── judge: auditor detached contra artefactos reales (R11) ────────────────
phase("judge")
const judge = await agent(
 wkCtx(JUDGE, [
  "## Entregables a auditar (lee los archivos REALES)\\n- " + ART + "/README.md\\n- " + ART + "/openapi.json\\n- " + ART + "/matriz.md\\n- " + ART + "/navegacion.md\\n- " + ART + "/artifacts/inventory.json (fuente de verdad)\\n- " + ART + "/artifacts/nav-graph.json\\n- " + ART + "/artifacts/requests.jsonl (muestrea varias líneas)\\n- " + ART + "/artifacts/steps/ y " + ART + "/screenshots/ (evidencia cruda)",
  "## Inventario (claims base)\\n" + invSerialize(),
  "## Contexto de corte\\nstoppedBy=" + JSON.stringify(inv.stoppedBy) + " stoppedByTime=" + inv.stoppedByTime + " degradations=" + inv.degradations.length + " — un corte por presupuesto o tiempo (stoppedBy del inventario), la ausencia de docs hermanos o del moat son gaps CONOCIDOS (registrados como degradaciones en el inventario): repórtalos como CONCERNS con lo faltante, no como FAIL.",
 ]),
 { label: "judge", outputSchema: JUDGE_SCHEMA }
)
log("traffic2api: judge=" + judge.decision + " findings=" + (judge.findings || []).length)

if (review === "manual") {
 const cp = await checkpoint({ name: "traffic2api-final", prompt: "Documentación de API lista en " + ART + " (" + inv.endpoints.length + " endpoints, matriz con " + inv.matrix.length + " filas, grafo con " + inv.graph.nodes.length + " nodos). Juez: " + judge.decision + " con " + (judge.findings || []).length + " findings. ¿Apruebas para terminar?", context: { dir: ART, mode: mode, endpoints: inv.endpoints.length, matrix: inv.matrix.length, judge: judge.decision, findings: (judge.findings || []).length } })
 if (cp !== "approved") throw new Error("traffic2api: checkpoint rechazado — workflow detenido")
}

return {
 pattern: "traffic2api",
 mode: mode,
 language: language,
 appOrigin: inv.run.appOrigin,
 screens: inv.screens.length,
 steps: steps,
 requests: { total: Number(carve.total) || 0, sameOrigin: Number(carve.sameOrigin) || 0, thirdParty: inv.thirdParty.length },
 endpoints: inv.endpoints.length,
 openapi: { paths: Number(spec.paths) || 0, operations: Number(spec.operations) || 0 },
 matrixRows: inv.matrix.length,
 orphans: { apiSinUi: inv.orphans.apiSinUi.length, uiSinCodigo: inv.orphans.uiSinCodigo.length },
 deadZone: inv.deadZone.length,
 graph: { nodes: inv.graph.nodes.length, edges: inv.graph.edges.length, frontierDiscovered: inv.graph.frontier.discovered },
 stoppedBy: inv.stoppedBy,
 stoppedByTime: inv.stoppedByTime,
 degradations: inv.degradations.length,
 coverage: cov.headline,
 docs: { readme: ART + "/README.md", openapi: ART + "/openapi.json", matriz: ART + "/matriz.md", navegacion: ART + "/navegacion.md", inventory: ART + "/artifacts/inventory.json", navGraph: ART + "/artifacts/nav-graph.json", requestsJsonl: ART + "/artifacts/requests.jsonl" },
 judge: judge,
}
`;
}
