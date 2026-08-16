/**
 * frida-hermes-memory — constantes (issue #21, ADR-0032).
 *
 * Wrapper del paquete upstream pi-hermes-memory (MIT, chandra447): Frida lo
 * instala on-demand en ~/.frida/npm (patrón frida-codebase-index, ADR-0036)
 * y corre su factory passthrough contra el ExtensionAPI real — a diferencia
 * de codebase-index NO capturamos/re-registramos: el learning loop del
 * upstream (tools + hooks del lifecycle + /memory-* commands) se registra
 * completo (ADR-0032 D1: extensión nativa, no workflow).
 *
 * Única fuente de verdad del pin, paths y factory name.
 */
import * as path from "node:path";
import { existsSync } from "node:fs";

/** Paquete upstream y pin EXACTO (upstream muy activo: subir versión es deliberado). */
const HERMES_MEMORY_PACKAGE = "pi-hermes-memory";
export const HERMES_MEMORY_PIN = "0.9.5";
export const HERMES_MEMORY_SPEC = `${HERMES_MEMORY_PACKAGE}@${HERMES_MEMORY_PIN}`;

/**
 * Entry de la extensión Pi del paquete. Fuente: manifest del paquete npm
 * (`package.json` → `"pi": { "extensions": ["./src/index.ts"] }`, `main` igual
 * — el upstream distribuye TypeScript fuente y pi lo carga vía jiti). Es TS,
 * NO un dist JS: por eso cargamos con jiti (no import() nativo).
 * Verificar contra el manifest en cada bump de pin.
 */
const HERMES_MEMORY_PI_ENTRY = path.join("src", "index.ts");

/** Path absoluto del entry dentro del agentDir de Frida (~/.frida/npm/node_modules/...). */
export function upstreamEntryPath(agentDir: string): string {
	return path.join(
		agentDir,
		"npm",
		"node_modules",
		HERMES_MEMORY_PACKAGE,
		HERMES_MEMORY_PI_ENTRY,
	);
}

/** Versión instalada del paquete en ~/.frida/npm (lee su package.json). */
export function installedVersionPath(agentDir: string): string {
	return path.join(
		agentDir,
		"npm",
		"node_modules",
		HERMES_MEMORY_PACKAGE,
		"package.json",
	);
}

/** Nombre de la factory embebida en extensionFactories (src/pi-session.ts). */
export const HERMES_MEMORY_FACTORY_NAME = "frida-hermes-memory";

/** Config del upstream: ~/.frida/hermes-memory-config.json (AGENT_ROOT del paquete;
 *  documentado en docs/tools/frida-hermes-memory.md — el wrapper aún no la
 *  materializa: los defaults del upstream ya son los del MVP). */

/**
 * Aliases de jiti para los peer-deps del upstream que NO se instalan con
 * --legacy-peer-deps: pi-ai (StringEnum) y pi-ai/compat (completeSimple, la
 * llamada LLM del background learning) y pi-coding-agent (keyHint). Apuntan a
 * la copia del SDK que frida ya shipea en su VSIX — misma versión que el
 * runtime embebido, cero duplicación. pi-ai suele vivir NESTED bajo
 * pi-coding-agent (así lo instala npm al ser dependencia transitiva), pero si
 * una instalación futura la hoistea al top-level, cae al fallback (misma
 * lógica que esbuild.js con su nodePaths).
 */
export function upstreamPeerAliases(distDir: string): Record<string, string> {
	// distDir = directorio del bundle de frida (dist/) → node_modules es hermano.
	const root = path.dirname(path.resolve(distDir));
	const topLevel = path.join(root, "node_modules", "@earendil-works");
	const nested = path.join(
		topLevel,
		"pi-coding-agent",
		"node_modules",
		"@earendil-works",
	);
	const piAiRoot = existsSync(path.join(nested, "pi-ai")) ? nested : topLevel;
	return {
		"@earendil-works/pi-ai": path.join(piAiRoot, "pi-ai", "dist", "index.js"),
		"@earendil-works/pi-ai/compat": path.join(
			piAiRoot,
			"pi-ai",
			"dist",
			"compat.js",
		),
		"@earendil-works/pi-coding-agent": path.join(
			topLevel,
			"pi-coding-agent",
			"dist",
			"index.js",
		),
	};
}
