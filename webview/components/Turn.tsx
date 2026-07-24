import type { Turn } from "../types";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { BashCard } from "./BashCard";

export function TurnView({ turn }: { turn: Turn }) {
  const hasAssistant = turn.segments.length > 0 || !!turn.error || !!turn.bash;
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
            {turn.segments.map((s, i) =>
              s.kind === "text" ? (
                s.text ? (
                  <div key={i} className="bubble">
                    <Markdown>{s.text}</Markdown>
                  </div>
                ) : null
              ) : (
                <ToolCard key={i} entry={s} />
              )
            )}
            {turn.bash && <BashCard run={turn.bash} />}
            {turn.error && <div className="err">⚠ {turn.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
