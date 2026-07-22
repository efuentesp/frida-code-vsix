import type { ToolEntry } from "../types";
import { Icon } from "./Icon";
import { useState } from "react";

export function ToolCard({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(true);
  const isBash = entry.tool === "bash";
  return (
    <div className={"tool" + (open ? "" : " collapsed")}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
        <span className="ic">
          <Icon name={isBash ? "term" : "edit"} />
        </span>
        <span className="chev">
          <Icon name="chevron" size={12} />
        </span>
        <span className="nm">{entry.tool}</span>
        <span className={"st " + (entry.state === "running" ? "" : entry.state)}>
          {entry.state === "running" ? (
            <>
              <span className="spin" /> ejecutando
            </>
          ) : entry.state === "ok" ? (
            <>
              <Icon name="check" /> ok
            </>
          ) : (
            <>
              <Icon name="x" /> error
            </>
          )}
        </span>
      </div>
      <div className="tool-args">
        <pre>{entry.args}</pre>
      </div>
    </div>
  );
}
