import type { BashRun } from "../types";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { useState } from "react";

// Tarjeta para un atajo de bash del usuario (!command / !!command).
// Hermana visual de ToolCard: cabecera con estado + output en <pre>.
export function BashCard({ run }: { run: BashRun }) {
  const [open, setOpen] = useState(true);
  const running = run.status === "running";
  const dim = run.excludeFromContext; // "!!" → el output no fue al modelo

  return (
    <div className={"bash-run" + (open ? "" : " collapsed") + (dim ? " dim" : "")}>
      <div className="bash-head" onClick={() => setOpen(!open)}>
        <span className="ic">
          <Icon name="term" />
        </span>
        <span className="chev">
          <Icon name="chevron" size={12} />
        </span>
        <code className="cmd">$ {run.command}</code>
        <span className="st">
          {running ? (
            <>
              <Spinner size={13} /> ejecutando
            </>
          ) : run.status === "ok" ? (
            <>
              <Icon name="check" /> exit&nbsp;{run.exitCode ?? 0}
            </>
          ) : run.status === "cancelled" ? (
            <>cancelado</>
          ) : (
            <>
              <Icon name="x" /> exit&nbsp;{run.exitCode ?? "?"}
            </>
          )}
        </span>
      </div>
      <div className="bash-out">
        {run.output && <pre>{run.output}</pre>}
        {!run.output && !running && <div className="empty">(sin salida)</div>}
        {run.truncated && run.fullOutputPath && (
          <div className="trunc">⚠ Salida truncada. Output completo: {run.fullOutputPath}</div>
        )}
        {dim && <div className="dim-note">No enviado al modelo (!!)</div>}
      </div>
    </div>
  );
}
