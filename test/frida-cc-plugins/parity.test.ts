/**
 * frida-cc-plugins — tests de paridad con /plugin de Claude Code
 * (issue #49, mini-batch: --available, #ref, bootstrap auto, info
 * pre-install, refresh-before-lookup, SSH).
 *
 * Git falso inyectado: "clone" copia el fixture al destino y CAPTURA los
 * args (para verificar --branch); resto de subcomandos → exit 0.
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
	listAvailable,
	pluginCatalogInfo,
	resolveMarketplaceRef,
} from "../../src/tools/frida-cc-plugins/installer";
import { loadRegistry } from "../../src/tools/frida-cc-plugins/registry";
import { OFFICIAL_MARKETPLACE } from "../../src/tools/frida-cc-plugins/constants";

let agentDir: string;
let marketplaceSrc: string;
let workDir: string;

/** Fake git: captura args; clone = cpSync del fixture. */
function fakeGit() {
	const calls: string[][] = [];
	return {
		calls,
		deps: {
			gitBin: "node",
			run: async (
				_bin: string,
				args: string[],
				_opts: { cwd: string },
			): Promise<{ code: number | null; stderr: string }> => {
				calls.push(args);
				if (args[0] === "clone") {
					const dest = args[args.length - 1];
					fs.cpSync(marketplaceSrc, dest, { recursive: true });
				}
				return { code: 0, stderr: "" };
			},
		},
	};
}

function writeFixture(): void {
	fs.mkdirSync(path.join(marketplaceSrc, ".claude-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(marketplaceSrc, ".claude-plugin", "marketplace.json"),
		JSON.stringify({
			name: "fixture-market",
			plugins: [
				{
					name: "pr-review",
					source: "./plugins/pr-review",
					version: "1.0.0",
					description: "Revisa PRs",
				},
				{
					name: "remoto",
					source: { source: "github", repo: "owner/remoto" },
				},
			],
		}),
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
		"---\nname: review\ndescription: d\n---\nC.\n",
	);
	fs.mkdirSync(path.join(p, "commands"), { recursive: true });
	fs.writeFileSync(path.join(p, "commands", "review.md"), "# R\n");
}

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
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-par-"));
	marketplaceSrc = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-mkt-"));
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-ws-"));
	writeFixture();
});

afterEach(() => {
	for (const d of [agentDir, marketplaceSrc, workDir]) {
		fs.rmSync(d, { recursive: true, force: true });
	}
});

describe("frida-cc-plugins / paridad / refs y SSH", () => {
	it("resolveMarketplaceRef captura #ref y acepta ssh git@", () => {
		expect(resolveMarketplaceRef("owner/repo#v1.2.3")).toEqual({
			kind: "git",
			url: "https://github.com/owner/repo.git",
			ref: "v1.2.3",
		});
		expect(resolveMarketplaceRef("git@gitlab.com:g/p.git")).toEqual({
			kind: "git",
			url: "git@gitlab.com:g/p.git",
		});
		expect(resolveMarketplaceRef("https://x.com/a.git#dev")).toMatchObject({
			ref: "dev",
		});
	});

	it("addMarketplace con #ref pasa --branch al clone", async () => {
		const fake = fakeGit();
		const res = await addMarketplace(agentDir, "owner/repo#v1.0.0", {
			deps: fake.deps,
			cwd: workDir,
		});
		expect(res.name).toBe("fixture-market");
		const clone = fake.calls.find((c) => c[0] === "clone");
		expect(clone).toBeTruthy();
		const branchIdx = clone?.indexOf("--branch") ?? -1;
		expect(branchIdx).toBeGreaterThanOrEqual(0);
		expect(clone?.[branchIdx + 1]).toBe("v1.0.0");
		// El ref queda registrado para reusarse en updates.
		expect(loadRegistry(agentDir).marketplaces["fixture-market"]?.ref).toBe(
			"v1.0.0",
		);
	});
});

