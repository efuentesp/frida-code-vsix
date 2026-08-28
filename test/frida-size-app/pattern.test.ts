// frida-size-app — tests del patrón size-app: validación eager (D13/D7),
// sonda de capacidades host-side (D2/D3), forma del script generado (5
// fases/moat/binario pineado/FR-11) y registro en runtime sobre el motor
// con disparo fire-and-forget (D2/V6). Issue #139, M10 Pista M. Molde:
// test/frida-traffic2api/pattern.test.ts (#135).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
 SIZE_APP_PATTERN,
 createFridaSizeApp,
 detectSizeAppCapabilities,
} from "../../src/tools/frida-size-app";
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
import {
 currentSccAsset,
 SCC_PIN,
 sccBinPath,
 sccMarkerPath,
} from "../../src/tools/frida-size-app/constants";
import {
 isSccInstalledAtPin,
 type SccInstallDeps,
} from "../../src/tools/frida-size-app/installer";

const REAL_HOME = process.env.HOME;
const cwd = process.cwd();

let home: string;

beforeEach(() => {
 // HOME aislado (molde M9): resolve() lee overrides de usuario
 // (~/.frida/size-app/stages.json) Y sondea capacidades del moat + scc en
 // ~/.frida — sin esto, las instalaciones del entorno de dev harían
 // no-deterministas los asserts de CAPABILITIES y dispararían la
 // descarga REAL del binario.
 home = mkdtempSync(join(tmpdir(), "size-app-pat-home-"));
 process.env.HOME = home;
});

afterEach(() => {
 if (REAL_HOME) process.env.HOME = REAL_HOME;
 rmSync(home, { recursive: true, force: true });
 clearRegisteredBuiltinPatterns();
});

const VALID = { wage: 35000, currency: "MXN" };

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

/** Fixture: scc instalado AL PIN en el agentDir (marker + binario) — la
 *  sonda del pack es isSccInstalledAtPin, misma que usará el script. */
function fixtureSccAtPin(agentDir: string): void {
 mkdirSync(dirname(sccBinPath(agentDir)), { recursive: true });
 writeFileSync(sccBinPath(agentDir), "#!/bin/sh\necho scc\n");
 writeFileSync(
  sccMarkerPath(agentDir),
  JSON.stringify({
   pin: SCC_PIN,
   asset: currentSccAsset(),
   sha256: "0".repeat(64),
  }),
 );
}

/** Deps que rechazan sin tocar la red — seam ensureDeps de la factory. */
const noNetworkDeps = (): SccInstallDeps => ({
 fetchArchive: () => Promise.reject(new Error("sin red (test)")),
});

describe("frida-size-app · validación eager (#139, D13/D7)", () => {
 it("wage faltante instruye preguntar pre-launch con opciones embebidas", () => {
  let err: Error | undefined;
  try {
   SIZE_APP_PATTERN.resolve({}, { cwd });
  } catch (e) {
   err = e as Error;
  }
  expect(err).toBeInstanceOf(Error);
  expect(err?.message).toMatch(/wage/);
  // El error es accionable: instruye la pregunta en la sesión principal
  // con las opciones típicas del Desired End State (D7).
  expect(err?.message).toContain("ask_user_question");
  expect(err?.message).toContain("MXN");
  expect(err?.message).toContain("USD");
 });

 it("wage inválido se rechaza: 0, negativo, NaN, string, Infinity", () => {
  for (const bad of [0, -1, Number.NaN, "35000", Number.POSITIVE_INFINITY]) {
   expect(() =>
    SIZE_APP_PATTERN.resolve({ ...VALID, wage: bad }, { cwd }),
   ).toThrow(/wage/);
  }
 });

 it("wage con decimales es VÁLIDO (D7: sin Number.isInteger)", () => {
  const script = SIZE_APP_PATTERN.resolve({ ...VALID, wage: 35000.5 }, { cwd });
  expect(script).toContain("const wage = 35000.5");
 });

 it("cocomoType inválido lista los 3 modos", () => {
  let err: Error | undefined;
  try {
   SIZE_APP_PATTERN.resolve({ ...VALID, cocomoType: "agile" }, { cwd });
  } catch (e) {
   err = e as Error;
  }
  expect(err?.message).toMatch(/cocomoType/);
  expect(err?.message).toContain("organic");
  expect(err?.message).toContain("semi-detached");
  expect(err?.message).toContain("embedded");
 });

 it("exclude inválido se rechaza; [] es válido (= solo curada)", () => {
  for (const bad of ["dist", [""], [42], { 0: "dist" }]) {
   expect(() =>
    SIZE_APP_PATTERN.resolve({ ...VALID, exclude: bad }, { cwd }),
   ).toThrow(/exclude/);
  }
  expect(() =>
   SIZE_APP_PATTERN.resolve({ ...VALID, exclude: [] }, { cwd }),
  ).not.toThrow();
 });

 it("maxMinutes fuera de rango se rechaza (entero 1-240; omiso = sin tope)", () => {
  for (const bad of [0, 241, 1.5, "60"]) {
   expect(() =>
    SIZE_APP_PATTERN.resolve({ ...VALID, maxMinutes: bad }, { cwd }),
   ).toThrow(/maxMinutes/);
  }
 });

 it("review inválido se rechaza", () => {
  expect(() =>
   SIZE_APP_PATTERN.resolve({ ...VALID, review: "sometimes" }, { cwd }),
  ).toThrow(/review/);
 });
});

