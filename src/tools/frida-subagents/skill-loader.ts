// frida-subagents — preload de skills en el system prompt.
//
// Porte de pi-subagents/src/skill-loader.ts (ADR-0022 Fase 5 / D9).
// Cuando un agente tiene `skills: name1, name2` en su frontmatter,
// precarga esas skills y las inyecta en el system prompt.
//
// Discovery roots (first match wins):
//   1. <cwd>/.frida/skills/         (proyecto)
//   2. ~/.frida/skills/             (global, donde frida-pipeline sincroniza)
//
// Por root, una skill "foo" resuelve al primero de:
//   <root>/foo/SKILL.md       (directorio skill)
//   <root>/foo.md             (archivo plano)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Roots de discovery de skills (en orden de prioridad). */
function getSkillRoots(cwd: string): string[] {
	return [join(cwd, ".frida", "skills"), join(homedir(), ".frida", "skills")];
}

/**
 * Resuelve una skill por nombre, buscando en los roots.
 * Devuelve el contenido del SKILL.md, o undefined si no se encuentra.
 */
export function resolveSkill(
	skillName: string,
	cwd: string,
): string | undefined {
	for (const root of getSkillRoots(cwd)) {
		if (!existsSync(root)) continue;

		// <root>/<name>/SKILL.md
		const dirPath = join(root, skillName, "SKILL.md");
		if (existsSync(dirPath)) {
			try {
				return readFileSync(dirPath, "utf-8");
			} catch {
				continue;
			}
		}

		// <root>/<name>.md
		const flatPath = join(root, `${skillName}.md`);
		if (existsSync(flatPath)) {
			try {
				return readFileSync(flatPath, "utf-8");
			} catch {}
		}
	}
	return undefined;
}

/**
 * Precarga múltiples skills y construye un bloque para el system prompt.
 *
 * @param skillNames Nombres de skills a precargar (separados por coma o array)
 * @param cwd Directorio de trabajo del proyecto
 * @returns Bloque de texto con las skills, o string vacío si ninguna se encuentra.
 */
export function preloadSkills(
	skillNames: string | string[],
	cwd: string,
): string {
	const names =
		typeof skillNames === "string"
			? skillNames
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: skillNames;

	const found: string[] = [];
	const missing: string[] = [];

	for (const name of names) {
		const content = resolveSkill(name, cwd);
		if (content) {
			found.push(`### Skill: ${name}\n\n${content.trim()}`);
		} else {
			missing.push(name);
		}
	}

	if (found.length === 0) return "";

	const lines: string[] = ["## Preloaded Skills", ""];
	lines.push(...found);
	if (missing.length > 0) {
		lines.push("");
		lines.push(`<!-- Skills no encontradas: ${missing.join(", ")} -->`);
	}
	lines.push("");
	return lines.join("\n");
}
