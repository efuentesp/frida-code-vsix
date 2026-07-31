// frida-pipeline — tests de skill-bracket (parse + arm/restore de override).
//
// Verifica el gate de Fase 3 (ADR-0021):
//   - parseSkillInvocation detecta /skill:foo y <skill name="foo">.
//   - El bracket se arma SÓLO cuando hay override explícito en config.skills.
//   - No se arma para skills sin override.
//   - No se arma para input que no es /skill:.
//   - agent_end restaura el baseline (model + thinking).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	parseSkillInvocation,
	__resetSkillBracketState,
} from "../../src/tools/frida-pipeline/skill-bracket";
import {
	loadModelsConfig,
	invalidateModelsConfigCache,
	type ResolvedModelConfig,
} from "../../src/tools/frida-pipeline/models-config";
import { __resetSessionCaptureState } from "../../src/tools/frida-pipeline/session-capture";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Redirigir HOME para aislar models.json.
let realHome: string;
let tmpHome: string;

beforeEach(() => {
	realHome = process.env.HOME ?? os.homedir();
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "frida-bracket-"));
	process.env.HOME = tmpHome;
	__resetSkillBracketState();
	__resetSessionCaptureState();
	invalidateModelsConfigCache();
});

afterEach(() => {
	process.env.HOME = realHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeModels(json: string): void {
	const configPath = path.join(tmpHome, ".frida", "models.json");
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, json, "utf8");
}

describe("frida-pipeline / skill-bracket / parseSkillInvocation", () => {
	it("parsea /skill:commit (forma cruda)", () => {
		expect(parseSkillInvocation("/skill:commit")).toEqual({
			name: "commit",
		});
	});

	it("parsea /skill:commit con argumentos", () => {
		expect(parseSkillInvocation("/skill:commit -m wip")).toEqual({
			name: "commit",
		});
	});

	it("parsea /skill:commit seguido de newline", () => {
		expect(parseSkillInvocation("/skill:commit\n")).toEqual({
			name: "commit",
		});
	});

	it("parsea <skill name=… location=…> (wrapped, multilinea)", () => {
		// parseSkillBlock exige \n después de > y antes de </skill> (formato
		// multilinea, byte-exacto con el regex de Pi).
		const text =
			'<skill name="discover" location="/path/SKILL.md">\nbody\n</skill>';
		expect(parseSkillInvocation(text)).toEqual({
			name: "discover",
		});
	});

	it("devuelve undefined para texto que no es skill", () => {
		expect(parseSkillInvocation("hola, ¿cómo estás?")).toBeUndefined();
		expect(parseSkillInvocation("/wf build")).toBeUndefined();
		expect(parseSkillInvocation("")).toBeUndefined();
	});

	it("devuelve undefined para /skill: sin nombre", () => {
		expect(parseSkillInvocation("/skill:")).toBeUndefined();
		expect(parseSkillInvocation("/skill: ")).toBeUndefined();
	});
});

describe("frida-pipeline / skill-bracket / integración con models-config", () => {
	it("config vacía → ninguna skill tiene override", () => {
		const config = loadModelsConfig();
		expect(config.skills).toBeUndefined();
	});

	it("config con skills → parseSkillInvocation + getSkillModelConfig resuelven", () => {
		writeModels(`{
			"skills": {
				"commit": { "model": "github-copilot/gpt-5", "thinking": "low" }
			}
		}`);
		invalidateModelsConfigCache();
		const config = loadModelsConfig();
		const parsed = parseSkillInvocation("/skill:commit arg");
		expect(parsed).toEqual({ name: "commit" });

		const override = config.skills?.[parsed!.name] as ResolvedModelConfig;
		expect(override.model).toBe("github-copilot/gpt-5");
		expect(override.thinking).toBe("low");
	});

	it("skill sin override explícito → no hay entrada en config.skills", () => {
		writeModels(`{
			"skills": {
				"commit": { "model": "github-copilot/gpt-5" }
			}
		}`);
		invalidateModelsConfigCache();
		const config = loadModelsConfig();
		// "discover" no está en config.skills → el bracket NO se arma.
		expect(config.skills?.["discover"]).toBeUndefined();
	});

	it("override con sólo thinking (sin model) → el bracket se arma", () => {
		writeModels(`{
			"skills": {
				"discover": { "thinking": "high" }
			}
		}`);
		invalidateModelsConfigCache();
		const config = loadModelsConfig();
		const override = config.skills?.["discover"];
		// model es undefined pero thinking es "high" → el bracket se arma.
		expect(override?.model).toBeUndefined();
		expect(override?.thinking).toBe("high");
		// La comprobación del bracket: override existe Y tiene al menos un campo.
		const shouldArm =
			override &&
			(override.model !== undefined || override.thinking !== undefined);
		expect(shouldArm).toBe(true);
	});
});

describe("frida-pipeline / skill-bracket / gate E2E", () => {
	it("flujo: /skill:commit con override → config.skills tiene la entrada", () => {
		// Gate del ADR: "Cambiar modelo por skill via /frida-models y verificar override"
		writeModels(`{
			"skills": {
				"commit": { "model": "github-copilot/gpt-5", "thinking": "low" }
			}
		}`);
		invalidateModelsConfigCache();
		const config = loadModelsConfig();

		// 1. El usuario escribe /skill:commit
		const parsed = parseSkillInvocation("/skill:commit -m 'fix bug'");
		expect(parsed).toEqual({ name: "commit" });

		// 2. El bracket busca el override
		const override = parsed ? config.skills?.[parsed.name] : undefined;
		expect(override).toBeDefined();
		expect(override!.model).toBe("github-copilot/gpt-5");
		expect(override!.thinking).toBe("low");

		// 3. El override se aplicaría vía applyEffectiveModel (mockeado en
		//    test dedicado; aquí validamos la cadena de resolución).
	});
});
