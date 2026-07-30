import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildDefaultProfileGuideline,
	buildExecutablePathGuideline,
	classifyCredentialSource,
	mergeConfig,
	resolveEnvInterpolations,
	validateConfig,
} from "../../src/tools/frida-agent-browser/config/policy";
import {
	getConfigPaths,
	loadConfigSync,
} from "../../src/tools/frida-agent-browser/config/load";

describe("resolveEnvInterpolations", () => {
	const env = (e: Record<string, string>) => e;
	it("$VAR y ${VAR}", () => {
		expect(resolveEnvInterpolations("$HOME", env({ HOME: "/u/h" }))).toBe(
			"/u/h",
		);
		expect(resolveEnvInterpolations("${HOME}/x", env({ HOME: "/u/h" }))).toBe(
			"/u/h/x",
		);
	});
	it("escapes $$ → $ y $! → !", () => {
		expect(resolveEnvInterpolations("$$5", env({}))).toBe("$5");
		expect(resolveEnvInterpolations("cost $!", env({}))).toBe("cost !");
	});
	it("VAR indefinida → undefined (toda la resolución falla)", () => {
		expect(resolveEnvInterpolations("$NOPE", env({}))).toBeUndefined();
		expect(
			resolveEnvInterpolations("pre-${NOPE}-post", env({})),
		).toBeUndefined();
	});
	it("${ sin cerrar → undefined", () => {
		expect(
			resolveEnvInterpolations("${HOME", env({ HOME: "x" })),
		).toBeUndefined();
	});
	it("$ suelto (no seguido de nombre/{/$/$!) → literal $", () => {
		expect(resolveEnvInterpolations("price $", env({}))).toBe("price $");
		expect(resolveEnvInterpolations("$-x", env({}))).toBe("$-x");
	});
	it("mezcla: $A-${B}-$C", () => {
		expect(
			resolveEnvInterpolations("$A-${B}-$C", env({ A: "1", B: "2", C: "3" })),
		).toBe("1-2-3");
	});
});

describe("classifyCredentialSource", () => {
	it("literal / env / command", () => {
		expect(classifyCredentialSource("abc123")?.kind).toBe("literal");
		expect(classifyCredentialSource("$TOKEN")?.kind).toBe("env");
		expect(classifyCredentialSource("${TOKEN}")?.kind).toBe("env");
		expect(classifyCredentialSource("!op read x")?.kind).toBe("command");
		expect(classifyCredentialSource("   ")).toBeUndefined();
	});
});

describe("validateConfig", () => {
	it("v1 válida sin errores", () => {
		const { config, errors } = validateConfig({
			version: 1,
			browser: {
				executablePath: "/c",
				defaultProfile: { name: "Default", policy: "always" },
			},
			webSearch: { enabled: true, preferredProvider: "exa", exaApiKey: "$K" },
		});
		expect(errors).toEqual([]);
		expect(config.browser?.defaultProfile?.name).toBe("Default");
		expect(config.webSearch?.preferredProvider).toBe("exa");
	});
	it("versión incorrecta → error", () => {
		expect(validateConfig({ version: 2 }).errors[0]).toMatch(
			/version must be 1/,
		);
	});
	it("policy inválido → error", () => {
		expect(
			validateConfig({
				browser: { defaultProfile: { name: "X", policy: "nope" } },
			}).errors[0],
		).toMatch(/policy must be one of/);
	});
	it("tipo incorrecto → error", () => {
		expect(
			validateConfig({ browser: { executablePath: 5 } }).errors[0],
		).toMatch(/executablePath must be a string/);
		expect(validateConfig({ webSearch: { enabled: "yes" } }).errors[0]).toMatch(
			/enabled must be a boolean/,
		);
	});
	it("preferredProvider inválido → error", () => {
		expect(
			validateConfig({ webSearch: { preferredProvider: "google" } }).errors[0],
		).toMatch(/preferredProvider must be one of/);
	});
});

describe("mergeConfig", () => {
	it("override gana en escalares; sub-objetos se fusionan", () => {
		const m = mergeConfig(
			{
				browser: {
					executablePath: "/a",
					defaultProfile: { name: "P", policy: "always" },
				},
				webSearch: { enabled: true, exaApiKey: "x" },
			},
			{ browser: { executablePath: "/b" }, webSearch: { braveApiKey: "y" } },
		);
		expect(m.browser?.executablePath).toBe("/b");
		expect(m.browser?.defaultProfile?.name).toBe("P"); // heredado
		expect(m.webSearch?.exaApiKey).toBe("x");
		expect(m.webSearch?.braveApiKey).toBe("y");
	});
});

