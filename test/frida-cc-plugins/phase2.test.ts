/**
 * frida-cc-plugins — tests de fase 2 (issue #50): fetch de sources remotos
 * (git con sha-pin, npm, archive zip+sha256 con unzip propio), scopes
 * user/project/local con precedencia, team settings (extraMarketplaces +
 * enabledPlugins), auto-update y context cost.
 *
 * Sin red: git/npm inyectados por spawn falso y el zip se construye en el
 * test con un writer mínimo (stored + deflateRaw) que ejercita el unzipSync
 * real del módulo fetch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { createFridaCcPlugins } from "../../src/tools/frida-cc-plugins/index";
import {
	addMarketplace,
	installPlugin,
	setMarketplaceAutoUpdate,
	setPluginEnabled,
	uninstallPlugin,
} from "../../src/tools/frida-cc-plugins/installer";
import {
	loadLayers,
	loadRegistry,
	mergeLayers,
	projectRegistryPath,
} from "../../src/tools/frida-cc-plugins/registry";
import { unzipSync } from "../../src/tools/frida-cc-plugins/fetch";

let agentDir: string;
let mktDir: string;
let remoteDir: string; // fixture de "repo remoto" para github source
let workDir: string;

// ─── Zip writer mínimo (stored + deflate) para ejercitar unzipSync ───────

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** Construye un zip con las entradas dadas (deflate). */
function makeZip(entries: { name: string; data: Buffer }[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const e of entries) {
		const comp = zlib.deflateRawSync(e.data);
		const crc = crc32(e.data);
		const nameB = Buffer.from(e.name, "utf-8");
		const lh = Buffer.alloc(30);
		lh.writeUInt32LE(0x04034b50, 0);
		lh.writeUInt16LE(20, 4);
		lh.writeUInt16LE(0, 6);
		lh.writeUInt16LE(8, 8); // deflate
		lh.writeUInt16LE(0, 10);
		lh.writeUInt16LE(0, 12);
		lh.writeUInt32LE(crc, 14);
		lh.writeUInt32LE(comp.length, 18);
		lh.writeUInt32LE(e.data.length, 22);
		lh.writeUInt16LE(nameB.length, 26);
		lh.writeUInt16LE(0, 28);
		locals.push(lh, nameB, comp);

		const ch = Buffer.alloc(46);
		ch.writeUInt32LE(0x02014b50, 0);
		ch.writeUInt16LE(20, 4);
		ch.writeUInt16LE(20, 6);
		ch.writeUInt16LE(0, 8);
		ch.writeUInt16LE(8, 10);
		ch.writeUInt16LE(0, 12);
		ch.writeUInt16LE(0, 14);
		ch.writeUInt32LE(crc, 16);
		ch.writeUInt32LE(comp.length, 20);
		ch.writeUInt32LE(e.data.length, 24);
		ch.writeUInt16LE(nameB.length, 28);
		ch.writeUInt16LE(0, 30);
		ch.writeUInt16LE(0, 32);
		ch.writeUInt16LE(0, 34);
		ch.writeUInt16LE(0, 36);
		ch.writeUInt32LE(0, 38);
		ch.writeUInt32LE(offset, 42);
		centrals.push(ch, nameB);
		offset += 30 + nameB.length + comp.length;
	}
	const cd = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, eocd]);
}

// ─── Fixtures ────────────────────────────────────────────────────────────

function writePluginAt(root: string, name: string): void {
	fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".claude-plugin", "plugin.json"),
		JSON.stringify({ name, version: "1.0.0" }),
	);
	fs.mkdirSync(path.join(root, "skills", name), { recursive: true });
	fs.writeFileSync(
		path.join(root, "skills", name, "SKILL.md"),
		`---\nname: ${name}\ndescription: d\n---\nCuerpo.\n`,
	);
	fs.mkdirSync(path.join(root, "commands"), { recursive: true });
	fs.writeFileSync(path.join(root, "commands", `${name}.md`), `# ${name}\n`);
}

