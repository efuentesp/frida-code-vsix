// Tests del installer on-demand de frida-hermes-memory: idempotencia, npm ok
// (crea el paquete fake donde npm lo pondría), npm ausente (ENOENT), install
// fallido (exit≠0) y timeout. run() inyectado simula npm; fs real contra
// agentDir temporal (patrón test/frida-codebase-index/installer.test.ts).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	HermesMemoryInstallError,
	ensureInstalled,
	installedVersion,
	isInstalledAtPin,
	manualInstallCmd,
} from "../../src/tools/frida-hermes-memory/installer";
import {
	HERMES_MEMORY_PIN,
	HERMES_MEMORY_SPEC,
} from "../../src/tools/frida-hermes-memory/constants";

let agentDir: string;

/** Simula un npm exitoso: crea package.json + entry TS DONDE npm los pondría
 *  (bajo `<prefix>/node_modules/pi-hermes-memory/`). */
function fakeNpmOk(_bin: string, args: string[]) {
	expect(args[0]).toBe("install");
	expect(args[1]).toBe(HERMES_MEMORY_SPEC);
	const prefix = args[args.indexOf("--prefix") + 1];
	const pkgRoot = path.join(prefix, "node_modules", "pi-hermes-memory");
	fs.mkdirSync(path.join(pkgRoot, "src"), { recursive: true });
	fs.writeFileSync(
		path.join(pkgRoot, "src", "index.ts"),
		"export default function () {}\n",
	);
	fs.writeFileSync(
		path.join(pkgRoot, "package.json"),
		JSON.stringify({ name: "pi-hermes-memory", version: HERMES_MEMORY_PIN }),
	);
	return Promise.resolve({ code: 0, stderr: "" });
}

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-hm-"));
});
afterEach(() => {
	fs.rmSync(agentDir, { recursive: true, force: true });
});

describe("frida-hermes-memory installer", () => {
	it("idempotente: ya instalado al pin + entry → no llama npm", async () => {
		fakeNpmOk("npm", [
			"install",
			HERMES_MEMORY_SPEC,
			"--prefix",
			path.join(agentDir, "npm"),
		]);
		expect(isInstalledAtPin(agentDir)).toBe(true);
		let called = 0;
		const res = await ensureInstalled(agentDir, {
			deps: {
				run: () => {
					called++;
					return fakeNpmOk("npm", []);
				},
			},
		});
		expect(called).toBe(0);
		expect(res.alreadyInstalled).toBe(true);
		expect(installedVersion(agentDir)).toBe(HERMES_MEMORY_PIN);
	});

	it("instala: npm exitoso crea entry y package.json al pin", async () => {
		expect(isInstalledAtPin(agentDir)).toBe(false);
		const res = await ensureInstalled(agentDir, {
			deps: { run: fakeNpmOk },
		});
		expect(res.alreadyInstalled).toBe(false);
		expect(isInstalledAtPin(agentDir)).toBe(true);
	});

	it("npm ausente (ENOENT) → HermesMemoryInstallError con guía manual", async () => {
		const enoent = Object.assign(new Error("spawn npm ENOENT"), {
			code: "ENOENT",
		});
		await expect(
			ensureInstalled(agentDir, {
				deps: { run: () => Promise.reject(enoent) },
			}),
		).rejects.toThrow(HermesMemoryInstallError);
		try {
			await ensureInstalled(agentDir, {
				deps: {
					run: () =>
						Promise.reject(
							Object.assign(new Error("spawn npm ENOENT"), {
								code: "ENOENT",
							}),
						),
				},
			});
		} catch (e) {
			expect((e as HermesMemoryInstallError).guide).toContain(
				manualInstallCmd(agentDir),
			);
			expect((e as HermesMemoryInstallError).guide).toContain("Node.js");
		}
	});

	it("install fallido (exit≠0) → error con guía que cita el comando manual", async () => {
		await expect(
			ensureInstalled(agentDir, {
				deps: {
					run: () =>
						Promise.resolve({
							code: 1,
							stderr: "gyp ERR! stack",
						}),
				},
			}),
		).rejects.toThrow(/exit 1/);
	});

	it("timeout → error que cita el límite y la guía manual", async () => {
		await expect(
			ensureInstalled(agentDir, {
				deps: {
					run: () => new Promise(() => {}), // nunca resuelve
					timeoutMs: 50,
				},
			}),
		).rejects.toThrow(/excedió/);
	});
});

