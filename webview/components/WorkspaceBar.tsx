import type { WorkspaceInfo } from "../types";

// Pinta la carpeta de trabajo y el branch git (con indicador de cambios).
// Siempre visible en el footer, para saber exactamente dónde opera el agente.
function shortCwd(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~").replace(/^[A-Z]:\\/, (m) => m);
}

export function WorkspaceBar({
  ws,
  onRefresh,
}: {
  ws?: WorkspaceInfo;
  onRefresh: () => void;
}) {
  return (
    <div className="ws-bar">
      <span className="ws-cwd" title={ws?.cwd}>
        📁 <code>{ws ? shortCwd(ws.cwd) : "…"}</code>
      </span>
      {ws?.branch && (
        <span className={"ws-branch" + (ws.dirty ? " dirty" : "")} title={ws.dirty ? "Hay cambios sin committer" : "Rama actual"}>
          ⎇ {ws.branch}
          {ws.dirty && <span className="ws-dirty"> ✱</span>}
        </span>
      )}
      <button className="ws-refresh" onClick={onRefresh} title="Refrescar carpeta y rama">
        ↻
      </button>
    </div>
  );
}
