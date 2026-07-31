// frida-subagents — tests de Fase 5 (memory + skills + worktree).
//
// Verifica el gate de Fase 5 (ADR-0022):
//   - memory: resolveMemoryDir por scope, ensureMemoryDir crea dir+MEMORY.md,
//     buildMemoryBlock lee contenido, hasWriteTools detecta.
//   - skill-loader: resolveSkill desde ~/.frida/skills/, preloadSkills.
//   - worktree: tipos y funciones existen (git real se testea en E2E).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	resolveMemoryDir,
	ensureMemoryDir,
	buildMemoryBlock,
	buildReadOnlyMemoryBlock,
	buildMemoryForAgent,
	hasWriteTools,
} from "../../src/tools/frida-subagents/memory";
import {
	resolveSkill,
	preloadSkills,
} from "../../src/tools/frida-subagents/skill-loader";
import {
	createWorktree,
	cleanupWorktree,
	pruneWorktrees,
} from "../../src/tools/frida-subagents/worktree";

let realHome: string;
let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
	realHome = process.env.HOME ?? os.homedir();
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sub5-"));
	tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sub5-cwd-"));
	process.env.HOME = tmpHome;
});

afterEach(() => {
	process.env.HOME = realHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpCwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

describe("frida-subagents / memory / resolveMemoryDir", () => {
	it("project scope → .frida/agent-memory/<name>/", () => {
		const dir = resolveMemoryDir("project", "auditor", tmpCwd);
		expect(dir).toBe(path.join(tmpCwd, ".frida", "agent-memory", "auditor"));
	});

	it("local scope → .frida/agent-memory-local/<name>/", () => {
		const dir = resolveMemoryDir("local", "auditor", tmpCwd);
		expect(dir).toBe(
			path.join(tmpCwd, ".frida", "agent-memory-local", "auditor"),
		);
	});

	it("user scope → ~/.frida/agent-memory/<name>/", () => {
		const dir = resolveMemoryDir("user", "auditor", tmpCwd);
		expect(dir).toBe(path.join(tmpHome, ".frida", "agent-memory", "auditor"));
	});
});

describe("frida-subagents / memory / ensureMemoryDir", () => {
	it("crea el directorio y MEMORY.md si no existen", () => {
		const dir = path.join(tmpCwd, ".frida", "agent-memory", "test-agent");
		expect(fs.existsSync(dir)).toBe(false);

		ensureMemoryDir(dir);

		expect(fs.existsSync(dir)).toBe(true);
		expect(fs.existsSync(path.join(dir, "MEMORY.md"))).toBe(true);

		const content = fs.readFileSync(path.join(dir, "MEMORY.md"), "utf-8");
		expect(content).toContain("# Memoria de test-agent");
	});

	it("idempotente: no sobreescribe si ya existe", () => {
		const dir = path.join(tmpCwd, ".frida", "agent-memory", "existing");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "MEMORY.md"),
			"# Contenido existente",
			"utf-8",
		);

		ensureMemoryDir(dir);

		const content = fs.readFileSync(path.join(dir, "MEMORY.md"), "utf-8");
		expect(content).toBe("# Contenido existente");
	});
});

describe("frida-subagents / memory / buildMemoryBlock", () => {
	it("devuelve string vacío si el directorio no existe", () => {
		expect(buildMemoryBlock("/nonexistent/path")).toBe("");
	});

	it("lee MEMORY.md + archivos .md del directorio", () => {
		const dir = path.join(tmpCwd, "mem");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "MEMORY.md"), "# Index\n\nNota 1", "utf-8");
		fs.writeFileSync(
			path.join(dir, "incident.md"),
			"Hubo un incidente",
			"utf-8",
		);

		const block = buildMemoryBlock(dir);
		expect(block).toContain("Nota 1");
		expect(block).toContain("Hubo un incidente");
		expect(block).toContain("## Agent Memory");
	});
});

describe("frida-subagents / memory / buildReadOnlyMemoryBlock", () => {
	it("envuelve con marcadores read-only", () => {
		const dir = path.join(tmpCwd, "mem");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "MEMORY.md"), "# Notas", "utf-8");

		const block = buildReadOnlyMemoryBlock(dir);
		expect(block).toContain("[Agent Memory (read-only)]");
		expect(block).toContain("[End Memory");
	});
});

