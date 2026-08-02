// Tests de frida-pix-skills — skill loader on-demand (porte de pix-skills).
//
// Cubre:
//   - directive.ts (puro): findCommandDirectives, escape, hasShellMeta,
//     tokenizeCommand, replaceSpan.
//   - gate.ts: directiveBlockReason (shell-meta, destructivo, seguro).
//   - remote.ts (puro): parseGitHubSource, cache root, search/fetch con fetcher
//     mock (sin red), safeDestination (vía fetchRemoteSkill).
//   - index.ts: scanSkillsDir, discoverSkills (precedencia project>global),
//     extractDescription/Name, interpolateSkill (runner mock + bloqueos).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	findCommandDirectives,
	hasShellMeta,
	tokenizeCommand,
	replaceSpan,
} from "../../src/tools/frida-pix-skills/directive";
import { directiveBlockReason } from "../../src/tools/frida-pix-skills/gate";
import {
	parseGitHubSource,
	remoteSkillsCacheRoot,
	searchRemoteSkills,
	fetchRemoteSkill,
} from "../../src/tools/frida-pix-skills/remote";
import {
	scanSkillsDir,
	discoverSkills,
	extractDescription,
	extractName,
	interpolateSkill,
	formatSkillList,
	formatRemoteSkillSearch,
} from "../../src/tools/frida-pix-skills";

// ---------------------------------------------------------------------------
// directive.ts (puro)
// ---------------------------------------------------------------------------

describe("directive.findCommandDirectives", () => {
	it("localiza una directiva simple con su span", () => {
		const d = findCommandDirectives("antes !`git status` despues");
		expect(d).toHaveLength(1);
		expect(d[0]?.command).toBe("git status");
		expect(d[0]?.start).toBe("antes ".length);
	});

	it("respeta el escape \\!`cmd` (no lo cuenta)", () => {
		expect(findCommandDirectives("\\!`git status`")).toEqual([]);
	});

	it("rechaza comandos multilínea (no backticks ni newline en el comando)", () => {
		expect(findCommandDirectives("!\n`x`")).toEqual([]);
	});

	it("encuentra varias directivas", () => {
		const d = findCommandDirectives("!`a` y !`b`");
		expect(d.map((x) => x.command)).toEqual(["a", "b"]);
	});
});

describe("directive.hasShellMeta / tokenizeCommand", () => {
	it("detecta metacaracteres de shell", () => {
		expect(hasShellMeta("rm -rf / ; echo x")).toBe(true);
		expect(hasShellMeta("a | b")).toBe(true);
		expect(hasShellMeta("echo $HOME")).toBe(true);
	});
	it("no marca comandos limpios", () => {
		expect(hasShellMeta("git status -sb")).toBe(false);
		expect(hasShellMeta("git diff --cached")).toBe(false);
	});
	it("tokeniza respetando comillas", () => {
		expect(tokenizeCommand('git commit -m "mensaje con espacios"')).toEqual([
			"git",
			"commit",
			"-m",
			"mensaje con espacios",
		]);
	});
});

describe("directive.replaceSpan", () => {
	it("reemplaza el slice [start, end)", () => {
		expect(replaceSpan("hola mundo", 5, 10, "FRIDA")).toBe("hola FRIDA");
	});
});

// ---------------------------------------------------------------------------
// gate.ts
// ---------------------------------------------------------------------------

