// frida-traffic2api — integración end-to-end del patrón sobre el motor real
// (runWorkflowInStore + RunStore). Issue #135, M9 Pista M.
//
// Doble mock (molde test/frida-app-walkthrough/e2e.test.ts):
//   1. Binario `agent-browser` falsificado en el PATH del tmpdir: app demo
//      determinista de 5 pantallas (tour cableado M8) + rama `network har`
//      según el contrato REAL del binario (D15 — el mock deriva del contrato
//      observado, no supuesto):
//        - `snapshot -i` → data {origin, snapshot, refs: MAPA {e1:{name,role}}}
//          (results/envelope.ts, verificado 0.33.1 — keys SIN "@"; el "@"
//          es solo el id de comando). El REFS_JS del script (fix cascade
//          ratificado en el checkpoint del Slice 5) lee este mapa.
//        - `network har start --content all` SIN path (upstream
//          COMMAND_REFERENCE.md:722/:504 — start ignora positionals);
//          `network har stop <path>` es el comando productor.
//        - open/click appendean tráfico sintético (epoch, method, url,
//          status, body) a un log TSV con `date +%s` — reloj COMPARTIDO con
//          el script del workflow (FAKE_DATE_MOCK +30 s/epoch cuando el test
//          lo escribe); el stop agrega el TSV a HAR 1.2 con startedDateTime
//          ISO vía `node` (Date existe en el host) → el join temporal D5
//          (epoch de la petición ∈ [epoch(N), epoch(N+1)) → screenId del
//          paso N) se ejercita de verdad y DETERMINISTA (ventanas ≥30 s).
//        - TODAS las entries llevan header Authorization "Bearer
//          sekret-token-mock": la garantía estructural (el carve NUNCA
//          extrae headers) se asserta — ningún entregable contiene el token.
//   2. Spawner mock por anclas de runtime context: walk ("## Snapshot
//      actual"), boundary ("## Aristas descubiertas (frontera)"), matrix
//      ("## Endpoints observados") y juez ("## Entregables a auditar").
//      NO hay agentes escritores: TODOS los entregables los escribe el
//      script determinista (writeText) — sin liar/flaky de agentes (#83 no
//      aplica aquí); los gates `test -s` del script son los verificados.
//
// Cobertura: walk feliz (join temporal, 422 documentado, colapso {id},
// scrub de secretos, frontera clasificada), cortes budget (checkpoint
// manual) y time (FAKE_DATE), zona muerta probablemente-viva (grep real
// sobre repo fixture Express), modo externo devtools sin hermanos
// (degradaciones honestas, matriz 2 columnas), modo externo mitmproxy con
// docs M8 (grafo derivado-de-m8 con aristas fallidas y errores por nodo),
// HAR vacío / walk cross-origin (censo accionable, NFR Reliability), juez
// FAIL no-abortivo, sesión muerta y determinismo.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
 mkdtempSync,
 rmSync,
 mkdirSync,
 writeFileSync,
 readFileSync,
 readdirSync,
 existsSync,
 chmodSync,
 statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import { resolveCheckpoint } from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { TRAFFIC2API_PATTERN } from "../../src/tools/frida-traffic2api";

const REAL_HOME = process.env.HOME;
const REAL_PATH = process.env.PATH;

/** App demo del mock: 5 pantallas bajo esta base. */
const BASE = "https://app.ejemplo.com";

let home: string;
let cwd: string;
let binDir: string;

beforeEach(() => {
 home = mkdtempSync(join(tmpdir(), "t2a-e2e-home-"));
 cwd = mkdtempSync(join(tmpdir(), "t2a-e2e-cwd-"));
 binDir = join(cwd, ".mock-bin");
 writeBrowserMock();
 // HOME aislado también aisla la sonda del moat (os.homedir() lee $HOME):
 // CAPABILITIES={"lens":false,"codebaseIndex":false} → degradación
 // determinista del bootstrap assertada (molde M1).
 process.env.HOME = home;
 // El sandbox hereda el env del proceso (execution.ts): el mock gana al
 // binario real en PATH, y el date falsificado (cuando se escribe) al real.
 process.env.PATH = binDir + ":" + REAL_PATH;
});

afterEach(() => {
 if (REAL_HOME) process.env.HOME = REAL_HOME;
 if (REAL_PATH) process.env.PATH = REAL_PATH;
 rmSync(home, { recursive: true, force: true });
 rmSync(cwd, { recursive: true, force: true });
});

/**
 * Binario mock de agent-browser: app demo determinista de 5 pantallas con
 * estado en disco (cada comando del sandbox es un proceso nuevo) + grabación
 * HAR. Tour cableado (molde M8): inicio → productos (form agrega ?q=) →
 * producto/1 → productos → carrito → perfil (validación con error 422).
 * El tráfico sintético se loggea SOLO si `network har start` corrió y se
 * agrega a HAR 1.2 en el `stop <path>` (contrato real: path en stop).
 */
