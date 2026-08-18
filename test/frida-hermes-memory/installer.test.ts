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

// ── #72: auto-review funcional OOB con providers de extensión ──────────────

import { resolveAutoReviewOverride } from "../../src/tools/frida-hermes-memory/installer";

describe("frida-hermes-memory · resolveAutoReviewOverride (#72)", () => {
	it("modelo activo de provider de extensión → override a nativo disponible", () => {
		const r = resolveAutoReviewOverride(
			{ provider: "frida-enterprise", id: "DEMETER-BLOOM" },
			[
				{ provider: "github-copilot", id: "gpt-5.4" },
				{ provider: "frida-enterprise", id: "DEMETER-BLOOM" },
				{ provider: "anthropic", id: "claude-sonnet-4" },
			],
			["github-copilot"],
		);
		// Elige un NATIVO (no el enterprise), estable entre corridas.
		expect(r).toEqual({ llmModelOverride: "github-copilot/gpt-5.4", llmThinkingOverride: "off" });
	});

	it("prefiere el propio proveedor nativo activo si lo es (sin override necesario)", () => {
		const r = resolveAutoReviewOverride(
			{ provider: "anthropic", id: "claude-sonnet-4" },
			[
				{ provider: "anthropic", id: "claude-sonnet-4" },
				{ provider: "github-copilot", id: "gpt-5.4" },
			],
			["anthropic", "github-copilot"],
		);
		// El modelo activo ya es visible para el subprocess → no hace falta override.
		expect(r).toBeUndefined();
	});

	it("sin modelo activo o sin nativos con auth → undefined (best-effort, no rompe)", () => {
		expect(
			resolveAutoReviewOverride(undefined, [{ provider: "github-copilot", id: "gpt-5.4" }], ["github-copilot"]),
		).toBeUndefined();
		expect(
			resolveAutoReviewOverride(
				{ provider: "frida-enterprise", id: "X" },
				[{ provider: "frida-enterprise", id: "X" }],
				[],
			),
		).toBeUndefined();
	});

	it("no pisa un config existente del usuario (merge: preserva llaves ajenas)", () => {
		// La función de escritura respeta configs previos; aquí validamos la
		// decisión pura: con override resuelto, el write es merge no destructivo.
		const r = resolveAutoReviewOverride(
			{ provider: "frida-enterprise", id: "X" },
			[{ provider: "github-copilot", id: "gpt-5.4" }],
			["github-copilot"],
		);
		expect(r?.llmModelOverride).toBe("github-copilot/gpt-5.4");
	});
});

import {
	applyAutoReviewOverride,
	computeAutoReviewOverride,
} from "../../src/tools/frida-hermes-memory/installer";

