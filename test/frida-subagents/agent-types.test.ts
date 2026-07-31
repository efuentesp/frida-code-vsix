// frida-subagents — tests de Fase 2 (registry + tool scoping + frida-pipeline).
//
// Verifica el gate de Fase 2 (ADR-0022):
//   - agent-types registry: resolveType, getAgentConfig, getToolNamesForType.
//   - Los 15 agentes de frida-pipeline tienen frontmatter válido.
//   - Tool restrictions del frontmatter se aplican.
//   - promptMode: replace → systemPrompt override.
//   - reloadCustomAgents detecta nuevos .md sin reiniciar.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	resolveType,
	getAgentConfig,
	getDisplayName,
	getToolNamesForType,
	getAvailableTypes,
	reloadCustomAgents,
	_resetAgentTypes,
	BUILTIN_TOOL_NAMES,
} from "../../src/tools/frida-subagents/agent-types";
import {
	GENERAL_PURPOSE_AGENT,
	EXPLORE_AGENT,
} from "../../src/tools/frida-subagents/default-agents";

// Paths de los agentes de frida-pipeline (source).
const PIPELINE_AGENTS_DIR = path.join(
	__dirname,
	"../../src/tools/frida-pipeline/agents",
);

let realHome: string;
let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
	realHome = process.env.HOME ?? os.homedir();
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sub2-"));
	tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sub2-cwd-"));
	process.env.HOME = tmpHome;
	_resetAgentTypes();
});

afterEach(() => {
	process.env.HOME = realHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpCwd, { recursive: true, force: true });
});

/** Copia los 15 agentes de frida-pipeline al tmpHome/global/agents/. */
function syncPipelineAgents(): void {
	const targetDir = path.join(tmpHome, ".frida", "global", "agents");
	fs.mkdirSync(targetDir, { recursive: true });
	if (!fs.existsSync(PIPELINE_AGENTS_DIR)) return;
	for (const file of fs.readdirSync(PIPELINE_AGENTS_DIR)) {
		if (file.endsWith(".md")) {
			fs.copyFileSync(
				path.join(PIPELINE_AGENTS_DIR, file),
				path.join(targetDir, file),
			);
		}
	}
}

describe("frida-subagents / agent-types / resolveType", () => {
	it("resuelve defaults case-insensitive", () => {
		expect(resolveType("general-purpose", tmpCwd)).toBe("general-purpose");
		expect(resolveType("GENERAL-PURPOSE", tmpCwd)).toBe("general-purpose");
		expect(resolveType("explore", tmpCwd)).toBe("Explore");
		expect(resolveType("PLAN", tmpCwd)).toBe("Plan");
	});

	it("resuelve custom agents case-insensitive", () => {
		const dir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "auditor.md"),
			"---\ndescription: Auditor\n---\n\nAudit.",
			"utf8",
		);
		reloadCustomAgents(tmpCwd);

		expect(resolveType("auditor", tmpCwd)).toBe("auditor");
		expect(resolveType("AUDITOR", tmpCwd)).toBe("auditor");
	});

	it("undefined para tipo desconocido", () => {
		expect(resolveType("nonexistent", tmpCwd)).toBeUndefined();
	});
});

describe("frida-subagents / agent-types / getAgentConfig", () => {
	it("devuelve config completo de defaults", () => {
		const config = getAgentConfig("Explore", tmpCwd);
		expect(config?.name).toBe("Explore");
		expect(config?.promptMode).toBe("replace");
		expect(config?.builtinToolNames).toBeDefined();
	});

	it("devuelve config de custom con frontmatter parseado", () => {
		const dir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "researcher.md"),
			"---\ndescription: Research agent\ntools: read, grep, bash\nmodel: anthropic/claude-sonnet\nthinking: high\nmax_turns: 20\n---\n\nYou are a researcher.",
			"utf8",
		);
		reloadCustomAgents(tmpCwd);

		const config = getAgentConfig("researcher", tmpCwd);
		expect(config?.description).toBe("Research agent");
		expect(config?.builtinToolNames).toEqual(["read", "grep", "bash"]);
		expect(config?.model).toBe("anthropic/claude-sonnet");
		expect(config?.thinking).toBe("high");
		expect(config?.maxTurns).toBe(20);
		expect(config?.systemPrompt).toBe("You are a researcher.");
		expect(config?.promptMode).toBe("replace");
	});
});

