/**
 * frida-codebase-index — constantes (issue #25, ADR-0036).
 *
 * Wrapper fino del paquete upstream open-codebase-index (MIT): Frida lo instala
 * on-demand en ~/.frida/npm, importa su extensión Pi vía import() nativo
 * (patrón frida-lens, src/pi-session.ts) y re-registra SOLO el subconjunto
 * de tools elegido con nombres Frida (ADR-0036 D1). Única fuente de verdad del
 * pin, paths y mapping.
 */
import * as path from "node:path";

/** Paquete upstream y pin EXACTO (releases diarios: subir versión es deliberado). */
export const CODEBASE_INDEX_PACKAGE = "open-codebase-index";
export const CODEBASE_INDEX_PIN = "0.23.0";
export const CODEBASE_INDEX_SPEC = `${CODEBASE_INDEX_PACKAGE}@${CODEBASE_INDEX_PIN}`;

/**
 * Entry de la extensión Pi del paquete. Fuente: manifest del tarball npm 0.23.0
 * (`package/package.json` → `"pi": { "extensions": ["./dist/pi-extension.js"] }`,
 * verificado contra el tarball — NO es el `main` dist/index.js de OpenCode/CLI;
 * research §I). Verificar contra el manifest en cada bump de pin.
 */
export const CODEBASE_INDEX_PI_ENTRY = path.join("dist", "pi-extension.js");

/** Path absoluto del entry dentro del agentDir de Frida (~/.frida/npm/node_modules/...). */
export function upstreamEntryPath(agentDir: string): string {
  return path.join(
    agentDir,
    "npm",
    "node_modules",
    CODEBASE_INDEX_PACKAGE,
    CODEBASE_INDEX_PI_ENTRY,
  );
}

/** Directorio de natives del paquete (package/native/*.node). */
export function upstreamNativeDir(agentDir: string): string {
  return path.join(
    agentDir,
    "npm",
    "node_modules",
    CODEBASE_INDEX_PACKAGE,
    "native",
  );
}

/** Natives bundled del paquete (research §C) y su mapa plataforma→archivo.
 *  OJO: win32-x64 es "-msvc" y linux es "-gnu" — los sufijos NO son derivables
 *  uniformemente, por eso el mapa explícito (la versión con endsWith rompía
 *  win32-x64 — corregido tras slice-verifier). */
const PLATFORM_NATIVE: Readonly<Record<string, string>> = {
  "darwin-arm64": "codebase-index-native.darwin-arm64.node",
  "darwin-x64": "codebase-index-native.darwin-x64.node",
  "linux-arm64": "codebase-index-native.linux-arm64-gnu.node",
  "linux-x64": "codebase-index-native.linux-x64-gnu.node",
  "win32-x64": "codebase-index-native.win32-x64-msvc.node",
};

/** Todos los natives bundled (para la poda del installer). */
export const BUNDLED_NATIVES = Object.freeze([
  ...new Set(Object.values(PLATFORM_NATIVE)),
]);

/** Native de la plataforma indicada (default: la actual). undefined si no hay
 *  prebuild (p.ej. linux-musl) → el caller degrada con guía accionable. */
export function currentPlatformNative(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  return PLATFORM_NATIVE[`${platform}-${arch}`];
}

/**
 * Mapping de tools Frida → upstream (ADR-0036 D1 + decisión "6 tools MVP+").
 * call_graph absorbe call_graph_path vía parámetro mode:"path".
 */
export const FRIDA_TO_UPSTREAM_TOOLS: Readonly<Record<string, string>> = {
  semantic_context: "codebase_context",
  semantic_search: "codebase_search",
  call_graph: "call_graph",
  implementation_lookup: "implementation_lookup",
  index_codebase: "index_codebase",
  index_status: "index_status",
};

/** Nombre de la factory embebida en extensionFactories (src/pi-session.ts). */
export const CODEBASE_INDEX_FACTORY_NAME = "frida-codebase-index";

/** Storage del upstream dentro del repo (research §D) — se gitignora automático. */
export const CODEBASE_INDEX_STORAGE_DIR = ".codebase-index";
