import type { ApprovalRequest } from "../types";
import { Icon } from "./Icon";
import { Diff } from "./Diff";

export function ApprovalCard({
  approval,
  onRespond,
}: {
  approval: ApprovalRequest;
  onRespond: (r: { decision: "accept" | "reject"; acceptAll?: boolean }) => void;
}) {
  const isBash = approval.kind === "bash";
  const label = isBash
    ? "Ejecución de comando"
    : "Edición de archivo" + (approval.path ? " — " + approval.path : "");
  return (
    <div className="approval">
      <div className="ttl">
        <span className="ic">
          <Icon name={isBash ? "term" : "edit"} />
        </span>
        <span>{label}</span>
      </div>
      {approval.command && <pre className="cmd">{approval.command}</pre>}
      {approval.diff && <Diff text={approval.diff} />}
      <div className="acts">
        <button onClick={() => onRespond({ decision: "accept" })}>Aceptar</button>
        <button className="sec" onClick={() => onRespond({ decision: "reject" })}>
          Rechazar
        </button>
        {!isBash && (
          <button className="sec" onClick={() => onRespond({ decision: "accept", acceptAll: true })}>
            Aceptar todas (esta sesión)
          </button>
        )}
      </div>
    </div>
  );
}