describe("frida-hermes-memory · applyAutoReviewOverride (#72)", () => {
	it("escribe el config con override cuando no existe", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cfg-"));
		try {
			const ok = applyAutoReviewOverride(dir, {
				llmModelOverride: "github-copilot/gpt-5.4",
				llmThinkingOverride: "off",
			});
			expect(ok).toBe(true);
			const cfg = JSON.parse(
				fs.readFileSync(path.join(dir, "hermes-memory-config.json"), "utf-8"),
			) as Record<string, unknown>;
			expect(cfg.llmModelOverride).toBe("github-copilot/gpt-5.4");
			expect(cfg.llmThinkingOverride).toBe("off");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("NO pisa un llmModelOverride explícito del usuario (ni otra llave)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cfg-"));
		try {
			const cfgPath = path.join(dir, "hermes-memory-config.json");
			fs.writeFileSync(
				cfgPath,
				JSON.stringify({ llmModelOverride: "anthropic/claude-sonnet-4", reviewTransport: "direct" }),
			);
			const ok = applyAutoReviewOverride(dir, {
				llmModelOverride: "github-copilot/gpt-5.4",
				llmThinkingOverride: "off",
			});
			expect(ok).toBe(false);
			const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
			expect(cfg.llmModelOverride).toBe("anthropic/claude-sonnet-4");
			expect(cfg.reviewTransport).toBe("direct");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("idempotente: mismo override ya presente → false (no reescribe, no re-loggea)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cfg-"));
		try {
			applyAutoReviewOverride(dir, {
				llmModelOverride: "github-copilot/gpt-5.4",
				llmThinkingOverride: "off",
			});
			expect(
				applyAutoReviewOverride(dir, {
					llmModelOverride: "github-copilot/gpt-5.4",
					llmThinkingOverride: "off",
				}),
			).toBe(false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("merge: preserva llaves ajenas del usuario al escribir", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cfg-"));
		try {
			const cfgPath = path.join(dir, "hermes-memory-config.json");
			fs.writeFileSync(cfgPath, JSON.stringify({ autoReview: true, maxMemories: 50 }));
			applyAutoReviewOverride(dir, {
				llmModelOverride: "github-copilot/gpt-5.4",
				llmThinkingOverride: "off",
			});
			const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
			expect(cfg.autoReview).toBe(true);
			expect(cfg.maxMemories).toBe(50);
			expect(cfg.llmModelOverride).toBe("github-copilot/gpt-5.4");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("override undefined → false, no toca nada", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cfg-"));
		try {
			expect(applyAutoReviewOverride(dir, undefined)).toBe(false);
			expect(fs.existsSync(path.join(dir, "hermes-memory-config.json"))).toBe(false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("frida-hermes-memory · computeAutoReviewOverride (#72)", () => {
	it("filtra providers de extensión y requiere auth real (getApiKeyForProvider)", async () => {
		const keys: Record<string, string | undefined> = {
			"github-copilot": "ghu_x",
			anthropic: undefined, // sin auth → descartado
		};
		const r = await computeAutoReviewOverride({
			activeModel: { provider: "frida-enterprise", id: "DEMETER-BLOOM" },
			allModels: [
				{ provider: "frida-enterprise", id: "DEMETER-BLOOM" },
				{ provider: "anthropic", id: "claude-sonnet-4" },
				{ provider: "github-copilot", id: "gpt-5.4" },
			],
			getApiKeyForProvider: async (p) => keys[p],
		});
		// anthropic sin auth queda fuera; elige el copilot autenticado.
		expect(r).toEqual({ llmModelOverride: "github-copilot/gpt-5.4", llmThinkingOverride: "off" });
	});

	it("getApiKeyForProvider que lanza → tratado como sin auth (best-effort)", async () => {
		const r = await computeAutoReviewOverride({
			activeModel: { provider: "frida-enterprise", id: "X" },
			allModels: [{ provider: "openai", id: "gpt-5.4" }],
			getApiKeyForProvider: async () => {
				throw new Error("no auth entry");
			},
		});
		expect(r).toBeUndefined();
	});
});

describe("frida-hermes-memory · providers de extensión jamás candidatos (#72)", () => {
	it("activo softtek-devengine + frida-enterprise authed → override a un NATIVO, no al otro invisible", async () => {
		const keys: Record<string, string | undefined> = {
			"frida-enterprise": "bearer-token-enterprise", // authed PERO invisible
			"softtek-devengine": "key-devengine", // authed PERO invisible (y activo)
			"github-copilot": "ghu_x",
		};
		const r = await computeAutoReviewOverride({
			activeModel: { provider: "softtek-devengine", id: "gpt-5.6-luna" },
			allModels: [
				{ provider: "softtek-devengine", id: "gpt-5.6-luna" },
				{ provider: "frida-enterprise", id: "DEMETER-BLOOM" },
				{ provider: "github-copilot", id: "gpt-5.4" },
			],
			getApiKeyForProvider: async (p) => keys[p],
		});
		// Aunque frida-enterprise tenga auth, es invisible para el subprocess
		// de hermes → el candidato DEBE ser el nativo copilot.
		expect(r).toEqual({
			llmModelOverride: "github-copilot/gpt-5.4",
			llmThinkingOverride: "off",
		});
	});
});
