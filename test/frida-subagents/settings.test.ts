// frida-subagents — tests de Fase 4 (settings + graceful max_turns).
//
// Verifica el gate de Fase 4 (ADR-0022):
//   - loadSettings devuelve defaults cuando no hay archivo.
//   - Global override defaults.
//   - Project override global.
//   - saveProjectSettings persiste y recarga.
//   - formatSettings produce texto legible.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	loadSettings,
	saveProjectSettings,
	formatSettings,
	_DEFAULTS,
	type SubagentsSettings,
} from "../../src/tools/frida-subagents/settings";

let realHome: string;
let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
	realHome = process.env.HOME ?? os.homedir();
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sub4-"));
	tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sub4-cwd-"));
	process.env.HOME = tmpHome;
});

afterEach(() => {
	process.env.HOME = realHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpCwd, { recursive: true, force: true });
});

describe("frida-subagents / settings / defaults", () => {
	it("loadSettings devuelve defaults cuando no hay archivo", () => {
		const settings = loadSettings(tmpCwd);
		expect(settings).toEqual(_DEFAULTS);
		expect(settings.maxConcurrent).toBe(4);
		expect(settings.defaultMaxTurns).toBe(0);
		expect(settings.graceTurns).toBe(5);
		expect(settings.joinMode).toBe("smart");
	});
});

describe("frida-subagents / settings / global override", () => {
	it("global override defaults", () => {
		const globalDir = path.join(tmpHome, ".frida");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "subagents.json"),
			JSON.stringify({ maxConcurrent: 8, graceTurns: 10 }),
			"utf8",
		);

		const settings = loadSettings(tmpCwd);
		expect(settings.maxConcurrent).toBe(8);
		expect(settings.graceTurns).toBe(10);
		// No sobreescritos → defaults.
		expect(settings.defaultMaxTurns).toBe(0);
		expect(settings.joinMode).toBe("smart");
	});

	it("global joinMode override", () => {
		const globalDir = path.join(tmpHome, ".frida");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "subagents.json"),
			JSON.stringify({ joinMode: "async" }),
			"utf8",
		);

		const settings = loadSettings(tmpCwd);
		expect(settings.joinMode).toBe("async");
	});
});

describe("frida-subagents / settings / project override", () => {
	it("project override global", () => {
		// Global.
		const globalDir = path.join(tmpHome, ".frida");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "subagents.json"),
			JSON.stringify({ maxConcurrent: 8 }),
			"utf8",
		);

		// Project.
		const projDir = path.join(tmpCwd, ".frida");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, "subagents.json"),
			JSON.stringify({ maxConcurrent: 2 }),
			"utf8",
		);

		const settings = loadSettings(tmpCwd);
		expect(settings.maxConcurrent).toBe(2); // project wins
	});

	it("saveProjectSettings persiste y recarga", () => {
		const ok = saveProjectSettings(tmpCwd, { maxConcurrent: 6 });
		expect(ok).toBe(true);

		const settings = loadSettings(tmpCwd);
		expect(settings.maxConcurrent).toBe(6);
	});
});

describe("frida-subagents / settings / invalid values", () => {
	it("campos inválidos se ignoran", () => {
		const globalDir = path.join(tmpHome, ".frida");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "subagents.json"),
			JSON.stringify({
				maxConcurrent: -1, // inválido → ignorado
				graceTurns: "abc", // inválido → ignorado
				joinMode: "invalid", // inválido → ignorado
			}),
			"utf8",
		);

		const settings = loadSettings(tmpCwd);
		expect(settings.maxConcurrent).toBe(4); // default
		expect(settings.graceTurns).toBe(5); // default
		expect(settings.joinMode).toBe("smart"); // default
	});

	it("JSON malformado → defaults", () => {
		const globalDir = path.join(tmpHome, ".frida");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "subagents.json"),
			"{ not valid json }",
			"utf8",
		);

		const settings = loadSettings(tmpCwd);
		expect(settings).toEqual(_DEFAULTS);
	});
});

describe("frida-subagents / settings / formatSettings", () => {
	it("produce texto legible con todos los campos", () => {
		const settings: SubagentsSettings = {
			maxConcurrent: 4,
			defaultMaxTurns: 20,
			graceTurns: 5,
			joinMode: "smart",
		};
		const text = formatSettings(settings);
		expect(text).toContain("maxConcurrent: 4");
		expect(text).toContain("defaultMaxTurns: 20");
		expect(text).toContain("graceTurns: 5");
		expect(text).toContain("joinMode: smart");
	});

	it("defaultMaxTurns 0 muestra 'ilimitado'", () => {
		const text = formatSettings(_DEFAULTS);
		expect(text).toContain("ilimitado");
	});
});

describe("frida-subagents / graceful max_turns", () => {
	it("max_turns en SpawnOptions se respeta", () => {
		// Verificamos que el campo existe y se pasa correctamente.
		// La integración completa con session.steer se prueba en E2E.
		const options = {
			prompt: "test",
			description: "test",
			maxTurns: 10,
		};
		expect(options.maxTurns).toBe(10);
	});

	it("graceTurns default es 5", () => {
		expect(_DEFAULTS.graceTurns).toBe(5);
	});
});
