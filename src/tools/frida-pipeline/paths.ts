// frida-pipeline — resolución de paths de recursos empaquetados.
//
// Porte de `rpiv-core/paths.ts` (ADR-0021 Fase 5). Resuelve el directorio de
// agentes/skills empaquetados. El SDK de Pi no expone un "dame la raíz de mi
// propia extensión", así que esto es la resolución idiomática.
//
// Bajo esbuild bundle (format: cjs), `import.meta.url` se pierde (se shimea),
// pero `__dirname` sigue disponible y vale `<root>/dist/`. La resolución
// primaria usa `__dirname` (válido en dev y en VSIX instalado); el walk-up
// desde `process.cwd()` queda como fallback para tests/headless. Ver
// `resolveProjectRoot()` para el detalle.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Raíz del proyecto frida-code.
 *
 * Orden de resolución:
 *  1. Relativa al bundle CJS: `__dirname` = `<root>/dist/` (válido tanto en
 *     dev como en VSIX instalado, donde `src/tools/frida-pipeline/{agents,
 *     skills}/` se shipea vía .vscodeignore). Guard estricto: sólo se usa si el
 *     árbol de pipeline existe en ese punto.
 *  2. Walk-up desde `process.cwd()` buscando `package.json` con
 *     `name === "frida-code"` (tests con vitest / headless, donde `__dirname`
 *     apunta al source transformado, no al bundle).
 *
 * NOTA: ANTES esto sólo hacía (2), que fallaba cuando la extensión corría con
 * un workspace distinto al repo (Extension Development Host sobre un proyecto
 * de prueba, o VSIX instalado donde cwd = proyecto del usuario):
 * `BUNDLED_AGENTS_DIR` no existía → `syncBundled{Agents,Skills}` retornaban
 * vacío en silencio → Pi nunca descubría los skills empaquetados y no aparían
 * en Configuración > Recursos.
 */
function resolveProjectRoot(): string {
	// 1. Relativo al bundle (__dirname = <root>/dist/ en CJS).
	if (typeof __dirname !== "undefined") {
		const byBundle = resolve(__dirname, "..");
		if (
			existsSync(join(byBundle, "src", "tools", "frida-pipeline", "agents"))
		) {
			return byBundle;
		}
	}
	// 2. Walk-up desde cwd (tests / headless sin bundle).
	let cursor = process.cwd();
	for (let i = 0; i < 8; i++) {
		const pkgPath = join(cursor, "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(
					require("node:fs").readFileSync(pkgPath, "utf8"),
				);
				if (pkg.name === "frida-code") return cursor;
			} catch {
				// sigue buscando
			}
		}
		cursor = dirname(cursor);
	}
	return process.cwd();
}

/** Raíz del proyecto frida-code (cacheada al cargar el módulo). */
export const PROJECT_ROOT = resolveProjectRoot();

/**
 * Directorio de agentes empaquetados. En dev: `src/tools/frida-pipeline/agents/`.
 * En bundle: el esbuild inlinea el contenido pero los .md viven en source.
 */
export const BUNDLED_AGENTS_DIR = join(
	PROJECT_ROOT,
	"src",
	"tools",
	"frida-pipeline",
	"agents",
);

/**
 * Directorio destino de los agentes en el agentDir global de Frida.
 * ADR-0021 D2: `<frida.agentDir>/../global/agents/` = `~/.frida/global/agents/`.
 */
export function getGlobalAgentsDir(agentDir: string): string {
	return join(agentDir, "global", "agents");
}
