// Loader del denylist compartido multi-agente (#196).
//
// Origen: davidondrej/skills — `~/.agents/hooks/dangerous-patterns.txt`: una
// regex POSIX-ERE por línea (# comentarios y líneas vacías ignoradas), un solo
// archivo compartido por TODOS los agentes de la máquina (Claude Code, Cursor,
// Codex, Pi, Frida, …). Frida lo lee vía el setting
// `frida.gates.dangerousCommandDenylistPath` y las líneas se suman a la capa
// `extraPatterns` de dangerous-commands.ts.
//
// Semántica (paridad con el guard upstream, que releeía el archivo por comando):
//  - Cache por (ruta, mtimeMs): una llamada `stat` por tool_call; re-lectura
//    sólo si el archivo cambió ("Edit this file to tune; changes apply
//    immediately" del upstream se preserva).
//  - FAIL-OPEN: ruta vacía, inexistente o ilegible → []. Un denylist roto NO
//    puede tumbar las llamadas bash del agente (el wrapper tool_call del
//    permission system sigue fail-closed para errores del gate en sí).
//  - Expansión `~`/`~/` al home del usuario (los settings de VS Code aceptan
//    ambos).

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Entrada del cache por ruta: mtime del archivo leído + líneas ya filtradas. */
interface DenylistCacheEntry {
	mtimeMs: number;
	patterns: string[];
}

/** Cache global por ruta absoluta (el setting se relee en cada tool_call). */
const cache = new Map<string, DenylistCacheEntry>();

/** Expande `~` y `~/` al home; deja intacto cualquier otra ruta. */
export function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/") || p.startsWith("~\\")) {
		return resolve(homedir(), p.slice(2));
	}
	return p;
}

/**
 * Lee el denylist compartido: una regex POSIX-ERE por línea; `#` comentarios,
 * líneas vacías ignoradas. Devuelve [] si la ruta está vacía, no existe o no
 * se puede leer (fail-open). El resultado se cachea por mtime.
 */
export function readSharedDenylist(rawPath: string | undefined): string[] {
	if (!rawPath || typeof rawPath !== "string") return [];
	let path: string;
	try {
		path = expandHome(rawPath.trim());
	} catch {
		return [];
	}
	if (!path) return [];

	try {
		const st = statSync(path);
		const hit = cache.get(path);
		if (hit && hit.mtimeMs === st.mtimeMs) return hit.patterns;

		const patterns = readFileSync(path, "utf8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"));

		cache.set(path, { mtimeMs: st.mtimeMs, patterns });
		return patterns;
	} catch {
		// Fail-open y SIN cachear el fallo: si el archivo aparece luego, la
		// siguiente tool_call lo detecta.
		cache.delete(path);
		return [];
	}
}
