// frida-traffic2api — tests del patrón traffic2api: validación eager de
// modos excluyentes (D2), sonda de capacidades host-side (D3), forma del
// script generado por modo (8 fases/HAR/cortes/moat) y registro en runtime
// sobre el motor. Issue #135, M9 Pista M. Molde:
// test/frida-understand-app/pattern.test.ts (#134).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
 TRAFFIC2API_PATTERN,
 createFridaTraffic2Api,
 detectTraffic2ApiCapabilities,
} from "../../src/tools/frida-traffic2api";
import {
 builtinPatternsCatalog,
 clearRegisteredBuiltinPatterns,
 findBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import {
 CODEBASE_INDEX_PACKAGE,
 CODEBASE_INDEX_PIN,
 upstreamEntryPath,
} from "../../src/tools/frida-codebase-index/constants";

const REAL_HOME = process.env.HOME;
const cwd = process.cwd();

let home: string;

beforeEach(() => {
 // HOME aislado: resolve() lee overrides de usuario
 // (~/.frida/traffic2api/stages.json) Y sonda capacidades del moat en
 // ~/.frida/npm (D3) — sin esto, las instalaciones del entorno de dev
 // harían no-deterministas los asserts de CAPABILITIES.
 home = mkdtempSync(join(tmpdir(), "traffic2api-pat-home-"));
 process.env.HOME = home;
});

afterEach(() => {
 if (REAL_HOME) process.env.HOME = REAL_HOME;
 rmSync(home, { recursive: true, force: true });
 clearRegisteredBuiltinPatterns();
});

const VALID_WALK = { url: "https://app.legacy.test", maxScreens: 5 };
const VALID_EXTERNAL = { harPath: "capturas/sesion.har" };

/** Fixture: entry de pi-lens presente en el agentDir (presencia, no carga). */
function fixtureLensEntry(agentDir: string): void {
 const entry = join(
  agentDir,
  "npm",
  "node_modules",
  "pi-lens",
  "dist",
  "index.js",
 );
 mkdirSync(dirname(entry), { recursive: true });
 writeFileSync(entry, "// stub entry\n");
}

/** Fixture: open-codebase-index instalado al pin (package.json + entry). */
function fixtureCodebaseIndexAtPin(agentDir: string): void {
 const pkgDir = join(agentDir, "npm", "node_modules", CODEBASE_INDEX_PACKAGE);
 mkdirSync(pkgDir, { recursive: true });
 writeFileSync(
  join(pkgDir, "package.json"),
  JSON.stringify({ version: CODEBASE_INDEX_PIN }),
 );
 const entry = upstreamEntryPath(agentDir);
 mkdirSync(dirname(entry), { recursive: true });
 writeFileSync(entry, "// stub entry\n");
}

describe("frida-traffic2api · validación eager de modos excluyentes (#135, D2)", () => {
 it("url y harPath juntos fallan con error que instruye el flujo", () => {
  expect(() =>
   TRAFFIC2API_PATTERN.resolve({ ...VALID_WALK, ...VALID_EXTERNAL }, { cwd }),
  ).toThrow(/MUTUAMENTE EXCLUYENTES/);
 });

 it("sin url ni harPath falla instruyendo el origen del tráfico", () => {
  expect(() => TRAFFIC2API_PATTERN.resolve({}, { cwd })).toThrow(
   /falta el origen del tráfico/,
  );
  expect(() => TRAFFIC2API_PATTERN.resolve(null, { cwd })).toThrow(
   /falta el origen del tráfico/,
  );
 });

 it("maxScreens faltante (modo walk) instruye preguntar pre-launch (D2)", () => {
  let err: Error | undefined;
  try {
   TRAFFIC2API_PATTERN.resolve({ url: VALID_WALK.url }, { cwd });
  } catch (e) {
   err = e as Error;
  }
  expect(err).toBeInstanceOf(Error);
  expect(err?.message).toMatch(/maxScreens/);
  // El error es accionable: instruye la pregunta en la sesión principal.
  expect(err?.message).toContain("ask_user_question");
 });

 it("maxScreens fuera de rango o no entero se rechaza", () => {
  for (const bad of [-1, 201, 2.5, "12"]) {
   expect(() =>
    TRAFFIC2API_PATTERN.resolve(
     { url: VALID_WALK.url, maxScreens: bad },
     { cwd },
    ),
   ).toThrow(/maxScreens/);
  }
 });

 it("maxMinutes fuera de rango se rechaza en ambos modos (1-240, entero)", () => {
  for (const bad of [0, 241, 1.5]) {
   expect(() =>
    TRAFFIC2API_PATTERN.resolve({ ...VALID_WALK, maxMinutes: bad }, { cwd }),
   ).toThrow(/maxMinutes/);
   expect(() =>
    TRAFFIC2API_PATTERN.resolve(
     { ...VALID_EXTERNAL, maxMinutes: bad },
     { cwd },
    ),
   ).toThrow(/maxMinutes/);
  }
 });

 it("review inválido se rechaza en ambos modos", () => {
  expect(() =>
   TRAFFIC2API_PATTERN.resolve({ ...VALID_WALK, review: "sometimes" }, { cwd }),
  ).toThrow(/review/);
  expect(() =>
   TRAFFIC2API_PATTERN.resolve(
    { ...VALID_EXTERNAL, review: "sometimes" },
    { cwd },
   ),
  ).toThrow(/review/);
 });
});

describe("frida-traffic2api · sonda de capacidades host-side (D3)", () => {
 it("sin instalaciones → ambas false", () => {
  expect(detectTraffic2ApiCapabilities(join(home, ".frida"))).toEqual({
   lens: false,
   codebaseIndex: false,
  });
 });

 it("entry de pi-lens presente → lens true (codebaseIndex igual false)", () => {
  const agentDir = join(home, ".frida");
  fixtureLensEntry(agentDir);
  expect(detectTraffic2ApiCapabilities(agentDir)).toEqual({
   lens: true,
   codebaseIndex: false,
  });
 });

 it("codebase-index al pin → codebaseIndex true", () => {
  const agentDir = join(home, ".frida");
  fixtureCodebaseIndexAtPin(agentDir);
  expect(detectTraffic2ApiCapabilities(agentDir)).toEqual({
   lens: false,
   codebaseIndex: true,
  });
 });

 it("el toggle apagado vence a la instalación (D3)", () => {
  const agentDir = join(home, ".frida");
  fixtureLensEntry(agentDir);
  fixtureCodebaseIndexAtPin(agentDir);
  expect(detectTraffic2ApiCapabilities(agentDir, false)).toEqual({
   lens: true,
   codebaseIndex: false,
  });
 });
});

describe("frida-traffic2api · forma del script generado (#135)", () => {
 it("el patrón está nombrado y documentado (catálogo)", () => {
  expect(TRAFFIC2API_PATTERN.name).toBe("traffic2api");
  expect(TRAFFIC2API_PATTERN.args.length).toBeGreaterThan(10);
  expect(TRAFFIC2API_PATTERN.description.length).toBeGreaterThan(40);
 });

 it("la meta declara shell, postura autónoma y el moat (D3)", () => {
  expect(TRAFFIC2API_PATTERN.meta?.requiredTools).toContain("shell");
  expect(TRAFFIC2API_PATTERN.meta?.executionHints?.autonomous).toBe(true);
  expect(TRAFFIC2API_PATTERN.meta?.moat).toEqual({
   lens: true,
   codebaseIndex: true,
  });
 });

 it("las 8 fases en orden: bootstrap → walk → ingest → spec → graph → matrix → synthesize → judge", () => {
  const script = TRAFFIC2API_PATTERN.resolve(VALID_WALK, { cwd });
  const idx = [
   script.indexOf('phase("bootstrap")'),
   script.indexOf('phase("walk")'),
   script.indexOf('phase("ingest")'),
   script.indexOf('phase("spec")'),
   script.indexOf('phase("graph")'),
   script.indexOf('phase("matrix")'),
   script.indexOf('phase("synthesize")'),
   script.indexOf('phase("judge")'),
  ];
  for (const i of idx) expect(i).toBeGreaterThan(-1);
  for (let i = 1; i < idx.length; i++) {
   expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  }
 });

 it("los vetos y la seguridad del HAR viajan en el script (D11)", () => {
  const script = TRAFFIC2API_PATTERN.resolve(VALID_WALK, { cwd });
  expect(script).toContain("VETADO"); // irreversibles (M8)
  expect(script).toContain("docs/api/"); // solo-escritura (M1)
  expect(script).toContain("autorización"); // seguridad HAR
 });

 it("CAPABILITIES interpolada host-side (D3) — false bajo HOME aislado", () => {
  const script = TRAFFIC2API_PATTERN.resolve(VALID_WALK, { cwd });
  expect(script).toContain(
   'const CAPABILITIES = {"lens":false,"codebaseIndex":false}',
  );
 });

 it("captura HAR con el contrato del binario (D4): start --content all antes del open, stop con path", () => {
  const script = TRAFFIC2API_PATTERN.resolve(VALID_WALK, { cwd });
  expect(script).toContain("network har start --content all");
  expect(script.indexOf("network har start")).toBeLessThan(
   script.indexOf('await abRun("open '),
  );
  // stop: 2 usos (salvage defensivo + finally).
  expect(script.match(/network har stop/g)?.length).toBeGreaterThanOrEqual(2);
 });

 it("el modo se interpola como CONST estructural: walk vs externo (D2/D10)", () => {
  const walkScript = TRAFFIC2API_PATTERN.resolve(VALID_WALK, { cwd });
  const extScript = TRAFFIC2API_PATTERN.resolve(VALID_EXTERNAL, { cwd });
  expect(walkScript).toContain('const mode = "walk"');
  expect(walkScript).toContain('const session = "app-walkthrough"');
  expect(extScript).toContain('const mode = "externo"');
  // El HAR externo viaja al script (copiado en bootstrap sin navegador).
  expect(extScript).toContain(VALID_EXTERNAL.harPath);
  expect(extScript).toContain("const maxScreens = 0");
 });

 it("checkpoint final y entregables deterministas", () => {
  const script = TRAFFIC2API_PATTERN.resolve(VALID_WALK, { cwd });
  expect(script).toContain('checkpoint({ name: "traffic2api-final"');
  for (const file of [
   "openapi.json",
   "matriz.md",
   "navegacion.md",
   "README.md",
   "artifacts/inventory.json",
   "artifacts/nav-graph.json",
   "artifacts/requests.jsonl",
  ]) {
   expect(script).toContain(file);
  }
 });

 it("cortes pre-LLM y registro de corte (canon M8)", () => {
  const script = TRAFFIC2API_PATTERN.resolve(VALID_WALK, { cwd });
  expect(script).toContain("stoppedBy");
  expect(script).toContain("deadline");
 });

 it("resolve honra ctx.cwd: el override de equipo llega al script (D11)", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "traffic2api-proj-"));
  try {
   const teamDir = join(projectRoot, ".frida", "traffic2api");
   mkdirSync(teamDir, { recursive: true });
   writeFileSync(
    join(teamDir, "stages.json"),
    JSON.stringify({ stages: { judge: "Rúbrica custom del equipo." } }),
   );
   const script = TRAFFIC2API_PATTERN.resolve(VALID_WALK, {
    cwd: projectRoot,
   });
   expect(script).toContain("Rúbrica custom del equipo.");
   expect(script).toContain("fuente del prompt: team");
  } finally {
   rmSync(projectRoot, { recursive: true, force: true });
  }
 });
});

