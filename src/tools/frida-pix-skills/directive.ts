// frida-pix-skills — Parser de directivas `` !`cmd` `` (parte pura).
//
// Porte de la parte pura de @xynogen/pix-skills/src/directive.ts. Sin
// dependencias de pi-tui / pix-runtime / pix-gate: sólo regex y strings. La
// política de bloqueo (directiveBlockReason) vive en gate.ts (mapeo a
// frida-permission-system) para evitar una dependencia circular y mantener este
// módulo 100% testeable sin el gate.
//
// Una directiva `` !`cmd` `` embebe la salida de un comando en la skill al
// cargarla (full=true). El escape `` \!`cmd` `` se deja literal (para docs).

export interface CommandDirective {
	start: number;
	end: number;
	command: string;
}

// !`...` no precedido por backslash; el comando es de una sola línea, sin backticks.
const DIRECTIVE_RE = /(^|[^\\])!`([^`\n]+)`/g;

/** Localiza todas las directivas `` !`cmd` `` con sus spans (escapa `` \!`…` ``). */
export function findCommandDirectives(content: string): CommandDirective[] {
	const hits: CommandDirective[] = [];
	for (const m of content.matchAll(DIRECTIVE_RE)) {
		const lead = m[1] ?? "";
		const start = (m.index ?? 0) + lead.length; // salta el char capturado como lead
		hits.push({
			start,
			end: start + m[0].length - lead.length,
			command: m[2]?.trim() ?? "",
		});
	}
	return hits;
}

/** Reemplaza el slice [start, end) de `s` con `text`. */
export function replaceSpan(
	s: string,
	start: number,
	end: number,
	text: string,
): string {
	return s.slice(0, start) + text + s.slice(end);
}

const SHELL_META_RE = /[;|&$`><(){}\n]/;

/** true si el comando contiene metacaracteres de shell (encadenamiento/expansión). */
export function hasShellMeta(command: string): boolean {
	return SHELL_META_RE.test(command);
}

/** Tokenizador argv minimal: split por whitespace con soporte de comillas. */
export function tokenizeCommand(command: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const m of command.matchAll(re)) {
		out.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	return out;
}
