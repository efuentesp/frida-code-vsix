// Tab "Index" del SettingsHub: estado y acciones de frida-codebase-index
// (instalación on-demand del paquete upstream, indexación, rebuild, estado).
// El estado llega por InMessage codebase_index_state; las acciones salen por
// codebase_index_action y las ejecuta el host (src/extension.ts).
import { Database, Download, Hammer, RefreshCw } from "lucide-react";
import type { OutMessage, State } from "../types";

export function IndexTab({
  state,
  post,
}: {
  state: State;
  post: (m: OutMessage) => void;
}) {
  const ci = state.codebaseIndex;
  return (
    <div className="cfg-resources">
      <div className="cfg-section">
        <Database size={13} /> Índice de código (semántico + call graph)
      </div>
      <div className="cfg-row-desc" style={{ marginBottom: 8 }}>
        Búsqueda por significado, grafo de llamadas y lookup de implementaciones
        (6 tools del agente). Requiere un paquete on-demand (~256 MB, se poda a
        ~1/5 del disco) y un proveedor de embeddings (Ollama local, tu key de
        OpenAI, o endpoint custom en settings frida.codebaseIndex.*).
      </div>
      <div className="cfg-res-actions">
        {!ci?.installed && (
          <button
            className="pc-save"
            disabled={!!ci?.busy}
            onClick={() =>
              post({ type: "codebase_index_action", action: "install" })
            }
          >
            <Download size={13} />{" "}
            {ci?.busy === "install" ? "Instalando…" : "Instalar paquete"}
          </button>
        )}
        {ci?.installed && (
          <>
            <button
              className="pc-save"
              disabled={!!ci?.busy}
              onClick={() =>
                post({ type: "codebase_index_action", action: "index" })
              }
            >
              <RefreshCw size={13} />{" "}
              {ci?.busy === "index" ? "Indexando…" : "Indexar (incremental)"}
            </button>
            <button
              className="pc-save"
              disabled={!!ci?.busy}
              onClick={() =>
                post({ type: "codebase_index_action", action: "rebuild" })
              }
            >
              <Hammer size={13} /> Rebuild completo
            </button>
            <button
              className="pc-save"
              disabled={!!ci?.busy}
              onClick={() =>
                post({ type: "codebase_index_action", action: "status" })
              }
            >
              <Database size={13} /> Estado del índice
            </button>
          </>
        )}
      </div>
      {ci?.lastLine && <div className="cfg-row-desc">{ci.lastLine}</div>}
      <div className="cfg-row">
        <div className="cfg-row-info">
          <div className="cfg-row-title">Paquete upstream</div>
          <div className="cfg-row-desc">
            {ci?.installed
              ? `Instalado${ci.version ? ` (v${ci.version})` : ""} (${ci.capturedTools?.length ?? 0} tools capturadas)`
              : "No instalado — las tools del agente responden con la guía de instalación"}
          </div>
        </div>
      </div>
      <div className="cfg-row">
        <div className="cfg-row-info">
          <div className="cfg-row-title">Embeddings</div>
          <div className="cfg-row-desc">
            Ollama local (`ollama pull nomic-embed-text`), tu key de OpenAI ya
            guardada en Frida, o endpoint custom. Sin índice, las tools muestran
            la guía del proveedor.
          </div>
        </div>
      </div>
    </div>
  );
}
