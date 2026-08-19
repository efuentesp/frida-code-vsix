/**
 * Atribución de recursos a módulos (#54) — attributeResources.
 *
 * Fixtures mínimos por cada regla: factory join, cc-plugins namespaced,
 * bundled del pipeline, realpath KB, prefijos de prompts, errores y lo
 * general (extensiones externas / skills globales / huérfanos).
 */
import { describe, expect, it } from "vitest";
import {
	attributeResources,
	factoryNameOf,
	resolveSkillSource,
	type AttributionInput,
} from "../src/module-attribution";

function baseInput(over: Partial<AttributionInput> = {}): AttributionInput {
	return {
		extensions: [],
		skills: [],
		prompts: [],
		errors: [],
		bundledSkillNames: new Set(),
		ccSkillNames: new Set(),
		kbRealPathPrefixes: ["/home/u/.frida/npm/node_modules/@zosmaai/pi-llm-wiki"],
		...over,
	};
}

describe("factoryNameOf", () => {
	it("resuelve inline y basename", () => {
		expect(factoryNameOf("<inline:frida-subagents>")).toBe("frida-subagents");
		expect(factoryNameOf("/home/u/.frida/extensions/foo.ts")).toBe("foo");
		expect(factoryNameOf("C:\\x\\bar.js")).toBe("bar");
	});
});

describe("attributeResources", () => {
	it("atribuye tools y comandos de una factory inline al toggle correcto", () => {
		const r = attributeResources(
			baseInput({
				extensions: [
					{
						path: "<inline:frida-subagents>",
						inline: true,
						tools: ["Agent", "get_subagent_result"],
						commands: ["detached"],
					},
				],
			}),
		);
		const sub = r.modules.find((m) => m.module === "subagents");
		expect(sub?.toggleable).toBe(true);
		expect(sub?.tools).toEqual(["Agent", "get_subagent_result"]);
		expect(sub?.commands).toEqual(["detached"]);
	});

	it("atribuye a módulos base por factory (no toggleable)", () => {
		const r = attributeResources(
			baseInput({
				extensions: [
					{
						path: "<inline:frida-permission-system>",
						inline: true,
						tools: [],
						commands: [],
					},
				],
			}),
		);
		const perm = r.modules.find((m) => m.module === "frida-permission-system");
		expect(perm?.toggleable).toBe(false);
	});

	it("extensiones externas van a general", () => {
		const r = attributeResources(
			baseInput({
				extensions: [
					{
						path: "/home/u/.frida/extensions/mi-ext.ts",
						inline: false,
						tools: ["mi_tool"],
						commands: [],
					},
				],
			}),
		);
		expect(r.general.extensions).toHaveLength(1);
		expect(r.general.extensions[0].tools).toEqual(["mi_tool"]);
	});

	it("skills: cc-plugins namespaced → ccPlugins; bundled → pipeline; realpath KB → knowledgeBase; resto → general", () => {
		const r = attributeResources(
			baseInput({
				skills: [
					{
						name: "appwrite-deploy",
						path: "/home/u/.frida/skills/appwrite-deploy",
						realPath: "/home/u/.frida/skills/appwrite-deploy",
						description: "",
						source: "global",
					},
					{
						name: "llm-wiki",
						path: "/home/u/.frida/skills/llm-wiki",
						realPath:
							"/home/u/.frida/npm/node_modules/@zosmaai/pi-llm-wiki/skills/llm-wiki",
						description: "",
						source: "global",
					},
				],
				bundledSkillNames: new Set(["commit"]),
				ccSkillNames: new Set(["appwrite-deploy"]),
			}),
		);
		expect(r.modules.find((m) => m.module === "ccPlugins")?.skills).toContain(
			"appwrite-deploy",
		);
		// bundled con fixture sintético: pipeline registra "commit" aunque no esté
		// en skills[] del input (la regla es por nombre).
		expect(r.modules.find((m) => m.module === "ccPlugins")?.skills).not.toContain(
			"llm-wiki",
		);
		expect(r.modules.find((m) => m.module === "knowledgeBase")?.skills).toContain(
			"llm-wiki",
		);
		expect(r.general.skills).toHaveLength(0);
	});

	it("prompts wiki-* → knowledgeBase; resto → general", () => {
		const r = attributeResources(
			baseInput({
				prompts: [
					{ name: "wiki-init", description: "" },
					{ name: "mi-prompt", description: "" },
				],
			}),
		);
		expect(r.modules.find((m) => m.module === "knowledgeBase")?.prompts).toEqual([
			"wiki-init",
		]);
		expect(r.general.prompts.map((p) => p.name)).toEqual(["mi-prompt"]);
	});

	it("errores bajo el paquete KB → knowledgeBase; huérfanos → general", () => {
		const r = attributeResources(
			baseInput({
				errors: [
					{
						path:
							"/home/u/.frida/npm/node_modules/@zosmaai/pi-llm-wiki/prompts/wiki-x.md",
						error: "boom",
					},
					{ path: "/home/u/.frida/skills/otra", error: "mal" },
				],
			}),
		);
		expect(
			r.modules.find((m) => m.module === "knowledgeBase")?.errors,
		).toHaveLength(1);
		expect(r.general.errors).toHaveLength(1);
	});

	it("los 15 toggles + bases siempre presentes y en orden de registro", () => {
		const r = attributeResources(baseInput());
		const toggles = r.modules.filter((m) => m.toggleable);
		const bases = r.modules.filter((m) => !m.toggleable);
		expect(toggles).toHaveLength(15);
		expect(bases.length).toBeGreaterThanOrEqual(9);
		expect(toggles.map((m) => m.module)).toEqual([
			"askUserQuestion",
			"todo",
			"context",
			"codebaseIndex",
			"hermesMemory",
			"knowledgeBase",
			"ccPlugins",
			"sandboxes",
			"subagents",
			"agentBrowser",
			"supiWeb",
			"mcpAdapter",
			"extensibleWorkflows",
			"gitSync",
			"worktree",
		]);
	});
});

