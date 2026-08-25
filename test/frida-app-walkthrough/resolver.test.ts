// frida-app-walkthrough — tests del resolver 3-capas (defaults → equipo →
// usuario). Issue #133. HOME y projectRoot aislados en tmpdir (molde
// test/frida-tea/resolver.test.ts).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	resolveStagePrompts,
	TEAM_OVERRIDES_PATH,
	userOverridesPath,
} from "../../src/tools/frida-app-walkthrough/resolver";
import {
	DEFAULT_STAGE_PROMPTS,
	WALKTHROUGH_PREAMBLE,
	WALKTHROUGH_STAGES,
} from "../../src/tools/frida-app-walkthrough/skills";

const REAL_HOME = process.env.HOME;

let home: string;
let projectRoot: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "walkthrough-home-"));
	projectRoot = mkdtempSync(join(tmpdir(), "walkthrough-proj-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(projectRoot, { recursive: true, force: true });
});

function writeTeamOverrides(overrides: unknown): void {
	mkdirSync(join(projectRoot, ".frida", "app-walkthrough"), {
		recursive: true,
	});
	writeFileSync(
		join(projectRoot, TEAM_OVERRIDES_PATH),
		JSON.stringify(overrides),
		"utf-8",
	);
}

function writeUserOverrides(overrides: unknown): void {
	mkdirSync(join(home, ".frida", "app-walkthrough"), { recursive: true });
	writeFileSync(userOverridesPath(), JSON.stringify(overrides), "utf-8");
}

describe("frida-app-walkthrough · resolver 3-capas (#133)", () => {
	it("sin overrides resuelve defaults para los 3 stages", () => {
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.map((r) => r.stage)).toEqual([...WALKTHROUGH_STAGES]);
		for (const r of resolved) {
			expect(r.source).toBe("defaults");
			expect(r.prompt).toBe(DEFAULT_STAGE_PROMPTS[r.stage]);
		}
	});

	it("el override de equipo reemplaza el default del stage", () => {
		writeTeamOverrides({ stages: { judge: "JUEZ DE EQUIPO" } });
		const resolved = resolveStagePrompts(projectRoot);
		const judge = resolved.find((r) => r.stage === "judge")!;
		expect(judge.source).toBe("team");
		expect(judge.prompt).toBe("JUEZ DE EQUIPO");
		// Los demás stages siguen en defaults (3 stages - 1 override).
		expect(resolved.filter((r) => r.source === "defaults")).toHaveLength(2);
	});

	it("usuario gana sobre equipo y defaults", () => {
		writeTeamOverrides({ stages: { explore: "EQUIPO", judge: "EQUIPO" } });
		writeUserOverrides({ stages: { explore: "USUARIO" } });
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.find((r) => r.stage === "explore")!.prompt).toBe("USUARIO");
		expect(resolved.find((r) => r.stage === "explore")!.source).toBe("user");
		expect(resolved.find((r) => r.stage === "judge")!.prompt).toBe("EQUIPO");
	});

	it("stages desconocidos y valores vacíos se ignoran (bootstrap/synthesize no son claves)", () => {
		writeTeamOverrides({
			stages: { bootstrap: "x", analyze: "", synthesize: 42 },
		});
		const resolved = resolveStagePrompts(projectRoot);
		for (const r of resolved) expect(r.source).toBe("defaults");
	});

	it("JSON inválido de una capa aborta ruidosamente (nunca silenciosamente)", () => {
		mkdirSync(join(projectRoot, ".frida", "app-walkthrough"), {
			recursive: true,
		});
		writeFileSync(join(projectRoot, TEAM_OVERRIDES_PATH), "{ no json", "utf-8");
		expect(() => resolveStagePrompts(projectRoot)).toThrow(/JSON inválido/);
	});

	it("el veto de acciones irreversibles vive SOLO en el preamble no-stage", () => {
		// D8: un override 3-capas reemplaza el prompt completo del stage; si el
		// veto viviera en un default de stage, un override lo omitiría en
		// silencio. Debe ser inalcanzable para stages.json.
		expect(WALKTHROUGH_PREAMBLE).toContain("VETADO");
		expect(WALKTHROUGH_STAGES).not.toContain("preamble");
		for (const stage of WALKTHROUGH_STAGES) {
			expect(DEFAULT_STAGE_PROMPTS[stage]).not.toContain("VETADO");
		}
	});
});
