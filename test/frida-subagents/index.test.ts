// frida-subagents — tests de Fase 1 (factory, defaults, custom-agents).
//
// Verifica el gate de Fase 1 (ADR-0022):
//   - createFridaSubagents factory existe y devuelve una función.
//   - Los 3 defaults están definidos (general-purpose, Explore, Plan).
//   - loadCustomAgents descubre .md de .frida/agents/ y ~/.frida/global/agents/.
//   - resolveAgentConfig resuelve defaults y custom case-insensitive.
//   - getAvailableTypes lista defaults + custom.
//   - agent-manager: register, get, updateStatus, cleanup.
//   - general-purpose tiene promptMode: append (hereda padre).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_AGENTS,
	DEFAULT_AGENT_NAMES,
	GENERAL_PURPOSE_AGENT,
	EXPLORE_AGENT,
	PLAN_AGENT,
} from "../../src/tools/frida-subagents/default-agents";
import { loadCustomAgents } from "../../src/tools/frida-subagents/custom-agents";
import {
	resolveAgentConfig,
	getAvailableTypes,
} from "../../src/tools/frida-subagents/agent-runner";
import {
	generateAgentId,
	registerAgent,
	getAgent,
	updateAgentStatus,
	listAgents,
	_resetAgentManager,
} from "../../src/tools/frida-subagents/agent-manager";
import { createFridaSubagents } from "../../src/tools/frida-subagents";

// Redirigir HOME para aislar ~/.frida/global/agents/.
let realHome: string;
let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
	realHome = process.env.HOME ?? os.homedir();
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "frida-subagents-"));
	tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-subagents-cwd-"));
	process.env.HOME = tmpHome;
	_resetAgentManager();
});

afterEach(() => {
	process.env.HOME = realHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpCwd, { recursive: true, force: true });
});

