// frida-traffic2api — tests del resolver 3-capas (defaults → equipo →
// usuario). Issue #135. HOME y projectRoot aislados en tmpdir (molde
// test/frida-app-walkthrough/resolver.test.ts).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	resolveStagePrompts,
	TEAM_OVERRIDES_PATH,
	userOverridesPath,
} from "../../src/tools/frida-traffic2api/resolver";
import {
	DEFAULT_STAGE_PROMPTS,
	TRAFFIC2API_PREAMBLE,
	TRAFFIC2API_STAGES,
} from "../../src/tools/frida-traffic2api/skills";

const REAL_HOME = process.env.HOME;

let home: string;
let projectRoot: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "traffic2api-home-"));
	projectRoot = mkdtempSync(join(tmpdir(), "traffic2api-proj-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(projectRoot, { recursive: true, force: true });
});

function writeTeamOverrides(overrides: unknown): void {
	mkdirSync(join(projectRoot, ".frida", "traffic2api"), {
		recursive: true,
	});
	writeFileSync(
		join(projectRoot, TEAM_OVERRIDES_PATH),
		JSON.stringify(overrides),
		"utf-8",
	);
}

function writeUserOverrides(overrides: unknown): void {
	mkdirSync(join(home, ".frida", "traffic2api"), { recursive: true });
	writeFileSync(userOverridesPath(), JSON.stringify(overrides), "utf-8");
}

describe("frida-traffic2api · resolver 3-capas (#135)", () => {
	it("sin overrides resuelve defaults para los 4 stages", () => {
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.map((r) => r.stage)).toEqual([...TRAFFIC2API_STAGES]);
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
		// Los demás stages siguen en defaults (4 stages - 1 override).
		expect(resolved.filter((r) => r.source === "defaults")).toHaveLength(3);
	});

	it("usuario gana sobre equipo y defaults", () => {
		writeTeamOverrides({ stages: { walk: "EQUIPO", judge: "EQUIPO" } });
		writeUserOverrides({ stages: { walk: "USUARIO" } });
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.find((r) => r.stage === "walk")!.prompt).toBe("USUARIO");
		expect(resolved.find((r) => r.stage === "walk")!.source).toBe("user");
		expect(resolved.find((r) => r.stage === "judge")!.prompt).toBe("EQUIPO");
	});

	it("stages desconocidos y valores vacíos se ignoran (fases deterministas no son claves)", () => {
		writeTeamOverrides({
			stages: {
				bootstrap: "x",
				ingest: "y",
				spec: "z",
				graph: "w",
				synthesize: "v",
				boundary: "",
			},
		});
		const resolved = resolveStagePrompts(projectRoot);
		for (const r of resolved) expect(r.source).toBe("defaults");
	});

	it("JSON inválido de una capa aborta ruidosamente (nunca silenciosamente)", () => {
		mkdirSync(join(projectRoot, ".frida", "traffic2api"), {
			recursive: true,
		});
		writeFileSync(join(projectRoot, TEAM_OVERRIDES_PATH), "{ no json", "utf-8");
		expect(() => resolveStagePrompts(projectRoot)).toThrow(/JSON inválido/);
	});

	it("el veto y la seguridad del HAR viven SOLO en el preamble no-stage (D11)", () => {
		// Un override 3-capas reemplaza el prompt completo del stage; si los
		// invariantes vivieran en un default de stage, un override los
		// omitiría en silencio. Deben ser inalcanzables para stages.json.
		expect(TRAFFIC2API_PREAMBLE).toContain("VETADO");
		expect(TRAFFIC2API_PREAMBLE).toContain("autorización");
		expect(TRAFFIC2API_STAGES).not.toContain("preamble");
		for (const stage of TRAFFIC2API_STAGES) {
			expect(DEFAULT_STAGE_PROMPTS[stage]).not.toContain("VETADO");
		}
	});
});