describe("frida-subagents / agent-types / getToolNamesForType", () => {
	it("undefined para general-purpose (todos los tools)", () => {
		expect(getToolNamesForType(GENERAL_PURPOSE_AGENT)).toBeUndefined();
	});

	it("subconjunto para Explore", () => {
		const tools = getToolNamesForType(EXPLORE_AGENT);
		expect(tools).toEqual(["read", "bash", "grep", "find", "ls"]);
	});

	it("tools del frontmatter de custom agent", () => {
		const dir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "auditor.md"),
			"---\ntools: read, grep\n---\n\nAudit.",
			"utf8",
		);
		reloadCustomAgents(tmpCwd);

		const config = getAgentConfig("auditor", tmpCwd)!;
		expect(getToolNamesForType(config)).toEqual(["read", "grep"]);
	});
});

describe("frida-subagents / agent-types / getAvailableTypes", () => {
	it("incluye defaults + custom", () => {
		const dir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "custom-agent.md"),
			"---\ndescription: Custom\n---\n\nCustom.",
			"utf8",
		);
		reloadCustomAgents(tmpCwd);

		const types = getAvailableTypes(tmpCwd);
		expect(types).toContain("general-purpose");
		expect(types).toContain("Explore");
		expect(types).toContain("Plan");
		expect(types).toContain("custom-agent");
	});
});

describe("frida-subagents / agent-types / reloadCustomAgents", () => {
	it("detecta nuevos .md sin reiniciar", () => {
		// Primera carga: sin custom.
		reloadCustomAgents(tmpCwd);
		expect(getAvailableTypes(tmpCwd)).not.toContain("new-agent");

		// Añadir .md nuevo.
		const dir = path.join(tmpCwd, ".frida", "agents");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "new-agent.md"),
			"---\ndescription: New\n---\n\nNew.",
			"utf8",
		);

		// Recargar.
		reloadCustomAgents(tmpCwd);
		expect(getAvailableTypes(tmpCwd)).toContain("new-agent");
	});
});

describe("frida-subagents / frida-pipeline integration", () => {
	it("los 15 agentes de frida-pipeline existen en source", () => {
		expect(fs.existsSync(PIPELINE_AGENTS_DIR)).toBe(true);
		const agents = fs
			.readdirSync(PIPELINE_AGENTS_DIR)
			.filter((f) => f.endsWith(".md"));
		expect(agents.length).toBe(15);
	});

	it("cada agente de frida-pipeline tiene frontmatter con name y description", () => {
		const agents = fs
			.readdirSync(PIPELINE_AGENTS_DIR)
			.filter((f) => f.endsWith(".md"));

		for (const file of agents) {
			const content = fs.readFileSync(
				path.join(PIPELINE_AGENTS_DIR, file),
				"utf8",
			);
			expect(content, `${file} debe tener frontmatter`).toContain("---");
			expect(content, `${file} debe tener name:`).toContain("name:");
			expect(content, `${file} debe tener description:`).toContain(
				"description:",
			);
		}
	});

	it("los 15 agentes se descubren al sincronizarlos a global", () => {
		syncPipelineAgents();
		reloadCustomAgents(tmpCwd);

		const types = getAvailableTypes(tmpCwd);
		// Los defaults + los 15 de frida-pipeline.
		expect(types.length).toBeGreaterThanOrEqual(15);

		// Verificar algunos agentes clave.
		expect(types).toContain("codebase-locator");
		expect(types).toContain("codebase-analyzer");
		expect(types).toContain("claim-verifier");
		expect(types).toContain("diff-auditor");
		expect(types).toContain("web-search-researcher");
	});

	it("codebase-locator tiene tools: grep, find, ls", () => {
		syncPipelineAgents();
		reloadCustomAgents(tmpCwd);

		const config = getAgentConfig("codebase-locator", tmpCwd);
		expect(config).toBeDefined();
		expect(config?.builtinToolNames).toEqual(["grep", "find", "ls"]);
	});

	it("claim-verifier tiene tools incluyendo bash", () => {
		syncPipelineAgents();
		reloadCustomAgents(tmpCwd);

		const config = getAgentConfig("claim-verifier", tmpCwd);
		expect(config).toBeDefined();
		expect(config?.builtinToolNames).toContain("bash");
	});

	it("getDisplayName devuelve el nombre legible", () => {
		syncPipelineAgents();
		reloadCustomAgents(tmpCwd);

		// Defaults usan su name como displayName.
		expect(getDisplayName("Explore", tmpCwd)).toBe("Explore");
		// Custom sin display_name usa el filename.
		expect(getDisplayName("codebase-locator", tmpCwd)).toBe("codebase-locator");
	});
});

describe("frida-subagents / BUILTIN_TOOL_NAMES", () => {
	it("contiene los 7 tools estándar de Pi", () => {
		expect(BUILTIN_TOOL_NAMES).toEqual([
			"read",
			"bash",
			"edit",
			"write",
			"grep",
			"find",
			"ls",
		]);
	});
});