const BROWSER_MOCK = `#!/usr/bin/env bash
# mock agent-browser (e2e frida-traffic2api) — contrato REAL del binario.
DIR="$(cd "$(dirname "$0")" && pwd)"
STATE="$DIR/state"
mkdir -p "$STATE"

# Modo sesión muerta (gate bootstrap): todo comando falla.
if [ -f "$STATE/dead" ]; then
  printf '{"success":false,"error":{"message":"session not found"}}\\n'
  exit 1
fi

shift 2 # --session <nombre>
cmd="$1"
shift   # el resto (incluye el --json final)

path() { printf '%s' "$1" | sed 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*##; s/[?#].*$//'; }
cur() { if [ -f "$STATE/current" ]; then cat "$STATE/current"; else printf '%s' 'https://app.ejemplo.com/inicio'; fi }
setcur() { printf '%s' "$1" > "$STATE/current"; }

title_for() {
  case "$(path "$1")" in
    /inicio) printf 'Inicio' ;;
    /productos) printf 'Productos' ;;
    /producto/1) printf 'Producto Detalle' ;;
    /carrito) printf 'Carrito' ;;
    /perfil) printf 'Perfil' ;;
    *) printf 'Pantalla' ;;
  esac
}

body_for() {
  case "$(path "$1")" in
    /inicio) printf 'Menu [ref=e1] Productos [ref=e2] Carrito [ref=e3] Perfil' ;;
    /productos) printf 'Buscador [ref=e4] Buscar [ref=e5] Detalle [ref=e1] Pagina2 [ref=e6]' ;;
    /producto/1) printf 'Volver [ref=e1] AgregarAlCarrito [ref=e2]' ;;
    /carrito) printf 'Seguir [ref=e1] FinalizarCompra [ref=e2]' ;;
    /perfil) printf 'Nombre [ref=e3] Guardar [ref=e4] CerrarSesion [ref=e5] ERROR El nombre es obligatorio' ;;
    *) printf '(vacia)' ;;
  esac
}

# Contrato REAL (envelope.ts): refs es un MAPA { "e1": { name, role } },
# keys SIN "@" — el "@" es solo el id de comando.
refs_for() {
  case "$(path "$1")" in
    /inicio) printf '{"e1":{"name":"Productos","role":"link"},"e2":{"name":"Carrito","role":"link"},"e3":{"name":"Perfil","role":"link"}}' ;;
    /productos) printf '{"e4":{"name":"Buscador","role":"textbox"},"e5":{"name":"Buscar","role":"button"},"e1":{"name":"Detalle","role":"link"},"e6":{"name":"Pagina2","role":"link"}}' ;;
    /producto/1) printf '{"e1":{"name":"Volver","role":"link"},"e2":{"name":"AgregarAlCarrito","role":"button"}}' ;;
    /carrito) printf '{"e1":{"name":"Seguir","role":"link"},"e2":{"name":"FinalizarCompra","role":"button"}}' ;;
    /perfil) printf '{"e3":{"name":"Nombre","role":"textbox"},"e4":{"name":"Guardar","role":"button"},"e5":{"name":"CerrarSesion","role":"button"}}' ;;
    *) printf '{}' ;;
  esac
}

next_for() {
  case "$(path "$1") $2" in
    "/inicio @e1") printf 'https://app.ejemplo.com/productos' ;;
    "/inicio @e2") printf 'https://app.ejemplo.com/carrito' ;;
    "/inicio @e3") printf 'https://app.ejemplo.com/perfil' ;;
    "/productos @e1") printf 'https://app.ejemplo.com/producto/1' ;;
    "/productos @e5") printf 'https://app.ejemplo.com/productos?q=laptop' ;;
    "/productos @e6") printf 'https://app.ejemplo.com/productos?page=2' ;;
    "/producto/1 @e1") printf 'https://app.ejemplo.com/productos' ;;
    "/carrito @e1") printf 'https://app.ejemplo.com/productos' ;;
    *) printf '%s' "$1" ;;
  esac
}

# Tráfico sintético (solo con grabación activa): TSV epoch↹method↹url↹status↹body.
log_traffic() {
  if [ -f "$STATE/recording" ]; then
    e="$(date +%s)"
    printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$e" "$1" "$2" "$3" "$4" >> "$STATE/traffic.log"
  fi
}
traffic_for() {
  case "$(path "$1")" in
    /productos) log_traffic GET "https://app.ejemplo.com/api/productos" 200 "-" ;;
    /producto/1) log_traffic GET "https://app.ejemplo.com/api/productos/1" 200 "-" ;;
    /carrito) log_traffic GET "https://app.ejemplo.com/api/carrito" 200 "-" ;;
    /perfil) log_traffic GET "https://app.ejemplo.com/api/perfil" 200 "-" ;;
  esac
}

case "$cmd" in
  network)
    case "$1" in
       har)
          case "$2" in
             start)
               # Contrato real: start SIN path (lo ignora).
               rm -f "$STATE/traffic.log"
               : > "$STATE/recording"
               printf '{"success":true,"data":{"state":"recording"}}\\n'
               ;;
             stop)
               out="$3"
               if [ -f "$STATE/recording" ] && [ -n "$out" ]; then
                  T2A_TRAFFIC="$STATE/traffic.log" T2A_OUT="$out" node -e 'const fs=require("fs");const lines=fs.readFileSync(process.env.T2A_TRAFFIC||"","utf8").split("\\n").filter(function(l){return l.length>0});const entries=[];for(const l of lines){const p=l.split("\\t");const e={startedDateTime:new Date(Number(p[0])*1000).toISOString(),request:{method:p[1],url:p[2],headers:[{name:"Authorization",value:"Bearer sekret-token-mock"}]},response:{status:Number(p[3]),content:{mimeType:"application/json"}}};if(p[4]&&p[4]!=="-"){e.request.postData={text:p[4]}}entries.push(e)}fs.writeFileSync(process.env.T2A_OUT||"/dev/null",JSON.stringify({log:{version:"1.2",creator:{name:"agent-browser-mock",version:"0.33.1"},entries:entries}})+"\\n")'
                 rm -f "$STATE/recording"
                 printf '{"success":true,"data":{"path":"%s"}}\\n' "$out"
               else
                 printf '{"success":false,"error":{"message":"no hay grabacion activa"}}\\n'
                 exit 1
               fi
               ;;
             *)
               printf '{"success":false,"error":{"message":"subcomando no soportado"}}\\n'
               exit 1
               ;;
           esac
          ;;
        *)
          printf '{"success":false,"error":{"message":"comando network no soportado"}}\\n'
          exit 1
          ;;
     esac
     ;;
  open)
    setcur "$1"
    # Burst de hidratación de cada open (goto incluido): parte de la API real.
    log_traffic GET "https://app.ejemplo.com/api/session" 200 "-"
    log_traffic GET "https://app.ejemplo.com/api/config" 200 "-"
    traffic_for "$(cur)"
    printf '{"success":true,"data":{"lifecycle":{"reused":true},"url":"%s","title":"%s"}}\\n' "$(cur)" "$(title_for "$(cur)")"
    ;;
  get)
    # Contrato del binario REAL (smoke M8 30ef616): data tipado.
    if [ "$1" = "url" ]; then
     printf '{"success":true,"data":{"url":"%s","lifecycle":{"reused":true}}}\\n' "$(cur)"
    else
     printf '{"success":true,"data":{"title":"%s","lifecycle":{"reused":true}}}\\n' "$(title_for "$(cur)")"
    fi
    ;;
  snapshot)
    printf '{"success":true,"data":{"origin":"%s","snapshot":"%s","refs":%s}}\\n' "$(cur)" "$(body_for "$(cur)")" "$(refs_for "$(cur)")"
    ;;
  click)
    ref="$1"
    setcur "$(next_for "$(cur)" "$ref")"
    if [ -f "$STATE/recording" ]; then
      if [ "$(path "$(cur)")" = "/perfil" ] && [ "$ref" = "@e4" ]; then
        # Submit del validate: POST con error 422 (los errores son API real, R5).
        log_traffic POST "https://app.ejemplo.com/api/perfil" 422 '{"nombre":""}'
      else
        traffic_for "$(cur)"
      fi
    fi
    printf '{"success":true}\\n'
    ;;
  fill)
    printf '{"success":true}\\n'
    ;;
  wait)
    printf '{"success":true}\\n'
    ;;
  screenshot)
    # Contrato real (COMMAND_REFERENCE): screenshot --full captura la
    # página completa — el flag precede al path posicional.
    out="$1"
    if [ "$out" = "--full" ] || [ "$out" = "-f" ]; then out="$2"; fi
    printf 'png-mock-e2e' > "$out"
    printf '{"success":true}\\n'
    ;;
  *)
    printf '{"success":false,"error":{"message":"comando no soportado: %s"}}\\n' "$cmd"
    exit 1
    ;;
esac
`;

/** date falsificado (D6/cortes): cada llamada a epoch avanza +30 s (contador);
 *  el formato largo (%Y…) responde fecha fija determinista. Reloj COMPARTIDO
 *  con el mock del binario (el TSV de tráfico usa el mismo date del PATH). */
const FAKE_DATE_MOCK = `#!/usr/bin/env bash
D="$(cd "$(dirname "$0")" && pwd)"
case "$*" in
  *%Y*)
    printf '2026-08-24 12:00:00 +0000\\n'
    ;;
  *)
    n=0
    if [ -f "$D/date.n" ]; then n=$(cat "$D/date.n"); fi
    n=$((n + 1))
    printf '%s' "$n" > "$D/date.n"
    printf '%s\\n' $((1750000000 + n * 30))
    ;;
esac
`;

function writeBrowserMock(): void {
 mkdirSync(binDir, { recursive: true });
 writeFileSync(join(binDir, "agent-browser"), BROWSER_MOCK, "utf-8");
 chmodSync(join(binDir, "agent-browser"), 0o755);
}

function writeFakeDate(): void {
 writeFileSync(join(binDir, "date"), FAKE_DATE_MOCK, "utf-8");
 chmodSync(join(binDir, "date"), 0o755);
}

