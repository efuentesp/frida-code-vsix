// frida-pipeline — sincronización de skills empaquetadas al agentDir.
//
// Copia los directorios de skills (SKILL.md + _shared/) desde
// `src/tools/frida-pipeline/skills/` a `~/.frida/skills/` para que Pi los
// descubra en runtime. Es un copy simple (sin sha256/drift detection — las
// skills son de sólo lectura para el usuario, a diferencia de los agentes que
// el usuario puede editar).
//
// Idempotente: si el destino ya existe y el contenido coincide, no reescribe.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { BUNDLED_AGENTS_DIR } from "./paths";

/** Directorio fuente de skills (src/tools/frida-pipeline/skills/). */
const BUNDLED_SKILLS_DIR = join(BUNDLED_AGENTS_DIR, "..", "skills");

/** Cache de nombres de skills empaquetadas (subdirectorios con SKILL.md bajo
 *  BUNDLED_SKILLS_DIR, sin contar `_shared`). Sirve para que el panel Recursos
 *  pueda marcar una skill como "extensión" aunque Pi la etiquete "user"
 *  (porque la sincronizamos a ~/.frida/skills/). Se calcula bajo demanda y se
 *  cachea: el set es estático por proceso. */
let bundledSkillNamesCache: Set<string> | null = null;
export function getBundledSkillNames(): Set<string> {
	if (bundledSkillNamesCache) return bundledSkillNamesCache;
	const set = new Set<string>();
	try {
		if (existsSync(BUNDLED_SKILLS_DIR)) {
			for (const entry of readdirSync(BUNDLED_SKILLS_DIR, {
				withFileTypes: true,
			})) {
				if (
					entry.isDirectory() &&
					entry.name !== "_shared" &&
					existsSync(join(BUNDLED_SKILLS_DIR, entry.name, "SKILL.md"))
				) {
					set.add(entry.name);
				}
			}
		}
	} catch {
		/* set queda vacío — nada que etiquetar como extensión */
	}
	bundledSkillNamesCache = set;
	return set;
}

/** Directorio destino: ~/.frida/skills/ */
function getSkillsTargetDir(agentDir: string): string {
	return join(agentDir, "skills");
}

/** Copia recursiva de un archivo o directorio. */
function copyRecursive(src: string, dest: string): void {
	const stat = statSync(src);
	if (stat.isDirectory()) {
		mkdirSync(dest, { recursive: true });
		for (const entry of readdirSync(src)) {
			copyRecursive(join(src, entry), join(dest, entry));
		}
	} else {
		const content = readFileSync(src);
		// Sólo escribir si el destino no existe o difiere.
		if (!existsSync(dest) || !contentEquals(dest, content)) {
			writeFileSync(dest, content);
		}
	}
}

/** ¿El contenido del archivo destino coincide con el buffer? */
function contentEquals(destPath: string, srcBuf: Buffer): boolean {
	try {
		const destBuf = readFileSync(destPath);
		return destBuf.equals(srcBuf);
	} catch {
		return false;
	}
}

export interface SkillSyncResult {
	/** Directorios de skills copiados (nuevos o actualizados). */
	copied: string[];
	/** Directorios que ya estaban al día. */
	unchanged: string[];
	/** Errores por directorio. */
	errors: Array<{ dir: string; message: string }>;
}

/**
 * Sincroniza las skills empaquetadas a `~/.frida/skills/`.
 *
 * Copia cada subdirectorio de `BUNDLED_SKILLS_DIR` (incluyendo `_shared/`)
 * al destino. Idempotente: sólo escribe si el contenido difiere.
 *
 * Nunca lanza — los errores se coleccionan en `result.errors`.
 */
export function syncBundledSkills(agentDir: string): SkillSyncResult {
	const result: SkillSyncResult = { copied: [], unchanged: [], errors: [] };

	if (!existsSync(BUNDLED_SKILLS_DIR)) {
		return result;
	}

	const targetDir = getSkillsTargetDir(agentDir);
	try {
		mkdirSync(targetDir, { recursive: true });
	} catch (e) {
		result.errors.push({
			dir: targetDir,
			message: e instanceof Error ? e.message : String(e),
		});
		return result;
	}

	let entries: string[];
	try {
		entries = readdirSync(BUNDLED_SKILLS_DIR, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch (e) {
		result.errors.push({
			dir: BUNDLED_SKILLS_DIR,
			message: e instanceof Error ? e.message : String(e),
		});
		return result;
	}

	for (const entry of entries) {
		const src = join(BUNDLED_SKILLS_DIR, entry);
		const dest = join(targetDir, entry);

		try {
			// Detectar si ya está al día (comparar SKILL.md si existe).
			const skillMdSrc = join(src, "SKILL.md");
			const skillMdDest = join(dest, "SKILL.md");
			if (
				entry !== "_shared" &&
				existsSync(skillMdDest) &&
				existsSync(skillMdSrc) &&
				contentEquals(skillMdDest, readFileSync(skillMdSrc))
			) {
				// SKILL.md coincide — re-copia _shared/ por si cambió, pero marca unchanged.
				result.unchanged.push(entry);
				continue;
			}

			copyRecursive(src, dest);
			result.copied.push(entry);
		} catch (e) {
			result.errors.push({
				dir: entry,
				message: e instanceof Error ? e.message : String(e),
			});
		}
	}

	return result;
}
