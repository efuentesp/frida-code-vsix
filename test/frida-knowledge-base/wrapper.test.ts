/**
 * frida-knowledge-base — tests del wrapper (issue #29, ADR-0040).
 *
 * Estrategia (idéntica a frida-hermes-memory): materializa un paquete
 * upstream FAKE al pin en <agentDir>/npm y lo carga con jiti REAL (con los
 * aliases de constants) — valida passthrough, materialización de
 * prompts/skill y los aliases kb_* contra un mini-vault OKF en disco.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createFridaKnowledgeBase } from "../../src/tools/frida-knowledge-base/index";
import {
	KNOWLEDGE_BASE_PIN,
	upstreamPeerAliases,
} from "../../src/tools/frida-knowledge-base/constants";

let agentDir: string;
let workDir: string; // cwd del "workspace" — aquí vive el mini-vault
let prevAgentDirEnv: string | undefined;

/** Stub parcial del ExtensionAPI (casteado al tipo real en los call sites). */
function fakePi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const events = new Map<string, any>();
	return {
		tools,
		commands,
		events,
		registerTool: (t: any) => tools.set(t.name, t),
		registerCommand: (c: any) => commands.set(c.name, c),
		on: (event: string, h: any) => {
			events.set(event, h);
			return () => events.delete(event);
		},
	};
}
function asApi(pi: ReturnType<typeof fakePi>): ExtensionAPI {
	return pi as unknown as ExtensionAPI;
}

/**
 * Paquete fake al pin: entry factory (con import ESTÁTICO del peer alias —
 * como el upstream real), prompts/*.md, skills/llm-wiki/SKILL.md y lib/
 * con los 3 módulos que los aliases kb_* cargan vía jiti.
 */
function writeFakeUpstream(
	entryExtra = "",
	libImpl: { search?: string; links?: string; utils?: string } = {},
): void {
	const pkgRoot = path.join(
		agentDir,
		"npm",
		"node_modules",
		"@zosmaai",
		"pi-llm-wiki",
	);
	const extDir = path.join(pkgRoot, "extensions", "llm-wiki");
	fs.mkdirSync(path.join(extDir, "lib"), { recursive: true });
	fs.writeFileSync(
		path.join(pkgRoot, "package.json"),
		JSON.stringify({ name: "@zosmaai/pi-llm-wiki", version: KNOWLEDGE_BASE_PIN }),
	);
	// Runtime-dep fantasma (Refs #29): isInstalledAtPin lo exige — sin esto
	// el fixture simula un install PRE-FIX y el wrapper lo daría por ausente.
	const coreRoot = path.join(
		agentDir,
		"npm",
		"node_modules",
		"@mariozechner",
		"pi-agent-core",
	);
	fs.mkdirSync(coreRoot, { recursive: true });
	fs.writeFileSync(path.join(coreRoot, "package.json"), JSON.stringify({}));

	// Entry con import de VALOR del peer alias (@mariozechner → SDK real).
	fs.writeFileSync(
		path.join(extDir, "index.ts"),
		`import { getAgentDir } from "@mariozechner/pi-coding-agent";
export default function (pi: any) {
	pi.registerTool({
		name: "wiki_bootstrap",
		label: "wiki_bootstrap",
		execute: async () => ({ content: [{ type: "text", text: "agentdir=" + typeof getAgentDir }] }),
	});
	pi.on("before_agent_start", async () => "upstream-hook-ok");
${entryExtra}
}
`,
	);

	// Prompts /wiki-* (los que el package loader registraría en pi).
	const promptsDir = path.join(pkgRoot, "prompts");
	fs.mkdirSync(promptsDir, { recursive: true });
	fs.writeFileSync(
		path.join(promptsDir, "wiki-init.md"),
		`---
description: Inicializa la wiki del proyecto
---
# /wiki-init
$ARGUMENTS
Crea el vault con wiki_bootstrap.
`,
	);
	fs.writeFileSync(
		path.join(promptsDir, "wiki-query.md"),
		`---
description: Consulta la wiki
---
# /wiki-query
$ARGUMENTS
Busca con kb_search.
`,
	);

	// Skill llm-wiki (SKILL.md).
	const skillDir = path.join(pkgRoot, "skills", "llm-wiki");
	fs.mkdirSync(skillDir, { recursive: true });
	fs.writeFileSync(
		path.join(skillDir, "SKILL.md"),
		`---
name: llm-wiki
description: Fake skill del upstream
---
Cuerpo de la skill.
`,
	);

	// lib/: los 3 módulos que registerKbAliases carga vía jiti.
	fs.writeFileSync(
		path.join(extDir, "lib", "recall.ts"),
		libImpl.search ??
			`export async function searchWikiHybrid(primaryPaths: any, query: string, maxResults = 5) {
	return [{ id: "concepts/\${query}", title: "Fake " + query, type: "concept", preview: "preview", path: primaryPaths.wiki + "/concepts/" + query + ".md" }];
}
`,
	);
	fs.writeFileSync(
		path.join(extDir, "lib", "knowledge-links.ts"),
		libImpl.links ??
			`// Réplica mínima del contrato real (mdast): markdown links + wikilinks.
export function extractKnowledgeLinks(body: string) {
	const wikilinks = [...body.matchAll(/\\[\\[([^\\]|]+)(?:\\|[^\\]]*)?\\]\\]/g)].map((m) => ({ target: m[1].trim() }));
	const markdown = [...body.matchAll(/\\[[^\\]\\n]+\\]\\(([^)\\s]+)\\)/g)].map((m) => ({ target: m[1].trim() }));
	return { markdown, wikilinks };
}
`,
	);
	fs.writeFileSync(
		path.join(extDir, "lib", "utils.ts"),
		libImpl.utils ??
			`export function resolveVaultPaths(cwd: string) {
	return { root: cwd, wiki: cwd + "/.llm-wiki/wiki" };
}
`,
	);
}

