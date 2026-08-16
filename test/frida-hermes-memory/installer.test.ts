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