describe("guidance builders", () => {
	it("executablePath", () => {
		expect(buildExecutablePathGuideline("/chrome")).toMatch(
			/--executable-path "\/chrome" with sessionMode:fresh/,
		);
		expect(buildExecutablePathGuideline(undefined)).toBeUndefined();
	});
	it("defaultProfile always / authenticated-only / explicit-only", () => {
		expect(
			buildDefaultProfileGuideline({ name: "P", policy: "always" }),
		).toMatch(/policy always/);
		expect(
			buildDefaultProfileGuideline({ name: "P", policy: "authenticated-only" }),
		).toMatch(/signed-in\/account-specific/);
		expect(
			buildDefaultProfileGuideline({ name: "P", policy: "explicit-only" }),
		).toBeUndefined();
		expect(buildDefaultProfileGuideline(undefined)).toBeUndefined();
	});
});

describe("getConfigPaths", () => {
	it("global bajo agentDir, project bajo cwd/.frida, override del env", () => {
		const p = getConfigPaths({
			cwd: "/proj",
			agentDir: "/a/.frida",
			env: { PI_AGENT_BROWSER_CONFIG: "/o.json" },
		});
		expect(p.global).toBe(
			path.join("/a/.frida", "config", "frida-agent-browser", "config.json"),
		);
		expect(p.project).toBe(
			path.join(
				"/proj",
				".frida",
				"config",
				"frida-agent-browser",
				"config.json",
			),
		);
		expect(p.override).toBe("/o.json");
	});
	it("sin env override → undefined", () => {
		expect(
			getConfigPaths({ cwd: "/p", agentDir: "/a", env: {} }).override,
		).toBeUndefined();
	});
});

describe("loadConfigSync — capas", () => {
	function tmpAgentDir() {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cfg-"));
		const agentDir = path.join(dir, "agent");
		fs.mkdirSync(path.join(agentDir, "config", "frida-agent-browser"), {
			recursive: true,
		});
		return { dir, agentDir };
	}
	function writeCfg(file: string, obj: unknown) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(obj));
	}

	it("global aislado", () => {
		const { dir, agentDir } = tmpAgentDir();
		writeCfg(
			path.join(agentDir, "config", "frida-agent-browser", "config.json"),
			{
				browser: { executablePath: "/global-chrome" },
			},
		);
		const s = loadConfigSync({ cwd: dir, agentDir, env: {} });
		expect(s.executablePath).toBe("/global-chrome");
		expect(s.executablePathScope).toBe("global");
		expect(s.errors).toEqual([]);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("project overridea global", () => {
		const { dir, agentDir } = tmpAgentDir();
		writeCfg(
			path.join(agentDir, "config", "frida-agent-browser", "config.json"),
			{ browser: { executablePath: "/g" } },
		);
		writeCfg(
			path.join(dir, ".frida", "config", "frida-agent-browser", "config.json"),
			{ browser: { executablePath: "/p" } },
		);
		const s = loadConfigSync({ cwd: dir, agentDir, env: {} });
		expect(s.executablePath).toBe("/p");
		expect(s.executablePathScope).toBe("project");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("override env gana sobre todo", () => {
		const { dir, agentDir } = tmpAgentDir();
		writeCfg(
			path.join(agentDir, "config", "frida-agent-browser", "config.json"),
			{ browser: { executablePath: "/g" } },
		);
		const ov = path.join(dir, "override.json");
		writeCfg(ov, { browser: { executablePath: "/o" } });
		const s = loadConfigSync({
			cwd: dir,
			agentDir,
			env: { PI_AGENT_BROWSER_CONFIG: ov },
		});
		expect(s.executablePath).toBe("/o");
		expect(s.executablePathScope).toBe("override");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("includeProjectConfig=false omite la capa proyecto", () => {
		const { dir, agentDir } = tmpAgentDir();
		writeCfg(
			path.join(agentDir, "config", "frida-agent-browser", "config.json"),
			{ browser: { executablePath: "/g" } },
		);
		writeCfg(
			path.join(dir, ".frida", "config", "frida-agent-browser", "config.json"),
			{ browser: { executablePath: "/p" } },
		);
		const s = loadConfigSync({
			cwd: dir,
			agentDir,
			env: {},
			includeProjectConfig: false,
		});
		expect(s.executablePath).toBe("/g"); // proyecto ignorado
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("webSearchEnabled: false explícito desactiva", () => {
		const { dir, agentDir } = tmpAgentDir();
		writeCfg(
			path.join(agentDir, "config", "frida-agent-browser", "config.json"),
			{ webSearch: { enabled: false, exaApiKey: "$K" } },
		);
		const s = loadConfigSync({ cwd: dir, agentDir, env: {} });
		expect(s.webSearchEnabled).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("webSearchEnabled: true si hay claves y no está en false", () => {
		const { dir, agentDir } = tmpAgentDir();
		writeCfg(
			path.join(agentDir, "config", "frida-agent-browser", "config.json"),
			{ webSearch: { exaApiKey: "literal" } },
		);
		const s = loadConfigSync({ cwd: dir, agentDir, env: {} });
		expect(s.webSearchEnabled).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
