import { useState } from "react";
import type { CompactionEntry } from "../types";
import { Markdown } from "./Markdown";
import { Archive, ChevronDown, ChevronUp } from "lucide-react";
import { Tooltip } from "./Tooltip";

export function CompactionCard({ entry }: { entry: CompactionEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"compact-card" + (open ? " open" : "")}>
      <button className="compact-head" onClick={() => setOpen((v) => !v)}>
        <Archive size={14} />
        <span className="compact-label">[compaction]</span>
        <span className="compact-tokens">Compactado desde {entry.tokensBefore.toLocaleString()} tokens</span>
        <Tooltip label={open ? "Contraer resumen" : "Mostrar resumen"} side="top">
          <span className="compact-toggle">{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</span>
        </Tooltip>
      </button>
      {open && (
        <div className="compact-body">
          <div className="compact-intro">Compactado desde {entry.tokensBefore.toLocaleString()} tokens</div>
          <Markdown>{entry.summary}</Markdown>
        </div>
      )}
    </div>
  );
}