function writeMarketplace(cat: unknown): void {
	fs.rmSync(mktDir, { recursive: true, force: true });
	fs.mkdirSync(path.join(mktDir, ".claude-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(mktDir, ".claude-plugin", "marketplace.json"),
		JSON.stringify(cat, null, "\t"),
	);
}

/** Fake git de MARKETPLACE: clone copia mktDir; escribe .git/HEAD verídico. */
function fakeMktGit() {
	const calls: string[][] = [];
	return {
		calls,
		deps: {
			gitBin: "node",
			run: async (
				_bin: string,
				args: string[],
				opts: { cwd: string },
			): Promise<{ code: number | null; stderr: string }> => {
				calls.push(args);
				if (args[0] === "clone") {
					const dest = args[args.length - 1];
					fs.cpSync(mktDir, dest, { recursive: true });
					fs.mkdirSync(path.join(dest, ".git"), { recursive: true });
					fs.writeFileSync(
						path.join(dest, ".git", "HEAD"),
						"0123456789abcdef0123456789abcdef01234567\n",
					);
				}
				return { code: 0, stderr: "" };
			},
		},
	};
}

/** Fake git/npm de PLUGINS (deps.fetch): gitRun clona remoteDir al staging. */
function fakeFetchDeps() {
	const gitCalls: string[][] = [];
	const npmCalls: string[][] = [];
	return {
		gitCalls,
		npmCalls,
		deps: {
			gitRun: async (args: string[], _cwd: string) => {
				gitCalls.push(args);
				if (args[0] === "clone") {
					const dest = args[args.length - 1];
					fs.cpSync(remoteDir, dest, { recursive: true });
					fs.mkdirSync(path.join(dest, ".git"), { recursive: true });
					fs.writeFileSync(
						path.join(dest, ".git", "HEAD"),
						"fedcba9876543210fedcba9876543210fedcba98\n",
					);
				}
				return { code: 0, stderr: "" };
			},
			npmRun: async (args: string[], cwd: string) => {
				npmCalls.push(args);
				// Spec npm: "@scope/pkg@ver" | "pkg@ver" | "pkg" → nombre limpio.
				const spec = args[1] ?? "pkg";
				const pkg = spec.startsWith("@")
					? spec.slice(0, spec.lastIndexOf("@")) || spec
					: spec.split("@")[0];
				const dest = path.join(cwd, "node_modules", ...pkg.split("/"));
				writePluginAt(dest, path.basename(pkg));
				return { code: 0, stderr: "" };
			},
		},
	};
}

function fakePi() {
	const events = new Map<
		string,
		((e: unknown, ctx: unknown) => Promise<unknown>)[]
	>();
	const commands = new Map<
		string,
		{ handler: (a: string, c: unknown) => Promise<void> }
	>();
	return {
		events,
		commands,
		registerCommand: (
			n: string,
			o: { handler: (a: string, c: unknown) => Promise<void> },
		) => commands.set(n, o),
		on: (ev: string, h: (e: unknown, c: unknown) => Promise<unknown>) => {
			const l = events.get(ev) ?? [];
			l.push(h);
			events.set(ev, l);
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
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-f2-"));
	mktDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-f2m-"));
	remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-f2r-"));
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-ccp-f2w-"));
});

afterEach(() => {
	for (const d of [agentDir, mktDir, remoteDir, workDir]) {
		fs.rmSync(d, { recursive: true, force: true });
	}
});

describe("#50 / fetch remoto: github con sha", () => {
	it("instala desde source github y fija rev al sha resuelto", async () => {
		writePluginAt(remoteDir, "remoto-plugin");
		writeMarketplace({
			name: "m",
			plugins: [
				{
					name: "remoto-plugin",
					source: { source: "github", repo: "owner/remoto-plugin" },
				},
			],
		});
		const mkt = fakeMktGit();
		await addMarketplace(agentDir, "owner/market", {
			cwd: workDir,
			deps: mkt.deps,
		});
		const fetch = fakeFetchDeps();
		const res = await installPlugin(agentDir, "remoto-plugin@m", {
			cwd: workDir,
			deps: { fetch: fetch.deps },
		});
		expect(res.plugin).toBe("remoto-plugin");
		expect(res.skills).toEqual(["remoto-plugin-remoto-plugin"]);
		// rev del SOURCE (sha del repo remoto), no la del marketplace.
		const rec = loadRegistry(agentDir).plugins["remoto-plugin"];
		expect(rec?.rev.startsWith("fedcba987654")).toBe(true);
		// El clone fue contra github del PLUGIN.
		expect(
			fetch.gitCalls[0]?.some((a) => a.includes("owner/remoto-plugin")),
		).toBe(true);
	});

	it("sha pin que no coincide → error de integridad", async () => {
		writePluginAt(remoteDir, "remoto-plugin");
		writeMarketplace({
			name: "m",
			plugins: [
				{
					name: "remoto-plugin",
					source: {
						source: "github",
						repo: "owner/remoto-plugin",
						sha: "ffffffffffffffffffffffffffffffffffffffff",
					},
				},
			],
		});
		const mkt = fakeMktGit();
		await addMarketplace(agentDir, "owner/market", {
			cwd: workDir,
			deps: mkt.deps,
		});
		await expect(
			installPlugin(agentDir, "remoto-plugin@m", {
				cwd: workDir,
				deps: { fetch: fakeFetchDeps().deps },
			}),
		).rejects.toThrow(/sha no coincide|Fetch del source/);
	});
});

describe("#50 / npm source", () => {
	it("instala vía npm install (registry privado en args)", async () => {
		writeMarketplace({
			name: "m",
			plugins: [
				{
					name: "pkg-plugin",
					source: {
						source: "npm",
						package: "@acme/pkg-plugin",
						version: "2.1.0",
						registry: "https://npm.example.com",
					},
				},
			],
		});
		const mkt = fakeMktGit();
		await addMarketplace(agentDir, "owner/market", {
			cwd: workDir,
			deps: mkt.deps,
		});
		const fetch = fakeFetchDeps();
		const res = await installPlugin(agentDir, "pkg-plugin@m", {
			cwd: workDir,
			deps: { fetch: fetch.deps },
		});
		expect(res.plugin).toBe("pkg-plugin");
		expect(res.skills.length).toBe(1);
		// npm recibió spec con versión + registry.
		const npmCall = fetch.npmCalls[0];
		expect(npmCall?.[1]).toBe("@acme/pkg-plugin@2.1.0");
		expect(npmCall?.includes("--registry")).toBe(true);
		expect(npmCall?.[npmCall.indexOf("--registry") + 1]).toBe(
			"https://npm.example.com",
		);
	});
});

describe("#50 / archive source + unzip propio", () => {
	it("descarga zip, verifica sha256, descomprime e instala", async () => {
		const zip = makeZip([
			{
				name: ".claude-plugin/plugin.json",
				data: Buffer.from(JSON.stringify({ name: "zip-plugin", version: "1.0.0" })),
			},
			{
				name: "skills/zip-plugin/SKILL.md",
				data: Buffer.from("---\nname: zip-plugin\ndescription: d\n---\nZ.\n"),
			},
			{
				name: "commands/zip.md",
				data: Buffer.from("# Zip\n"),
			},
		]);
		const sha = crypto.createHash("sha256").update(zip).digest("hex");
		writeMarketplace({
			name: "m",
			plugins: [
				{
					name: "zip-plugin",
					source: { source: "archive", url: "https://x.example/p.zip", sha256: sha },
				},
			],
		});
		const mkt = fakeMktGit();
		await addMarketplace(agentDir, "owner/market", {
			cwd: workDir,
			deps: mkt.deps,
		});
		const res = await installPlugin(agentDir, "zip-plugin@m", {
			cwd: workDir,
			deps: {
				fetch: {
					...fakeFetchDeps().deps,
					fetchArchive: async () => zip,
				},
			},
		});
		expect(res.plugin).toBe("zip-plugin");
		expect(res.skills).toEqual(["zip-plugin-zip-plugin"]);
		expect(res.commands).toEqual(["zip-plugin-zip"]);
		// rev derivada del digest.
		expect(
			loadRegistry(agentDir).plugins["zip-plugin"]?.rev.startsWith("zip-"),
		).toBe(true);
	});

	it("sha256 incorrecto → rechaza y no registra", async () => {
		const zip = makeZip([
			{
				name: ".claude-plugin/plugin.json",
				data: Buffer.from(JSON.stringify({ name: "zip-plugin" })),
			},
		]);
		writeMarketplace({
			name: "m",
			plugins: [
				{
					name: "zip-plugin",
					source: {
						source: "archive",
						url: "https://x.example/p.zip",
						sha256: "0".repeat(64),
					},
				},
			],
		});
		const mkt = fakeMktGit();
		await addMarketplace(agentDir, "owner/market", {
			cwd: workDir,
			deps: mkt.deps,
		});
		await expect(
			installPlugin(agentDir, "zip-plugin@m", {
				cwd: workDir,
				deps: { fetch: { fetchArchive: async () => zip } },
			}),
		).rejects.toThrow(/sha256|integridad|Fetch del source/);
		expect(loadRegistry(agentDir).plugins["zip-plugin"]).toBeUndefined();
	});

	it("unzipSync rechaza zip-slip", () => {
		const zip = makeZip([{ name: "../evil.txt", data: Buffer.from("x") }]);
		const out = path.join(workDir, "unzip-out");
		expect(() => unzipSync(zip, out)).toThrow(/insegura|zip-slip/);
	});
});

describe("#50 / scopes", () => {
	beforeEach(() => {
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p1", source: "./plugins/p1" }],
		});
		fs.mkdirSync(path.join(mktDir, "plugins"), { recursive: true });
		writePluginAt(path.join(mktDir, "plugins", "p1"), "p1");
	});

	it("install --scope project escribe el registro del workspace", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		await installPlugin(agentDir, "p1@m", { cwd: workDir, scope: "project" });
		const proj = JSON.parse(
			fs.readFileSync(projectRegistryPath(workDir), "utf-8"),
		);
		expect(proj.plugins["p1"]).toBeTruthy();
		expect(loadRegistry(agentDir).plugins["p1"]).toBeUndefined();
		// El merge lo ve con scope project.
		const merged = mergeLayers(loadLayers(agentDir, workDir));
		expect(merged.plugins.find((p) => p.name === "p1")?.scope).toBe("project");
	});

	it("precedencia local > project > user y uninstall cross-scope", async () => {
		await addMarketplace(agentDir, mktDir, { cwd: workDir });
		// user primero, luego local PISA.
		await installPlugin(agentDir, "p1@m", { cwd: workDir, scope: "user" });
		await installPlugin(agentDir, "p1@m", { cwd: workDir, scope: "local" });
		let merged = mergeLayers(loadLayers(agentDir, workDir));
		expect(merged.plugins.find((p) => p.name === "p1")?.scope).toBe("local");
		// uninstall sin scope elimina el de mayor precedencia (local).
		await uninstallPlugin(agentDir, "p1", { cwd: workDir });
		merged = mergeLayers(loadLayers(agentDir, workDir));
		expect(merged.plugins.find((p) => p.name === "p1")?.scope).toBe("user");
		// disable en su scope.
		setPluginEnabled(agentDir, "p1", false, { cwd: workDir });
		expect(
			mergeLayers(loadLayers(agentDir, workDir)).plugins.find(
				(p) => p.name === "p1",
			)?.rec.enabled,
		).toBe(false);
	});
});

