/**
 * Regresión del fix de activación de frida-knowledge-base/hermes (Refs #29).
 *
 * Bug: jiti 2.x bundleado hace
 * `createRequire(import.meta.url)("../dist/babel.cjs")` EN RUNTIME (transform
 * lazy) — esbuild no puede reescribir ese require dinámico y resuelve relativo
 * al bundle: dist/extension.js → dist/babel.cjs, que no existía. Síntoma:
 * "frida-knowledge-base no se pudo activar: Cannot find module
 * '../dist/babel.cjs'".
 *
 * Fix: esbuild.js copia jiti/dist/babel.cjs → dist/babel.cjs post-build
 * (un solo archivo sirve para todos los bundles de dist/).
 *
 * Dos seams:
 *  1. Mecanismo: mini-bundle con la receta EXACTA del host (banner + define
 *     de import.meta.url) en un dir llamado `dist/` — rojo sin babel.cjs
 *     (reproduce el error byte por byte), verde con él.
 *  2. Contrato: `node esbuild.js` produce dist/babel.cjs.
 */
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

/** Receta esbuild del host (esbuild.js): banner + define de import.meta.url. */
async function buildMiniBundle(outFile: string): Promise<void> {
	await build({
		stdin: {
			contents: `import { createJiti } from "jiti";
const entry = process.argv[2]!;
const j = createJiti(entry);
const mod = j(entry);
console.log("TRANSFORM OK", typeof mod.value);
`,
			resolveDir: repoRoot, // resuelve "jiti" desde node_modules del repo
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node18",
		outfile: outFile,
		banner: {
			js: `var __import_meta_url = require("url").pathToFileURL(__filename).href;`,
		},
		define: { "import.meta.url": "__import_meta_url" },
		logLevel: "silent",
	});
}

function runNode(script: string, args: string[]) {
	return spawnSync(process.execPath, [script, ...args], { encoding: "utf-8" });
}

describe("jiti bundleado — lazy require de ../dist/babel.cjs", () => {
	it("mecanismo: sin babel.cjs al lado truena con el error exacto; con él transforma", async () => {
		// Dir de salida DEBE llamarse "dist": el require lazy "../dist/babel.cjs"
		// desde <dir>/extension.js resuelve al mismo dir (como en producción).
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-jiti-fix-"));
		const outDir = path.join(tmp, "dist");
		fs.mkdirSync(outDir);
		const fixture = path.join(tmp, "fixture.ts");
		fs.writeFileSync(fixture, "export const value: number = 1;\n");
		const bundle = path.join(outDir, "extension.js");
		await buildMiniBundle(bundle);

		// ROJO — sin dist/babel.cjs: el error original del usuario.
		const red = runNode(bundle, [fixture]);
		expect(red.status).not.toBe(0);
		expect(red.stderr).toContain("Cannot find module '../dist/babel.cjs'");

		// VERDE — con la copia que hace esbuild.js post-build.
		fs.copyFileSync(
			path.join(repoRoot, "node_modules/jiti/dist/babel.cjs"),
			path.join(outDir, "babel.cjs"),
		);
		const green = runNode(bundle, [fixture]);
		expect(green.status).toBe(0);
		expect(green.stdout).toContain("TRANSFORM OK number");

		fs.rmSync(tmp, { recursive: true, force: true });
	}, 60_000);

	it("contrato: build:host (node esbuild.js) deja dist/babel.cjs junto a los bundles", () => {
		const r = spawnSync(process.execPath, ["esbuild.js"], {
			cwd: repoRoot,
			encoding: "utf-8",
			timeout: 120_000,
		});
		expect(r.status).toBe(0);
		const dst = path.join(repoRoot, "dist/babel.cjs");
		expect(fs.existsSync(dst)).toBe(true);
		// Es el babel real de jiti (no un stub): ~1.5MB.
		expect(fs.statSync(dst).size).toBeGreaterThan(1_000_000);
	}, 180_000);
});
