// frida-pipeline — resolución de paths de recursos empaquetados.
//
// Porte de `rpiv-core/paths.ts` (ADR-0021 Fase 5). Resuelve el directorio de
// agentes empaquetados relativo a este módulo. El SDK de Pi no expone un "dame
// la raíz de mi propia extensión", así que esto es la resolución idiomática.
//
// Bajo esbuild bundle, `import.meta.url` se pierde — el bundle mete todo en
// `dist/extension.js`. El walk-up busca el `package.json` con
// `name === "frida-code"` (mismo enfoque que siblings.ts). Si falla, cae a
// `process.cwd()` (VS Code fija el cwd al workspace).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Raíz del proyecto frida-code. Busca subiendo desde `process.cwd()` hasta
 * encontrar un `package.json` con `name === "frida-code"`.
 */
function resolveProjectRoot(): string {
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
