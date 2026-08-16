// Tests de las constantes de frida-hermes-memory (pin, entry, aliases de peers).
// El espejo de package.json (frida.hermesMemory.enabled) lo valida la MV del
// slice; settings.ts NO se testea aquí (importa vscode, sin harness).
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import {
	HERMES_MEMORY_FACTORY_NAME,
	HERMES_MEMORY_PIN,
	HERMES_MEMORY_SPEC,
	upstreamEntryPath,
	upstreamPeerAliases,
} from "../../src/tools/frida-hermes-memory/constants";

describe("frida-hermes-memory constants", () => {
	it("el pin es exacto (sin rango): un solo seam con el upstream", () => {
		expect(HERMES_MEMORY_PIN).toMatch(/^\d+\.\d+\.\d+$/);
		expect(HERMES_MEMORY_SPEC).toBe(`pi-hermes-memory@${HERMES_MEMORY_PIN}`);
	});

	it("el entry es el TS fuente del paquete (manifest pi.extensions → jiti, no import nativo)", () => {
		const p = upstreamEntryPath("/home/u/.frida");
		expect(p).toBe(
			path.join(
				"/home/u/.frida",
				"npm",
				"node_modules",
				"pi-hermes-memory",
				"src",
				"index.ts",
			),
		);
		expect(path.extname(p)).toBe(".ts");
	});

	it("los aliases cubren los 3 peer-deps que el upstream importa en runtime", () => {
		const a = upstreamPeerAliases("/repo/dist");
		expect(Object.keys(a).sort()).toEqual([
			"@earendil-works/pi-ai",
			"@earendil-works/pi-ai/compat",
			"@earendil-works/pi-coding-agent",
		]);
	});

	it("los alias targets existen contra el node_modules del repo (nested u hoisted)", () => {
		// distDir ficticio dentro del repo → node_modules hermano real.
		const distDir = path.resolve("dist");
		const a = upstreamPeerAliases(distDir);
		for (const [spec, target] of Object.entries(a)) {
			expect(fs.existsSync(target), `${spec} → ${target}`).toBe(true);
		}
	});

	it("factory name registrado en pi-session", () => {
		expect(HERMES_MEMORY_FACTORY_NAME).toBe("frida-hermes-memory");
	});
});
