import type { ToolEntry } from "../types";
import { Icon } from "./Icon";
import { useEffect, useState } from "react";

// Formatea una duración en ms a algo legible (318 ms · 4.2s).
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Resumen legible de la llamada (icono + texto) según el tool, en vez de JSON.
function toolCallInfo(tool: string, args: unknown): { icon: string; label: string } {
  const a = (args ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => String(v ?? "");
  switch (tool) {
    case "read":
      return { icon: "📄", label: s(a.path) };
    case "bash":
      return { icon: "$", label: s(a.command) };
    case "edit": {
      const n = Array.isArray(a.edits) ? a.edits.length : 0;
      return { icon: "✎", label: `${s(a.path)}${n ? ` · ${n} edición(es)` : ""}` };
    }
    case "write":
      return { icon: "✎", label: s(a.path) };
    case "grep":
      return { icon: "🔎", label: `"${s(a.pattern)}"${a.path ? ` en ${s(a.path)}` : ""}` };
    case "find":
      return { icon: "🔎", label: `${s(a.pattern)}${a.path ? ` en ${s(a.path)}` : ""}` };
    case "ls":
      return { icon: "📁", label: s(a.path) };
    default:
      return { icon: "🔧", label: tool };
  }
}

export function ToolCard({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const running = entry.state === "running";
  const { icon, label } = toolCallInfo(entry.tool, entry.args);
  const hasResult = !!(entry.result && entry.result.trim());

  // Cronómetro en vivo solo mientras ejecuta (re-render ligero cada 250 ms).
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = (entry.endedAt ?? now) - entry.startedAt;

  return (
    <div className={"tool" + (open && hasResult ? "" : " collapsed")}>
      <div
        className={"tool-head" + (hasResult ? " has-result" : "")}
        onClick={() => hasResult && setOpen(!open)}
        title={hasResult ? (open ? "Contraer resultado" : "Ver resultado") : undefined}
      >
        <span className="tc-icon">{icon}</span>
        <code className="tc-label">{label}</code>
        <span className={"tc-status " + entry.state}>
          {running ? (
            <>
              <span className="spin" /> {fmtDuration(elapsed)}
            </>
          ) : entry.state === "ok" ? (
            <>
              <Icon name="check" /> {fmtDuration(elapsed)}
            </>
          ) : (
            <>
              <Icon name="x" /> {fmtDuration(elapsed)}
            </>
          )}
        </span>
        {hasResult && (
          <span className={"tc-chev" + (open ? "" : " closed")}>
            <Icon name="chevron" size={12} />
          </span>
        )}
      </div>
      {hasResult && (
        <div className="tool-result">
          <pre>{entry.result}</pre>
        </div>
      )}
    </div>
  );
}