describe("frida-traffic2api · registro en runtime sobre el motor (#135)", () => {
 it("la factory registra el patrón (smoke de registro)", () => {
  expect(findBuiltinPattern("traffic2api")).toBeUndefined();
  createFridaTraffic2Api()({} as never);
  const found = findBuiltinPattern("traffic2api");
  expect(found?.name).toBe("traffic2api");
  expect(found?.description).toContain("docs/api/");
 });

 it("el catálogo lista el patrón junto a los builtin (toContain, no conteo)", () => {
  createFridaTraffic2Api()({} as never);
  const names = builtinPatternsCatalog().map((p) => p.name);
  expect(names).toContain("traffic2api");
  expect(names).toContain("code-review"); // los builtin de #19 siguen
 });

 it("la factory es idempotente por nombre (no duplica)", () => {
  const factory = createFridaTraffic2Api();
  factory({} as never);
  factory({} as never);
  expect(
   builtinPatternsCatalog().filter((p) => p.name === "traffic2api"),
  ).toHaveLength(1);
 });

 it("la factory con agentDir propio interpola capacidades exactas (D3)", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "traffic2api-agentdir-"));
  try {
   fixtureLensEntry(agentDir);
   createFridaTraffic2Api({ agentDir })({} as never);
   const script = findBuiltinPattern("traffic2api")?.resolve(VALID_WALK, {
    cwd,
   });
   expect(script).toContain('"lens":true');
   expect(script).toContain('"codebaseIndex":false');
  } finally {
   rmSync(agentDir, { recursive: true, force: true });
  }
 });

 it("el getter codebaseIndexEnabled apagado degrada CAPABILITIES (D3)", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "traffic2api-agentdir-"));
  try {
   fixtureLensEntry(agentDir);
   fixtureCodebaseIndexAtPin(agentDir);
   createFridaTraffic2Api({
    agentDir,
    codebaseIndexEnabled: () => false,
   })({} as never);
   const script = findBuiltinPattern("traffic2api")?.resolve(VALID_WALK, {
    cwd,
   });
   expect(script).toContain(
    'const CAPABILITIES = {"lens":true,"codebaseIndex":false}',
   );
  } finally {
   rmSync(agentDir, { recursive: true, force: true });
  }
 });
});