/** Mini-vault OKF en workDir con páginas enlazadas. */
function writeMiniVault(): void {
	const wiki = path.join(workDir, ".llm-wiki", "wiki");
	fs.mkdirSync(path.join(wiki, "concepts"), { recursive: true });
	fs.writeFileSync(
		path.join(wiki, "index.md"),
		'---\nokf_version: "0.2"\ntype: index\n---\nÍndice.\n',
	);
	fs.writeFileSync(
		path.join(wiki, "concepts", "rag.md"),
		"---\ntype: concept\n---\nRAG Indexa. Ver [[concepts/embeddings]] y [análisis](../analyses/costo.md).\n",
	);
	fs.writeFileSync(
		path.join(wiki, "concepts", "embeddings.md"),
		"---\ntype: concept\n---\nEmbeddings. Lo usa [[concepts/rag]].\n",
	);
	fs.mkdirSync(path.join(wiki, "analyses"), { recursive: true });
	fs.writeFileSync(
		path.join(wiki, "analyses", "costo.md"),
		"---\ntype: analysis\n---\nCosto de [[concepts/embeddings]].\n",
	);
}

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-kbw-"));
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-kbws-"));
	prevAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
	delete process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
	fs.rmSync(agentDir, { recursive: true, force: true });
	fs.rmSync(workDir, { recursive: true, force: true });
	if (prevAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = prevAgentDirEnv;
});

