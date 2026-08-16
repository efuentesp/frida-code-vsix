/**
 * frida-cc-plugins — tests de conversores y registry (issue #49, ADR-0057).
 *
 * Reescritura de frontmatter de skills (strings puros), namespacing con
 * elisión de prefijo, prompts planos hyphen, placeholders MCP, merge/unmerge
 * con colisión, y registro declarativo con escritura atómica.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	mergeMcpServers,
	namespacedCommandName,
	namespacedSkillName,
	removePluginResources,
	rewriteSkillFrontmatter,
	substituteMcpPlaceholders,
	unmergeMcpServers,
	convertPluginResources,
	existingMcpServerKeys,
} from "../../src/tools/frida-cc-plugins/convert";
import {
	emptyRegistry,
	loadRegistry,
	saveRegistry,
} from "../../src/tools/frida-cc-plugins/registry";
import { resourcesPromptsDir, resourcesSkillsDir } from "../../src/tools/frida-cc-plugins/constants";

let agentDir: string;

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-cv-"));
});

afterEach(() => {
	fs.rmSync(agentDir, { recursive: true, force: true });
});

describe("frida-cc-plugins / convert / namespacing", () => {
	it("elide el prefijo del plugin (acme + acme-foo → acme-foo)", () => {
		expect(namespacedSkillName("acme", "foo")).toBe("acme-foo");
		expect(namespacedSkillName("acme", "acme-foo")).toBe("acme-foo");
		expect(namespacedSkillName("acme", "acme")).toBe("acme-acme");
	});

	it("namespacedCommandName deriva del filename", () => {
		expect(namespacedCommandName("pr", "/x/commands/review.md")).toBe(
			"pr-review",
		);
		expect(namespacedCommandName("pr", "/x/commands/pr-review.md")).toBe(
			"pr-review",
		);
	});
});

describe("frida-cc-plugins / convert / rewriteSkillFrontmatter", () => {
	it("reescribe name existente preservando el resto del frontmatter", () => {
		const raw =
			"---\nname: review\ndescription: Revisa\nother: keep\n---\nCuerpo.\n";
		const out = rewriteSkillFrontmatter(raw, "pr-review");
		expect(out).toContain("name: pr-review");
		expect(out).toContain("description: Revisa");
		expect(out).toContain("other: keep");
		expect(out).toContain("Cuerpo.");
		expect(out).not.toContain("name: review");
	});

	it("sin frontmatter → antepone uno nuevo", () => {
		const out = rewriteSkillFrontmatter("Solo cuerpo.\n", "ns-name");
		expect(out.startsWith("---\nname: ns-name\n---")).toBe(true);
		expect(out).toContain("Solo cuerpo.");
	});

	it("frontmatter sin name → inserta como primera llave", () => {
		const raw = "---\ndescription: d\n---\nCuerpo.\n";
		const out = rewriteSkillFrontmatter(raw, "ns-name");
		const fm = out.split("\n").slice(0, 4).join("\n");
		expect(fm).toBe("---\nname: ns-name\ndescription: d\n---");
	});

	it("frontmatter sin cierre → trata todo como cuerpo", () => {
		const out = rewriteSkillFrontmatter("---\nname: x\nsin cerrar", "ns");
		expect(out.startsWith("---\nname: ns\n---")).toBe(true);
		expect(out).toContain("sin cerrar");
	});
});

describe("frida-cc-plugins / convert / recursos", () => {
	it("convierte skills+commands a resources/ con namespacing", () => {
		const src = path.join(agentDir, "plugin-src");
		fs.mkdirSync(path.join(src, "skills", "review"), { recursive: true });
		fs.writeFileSync(
			path.join(src, "skills", "review", "SKILL.md"),
			"---\nname: review\ndescription: d\n---\nCuerpo.\n",
		);
		fs.mkdirSync(path.join(src, "commands"), { recursive: true });
		fs.writeFileSync(path.join(src, "commands", "review.md"), "# R\n");

		const res = convertPluginResources(agentDir, "pr", {
			skills: [path.join(src, "skills", "review")],
			commands: [path.join(src, "commands", "review.md")],
		});
		expect(res.skills).toEqual(["pr-review"]);
		expect(res.commands).toEqual(["pr-review"]);

		const skillMd = fs.readFileSync(
			path.join(resourcesSkillsDir(agentDir), "pr", "review", "SKILL.md"),
			"utf-8",
		);
		expect(skillMd).toContain("name: pr-review");
		const prompt = path.join(resourcesPromptsDir(agentDir), "pr-review.md");
		expect(fs.existsSync(prompt)).toBe(true);

		// remove limpia ambos.
		removePluginResources(agentDir, "pr");
		expect(
			fs.existsSync(path.join(resourcesSkillsDir(agentDir), "pr")),
		).toBe(false);
		expect(fs.existsSync(prompt)).toBe(false);
	});
});

describe("frida-cc-plugins / convert / MCP", () => {
	it("substituteMcpPlaceholders resuelve CLAUDE_PLUGIN_ROOT/PROJECT_DIR/user_config", () => {
		const out = substituteMcpPlaceholders(
			{
				command: "node",
				args: ["${CLAUDE_PLUGIN_ROOT}/server.js", "--cwd", "${CLAUDE_PROJECT_DIR}"],
				env: { KEY: "${user_config:token}" },
			},
			{
				pluginRoot: "/installed/pr@abc",
				projectDir: "/work/proj",
				userConfig: { token: "tok123" },
			},
		) as Record<string, unknown>;
		const args = out.args as string[];
		expect(args[0]).toBe("/installed/pr@abc/server.js");
		expect(args[2]).toBe("/work/proj");
		expect((out.env as Record<string, string>).KEY).toBe("tok123");
	});

	it("merge escribe y unmerge limpia SOLO sus llaves", () => {
		const cfg = path.join(agentDir, "mcp.json");
		const written = mergeMcpServers(cfg, {
			api: { command: "node" },
			other: { command: "run" },
		});
		expect(written).toEqual(["api", "other"]);
		expect([...existingMcpServerKeys(cfg)].sort()).toEqual(["api", "other"]);

		// Un server manual del usuario coexiste.
		const manual = JSON.parse(fs.readFileSync(cfg, "utf-8"));
		manual.mcpServers.userServer = { command: "keep" };
		fs.writeFileSync(cfg, JSON.stringify(manual));

		unmergeMcpServers(cfg, ["api", "other"]);
		expect([...existingMcpServerKeys(cfg)]).toEqual(["userServer"]);
	});

	it("merge con colisión → error con guía (nunca renombra)", () => {
		const cfg = path.join(agentDir, "mcp.json");
		mergeMcpServers(cfg, { api: { command: "node" } });
		expect(() => mergeMcpServers(cfg, { api: { command: "otro" } })).toThrow(
			/Conflicto de nombre MCP/,
		);
	});
});

describe("frida-cc-plugins / registry", () => {
	it("loadRegistry: inexistente/corrupto → vacío (self-healing)", () => {
		expect(loadRegistry(agentDir)).toEqual(emptyRegistry());
		fs.mkdirSync(agentDir, { recursive: true });
		fs.writeFileSync(path.join(agentDir, "cc-plugins.json"), "{invalido");
		expect(loadRegistry(agentDir)).toEqual(emptyRegistry());
	});

	it("saveRegistry escribe JSON válido y redonda", () => {
		const reg = emptyRegistry();
		reg.marketplaces["mkt"] = {
			url: "https://github.com/o/r.git",
			rev: "abc1234",
			addedAt: "2026-08-15T00:00:00Z",
		};
		reg.plugins["p"] = {
			marketplace: "mkt",
			source: { kind: "path", path: "./p" },
			rev: "abc1234",
			enabled: true,
			installedAt: "2026-08-15T00:00:00Z",
			skills: ["p-s"],
			commands: ["p-c"],
			mcpServers: ["api"],
			skipped: [],
		};
		saveRegistry(agentDir, reg);
		const back = loadRegistry(agentDir);
		expect(back.marketplaces["mkt"]?.rev).toBe("abc1234");
		expect(back.plugins["p"]?.skills).toEqual(["p-s"]);
	});
});
