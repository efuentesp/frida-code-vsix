/**
 * frida-agent-browser — stale-ref guard (Fase 2).
 *
 * Porte del guard de refs de session-page-state.js + orchestration/browser-run del
 * referencia: **rehúsa argv de mutación con `@e…` ANTES del spawn** cuando la página
 * activa ya no coincide con el snapshot (navegación/drift) o el ref no estaba en el
 * último snapshot. Así se evita el fallo silencioso más peligroso: hacer click en un
 * `@ref` reciclado/inválido sin darse cuenta (misclick silencioso).
 *
 * Reglas (réplica del contrato del referencia):
 *  - sin refSnapshot (sin snapshot previo) → ALLOW (no hay con qué validar; primer uso).
 *  - refsStale (navegó/drifteó desde el último snapshot) → REFUSE (stale-ref).
 *  - ref no presente en el snapshot → REFUSE (stale-ref).
 *  - resto → ALLOW.
 *
 * Sólo aplica a @ref TOP-LEVEL en comandos de mutación/interacción (no a batch stdin,
 * cuyo guard interno entre pasos queda para un refinamiento posterior).
 */

/** Comandos que actúan sobre un elemento (mutation/interaction). */
export const MUTATION_COMMANDS = new Set([
	"click",
	"fill",
	"select",
	"check",
	"uncheck",
	"type",
	"press",
	"keyboard",
	"tap",
	"swipe",
	"drag",
	"hover",
	"focus",
	"setvalue",
]);

/** Comandos que cambian la página/URL (invalidan los refs del snapshot). */
export const NAVIGATE_COMMANDS = new Set([
	"open",
	"goto",
	"navigate",
	"pushstate",
	"back",
	"forward",
]);

/** Comandos que cierran el browser (invalidan TODO el estado de refs). */
export const CLOSE_COMMANDS = new Set(["close", "quit", "exit"]);

const REF_RE = /^@e\d+\b/;
const VALUE_FLAGS = new Set(["--session", "--namespace", "--session-name"]);

/** Normaliza "@e1" → "e1" (los keys de data.refs del binario no llevan @). */
export function normalizeRef(token: string): string {
	return token.replace(/^@/, "");
}

/** Primer token posicional (salta --session <val> y flags sueltos). */
function firstPositional(args: string[]): string | undefined {
	let i = 0;
	while (i < args.length) {
		const a = args[i];
		if (a === "--json") {
			i++;
			continue;
		}
		if (VALUE_FLAGS.has(a)) {
			i += 2;
			continue;
		}
		if (a.startsWith("-")) {
			i++;
			continue;
		}
		return a;
	}
	return undefined;
}

/** ¿Es un comando de mutación/interacción? */
export function isMutationCommand(args: string[]): boolean {
	const cmd = firstPositional(args);
	return cmd !== undefined && MUTATION_COMMANDS.has(cmd);
}

/** Primer token `@eN` presente en argv (normalizado a "eN"), o undefined. */
export function findRefToken(args: string[]): string | undefined {
	for (const a of args) {
		if (REF_RE.test(a)) return normalizeRef(a);
	}
	return undefined;
}

/** ¿Lleva un @ref Y es un comando de mutación? (sujeto al guard) */
export function isRefMutation(args: string[]): boolean {
	return isMutationCommand(args) && findRefToken(args) !== undefined;
}

/** ¿Es un comando de navegación (invalida refs)? */
export function isNavigateCommand(args: string[]): boolean {
	const cmd = firstPositional(args);
	return cmd !== undefined && NAVIGATE_COMMANDS.has(cmd);
}

/** ¿Es un comando de cierre (limpia estado de refs)? */
export function isCloseCommand(args: string[]): boolean {
	const cmd = firstPositional(args);
	return cmd !== undefined && CLOSE_COMMANDS.has(cmd);
}

export interface RefSnapshotState {
	origin: string;
	refs: Set<string>;
}
export interface GuardState {
	refSnapshot: RefSnapshotState | null;
	stale: boolean;
}

export type GuardResult =
	| { ok: true }
	| { ok: false; reason: string; ref: string };

/**
 * Evalúa el guard para un argv de mutación con @ref.
 * Llamar sólo cuando `isRefMutation(args)` sea true.
 */
export function guardRefMutation(
	state: GuardState,
	args: string[],
): GuardResult {
	const ref = findRefToken(args)!;
	if (!state.refSnapshot) return { ok: true }; // sin snapshot → no hay con qué validar.
	if (state.stale) {
		return {
			ok: false,
			ref,
			reason: `@${ref} may be stale: the page navigated or changed since the last snapshot. Run snapshot -i to refresh refs before retrying.`,
		};
	}
	if (!state.refSnapshot.refs.has(ref)) {
		return {
			ok: false,
			ref,
			reason: `@${ref} was not in the last snapshot. Run snapshot -i to get current @refs, or use a semantic locator (role/text/label) instead.`,
		};
	}
	return { ok: true };
}
