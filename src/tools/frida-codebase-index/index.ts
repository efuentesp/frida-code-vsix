/**
 * frida-codebase-index — factory del wrapper (issue #25, ADR-0036).
 *
 * Registra las 6 tools Frida (D3) respaldadas por el upstream SI está instalado
 * al pin; si no, las registra en MODO GUÍA (D6, patrón missing-binary de
 * frida-agent-browser run.ts): responden con los pasos para instalar.
 * Envuelve errores del upstream con guías: embeddings (research §G), índice
 * ausente, y genérica honesta.
 *
 * CONTRATO execute (SDK): execute(toolCallId, params, signal, onUpdate, ctx) —
 * ver types.d.ts del SDK y frida-supi-web/index.ts. El passthrough reenvía
 * los 5 args tal cual al tool upstream (misma convención al ser extensión pi).
 * La factory DEVUELVE la promesa de carga para que el await factory(api) del
 * loader (loader.js:389) espere el import() completo — sin race de registro.
 */
import * as path from "node:path";

import {
  CODEBASE_INDEX_FACTORY_NAME,
  CODEBASE_INDEX_SPEC,
  FRIDA_TO_UPSTREAM_TOOLS,
  upstreamEntryPath,
} from "./constants";
import { isInstalledAtPin } from "./installer";
import { type CapturedTool, loadUpstreamTools } from "./shim";

export interface CreateCodebaseIndexOpts {
  agentDir: string;
  /** Log de diagnóstico del shim (PoC/Debug). */
  onLog?: (line: string) => void;
}

/** Guía de paquete ausente, con prefix ABSOLUTO entre comillas (cmd.exe y
 *  PowerShell no expanden ~ en argumentos de comandos nativos — win32). */
function missingPackageGuide(agentDir: string): string {
  return [
    "frida-codebase-index: el paquete upstream no está instalado.",
    "",
    "Para activarlo (descarga única de ~256 MB; luego se poda a ~1/5 del disco):",
    "  1. Abre el tab Index del panel de configuración de Frida y pulsa Instalar, o",
    "  2. ejecuta en tu terminal:",
    `     npm install ${CODEBASE_INDEX_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`,
    "Después ejecuta /reload de Frida o reinicia la sesión.",
  ].join("\n");
}

const EMBEDDINGS_GUIDE = [
  "El índice requiere un proveedor de embeddings (nada sale de tu equipo con Ollama):",
  "  - Ollama local: instala Ollama (https://ollama.com) y ejecuta `ollama pull nomic-embed-text`.",
  "  - OpenAI: si ya guardaste una API key de OpenAI en Frida, se usa automáticamente.",
  "  - Custom: configura frida.codebaseIndex.embeddings.custom.baseUrl en los settings de VS Code.",
].join("\n");

const INDEX_GUIDE = [
  "El índice de código aún no existe o está incompleto para esta consulta.",
  "Ejecuta primero la tool index_codebase (indexación incremental) y reintenta.",
  "Si index_codebase falla por embeddings, verá la guía del proveedor.",
].join("\n");

/** Shape del resultado de guía (AgentToolResult: content + details + isError). */
type GuideToolResult = {
  content: { type: "text"; text: string }[];
  details: unknown;
  isError: boolean;
};

/** Resultado de guía con details obligatorio (AgentToolResult). */
function guideResult(
  text: string,
  failureCategory = "codebase-index-guide",
): GuideToolResult {
  return {
    content: [{ type: "text", text }],
    details: { failureCategory },
    isError: true,
  };
}

/** Traduce errores del upstream a respuestas con guía (D6). */
function withEmbeddingsGuide(e: unknown): GuideToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (/no embedding-capable provider/i.test(msg)) {
    return guideResult(
      `frida-codebase-index: ${msg}\n\n${EMBEDDINGS_GUIDE}`,
      "codebase-index-embeddings",
    );
  }
  if (
    /(no index|not indexed|index not found|index is empty|index_codebase)/i.test(
      msg,
    )
  ) {
    return guideResult(
      `frida-codebase-index: ${msg}\n\n${INDEX_GUIDE}`,
      "codebase-index-missing-index",
    );
  }
  return guideResult(
    `frida-codebase-index: ${msg}\n\nSi persiste, revisa el estado en el tab Index del panel de configuración de Frida.`,
    "codebase-index-error",
  );
}

/** Descripción Frida para cada tool (ajustada al renombrado, ADR-0036 D1). */
const FRIDA_DESCRIPTIONS: Record<string, string> = {
  semantic_context:
    "Búsqueda de código por significado con paquete de evidencia acotado y bajo en tokens (deduplicado, diverso por archivo). Punto de entrada recomendado para preguntas del repositorio.",
  semantic_search:
    "Búsqueda semántica/híbrida (significado + palabras clave) que devuelve código fuente completo con filtros de archivo/directorio.",
  call_graph:
    "Grafo de llamadas: callers/callees directos de un símbolo, o la ruta de llamadas más corta entre dos símbolos con mode:'path'.",
  implementation_lookup:
    "Localiza la definición autoritativa de un símbolo, prefiriendo implementación sobre tests/docs/fixtures.",
  index_codebase:
    "Crea/actualiza el índice de código (incremental por defecto; force:true para rebuild total).",
  index_status:
    "Reporta el estado del índice: readiness, chunks, compatibilidad y proveedor de embeddings.",
};

