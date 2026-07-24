import { useState } from "react";
import type { SessionItem } from "../types";
import { Tooltip } from "./Tooltip";
import { Pencil, Trash2 } from "lucide-react";

interface Sessions {
  items: SessionItem[];
  currentPath?: string;
}

function fmtDate(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
  } catch {
    return "";
  }
}

export function SessionsPanel({
  sessions,
  onClose,
  onSwitch,
  onRename,
  onDelete,
}: {
  sessions: Sessions;
  onClose: () => void;
  onSwitch: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onDelete: (path: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const items = sessions.items ?? [];

  return (
    <div className="sessions-overlay" onClick={onClose}>
      <div className="sessions-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sessions-head">
          <span>Sesiones ({items.length})</span>
          <button className="sec" onClick={onClose}>Cerrar</button>
        </div>
        <div className="sessions-list">
          {items.length === 0 && <div className="sessions-empty">Aún no hay sesiones guardadas.</div>}
          {items.map((s) => {
            const isCurrent = s.path === sessions.currentPath;
            const title = s.name || s.firstMessage || "(sin mensajes)";
            return (
              <div key={s.path} className={"session-row" + (isCurrent ? " current" : "")}>
                {editing === s.path ? (
                  <div className="session-rename">
                    <input
                      autoFocus
                      className="rename-input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { onRename(s.path, draft); setEditing(null); }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <button onClick={() => { onRename(s.path, draft); setEditing(null); }}>✓</button>
                    <button className="sec" onClick={() => setEditing(null)}>✗</button>
                  </div>
                ) : confirming === s.path ? (
                  <div className="session-confirm">
                    <span className="session-confirm-msg">¿Eliminar esta sesión?</span>
                    <button className="sec" onClick={() => setConfirming(null)}>Cancelar</button>
                    <button className="danger" onClick={() => { onDelete(s.path); setConfirming(null); }}>Eliminar</button>
                  </div>
                ) : (
                  <>
                    <div
                      className="session-main"
                      onClick={() => onSwitch(s.path)}
                      title="Abrir esta sesión"
                    >
                      <div className="session-title">
                        {isCurrent && <span className="dot">●</span>}
                        {title}
                      </div>
                      <div className="session-meta">
                        {s.messageCount} msgs · {fmtDate(s.modified)}
                      </div>
                    </div>
                    <Tooltip label="Renombrar" side="top">
                      <button
                        className="sec icon-btn"
                        onClick={() => { setEditing(s.path); setDraft(s.name || ""); }}
                      >
                        <Pencil size={13} />
                      </button>
                    </Tooltip>
                    <Tooltip label={isCurrent ? "No puedes eliminar la sesión activa" : "Eliminar"} side="top">
                      <button
                        className="sec icon-btn danger"
                        disabled={isCurrent}
                        onClick={() => setConfirming(s.path)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