describe("frida-subagents / factory", () => {
	it("createFridaSubagents devuelve una función factory", () => {
		const factory = createFridaSubagents();
		expect(typeof factory).toBe("function");
	});

	it("la factory acepta ExtensionAPI sin crashear", () => {
		// Registry detached aislado (la factory bootea reconcileRuns al inicio).
		const tmp = require("node:fs").mkdtempSync(
			require("node:path").join(require("node:os").tmpdir(), "sbx-fac-"),
		);
		process.env.FRIDA_DETACHED_DIR = require("node:path").join(tmp, "runs");
		try {
			const factory = createFridaSubagents();
			// Pi invoca la factory con la ExtensionAPI. Mock mínimo.
			const tools: string[] = [];
			const commands: string[] = [];
			const mockPi = {
				registerTool: (tool: { name: string }) => tools.push(tool.name),
				registerCommand: (name: string) => commands.push(name),
			};
			expect(() => factory(mockPi as never)).not.toThrow();
			expect(tools).toContain("Agent");
			expect(tools).toContain("get_subagent_result");
			expect(tools).toContain("steer_subagent");
			expect(commands).toContain("detached"); // #26
		} finally {
			delete process.env.FRIDA_DETACHED_DIR;
			require("node:fs").rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("frida-subagents / default agents", () => {
	it("tiene exactamente 3 defaults", () => {
		expect(DEFAULT_AGENTS).toHaveLength(3);
		expect(DEFAULT_AGENT_NAMES).toEqual(["general-purpose", "Explore", "Plan"]);
	});

	it("general-purpose tiene promptMode: append (hereda padre)", () => {
		expect(GENERAL_PURPOSE_AGENT.promptMode).toBe("append");
		expect(GENERAL_PURPOSE_AGENT.systemPrompt).toBe("");
		expect(GENERAL_PURPOSE_AGENT.isDefault).toBe(true);
	});

	it("Explore tiene promptMode: replace y tools read-only", () => {
		expect(EXPLORE_AGENT.promptMode).toBe("replace");
		expect(EXPLORE_AGENT.builtinToolNames).toEqual([
			"read",
			"bash",
			"grep",
			"find",
			"ls",
		]);
	});

	it("Plan tiene promptMode: replace y tools read-only", () => {
		expect(PLAN_AGENT.promptMode).toBe("replace");
		expect(PLAN_AGENT.builtinToolNames).toContain("read");
	});
});

describe("frida-subagents / custom-agents / loadCustomAgents", () => {
	it("directorio vacío → mapa vacío", () => {
		const agents = loadCustomAgents(tmpCwd);
		expect(agents.size).toBe(0);
	});

	it("descubre .md de .frida/agents/ (proyecto)", () => {
		const agentsDir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(agentsDir, "auditor.md"),
			"---\ndescription: Security auditor\ntools: read, grep\n---\n\nYou are a security auditor.",
			"utf8",
		);

		const agents = loadCustomAgents(tmpCwd);
		expect(agents.has("auditor")).toBe(true);
		expect(agents.get("auditor")?.description).toBe("Security auditor");
		expect(agents.get("auditor")?.builtinToolNames).toEqual(["read", "grep"]);
	});

	it("descubre .md de ~/.frida/global/agents/ (global)", () => {
		const globalDir = path.join(tmpHome, ".frida", "global", "agents");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "codebase-locator.md"),
			"---\ndescription: Find code\ntools: grep, find, ls\nisolated: true\n---\n\nFind files.",
			"utf8",
		);

		const agents = loadCustomAgents(tmpCwd);
		expect(agents.has("codebase-locator")).toBe(true);
		expect(agents.get("codebase-locator")?.source).toBe("global");
	});

	it("proyecto pisa a global con el mismo nombre", () => {
		const globalDir = path.join(tmpHome, ".frida", "global", "agents");
		const projDir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.mkdirSync(projDir, { recursive: true });

		fs.writeFileSync(
			path.join(globalDir, "shared.md"),
			"---\ndescription: Global version\n---\n\nGlobal.",
			"utf8",
		);
		fs.writeFileSync(
			path.join(projDir, "shared.md"),
			"---\ndescription: Project version\n---\n\nProject.",
			"utf8",
		);

		const agents = loadCustomAgents(tmpCwd);
		expect(agents.get("shared")?.description).toBe("Project version");
		expect(agents.get("shared")?.source).toBe("project");
	});
});

describe("frida-subagents / resolveAgentConfig", () => {
	it("resuelve general-purpose (default)", () => {
		const config = resolveAgentConfig("general-purpose", tmpCwd);
		expect(config).toBeDefined();
		expect(config?.name).toBe("general-purpose");
	});

	it("resuelve Explore case-insensitive", () => {
		const config = resolveAgentConfig("explore", tmpCwd);
		expect(config?.name).toBe("Explore");
	});

	it("resuelve custom agent del proyecto", () => {
		const agentsDir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(agentsDir, "auditor.md"),
			"---\ndescription: Auditor\n---\n\nAudit code.",
			"utf8",
		);

		const config = resolveAgentConfig("auditor", tmpCwd);
		expect(config?.name).toBe("auditor");
	});

	it("undefined para tipo desconocido", () => {
		expect(resolveAgentConfig("nonexistent", tmpCwd)).toBeUndefined();
	});
});

describe("frida-subagents / getAvailableTypes", () => {
	it("incluye los 3 defaults", () => {
		const types = getAvailableTypes(tmpCwd);
		expect(types).toContain("general-purpose");
		expect(types).toContain("Explore");
		expect(types).toContain("Plan");
	});

	it("incluye custom agents", () => {
		const agentsDir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(agentsDir, "auditor.md"),
			"---\ndescription: Auditor\n---\n\nAudit.",
			"utf8",
		);

		const types = getAvailableTypes(tmpCwd);
		expect(types).toContain("auditor");
	});
});

describe("frida-subagents / agent-manager", () => {
	it("generateAgentId genera IDs únicos", () => {
		const id1 = generateAgentId();
		const id2 = generateAgentId();
		expect(id1).not.toBe(id2);
		expect(id1).toMatch(/^agent-/);
	});

	it("registerAgent + getAgent", () => {
		const id = generateAgentId();
		registerAgent({
			id,
			type: "general-purpose",
			description: "test",
			status: "running",
			toolUses: 0,
			startedAt: Date.now(),
		});
		expect(getAgent(id)?.type).toBe("general-purpose");
	});

	it("updateAgentStatus cambia estado y resultado", () => {
		const id = generateAgentId();
		registerAgent({
			id,
			type: "Explore",
			description: "test",
			status: "running",
			toolUses: 0,
			startedAt: Date.now(),
		});
		updateAgentStatus(id, "completed", "resultado test");
		expect(getAgent(id)?.status).toBe("completed");
		expect(getAgent(id)?.result).toBe("resultado test");
		expect(getAgent(id)?.completedAt).toBeDefined();
	});

	it("listAgents devuelve todos los registros", () => {
		registerAgent({
			id: "a",
			type: "Explore",
			description: "a",
			status: "running",
			toolUses: 0,
			startedAt: 1,
		});
		registerAgent({
			id: "b",
			type: "Plan",
			description: "b",
			status: "completed",
			toolUses: 5,
			startedAt: 2,
		});
		expect(listAgents()).toHaveLength(2);
	});
});
