/**
 * frida-agent-browser — política de comandos / sesión (Fase 6).
 *
 * Porte enfocado de command-policy.js + runtime.js del referencia: decide qué comandos
 * son "sessionless" (locales/inspección) y por tanto NO deben vincular la sesión
 * implícita gestionada (--session), y cuáles son inspección de texto plano (sin --json).
 *
 * Comandos sessionless: skills list/get/path, auth save/list/show/delete/remove, plugin,
 * mcp, dashboard start/stop, device list, doctor, install, profiles, upgrade, session
 * list/info/id, state list/show/clear/clean/rename. (Browser-backed como auth login,
 * state save/load, open, click… sí vinculan sesión.)
 *
 * Se omite la validación profunda de value-flags del referencia (auth save --password*,
 * state clear --all, etc.): se cubre la intención (comando+subcomando local) sin la
 * gramática nicho, que el binario valida igualmente.
 */

const VALUE_FLAGS = new Set(["--session", "--namespace", "--session-name"]);

/** Primer token posicional (salta --session <val> y flags sueltos). */
export function firstPositional(args: string[]): string | undefined {
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

/** Segundo token posicional (el subcomando). */
function secondPositional(args: string[]): string | undefined {
	let i = 0;
	let seen = 0;
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
		seen += 1;
		if (seen === 2) return a;
		i++;
	}
	return undefined;
}

/** Comandos sessionless por sí mismos (sin requerir subcomando concreto). */
const SESSIONLESS_TOP = new Set([
	"mcp",
	"profiles",
	"upgrade",
	"doctor",
	"install",
]);

/** Comandos sessionless sólo para ciertos subcomandos. */
const SESSIONLESS_SUB: Record<string, Set<string>> = {
	skills: new Set(["list", "get", "path"]),
	auth: new Set(["save", "list", "show", "delete", "remove"]),
	plugin: new Set(["list", "show", "add", "run"]),
	dashboard: new Set(["start", "stop"]),
	session: new Set(["list", "info", "id"]),
	state: new Set(["list", "show", "clear", "clean", "rename"]),
	device: new Set(["list"]),
};

/** ¿Es un comando local/inspección que NO debe vincular la sesión gestionada? */
export function isSessionlessCommand(
	command: string | undefined,
	args: string[],
): boolean {
	if (!command) return false;
	if (SESSIONLESS_TOP.has(command)) return true;
	const subs = SESSIONLESS_SUB[command];
	if (!subs) return false;
	const sub = secondPositional(args);
	// Si no hay subcomando: sessionless sólo si el comando lo es sin sub (auth/plugin/dashboard
	// pueden usarse solos en modo status); para el resto (skills/state/session/device) se requiere sub.
	if (sub === undefined)
		return (
			command === "auth" || command === "plugin" || command === "dashboard"
		);
	return subs.has(sub);
}

/** Gemelo de needsManagedSession del referencia (true = vincular sesión). */
export function needsManagedSession(
	command: string | undefined,
	args: string[],
): boolean {
	return !isSessionlessCommand(command, args);
}

const GLOBAL_HELP_VERSION = new Set(["--help", "-h", "--version", "-V"]);

function hasGlobalHelpOrVersion(args: string[]): boolean {
	return args.some((a) => GLOBAL_HELP_VERSION.has(a));
}

/**
 * Inspección de texto plano: --help/-h/--version/-V globales (sin comando) → el binario
 * devuelve texto plano, NO JSON. El wrapper NO debe inyectar --json.
 */
export function isPlainTextInspection(args: string[]): boolean {
	return firstPositional(args) === undefined && hasGlobalHelpOrVersion(args);
}