// ─── Issue #62: retarget del prebuild de better-sqlite3 al Electron del host ──
// npm resuelve el prebuild para el ABI del node que lo ejecuta (nvm node 25 →
// 141), pero el módulo lo REQUIERE el extension host (Electron 42 → 146).
// Tras un install exitoso bajo Electron, el installer debe re-targetear:
// prebuild-install --runtime electron --target <process.versions.electron>.

describe("frida-hermes-memory installer · retarget electron (issue #62)", () => {
	/** npm ok + deja el tree con prebuild-install y better-sqlite3 (como el real). */
	function fakeNpmOkWithNative(_bin: string, args: string[]) {
		fakeNpmOk(_bin, args);
		const nm = path.join(agentDir, "npm", "node_modules");
		fs.mkdirSync(path.join(nm, "prebuild-install"), { recursive: true });
		fs.writeFileSync(path.join(nm, "prebuild-install", "bin.js"), "#!/usr/bin/env node\n");
		fs.mkdirSync(path.join(nm, "better-sqlite3"), { recursive: true });
		fs.writeFileSync(
			path.join(nm, "better-sqlite3", "package.json"),
			JSON.stringify({ name: "better-sqlite3", version: "12.11.1" }),
		);
		return Promise.resolve({ code: 0, stderr: "" });
	}

	it("install bajo electron → corre prebuild-install --runtime electron --target <ver> con cwd en better-sqlite3", async () => {
		const calls: Array<{ bin: string; args: string[]; cwd?: string }> = [];
		let n = 0;
		const res = await ensureInstalled(agentDir, {
			electronVersion: "42.0.2",
			deps: {
				run: (bin, args, opts) => {
					calls.push({ bin, args, cwd: opts?.cwd });
					n++;
					if (n === 1) return fakeNpmOkWithNative(bin, args);
					return Promise.resolve({ code: 0, stderr: "" }); // prebuild-install ok
				},
			},
		});
		expect(res.alreadyInstalled).toBe(false);
		expect(res.retargeted).toBe(true);
		expect(calls).toHaveLength(2);
		const rt = calls[1];
		expect(rt.bin).toBe("node");
		expect(rt.args[0]).toMatch(/prebuild-install[\\/]bin\.js$/);
		expect(rt.args).toContain("--runtime");
		expect(rt.args).toContain("electron");
		expect(rt.args).toContain("--target");
		expect(rt.args).toContain("42.0.2");
		expect(rt.cwd).toBe(
			path.join(agentDir, "npm", "node_modules", "better-sqlite3"),
		);
	});

	it("sin electron (node plano, tests) → no hay segunda llamada", async () => {
		const calls: unknown[][] = [];
		const res = await ensureInstalled(agentDir, {
			deps: {
				run: (bin: string, args: string[], opts?: { cwd?: string }) => {
					calls.push([bin, args, opts]);
					return fakeNpmOkWithNative(bin, args);
				},
			},
		});
		expect(calls).toHaveLength(1); // sólo el npm install
		expect(res.retargeted).toBe(false);
	});

	it("prebuild-install falla (exit≠0) → install SIGUE exitoso (advisory, no throw)", async () => {
		let n = 0;
		const progress: string[] = [];
		const res = await ensureInstalled(agentDir, {
			electronVersion: "42.0.2",
			onProgress: (l) => progress.push(l),
			deps: {
				run: (bin: string, args: string[], _opts?: { cwd?: string }) => {
					n++;
					if (n === 1) return fakeNpmOkWithNative(bin, args);
					expect(args).toContain("electron");
					return Promise.resolve({ code: 1, stderr: "404 no prebuild" });
				},
			},
		});
		expect(res.alreadyInstalled).toBe(false);
		expect(res.retargeted).toBe(false);
		expect(progress.some((l) => /no se pudo re-ajustar/i.test(l))).toBe(true);
	});

	it("idempotente (ya al pin) → tampoco retargetea", async () => {
		fakeNpmOkWithNative("npm", [
			"install",
			HERMES_MEMORY_SPEC,
			"--prefix",
			path.join(agentDir, "npm"),
		]);
		let called = 0;
		const res = await ensureInstalled(agentDir, {
			electronVersion: "42.0.2",
			deps: {
				run: () => {
					called++;
					return Promise.resolve({ code: 0, stderr: "" });
			},
			},
		});
		expect(res.alreadyInstalled).toBe(true);
		expect(called).toBe(0);
		expect(res.retargeted).toBe(false);
	});
});
