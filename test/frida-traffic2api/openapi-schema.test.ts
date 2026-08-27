// frida-traffic2api — validación typebox host-side de openapi.json (issue #135).
//
// D7 capa 2 — el criterio de aceptación host-side del FRD: un schema TypeBox
// del OpenAPI 3.1 MÍNIMO que emite SPEC_BUILDER_SOURCE (el agregador del
// Slice 2) valida tres cosas:
//   1. Fixtures inline derivadas del agregador (sabor devtools/mitmproxy).
//   2. Anti-fixtures — el schema tiene dientes (rechaza 3.0.0, paths
//      ausente, operación sin responses, info sin version).
//   3. El ARTEFACTO REAL de una corrida e2e compacta en modo externo sobre
//      el motor real (runWorkflowInStore). El modo externo NO llama
//      agent-browser (bootstrap = test -s + cp del HAR) → sin mock de
//      binario; solo matrix/judge se mockean por anclas de runtime context
//      (contrato del Slice 2: "## Endpoints observados" / "## Entregables
//      a auditar").
//
// El schema vive test-local a propósito: es un criterio de aceptación, no
// una API del pack (D7: la capa 1 —gate de forma— ya vive in-run).
// Precedentes: src/tools/frida-pipeline/models-config.ts:19 (imports
// typebox + typebox/value host-side, pin 1.1.38 ESM-only) y
// src/tools/frida-workflow/schema.ts:50-55 (Value.Check/Value.Errors).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
 mkdirSync,
 mkdtempSync,
 readFileSync,
 rmSync,
 writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { TRAFFIC2API_PATTERN } from "../../src/tools/frida-traffic2api";

// ── Schema: el OpenAPI 3.1 mínimo que produce SPEC_BUILDER_SOURCE (D7) ────

/** Vocabulario de métodos OpenAPI (el agregador emite method.toLowerCase()). */
const OAS_METHODS = [
 "get",
 "put",
 "post",
 "delete",
 "options",
 "head",
 "patch",
 "trace",
] as const;

const ResponseSchema = Type.Object({
 description: Type.String(),
 // SPEC_BUILDER: content[mimeDominante] = {} — opcional por status.
 content: Type.Optional(Type.Record(Type.String(), Type.Object({}))),
});

const OperationSchema = Type.Object({
 summary: Type.String(),
 // Statuses observados como keys ("200".."599"; "default" cuando status 0).
 responses: Type.Record(Type.String(), ResponseSchema),
 requestBody: Type.Optional(
  Type.Object({
   content: Type.Object({
    "application/json": Type.Object({
     // Scrub determinista: objeto limpio o "[REDACTADO-por-seguridad]".
     example: Type.Unknown(),
    }),
   }),
  }),
 ),
});

/** Schema TypeBox del artefacto openapi.json (criterio de aceptación D7). */
const OpenApi31Schema = Type.Object({
 openapi: Type.Literal("3.1.0"),
 info: Type.Object({
  title: Type.String(),
  version: Type.String(),
  description: Type.String(),
 }),
 servers: Type.Array(Type.Object({ url: Type.String() })),
 // Claves de método como string a propósito (no Record con union de
 // literales: sin precedente en el repo y el pin 1.1.38 no lo ejercita) —
 // el vocabulario OAS se asserta en plano sobre el artefacto real, abajo.
 paths: Type.Record(Type.String(), Type.Record(Type.String(), OperationSchema)),
});

/** Assert con diagnóstico: al fallar muestra los errores de Value.Errors.
 *  typebox v1.1.x usa `instancePath` (JSON-pointer "/a/b"), no `path`
 *  (lección de src/tools/frida-workflow/schema.ts:53-55). */
function expectValid(schema: TSchema, value: unknown): void {
 const errors = [...Value.Errors(schema, value)].map(
  (e) => `${e.instancePath || "/"}: ${e.message}`,
 );
 expect(errors, errors.join(" | ")).toEqual([]);
}

/** Borra una key sin pelearse con el checker de `delete` (props requeridas). */
function dropKey(obj: object, key: string): void {
 delete (obj as Record<string, unknown>)[key];
}

// ── Fixtures: salida esperada del agregador (sabor de los HARs del e2e) ────

/** Descripción literal que emite SPEC_BUILDER_SOURCE (fidelidad al productor). */
const SPEC_DESCRIPTION =
 "Spec derivada DETERMINISTAMENTE del tráfico observado por traffic2api (frida-traffic2api). Documenta lo observado — errores 4xx/5xx incluidos; NO es una spec autorativa ni infiere schemas de ejemplos. Los ejemplos de payload están scrubbeados de secretos.";

/** Sabor devtools: colapso {id} (numérico), 404 documentado, POST con token
 *  scrubbeado a [REDACTADO] — lo que el agregador produce para el HAR
 *  devtools del e2e (Slice 5). */
