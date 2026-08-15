/**
 * frida-codebase-index — shim ExtensionAPI para capturar las tools del upstream
 * (issue #25, ADR-0036, D1 "wrapper fino").
 *
 * La extensión Pi del upstream (dist/pi-extension.js) es una factory estándar
 * `(pi: ExtensionAPI) => ...` que registra sus 16 tools vía pi.registerTool. En
 * vez de dejar que el resourceLoader las registre TODAS con nombres upstream,
 * Frida corre la factory contra ESTE shim: captura las tools en un Map y absorbe
 * el resto del contrato (registerCommand/on/setSessionName) como no-ops
 * loggeados. El wrapper (index.ts) re-registra solo el subconjunto elegido con
 * nombres Frida.
 *
 * NOTA jiti: NO cargamos el paquete vía jiti (bug de import.meta.url en ESM,
 * src/pi-session.ts) — usamos import() nativo al entry absoluto vía
 * pathToFileURL (patrón frida-lens + sdk-passthrough.test.ts). Los accesos a
 * keys del API no implementadas se loggean (Proxy get-trap) para diagnosticar
 * en el PoC qué contrato extra usa el upstream, y devuelven undefined.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { CODEBASE_INDEX_SPEC } from "./constants";

/** Tool capturado del upstream (passthrough del objeto registrado).
 *  execute usa la convención del SDK: (toolCallId, params, signal, onUpdate, ctx). */
export interface CapturedTool {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: (
    toolCallId: string,
    params: any,
    signal: any,
    onUpdate: any,
    ctx: any,
  ) => Promise<any> | any;
  [key: string]: unknown;
}

/** Error de carga del paquete upstream con guía accionable (D6). */
export class CodebaseIndexLoadError extends Error {
  readonly guide: string;
  constructor(message: string, guide: string) {
    super(message);
    this.guide = guide;
    this.name = "CodebaseIndexLoadError";
  }
}

export interface CaptureShim {
  /** El objeto `pi` que se pasa a la factory del upstream. */
  api: Record<string, unknown>;
  /** Tools capturadas por nombre upstream. */
  tools: Map<string, CapturedTool>;
  /** Eventos/commands absorbidos (diagnóstico del PoC). */
  absorbed: { commands: string[]; events: string[]; unknownKeys: string[] };
}

/** Crea el shim. `onLog` para diagnóstico (PoC/Debug). */
export function createCaptureShim(
  onLog?: (line: string) => void,
): CaptureShim {
  const tools = new Map<string, CapturedTool>();
  const absorbed = {
    commands: [] as string[],
    events: [] as string[],
    unknownKeys: [] as string[],
  };
  const log = (line: string) => onLog?.(line);

  const base: Record<string, unknown> = {
    registerTool(tool: CapturedTool) {
      if (tool && typeof tool.name === "string") {
        tools.set(tool.name, tool);
      }
      return tool;
    },
    registerCommand(name: string) {
      absorbed.commands.push(String(name));
      log(`[codebase-index shim] command absorbido: ${name}`);
    },
    on(event: string) {
      absorbed.events.push(String(event));
      log(`[codebase-index shim] event absorbido: ${event}`);
      return () => {}; // unsubscribe no-op
    },
    setSessionName(name: string) {
      log(`[codebase-index shim] setSessionName absorbido: ${name}`);
    },
    getAllTools() {
      return [...tools.values()];
    },
  };

  // Proxy: keys no implementadas del ExtensionAPI → undefined + log (el PoC
  // delata qué contrato extra usa el upstream sin crashear la carga).
  const api = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !(prop in target)) {
        if (!absorbed.unknownKeys.includes(prop)) {
          absorbed.unknownKeys.push(prop);
          log(`[codebase-index shim] key no implementada accedida: ${prop}`);
        }
        return undefined;
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return { api, tools, absorbed };
}

/**
 * Importa la extensión Pi del paquete instalado (import() nativo con
 * pathToFileURL) y corre su factory contra el shim. Devuelve las tools
 * capturadas. Errores → CodebaseIndexLoadError con guía (ABI del native,
 * plataforma sin prebuild, paquete corrupto).
 */
export async function loadUpstreamTools(
  entryPath: string,
  onLog?: (line: string) => void,
): Promise<Map<string, CapturedTool>> {
  let mod: any;
  try {
    mod = await import(pathToFileURL(entryPath).href);
  } catch (e: any) {
    throw new CodebaseIndexLoadError(
      `No se pudo cargar ${path.basename(entryPath)}: ${e?.message ?? e}`,
      "El módulo nativo (.node) puede ser incompatible con tu plataforma/ABI, o la instalación quedó corrupta. Reinstala: elimina ~/.frida/npm/node_modules/open-codebase-index y usa el botón Instalar del tab Index, o ejecuta: npm install " +
        CODEBASE_INDEX_SPEC +
        " --prefix ~/.frida/npm --legacy-peer-deps",
    );
  }
  const factory = mod?.default ?? mod;
  if (typeof factory !== "function") {
    throw new CodebaseIndexLoadError(
      `El entry no exporta una factory (default): ${typeof factory}`,
      "El paquete instalado no tiene la forma esperada (¿versión distinta del pin?). Reinstala al pin con el botón Instalar del tab Index.",
    );
  }
  const shim = createCaptureShim(onLog);
  try {
    await factory(shim.api);
  } catch (e: any) {
    throw new CodebaseIndexLoadError(
      `La factory del upstream falló al registrar tools: ${e?.message ?? e}`,
      "Revisa el log de diagnóstico (keys no implementadas puede indicar contrato nuevo del upstream). Reinstala al pin desde el tab Index.",
    );
  }
  return shim.tools;
}