describe("frida-subagents / memory / hasWriteTools", () => {
	it("true cuando no hay restricción (undefined)", () => {
		expect(hasWriteTools(undefined)).toBe(true);
	});

	it("true cuando incluye write o edit", () => {
		expect(hasWriteTools(["read", "write"])).toBe(true);
		expect(hasWriteTools(["read", "edit"])).toBe(true);
	});

	it("false cuando no incluye write ni edit", () => {
		expect(hasWriteTools(["read", "grep", "find", "ls"])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Skill loader
// ---------------------------------------------------------------------------

describe("frida-subagents / skill-loader / resolveSkill", () => {
	it("resuelve skill desde ~/.frida/skills/<name>/SKILL.md", () => {
		const skillDir = path.join(tmpHome, ".frida", "skills", "discover");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			"---\nname: discover\n---\n\nSkill content.",
			"utf-8",
		);

		const content = resolveSkill("discover", tmpCwd);
		expect(content).toContain("Skill content.");
	});

	it("resuelve skill plana desde ~/.frida/skills/<name>.md", () => {
		const skillsDir = path.join(tmpHome, ".frida", "skills");
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillsDir, "tips.md"),
			"# Tips\n\nUseful tips.",
			"utf-8",
		);

		const content = resolveSkill("tips", tmpCwd);
		expect(content).toContain("Useful tips.");
	});

	it("undefined para skill inexistente", () => {
		expect(resolveSkill("nonexistent", tmpCwd)).toBeUndefined();
	});

	it("proyecto tiene prioridad sobre global", () => {
		// Global.
		const globalDir = path.join(tmpHome, ".frida", "skills", "shared");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "SKILL.md"),
			"Global version",
			"utf-8",
		);

		// Proyecto.
		const projDir = path.join(tmpCwd, ".frida", "skills", "shared");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, "SKILL.md"),
			"Project version",
			"utf-8",
		);

		const content = resolveSkill("shared", tmpCwd);
		expect(content).toContain("Project version");
	});
});

describe("frida-subagents / skill-loader / preloadSkills", () => {
	it("construye bloque con skills encontradas", () => {
		const skillDir = path.join(tmpHome, ".frida", "skills", "discover");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			"Discover skill body.",
			"utf-8",
		);

		const block = preloadSkills("discover", tmpCwd);
		expect(block).toContain("## Preloaded Skills");
		expect(block).toContain("Discover skill body.");
	});

	it("reporta skills no encontradas", () => {
		const block = preloadSkills("nonexistent", tmpCwd);
		expect(block).toBe("");
	});

	it("acepta array de nombres", () => {
		const dir1 = path.join(tmpHome, ".frida", "skills", "a");
		const dir2 = path.join(tmpHome, ".frida", "skills", "b");
		fs.mkdirSync(dir1, { recursive: true });
		fs.mkdirSync(dir2, { recursive: true });
		fs.writeFileSync(path.join(dir1, "SKILL.md"), "Skill A", "utf-8");
		fs.writeFileSync(path.join(dir2, "SKILL.md"), "Skill B", "utf-8");

		const block = preloadSkills(["a", "b"], tmpCwd);
		expect(block).toContain("Skill A");
		expect(block).toContain("Skill B");
	});
});

// ---------------------------------------------------------------------------
// Worktree (tipos + funciones existen)
// ---------------------------------------------------------------------------

describe("frida-subagents / worktree", () => {
	it("createWorktree devuelve undefined si no es repo git", () => {
		const result = createWorktree(tmpCwd, "agent-test12");
		expect(result).toBeUndefined();
	});

	it("pruneWorktrees no crashea en dir no-git", () => {
		expect(() => pruneWorktrees(tmpCwd)).not.toThrow();
	});

	it("cleanupWorktree devuelve hasChanges=false si el path no existe", () => {
		const result = cleanupWorktree({
			workPath: "/nonexistent/path",
			branch: "pi-agent-test",
			baseSha: "abc123",
		});
		expect(result.hasChanges).toBe(false);
	});
});