describe("#50 / team settings + auto-update", () => {
	it("extraMarketplaces + enabledPlugins instalan al cargar", async () => {
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p1", source: "./plugins/p1" }],
		});
		fs.mkdirSync(path.join(mktDir, "plugins"), { recursive: true });
		writePluginAt(path.join(mktDir, "plugins", "p1"), "p1");

		const pi = fakePi();
		const states: { notice?: string }[] = [];
		// #88: onLog capturado — cuando el poll expira, el mensaje de error REAL
		// de addMarketplace/instalación aparece en el assertion (antes moría
		// invisible: 'expected [] to include m' sin pista).
		const logs: string[] = [];
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			extraMarketplaces: [mktDir],
			enabledPlugins: { "p1@m": true },
			onStateChange: (s) => states.push(s),
			onLog: (line) => logs.push(line),
		})(asApi(pi));
		await (pi.events.get("resources_discover") ?? [])[0]?.(
			{ cwd: workDir },
			fakeCtx(workDir),
		);
		// Instalación de equipo en background → poll.
		const deadline = Date.now() + 3_000;
		while (
			Date.now() < deadline &&
			!mergeLayers(loadLayers(agentDir, workDir)).plugins.some(
				(p) => p.name === "p1",
			)
		) {
			await new Promise((r) => setTimeout(r, 25));
		}
		const merged = mergeLayers(loadLayers(agentDir, workDir));
		expect(Object.keys(merged.marketplaces), `logs de instalación: ${JSON.stringify(logs)}`).toContain(
			"m",
		);
		expect(merged.plugins.find((p) => p.name === "p1")).toBeTruthy();
		expect(states.some((s) => /del equipo/.test(s.notice ?? ""))).toBe(true);
	});

	it("auto-update: rev nueva → re-install + notifica /reload", async () => {
		writeMarketplace({
			name: "m",
			plugins: [{ name: "p1", source: "./plugins/p1" }],
		});
		fs.mkdirSync(path.join(mktDir, "plugins"), { recursive: true });
		writePluginAt(path.join(mktDir, "plugins", "p1"), "p1");

		const mkt = fakeMktGit();
		await addMarketplace(agentDir, "owner/market", {
			cwd: workDir,
			deps: mkt.deps,
		});
		await installPlugin(agentDir, "p1@m", {
			cwd: workDir,
			deps: { fetch: fakeFetchDeps().deps },
		});
		setMarketplaceAutoUpdate(agentDir, "m", true);
		const revAntes = loadRegistry(agentDir).marketplaces["m"]?.rev;

		// "Push remoto": el próximo clone produce una rev distinta y disparar
		// discover con delay 0 (cloneRev resuelve vía rev-parse; el fake no
		// inyecta stdout → fallback Date.now, que AVANZA entre clones: eso
		// simula exactamente una rev nueva).
		const origRun = mkt.deps.run;
		let bump = false;
		mkt.deps.run = async (bin, args, opts) => {
			const r = await origRun(bin, args, opts);
			if (args[0] === "clone" && bump) {
				fs.writeFileSync(
					path.join(args[args.length - 1], ".git", "HEAD"),
					"9999999999999999999999999999999999999999\n",
				);
			}
			return r;
		};
		bump = true;
		const pi = fakePi();
		const states: { notice?: string }[] = [];
		await createFridaCcPlugins({
			agentDir,
			cwd: workDir,
			autoUpdateDelayMs: 0,
			deps: mkt.deps,
			onStateChange: (s) => states.push(s),
		})(asApi(pi));
		await (pi.events.get("resources_discover") ?? [])[0]?.(
			{ cwd: workDir },
			fakeCtx(workDir),
		);
		// El tick corre en background (delay 0) → poll del aviso vía notice.
		const deadline = Date.now() + 3_000;
		while (
			Date.now() < deadline &&
			!states.some((s) => /actualizado/.test(s.notice ?? ""))
		) {
			await new Promise((r) => setTimeout(r, 25));
		}
		// Comportamiento verificado: aviso + rev nueva + plugin re-instalado.
		expect(
			states.some(
				(s) => /actualizado/.test(s.notice ?? "") && /re-instalados/.test(s.notice ?? ""),
			),
		).toBe(true);
		const revDespues = loadRegistry(agentDir).marketplaces["m"]?.rev;
		expect(revDespues).toBeTruthy();
		expect(revDespues).not.toBe(revAntes);
		expect(loadRegistry(agentDir).plugins["p1"]).toBeTruthy();
	});
});
