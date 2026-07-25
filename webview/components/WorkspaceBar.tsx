import type { WorkspaceInfo } from "../types";
import { Tooltip } from "./Tooltip";
import { CircleDot, Folder, GitBranch, RotateCw } from "lucide-react";

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
      <Tooltip label={ws?.cwd ?? "Carpeta de trabajo"} side="top">
        <span className="ws-cwd">
          <Folder size={13} /><code>{ws ? shortCwd(ws.cwd) : "…"}</code>
        </span>
      </Tooltip>
      {ws?.sessionName && (
        <span className="ws-session" title={ws.sessionName}>• {ws.sessionName}</span>
      )}
      {ws?.branch && (
        <Tooltip label={ws.dirty ? "Hay cambios sin committer" : "Rama actual"} side="top">
          <span className={"ws-branch" + (ws.dirty ? " dirty" : "")}>
            <GitBranch size={13} />{ws.branch}
            {ws.dirty && <span className="ws-dirty"><CircleDot size={12} /></span>}
          </span>
        </Tooltip>
      )}
      <Tooltip label="Refrescar carpeta y rama" side="top">
        <button className="ws-refresh" onClick={onRefresh}>
          <RotateCw size={13} />
        </button>
      </Tooltip>
    </div>
  );
}
