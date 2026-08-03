// Detección ligera de indirección/encadenamiento en bash (Prioridad 3).
//
// gotgenes parsea bash con tree-sitter y descompone cada sub-comando; aquí NO
// queremos meter nativos/WASM en el .vsix (ADR-0002/D12), así que hacemos una
// detección con regex sobre el string del comando. El objetivo es DISUASIVO:
// un comando compuesto (`git status && rm -rf dist`) o con wrapper (`sudo …`,
// `bash -c …`, `eval …`) se marca para que SIEMPRE pida confirmación, incluso
// en modo `auto` — porque ahí el usuario no está mirando y un sub-comando
// peligroso podría colarse amparado por uno benigno.
//
// Trade-off honesto: esta detección es por "contains", así que puede dar falsos
// positivos (un `|` o `;` dentro de un string, p. ej. `grep "a|b"`). En modo
// disuasivo eso solo significa "pedir confirmación" (no bloquear), así que es
// aceptable: mejor pedir de más que dejar colar un wrapper.

export interface IndirectionCheck {
	/** true si el comando es compuesto o usa un wrapper → forzar ask. */
	detected: boolean;
	/** Motivo legible para el warning de la UI. */
	reason?: string;
}

// Wrappers/prefijos que ocultan o indirectan el comando real a gatear. Con
// límites de palabra para no pescar `environ` o `commands` como subcadenas.
// `env ` lleva espacio para no pescar `environment`.
const WRAPPERS: RegExp[] = [
	// Shells con -c (o flags combinadas tipo -lc / -cx): bash -c, sh -lc, zsh -cx.
	// \w* a ambos lados de la `c` cubre flags combinadas sin exigir -c aislada.
	/\b(?:bash|sh|zsh|dash|ksh|fish)\s+-\w*c\w*/,
	// Elevación / ejecución indirecta.
	/\bsudo\b/,
	/\beval\b/,
	/\bexec\b/,
	/\bxargs\b/,
	/\bsource\b/,
	/\bnohup\b/,
	// \bcommand\b es ruidoso (aparece en texto normal), lo dejamos fuera.
	/\benv\s/, // `env VAR=x cmd` o `env cmd`
];

// Operadores de encadenamiento/control de flujo del shell.
const CHAINING = /(&&|\|\||;|\||&(?!\w)|\n|\r|\bthen\b|\bdo\b|\bdone\b|\bfi\b)/;

/**
 * Decide si un comando bash es compuesto o usa un wrapper → forzar ask.
 *
 * @param raw comando tal como viene en event.input.command (puede ser undefined).
 */
export function hasShellIndirection(
	raw: string | undefined | null,
): IndirectionCheck {
	if (!raw || typeof raw !== "string") return { detected: false };

	const command = raw.trim();
	if (!command) return { detected: false };

	// 1) Wrapper/indirección: sudo, bash -c, eval, exec, xargs, source, nohup, env…
	for (const wrapper of WRAPPERS) {
		if (wrapper.test(command)) {
			return {
				detected: true,
				reason:
					"Comando con wrapper (sudo/eval/bash -c/…). La aprobación cubre TODO lo que ese wrapper ejecute; revísalo entero antes de aceptar.",
			};
		}
	}

	// 2) Encadenamiento: && || ; | & o saltos de línea (varios comandos unidos).
	//    Forzamos ask (detected) pero SIN mensaje: casi todos los comandos del
	//    agente son compuestos, así que el aviso era ruido omnipresente que ya no
	//    aportaba valor. La confirmación sigue protegiendo en modo auto.
	if (CHAINING.test(command)) {
		return { detected: true };
	}

	return { detected: false };
}
