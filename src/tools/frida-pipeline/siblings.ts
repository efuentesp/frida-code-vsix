// frida-pipeline — detección de extensiones hermanas (siblings).
//
// Espejo del patrón de `rpiv-core/siblings.ts`:
//  - 5 hermanas REQUERIDAS: frida-workflow, frida-args, frida-context,
//    frida-permission-system, frida-agent-browser.
//  - Detección por import dinámico: si la ruta no resuelve, la hermana se
//    reporta como `missing` (no fatal — frida-pipeline degrada con
//    funcionalidad reducida, igual que rpiv-pi con sus hermanos ausentes).
//  - Versión: leemos el `package.json` de la raíz (todos los puertos viven en
//    el mismo .vsix → misma versión). Si el .vsix está bundleado, la versión
//    viene del `package.json` raíz vía la API del extension context.
//
// Esta es la Fase 1 (esqueleto): todas las hermanas están embebidas en el
// mismo proyecto, así que la detección es 100% "OK" en condiciones normales.
// El mecanismo existe para diagnosticar builds rotos, vsixes recortados o
// errores de tree-shaking.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Una hermana de frida-pipeline. */
export interface SiblingInfo {
	/** Id canónico de la hermana (ej. "frida-workflow"). */
	id: SiblingId;
	/** ¿Presente en el build? true = OK, false = missing. */
	present: boolean;
	/** Versión reportada (del package.json raíz, todas las hermanas comparten
	 *  versión por estar en el mismo .vsix). "?" si no se pudo leer. */
	version: string;
	/** Path absoluto del módulo si está presente; undefined si missing. */
	modulePath?: string;
	/** Error legible si la detección falló (no fatal). */
	error?: string;
}

/** Las 5 hermanas que frida-pipeline requiere (D2 ADR-0021). */
export const REQUIRED_SIBLINGS = [
	"frida-workflow",
	"frida-args",
	"frida-context",
	"frida-permission-system",
	"frida-agent-browser",
] as const;

export type SiblingId = (typeof REQUIRED_SIBLINGS)[number];

/** Path del módulo de cada hermana, relativo a la raíz del repo. Las
 *  extensiones nativas son directorios con un `index.ts` en `src/tools/`. */
const SIBLING_PATHS: Record<SiblingId, string> = {
	"frida-workflow": "src/tools/frida-workflow/index.ts",
	"frida-args": "src/tools/frida-args/index.ts",
	"frida-context": "src/tools/frida-context/index.ts",
	"frida-permission-system": "src/tools/frida-permission-system/index.ts",
	"frida-agent-browser": "src/tools/frida-agent-browser/index.ts",
};

/** Estado agregado del pipeline (resultado de `detectSiblings`). */
export interface PipelineSiblingsStatus {
	/** Versión del paquete raíz (misma para todas las hermanas). */
	fridaVersion: string;
	/** Estado por hermana, en el orden de REQUIRED_SIBLINGS. */
	siblings: SiblingInfo[];
	/** true = todas las hermanas requeridas están presentes. */
	allPresent: boolean;
	/** Conteo de hermanas presentes (para el banner "X/5 hermanas"). */
	presentCount: number;
	/** Total esperado (5). */
	expectedCount: number;
}

// ---------------------------------------------------------------------------
// Resolución de la raíz del proyecto
// ---------------------------------------------------------------------------

/**
 * Resuelve la raíz del proyecto frida-code (donde vive `package.json`).
 *
 * Estrategia: subir desde este archivo hasta encontrar el `package.json` que
 * tenga `name === "frida-code"`. Es robusto frente a bundling (esbuild mete
 * todo en `dist/`) porque busca por contenido, no por layout.
 */