// ── Fixtures del repo target (cwd de la corrida) ───────────────────────────

/** Mini repo Express: los greps multi-framework de la fase matrix (D9)
 *  matchean rutas reales → zona muerta enumerable. */
function fixtureRepoServer(base: string): void {
 mkdirSync(join(base, "src"), { recursive: true });
 writeFileSync(
  join(base, "src", "server.js"),
  [
   'const app = require("express")();',
   'app.get("/api/productos", function (req, res) { res.json([]); });',
   'app.get("/api/productos/:id", function (req, res) { res.json({}); });',
   'app.get("/api/reportes-legado", function (req, res) { res.json({ obsoleto: true }); });',
   'app.post("/api/perfil", function (req, res) { res.status(422).json({ error: "nombre obligatorio" }); });',
   "app.listen(3000);",
   "",
  ].join("\n"),
  "utf-8",
 );
}

interface HarEntrySpec {
 at: string;
 method: string;
 url: string;
 status: number;
 mime?: string;
 body?: string;
}

/** Entry HAR 1.2 con sabor devtools (_resourceType/pageref) — TODAS las
 *  entries llevan Authorization (la garantía estructural del carve se
 *  asserta: el header jamás llega a un entregable). */
function harEntry(e: HarEntrySpec): Record<string, unknown> {
 const request: Record<string, unknown> = {
  method: e.method,
  url: e.url,
  httpVersion: "HTTP/1.1",
  headers: [
   { name: "Authorization", value: "Bearer sekret-token-mock" },
   { name: "Accept", value: "application/json" },
  ],
  queryString: [],
  cookies: [],
  headersSize: -1,
  bodySize: -1,
 };
 if (e.body !== undefined) {
  request.postData = { mimeType: "application/json", text: e.body };
 }
 return {
  startedDateTime: e.at,
  pageref: "page_1",
  _resourceType: "xhr",
  request,
  response: {
   status: e.status,
   statusText: "",
   httpVersion: "HTTP/1.1",
   content: { mimeType: e.mime ?? "application/json", size: 42 },
   headersSize: -1,
   bodySize: -1,
  },
  cache: {},
  timings: { send: 1, wait: 2, receive: 3 },
 };
}

/** HAR estilo Chrome DevTools: 5 same-origin + 2 de un CDN (censo de
 *  terceros), path numérico y UUID (colapso {id}), 404, POST con token. */
function devtoolsHar(): Record<string, unknown> {
 return {
  log: {
   version: "1.2",
   creator: { name: "Chrome DevTools", version: "1.2.3" },
   pages: [
    {
     startedDateTime: "2026-08-20T10:00:00Z",
     id: "page_1",
     title: "app",
     pageTimings: {},
    },
   ],
   entries: [
    harEntry({
     at: "2026-08-20T10:00:00Z",
     method: "GET",
     url: BASE + "/api/productos?page=1",
     status: 200,
    }),
    harEntry({
     at: "2026-08-20T10:00:01Z",
     method: "GET",
     url: BASE + "/api/productos/42",
     status: 200,
    }),
    harEntry({
     at: "2026-08-20T10:00:02Z",
     method: "GET",
     url: BASE + "/api/productos/123e4567-e89b-42d3-a456-426614174000",
     status: 404,
    }),
    harEntry({
     at: "2026-08-20T10:00:03Z",
     method: "POST",
     url: BASE + "/api/ordenes",
     status: 201,
     body: '{"cliente":"acme","token":"sekret-token-mock"}',
    }),
    harEntry({
     at: "2026-08-20T10:00:04Z",
     method: "GET",
     url: BASE + "/api/ordenes/999",
     status: 200,
    }),
    harEntry({
     at: "2026-08-20T10:00:05Z",
     method: "GET",
     url: "https://cdn.ejemplo.com/analytics.js",
     status: 200,
     mime: "application/javascript",
    }),
    harEntry({
     at: "2026-08-20T10:00:06Z",
     method: "GET",
     url: "https://cdn.ejemplo.com/pixel.gif",
     status: 200,
     mime: "image/gif",
    }),
   ],
  },
 };
}

/** HAR estilo mitmproxy: misma envoltura log.entries con matices de campos
 *  (sin _resourceType), 401 y 500 documentados. */
function mitmproxyHar(): Record<string, unknown> {
 const entries = [
  harEntry({
   at: "2026-08-21T09:00:00Z",
   method: "GET",
   url: BASE + "/api/sesion",
   status: 200,
  }),
  harEntry({
   at: "2026-08-21T09:00:01Z",
   method: "GET",
   url: BASE + "/api/ordenes",
   status: 200,
  }),
  harEntry({
   at: "2026-08-21T09:00:02Z",
   method: "GET",
   url: BASE + "/api/ordenes/77",
   status: 200,
  }),
  harEntry({
   at: "2026-08-21T09:00:03Z",
   method: "POST",
   url: BASE + "/api/login",
   status: 401,
   body: '{"usuario":"demo","password":"no"}',
  }),
  harEntry({
   at: "2026-08-21T09:00:04Z",
   method: "GET",
   url: BASE + "/api/reportes",
   status: 500,
  }),
 ];
 for (const e of entries) delete e._resourceType;
 return {
  log: {
   version: "1.2",
   creator: { name: "mitmproxy", version: "0.1" },
   entries,
  },
 };
}

/** Escribe un HAR externo en el cwd de la corrida; devuelve el harPath relativo. */
function fixtureExternalHar(
 base: string,
 har: Record<string, unknown>,
): string {
 const p = join(base, "capturas", "sesion.har");
 mkdirSync(dirname(p), { recursive: true });
 writeFileSync(p, JSON.stringify(har), "utf-8");
 return "capturas/sesion.har";
}

/** Docs hermanos M8 legibles (catálogo + inventario + steps con refs MAPA
 *  — contrato real) para el grafo derivado-de-m8 (D8) en modo externo. */
function fixtureM8Docs(base: string): void {
 const root = join(base, "docs/funcional");
 mkdirSync(join(root, "artifacts/steps"), { recursive: true });
 writeFileSync(
  join(root, "catalogo-pantallas.md"),
  "# Catálogo de pantallas\n\n- P01 Inicio\n- P02 Perfil\n",
  "utf-8",
 );
 writeFileSync(
  join(root, "artifacts", "inventory.json"),
  JSON.stringify(
   {
    screens: [
     {
      id: "P01",
      canon: BASE + "/inicio",
      title: "Inicio",
      validationEvidence: [],
     },
     {
      id: "P02",
      canon: BASE + "/perfil",
      title: "Perfil",
      validationEvidence: [
       "docs/funcional/artifacts/steps/003-validation.json",
      ],
     },
    ],
    actionLog: [
     {
      step: 1,
      screenId: "P01",
      kind: "click",
      ref: "@e1",
      description: "ir a perfil",
      outcome: "ok",
     },
     {
      step: 2,
      screenId: "P02",
      kind: "click",
      ref: "@e9",
      description: "botón inexistente",
      outcome: "fail: agent-browser falló (click @e9): exit=1",
     },
     {
      step: 3,
      screenId: "P02",
      kind: "validate",
      ref: "@e4",
      description: "submit inválido",
      outcome: "ok",
     },
     {
      step: 4,
      screenId: "P02",
      kind: "done",
      description: "fin",
      outcome: "ok",
     },
    ],
   },
   null,
   2,
  ),
  "utf-8",
 );
 const snap = (refs: Record<string, { name: string; role: string }>): string =>
  JSON.stringify({
   success: true,
   data: { origin: BASE + "/inicio", snapshot: "cuerpo", refs },
  });
 writeFileSync(
  join(root, "artifacts/steps/001-snapshot.json"),
  snap({
   e1: { name: "Perfil", role: "link" },
   e2: { name: "Ayuda", role: "link" },
   e3: { name: "Salir", role: "link" },
  }),
  "utf-8",
 );
 writeFileSync(
  join(root, "artifacts/steps/002-snapshot.json"),
  snap({
   e4: { name: "Guardar", role: "button" },
   e5: { name: "CambiarContrasena", role: "link" },
  }),
  "utf-8",
 );
 writeFileSync(
  join(root, "artifacts/steps/003-validation.json"),
  JSON.stringify({
   success: true,
   data: { snapshot: "ERROR El nombre es obligatorio" },
  }),
  "utf-8",
 );
}

