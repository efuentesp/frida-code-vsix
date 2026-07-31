// frida-pipeline — tests de models-config (schema, loader, cascade).
//
// Verifica:
//   - loadModelsConfig carga JSON válido y lo resuelve con cascade.
//   - Fail-soft: JSON ausente o inválido → config vacía.
//   - Cascade: skills[name] pisa defaults; defaults cae a entradas sin override.
//   - resolveStageModel: preset > stage > skill > defaults.
//   - getSkillModelConfig: lookup directo + fallback a defaults.
//   - resolveMaxConcurrency: default 4 cuando ausente/inválido.
//   - Template para /frida-models es JSON válido.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	loadModelsConfig,
	invalidateModelsConfigCache,
	getModelsConfigPath,
	getSkillModelConfig,
	resolveStageModel,
	resolveMaxConcurrency,
	modelsConfigTemplate,
	DEFAULT_MAX_CONCURRENCY,
} from "../../src/tools/frida-pipeline/models-config";

// El loader lee ~/.frida/models.json. Para aislar los tests, redirigimos
// HOME a un directorio temporal.

let realHome: string;
let tmpHome: string;

beforeEach(() => {
	realHome = process.env.HOME ?? os.homedir();
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "frida-models-"));
	process.env.HOME = tmpHome;
	invalidateModelsConfigCache();
});