function devtoolsSpecFixture() {
 return {
  openapi: "3.1.0",
  info: {
   title: "https://app.ejemplo.com",
   version: "0.1.0-observada",
   description: SPEC_DESCRIPTION,
  },
  servers: [{ url: "https://app.ejemplo.com" }],
  paths: {
   "/api/productos": {
    get: {
     summary: "1 llamada(s) observada(s)",
     responses: {
      "200": {
       description: "observado 1 vez/veces",
       content: { "application/json": {} },
      },
     },
    },
   },
   "/api/productos/{id}": {
    get: {
     summary: "2 llamada(s) observada(s)",
     responses: {
      "200": {
       description: "observado 1 vez/veces",
       content: { "application/json": {} },
      },
      "404": { description: "observado 1 vez/veces" },
     },
    },
   },
   "/api/ordenes": {
    post: {
     summary: "1 llamada(s) observada(s)",
     responses: { "201": { description: "observado 1 vez/veces" } },
     requestBody: {
      content: {
       "application/json": {
        example: { cliente: "acme", token: "[REDACTADO]" },
       },
      },
     },
    },
   },
  },
 };
}

/** Sabor mitmproxy: rama del agregador SIN origin (servers vacíos, título
 *  default), 401/500 documentados, respuesta "default" (status 0 del carve)
 *  y payload no-JSON redactado entero ("[REDACTADO-por-seguridad]"). */
function mitmproxySpecFixture() {
 return {
  openapi: "3.1.0",
  info: {
   title: "API observada",
   version: "0.1.0-observada",
   description: "(descripción abreviada — el schema solo exige string)",
  },
  servers: [],
  paths: {
   "/api/login": {
    post: {
     summary: "1 llamada(s) observada(s)",
     responses: {
      "401": { description: "observado 1 vez/veces" },
      default: { description: "observado 1 vez/veces" },
     },
     requestBody: {
      content: {
       "application/json": { example: "[REDACTADO-por-seguridad]" },
      },
     },
    },
   },
   "/api/reportes": {
    get: {
     summary: "1 llamada(s) observada(s)",
     responses: {
      "500": {
       description: "observado 1 vez/veces",
       content: { "application/json": {} },
      },
     },
    },
   },
  },
 };
}

// ── Mini HAR + agente mock para la corrida real compacta ───────────────────

interface MiniEntry {
 method: string;
 url: string;
 status: number;
 body?: string;
}

/** Mini HAR devtools-flavored (compacto, misma forma que harEntry del e2e):
 *  TODAS las entries llevan Authorization — la garantía estructural del
 *  carve (NUNCA extrae headers) se asserta sobre el artefacto final. */
function miniHar(entries: MiniEntry[]): Record<string, unknown> {
 return {
  log: {
   version: "1.2",
   creator: { name: "openapi-schema-test", version: "1" },
   entries: entries.map((e) => ({
    startedDateTime: "2026-08-22T10:00:00Z",
    _resourceType: "xhr",
    request: {
     method: e.method,
     url: e.url,
     headers: [{ name: "Authorization", value: "Bearer sekret-token-mock" }],
     ...(e.body === undefined
      ? {}
      : { postData: { mimeType: "application/json", text: e.body } }),
    },
    response: { status: e.status, content: { mimeType: "application/json" } },
   })),
  },
 };
}

/** Agente mock compacto por anclas del contrato del Slice 2: matrix
 *  ("## Endpoints observados") y judge ("## Entregables a auditar"). */
const miniSpawn = (async (prompt: string) => {
 if (prompt.includes("## Endpoints observados")) {
  return {
   matrix: [
    {
     endpoints: [{ method: "GET", path: "/api/items" }],
     modules: [],
     evidence: "correlación mock compacta",
    },
   ],
   orphans: { apiSinUi: [], uiSinCodigo: [] },
   deadZone: [],
   toolsUsed: [],
   degradations: [],
   summary: "mock compacto (openapi-schema)",
  };
 }
 if (prompt.includes("## Entregables a auditar")) {
  return { decision: "PASS", findings: [], summary: "auditoría mock" };
 }
 return "echo: " + prompt.slice(0, 40);
}) as unknown as SpawnAgentFn;

// ── Tests ──────────────────────────────────────────────────────────────────