// ── Spawner mock por anclas de runtime context ─────────────────────────────

interface SpawnOptions {
 /** Decisión del juez cuando NO hay corte (default "PASS"). */
 judgeDecision?: "PASS" | "CONCERNS" | "FAIL";
}

/**
 * Anclas (contrato del script generado, Slice 2): walk "## Snapshot actual",
 * boundary "## Aristas descubiertas (frontera)", matrix "## Endpoints
 * observados", juez "## Entregables a auditar". El juez deriva del contexto
 * de corte del propio prompt (stoppedBy budget|time → CONCERNS, gap conocido
 * D10); boundary clasifica desde el JSON que interpola el script; matrix
 * responde "con sabor a moat" (correlaciones file:line del repo fixture).
 */
const makeSpawn = (opts: SpawnOptions = {}, seen: string[] = []) =>
 (async (prompt: string) => {
  seen.push(prompt);
  // Intérprete del walk — ancla: bloque "## Snapshot actual".
  if (prompt.includes("## Snapshot actual")) {
   const origin = prompt.match(/origin: (\S+)/)?.[1] ?? "";
   const canon = origin.split("#")[0].split("?")[0];
   const isNew = prompt.includes("NUEVA — registrada");
   const interp = (nextAction: unknown, purpose: string) => ({
    purpose,
    userRoles: ["usuario autenticado"],
    mainElements: ["menu"],
    nextAction,
   });
   if (canon === BASE + "/inicio") {
    return interp(
     { kind: "click", ref: "@e1", description: "ir a productos" },
     "Portada",
    );
   }
   if (canon === BASE + "/productos") {
    if (isNew) {
     return interp(
      {
       kind: "form",
       ref: "@e5",
       fields: [{ selector: "@e4", value: "laptop" }],
       description: "buscar laptop",
      },
      "Listado",
     );
    }
    if (prompt.includes("P03")) {
     return interp(
      { kind: "goto", url: BASE + "/carrito", description: "ir a carrito" },
      "Listado",
     );
    }
    return interp(
     { kind: "click", ref: "@e1", description: "abrir detalle" },
     "Listado",
    );
   }
   if (canon === BASE + "/producto/1") {
    return interp(
     { kind: "click", ref: "@e1", description: "volver al listado" },
     "Detalle",
    );
   }
   if (canon === BASE + "/carrito") {
    return interp(
     { kind: "goto", url: BASE + "/perfil", description: "ir a perfil" },
     "Carrito",
    );
   }
   if (canon === BASE + "/perfil") {
    return isNew
     ? interp(
        {
         kind: "validate",
         ref: "@e4",
         fields: [{ selector: "@e3", value: "" }],
         description: "submit invalido",
        },
        "Perfil",
       )
     : interp({ kind: "done", description: "app cubierta" }, "Perfil");
   }
   return interp({ kind: "done", description: "(default)" }, "?");
  }
  // Boundary — ancla: bloque "## Aristas descubiertas (frontera)".
  if (prompt.includes("## Aristas descubiertas (frontera)")) {
   const classifications: Array<{
    ref: string;
    fromScreen: string;
    category: string;
    evidence: string;
   }> = [];
   const re = /"from": "(P\d+)",\s*"ref": "(e\d+)",\s*"text": "([^"]*)"/g;
   let m: RegExpExecArray | null;
   while ((m = re.exec(prompt)) !== null) {
    classifications.push({
     ref: m[2],
     fromScreen: m[1],
     category: /finalizar|compra|borrar|eliminar/i.test(m[3])
      ? "destructiva-vetada"
      : "desconocida",
     evidence:
      "snapshot de " +
      m[1] +
      " — ref " +
      m[2] +
      ' "' +
      m[3] +
      '" (clasificación mock)',
    });
   }
   return {
    classifications,
    summary: classifications.length + " aristas clasificadas (mock)",
   };
  }
  // Matrix — ancla: bloque "## Endpoints observados".
  if (prompt.includes("## Endpoints observados")) {
   const externo = prompt.includes("externo:");
   const sinCandidatas = prompt.includes("VACÍO (degradación registrada)");
   if (sinCandidatas) {
    // Fix plan review Step 5 (B3): sin candidatas de zona muerta — el SCRIPT
    // ya registró la degradación "no enumerable"; el mock responde la
    // correlación endpoint↔módulo en modo externo (contrato de tests 3 y 4)
    // con deadZone/degradations vacías (la degradación no se duplica).
    return {
     matrix: externo
      ? [
         {
          screenIds: [],
          endpoints: [{ id: "E01", method: "GET", path: "/api/ordenes" }],
          modules: [{ path: "src/server.js", evidence: "src/server.js:3" }],
          evidence: "E01 · src/server.js:3",
         },
         {
          screenIds: [],
          endpoints: [{ method: "POST", path: "/api/ordenes" }],
          modules: [],
          evidence: "sin módulo localizable",
         },
        ]
      : [],
     orphans: externo
      ? {
         apiSinUi: [
          {
           method: "POST",
           path: "/api/ordenes",
           note: "sin pantalla (HAR externo sin correlación)",
          },
         ],
         uiSinCodigo: [],
        }
      : { apiSinUi: [], uiSinCodigo: [] },
     deadZone: [],
     toolsUsed: [],
     degradations: [],
     summary:
      "sin candidatas de zona muerta (degradación registrada por el script)",
    };
   }
   return {
    matrix: externo
     ? [
        {
         screenIds: [],
         endpoints: [{ id: "E01", method: "GET", path: "/api/ordenes" }],
         modules: [{ path: "src/server.js", evidence: "src/server.js:3" }],
         evidence: "E01 · src/server.js:3",
        },
        {
         screenIds: [],
         endpoints: [{ method: "POST", path: "/api/ordenes" }],
         modules: [],
         evidence: "sin módulo localizable",
        },
       ]
     : [
        {
         functionality: "P02 Productos",
         screenIds: ["P02"],
         endpoints: [{ id: "E02", method: "GET", path: "/api/productos" }],
         modules: [{ path: "src/server.js", evidence: "src/server.js:2" }],
         evidence: "P02 · E02 · src/server.js:2",
        },
        {
         functionality: "P03 Producto Detalle",
         screenIds: ["P03"],
         endpoints: [{ method: "GET", path: "/api/productos/1" }],
         modules: [{ path: "src/server.js", evidence: "src/server.js:3" }],
         evidence: "P03 · GET /api/productos/1 · src/server.js:3",
        },
        {
         functionality: "P05 Perfil",
         screenIds: ["P05"],
         endpoints: [{ method: "POST", path: "/api/perfil" }],
         modules: [{ path: "src/server.js", evidence: "src/server.js:5" }],
         evidence: "P05 · POST 422 · src/server.js:5",
        },
       ],
    orphans: externo
     ? {
        apiSinUi: [
         {
          method: "POST",
          path: "/api/ordenes",
          note: "sin pantalla (HAR externo sin correlación)",
         },
        ],
        uiSinCodigo: [],
       }
     : { apiSinUi: [], uiSinCodigo: [] },
    deadZone: [
     {
      method: "GET",
      path: "/api/reportes-legado",
      status: "probablemente-viva",
      evidence: "src/server.js:4 — alcanzable por arista descubierta del grafo",
     },
    ],
    toolsUsed: ["symbol_search", "implementation_lookup"],
    degradations: [],
    summary: "correlación mock con sabor a moat",
   };
  }
  // Juez — ancla: bloque "## Entregables a auditar".
  if (prompt.includes("## Entregables a auditar")) {
   const cut = prompt.match(/stoppedBy="(budget|time)"/);
   if (cut) {
    return {
     decision: "CONCERNS",
     findings: [
      {
       severity: "MEDIUM",
       evidence:
        "gap documentado: corrida cortada por " +
        cut[1] +
        " (stoppedBy del inventario)",
       fix: "relanzar con presupuesto mayor para cubrir lo faltante",
      },
     ],
     summary: "corte conocido",
    };
   }
   if (opts.judgeDecision === "FAIL") {
    return {
     decision: "FAIL",
     findings: [
      {
       severity: "CRITICAL",
       evidence:
        "docs/api/openapi.json omite GET /api/productos/1 presente en artifacts/requests.jsonl sin razón",
       fix: "regenerar la spec desde el carve",
      },
     ],
     summary: "claim falsa",
    };
   }
   return {
    decision: opts.judgeDecision ?? "PASS",
    findings: [],
    summary: "auditoría mock",
   };
  }
  return "echo: " + prompt.slice(0, 40);
 }) as unknown as SpawnAgentFn;