describe("frida-cc-plugins / paridad / list --available + info", () => {
	it("listAvailable marca instalados y remotos", async () => {
		await addMarketplace(agentDir, marketplaceSrc, { cwd: workDir });
		await installPlugin(agentDir, "pr-review@fixture-market", { cwd: workDir });
		const avail = listAvailable(agentDir);
		const pr = avail.find((a) => a.name === "pr-review");
		const remoto = avail.find((a) => a.name === "remoto");
		expect(pr).toMatchObject({
			installed: true,
			enabled: true,
			remote: false,
		});
		expect(remoto).toMatchObject({ installed: false, remote: true });
	});

	it("pluginCatalogInfo: inventario pre-install (path) y remote (github)", async () => {
		await addMarketplace(agentDir, marketplaceSrc, { cwd: workDir });
		const local = pluginCatalogInfo(agentDir, "pr-review");
		expect(local.components?.skills).toEqual(["review"]);
		expect(local.components?.commands).toEqual(["review"]);
		const remote = pluginCatalogInfo(agentDir, "remoto");
		expect(remote.remote).toBe("github:owner/remoto");
		expect(() => pluginCatalogInfo(agentDir, "inexistente")).toThrow(
			/no encontrado/,
		);
	});

	it("comando /ccplugin info muestra detalle pre-install sin instalar", async () => {
		await addMarketplace(agentDir, marketplaceSrc, { cwd: workDir });
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const ctx = fakeCtx(workDir);
		await pi.commands.get("ccplugin")?.handler("info pr-review", ctx);
		expect(
			ctx.notifications.some(([m]) =>
				/pr-review@fixture-market v1\.0\.0 \(no instalado\)/.test(m),
			),
		).toBe(true);
		expect(ctx.notifications.some(([m]) => /instalará: 1 skills/.test(m))).toBe(
			true,
		);
	});

	it("comando list --available lista plugins con marcadores", async () => {
		await addMarketplace(agentDir, marketplaceSrc, { cwd: workDir });
		const pi = fakePi();
		await createFridaCcPlugins({ agentDir, cwd: workDir })(asApi(pi));
		const ctx = fakeCtx(workDir);
		await pi.commands.get("ccplugin")?.handler("list --available", ctx);
		expect(
			ctx.notifications.some(
				([m]) => /pr-review@fixture-market/.test(m) && /remoto/.test(m),
			),
		).toBe(true);
	});
});

describe("frida-cc-plugins / paridad / bootstrap auto + refresh-lookup", () => {
	it("primer arranque con registro vacío agrega el oficial (una sola vez)", async () => {
		const fake = fakeGit();
		const pi = fakePi();
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			deps: fake.deps,
		})(asApi(pi));
		const ctx = fakeCtx(workDir);
		await (pi.events.get("resources_discover") ?? [])[0]?.({ cwd: workDir }, ctx);
		const reg = loadRegistry(agentDir);
		expect(reg.marketplaces["fixture-market"]).toBeTruthy();
		expect(reg.bootstrapped).toBe(true);
		expect(
			ctx.notifications.some(([m]) => /agregado automáticamente/.test(m)),
		).toBe(true);
		// El clone fue contra el oficial.
		const clone = fake.calls.find((c) => c[0] === "clone");
		expect(clone?.some((a) => a.includes(OFFICIAL_MARKETPLACE))).toBe(true);

		// Segundo discover: ya NO re-bootstrap (no más clones).
		const clonesAntes = fake.calls.filter((c) => c[0] === "clone").length;
		await (pi.events.get("resources_discover") ?? [])[0]?.(
			{ cwd: workDir },
			fakeCtx(workDir),
		);
		expect(fake.calls.filter((c) => c[0] === "clone").length).toBe(clonesAntes);
	});

	it("install refresca el catálogo si el último refresh pasó 30s", async () => {
		const fake = fakeGit();
		await addMarketplace(agentDir, "owner/repo", {
			deps: fake.deps,
			cwd: workDir,
		});
		// Envejecer el registro (simula sesión posterior).
		const reg = loadRegistry(agentDir);
		reg.marketplaces["fixture-market"]!.refreshedAt = new Date(
			Date.now() - 60_000,
		).toISOString();
		fs.writeFileSync(
			path.join(agentDir, "cc-plugins", "cc-plugins.json"),
			JSON.stringify(reg),
		);
		const clonesAntes = fake.calls.filter((c) => c[0] === "clone").length;
		await installPlugin(agentDir, "pr-review@fixture-market", {
			deps: fake.deps,
			cwd: workDir,
		});
		// Refresh-before-lookup: un clone extra antes del install.
		expect(fake.calls.filter((c) => c[0] === "clone").length).toBe(
			clonesAntes + 1,
		);
	});

	it("install NO refresca dentro del throttle de 30s", async () => {
		const fake = fakeGit();
		await addMarketplace(agentDir, "owner/repo", {
			deps: fake.deps,
			cwd: workDir,
		});
		const clonesAntes = fake.calls.filter((c) => c[0] === "clone").length;
		await installPlugin(agentDir, "pr-review@fixture-market", {
			deps: fake.deps,
			cwd: workDir,
		});
		expect(fake.calls.filter((c) => c[0] === "clone").length).toBe(clonesAntes);
	});
});