describe("frida-size-app · sonda de capacidades host-side (D2/D3)", () => {
 it("sin instalaciones → scc/lens/codebaseIndex false", () => {
  expect(detectSizeAppCapabilities(join(home, ".frida"))).toEqual({
   scc: false,
   lens: false,
   codebaseIndex: false,
  });
 });

 it("scc al pin (marker + binario) → scc true", () => {
  const agentDir = join(home, ".frida");
  fixtureSccAtPin(agentDir);
  expect(detectSizeAppCapabilities(agentDir)).toEqual({
   scc: true,
   lens: false,
   codebaseIndex: false,
  });
 });

 it("entry de pi-lens presente → lens true", () => {
  const agentDir = join(home, ".frida");
  fixtureLensEntry(agentDir);
  expect(detectSizeAppCapabilities(agentDir)).toEqual({
   scc: false,
   lens: true,
   codebaseIndex: false,
  });
 });

 it("codebase-index al pin → codebaseIndex true", () => {
  const agentDir = join(home, ".frida");
  fixtureCodebaseIndexAtPin(agentDir);
  expect(detectSizeAppCapabilities(agentDir)).toEqual({
   scc: false,
   lens: false,
   codebaseIndex: true,
  });
 });

 it("el toggle apagado vence a la instalación (D3)", () => {
  const agentDir = join(home, ".frida");
  fixtureLensEntry(agentDir);
  fixtureCodebaseIndexAtPin(agentDir);
  fixtureSccAtPin(agentDir);
  expect(detectSizeAppCapabilities(agentDir, false)).toEqual({
   scc: true,
   lens: true,
   codebaseIndex: false,
  });
 });
});
describe("frida-size-app · forma del script generado (#139)", () => {
 it("el patrón está nombrado y documentado (catálogo)", () => {
  expect(SIZE_APP_PATTERN.name).toBe("size-app");
  expect(SIZE_APP_PATTERN.args.length).toBeGreaterThan(10);
  expect(SIZE_APP_PATTERN.description.length).toBeGreaterThan(40);
 });

 it("la meta declara shell, postura autónoma y el moat (FR-1)", () => {
  expect(SIZE_APP_PATTERN.meta?.requiredTools).toContain("shell");
  expect(SIZE_APP_PATTERN.meta?.executionHints?.autonomous).toBe(true);
  expect(SIZE_APP_PATTERN.meta?.moat).toEqual({
   lens: true,
   codebaseIndex: true,
  });
 });

 it("las 5 fases en orden: bootstrap → metrics → analyze → synthesize → judge", () => {
  const script = SIZE_APP_PATTERN.resolve(VALID, { cwd });
  const idx = [
   script.indexOf('phase("bootstrap")'),
   script.indexOf('phase("metrics")'),
   script.indexOf('phase("analyze")'),
   script.indexOf('phase("synthesize")'),
   script.indexOf('phase("judge")'),
  ];
  for (const i of idx) expect(i).toBeGreaterThan(-1);
  for (let i = 1; i < idx.length; i++) {
   expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  }
 });

 it("los vetos y el juez de números viajan en el script (D11)", () => {
  const script = SIZE_APP_PATTERN.resolve(VALID, { cwd });
  expect(script).toContain("VETADO"); // solo-escritura del repo
  expect(script).toContain("JUEZ DE NÚMEROS"); // metrics.json única fuente
  expect(script).toContain("docs/dimensionamiento/"); // entregables
 });

 it("CAPABILITIES interpolada host-side (D3) — 3×false bajo HOME aislado", () => {
  const script = SIZE_APP_PATTERN.resolve(VALID, { cwd });
  expect(script).toContain(
   'const CAPABILITIES = {"scc":false,"lens":false,"codebaseIndex":false}',
  );
 });

 it("SCC_BIN es la ruta ABSOLUTA del agentDir y el pin viaja (D12)", () => {
  const script = SIZE_APP_PATTERN.resolve(VALID, { cwd });
  expect(script).toContain(
   `const SCC_BIN = ${JSON.stringify(sccBinPath(join(home, ".frida")))}`,
  );
  expect(script).toContain(`const SCC_PIN = "${SCC_PIN}"`);
 });

 it("args estructurales como CONST; escalares con canon defensivo (M9)", () => {
  const script = SIZE_APP_PATTERN.resolve(VALID, { cwd });
  // Directas (canon M9: estructurales interpoladas host-side).
  expect(script).toContain("const wage = 35000");
  expect(script).toContain('const currency = "MXN"');
  expect(script).toContain('const cocomoType = "semi-detached"');
  // Defensivas (canon del motor: los escalares re-leen args en runtime).
  expect(script).toContain('? args.review : "manual"');
  expect(script).toContain('|| "es-MX"');
 });

 it("defaults sin currency: USD etiqueta pura (D7)", () => {
  const script = SIZE_APP_PATTERN.resolve({ wage: 6000 }, { cwd });
  expect(script).toContain('const currency = "USD"');
 });

 it("exclude[] del usuario AMPLÍA la curada sin duplicar (D8)", () => {
  const script = SIZE_APP_PATTERN.resolve(
   { ...VALID, exclude: ["legacy", "dist"] },
   { cwd },
  );
  expect(script).toContain(
   'const EXCLUDE_DIRS = ["dist","build","node_modules","vendor","target","out",".next","coverage","legacy"]',
  );
  expect(script).toContain('const USER_EXCLUDE = ["legacy","dist"]');
 });

 it("checkpoint final y entregables deterministas", () => {
  const script = SIZE_APP_PATTERN.resolve(VALID, { cwd });
  expect(script).toContain('checkpoint({ name: "size-app-final"');
  for (const file of [
   "dimensionamiento.md",
   "README.md",
   "artifacts/metrics.json",
   "analisis/hotspots.md",
   "analisis/deuda-modulos.md",
   "analisis/riesgos-tamano.md",
  ]) {
   expect(script).toContain(file);
  }
 });

 it("cortes por presupuesto y registro del corte (FR-11)", () => {
  const script = SIZE_APP_PATTERN.resolve(
   { ...VALID, maxMinutes: 60 },
   { cwd },
  );
  expect(script).toContain("deadline");
  expect(script).toContain("stoppedBy");
  expect(script).toContain("? args.maxMinutes : 60");
 });

 it("resolve honra ctx.cwd: el override de equipo llega al script (D11)", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "size-app-proj-"));
  try {
   const teamDir = join(projectRoot, ".frida", "size-app");
   mkdirSync(teamDir, { recursive: true });
   writeFileSync(
    join(teamDir, "stages.json"),
    JSON.stringify({ stages: { judge: "Rúbrica custom del equipo." } }),
   );
   const script = SIZE_APP_PATTERN.resolve(VALID, {
    cwd: projectRoot,
   });
   expect(script).toContain("Rúbrica custom del equipo.");
   expect(script).toContain("fuente del prompt: team");
  } finally {
   rmSync(projectRoot, { recursive: true, force: true });
  }
 });
});

