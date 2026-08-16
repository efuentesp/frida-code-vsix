/**
 * frida-knowledge-base — tests del installer on-demand (issue #29, ADR-0040).
 *
 * Inyecta el spawn de npm para no instalar nada: valida idempotencia,
 * errores accionables (npm ausente, exit≠0, timeout) y el comando manual.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	KnowledgeBaseInstallError,
	ensureInstalled,
	installedVersion,
	isInstalledAtPin,
	manualInstallCmd,
} from "../../src/tools/frida-knowledge-base/installer";
import { KNOWLEDGE_BASE_PIN } from "../../src/tools/frida-knowledge-base/constants";

let agentDir: string;

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-kb-test-"));
});

afterEach(() => {
	fs.rmSync(agentDir, { recursive: true, force: true });
});

/** Materializa el paquete fake al pin (solo package.json + entry TS). */
function writeFakePackage(): void {
	const pkgRoot = path.join(
		agentDir,
		"npm",
		"node_modules",
		"@zosmaai",
		"pi-llm-wiki",
	);
	fs.mkdirSync(path.join(pkgRoot, "extensions", "llm-wiki"), {
		recursive: true,
	});
	fs.writeFileSync(
		path.join(pkgRoot, "package.json"),
		JSON.stringify({ name: "@zosmaai/pi-llm-wiki", version: KNOWLEDGE_BASE_PIN }),
	);
	fs.writeFileSync(
		path.join(pkgRoot, "extensions", "llm-wiki", "index.ts"),
		"export default function () {}\n",
	);
}

describe("frida-knowledge-base / installer", () => {
	it("installedVersion lee la versión del package.json instalado", () => {
		expect(installedVersion(agentDir)).toBeUndefined(); // ausente
		writeFakePackage();
		expect(installedVersion(agentDir)).toBe(KNOWLEDGE_BASE_PIN);
	});

	it("isInstalledAtPin exige pin exacto + entry presente", () => {
		expect(isInstalledAtPin(agentDir)).toBe(false);
		writeFakePackage();
		expect(isInstalledAtPin(agentDir)).toBe(true);
		// Versión distinta (stale tras un bump de pin) → false.
		const pj = path.join(
			agentDir,
			"npm",
			"node_modules",
			"@zosmaai",
			"pi-llm-wiki",
			"package.json",
		);
		fs.writeFileSync(pj, JSON.stringify({ version: "0.0.1" }));
		expect(isInstalledAtPin(agentDir)).toBe(false);
	});

	it("ensureInstalled es idempotente: ya instalado no llama npm", async () => {
		writeFakePackage();
		let called = 0;
		const res = await ensureInstalled(agentDir, {
			deps: {
				run: async () => {
					called++;
					return { code: 0, stderr: "" };
				},
			},
		});
		expect(res.alreadyInstalled).toBe(true);
		expect(called).toBe(0);
	});

	it("npm ausente (ENOENT) → error con guía y comando manual", async () => {
		await expect(
			ensureInstalled(agentDir, {
				deps: {
					run: async () => {
						throw Object.assign(new Error("spawn npm ENOENT"), {
							code: "ENOENT",
						});
					},
				},
			}),
		).rejects.toSatisfy((e: unknown) => {
			const err = e as KnowledgeBaseInstallError;
			return (
				err instanceof KnowledgeBaseInstallError &&
				/npm no está disponible/.test(err.message) &&
				err.guide.includes(manualInstallCmd(agentDir))
			);
		});
	});

	it("npm falla (exit≠0) → error con guía accionable", async () => {
		await expect(
			ensureInstalled(agentDir, {
				deps: {
					run: async () => ({ code: 1, stderr: "ECONNREFUSED proxy" }),
				},
			}),
		).rejects.toSatisfy((e: unknown) => {
			const err = e as KnowledgeBaseInstallError;
			return (
				err instanceof KnowledgeBaseInstallError &&
				/exit 1/.test(err.message) &&
				err.guide.includes("proxy")
			);
		});
	});

	it("timeout del spawn → error que lo menciona", async () => {
		await expect(
			ensureInstalled(agentDir, {
				deps: {
					timeoutMs: 5,
					run: () =>
						new Promise((resolve) =>
							setTimeout(() => resolve({ code: 0, stderr: "" }), 50),
						),
				},
			}),
		).rejects.toSatisfy((e: unknown) => {
			const err = e as KnowledgeBaseInstallError;
			return /excedió/.test(err.message);
		});
	});
});