describe("frida-knowledge-base / wrapper", () => {
	it("paquete ausente: tool guía + instalación background inyectada", async () => {
		const pi = fakePi();
		const states: any[] = [];
		let installRan = false;
		await createFridaKnowledgeBase({
			agentDir,
			distDir: "/nonexistent/dist",
			deps: {
				ensureInstalled: async () => {
					installRan = true;
					return { alreadyInstalled: false };
				},
			},
			onStateChange: (s) => states.push(s),
		})(asApi(pi));
		expect(pi.tools.get("kb_search")).toBeTruthy(); // guía
		await new Promise((r) => setTimeout(r, 10));
		expect(installRan).toBe(true);
		expect(states.some((s) => s.installing)).toBe(true);
		expect(states.at(-1)).toMatchObject({ installed: true });
	});

	it("paquete presente: factory upstream corre y registra wiki_bootstrap", async () => {
		writeFakeUpstream();
		const pi = fakePi();
		const res = await createFridaKnowledgeBase({
			agentDir,
			distDir: path.resolve("dist"),
		})(asApi(pi));
		expect(res).toBeUndefined();
		expect(pi.tools.get("wiki_bootstrap")).toBeTruthy();
		// El import del peer alias (@mariozechner → SDK real) funcionó.
		const r = await pi.tools.get("wiki_bootstrap").execute();
		expect(r.content[0].text).toBe("agentdir=function");
		// Hook del upstream registrado (before_agent_start).
		expect(pi.events.has("before_agent_start")).toBe(true);
	});

	it("PI_CODING_AGENT_DIR se setea ANTES de cargar el upstream", async () => {
		writeFakeUpstream(
			`pi.registerTool({
		name: "kb_env_probe",
		execute: async () => ({ content: [{ type: "text", text: process.env.PI_CODING_AGENT_DIR ?? "unset" }] }),
	});`,
		);
		const pi = fakePi();
		// distDir real: el fake importa el peer @mariozechner (alias → SDK).
		await createFridaKnowledgeBase({
			agentDir,
			distDir: path.resolve("dist"),
		})(asApi(pi));
		const r = await pi.tools.get("kb_env_probe").execute();
		expect(r.content[0].text).toBe(path.resolve(agentDir));
	});

	it("materializa prompts /wiki-* y skill llm-wiki bajo <agentDir>", async () => {
		writeFakeUpstream();
		const pi = fakePi();
		// distDir real: el fake importa el peer @mariozechner (alias → SDK).
		await createFridaKnowledgeBase({
			agentDir,
			distDir: path.resolve("dist"),
		})(asApi(pi));
		// Prompts PLANOS en <agentDir>/prompts (el loader de pi es no-recursivo).
		const p1 = path.join(agentDir, "prompts", "wiki-init.md");
		expect(fs.existsSync(p1)).toBe(true);
		expect(fs.readFileSync(p1, "utf-8")).toContain("$ARGUMENTS");
		expect(fs.existsSync(path.join(agentDir, "prompts", "wiki-query.md"))).toBe(
			true,
		);
		// Skill en <agentDir>/skills/llm-wiki (symlink al paquete o copia).
		const sk = path.join(agentDir, "skills", "llm-wiki", "SKILL.md");
		expect(fs.existsSync(sk)).toBe(true);
	});

	it("kb_search delega en searchWikiHybrid del upstream", async () => {
		writeFakeUpstream();
		writeMiniVault();
		const pi = fakePi();
		// distDir real: el fake importa el peer @mariozechner (alias → SDK).
		await createFridaKnowledgeBase({
			agentDir,
			distDir: path.resolve("dist"),
			cwd: workDir,
		})(asApi(pi));
		const kb = pi.tools.get("kb_search");
		expect(kb).toBeTruthy();
		const r = await kb.execute("id", { query: "rag" });
		expect(r.isError).toBeFalsy();
		expect(r.content[0].text).toContain("concepts/rag");
		expect(r.content[0].text).toContain("Fake");
		// Sin query → error claro.
		const bad = await kb.execute("id", {});
		expect(bad.isError).toBe(true);
	});

	it("kb_neighbors: out/in edges con type OKF del mini-vault", async () => {
		writeFakeUpstream();
		writeMiniVault();
		const pi = fakePi();
		// distDir real: el fake importa el peer @mariozechner (alias → SDK).
		await createFridaKnowledgeBase({
			agentDir,
			distDir: path.resolve("dist"),
			cwd: workDir,
		})(asApi(pi));
		const nb = pi.tools.get("kb_neighbors");
		expect(nb).toBeTruthy();
		// concepts/rag → out: embeddings (concept, wikilink) + costo (analysis, md-link).
		const r = await nb.execute("id", { page: "concepts/rag" });
		expect(r.isError).toBeFalsy();
		const text = r.content[0].text;
		expect(text).toContain("[concept] concepts/embeddings");
		expect(text).toContain("[analysis] analyses/costo");
		// concepts/embeddings → out: rag; in: rag y costo.
		const r2 = await nb.execute("id", { page: "concepts/embeddings" });
		const text2 = r2.content[0].text;
		expect(text2).toContain("[concept] concepts/rag");
		expect(text2.match(/←/g)?.length).toBeGreaterThanOrEqual(2);
		// Página inexistente → error accionable.
		const nf = await nb.execute("id", { page: "no-existe" });
		expect(nf.isError).toBe(true);
	});

	it("entry corrupto degrada sin crash: tool guía de reparación", async () => {
		writeFakeUpstream();
		const pkgRoot = path.join(
			agentDir,
			"npm",
			"node_modules",
			"@zosmaai",
			"pi-llm-wiki",
		);
		// Corromper el entry (sintaxis inválida).
		fs.writeFileSync(
			path.join(pkgRoot, "extensions", "llm-wiki", "index.ts"),
			"esto no es ts valido {{{",
		);
		const pi = fakePi();
		const states: any[] = [];
		// distDir real: el fake importa el peer @mariozechner (alias → SDK).
		await createFridaKnowledgeBase({
			agentDir,
			distDir: path.resolve("dist"),
			onStateChange: (s) => states.push(s),
		})(asApi(pi));
		expect(pi.tools.get("kb_search")).toBeTruthy(); // guía de reparación
		expect(states.at(-1)?.error).toBeTruthy();
		const r = await pi.tools.get("kb_search").execute();
		expect(r.content[0].text).toContain("no se pudo cargar");
	});

	it("los aliases de jiti resuelven el SDK real (peer @mariozechner)", async () => {
		writeFakeUpstream(
			`pi.registerTool({
		name: "kb_peer_probe",
		execute: async () => ({ content: [{ type: "text", text: typeof getAgentDir === "function" ? "peer-ok" : "peer-bad" }] }),
	});`,
		);
		const pi = fakePi();
		await createFridaKnowledgeBase({
			agentDir,
			distDir: path.resolve("dist"), // → node_modules real del repo
		})(asApi(pi));
		const r = await pi.tools.get("kb_peer_probe").execute();
		expect(r.content[0].text).toBe("peer-ok");
		// Y el alias map incluye ambos peers del upstream.
		expect(Object.keys(upstreamPeerAliases(path.resolve("dist")))).toContain(
			"@mariozechner/pi-coding-agent",
		);
	});
});

