/**
 * frida-knowledge-base — constantes (issue #29, ADR-0040).
 *
 * Wrapper del paquete upstream @zosmaai/pi-llm-wiki (MIT): Frida lo instala
 * on-demand en ~/.frida/npm (patrón frida-codebase-index / frida-hermes-memory)
 * y corre su factory passthrough contra el ExtensionAPI real — la KB OKF v0.2
 * necesita los hooks del lifecycle (before_agent_start = recall layering,
 * guardrails sobre wiki/**) y sus 11 tools wiki_*.
 *
 * La capa HUMANA (grafo, backlinks, plantillas) la provee Foam como
 * extensionDependencies del VSIX (ADR-0040 D3) — no este módulo.
 *
 * Única fuente de verdad del pin, paths, aliases y factory name.
 */
import * as path from "node:path";

/** Paquete upstream y pin EXACTO (upstream muy activo: subir versión es deliberado). */
const KNOWLEDGE_BASE_PACKAGE = "@zosmaai/pi-llm-wiki";
export const KNOWLEDGE_BASE_PIN = "0.11.4";
export const KNOWLEDGE_BASE_SPEC = `${KNOWLEDGE_BASE_PACKAGE}@${KNOWLEDGE_BASE_PIN}`;

/**
 * Entry de la extensión Pi del paquete. Fuente: manifest del paquete npm
 * (`package.json` → `"pi": { "extensions": ["./extensions"] }` → el loader
 * resuelve extensions/llm-wiki/index.ts). Es TS fuente, cargamos vía jiti.
 * Los 12 comandos /wiki-* viven en prompts/*.md (los carga el package loader
 * de pi, NO la factory) → frida-knowledge-base los registra desde la factory
 * (F1). Verificar contra el manifest en cada bump de pin.
 */
const KNOWLEDGE_BASE_PI_ENTRY = path.join("extensions", "llm-wiki", "index.ts");

/** Path absoluto del entry dentro del agentDir de Frida (~/.frida/npm/node_modules/...). */
export function upstreamEntryPath(agentDir: string): string {
 return path.join(
  agentDir,
  "npm",
  "node_modules",
  KNOWLEDGE_BASE_PACKAGE,
  KNOWLEDGE_BASE_PI_ENTRY,
 );
}

/** Versión instalada del paquete en ~/.frida/npm (lee su package.json). */
export function installedVersionPath(agentDir: string): string {
 return path.join(
  agentDir,
  "npm",
  "node_modules",
  KNOWLEDGE_BASE_PACKAGE,
  "package.json",
 );
}

/** Nombre de la factory embebida en extensionFactories (src/pi-session.ts). */
export const KNOWLEDGE_BASE_FACTORY_NAME = "frida-knowledge-base";

/**
 * Aliases de jiti para los peer-deps del upstream que NO se instalan con
 * --legacy-peer-deps (peerDependencies: @mariozechner/pi-coding-agent y
 * typebox — typebox solo está en peer+dev, es un runtime-dep fantasma):
 *
 * - `@mariozechner/pi-coding-agent`: el SDK se renombró a
 *   @earendil-works/pi-coding-agent; los 2 imports de VALOR del upstream
 *   (getAgentDir, isToolCallEventType) existen en nuestra copia (verificado
 *   contra 0.84.2). Los otros peers (@mariozechner/pi-ai,
 *   @mariozechner/pi-agent-core) son imports type-only → borrados por jiti,
 *   no necesitan alias.
 * - `typebox`: copia top-level que frida ya shipea (1.1.38 ≥ ^1.1.34) —
 *   alias por subpath EXACTO porque el SDK dist que cargamos vía jiti
 *   importa typebox, typebox/compile y typebox/value (alias a archivo
 *   único rompe los subpaths: <archivo>/compile no existe).
 *
 * Apuntan a la copia que frida shipea en su VSIX: misma versión que el
 * runtime embebido, cero duplicación.
 */
export function upstreamPeerAliases(distDir: string): Record<string, string> {
 // distDir = directorio del bundle de frida (dist/) → node_modules es hermano.
 const root = path.dirname(path.resolve(distDir));
 const tb = path.join(root, "node_modules", "typebox", "build");
 return {
  "@mariozechner/pi-coding-agent": path.join(
   root,
   "node_modules",
   "@earendil-works",
   "pi-coding-agent",
   "dist",
   "index.js",
  ),
  typebox: path.join(tb, "index.mjs"),
  "typebox/compile": path.join(tb, "compile", "index.mjs"),
  "typebox/value": path.join(tb, "value", "index.mjs"),
 };
}
