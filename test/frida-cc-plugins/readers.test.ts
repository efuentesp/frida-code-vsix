/**
 * frida-cc-plugins — tests de readers (issue #49, ADR-0057).
 *
 * Parsing puro contra fixtures de formato Claude Code: plugin.json,
 * marketplace.json (sources válidas/inválidas) y discovery de componentes
 * (convention + reporte de no-soportados).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	ReaderError,
	assertSafeName,
	discoverComponents,
	readMarketplaceCatalog,
	readPluginManifest,
	validateCatalogRelativePath,
	validateGithubRepo,
} from "../../src/tools/frida-cc-plugins/readers";

let dir: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-rd-"));
});

afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

function writeJson(p: string, v: unknown): void {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(v, null, "\t"));
}

describe("frida-cc-plugins / readers / validación", () => {
	it("validateCatalogRelativePath acepta './x' y rechaza traversal/backslash", () => {
		expect(validateCatalogRelativePath("./mi-plugin")).toBe("./mi-plugin");
		expect(() => validateCatalogRelativePath("mi-plugin")).toThrow(ReaderError);
		expect(() => validateCatalogRelativePath("./../x")).toThrow(ReaderError);
		expect(() => validateCatalogRelativePath(".\\x")).toThrow(ReaderError);
		expect(() => validateCatalogRelativePath("./x/../y")).toThrow(ReaderError);
	});

	it("validateGithubRepo acepta owner/repo y rechaza formas raras", () => {
		expect(validateGithubRepo("anthropics/claude-plugins-official")).toBeTruthy();
		expect(() => validateGithubRepo("solo-owner")).toThrow(ReaderError);
		expect(() => validateGithubRepo("a/b/c")).toThrow(ReaderError);
	});

	it("assertSafeName valida nombres de invocación", () => {
		expect(assertSafeName("pr-review-toolkit", "test")).toBe("pr-review-toolkit");
		expect(() => assertSafeName("-lead", "test")).toThrow(ReaderError);
		expect(() => assertSafeName("ConMayuscula", "test")).toThrow(ReaderError);
		expect(() => assertSafeName("con_underscore", "test")).toThrow(ReaderError);
	});
});

describe("frida-cc-plugins / readers / plugin.json", () => {
	it("lee manifiesto válido con campos relevantes", () => {
		writeJson(path.join(dir, ".claude-plugin", "plugin.json"), {
			name: "mi-plugin",
			description: "desc",
			version: "1.2.3",
			author: { name: "Alguien" },
		});
		const m = readPluginManifest(dir);
		expect(m?.name).toBe("mi-plugin");
		expect(m?.version).toBe("1.2.3");
		expect(m?.description).toBe("desc");
	});

	it("ausente → null; sin name o inválido → ReaderError con guía", () => {
		expect(readPluginManifest(dir)).toBeNull();
		writeJson(path.join(dir, ".claude-plugin", "plugin.json"), { version: "1" });
		expect(() => readPluginManifest(dir)).toThrow(/sin campo 'name'/);
		writeJson(path.join(dir, ".claude-plugin", "plugin.json"), { name: "Mal" });
		expect(() => readPluginManifest(dir)).toThrow(ReaderError);
	});
});

describe("frida-cc-plugins / readers / marketplace.json", () => {
	it("parsea catálogo con sources path/github/url/git-subdir", () => {
		writeJson(path.join(dir, ".claude-plugin", "marketplace.json"), {
			name: "mi-market",
			plugins: [
				{ name: "local-one", source: "./plugins/local-one" },
				{
					name: "remote-one",
					source: { source: "github", repo: "owner/remote-one" },
					version: "2.0.0",
				},
				{
					name: "url-one",
					source: {
						source: "url",
						url: "https://gitlab.com/g/url-one.git",
						ref: "v1",
					},
				},
				{
					name: "subdir-one",
					source: {
						source: "git",
						url: "https://github.com/owner/repo.git",
						path: "./plugins/sub",
					},
				},
			],
		});
		const cat = readMarketplaceCatalog(dir);
		expect(cat.name).toBe("mi-market");
		expect(cat.plugins).toHaveLength(4);
		expect(cat.plugins[0]?.source).toEqual({
			kind: "path",
			path: "./plugins/local-one",
		});
		expect(cat.plugins[1]?.source).toMatchObject({ kind: "github" });
		expect(cat.plugins[2]?.source).toMatchObject({ kind: "url" });
		expect(cat.plugins[3]?.source).toMatchObject({ kind: "git-subdir" });
	});

	it("entradas malformadas se omiten (siblings sobreviven) y URL no-https falla", () => {
		writeJson(path.join(dir, ".claude-plugin", "marketplace.json"), {
			name: "m",
			plugins: [
				{ source: "./x" }, // sin name
				{ name: "ok", source: "./ok" },
			],
		});
		expect(readMarketplaceCatalog(dir).plugins).toHaveLength(1);
		writeJson(path.join(dir, ".claude-plugin", "marketplace.json"), {
			name: "m",
			plugins: [
				{ name: "bad", source: { source: "url", url: "http://inseguro.git" } },
			],
		});
		expect(() => readMarketplaceCatalog(dir)).toThrow(/HTTPS/);
	});

	it("sin marketplace.json o sin name → ReaderError con guía", () => {
		expect(() => readMarketplaceCatalog(dir)).toThrow(/No existe/);
		writeJson(path.join(dir, ".claude-plugin", "marketplace.json"), {
			plugins: [],
		});
		expect(() => readMarketplaceCatalog(dir)).toThrow(/sin campo 'name'/);
	});
});

describe("frida-cc-plugins / readers / discovery", () => {
	it("descubre skills/commands/mcp por convención y reporta no-soportados", () => {
		// Plugin fixture completo.
		fs.mkdirSync(path.join(dir, "skills", "review-pr"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, "skills", "review-pr", "SKILL.md"),
			"---\nname: review-pr\ndescription: Revisa PRs\n---\nCuerpo.\n",
		);
		fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
		fs.writeFileSync(path.join(dir, "commands", "review.md"), "# Review\n");
		writeJson(path.join(dir, ".mcp.json"), {
			mcpServers: { api: { command: "node", args: ["server.js"] } },
		});
		fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
		fs.writeFileSync(path.join(dir, "agents", "verifier.md"), "agente");
		writeJson(path.join(dir, ".claude-plugin", "plugin.json"), {
			name: "pr-review",
		});

		const c = discoverComponents(dir);
		expect(c.skills).toHaveLength(1);
		expect(c.skills[0]).toContain(path.join("skills", "review-pr"));
		expect(c.commands).toHaveLength(1);
		expect(c.commands[0]).toContain("review.md");
		expect(Object.keys(c.mcpServers)).toEqual(["api"]);
		const kinds = c.skipped.map((s) => s.kind);
		expect(kinds).toContain("agents");
	});

	it("mcpServers inline del manifiesto gana; commands anidados se reportan", () => {
		writeJson(path.join(dir, ".claude-plugin", "plugin.json"), {
			name: "inline-mcp",
			mcpServers: { inline: { command: "run" } },
		});
		fs.mkdirSync(path.join(dir, "commands", "sub"), { recursive: true });
		fs.writeFileSync(path.join(dir, "commands", "sub", "anidado.md"), "x");
		const c = discoverComponents(dir);
		expect(Object.keys(c.mcpServers)).toEqual(["inline"]);
		expect(c.skipped.some((s) => s.kind === "commands-nested")).toBe(true);
	});
});
