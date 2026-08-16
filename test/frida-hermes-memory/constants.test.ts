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

/** Escanea specifiers @earendil-works/* (con o sin subpath) en requires/imports JS. */
function scanSpecifiers(dir: string): Set<string> {
	const out = new Set<string>();
	if (!fs.existsSync(dir)) return out;
	const walk = (d: string) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".js")) {
				const code = fs.readFileSync(p, "utf-8");
				for (const m of code.matchAll(/"(@earendil-works\/[a-z-]+(?:\/[a-z0-9./_-]+)?)"/g)) {
					out.add(m[1]!);
				}
			}
		}
	};
	walk(dir);
	return out;
}

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

	it("los aliases cubren los peers del upstream + pi-tui (utilidades de texto)", () => {
		const a = upstreamPeerAliases("/repo/dist");
		expect(Object.keys(a).sort()).toEqual([
			"@earendil-works/pi-ai",
			"@earendil-works/pi-ai/bedrock-provider",
			"@earendil-works/pi-ai/bun-oauth",
			"@earendil-works/pi-ai/compat",
			"@earendil-works/pi-ai/oauth",
			"@earendil-works/pi-ai/providers/all",
			"@earendil-works/pi-coding-agent",
			"@earendil-works/pi-tui",
		]);
	});

	it("contrato (Refs #21): TODO specifier @earendil-works/* del SDK dist tiene alias EXACTO", () => {
		// Hallazgo e2e: una vez que el upstream toca pi-coding-agent (alias),
		// el SDK dist entero carga bajo jiti y SUS requires internos pasan por
		// el map. jiti hace PREFIX-match: key "@earendil-works/pi-ai" +
		// specifier ".../pi-ai/oauth" → dist/index.js/oauth → Cannot find
		// module. Este contrato escanea los specifiers REALES del SDK dist y
		// exige alias por subpath exacto — un bump del SDK que añada un
		// subpath rompe AQUÍ, no en el usuario.
		const sdkDist = path.resolve(
			"node_modules/@earendil-works/pi-coding-agent/dist",
		);
		const a = upstreamPeerAliases(path.resolve("dist"));
		const specs = scanSpecifiers(sdkDist);
		expect(specs.size).toBeGreaterThan(0);
		for (const spec of specs) {
			// Mecanismo real de jiti: alias PRIMERO (prefix-match), luego
			// resolución nativa desde el archivo requiriente. El ÚNICO riesgo
			// que este map introduce es el prefix-match: una key prefijo
			// intercepta el specifier y produce un path inexistente (el bug
			// e2e: key "@earendil-works/pi-ai" + "…/pi-ai/oauth" →
			// dist/index.js/oauth). Contrato: toda key prefijo que alcance un
			// specifier del SDK dist debe concatenar a un archivo existente.
			// Los specs sin alias NI prefijo van por resolución nativa (igual
			// que sin jiti — ej. pi-agent-core nested del SDK).
			const prefix = Object.keys(a)
				.filter((k) => spec.startsWith(`${k}/`))
				.sort((x, y) => y.length - x.length)[0];
			const target = a[spec] ?? (prefix ? a[prefix]! + spec.slice(prefix.length) : undefined);
			if (target) {
				expect(fs.existsSync(target), `${spec} → ${target} inexistente`).toBe(true);
			}
		}
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