describe("frida-knowledge-base / kb_search formato id vs path (#75)", () => {
	/**
	 * Incidente real (2026-08-18, nutrimetrics + GLM-5.3): el resultado
	 * imprimía el id relativo (`sources/obs-…`) y el path absoluto en líneas
	 * SIN etiquetar — el modelo agarró el id como ruta relativa del proyecto
	 * → ENOENT. El formato debe etiquetar ambos y advertir que el id NO es
	 * una ruta de archivo.
	 */
	it("etiqueta id (no-es-ruta) y path (absoluto) — sin líneas ambiguas", async () => {
		// Fake con id real (el default no interpola el query en el id — el
		// test viejo pasaba por el path). Espejo del incidente: sources/obs-…
		writeFakeUpstream("", {
			search: `export async function searchWikiHybrid(primaryPaths: any, query: string, maxResults = 5) {
	return [{ id: "sources/obs-demo", title: "Obs demo", type: "source", preview: "preview " + query, path: primaryPaths.wiki + "/sources/obs-demo.md" }];
}`,
		});
		const pi = fakePi();
		await createFridaKnowledgeBase({
			agentDir,
			distDir: path.resolve("dist"),
			cwd: workDir,
		})(asApi(pi));
		const kb = pi.tools.get("kb_search");
		const r = await kb.execute("id", { query: "rag" });
		expect(r.isError).toBeFalsy();
		const text = r.content[0].text as string;
		// id etiquetado + advertencia explícita de que no es ruta.
		expect(text).toMatch(/id: sources\/obs-demo — .*NO es una ruta/);
		// path absoluto etiquetado (línea que empieza con path: /).
		expect(text).toMatch(/path: \/\S*\/sources\/obs-demo\.md/);
		// preview sigue presente.
		expect(text).toContain("preview");
		// Ninguna línea desnuda con sólo el id (la trampa original).
		expect(text.split("\n").some((l) => l.trim() === "sources/obs-demo")).toBe(
			false,
		);
	});
});