// ── Tipos del inventario/return leídos del disco (contrato del Slice 2) ────

interface InventoryScreen {
 id: string;
 canon: string;
 title: string;
 firstSeenEpoch: number;
 validationEvidence: string[];
}

interface InventoryAction {
 step: number;
 screenId: string;
 kind: string;
 ref: string;
 outcome: string;
 epoch: number;
}

interface InventoryEndpoint {
 id: string;
 method: string;
 path: string;
 count: number;
 statuses: string[];
 screens: string[];
}

interface InventoryGraphEdge {
 type: string;
 from: string;
 to: string;
 via?: { ref?: string };
 cause?: string;
 category?: string;
}

interface Inventory {
 run: { mode: string; appOrigin: string; startedAtEpoch: number };
 capabilities: {
  lensAvailable: boolean;
  codebaseIndexAvailable: boolean;
  indexPresent: boolean;
 };
 siblings: { funcional: boolean; entendimiento: boolean };
 degradations: Array<{ phase: string; tool: string; reason: string }>;
 screens: InventoryScreen[];
 actionLog: InventoryAction[];
 endpoints: InventoryEndpoint[];
 thirdParty: Array<{ origin: string; count: number }>;
 matrix: Array<{ id: string; functionality: string }>;
 orphans: { apiSinUi: unknown[]; uiSinCodigo: unknown[] };
 deadZone: Array<{ path: string; status: string }>;
 graph: {
  source: string;
  nodes: Array<{ id: string }>;
  edges: InventoryGraphEdge[];
  frontier: {
   motive: string;
   hasFailedInteractions: boolean;
   discovered: number;
  };
  nodeErrors: Record<
   string,
   Array<{ kind: string; evidence: string; step?: number }>
  >;
 };
 boundary: { classified: number; discovered: number } | null;
 stoppedBy: string;
 stoppedByTime: boolean;
}

interface T2aResult {
 pattern: string;
 mode: string;
 appOrigin: string;
 screens: number;
 steps: number;
 requests: { total: number; sameOrigin: number; thirdParty: number };
 endpoints: number;
 openapi: { paths: number; operations: number };
 matrixRows: number;
 orphans: { apiSinUi: number; uiSinCodigo: number };
 deadZone: number;
 graph: { nodes: number; edges: number; frontierDiscovered: number };
 stoppedBy: string;
 stoppedByTime: boolean;
 degradations: number;
 coverage: string;
 docs: Record<string, string>;
 judge: {
  decision: string;
  findings: Array<{ severity: string; evidence: string; fix: string }>;
  summary: string;
 };
}

const DOC = "docs/api";

function readInv(base: string): Inventory {
 return JSON.parse(
  readFileSync(join(base, DOC, "artifacts/inventory.json"), "utf-8"),
 ) as Inventory;
}

function docPath(base: string, rel: string): string {
 return join(base, DOC, rel);
}

