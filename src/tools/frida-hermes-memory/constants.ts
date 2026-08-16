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
 * --legacy-peer-deps: pi-ai (StringEnum), pi-ai/compat (completeSimple, la
 * llamada LLM del background learning), pi-coding-agent (keyHint) y pi-tui
 * (Text, truncateToWidth… — imports de VALOR del upstream). Apuntan a la
 * copia del SDK que frida ya shipea en su VSIX — misma versión que el
 * runtime embebido, cero duplicación. pi-ai y pi-tui suelen vivir NESTED
 * bajo pi-coding-agent (así lo instala npm al ser dependencias transitivas),
 * pero si una instalación futura las hoistea al top-level, caen al fallback
 * (misma lógica que esbuild.js con su nodePaths).
 *
 * SUBPATHS EXACTOS (Refs #21, hallazgo e2e): una vez que el upstream toca
 * pi-coding-agent (alias → SDK dist/index.js), TODO el SDK dist se carga
 * BAJO jiti y sus requires internos pasan por este map. jiti hace
 * PREFIX-match de las keys: la key "@earendil-works/pi-ai" + specifier
 * "…/pi-ai/oauth" → dist/index.js/oauth → "Cannot find module". Por eso cada
 * subpath que el SDK dist requiere (oauth, providers/all, bedrock-provider,
 * bun-oauth) necesita su key EXACTA — mismo patrón que typebox en
 * frida-knowledge-base. El test de contrato (wrapper.test.ts) escanea el SDK
 * dist real y exige alias para cada specifier: si un bump del SDK añade un
 * subpath nuevo, el test se pone rojo ANTES que el usuario.
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
	const scopeRoot = existsSync(path.join(nested, "pi-ai"))
		? nested
		: topLevel;
	const piAi = (sub: string) =>
		path.join(scopeRoot, "pi-ai", "dist", sub);
	return {
		"@earendil-works/pi-ai": piAi("index.js"),
		"@earendil-works/pi-ai/compat": piAi("compat.js"),
		"@earendil-works/pi-ai/oauth": piAi("oauth.js"),
		"@earendil-works/pi-ai/providers/all": piAi(path.join("providers", "all.js")),
		"@earendil-works/pi-ai/bedrock-provider": piAi("bedrock-provider.js"),
		"@earendil-works/pi-ai/bun-oauth": piAi("bun-oauth.js"),
		"@earendil-works/pi-coding-agent": path.join(
			topLevel,
			"pi-coding-agent",
			"dist",
			"index.js",
		),
		"@earendil-works/pi-tui": path.join(scopeRoot, "pi-tui", "dist", "index.js"),
	};
}
