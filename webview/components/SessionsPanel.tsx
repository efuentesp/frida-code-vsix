import { useState } from "react";
import type { SessionItem } from "../types";

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
}: {
  sessions: Sessions;
  onClose: () => void;
  onSwitch: (path: string) => void;
  onRename: (path: string, name: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
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
                    <button
                      className="sec icon-btn"
                      title="Renombrar"
                      onClick={() => { setEditing(s.path); setDraft(s.name || ""); }}
                    >✎</button>
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