function readJsonl(base: string, rel: string): Array<Record<string, unknown>> {
 const text = readFileSync(docPath(base, rel), "utf-8").trim();
 if (!text) return [];
 return text.split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** SAFETY: el return del workflow es el objeto del contrato del Slice 2 —
 *  lo produce el script del patrón; el cast cruza la frontera JsonValue. */
function asResult(value: unknown): T2aResult {
 return value as T2aResult;
}

describe("frida-traffic2api · e2e sobre el motor (#135)", () => {
 it("recorrido feliz walk: 5 pantallas, HAR→openapi, join temporal, scrub, frontera clasificada", async () => {
  fixtureRepoServer(cwd);
  // FAKE_DATE: el join temporal (asserts screenId por petición) exige
  // ventanas [epoch(N), epoch(N+1)) que NUNCA colapsen — con date real
  // (1 s de granularidad) pasos sub-segundo harían el assert flaky.
  writeFakeDate();
  const args = { url: BASE + "/inicio", maxScreens: 0, review: "auto" };
  const script = TRAFFIC2API_PATTERN.resolve(args, { cwd });
  const seen: string[] = [];

  const { result } = await runWorkflowInStore({
   name: "traffic2api",
   script,
   args,
   cwd,
   sessionId: "sess-t2a-1",
   spawnAgent: makeSpawn({}, seen),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.pattern).toBe("traffic2api");
  expect(r.mode).toBe("walk");
  expect(r.appOrigin).toBe(BASE);
  expect(r.screens).toBe(5);
  expect(r.steps).toBe(8);
  expect(r.stoppedBy).toBe("done");
  expect(r.requests).toEqual({ total: 13, sameOrigin: 13, thirdParty: 0 });
  expect(r.endpoints).toBe(7);
  expect(r.openapi).toEqual({ paths: 6, operations: 7 });
  expect(r.matrixRows).toBe(3);
  expect(r.deadZone).toBe(1);
  expect(r.graph.nodes).toBe(5);
  expect(r.degradations).toBe(3); // index_codebase + docs-funcional + docs-entendimiento
  expect(r.coverage).toContain("PARCIAL");
  expect(r.judge.decision).toBe("PASS");

  // Entregables en disco (ninguno pre-creado por el test).
  for (const rel of [
   "README.md",
   "openapi.json",
   "matriz.md",
   "navegacion.md",
   "artifacts/inventory.json",
   "artifacts/nav-graph.json",
   "artifacts/requests.jsonl",
   "artifacts/payloads.jsonl",
   "artifacts/endpoints.json",
   "artifacts/timeline.json",
   "artifacts/raw.har",
  ]) {
   expect(existsSync(docPath(cwd, rel)), rel).toBe(true);
  }
  const stepsDir = readdirSync(join(cwd, DOC, "artifacts/steps"));
  expect(stepsDir.filter((f) => f.endsWith("-snapshot.json"))).toHaveLength(8);
  expect(stepsDir.filter((f) => f.endsWith("-validation.json"))).toHaveLength(
   1,
  );
  expect(
   existsSync(join(cwd, DOC, "artifacts/steps/007-validation.json")),
  ).toBe(true);
  const shots = readdirSync(join(cwd, DOC, "screenshots"));
  expect(shots).toHaveLength(5);
  expect(shots).toContain("P01-inicio.png");
  for (const shot of shots) {
   expect(statSync(join(cwd, DOC, "screenshots", shot)).size).toBeGreaterThan(
    0,
   );
  }

  // Spec OpenAPI: 3.1, servers, colapso {id}, 422 documentado, scrub.
  const spec = JSON.parse(
   readFileSync(docPath(cwd, "openapi.json"), "utf-8"),
  ) as {
   openapi: string;
   servers: Array<{ url: string }>;
   paths: Record<
    string,
    Record<string, { responses: Record<string, unknown> }>
   >;
  };
  expect(spec.openapi).toBe("3.1.0");
  expect(spec.servers[0]?.url).toBe(BASE);
  expect(Object.keys(spec.paths)).toContain("/api/productos/{id}");
  expect(spec.paths["/api/perfil"]?.post?.responses["422"]).toBeTruthy();
  const specText = JSON.stringify(spec);
  expect(specText).not.toContain("sekret-token-mock");
  expect(specText).not.toContain("Bearer");

  // Join temporal (D5): la petición se atribuye a la pantalla ORIGEN del paso.
  const reqs = readJsonl(cwd, "artifacts/requests.jsonl");
  expect(reqs).toHaveLength(13);
  const detalle = reqs.find((l) => String(l.path) === "/api/productos/1");
  expect(detalle?.screenId).toBe("P02");
  const carrito = reqs.find((l) => String(l.path) === "/api/carrito");
  expect(carrito?.screenId).toBe("P02");
  const post = reqs.find((l) => String(l.method) === "POST");
  expect(post?.screenId).toBe("P05");
  expect(post?.status).toBe(422);
  const jsonlText = readFileSync(
   docPath(cwd, "artifacts/requests.jsonl"),
   "utf-8",
  );
  expect(jsonlText).not.toContain("sekret-token-mock");
  const pays = readJsonl(cwd, "artifacts/payloads.jsonl");
  expect(pays).toHaveLength(1);
  expect(pays[0]?.body).toBe('{"nombre":""}');

  // Inventario: IDs estables, degradaciones bootstrap, grafo, boundary.
  const inv = readInv(cwd);
  expect(inv.run.mode).toBe("walk");
  expect(inv.capabilities).toMatchObject({
   lensAvailable: false,
   codebaseIndexAvailable: false,
  });
  expect(inv.siblings).toEqual({ funcional: false, entendimiento: false });
  // Fases EXACTAS del locked: index_codebase en bootstrap; docs-funcional y
  // docs-entendimiento se registran con phase "matrix" explícita (D10).
  expect(inv.degradations.map((d) => d.phase)).toEqual([
   "bootstrap",
   "matrix",
   "matrix",
  ]);
  expect(inv.endpoints.map((e) => e.id)).toEqual([
   "E01",
   "E02",
   "E03",
   "E04",
   "E05",
   "E06",
   "E07",
  ]);
  expect(inv.endpoints[0]).toMatchObject({
   method: "GET",
   path: "/api/config",
   count: 3,
  });
  expect(
   inv.endpoints.find((e) => e.path === "/api/productos/{id}")?.statuses,
  ).toEqual(["200"]);
  const post422 = inv.endpoints.find((e) => e.method === "POST");
  expect(post422?.statuses).toEqual(["422"]);
  expect(inv.thirdParty).toEqual([]);
  // Grafo: 5 traversed, 2 attempted-failed (no-progression + app-validation),
  // discovered ≥ 8 con ≥ 1 destructiva-vetada; errores por nodo en P05.
  const edges = inv.graph.edges;
  expect(edges.filter((e) => e.type === "traversed")).toHaveLength(5);
  const attempted = edges.filter((e) => e.type === "attempted-failed");
  expect(attempted.map((e) => e.cause).sort()).toEqual([
   "app-validation",
   "no-progression",
  ]);
  expect(attempted.find((e) => e.cause === "app-validation")?.via?.ref).toBe(
   "@e4",
  );
  const discovered = edges.filter((e) => e.type === "discovered");
  expect(discovered.length).toBeGreaterThanOrEqual(8);
  expect(
   discovered.filter((e) => e.category === "destructiva-vetada"),
  ).toHaveLength(1);
  expect(inv.graph.frontier.motive).toBe("agotamiento-real");
  expect(inv.graph.frontier.hasFailedInteractions).toBe(true);
  expect(inv.graph.nodeErrors["P05"]).toHaveLength(1);
  expect(inv.graph.nodeErrors["P05"][0]?.kind).toBe("validation");
  expect(inv.boundary?.discovered).toBe(discovered.length);
  // Consumo per-screen con el contrato real (mapa sin "@"): los refs
  // ejercidos NO aparecen en la frontera (fix cascade verificado).
  expect(
   discovered.find((e) => e.from === "P01" && e.via?.ref === "e1"),
  ).toBeUndefined();

  // navegacion.md: mermaid + motivo + frontera clasificada.
  const nav = readFileSync(docPath(cwd, "navegacion.md"), "utf-8");
  expect(nav).toContain("graph TD");
  expect(nav).toContain("agotamiento real");
  expect(nav).toContain("## Frontera no explorada");
  expect(nav).toContain("destructiva-vetada");
  // matriz.md: módulo con evidencia + zona muerta calificada.
  const matriz = readFileSync(docPath(cwd, "matriz.md"), "utf-8");
  expect(matriz).toContain("| Funcionalidad |");
  expect(matriz).toContain("src/server.js");
  expect(matriz).toContain("probablemente-viva");
  // Contrato del judge (D10): contexto de corte con degradations=N.
  expect(
   seen.some(
    (p) =>
     p.includes("## Entregables a auditar") && p.includes("degradations="),
   ),
  ).toBe(true);
  expect(seen.some((p) => p.includes("## Capacidades del moat"))).toBe(true);
 }, 45000);

 it("corta por presupuesto (maxScreens=2): checkpoint manual, zona muerta probablemente-viva, judge CONCERNS", async () => {
  fixtureRepoServer(cwd);
  const args = { url: BASE + "/inicio", maxScreens: 2 };
  const script = TRAFFIC2API_PATTERN.resolve(args, { cwd });
  const checkpoints: Array<{ name: string }> = [];
  const runId = randomUUID();

  const promise = runWorkflowInStore({
   name: "traffic2api",
   script,
   args,
   cwd,
   sessionId: "sess-t2a-2",
   spawnAgent: makeSpawn(),
   home,
   runId,
   foreground: false,
   onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
  });

  await waitUntil(() => checkpoints.length >= 1);
  expect(checkpoints[0].name).toBe("traffic2api-final");
  resolveCheckpoint(runId, "traffic2api-final", true);

  const { result } = await promise;
  const r = asResult(result);
  expect(r.screens).toBe(2);
  expect(r.steps).toBe(3);
  expect(r.stoppedBy).toBe("budget");
  expect(r.requests).toEqual({ total: 4, sameOrigin: 4, thirdParty: 0 });
  expect(r.endpoints).toBe(3);
  expect(r.deadZone).toBe(1);
  expect(r.judge.decision).toBe("CONCERNS");

  const inv = readInv(cwd);
  expect(inv.screens.map((s) => s.id)).toEqual(["P01", "P02"]);
  expect(inv.graph.frontier.motive).toBe("corte-presupuesto");
  // Zona muerta enumerable: el grep REAL de Express matcheó el repo fixture.
  const cand = readFileSync(
   docPath(cwd, "artifacts/deadzone-candidates.txt"),
   "utf-8",
  );
  expect(cand).toContain("/api/reportes-legado");
  expect(inv.deadZone[0]).toMatchObject({
   path: "/api/reportes-legado",
   status: "probablemente-viva",
  });
  // La frontera del corte clasificada (boundary corrió).
  expect(inv.graph.frontier.discovered).toBeGreaterThanOrEqual(3);
  const nav = readFileSync(docPath(cwd, "navegacion.md"), "utf-8");
  expect(nav).toContain("corte de presupuesto (budget)");
  expect(nav).toContain("## Frontera no explorada");
  // Evidencia del walk cortado: 3 snapshots (el corte fue ANTES del agente).
  const stepsDir = readdirSync(join(cwd, DOC, "artifacts/steps"));
  expect(stepsDir.filter((f) => f.endsWith("-snapshot.json"))).toHaveLength(3);
  expect(readdirSync(join(cwd, DOC, "screenshots"))).toHaveLength(2);
 }, 45000);

 it("corta por wall-clock (maxMinutes=2) marcando stoppedByTime; entregables siguen", async () => {
  writeFakeDate(); // +30 s por epoch: deadline vence en el paso 2
  const args = {
   url: BASE + "/inicio",
   maxScreens: 0,
   maxMinutes: 2,
   review: "auto",
  };
  const script = TRAFFIC2API_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "traffic2api",
   script,
   args,
   cwd,
   sessionId: "sess-t2a-3",
   spawnAgent: makeSpawn(),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.stoppedBy).toBe("time");
  expect(r.stoppedByTime).toBe(true);
  expect(r.screens).toBe(1);
  expect(r.steps).toBe(2);
  expect(r.requests.sameOrigin).toBe(3); // session + config + productos
  // El corte por tiempo NO aborta: ingest/spec/graph/matrix/synthesize/judge siguen.
  expect(existsSync(docPath(cwd, "README.md"))).toBe(true);
  expect(existsSync(docPath(cwd, "openapi.json"))).toBe(true);
  const inv = readInv(cwd);
  expect(inv.stoppedByTime).toBe(true);
  expect(inv.graph.frontier.motive).toBe("corte-presupuesto");
  expect(r.judge.decision).toBe("CONCERNS"); // gap conocido → CONCERNS
  // Sin repo fixture: zona muerta no enumerable (degradación honesta).
  expect(r.deadZone).toBe(0);
  expect(inv.degradations.some((d) => d.reason.includes("no enumerable"))).toBe(
   true,
  );
 }, 30000);

 it("modo externo devtools sin hermanos: degradaciones honestas, matriz 2 columnas, scrub de payload, censo terceros", async () => {
  const harPath = fixtureExternalHar(cwd, devtoolsHar());
  const args = { harPath, review: "auto" };
  const script = TRAFFIC2API_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "traffic2api",
   script,
   args,
   cwd,
   sessionId: "sess-t2a-4",
   spawnAgent: makeSpawn(),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.mode).toBe("externo");
  expect(r.appOrigin).toBe(BASE);
  expect(r.requests).toEqual({ total: 7, sameOrigin: 5, thirdParty: 1 });
  expect(r.endpoints).toBe(4);
  expect(r.matrixRows).toBe(2);
  expect(r.orphans.apiSinUi).toBe(1);
  expect(r.deadZone).toBe(0); // sin repo fixture ni semilla → no enumerable
  // 5 degradaciones honestas: index + docs-funcional + docs-entendimiento
  // + grafo no derivable + zona muerta no enumerable.
  expect(r.degradations).toBe(5);
  expect(r.judge.decision).toBe("PASS");

  // El walk NO corrió: steps/ y screenshots/ existen (mkdir -p del
  // bootstrap) pero VACÍOS — D12 marca "solo modo walk" el contenido.
  expect(readdirSync(join(cwd, DOC, "artifacts/steps"))).toHaveLength(0);
  expect(readdirSync(join(cwd, DOC, "screenshots"))).toHaveLength(0);

  const inv = readInv(cwd);
  // Join temporal ausente (sin walk): screenless, sin screenId.
  const reqs = readJsonl(cwd, "artifacts/requests.jsonl");
  expect(reqs).toHaveLength(5);
  expect(reqs.every((l) => !l.screenId)).toBe(true);
  // Colapso {id}: numérico Y uuid → /api/productos/{id} con 200+404.
  const pid = inv.endpoints.find((e) => e.path === "/api/productos/{id}");
  expect(pid?.count).toBe(2);
  expect(pid?.statuses).toEqual(["200", "404"]);
  // Censo de terceros como anexo.
  expect(inv.thirdParty).toEqual([
   { origin: "https://cdn.ejemplo.com", count: 2 },
  ]);

  // Scrub de payload (NFR Security): el token del POST → [REDACTADO].
  const specText = readFileSync(docPath(cwd, "openapi.json"), "utf-8");
  expect(specText).toContain("[REDACTADO]");
  expect(specText).toContain("acme");
  expect(specText).not.toContain("sekret-token-mock");
  expect(specText).not.toContain("Bearer");
  // Matriz degradada a 2 columnas (sin docs/funcional ni walk).
  const matriz = readFileSync(docPath(cwd, "matriz.md"), "utf-8");
  expect(matriz).toContain("| Endpoint | Módulo(s) |");
  expect(matriz).not.toContain(
   "| Funcionalidad | Endpoints | Módulo(s) | Evidencia |",
  );
  // Grafo no derivable: gap registrado, no inventado.
  const nav = readFileSync(docPath(cwd, "navegacion.md"), "utf-8");
  expect(nav).toContain("(no derivable)");
  expect(inv.graph.source).toBe("ninguno");
  // README con anexo de terceros.
  const readme = readFileSync(docPath(cwd, "README.md"), "utf-8");
  expect(readme).toContain("cdn.ejemplo.com");
 }, 45000);

 it("modo externo mitmproxy con docs M8: grafo derivado-de-m8, aristas fallidas, matriz 3 columnas", async () => {
  fixtureRepoServer(cwd);
  fixtureM8Docs(cwd);
  const harPath = fixtureExternalHar(cwd, mitmproxyHar());
  const args = { harPath, review: "auto" };
  const script = TRAFFIC2API_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "traffic2api",
   script,
   args,
   cwd,
   sessionId: "sess-t2a-5",
   spawnAgent: makeSpawn(),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.mode).toBe("externo");
  expect(r.endpoints).toBe(5);
  expect(r.matrixRows).toBe(2);
  expect(r.deadZone).toBe(1);
  // Solo 2 degradaciones (index + docs-entendimiento): docs/funcional existe.
  expect(r.degradations).toBe(2);
  expect(r.judge.decision).toBe("PASS"); // stoppedBy="" → sin corte

  const inv = readInv(cwd);
  expect(inv.siblings).toEqual({ funcional: true, entendimiento: false });
  // Grafo derivado del inventory de M8 (D8, req 12).
  expect(inv.graph.source).toBe("m8");
  expect(inv.graph.nodes.map((n) => n.id)).toEqual(["P01", "P02"]);
  const edges = inv.graph.edges;
  expect(edges.filter((e) => e.type === "traversed")).toHaveLength(1);
  const attempted = edges.filter((e) => e.type === "attempted-failed");
  expect(attempted.map((e) => e.cause).sort()).toEqual([
   "app-validation",
   "shell-error",
  ]);
  // Errores por nodo citando step y archivo (req 15).
  const p02Errors = inv.graph.nodeErrors["P02"];
  expect(p02Errors).toHaveLength(2);
  expect(p02Errors?.find((e) => e.kind === "validation")?.evidence).toContain(
   "003-validation.json",
  );
  const failed = p02Errors?.find((e) => e.kind === "failed-action");
  expect(failed?.step).toBe(2);
  expect(failed?.evidence).toContain("002-snapshot.json");
  // Frontera derivada del fixture (refs mapa real → fix cascade ejercitado).
  expect(inv.graph.frontier.motive).toBe("derivado-de-m8");
  expect(inv.graph.frontier.discovered).toBe(3);
  const nav = readFileSync(docPath(cwd, "navegacion.md"), "utf-8");
  expect(nav).toContain("derivado de docs/funcional (M8)");
  // Matriz con columna Funcionalidad (docs M8 presentes).
  const matriz = readFileSync(docPath(cwd, "matriz.md"), "utf-8");
  expect(matriz).toContain("| Funcionalidad |");
  // Errores HTTP documentados: 401 y 500 en la tabla de endpoints.
  const statuses = inv.endpoints.flatMap((e) => e.statuses);
  expect(statuses).toContain("401");
  expect(statuses).toContain("500");
 }, 45000);

 it("HAR vacío y walk cross-origin: errores accionables con censo de dominios (NFR Reliability)", async () => {
  // (A) HAR externo sin entries → error con conteo (cwd propio, awaited).
  const cwdA = mkdtempSync(join(tmpdir(), "t2a-e2e-empty-"));
  try {
   const harA = fixtureExternalHar(cwdA, {
    log: { version: "1.2", creator: {}, entries: [] },
   });
   const promiseA = runWorkflowInStore({
    name: "traffic2api",
    script: TRAFFIC2API_PATTERN.resolve(
     { harPath: harA, review: "auto" },
     { cwd: cwdA },
    ),
    args: { harPath: harA, review: "auto" },
    cwd: cwdA,
    sessionId: "sess-t2a-6a",
    spawnAgent: makeSpawn(),
    home,
    runId: randomUUID(),
    foreground: false,
   });
   await expect(promiseA).rejects.toThrow(/0 entradas/);
  } finally {
   rmSync(cwdA, { recursive: true, force: true });
  }

  // (B) Walk cuyo origen (args.url) NO coincide con el tráfico capturado:
  // el mock solo genera tráfico de app.ejemplo.com; con url de otra app el
  // carve reporta 0 same-origin y el error trae el CENSO de dominios.
  // (En modo externo este error es inalcanzable: el carve infiere el
  // origin más frecuente del propio HAR y siempre matchea ≥1 entrada.)
  const cwdB = mkdtempSync(join(tmpdir(), "t2a-e2e-cross-"));
  try {
   const args = {
    url: "https://otra-app.ejemplo.com/inicio",
    maxScreens: 5,
    review: "auto",
   };
   const script = TRAFFIC2API_PATTERN.resolve(args, { cwd: cwdB });
   const promiseB = runWorkflowInStore({
    name: "traffic2api",
    script,
    args,
    cwd: cwdB,
    sessionId: "sess-t2a-6b",
    spawnAgent: makeSpawn(),
    home,
    runId: randomUUID(),
    foreground: false,
   });
   await expect(promiseB).rejects.toThrow(/0 same-origin/);
   await expect(promiseB).rejects.toThrow(/app\.ejemplo\.com/);
  } finally {
   rmSync(cwdB, { recursive: true, force: true });
  }
 }, 30000);

 it("juez FAIL no aborta: el veredicto viaja en el return con findings", async () => {
  const args = { url: BASE + "/inicio", maxScreens: 0, review: "auto" };
  const script = TRAFFIC2API_PATTERN.resolve(args, { cwd });

  const { result } = await runWorkflowInStore({
   name: "traffic2api",
   script,
   args,
   cwd,
   sessionId: "sess-t2a-7",
   spawnAgent: makeSpawn({ judgeDecision: "FAIL" }),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  const r = asResult(result);
  expect(r.judge.decision).toBe("FAIL");
  expect(r.judge.findings[0]?.severity).toBe("CRITICAL");
  expect(r.judge.findings[0]?.evidence).toMatch(/openapi\.json/);
  // El FAIL del juez NO aborta: los entregables quedaron en disco.
  expect(existsSync(docPath(cwd, "README.md"))).toBe(true);
 }, 30000);

 it("gate de sesión muerta: el bootstrap falla con la receta", async () => {
  mkdirSync(join(binDir, "state"), { recursive: true });
  writeFileSync(join(binDir, "state", "dead"), "1", "utf-8");
  const args = { url: BASE + "/inicio", maxScreens: 2, review: "auto" };
  const script = TRAFFIC2API_PATTERN.resolve(args, { cwd });

  const promise = runWorkflowInStore({
   name: "traffic2api",
   script,
   args,
   cwd,
   sessionId: "sess-t2a-8",
   spawnAgent: makeSpawn(),
   home,
   runId: randomUUID(),
   foreground: false,
  });

  await expect(promise).rejects.toThrow(/no está viva/);
 }, 30000);

 it("inventario determinista: dos corridas idénticas → inventarios deep-equal", async () => {
  writeFakeDate();
  const runOnce = async () => {
   const runCwd = mkdtempSync(join(tmpdir(), "t2a-e2e-det-"));
   fixtureRepoServer(runCwd);
   // El contador del date falso se resetea por corrida: epochs idénticos.
   rmSync(join(binDir, "date.n"), { force: true });
   const args = { url: BASE + "/inicio", maxScreens: 0, review: "auto" };
   const script = TRAFFIC2API_PATTERN.resolve(args, { cwd: runCwd });
   await runWorkflowInStore({
    name: "traffic2api",
    script,
    args,
    cwd: runCwd,
    sessionId: "sess-t2a-det",
    spawnAgent: makeSpawn(),
    home,
    runId: randomUUID(),
    foreground: false,
   });
   const inv = readInv(runCwd);
   rmSync(runCwd, { recursive: true, force: true });
   return inv;
  };
  const first = await runOnce();
  const second = await runOnce();
  expect(second.screens).toEqual(first.screens);
  expect(second.endpoints).toEqual(first.endpoints);
  expect(second.matrix).toEqual(first.matrix);
  expect(second.graph.edges).toEqual(first.graph.edges);
  expect(second.actionLog.map((a) => a.kind)).toEqual(
   first.actionLog.map((a) => a.kind),
  );
 }, 60000);
});

/** waitUntil mínimo sin importar el helper del suite de workflows (molde M8). */
async function waitUntil(cond: () => boolean, ms = 10000): Promise<void> {
 const deadline = Date.now() + ms;
 while (!cond()) {
  if (Date.now() > deadline) throw new Error("timeout esperando condición");
  await new Promise((res) => setTimeout(res, 20));
 }
}