function resolveFridaProjectRoot(): string {
	// En runtime, `import.meta.url` apunta a este archivo. Bajo esbuild bundle,
	// el `__dirname`/`import.meta.url` originales se preservan en el source map
	// pero se pierden en el bundle; caemos a `process.cwd()` que Frida siempre
	// fija al directorio donde se cargó la extensión (vscode.ExtensionContext).
	// Como último fallback, buscamos relativo a `process.cwd()`.
	const candidates: string[] = [];

	// 1) process.cwd() — VS Code fija el cwd al del workspace o al del binario
	//    de la extensión, según el caso. Probamos ambos.
	candidates.push(process.cwd());

	// 2) Búsqueda hacia arriba desde process.cwd() buscando un package.json
	//    con el nombre correcto (5 niveles de margen; más que suficiente para
	//    `frida-code/dist/tools/frida-pipeline/...`).
	let cursor = process.cwd();
	for (let i = 0; i < 8; i++) {
		candidates.push(cursor);
		cursor = dirname(cursor);
	}

	for (const dir of candidates) {
		const pkgPath = join(dir, "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
					name?: string;
					version?: string;
				};
				if (pkg.name === "frida-code") return dir;
			} catch {
				// sigue buscando
			}
		}
	}

	// 3) Fallback final: process.cwd(). El banner mostrará "?" para la versión
	//    y los siblings se evaluarán relativo a este dir (puede fallar si
	//    corremos desde un directorio sin layout de frida-code; en ese caso el
	//    `existsSync` de los SIBLING_PATHS simplemente devuelve false).
	return process.cwd();
}

/** Lee la versión de frida-code desde el `package.json` raíz. */
function readFridaVersion(rootDir: string): string {
	const pkgPath = join(rootDir, "package.json");
	if (!existsSync(pkgPath)) return "?";
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			version?: string;
		};
		return pkg.version ?? "?";
	} catch {
		return "?";
	}
}

// ---------------------------------------------------------------------------
// Detección
// ---------------------------------------------------------------------------

/**
 * Detecta todas las hermanas requeridas y reporta su estado.
 *
 * El árbol `src/tools/<hermana>/index.ts` se chequea con `existsSync` (no se
 * ejecuta import dinámico para evitar arrastrar la carga de las 5 hermanas en
 * cada llamada — son ~50–250 KB cada una). La mera presencia del archivo
 * basta para la Fase 1; las Fases 2+ añadirán verificación de API surface
 * (cargar y leer un símbolo exportado conocido).
 *
 * Performance: O(5 × existsSync) ≈ 5 stat(2). Razonable para correr en
 * session_start o en respuesta a `/pipeline`.
 */
export function detectSiblings(): PipelineSiblingsStatus {
	const rootDir = resolveFridaProjectRoot();
	const fridaVersion = readFridaVersion(rootDir);

	const siblings: SiblingInfo[] = REQUIRED_SIBLINGS.map((id) => {
		const relPath = SIBLING_PATHS[id];
		const absPath = resolve(rootDir, relPath);
		if (existsSync(absPath)) {
			return {
				id,
				present: true,
				version: fridaVersion,
				modulePath: absPath,
			};
		}
		// No fatal — sólo informativo. El banner dirá "missing".
		return {
			id,
			present: false,
			version: fridaVersion,
			error: `No se encontró ${relPath} relativo a ${rootDir}`,
		};
	});

	const presentCount = siblings.filter((s) => s.present).length;
	return {
		fridaVersion,
		siblings,
		allPresent: presentCount === siblings.length,
		presentCount,
		expectedCount: siblings.length,
	};
}

/** Helper para serializar el estado a texto (logs, banner chat). */
export function formatSiblingsStatus(s: PipelineSiblingsStatus): string {
	const lines: string[] = [];
	lines.push(`frida-pipeline v${s.fridaVersion}`);
	lines.push(
		`Hermanas: ${s.presentCount}/${s.expectedCount} ` +
			(s.allPresent ? "✅" : "⚠️"),
	);
	for (const sib of s.siblings) {
		const glyph = sib.present ? "✅" : "❌";
		const ver = sib.present ? `v${sib.version}` : (sib.error ?? "missing");
		lines.push(`  ${glyph} ${sib.id.padEnd(26)} ${ver}`);
	}
	return lines.join("\n");
}
