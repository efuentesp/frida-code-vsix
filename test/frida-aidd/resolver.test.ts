// frida-aidd — tests del resolver 3-capas (defaults → equipo → usuario).
// Issue #38, ADR-0050 pieza 2. HOME y projectRoot aislados en tmpdir.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	resolveStagePrompts,
	TEAM_OVERRIDES_PATH,
	userOverridesPath,
} from "../../src/tools/frida-aidd/resolver";
import {
	AIDD_PLAN_STAGES,
	DEFAULT_STAGE_PROMPTS,
} from "../../src/tools/frida-aidd/skills";

const REAL_HOME = process.env.HOME;

let home: string;
let projectRoot: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "aidd-home-"));
	projectRoot = mkdtempSync(join(tmpdir(), "aidd-proj-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(projectRoot, { recursive: true, force: true });
});

function writeTeamOverrides(overrides: unknown): void {
	mkdirSync(join(projectRoot, ".frida", "aidd"), { recursive: true });
	writeFileSync(
		join(projectRoot, TEAM_OVERRIDES_PATH),
		JSON.stringify(overrides),
		"utf8",
	);
}

function writeUserOverrides(overrides: unknown): void {
	mkdirSync(join(home, ".frida", "aidd"), { recursive: true });
	writeFileSync(
		userOverridesPath(),
		JSON.stringify(overrides),
		"utf8",
	);
}

describe("frida-aidd · resolver 3-capas (#38)", () => {
	it("sin overrides resuelve defaults para los 5 stages", () => {
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.map((r) => r.stage)).toEqual([...AIDD_PLAN_STAGES]);
		for (const r of resolved) {
			expect(r.source).toBe("defaults");
			expect(r.prompt).toBe(DEFAULT_STAGE_PROMPTS[r.stage]);
		}
	});

	it("el override de equipo reemplaza el default del stage", () => {
		writeTeamOverrides({ stages: { prd: "PROMPT DE EQUIPO" } });
		const resolved = resolveStagePrompts(projectRoot);
		const prd = resolved.find((r) => r.stage === "prd")!;
		expect(prd.source).toBe("team");
		expect(prd.prompt).toBe("PROMPT DE EQUIPO");
		// Los demás stages siguen en defaults.
		expect(resolved.filter((r) => r.source === "defaults")).toHaveLength(4);
	});

	it("usuario gana sobre equipo y defaults", () => {
		writeTeamOverrides({ stages: { prd: "EQUIPO", spec: "EQUIPO" } });
		writeUserOverrides({ stages: { prd: "USUARIO" } });
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.find((r) => r.stage === "prd")!.prompt).toBe("USUARIO");
		expect(resolved.find((r) => r.stage === "prd")!.source).toBe("user");
		expect(resolved.find((r) => r.stage === "spec")!.prompt).toBe("EQUIPO");
	});

	it("stages desconocidos y valores vacíos se ignoran", () => {
		writeTeamOverrides({
			stages: { "no-existe": "x", prd: "", "epics-and-stories": 42 },
		});
		const resolved = resolveStagePrompts(projectRoot);
		for (const r of resolved) expect(r.source).toBe("defaults");
	});

	it("JSON inválido de una capa aborta ruidosamente (nunca silenciosamente)", () => {
		mkdirSync(join(projectRoot, ".frida", "aidd"), { recursive: true });
		writeFileSync(join(projectRoot, TEAM_OVERRIDES_PATH), "{ no json", "utf8");
		expect(() => resolveStagePrompts(projectRoot)).toThrow(/JSON inválido/);
	});
});
