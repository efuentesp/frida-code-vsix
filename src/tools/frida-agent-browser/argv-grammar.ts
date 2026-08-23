/**
 * frida-agent-browser — gramática de argv global (mirror del binario 0.34.0).
 *
 * Subset fiel de argv-grammar.js + argv-descriptor.js del referencia
 * (pi-agent-browser-native 0.4.2+, "Mirror upstream 0.34.0 global parsing"):
 * lo mínimo para que `hasLaunchScopedFlag` replique los matices del contrato
 * del binario 0.34.0:
 *
 *  - Flags globales que consumen un payload en el token siguiente
 *    (`--profile Default open x` → el comando es `open`).
 *  - Booleanos globales con valor opcional (`--headed false open x`):
 *    semántica last-wins; sólo el `false` EXACTO deshabilita un flag presente.
 *  - `--pin-tab` / `--no-pin-tab` son booleanos globales sticky (NO
 *    launch-scoped): pueden rebindar el tab sobre una sesión viva.
 *
 * Simplificación documentada: no portamos `optionalGlobalValueFlagConsumesNext`
 * (`--restore` con clave opcional) ni el command-taxonomy completo. Para la
 * detección de launch-scoped es equivalente: el token `--restore` en sí ya
 * dispara launch-scoped, con o sin clave consumida (igual que upstream).
 */

/** Flags globales que consumen un valor (payload en el token siguiente). Mirror 0.34.0. */
export const GLOBAL_VALUE_FLAGS = new Set([
	"--session",
	"--namespace",
	"--cdp",
	"--config",
	"--profile",
	"--session-name",
	"--restore-save",
	"--restore-check-url",
	"--restore-check-text",
	"--restore-check-fn",
	"--proxy",
	"--proxy-bypass",
	"--headers",
	"--executable-path",
	"--extension",
	"--init-script",
	"--enable",
	"--provider",
	"-p",
	"--engine",
	"--state",
	"--download-path",
	"--screenshot-dir",
	"--screenshot-format",
	"--screenshot-quality",
	"--color-scheme",
	"--device",
	"--args",
	"--user-agent",
	"--allowed-domains",
	"--action-policy",
	"--confirm-actions",
	"--max-output",
	"--model",
	"--idle-timeout",
]);

/**
 * Booleanos globales con valor opcional (`--flag [true|false]`). Mirror 0.34.0.
 * Nota contract: `--pin-tab`/`--no-pin-tab` viven aquí — son sticky y por eso
 * NO son launch-scoped (activar/desactivar el pin sobre sesión viva es legal).
 */
export const GLOBAL_BOOLEAN_FLAGS_WITH_OPTIONAL_VALUES = new Set([
	"--allow-file-access",
	"--annotate",
	"--auto-connect",
	"--confirm-interactive",
	"--content-boundaries",
	"--debug",
	"--headed",
	"--hide-scrollbars",
	"--ignore-https-errors",
	"--json",
	"--no-auto-dialog",
	"--no-pin-tab",
	"--offline",
	"--pin-tab",
	"--quick",
	"--fix",
	"--quiet",
	"-q",
	"--verbose",
	"-v",
	"--webgpu",
]);

function isBooleanLiteral(token: string | undefined): boolean {
	const normalized = token?.trim().toLowerCase();
	return normalized === "true" || normalized === "false";
}

/**
 * Índice del primer token de comando (undefined si todo son flags). Mirror de
 * findCommandStartIndex del referencia: salta flags `=valor`, flags con payload
 * y booleanos seguidos de literal true/false.
 */
export function findCommandStartIndex(args: string[]): number | undefined {
	for (let i = 0; i < args.length; i++) {
		const token = args[i];
		if (
			token.startsWith("--session=") ||
			token.startsWith("--namespace=") ||
			token.startsWith("--restore=")
		) {
			continue;
		}
		if (token.startsWith("-")) {
			const normalized = token.split("=", 1)[0] ?? token;
			if (!token.includes("=") && GLOBAL_VALUE_FLAGS.has(normalized)) {
				i += 1; // salta el payload del flag de valor
			} else if (
				!token.includes("=") &&
				GLOBAL_BOOLEAN_FLAGS_WITH_OPTIONAL_VALUES.has(normalized) &&
				isBooleanLiteral(args[i + 1])
			) {
				i += 1; // salta el true/false explícito del booleano
			}
			continue;
		}
		return i;
	}
	return undefined;
}

/**
 * Valor booleano (last-wins) de un flag en argv. Mirror de getBooleanFlagValue:
 * sólo el `false` EXACTO en el token siguiente deshabilita; `true`/`false`
 * explícitos se consumen como valor del flag. Formas `=` no cuentan (igual que
 * el referencia, que escanea tokens exactos).
 */
export function getBooleanFlagValue(
	args: string[],
	flag: string,
): boolean | undefined {
	let enabled: boolean | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === flag) {
			enabled = args[i + 1] !== "false";
			if (args[i + 1] === "true" || args[i + 1] === "false") i += 1;
		}
	}
	return enabled;
}

/** ¿El flag booleano está habilitado (presente y no deshabilitado por `false`)? */
export function isBooleanFlagEnabled(args: string[], flag: string): boolean {
	return getBooleanFlagValue(args, flag) ?? false;
}
