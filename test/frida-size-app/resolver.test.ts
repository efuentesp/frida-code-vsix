// frida-size-app — tests del resolver 3-capas (issue #139, M10).
// Molde: test/frida-understand-app/resolver.test.ts (#134). Aislamiento:
// HOME a tmpdir (resolve() lee ~/.frida/size-app/stages.json en
// launch-time) + projectRoot desechable por test.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
 resolveStagePrompts,
 TEAM_OVERRIDES_PATH,
 userOverridesPath,
} from "../../src/tools/frida-size-app/resolver";
import {
 DEFAULT_STAGE_PROMPTS,
 SIZE_APP_PREAMBLE,
 SIZE_APP_STAGES,
} from "../../src/tools/frida-size-app/skills";

const REAL_HOME = process.env.HOME;

let home: string;
let projectRoot: string;

beforeEach(() => {
 home = mkdtempSync(join(tmpdir(), "size-home-"));
 projectRoot = mkdtempSync(join(tmpdir(), "size-proj-"));
 process.env.HOME = home;
});

afterEach(() => {
 if (REAL_HOME) process.env.HOME = REAL_HOME;
 rmSync(home, { recursive: true, force: true });
 rmSync(projectRoot, { recursive: true, force: true });
});

function writeTeamOverrides(overrides: unknown): void {
 mkdirSync(join(projectRoot, ".frida", "size-app"), { recursive: true });
 writeFileSync(
  join(projectRoot, TEAM_OVERRIDES_PATH),
  JSON.stringify(overrides),
  "utf-8",
 );
}

function writeUserOverrides(overrides: unknown): void {
 mkdirSync(join(home, ".frida", "size-app"), { recursive: true });
 writeFileSync(userOverridesPath(), JSON.stringify(overrides), "utf-8");
}

describe("frida-size-app · resolver 3-capas (#139)", () => {
 it("sin overrides resuelve defaults para los 2 stages", () => {
  const resolved = resolveStagePrompts(projectRoot);
  expect(resolved.map((r) => r.stage)).toEqual([...SIZE_APP_STAGES]);
  for (const r of resolved) {
   expect(r.source).toBe("defaults");
   expect(r.prompt).toBe(DEFAULT_STAGE_PROMPTS[r.stage]);
  }
 });

 it("el override de equipo reemplaza el default del stage", () => {
  writeTeamOverrides({ stages: { judge: "Rúbrica propia del equipo." } });
  const resolved = resolveStagePrompts(projectRoot);
  const judge = resolved.find((r) => r.stage === "judge");
  expect(judge?.source).toBe("team");
  expect(judge?.prompt).toBe("Rúbrica propia del equipo.");
  const others = resolved.filter((r) => r.stage !== "judge");
  expect(others).toHaveLength(1);
  for (const r of others) expect(r.source).toBe("defaults");
 });

 it("usuario gana sobre equipo y defaults", () => {
  writeTeamOverrides({
   stages: { analyze: "team analyze", judge: "team judge" },
  });
  writeUserOverrides({ stages: { analyze: "user analyze" } });
  const resolved = resolveStagePrompts(projectRoot);
  const analyze = resolved.find((r) => r.stage === "analyze");
  expect(analyze?.source).toBe("user");
  expect(analyze?.prompt).toBe("user analyze");
  const judge = resolved.find((r) => r.stage === "judge");
  expect(judge?.source).toBe("team");
  expect(judge?.prompt).toBe("team judge");
 });

 it("claves de fases deterministas (bootstrap/metrics/synthesize) y stages desconocidos se ignoran — solo analyze/judge son overrideables", () => {
  // D11: bootstrap/metrics/synthesize son fases deterministas del
  // script — NO tienen clave de resolver; un stages.json que las
  // declare no puede tocarlas (mismo tratamiento que stages
  // desconocidos del núcleo).
  writeTeamOverrides({
   stages: {
    bootstrap: "x",
    metrics: "y",
    synthesize: "z",
    overview: "w", // stage de un hermano (M1), no de este pack
    judge: "",
    analyze: 42,
   },
  });
  const resolved = resolveStagePrompts(projectRoot);
  for (const r of resolved) expect(r.source).toBe("defaults");
 });

 it("JSON inválido de una capa aborta ruidosamente (nunca silenciosamente)", () => {
  mkdirSync(join(projectRoot, ".frida", "size-app"), { recursive: true });
  writeFileSync(join(projectRoot, TEAM_OVERRIDES_PATH), "{ no json", "utf-8");
  expect(() => resolveStagePrompts(projectRoot)).toThrow(/JSON inválido/);
 });

 it("el veto de solo-escritura y el juez de números viven SOLO en el preamble no-stage", () => {
  // D11 (análogo M1/M9): un override 3-capas reemplaza el prompt
  // completo del stage; si el veto o el juez de números vivieran en
  // un default de stage, un override los omitiría en silencio. Deben
  // ser inalcanzables para stages.json.
  expect(SIZE_APP_PREAMBLE).toContain("VETADO");
  expect(SIZE_APP_PREAMBLE).toContain("JUEZ DE NÚMEROS");
  expect(SIZE_APP_STAGES).not.toContain("preamble");
  for (const stage of SIZE_APP_STAGES) {
   expect(DEFAULT_STAGE_PROMPTS[stage]).not.toContain("VETADO");
   expect(DEFAULT_STAGE_PROMPTS[stage]).not.toContain("JUEZ DE NÚMEROS");
  }
 });
});
