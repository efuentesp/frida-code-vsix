import type { Turn } from "../types";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";

export function TurnView({ turn }: { turn: Turn }) {
  const hasAssistant = !!turn.assistantMd || turn.status !== null || turn.tools.length > 0 || !!turn.error;
  return (
    <div className="turn">
      <div className="row">
        <span className="avatar user">
          <Icon name="user" />
        </span>
        <div className="body">
          <div className="who">Tú</div>
          <div className="bubble">{turn.user}</div>
        </div>
      </div>

      {hasAssistant && (
        <div className="row">
          <span className="avatar ai">
            <Icon name="spark" />
          </span>
          <div className="body">
            <div className="who">Frida</div>
            {turn.assistantMd && (
              <div className="bubble">
                <Markdown>{turn.assistantMd}</Markdown>
              </div>
            )}
            {turn.status === "thinking" && (
              <div className="status">
                <span className="spin" /> Pensando…
              </div>
            )}
            {turn.status === "executing" && (
              <div className="status">
                <span className="spin" /> Ejecutando {turn.executingTool}…
              </div>
            )}
            {turn.tools.map((t, i) => (
              <ToolCard key={i} entry={t} />
            ))}
            {turn.error && <div className="err">⚠ {turn.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