/** Tool Frida en modo guía (paquete ausente o tool upstream faltante). */
function guideTool(fridaName: string, guideText: string) {
  return {
    name: fridaName,
    label: fridaName,
    description: FRIDA_DESCRIPTIONS[fridaName] ?? fridaName,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    async execute(
      _toolCallId: string,
      _params: any,
      _signal: any,
      _onUpdate: any,
      _ctx: any,
    ) {
      return guideResult(guideText);
    },
  };
}

/** Registra la tool Frida como passthrough del tool upstream capturado
 *  (reenvío posicional de los 5 args del contrato execute del SDK). */
function passthroughTool(fridaName: string, upstream: CapturedTool) {
  return {
    name: fridaName,
    label: fridaName,
    description: FRIDA_DESCRIPTIONS[fridaName] ?? upstream.description,
    parameters: upstream.parameters ?? {
      type: "object",
      properties: {},
    },
    async execute(
      toolCallId: string,
      params: any,
      signal: any,
      onUpdate: any,
      ctx: any,
    ) {
      try {
        return await upstream.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          ctx,
        );
      } catch (e) {
        return withEmbeddingsGuide(e);
      }
    },
  };
}

/**
 * call_graph Frida = call_graph upstream + call_graph_path upstream vía
 * mode:'path' (D3). Schema fusionado; sin call_graph_path capturado,
 * mode:'path' degrada con guía.
 */
function callGraphTool(
  callGraph: CapturedTool,
  pathTool: CapturedTool | undefined,
) {
  const baseParams = (callGraph.parameters as Record<string, any>) ?? {
    type: "object",
    properties: {},
  };
  const merged = {
    ...baseParams,
    properties: {
      ...(baseParams.properties ?? {}),
      mode: {
        type: "string",
        enum: ["direct", "path"],
        description:
          "'direct' (default): callers/callees directos. 'path': ruta de llamadas más corta entre from y to (call_graph_path del upstream).",
      },
    },
  };
  return {
    name: "call_graph",
    label: "call_graph",
    description: FRIDA_DESCRIPTIONS.call_graph,
    parameters: merged,
    async execute(
      toolCallId: string,
      params: any,
      signal: any,
      onUpdate: any,
      ctx: any,
    ) {
      try {
        const { mode: _mode, ...rest } = params ?? {};
        if (params?.mode === "path") {
          if (!pathTool) {
            return guideResult(
              "frida-codebase-index: esta versión del paquete no expone call_graph_path. Actualiza el paquete desde el tab Index.",
              "codebase-index-missing-tool",
            );
          }
          return await pathTool.execute(
            toolCallId,
            rest,
            signal,
            onUpdate,
            ctx,
          );
        }
        return await callGraph.execute(
          toolCallId,
          rest,
          signal,
          onUpdate,
          ctx,
        );
      } catch (e) {
        return withEmbeddingsGuide(e);
      }
    },
  };
}

/** Estado del wrapper para el host (tab Index del webview). */
export interface CodebaseIndexState {
  installed: boolean;
  /** Tools upstream capturadas (nombres upstream) — vacío si no instalado. */
  capturedTools: string[];
}

/**
 * Factory embebida para extensionFactories (src/pi-session.ts). DEVUELVE la
 * promesa de carga: el loader hace await factory(api) y así espera el import()
 * completo antes de dar la sesión por lista.
 */
export function createFridaCodebaseIndex(
  opts: CreateCodebaseIndexOpts & {
    onStateChange?: (s: CodebaseIndexState) => void;
  },
) {
  const { agentDir, onLog, onStateChange } = opts;
  return async (pi: any) => {
    const register = (tool: unknown) => {
      try {
        pi.registerTool(tool);
      } catch (e: any) {
        onLog?.(
          `[codebase-index] registerTool ${String((tool as any)?.name)} falló: ${e?.message ?? e}`,
        );
      }
    };

    if (!isInstalledAtPin(agentDir)) {
      for (const fridaName of Object.keys(FRIDA_TO_UPSTREAM_TOOLS)) {
        register(guideTool(fridaName, missingPackageGuide(agentDir)));
      }
      onStateChange?.({ installed: false, capturedTools: [] });
      return;
    }

    try {
      const tools = await loadUpstreamTools(
        upstreamEntryPath(agentDir),
        onLog,
      );
      const capturedNames: string[] = [];
      for (const [fridaName, upstreamName] of Object.entries(
        FRIDA_TO_UPSTREAM_TOOLS,
      )) {
        const upstream = tools.get(upstreamName);
        if (!upstream) {
          register(
            guideTool(
              fridaName,
              `frida-codebase-index: el paquete instalado no expone la tool upstream '${upstreamName}'. Reinstala al pin desde el tab Index.`,
            ),
          );
          continue;
        }
        capturedNames.push(upstreamName);
        if (fridaName === "call_graph") {
          register(
            callGraphTool(upstream, tools.get("call_graph_path")),
          );
        } else {
          register(passthroughTool(fridaName, upstream));
        }
      }
      onStateChange?.({ installed: true, capturedTools: capturedNames });
    } catch (e: any) {
      const guideText = `${e?.message ?? e}\n\n${e?.guide ?? ""}`.trim();
      for (const fridaName of Object.keys(FRIDA_TO_UPSTREAM_TOOLS)) {
        register(guideTool(fridaName, guideText));
      }
      onStateChange?.({ installed: false, capturedTools: [] });
    }
  };
}

export { CODEBASE_INDEX_FACTORY_NAME };
