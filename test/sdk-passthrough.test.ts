// Verifica el fix del bug "Failed to load extension: Invalid URL".
//
// PROBLEMA: Cuando el SDK se compila con esbuild (CJS), getAliases() en
// loader.js calcula packageIndex desde __dirname (que apunta a dist/, no al
// SDK original en node_modules). El shim de import.meta.resolve devolvía el
// specifier tal cual en catch → fileURLToPath("<bare>") → "Invalid URL".
//
// FIX (3 partes):
//   1. Shim: devolver __import_meta_url en catch (no el specifier)
//   2. Plugin esbuild: parchar loader.js → packageIndex apunta a sdk-passthrough.js
//   3. sdk-passthrough.ts: re-exporta la API del SDK

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(__dirname, "..");

describe("esbuild.js / fix Invalid URL", () => {
	const esbuildContent = fs.readFileSync(
		path.join(projectRoot, "esbuild.js"),
		"utf-8",
	);

	it("shim de import.meta.resolve devuelve __import_meta_url en catch (no specifier)", () => {
		// El bug era: catch { return specifier; } → fileURLToPath falla
		expect(esbuildContent).toContain("catch { return __import_meta_url; }");
		expect(esbuildContent).not.toContain("catch { return specifier; }");
	});

	it("plugin fixExtensionLoader está definido", () => {
		expect(esbuildContent).toContain("fixExtensionLoader");
		expect(esbuildContent).toContain("sdk-passthrough.js");
	});

	it("passthroughOptions tiene banner y define (shims de import.meta)", () => {
		// El passthrough necesita los mismos shims que el bundle principal
		expect(esbuildContent).toMatch(/passthroughOptions[\s\S]*banner/);
		expect(esbuildContent).toMatch(
			/passthroughOptions[\s\S]*"import\.meta\.url"/,
		);
	});
});

describe("sdk-passthrough.ts", () => {
	it("existe y re-exporta el SDK", () => {
		const passthroughSrc = path.join(projectRoot, "src/sdk-passthrough.ts");
		expect(fs.existsSync(passthroughSrc)).toBe(true);

		const content = fs.readFileSync(passthroughSrc, "utf-8");
		expect(content).toContain("@earendil-works/pi-coding-agent");
	});
});

// Tests que requieren dist/ construido (se ejecutan sólo si existe).
const distExists =
	fs.existsSync(path.join(projectRoot, "dist/extension.js")) &&
	fs.existsSync(path.join(projectRoot, "dist/sdk-passthrough.js"));

describe.skipIf(!distExists)("dist/ (requiere build)", () => {
	it("sdk-passthrough.js exporta defineTool", async () => {
		const url = pathToFileURL(
			path.join(projectRoot, "dist/sdk-passthrough.js"),
		).href;
		const mod = (await import(url)) as Record<string, unknown>;
		expect(typeof mod.defineTool).toBe("function");
	});

	it("extension.js tiene el shim fix (catch { return __import_meta_url; })", () => {
		const content = fs.readFileSync(
			path.join(projectRoot, "dist/extension.js"),
			"utf-8",
		);
		expect(content).toContain("catch { return __import_meta_url; }");
		expect(content).not.toContain("catch { return specifier; }");
	});

	it("extension.js tiene packageIndex apuntando a sdk-passthrough.js", () => {
		const content = fs.readFileSync(
			path.join(projectRoot, "dist/extension.js"),
			"utf-8",
		);
		expect(content).toContain("sdk-passthrough.js");
	});
});
