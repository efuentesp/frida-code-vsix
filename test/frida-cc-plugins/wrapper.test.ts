/**
 * frida-cc-plugins — tests del wrapper (issue #49, ADR-0057).
 *
 * E2E del flujo con MARKETPLACE LOCAL (paridad acolomba: path del filesystem
 * con .claude-plugin/marketplace.json — sin git, sin red): add marketplace →
 * install plugin → resources_discover expone skillPaths/promptPaths
 * namespaced → enable/disable filtra → uninstall limpia (recursos + MCP +
 * registro) → colisión MCP falla con guía → comando /ccplugin notifica.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createFridaCcPlugins } from "../../src/tools/frida-cc-plugins/index";
import {
	addMarketplace,
	installPlugin,
	setPluginEnabled,
	uninstallPlugin,
} from "../../src/tools/frida-cc-plugins/installer";
import { loadRegistry } from "../../src/tools/frida-cc-plugins/registry";
import {
	CC_PLUGINS_FACTORY_NAME,
	fridaMcpConfigPath,
	resourcesPromptsDir,
	resourcesSkillsDir,
} from "../../src/tools/frida-cc-plugins/constants";

let agentDir: string;
let marketplaceSrc: string; // fixture del marketplace local
let workDir: string;

/** Crea el fixture: marketplace con 1 plugin (skill+command+mcp+agents). */
function writeMarketplaceFixture(): void {
	const cat = {
		name: "fixture-market",
		plugins: [
			{ name: "pr-review", source: "./plugins/pr-review", version: "1.0.0" },
		],
	};
	fs.mkdirSync(path.join(marketplaceSrc, ".claude-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(marketplaceSrc, ".claude-plugin", "marketplace.json"),
		JSON.stringify(cat, null, "\t"),
	);
	const p = path.join(marketplaceSrc, "plugins", "pr-review");
	fs.mkdirSync(path.join(p, ".claude-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(p, ".claude-plugin", "plugin.json"),
		JSON.stringify({ name: "pr-review", version: "1.0.0" }),
	);
	fs.mkdirSync(path.join(p, "skills", "review"), { recursive: true });
	fs.writeFileSync(
		path.join(p, "skills", "review", "SKILL.md"),
		"---\nname: review\ndescription: Revisa PRs\n---\nRevisa el PR.\n",
	);
	fs.mkdirSync(path.join(p, "commands"), { recursive: true });
	fs.writeFileSync(
		path.join(p, "commands", "review.md"),
		"# Review\n$ARGUMENTS\n",
	);
	fs.writeFileSync(
		path.join(p, ".mcp.json"),
		JSON.stringify({
			mcpServers: {
				prapi: {
					command: "node",
					args: ["${CLAUDE_PLUGIN_ROOT}/server.js"],
				},
			},
		}),
	);
	fs.mkdirSync(path.join(p, "agents"), { recursive: true });
	fs.writeFileSync(path.join(p, "agents", "verifier.md"), "agente");
}

/** Stub parcial del ExtensionAPI con handlers capturados por evento. */
function fakePi() {
	const events = new Map<
		string,
		((e: unknown, ctx: unknown) => Promise<unknown>)[]
	>();
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: unknown) => Promise<void> }
	>();
	return {
		events,
		commands,
		registerCommand: (
			name: string,
			opts: { handler: (args: string, ctx: unknown) => Promise<void> },
		) => commands.set(name, opts),
		on: (ev: string, h: (e: unknown, ctx: unknown) => Promise<unknown>) => {
			const list = events.get(ev) ?? [];
			list.push(h);
			events.set(ev, list);
			return () => {};
		},
	};
}
function asApi(pi: ReturnType<typeof fakePi>): ExtensionAPI {
	return pi as unknown as ExtensionAPI;
}