describe("frida-traffic2api · openapi-schema — typebox OpenAPI 3.1 (#135, D7 capa 2)", () => {
 describe("fixtures del agregador (SPEC_BUILDER)", () => {
  it("sabor devtools: colapso {id}, 404, payload scrubbeado → válida", () => {
   const fixture = devtoolsSpecFixture();
   expectValid(OpenApi31Schema, fixture);
   // El scrub del ejemplo viaja en la fixture (NFR Security).
   expect(JSON.stringify(fixture)).toContain("[REDACTADO]");
  });

  it("sabor mitmproxy: 401/500/default, servers vacíos → válida", () => {
   expectValid(OpenApi31Schema, mitmproxySpecFixture());
  });
 });

 describe("anti-fixtures — el schema tiene dientes", () => {
  it("rechaza openapi 3.0.0 (el literal exige 3.1.0)", () => {
   const bad = devtoolsSpecFixture();
   bad.openapi = "3.0.0";
   expect(Value.Check(OpenApi31Schema, bad)).toBe(false);
  });

  it("rechaza paths ausente", () => {
   const bad = devtoolsSpecFixture();
   dropKey(bad, "paths");
   expect(Value.Check(OpenApi31Schema, bad)).toBe(false);
  });

  it("rechaza operación sin responses", () => {
   const bad = devtoolsSpecFixture();
   dropKey(bad.paths["/api/productos"].get, "responses");
   expect(Value.Check(OpenApi31Schema, bad)).toBe(false);
  });

  it("rechaza info sin version", () => {
   const bad = devtoolsSpecFixture();
   dropKey(bad.info, "version");
   expect(Value.Check(OpenApi31Schema, bad)).toBe(false);
  });
 });

 describe("artefacto real — corrida e2e compacta en modo externo", () => {
  const REAL_HOME = process.env.HOME;
  let home: string;
  let cwd: string;

  beforeEach(() => {
   home = mkdtempSync(join(tmpdir(), "t2a-oas-home-"));
   cwd = mkdtempSync(join(tmpdir(), "t2a-oas-cwd-"));
   // HOME aislado (molde e2e/pattern): sonda del moat y overrides de
   // usuario del resolver deterministas (CAPABILITIES=false).
   process.env.HOME = home;
  });

  afterEach(() => {
   if (REAL_HOME) process.env.HOME = REAL_HOME;
   rmSync(home, { recursive: true, force: true });
   rmSync(cwd, { recursive: true, force: true });
  });

  it("openapi.json del workflow pasa Value.Check con scrub y colapso verificados", async () => {
   // Mini HAR en el cwd: 4 same-origin + 1 de terceros. El modo externo
   // NO llama agent-browser (bootstrap = test -s + cp) → sin mock de
   // binario; solo matrix/judge se mockean.
   const harPath = join("capturas", "mini.har");
   mkdirSync(dirname(join(cwd, harPath)), { recursive: true });
   writeFileSync(
    join(cwd, harPath),
    JSON.stringify(
     miniHar([
      { method: "GET", url: "https://app.ejemplo.com/api/items", status: 200 },
      {
       method: "GET",
       url: "https://app.ejemplo.com/api/items/42",
       status: 200,
      },
      {
       method: "GET",
       url: "https://app.ejemplo.com/api/items/777",
       status: 404,
      },
      {
       method: "POST",
       url: "https://app.ejemplo.com/api/items",
       status: 201,
       body: '{"nombre":"x","api_key":"sekret-token-mock"}',
      },
      { method: "GET", url: "https://cdn.ejemplo.com/pixel.gif", status: 200 },
     ]),
    ),
    "utf-8",
   );

   const args = { harPath, review: "auto" };
   const script = TRAFFIC2API_PATTERN.resolve(args, { cwd });
   const { result } = await runWorkflowInStore({
    name: "traffic2api",
    script,
    args,
    cwd,
    sessionId: "sess-t2a-oas",
    spawnAgent: miniSpawn,
    home,
    runId: randomUUID(),
    foreground: false,
   });

   // SAFETY: el return del workflow es el objeto del contrato del Slice 2
   // (lo produce el script del patrón); el cast cruza la frontera JsonValue.
   const r = result as {
    mode: string;
    requests: { total: number; sameOrigin: number; thirdParty: number };
    endpoints: number;
    docs: { openapi: string };
   };
   expect(r.mode).toBe("externo");
   expect(r.requests).toEqual({ total: 5, sameOrigin: 4, thirdParty: 1 });
   expect(r.endpoints).toBe(3);

   // El artefacto REAL contra el schema — el criterio de aceptación.
   const rawSpec = readFileSync(join(cwd, r.docs.openapi), "utf-8");
   const spec = JSON.parse(rawSpec) as {
    servers: Array<{ url: string }>;
    paths: Record<
     string,
     Record<
      string,
      {
       responses: Record<string, { description: string }>;
       requestBody?: { content: Record<string, { example: unknown }> };
      }
     >
    >;
   };
   expectValid(OpenApi31Schema, spec);
   expect(spec.servers).toEqual([{ url: "https://app.ejemplo.com" }]);
   // Colapso determinista (D7): 42 y 777 → {id} con 200+404 documentados.
   expect(Object.keys(spec.paths).sort()).toEqual([
    "/api/items",
    "/api/items/{id}",
   ]);
   expect(
    Object.keys(spec.paths["/api/items/{id}"].get?.responses ?? {}).sort(),
   ).toEqual(["200", "404"]);

   // Cardinalidad y vocabulario — espejo del gate in-run (D7 capa 1).
   for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
     expect(OAS_METHODS as readonly string[]).toContain(method);
     expect(
      Object.keys(op.responses).length,
      `${method} ${path}`,
     ).toBeGreaterThan(0);
    }
   }

   // NFR Security: el carve no extrae headers (garantía estructural) y el
   // scrub pisa claves sospechosas del ejemplo (api_key → [REDACTADO]).
   expect(rawSpec).not.toContain("sekret-token-mock");
   expect(rawSpec).not.toContain("Bearer");
   expect(
    spec.paths["/api/items"].post?.requestBody?.content?.["application/json"]
     ?.example,
   ).toEqual({ nombre: "x", api_key: "[REDACTADO]" });
  }, 30000);
 });
});
