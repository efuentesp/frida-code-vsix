import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const assetsDir = fileURLToPath(
	new URL("../dist-webview/assets/", import.meta.url),
);

// Regresión: el hook post-comando de pi-lens pasaba biome sobre el bundle esbuild y
// el "reformateo" le quitaba el `;` antes de un `else` en código minificado (ASI) →
// SyntaxError al cargar el <script> → React nunca montaba → splash "Cargando Frida
// Code" eterno. Los bundles esbuild van prístinos; cualquier corrupción (biome,
// rebuild parcial, conflicto de merge) debe reventar aquí y no en la pantalla del
// usuario.
describe("integridad del bundle webview (dist-webview)", () => {
	const bundles = readdirSync(assetsDir).filter((f) =>
		/^index-[^.]+\.js$/.test(f),
	);

	it("incluye al menos un bundle index-*.js commiteado", () => {
		expect(bundles.length).toBeGreaterThan(0);
	});

	for (const bundle of bundles) {
		it(`\`${bundle}\` parsea sin errores de sintaxis (node --check)`, () => {
			const res = spawnSync(
				process.execPath,
				["--check", `${assetsDir}${bundle}`],
				{
					encoding: "utf8",
				},
			);
			expect(res.status, res.stderr).toBe(0);
		});
	}
});
