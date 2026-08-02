// frida-multi-skills — Expansión de `$skill_name` → bloque `<skill>`.
//
// Porte de la expansión de `pi-multi-skills` (MIT, QuangThai), adaptado a la
// arquitectura de Frida: reutiliza el índice de skills de frida-args
// (`getSkillIndex`, que lee `pi.getCommands()`) en vez de reconstruirlo, y
// emite el MISMO formato de bloque que `/skill:xxx` nativo + frida-args
// (`buildSkillBlock`), así el modelo y el webview lo procesan idéntico.
//
// Esta función es la ÚNICA fuente de verdad de la expansión. La llama:
//   1. El hook `input` de frida-multi-skills (salvavidas: texto que no viene
//      del host, p.ej. sesiones hijas o prompts programáticos).
//   2. `runPrompt` en el host (para mostrar el bloque `<skill>` en vivo en el
//      webview — paridad display ↔ modelo, igual que ya hace `/skill:`).
//
// Formato del bloque:
//   - 1 skill  → idéntico a buildSkillBlock de frida-args.
//   - N skills → UN bloque merger `name="a, b"` (paridad con pi-multi-skills y
//     con el parseSkillBlock non-greedy de Pi, que sólo atrapa el primer
//     bloque). El `location`/dir es el del PRIMERO.

import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import {
	buildSkillBlock,
	getSkillIndex,
	type SkillIndexEntry,
} from "../frida-args";
import { parseSkillRefs, replaceSkillRefs } from "./parser";

export interface ExpandMultiSkillDeps {
	/** ExtensionAPI de Pi: `getSkillIndex(pi)` resuelve el nombre → entrada. */
	pi: ExtensionAPI;
	/** ID de la sesión (homogeneidad con expandSkillText de frida-args; hoy sin
	 *  uso directo en `$skill`, que no sustituye variables). */
	sessionId: string;
	/** cwd del workspace (reservado para futuras sustituciones; hoy sin uso). */
	cwd: string;
}

/** Resultado de la expansión. `null` desde el caller indica "no había
 *  `$skill` → comportamiento por defecto" (texto crudo). */
export interface ExpandMultiSkillResult {
	/** Texto final que recibe el modelo y ve el webview:
	 *  `<skill>...</skill>\n\n<texto del usuario sin $>`. */
	transformed: string;
	/** Skills referenciadas que NO se encontraron en el índice (para que el
	 *  host/hook emita un aviso; se omiten del bloque). */
	unresolved: string[];
}

/**
 * Expande referencias `$skill_name` inline al bloque `<skill>` completo.
 *
 * Devuelve `null` cuando el texto no contiene ninguna referencia `$skill`
 * → el llamador cae al comportamiento por defecto (texto crudo). Nunca lanza:
 * si una skill no se encuentra o no se puede leer su archivo, se omite del
 * bloque (y se reporta en `unresolved`).
 */
export async function expandMultiSkillText(
	text: string,
	deps: ExpandMultiSkillDeps,
): Promise<ExpandMultiSkillResult | null> {
	// Pre-filtro barato: sin `$` no hay nada que hacer.
	if (!text.includes("$")) return null;

	const refs = parseSkillRefs(text);
	if (refs.length === 0) return null;

	const index = getSkillIndex(deps.pi);

	const resolvedEntries: SkillIndexEntry[] = [];
	const unresolved: string[] = [];
	for (const ref of refs) {
		const entry = index.get(ref.name);
		if (entry) resolvedEntries.push(entry);
		else unresolved.push(ref.name);
	}
	if (resolvedEntries.length === 0) return null;

	// Leer el cuerpo de cada skill (stripFrontmatter + trim). Las que fallen de
	// lectura se descartan silenciosamente (igual que pi-multi-skills).
	const loaded: Array<{ entry: SkillIndexEntry; body: string }> = [];
	for (const entry of resolvedEntries) {
		try {
			const content = readFileSync(entry.filePath, "utf-8");
			loaded.push({ entry, body: stripFrontmatter(content).trim() });
		} catch {
			// Lectura fallida → se omite esta skill (no se reporta como unresolved:
			// sí existe en el índice, sólo no se pudo leer ahora).
		}
	}
	if (loaded.length === 0) return null;

	// Reemplazar `$name` → `name` (sin $) en el texto del usuario para que el
	// mensaje quede legible: "Aplica $code-review" → "Aplica code-review".
	let userText = replaceSkillRefs(
		text,
		loaded.map((l) => ({ name: l.entry.name, marker: l.entry.name })),
	)
		.replace(/\s{2,}/g, " ")
		.trim();

	// Caso standalone puro: si el texto se redujo a SOLO nombres de skills
	// resueltas (p.ej. "$code-review" o "$a $b"), omitirlo. Si no, el/los nombre(s)
	// quedarían como texto tras </skill> y el protocolo de invocación de skills
	// (frida-args) los trataría como ARGUMENTO espurio de la skill. "Aplica
	// $code-review" → "Aplica code-review" se preserva (hay texto real además).
	// Divergencia intencional sobre pi-multi-skills (que deja el nombre suelto).
	const resolvedNames = new Set(loaded.map((l) => l.entry.name));
	const words = userText.split(/\s+/).filter(Boolean);
	if (words.length > 0 && words.every((w) => resolvedNames.has(w))) {
		userText = "";
	}

	// Construir el bloque <skill>.
	let skillBlock: string;
	if (loaded.length === 1) {
		// Ruta de 1 skill: idéntica a frida-args (reutiliza buildSkillBlock).
		const { entry, body } = loaded[0];
		skillBlock = buildSkillBlock(entry, body);
	} else {
		// Ruta de N skills: UN bloque merger (paridad con pi-multi-skills y con
		// parseSkillBlock non-greedy). El location/dir es del primero.
		const allNames = loaded.map((l) => l.entry.name).join(", ");
		const first = loaded[0].entry;
		const mergedBody = loaded
			.map((l) => `## ${l.entry.name}\n\n${l.body}`)
			.join("\n\n---\n\n");
		skillBlock =
			`<skill name="${allNames}" location="${first.filePath}">\n` +
			`References are relative to ${first.baseDir}.\n\n` +
			`${mergedBody}\n` +
			`</skill>`;
	}

	const transformed = userText ? `${skillBlock}\n\n${userText}` : skillBlock;

	return { transformed, unresolved };
}