describe("resolveSkillSource (#92: procedencia de skills para ResourceSummary)", () => {
	const bundled = new Set([
		"create-handoff",
		"resume-handoff",
		"discover",
		"plan",
	]);
	const cc = new Set(["deploy-skill"]);

	it("asigna 'extension' a las skills empaquetadas en frida-pipeline", () => {
		expect(
			resolveSkillSource({ name: "create-handoff", source: "user" }, bundled, cc),
		).toBe("extension");
		expect(
			resolveSkillSource(
				{ name: "resume-handoff", source: "global" },
				bundled,
				cc,
			),
		).toBe("extension");
		expect(
			resolveSkillSource({ name: "discover", source: "path" }, bundled, cc),
		).toBe("extension");
	});

	it("asigna 'extension' a las skills de cc-plugins", () => {
		expect(
			resolveSkillSource({ name: "deploy-skill", source: "user" }, bundled, cc),
		).toBe("extension");
	});

	it("asigna 'global' a skills de usuario (~/.frida/skills)", () => {
		expect(
			resolveSkillSource({ name: "mi-custom-skill", source: "user" }, bundled, cc),
		).toBe("global");
	});

	it("asigna 'project' a skills de proyecto (.frida/skills o .pi/skills)", () => {
		expect(
			resolveSkillSource(
				{ name: "project-skill", source: "project" },
				bundled,
				cc,
			),
		).toBe("project");
	});

	it("asigna 'path' como fallback para cualquier otra procedencia", () => {
		expect(
			resolveSkillSource({ name: "extra-skill", source: "other" }, bundled, cc),
		).toBe("path");
		expect(resolveSkillSource({ name: "extra-skill" }, bundled, cc)).toBe("path");
	});
});