/** Fake del ExtensionContext para resources_discover / comandos. */
function fakeCtx(cwd: string) {
	const notifications: [string, string?][] = [];
	return {
		notifications,
		cwd,
		ui: {
			notify: (m: string, l?: string) => notifications.push([m, l]),
			confirm: async () => true,
			setStatus: () => {},
			theme: { fg: () => "" },
		},
	};
}

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-wr-"));
	marketplaceSrc = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-mkt-"));
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-ws-"));
	writeMarketplaceFixture();
});

afterEach(() => {
	for (const d of [agentDir, marketplaceSrc, workDir]) {
		fs.rmSync(d, { recursive: true, force: true });
	}
});

describe("frida-cc-plugins / wrapper (E2E marketplace local)", () => {
	it("add marketplace → install plugin → resources_discover expone namespaced", async () => {
		const mk = await addMarketplace(agentDir, marketplaceSrc, { cwd: workDir });
		expect(mk.name).toBe("fixture-market");
		expect(mk.plugins).toBe(1);
		// Registro como local (sin clone).
		expect(loadRegistry(agentDir).marketplaces["fixture-market"]?.local).toBe(
			true,
		);

		const res = await installPlugin(agentDir, "pr-review@fixture-market", {
			cwd: workDir,
		});
		expect(res.plugin).toBe("pr-review");
		expect(res.skills).toEqual(["pr-review-review"]);
		expect(res.commands).toEqual(["pr-review-review"]);
		expect(res.mcpServers).toEqual(["prapi"]);
		// Agents declarado → reportado como saltado (fase 2), no bloquea.
		expect(res.skipped.some((s) => s.kind === "agents")).toBe(true);

		// MCP registrado con placeholder sustituido al root instalado.
		const mcp = JSON.parse(
			fs.readFileSync(fridaMcpConfigPath(agentDir), "utf-8"),
		);
		expect(mcp.mcpServers.prapi.args[0]).toMatch(
			/cc-plugins\/installed\/pr-review@/,
		);
		expect(mcp.mcpServers.prapi.args[0]).not.toContain("${");

		// Skill materializada con name reescrito.
		const skillMd = fs.readFileSync(
			path.join(resourcesSkillsDir(agentDir), "pr-review", "review", "SKILL.md"),
			"utf-8",
		);
		expect(skillMd).toContain("name: pr-review-review");

		// Factory: resources_discover expone paths del plugin habilitado.
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const handlers = pi.events.get("resources_discover") ?? [];
		expect(handlers.length).toBeGreaterThan(0);
		const ctx = fakeCtx(workDir);
		const out = (await handlers[0]?.({ cwd: workDir }, ctx)) as {
			skillPaths: string[];
			promptPaths: string[];
		};
		expect(out.skillPaths).toHaveLength(1);
		expect(out.skillPaths[0]).toContain(
			path.join("skills", "pr-review", "review"),
		);
		expect(out.promptPaths.some((p) => p.endsWith("pr-review-review.md"))).toBe(
			true,
		);

		// Comando /ccplugin registrado.
		expect(pi.commands.has("ccplugin")).toBe(true);
	});

	it("disable filtra paths; uninstall limpia todo", async () => {
		await addMarketplace(agentDir, marketplaceSrc, { cwd: workDir });
		await installPlugin(agentDir, "pr-review@fixture-market", { cwd: workDir });

		setPluginEnabled(agentDir, "pr-review", false);
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const out = (await (pi.events.get("resources_discover") ?? [])[0]?.(
			{ cwd: workDir },
			fakeCtx(workDir),
		)) as { skillPaths: string[]; promptPaths: string[] };
		expect(out.skillPaths).toHaveLength(0);
		expect(out.promptPaths).toHaveLength(0);

		setPluginEnabled(agentDir, "pr-review", true);

		// Uninstall: recursos, MCP y registro limpios.
		await uninstallPlugin(agentDir, "pr-review");
		expect(
			fs.existsSync(path.join(resourcesSkillsDir(agentDir), "pr-review")),
		).toBe(false);
		expect(
			fs.existsSync(
				path.join(resourcesPromptsDir(agentDir), "pr-review-review.md"),
			),
		).toBe(false);
		const mcp = JSON.parse(
			fs.readFileSync(fridaMcpConfigPath(agentDir), "utf-8"),
		);
		expect(mcp.mcpServers.prapi).toBeUndefined();
		expect(loadRegistry(agentDir).plugins["pr-review"]).toBeUndefined();
	});

	it("reconcile re-instala desde el marketplace local si falta material", async () => {
		await addMarketplace(agentDir, marketplaceSrc, { cwd: workDir });
		await installPlugin(agentDir, "pr-review@fixture-market", { cwd: workDir });
		// Simular pérdida de material (p. ej. máquina nueva / borrón).
		fs.rmSync(path.join(resourcesSkillsDir(agentDir), "pr-review"), {
			recursive: true,
			force: true,
		});
		fs.rmSync(path.join(resourcesPromptsDir(agentDir), "pr-review-review.md"), {
			force: true,
		});

		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const ctx = fakeCtx(workDir);
		const out = (await (pi.events.get("resources_discover") ?? [])[0]?.(
			{ cwd: workDir },
			ctx,
		)) as { skillPaths: string[]; promptPaths: string[] };
		// Self-healing: re-instalado y expuesto de nuevo.
		expect(out.skillPaths).toHaveLength(1);
		expect(ctx.notifications.some(([m]) => /re-instalado/.test(m))).toBe(true);
	});

	it("colisión MCP: server con nombre ocupado → install falla con guía", async () => {
		// Pre-existente en el slot global de frida.
		fs.mkdirSync(agentDir, { recursive: true });
		fs.writeFileSync(
			fridaMcpConfigPath(agentDir),
			JSON.stringify({ mcpServers: { prapi: { command: "existente" } } }),
		);
		await addMarketplace(agentDir, marketplaceSrc, { cwd: workDir });
		await expect(
			installPlugin(agentDir, "pr-review@fixture-market", { cwd: workDir }),
		).rejects.toSatisfy((e: unknown) => {
			const err = e as { message?: string; guide?: string };
			return (
				/Conflicto de nombre MCP/.test(err.message ?? "") &&
				/conservan su nombre/.test(err.guide ?? "")
			);
		});
		// El registro no quedó con el plugin a medias.
		expect(loadRegistry(agentDir).plugins["pr-review"]).toBeUndefined();
	});

	it("comando /ccplugin: ref inválida → error; add local → instalado; list → lista", async () => {
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const cmd = pi.commands.get("ccplugin");
		expect(cmd).toBeTruthy();

		// Ref de marketplace inválida → error con guía (sin tocar red).
		const ctxBad = fakeCtx(workDir);
		await cmd?.handler("marketplace add no-es-un-ref", ctxBad);
		expect(
			ctxBad.notifications.some(
				([m, l]) => l === "error" && /no reconocida/.test(m),
			),
		).toBe(true);

		// Marketplace local vía comando.
		const ctxMk = fakeCtx(workDir);
		await cmd?.handler(`marketplace add ${marketplaceSrc}`, ctxMk);
		expect(
			ctxMk.notifications.some(([m]) => /'fixture-market' agregado/.test(m)),
		).toBe(true);

		// Instalación vía comando.
		const ctxAdd = fakeCtx(workDir);
		await cmd?.handler("add pr-review@fixture-market", ctxAdd);
		expect(
			ctxAdd.notifications.some(([m]) => /'pr-review' instalado/.test(m)),
		).toBe(true);

		// Lista.
		const ctxList = fakeCtx(workDir);
		await cmd?.handler("list", ctxList);
		expect(
			ctxList.notifications.some(([m]) => /pr-review@fixture-market/.test(m)),
		).toBe(true);
	});
});

export { CC_PLUGINS_FACTORY_NAME };
