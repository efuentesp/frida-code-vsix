// frida-tea — tests del resolver 3-capas (defaults → equipo → usuario).
// Issue #41, ADR-0053 D3 (reusa el núcleo de frida-aidd). HOME y projectRoot
// aislados en tmpdir.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	resolveStagePrompts,
	TEAM_OVERRIDES_PATH,
	userOverridesPath,
} from "../../src/tools/frida-tea/resolver";
import {
	DEFAULT_STAGE_PROMPTS,
	TEA_STAGES,
} from "../../src/tools/frida-tea/skills";

const REAL_HOME = process.env.HOME;

let home: string;
let projectRoot: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "tea-home-"));
	projectRoot = mkdtempSync(join(tmpdir(), "tea-proj-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(projectRoot, { recursive: true, force: true });
});

function writeTeamOverrides(overrides: unknown): void {
	mkdirSync(join(projectRoot, ".frida", "tea"), { recursive: true });
	writeFileSync(
		join(projectRoot, TEAM_OVERRIDES_PATH),
		JSON.stringify(overrides),
		"utf8",
	);
}

function writeUserOverrides(overrides: unknown): void {
	mkdirSync(join(home, ".frida", "tea"), { recursive: true });
	writeFileSync(userOverridesPath(), JSON.stringify(overrides), "utf8");
}

describe("frida-tea · resolver 3-capas (#41)", () => {
	it("sin overrides resuelve defaults para los 5 stages", () => {
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.map((r) => r.stage)).toEqual([...TEA_STAGES]);
		for (const r of resolved) {
			expect(r.source).toBe("defaults");
			expect(r.prompt).toBe(DEFAULT_STAGE_PROMPTS[r.stage]);
		}
	});

	it("el override de equipo reemplaza el default del stage", () => {
		writeTeamOverrides({ stages: { gate: "GATE DE EQUIPO" } });
		const resolved = resolveStagePrompts(projectRoot);
		const gate = resolved.find((r) => r.stage === "gate")!;
		expect(gate.source).toBe("team");
		expect(gate.prompt).toBe("GATE DE EQUIPO");
		// Los demás stages siguen en defaults.
		expect(resolved.filter((r) => r.source === "defaults")).toHaveLength(4);
	});

	it("usuario gana sobre equipo y defaults", () => {
		writeTeamOverrides({ stages: { gate: "EQUIPO", automate: "EQUIPO" } });
		writeUserOverrides({ stages: { gate: "USUARIO" } });
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.find((r) => r.stage === "gate")!.prompt).toBe("USUARIO");
		expect(resolved.find((r) => r.stage === "gate")!.source).toBe("user");
		expect(resolved.find((r) => r.stage === "automate")!.prompt).toBe("EQUIPO");
	});

	it("stages desconocidos y valores vacíos se ignoran", () => {
		writeTeamOverrides({
			stages: { "no-existe": "x", framework: "", "test-design": 42 },
		});
		const resolved = resolveStagePrompts(projectRoot);
		for (const r of resolved) expect(r.source).toBe("defaults");
	});

	it("JSON inválido de una capa aborta ruidosamente (nunca silenciosamente)", () => {
		mkdirSync(join(projectRoot, ".frida", "tea"), { recursive: true });
		writeFileSync(join(projectRoot, TEAM_OVERRIDES_PATH), "{ no json", "utf8");
		expect(() => resolveStagePrompts(projectRoot)).toThrow(/JSON inválido/);
	});
});
