/**
 * frida-knowledge-base — tests de constantes (issue #29, ADR-0040).
 *
 * El pin/entry/aliases son el contrato del wrapper: si el upstream mueve su
 * entry o cambia el namespace de sus peer-deps, estos tests deben romper
 * ANTES de que rompa la sesión del usuario.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	KNOWLEDGE_BASE_PIN,
	KNOWLEDGE_BASE_SPEC,
	KNOWLEDGE_BASE_FACTORY_NAME,
	installedVersionPath,
	upstreamEntryPath,
	upstreamPeerAliases,
} from "../../src/tools/frida-knowledge-base/constants";

describe("frida-knowledge-base / constants", () => {
	it("el spec apunta al pin exacto del upstream", () => {
		expect(KNOWLEDGE_BASE_SPEC).toBe(`@zosmaai/pi-llm-wiki@${KNOWLEDGE_BASE_PIN}`);
		expect(KNOWLEDGE_BASE_PIN).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("el entry es el TS fuente de la extensión pi del paquete", () => {
		// extensions/llm-wiki/index.ts (manifest: pi.extensions = ["./extensions"]).
		expect(upstreamEntryPath("/a")).toBe(
			path.join(
				"/a",
				"npm",
				"node_modules",
				"@zosmaai",
				"pi-llm-wiki",
				"extensions",
				"llm-wiki",
				"index.ts",
			),
		);
	});

	it("la versión instalada se lee del package.json del paquete", () => {
		expect(installedVersionPath("/a")).toBe(
			path.join(
				"/a",
				"npm",
				"node_modules",
				"@zosmaai",
				"pi-llm-wiki",
				"package.json",
			),
		);
	});

	it("el factory name no choca con otros módulos de frida", () => {
		expect(KNOWLEDGE_BASE_FACTORY_NAME).toBe("frida-knowledge-base");
	});

	it("los aliases apuntan a archivos reales del node_modules que frida shipea", () => {
		// distDir = dist/ del VSIX → node_modules hermano del bundle.
		const aliases = upstreamPeerAliases(path.resolve("dist"));
		expect(Object.keys(aliases).sort()).toEqual(
			[
				"@mariozechner/pi-coding-agent",
				"typebox",
				"typebox/compile",
				"typebox/value",
			].sort(),
		);
		// Ambos destinos existen en el repo (se empaquetan en el VSIX).
		for (const target of Object.values(aliases)) {
			expect(fs.existsSync(target)).toBe(true);
		}
	});
});
