// Detección de paths fuera del workspace (Prioridad 3, "external_directory").
//
// El modelo de amenaza de Frida es la fuga por egress (ADR-0001). Un acceso
// FUERA del workspace (p. ej. `read ~/Documents/notas.md`, `read ../../otro`)
// no es necesariamente malo, pero es donde conviene pedir confirmación: el
// agente saliendo de la zona en la que se supone que trabaja.
//
// gotgenes resuelve symlinks para resistir evasión; aquí NO (es candado, y
// ADR-0001 lo rechaza). Resolvemos solo `~` y rutas relativas al cwd, y
// comparamos por prefijo. Un dev lo evita trivialmente (symlink, path absoluto
// ofuscado) — y eso está bien: el candado es el default, no enforced.
//
// Solo aplica a tools de archivo con `input.path` (read/edit/write/grep/find/
// ls). Los paths DENTRO de un comando `bash` NO se inspeccionan (requeriría
// parsear el shell; ver bash-indirection.ts para lo que sí cubrimos de bash).

import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export interface ExternalCheck {
  /** true si el path resuelto cae FUERA del cwd (workspace). */
  external: boolean;
  /** Path absoluto resuelto (para logging / depuración). */
  absPath?: string;
}

/**
 * Decide si un path del input cae fuera del directorio de trabajo.
 *
 * Expande `~`/`$HOME` al home real y resuelve rutas relativas contra `cwd`.
 * Un path es externo si, una vez resuelto, NO es prefijo del cwd. El caso
 * `path === cwd` no es externo (es la raíz del workspace).
 *
 * @param raw path tal como viene en event.input.path (string; array → se ignora).
 * @param cwd directorio de trabajo (workspace) inyectado por el host.
 */
export function isExternalPath(
  raw: unknown,
  cwd: string,
): ExternalCheck {
  if (typeof raw !== "string") return { external: false };
  const path = raw.trim();
  if (!path) return { external: false };
  if (!cwd) return { external: false }; // sin cwd no podemos decidir → no marcamos

  const expanded = expandHome(path);
  const abs = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const cwdAbs = resolve(cwd);

  // path.relative devuelve ".." al inicio si abs está fuera de cwdAbs, o un
  // path absoluto si están en raíces distintas (p. ej. drives en Windows).
  const rel = relative(cwdAbs, abs);
  const external = rel.startsWith("..") || isAbsolute(rel);

  return { external, absPath: abs };
}

/** Expande `~` y `$HOME` al principio del path (lo que hace el shell). */
function expandHome(p: string): string {
  const home = homedir();
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return home + p.slice(1);
  if (p.startsWith("$HOME/") || p.startsWith("$HOME\\")) {
    return home + p.slice(5);
  }
  return p;
}
