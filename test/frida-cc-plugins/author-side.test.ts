/**
 * frida-cc-plugins — tests del lado autor (issue #51): /ccplugin validate,
 * metadata.pluginRoot, renames (migración/eliminación/encadenado),
 * strict:false y metadata de descubrimiento.
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
} from "../../src/tools/frida-cc-plugins/installer";
import { loadRegistry } from "../../src/tools/frida-cc-plugins/registry";
import { validateMarketplaceDir } from "../../src/tools/frida-cc-plugins/validate";
import { readMarketplaceCatalog } from "../../src/tools/frida-cc-plugins/readers";

let agentDir: string;
let mktDir: string;
let workDir: string;

function writeMarketplace(cat: unknown): void {
	fs.rmSync(mktDir, { recursive: true, force: true });
	fs.mkdirSync(path.join(mktDir, ".claude-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(mktDir, ".claude-plugin", "marketplace.json"),
		JSON.stringify(cat, null, "\t"),
	);
}

function writePlugin(rel: string, opts: { version?: string; withManifest?: boolean } = {}): void {
	const p = path.join(mktDir, rel);
	fs.mkdirSync(path.join(p, ".claude-plugin"), { recursive: true });
	if (opts.withManifest !== false) {
		fs.writeFileSync(
			path.join(p, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: path.basename(rel), version: opts.version }),
		);
	}
	fs.mkdirSync(path.join(p, "skills", path.basename(rel)), { recursive: true });
	fs.writeFileSync(
		path.join(p, "skills", path.basename(rel), "SKILL.md"),
		`---\nname: ${path.basename(rel)}\ndescription: d\n---\nC.\n`,
	);
	fs.mkdirSync(path.join(p, "commands"), { recursive: true });
	fs.writeFileSync(path.join(p, "commands", `${path.basename(rel)}.md`), "# C\n");
}

function fakePi() {
	const events = new Map<string, ((e: unknown, ctx: unknown) => Promise<unknown>)[]>();
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	return {
		events,
		commands,
		registerCommand: (name: string, opts: { handler: (a: string, c: unknown) => Promise<void> }) =>
			commands.set(name, opts),
		on: (ev: string, h: (e: unknown, c: unknown) => Promise<unknown>) => {
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
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-aut-"));
	mktDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-autmkt-"));
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-autws-"));
});

afterEach(() => {
	for (const d of [agentDir, mktDir, workDir]) {
		fs.rmSync(d, { recursive: true, force: true });
	}
});

describe("#51 / validate", () => {
	it("marketplace válido: sin errores; sin owner advierte", () => {
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p1", source: "./plugins/p1" }],
		});
		writePlugin("plugins/p1");
		const r = validateMarketplaceDir(mktDir);
		expect(r.ok).toBe(true);
		expect(r.errors).toBe(0);
		expect(r.lines.some((l) => /sin 'owner'/.test(l.text))).toBe(true);
	});

	it("duplicados y versiones inconsistentes se reportan", () => {
		writeMarketplace({
			name: "m",
			plugins: [
				{ name: "p1", source: "./plugins/p1", version: "2.0.0" },
				{ name: "p1", source: "./plugins/p1" },
			],
		});
		const r = validateMarketplaceDir(mktDir);
		expect(r.errors).toBeGreaterThanOrEqual(1);

		writeMarketplace({
			name: "m",
			owner: { name: "x" },
			plugins: [{ name: "p1", source: "./plugins/p1", version: "2.0.0" }],
		});
		writePlugin("plugins/p1", { version: "1.0.0" });
		const r2 = validateMarketplaceDir(mktDir);
		expect(r2.ok).toBe(true);
		expect(
			r2.lines.some((l) => /version entry '2\.0\.0' ≠ plugin\.json '1\.0\.0'/.test(l.text)),
		).toBe(true);
	});

	it("source inexistente y renames huérfanos son errores", () => {
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p1", source: "./plugins/ausente" }],
		});
		expect(validateMarketplaceDir(mktDir).errors).toBeGreaterThanOrEqual(1);

		writeMarketplace({
			name: "m",
			plugins: [],
			renames: { viejo: "no-existe" },
		});
		expect(validateMarketplaceDir(mktDir).errors).toBeGreaterThanOrEqual(1);
	});

	it("directorio de PLUGIN directo también valida", () => {
		writeMarketplace({ name: "m", plugins: [] });
		writePlugin("plugins/p1");
		const r = validateMarketplaceDir(path.join(mktDir, "plugins", "p1"));
		expect(r.ok).toBe(true);
	});
});

describe("#51 / metadata.pluginRoot", () => {
	it("sources string sin ./ resuelven contra pluginRoot", async () => {
		writeMarketplace({
			name: "m",
			metadata: { pluginRoot: "./plugins" },
			plugins: [{ name: "p1", source: "p1" }],
		});
		writePlugin("plugins/p1");
		const cat = readMarketplaceCatalog(mktDir);
		expect(cat.plugins[0]?.source).toEqual({ kind: "path", path: "./plugins/p1" });
		// Instala de verdad con el source corto.
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const res = await installPlugin(agentDir, "p1@m", { cwd: workDir });
		expect(res.skills).toEqual(["p1-p1"]);
	});

	it("sin pluginRoot, string sin ./ se omite (estructura)", () => {
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p1", source: "p1" }],
		});
		writePlugin("plugins/p1");
		expect(readMarketplaceCatalog(mktDir).plugins).toHaveLength(0);
	});
});

describe("#51 / renames", () => {
	it("install con nombre viejo sigue el map; null → error con guía", async () => {
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p-nuevo", source: "./plugins/p-nuevo" }],
			renames: { "p-viejo": "p-nuevo", "p-fuera": null },
		});
		writePlugin("plugins/p-nuevo");
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const res = await installPlugin(agentDir, "p-viejo@m", { cwd: workDir });
		expect(res.plugin).toBe("p-nuevo");
		expect(loadRegistry(agentDir).plugins["p-nuevo"]).toBeTruthy();
		expect(loadRegistry(agentDir).plugins["p-viejo"]).toBeUndefined();

		await expect(
			installPlugin(agentDir, "p-fuera@m", { cwd: workDir }),
		).rejects.toThrow(/ELIMINADO/);
	});

	it("reconcile migra instalación existente y elimina con notice", async () => {
		// v1 del catálogo con p-viejo.
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p-viejo", source: "./plugins/p-viejo" }],
		});
		writePlugin("plugins/p-viejo");
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		await installPlugin(agentDir, "p-viejo@m", { cwd: workDir });
		expect(loadRegistry(agentDir).plugins["p-viejo"]).toBeTruthy();

		// v2: renombrado + uno eliminado.
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p-nuevo", source: "./plugins/p-nuevo" }],
			renames: { "p-viejo": "p-nuevo" },
		});
		writePlugin("plugins/p-nuevo");

		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const ctx = fakeCtx(workDir);
		await (pi.events.get("resources_discover") ?? [])[0]?.({ cwd: workDir }, ctx);
		expect(loadRegistry(agentDir).plugins["p-viejo"]).toBeUndefined();
		expect(loadRegistry(agentDir).plugins["p-nuevo"]).toBeTruthy();
		expect(ctx.notifications.some(([m]) => /renombrado a 'p-nuevo'/.test(m))).toBe(true);
	});
});

describe("#51 / strict:false + metadata", () => {
	it("entrada strict:false define componentes sin plugin.json", async () => {
		writeMarketplace({
			name: "m",
			plugins: [
				{
					name: "curado",
					source: "./raw",
					strict: false,
					skills: "./myskills",
				},
			],
		});
		const p = path.join(mktDir, "raw");
		fs.mkdirSync(path.join(p, "myskills", "s1"), { recursive: true });
		fs.writeFileSync(
			path.join(p, "myskills", "s1", "SKILL.md"),
			"---\nname: s1\ndescription: d\n---\nC.\n",
		);
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const res = await installPlugin(agentDir, "curado@m", { cwd: workDir });
		expect(res.skills).toEqual(["curado-s1"]);
	});

	it("strict:false + plugin.json declarando componentes → conflicto loud", async () => {
		writeMarketplace({
			name: "m",
			plugins: [{ name: "raw2", source: "./raw2", strict: false }],
		});
		const p = path.join(mktDir, "raw2");
		fs.mkdirSync(path.join(p, ".claude-plugin"), { recursive: true });
		fs.writeFileSync(
			path.join(p, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "raw2", commands: ["./cmds"] }),
		);
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		await expect(
			installPlugin(agentDir, "raw2@m", { cwd: workDir }),
		).rejects.toThrow(/strict:false con plugin\.json/);
	});

	it("list --available muestra displayName/categoría cuando existen", async () => {
		writeMarketplace({
			name: "m",
			plugins: [
				{
					name: "p1",
					source: "./plugins/p1",
					displayName: "Plugin Uno",
					category: "testing",
					tags: ["a", "b"],
				},
			],
		});
		writePlugin("plugins/p1");
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const ctx = fakeCtx(workDir);
		await pi.commands.get("ccplugin")?.handler("list --available", ctx);
		expect(ctx.notifications.some(([m]) => /Plugin Uno/.test(m))).toBe(true);
	});

	it("/ccplugin validate reporta por líneas con ✔/⚠", async () => {
		writeMarketplace({
			name: "m",
			owner: { name: "x" },
			plugins: [{ name: "p1", source: "./plugins/p1" }],
		});
		writePlugin("plugins/p1", { version: "1.0.0" });
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const ctx = fakeCtx(workDir);
		await pi.commands.get("ccplugin")?.handler(`validate ${mktDir}`, ctx);
		expect(ctx.notifications.some(([m]) => m.startsWith("✔"))).toBe(true);
		expect(
			ctx.notifications.some(([m, l]) => l === "info" && /Validación sin errores/.test(m)),
		).toBe(true);
	});
});