describe("frida-size-app · registro en runtime + fire-and-forget (#139, D2/V6)", () => {
 it("la factory registra el patrón (smoke de registro)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
   expect(findBuiltinPattern("size-app")).toBeUndefined();
   // ensureDeps rechazante: el disparo no toca la red (seam D2).
   createFridaSizeApp({ ensureDeps: noNetworkDeps() })({} as never);
   const found = findBuiltinPattern("size-app");
   expect(found?.name).toBe("size-app");
   expect(found?.description).toContain("docs/dimensionamiento/");
   // El rechazo del disparo ya corrió (sin warn residual post-restore):
   // el catch loguea 2 líneas (mensaje + guía) — assert por CONTENIDO
   // del mensaje de fallo, inmune al número de líneas del catch.
   await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
     expect.stringContaining("instalación de scc falló"),
    ),
   );
  } finally {
   warn.mockRestore();
  }
 });

 it("el catálogo lista el patrón junto a los builtin (toContain, no conteo)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
   createFridaSizeApp({ ensureDeps: noNetworkDeps() })({} as never);
   const names = builtinPatternsCatalog().map((p) => p.name);
   expect(names).toContain("size-app");
   expect(names).toContain("code-review"); // los builtin de #19 siguen
   await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
     expect.stringContaining("instalación de scc falló"),
    ),
   );
  } finally {
   warn.mockRestore();
  }
 });

 it("la factory es idempotente por nombre (no duplica)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
   const factory = createFridaSizeApp({ ensureDeps: noNetworkDeps() });
   factory({} as never);
   factory({} as never);
   expect(
    builtinPatternsCatalog().filter((p) => p.name === "size-app"),
   ).toHaveLength(1);
   // Cada factory() dispara su propio rechazo (2 fires → 2 mensajes de
   // fallo; el guide agrega líneas extra irrelevantes al conteo).
   await vi.waitFor(() =>
    expect(
     warn.mock.calls.filter(([m]) =>
      String(m).includes("instalación de scc falló"),
     ),
    ).toHaveLength(2),
   );
  } finally {
   warn.mockRestore();
  }
 });

 it("la factory con agentDir propio interpola capacidades y SCC_BIN exactos (D3/D12)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const agentDir = mkdtempSync(join(tmpdir(), "size-app-agentdir-"));
  try {
   fixtureSccAtPin(agentDir);
   fixtureLensEntry(agentDir);
   createFridaSizeApp({ agentDir })({} as never);
   const script = findBuiltinPattern("size-app")?.resolve(VALID, { cwd });
   expect(script).toContain('"scc":true');
   expect(script).toContain('"lens":true');
   expect(script).toContain(
    `const SCC_BIN = ${JSON.stringify(sccBinPath(agentDir))}`,
   );
  } finally {
   warn.mockRestore();
   rmSync(agentDir, { recursive: true, force: true });
  }
 });

 it("el getter codebaseIndexEnabled apagado degrada CAPABILITIES (D3)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const agentDir = mkdtempSync(join(tmpdir(), "size-app-agentdir-"));
  try {
   fixtureSccAtPin(agentDir);
   fixtureLensEntry(agentDir);
   fixtureCodebaseIndexAtPin(agentDir);
   createFridaSizeApp({
    agentDir,
    codebaseIndexEnabled: () => false,
   })({} as never);
   const script = findBuiltinPattern("size-app")?.resolve(VALID, { cwd });
   expect(script).toContain(
    'const CAPABILITIES = {"scc":true,"lens":true,"codebaseIndex":false}',
   );
  } finally {
   warn.mockRestore();
   rmSync(agentDir, { recursive: true, force: true });
  }
 });

 it("V6: registra el patrón aunque ensureBinary rechace — disparo ocurrió, nada a medias, warn con guía", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const agentDir = mkdtempSync(join(tmpdir(), "size-app-agentdir-"));
  let fetched = 0;
  try {
   expect(findBuiltinPattern("size-app")).toBeUndefined();
   const deps: SccInstallDeps = {
    fetchArchive: async () => {
     fetched++;
     return Buffer.alloc(8); // sha no matchea → rechazo
    },
    digests: { [currentSccAsset() ?? "asset-test"]: "0".repeat(64) },
   };
   createFridaSizeApp({ agentDir, ensureDeps: deps })({} as never);
   // El patrón quedó registrado ANTES de conocer el resultado.
   expect(findBuiltinPattern("size-app")?.name).toBe("size-app");
   // El disparo corrió y el catch tragó el rechazo (warn emitido).
   await vi.waitFor(() => expect(warn).toHaveBeenCalled());
   expect(fetched).toBe(1);
   // Nada a medias (V7): sin binario ni marker.
   expect(isSccInstalledAtPin(agentDir)).toBe(false);
  } finally {
   warn.mockRestore();
   rmSync(agentDir, { recursive: true, force: true });
  }
 });

 it("gate idempotente del disparo: ya instalado al pin → NO dispara (D2)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const agentDir = mkdtempSync(join(tmpdir(), "size-app-agentdir-"));
  let fetched = 0;
  try {
   fixtureSccAtPin(agentDir);
   const deps: SccInstallDeps = {
    fetchArchive: async () => {
     fetched++;
     throw new Error("no debía descargar");
    },
   };
   createFridaSizeApp({ agentDir, ensureDeps: deps })({} as never);
   expect(fetched).toBe(0);
   expect(warn).not.toHaveBeenCalled();
  } finally {
   warn.mockRestore();
   rmSync(agentDir, { recursive: true, force: true });
  }
 });
});