describe("gate.directiveBlockReason", () => {
	it("bloquea metacaracteres de shell", () => {
		expect(directiveBlockReason("git status && rm -rf /")).toBe(
			"shell metacharacters not allowed in skill commands",
		);
	});
	it("bloquea comandos destructivos del gate de Frida", () => {
		expect(directiveBlockReason("rm -rf /")).not.toBeNull();
		expect(directiveBlockReason("mkfs.ext4 /dev/sda1")).not.toBeNull();
	});
	it("permite comandos seguros típicos de skills", () => {
		expect(directiveBlockReason("git status -sb")).toBeNull();
		expect(directiveBlockReason("git diff --cached")).toBeNull();
		expect(directiveBlockReason("git log -5 --oneline")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// remote.ts (puro, fetcher mock)
// ---------------------------------------------------------------------------

describe("remote.parseGitHubSource", () => {
	it("acepta owner/repo", () => {
		expect(parseGitHubSource("nutlope/hallmark")).toEqual({
			owner: "nutlope",
			repo: "hallmark",
		});
	});
	it("normaliza URL y sufijo .git", () => {
		expect(parseGitHubSource("https://github.com/a/b.git")).toEqual({
			owner: "a",
			repo: "b",
		});
	});
	it("rechaza fuentes inválidas", () => {
		expect(() => parseGitHubSource("no-es-una-fuente")).toThrow();
		expect(() => parseGitHubSource("a/b/c")).toThrow();
		expect(() => parseGitHubSource("../escape")).toThrow();
	});
});

describe("remote.remoteSkillsCacheRoot", () => {
	it("apunta al cache propio de Frida", () => {
		expect(remoteSkillsCacheRoot()).toBe(
			path.join(os.homedir(), ".frida", "cache", "skills.sh"),
		);
	});
});

describe("remote.searchRemoteSkills", () => {
	it("parsea y filtra resultados inválidos (fetcher mock)", async () => {
		const fetcher = (async (_url: string | URL | Request) =>
			({
				ok: true,
				headers: new Map([["content-type", "application/json"]]),
				json: async () => ({
					skills: [
						{ id: "s1", name: "good", source: "a/b", installs: 10 },
						{ id: "s2", name: "bad", source: "not-a-source" }, // fuente inválida → filtrada
						{ id: "s3", name: "ok2", source: "c/d", installs: 0 },
					],
				}),
			}) as unknown) as typeof fetch;
		const r = await searchRemoteSkills("react", fetcher);
		expect(r.map((x) => x.name).sort()).toEqual(["good", "ok2"]);
	});
	it("rechaza queries fuera de rango", async () => {
		await expect(searchRemoteSkills("a")).rejects.toThrow();
	});
});

describe("remote.fetchRemoteSkill", () => {
	let cacheRoot: string;
	beforeEach(() => {
		cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pix-"));
	});
	afterEach(() => {
		fs.rmSync(cacheRoot, { recursive: true, force: true });
	});

	it("fetch, cachea y valida el name del frontmatter (fetcher mock)", async () => {
		const skillMd =
			"---\nname: hallmark\ndescription: x\n---\n# Hallmark\nbody";
		const tree = {
			tree: [
				{ path: "SKILL.md", type: "blob", size: skillMd.length },
				{ path: "references/r.md", type: "blob", size: 5 },
			],
		};
		const fetcher = (async (url: string | URL | Request) => {
			const u = String(url);
			// fetchText/fetchBytes siempre usan arrayBuffer (incluso para el árbol).
			const respond = (body: string) => ({
				ok: true,
				headers: new Map(),
				arrayBuffer: async () =>
					new TextEncoder().encode(body).buffer as ArrayBuffer,
			});
			if (u.includes("/git/trees/")) return respond(JSON.stringify(tree));
			if (u.endsWith("/SKILL.md")) return respond(skillMd);
			return respond("hello"); // references/r.md
		}) as unknown as typeof fetch;

		const entry = await fetchRemoteSkill("a/b", "hallmark", {
			fetcher,
			cacheRoot,
		});
		expect(entry.name).toBe("hallmark");
		expect(entry.source).toBe("a/b");
		expect(entry.cached).toBe(false);
		// SKILL.md cacheado y legible
		expect(fs.existsSync(entry.path)).toBe(true);
		expect(fs.readFileSync(entry.path, "utf-8")).toContain("# Hallmark");
		// references/ retenido
		expect(fs.existsSync(path.join(entry.root, "references", "r.md"))).toBe(
			true,
		);
	});

	it("usa cache sin re-fetchear cuando ya existe", async () => {
		const target = path.join(cacheRoot, "a", "b", "hallmark");
		fs.mkdirSync(target, { recursive: true });
		fs.writeFileSync(
			path.join(target, "SKILL.md"),
			"---\nname: hallmark\n---\ncached body",
		);
		const fetcher = (() => {
			throw new Error("no debería llamar a fetch en cache hit");
		}) as unknown as typeof fetch;
		const entry = await fetchRemoteSkill("a/b", "hallmark", {
			fetcher,
			cacheRoot,
		});
		expect(entry.cached).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// index.ts — skill discovery + formatters + interpolación
// ---------------------------------------------------------------------------

describe("index.scanSkillsDir", () => {
	let root: string;
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pix-skills-"));
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("detecta layout plano (.md) y bundle (dir/SKILL.md)", () => {
		fs.writeFileSync(path.join(root, "plana.md"), "---\nname: plana\n---\nx");
		fs.mkdirSync(path.join(root, "bundle", "references"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(root, "bundle", "SKILL.md"),
			"---\nname: bundle\n---\ny",
		);
		const entries = scanSkillsDir(root).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
		expect(entries.map((e) => e.name)).toEqual(["bundle", "plana"]);
		const bundle = entries.find((e) => e.name === "bundle");
		expect(bundle?.root).not.toBeNull(); // bundle tiene root
		const plana = entries.find((e) => e.name === "plana");
		expect(plana?.root).toBeNull(); // plana no tiene root
	});
});

describe("index.discoverSkills", () => {
	let cwd: string;
	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pix-cwd-"));
	});
	afterEach(() => {
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("descubre skills de proyecto con nombres únicos", () => {
		const projSkills = path.join(cwd, ".frida", "skills");
		fs.mkdirSync(projSkills, { recursive: true });
		fs.writeFileSync(
			path.join(projSkills, "zzz-unique-proj-skill.md"),
			"---\nname: zzz-unique-proj-skill\ndescription: d\n---\nx",
		);
		const skills = discoverSkills(cwd);
		const names = skills.map((s) => s.name);
		expect(names).toContain("zzz-unique-proj-skill");
	});
});

describe("index.extractDescription / extractName", () => {
	it("extrae description y name del frontmatter", () => {
		const content =
			"---\nname: commit\ndescription: haz commits\n---\n# Commit";
		expect(extractName(content)).toBe("commit");
		expect(extractDescription(content)).toBe("haz commits");
	});
	it("devuelve null sin frontmatter", () => {
		expect(extractName("# sin fm")).toBeNull();
		expect(extractDescription("# sin fm")).toBeNull();
	});
});

describe("index.interpolateSkill", () => {
	it("expande una directiva con la salida del runner (fenced)", async () => {
		const run = (async () => "OUTPUT") as unknown as (
			argv: string[],
			cwd: string,
		) => Promise<string>;
		const out = await interpolateSkill(
			"estado:\n!`git status`\nfin",
			"/cwd",
			run,
		);
		expect(out).toContain("```");
		expect(out).toContain("OUTPUT");
		expect(out).not.toContain("!`git status`");
	});

	it("bloquea directivas con shell-meta (marker [blocked:])", async () => {
		const run = (async () => {
			throw new Error("no debería correr");
		}) as unknown as (argv: string[], cwd: string) => Promise<string>;
		const out = await interpolateSkill("!`a && b`", "/cwd", run);
		expect(out).toContain("[blocked:");
		expect(out).not.toContain("OUTPUT");
	});

	it("bloquea directivas destructivas vía el gate de Frida", async () => {
		const run = (async () => {
			throw new Error("no debería correr");
		}) as unknown as (argv: string[], cwd: string) => Promise<string>;
		const out = await interpolateSkill("!`rm -rf /`", "/cwd", run);
		expect(out).toContain("[blocked:");
	});

	it("deja literal la directiva escapada \\!`cmd`", async () => {
		const run = (async () => "X") as unknown as (
			argv: string[],
			cwd: string,
		) => Promise<string>;
		const out = await interpolateSkill("doc: \\!`git status`", "/cwd", run);
		expect(out).toBe("doc: \\!`git status`");
	});

	it("no hace nada si no hay directivas", async () => {
		const run = (async () => "X") as unknown as (
			argv: string[],
			cwd: string,
		) => Promise<string>;
		const out = await interpolateSkill(
			"texto plano sin directivas",
			"/cwd",
			run,
		);
		expect(out).toBe("texto plano sin directivas");
	});
});

describe("index.formatters", () => {
	it("formatSkillList junta nombres con ·", () => {
		expect(formatSkillList(["a", "b", "c"])).toBe(
			"Available skills (3): a · b · c",
		);
	});
	it("formatRemoteSkillSearch rankea por installs y avisa si vacío", () => {
		expect(formatRemoteSkillSearch("q", [])).toBe(
			'No skills.sh results for "q".',
		);
		const out = formatRemoteSkillSearch("q", [
			{ name: "low", slug: "s1", source: "a/b", installs: 5 },
			{ name: "high", slug: "s2", source: "c/d", installs: 5000 },
		]);
		// high (5K) aparece antes que low
		expect(out.indexOf("high")).toBeLessThan(out.indexOf("low"));
		expect(out).toContain("5.0K installs");
	});
});
