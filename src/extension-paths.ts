// Utilidad pura (sin dependencia de vscode) para enumerar extensiones de proyecto.
// Aislada de pi-session.ts para poder testearla sin arrastrar el host de VS Code.

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Enumera archivos de extensión en `.frida/extensions` (Opción B): loose `.ts`/`.tsx`
 * y `subdir/index.ts`.
 *
 * El `additionalExtensionPaths` del `DefaultResourceLoader` trata un directorio como
 * un *package source* y **no** expande `.ts` sueltos, así que Frida lista los archivos
 * individualmente — igual que el descubrimiento estándar de Pi
 * (`discoverExtensionsInDir`, no exportado).
 *
 * Reglas soportadas:
 *   - `dir/*.ts` y `dir/*.tsx`          → archivos sueltos
 *   - `dir/<name>/index.ts`             → extensión multi-archivo (subdir)
 */
export function listProjectExtensionFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
			out.push(path.join(dir, entry.name));
		} else if (entry.isDirectory()) {
			const idx = path.join(dir, entry.name, "index.ts");
			if (fs.existsSync(idx)) out.push(idx);
		}
	}
	return out;
}
