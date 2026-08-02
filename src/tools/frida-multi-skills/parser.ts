// frida-multi-skills — Parser de referencias `$skill_name`.
//
// Porte del parser de `pi-multi-skills` (MIT, QuangThai). Extrae referencias
// inline a skills desde el texto del usuario para que frida-multi-skills las
// expanda a un bloque `<skill>` (mismo formato que `/skill:xxx` nativo).
//
// Soporta:
//   - $skill_name (standalone o embebida: "Aplica $code-review a esto")
//   - Multi-skill: "Corre $skillA y luego $skillB"
//   - Escape: \$skill_name → $ literal (no se resuelve)
//
// Convención de mayúsculas: las skills son minúsculas por convención de Pi /
// Agent Skills, así que el regex exige minúscula inicial y deja tranquilas a
// las variables de shell mayúsculas ($PATH, $HOME) y a los tokens de
// frida-args ($ARGUMENTS, $SESSION_ID, ${SKILL_DIR}).

/** Regex para referencias `$skill_name`.
 *
 *  - `(?<!\\)` — no precedida por `\` (escape `\$`).
 *  - `\$` — el dólar.
 *  - `[a-z]` — primera letra minúscula (convención de skills; descarta $PATH).
 *  - `[a-z0-9_-]*` — resto del nombre.
 *  - `(?![A-Za-z0-9_-])` — no seguida de más caracteres de nombre (evita que
 *    `$code` coincida dentro de `$code-review`).
 */
const SKILL_REF_RE = /(?<!\\)\$([a-z][a-z0-9_-]*)(?![A-Za-z0-9_-])/g;

export interface ParsedRef {
	raw: string; // Match completo con $, p.ej. "$skillA"
	name: string; // Nombre sin $, p.ej. "skillA" (lowercase)
	index: number; // Posición en el texto original
}

/** Escapa caracteres especiales de regex en un string. */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parsea todas las referencias `$skill_name` del texto.
 * Devuelve una lista deduplicada conservando el orden de primera aparición.
 */
export function parseSkillRefs(text: string): ParsedRef[] {
	const refs: ParsedRef[] = [];

	SKILL_REF_RE.lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = SKILL_REF_RE.exec(text)) !== null) {
		refs.push({
			raw: match[0],
			name: match[1].toLowerCase(),
			index: match.index,
		});
	}

	// Deduplicar por nombre conservando el orden
	const seen = new Set<string>();
	return refs.filter((ref) => {
		if (seen.has(ref.name)) return false;
		seen.add(ref.name);
		return true;
	});
}

/** Entrada de reemplazo para `replaceSkillRefs`. */
export interface SkillReplacement {
	name: string;
	marker: string;
}

/**
 * Reemplaza referencias `$skill_name` por markers.
 *
 * Se ordena por longitud de nombre descendente para que los nombres más largos
 * (p.ej. "code-review") se reemplacen antes que los más cortos (p.ej. "code")
 * y evitar coincidencias parciales.
 */
export function replaceSkillRefs(
	text: string,
	replacements: SkillReplacement[],
): string {
	const sorted = [...replacements].sort(
		(a, b) => b.name.length - a.name.length,
	);

	let result = text;
	for (const { name, marker } of sorted) {
		result = result.replace(
			new RegExp(`(?<!\\\\)\\$${escapeRegex(name)}(?![A-Za-z0-9_-])`, "g"),
			marker,
		);
	}
	// Limpiar cualquier `$` escapado que haya quedado (\$ → $)
	result = result.replace(/\\\$/g, "$");
	return result;
}

/** Chequeo rápido: ¿el texto contiene alguna referencia `$skill`? */
export function hasSkillRefs(text: string): boolean {
	SKILL_REF_RE.lastIndex = 0;
	return SKILL_REF_RE.test(text);
}
