// frida-understand-app — tests del resolver 3-capas (issue #134).
// Molde: test/frida-app-walkthrough/resolver.test.ts (#133). Aislamiento:
// HOME a tmpdir (resolve() lee ~/.frida/understand-app/stages.json en
// launch-time) + projectRoot desechable por test.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveStagePrompts,
	TEAM_OVERRIDES_PATH,
	userOverridesPath,
} from "../../src/tools/frida-understand-app/resolver";
import {
	DEFAULT_STAGE_PROMPTS,
	UNDERSTAND_APP_PREAMBLE,
	UNDERSTAND_APP_STAGES,
} from "../../src/tools/frida-understand-app/skills";

const REAL_HOME = process.env.HOME;

let home: string;
let projectRoot: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "understand-home-"));
	projectRoot = mkdtempSync(join(tmpdir(), "understand-proj-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(projectRoot, { recursive: true, force: true });
});

function writeTeamOverrides(overrides: unknown): void {
	mkdirSync(join(projectRoot, ".frida", "understand-app"), {
		recursive: true,
	});
	writeFileSync(
		join(projectRoot, TEAM_OVERRIDES_PATH),
		JSON.stringify(overrides),
		"utf-8",
	);
}

function writeUserOverrides(overrides: unknown): void {
	mkdirSync(join(home, ".frida", "understand-app"), { recursive: true });
	writeFileSync(userOverridesPath(), JSON.stringify(overrides), "utf-8");
}

describe("frida-understand-app · resolver 3-capas (#134)", () => {
	it("sin overrides resuelve defaults para los 4 stages", () => {
		const resolved = resolveStagePrompts(projectRoot);
		expect(resolved.map((r) => r.stage)).toEqual([...UNDERSTAND_APP_STAGES]);
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
		expect(others).toHaveLength(3);
		for (const r of others) expect(r.source).toBe("defaults");
	});

	it("usuario gana sobre equipo y defaults", () => {
		writeTeamOverrides({
			stages: { overview: "team overview", judge: "team judge" },
		});
		writeUserOverrides({ stages: { overview: "user overview" } });
		const resolved = resolveStagePrompts(projectRoot);
		const overview = resolved.find((r) => r.stage === "overview");
		expect(overview?.source).toBe("user");
		expect(overview?.prompt).toBe("user overview");
		const judge = resolved.find((r) => r.stage === "judge");
		expect(judge?.source).toBe("team");
		expect(judge?.prompt).toBe("team judge");
	});

	it("stages desconocidos y valores vacíos se ignoran", () => {
		writeTeamOverrides({
			stages: { bootstrap: "x", synthesize: "y", analyze: "", overview: 42 },
		});
		const resolved = resolveStagePrompts(projectRoot);
		for (const r of resolved) expect(r.source).toBe("defaults");
	});

	it("JSON inválido de una capa aborta ruidosamente (nunca silenciosamente)", () => {
		mkdirSync(join(projectRoot, ".frida", "understand-app"), {
			recursive: true,
		});
		writeFileSync(join(projectRoot, TEAM_OVERRIDES_PATH), "{ no json", "utf-8");
		expect(() => resolveStagePrompts(projectRoot)).toThrow(/JSON inválido/);
	});

	it("el veto de solo-lectura vive SOLO en el preamble no-stage", () => {
		// D8 (análogo M8): un override 3-capas reemplaza el prompt completo
		// del stage; si el veto viviera en un default de stage, un override
		// lo omitiría en silencio. Debe ser inalcanzable para stages.json.
		expect(UNDERSTAND_APP_PREAMBLE).toContain("VETADO");
		expect(UNDERSTAND_APP_STAGES).not.toContain("preamble");
		for (const stage of UNDERSTAND_APP_STAGES) {
			expect(DEFAULT_STAGE_PROMPTS[stage]).not.toContain("VETADO");
		}
	});
});