afterEach(() => {
	process.env.HOME = realHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeModels(json: string): void {
	const configPath = getModelsConfigPath();
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, json, "utf8");
}

describe("frida-pipeline / models-config / loadModelsConfig", () => {
	it("JSON ausente → config vacía (fail-soft)", () => {
		const config = loadModelsConfig();
		expect(config.defaults).toBeUndefined();
		expect(config.skills).toBeUndefined();
		expect(config.agents).toBeUndefined();
		expect(config.stages).toBeUndefined();
		expect(config.presets).toBeUndefined();
	});

	it("JSON inválido → config vacía (fail-soft)", () => {
		writeModels("{ this is not valid json ]]]");
		const config = loadModelsConfig();
		expect(config.defaults).toBeUndefined();
		expect(config.skills).toBeUndefined();
	});

	it("carga defaults como string shorthand", () => {
		writeModels(`{ "defaults": "anthropic/claude-sonnet-4-20250514" }`);
		const config = loadModelsConfig();
		expect(config.defaults?.model).toBe("anthropic/claude-sonnet-4-20250514");
	});

	it("carga defaults como objeto con model + thinking", () => {
		writeModels(
			`{ "defaults": { "model": "openai/gpt-4o", "thinking": "high" } }`,
		);
		const config = loadModelsConfig();
		expect(config.defaults?.model).toBe("openai/gpt-4o");
		expect(config.defaults?.thinking).toBe("high");
	});

	it("carga skills con cascade desde defaults", () => {
		writeModels(`{
			"defaults": { "model": "anthropic/default", "thinking": "medium" },
			"skills": {
				"commit": { "model": "github-copilot/gpt-5" },
				"discover": { "thinking": "high" }
			}
		}`);
		const config = loadModelsConfig();
		// commit: model override, thinking heredado de defaults.
		expect(config.skills?.commit.model).toBe("github-copilot/gpt-5");
		expect(config.skills?.commit.thinking).toBe("medium");
		// discover: thinking override, model heredado de defaults.
		expect(config.skills?.discover.model).toBe("anthropic/default");
		expect(config.skills?.discover.thinking).toBe("high");
	});

	it("skill como string shorthand → { model } sin thinking", () => {
		writeModels(`{
			"skills": { "commit": "github-copilot/gpt-5" }
		}`);
		const config = loadModelsConfig();
		expect(config.skills?.commit.model).toBe("github-copilot/gpt-5");
		expect(config.skills?.commit.thinking).toBeUndefined();
	});

	it("thinking desconocido → warn + sin thinking", () => {
		writeModels(`{
			"skills": { "commit": { "thinking": "ultra" } }
		}`);
		const config = loadModelsConfig();
		expect(config.skills?.commit.thinking).toBeUndefined();
	});

	it("propiedades desconocidas se limpian (additionalProperties: false)", () => {
		writeModels(`{
			"defaults": { "model": "anthropic/x", "temperature": 0.7 }
		}`);
		const config = loadModelsConfig();
		expect(config.defaults?.model).toBe("anthropic/x");
		// temperature no está en el schema → se limpia (no aparece).
		expect(config.defaults).not.toHaveProperty("temperature");
	});

	it("cache de sesión: segunda llamada devuelve el mismo objeto", () => {
		writeModels(`{ "defaults": "anthropic/x" }`);
		const first = loadModelsConfig();
		// Modificar el archivo no afecta: el cache está activo.
		writeModels(`{ "defaults": "anthropic/y" }`);
		const second = loadModelsConfig();
		expect(second).toBe(first); // misma referencia (cache)
	});

	it("invalidateModelsConfigCache fuerza recarga", () => {
		writeModels(`{ "defaults": "anthropic/x" }`);
		const first = loadModelsConfig();
		invalidateModelsConfigCache();
		writeModels(`{ "defaults": "anthropic/y" }`);
		const second = loadModelsConfig();
		expect(second.defaults?.model).toBe("anthropic/y");
		expect(second).not.toBe(first);
	});
});

describe("frida-pipeline / models-config / getSkillModelConfig", () => {
	it("devuelve el override de la skill si existe", () => {
		writeModels(`{
			"skills": { "commit": "github-copilot/gpt-5" }
		}`);
		const config = loadModelsConfig();
		const result = getSkillModelConfig(config, "commit");
		expect(result?.model).toBe("github-copilot/gpt-5");
	});

	it("cae a defaults si la skill no tiene override", () => {
		writeModels(`{
			"defaults": "anthropic/default",
			"skills": { "commit": "github-copilot/gpt-5" }
		}`);
		const config = loadModelsConfig();
		const result = getSkillModelConfig(config, "nonexistent");
		expect(result?.model).toBe("anthropic/default");
	});

	it("undefined si no hay defaults ni override", () => {
		writeModels(`{}`);
		const config = loadModelsConfig();
		expect(getSkillModelConfig(config, "commit")).toBeUndefined();
	});
});

describe("frida-pipeline / models-config / resolveStageModel", () => {
	it("cascade: presets[workflow].stages[stage] gana sobre stages[stage]", () => {
		writeModels(`{
			"stages": { "plan": "anthropic/stage-default" },
			"presets": { "build": { "stages": { "plan": "anthropic/preset-plan" } } }
		}`);
		const config = loadModelsConfig();
		const result = resolveStageModel(config, {
			workflow: "build",
			stage: "plan",
		});
		expect(result?.model).toBe("anthropic/preset-plan");
	});

	it("cascade: stages[stage] gana sobre skills[skill]", () => {
		writeModels(`{
			"stages": { "plan": "anthropic/stage-plan" },
			"skills": { "discover": "anthropic/skill-discover" }
		}`);
		const config = loadModelsConfig();
		const result = resolveStageModel(config, {
			stage: "plan",
			skill: "discover",
		});
		expect(result?.model).toBe("anthropic/stage-plan");
	});

	it("cascade: skills[skill] cuando stage no existe", () => {
		writeModels(`{
			"skills": { "discover": "anthropic/skill-discover" }
		}`);
		const config = loadModelsConfig();
		const result = resolveStageModel(config, {
			stage: "nonexistent",
			skill: "discover",
		});
		expect(result?.model).toBe("anthropic/skill-discover");
	});

	it("cascade: defaults como último recurso", () => {
		writeModels(`{
			"defaults": "anthropic/default"
		}`);
		const config = loadModelsConfig();
		const result = resolveStageModel(config, {
			stage: "nope",
			skill: "nope",
		});
		expect(result?.model).toBe("anthropic/default");
	});
});

describe("frida-pipeline / models-config / resolveMaxConcurrency", () => {
	it("devuelve el valor configurado cuando es válido", () => {
		writeModels(`{ "maxConcurrency": 8 }`);
		const config = loadModelsConfig();
		expect(resolveMaxConcurrency(config)).toBe(8);
	});

	it("default 4 cuando ausente", () => {
		writeModels(`{}`);
		const config = loadModelsConfig();
		expect(resolveMaxConcurrency(config)).toBe(DEFAULT_MAX_CONCURRENCY);
	});

	it("default 4 cuando inválido (0)", () => {
		writeModels(`{ "maxConcurrency": 0 }`);
		const config = loadModelsConfig();
		expect(resolveMaxConcurrency(config)).toBe(DEFAULT_MAX_CONCURRENCY);
	});
});

describe("frida-pipeline / models-config / template", () => {
	it("el template es JSON válido y parseable", () => {
		const tpl = modelsConfigTemplate();
		const parsed = JSON.parse(tpl);
		expect(parsed.defaults).toBeDefined();
		expect(parsed.skills).toBeDefined();
	});

	it("el template tiene defaults con modelo y skills con ejemplos", () => {
		const parsed = JSON.parse(modelsConfigTemplate());
		expect(parsed.defaults.model).toBeTruthy();
		expect(Object.keys(parsed.skills).length).toBeGreaterThan(0);
	});
});
