// skill-contracts.ts — #159 Capa 0: vocabulario de artifactKind declarado en
// los SKILL.md (contract.produces.meta.artifactKind). La extensión escanea una
// vez al activar y registra el mapa en board.ts (setSkillContracts); el motor
// usa spec del workflow > este contrato > defaults de board.ts.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Extrae el frontmatter YAML (entre los primeros --- ... ---) de un SKILL.md. */
function frontmatterOf(content: string): string | undefined {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return m?.[1];
}

/**
 * Mini-parser del subárbol `contract:` → `produces:` → `meta:` →
 * `artifactKind:` por niveles de indentación (subset YAML suficiente para los
 * frontmatter reales; sin dependencia de parser YAML completo).
 */
export function extractContractArtifactKind(
	skillMd: string,
): string | undefined {
	const fm = frontmatterOf(skillMd);
	if (!fm) return undefined;
	const lines = fm.split(/\r?\n/);

	// Recorre el subárbol con un "camino" de claves por nivel de indentación.
	let inContract = false;
	let pathStack: { indent: number; key: string }[] = [];
	for (const raw of lines) {
		if (!raw.trim() || raw.trim().startsWith("#")) continue;
		const indent = raw.length - raw.trimStart().length;
		const kv = raw.trim().match(/^([\w-]+):\s*(.*)$/);
		if (!kv) continue;
		const key = kv[1]!;

		// Recorta el stack a los niveles abiertos con indentación menor.
		while (
			pathStack.length > 0 &&
			indent <= pathStack[pathStack.length - 1]!.indent
		) {
			pathStack.pop();
		}
		const path = [...pathStack.map((p) => p.key), key].join(".");

		if (path === "contract") {
			inContract = true;
			pathStack = [{ indent, key }];
			continue;
		}
		if (!inContract) continue;
		if (kv[2] !== undefined && kv[2] !== "") {
			// Hoja con valor: nos interera produces.meta.artifactKind.
			if (path === "contract.produces.meta.artifactKind") {
				return kv[2].trim().replace(/^['"]|['"]$/g, "");
			}
			continue;
		}
		pathStack.push({ indent, key });
	}
	return undefined;
}

/** Escanea los SKILL.md bajo <agentDir>/skills (un directorio por skill)
 * y devuelve skill ⇒ artifactKind. */
export function scanSkillContracts(agentDir: string): Record<string, string> {
	const dir = join(agentDir, "skills");
	const map: Record<string, string> = {};
	if (!existsSync(dir)) return map;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const skillMdPath = join(dir, entry.name, "SKILL.md");
		if (!existsSync(skillMdPath)) continue;
		try {
			const kind = extractContractArtifactKind(readFileSync(skillMdPath, "utf8"));
			if (kind) map[entry.name] = kind;
		} catch {
			/* skill ilegible: queda fuera del vocabulario, cae al default */
		}
	}
	return map;
}
