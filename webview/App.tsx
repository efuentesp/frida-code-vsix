import { useEffect, useReducer, useRef } from "react";
import { reduce, initialState } from "./store";
import type { InMessage, OutMessage } from "./types";
import { Onboarding } from "./components/Onboarding";
import { TurnView } from "./components/Turn";
import { ApprovalCard } from "./components/ApprovalCard";
import { Composer } from "./components/Composer";

type VsCodeApi = { postMessage(msg: OutMessage): void };

// acquireVsCodeApi() solo puede llamarse UNA VEZ por webview. Se declara a nivel
// de módulo (no de componente) para sobrevivir al doble-render/montaje de StrictMode.
declare function acquireVsCodeApi(): VsCodeApi;
let _vscode: VsCodeApi | null = null;
function getVsCode(): VsCodeApi {
  if (!_vscode) _vscode = acquireVsCodeApi();
  return _vscode;
}

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const approvalsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vscode = getVsCode();
    const handler = (e: MessageEvent) => dispatch(e.data as InMessage);
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "webview_ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  // Cuando hay aprobaciones pendientes, las traemos a la vista (suele ser la causa
  // de "se detiene": el agente espera una aprobación que no se ve).
  useEffect(() => {
    if (state.approvals.length > 0) {
      approvalsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [state.approvals]);

  const post = (msg: OutMessage) => getVsCode().postMessage(msg);

  if (state.keyNeeded) {
    return <Onboarding onSubmit={(key) => post({ type: "set_key", key })} />;
  }

  return (
    <div className="app">
      <div className="log">
        {state.turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
        <div ref={approvalsRef} className="approvals-area">
          {state.approvals.length > 0 && (
            <div className="approvals-banner">⏸ Frida espera tu aprobación:</div>
          )}
          {state.approvals.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              onRespond={(r) => post({ type: "approval_response", id: a.id, ...r })}
            />
          ))}
        </div>
      </div>
      <Composer onSubmit={(text) => post({ type: "submit", text })} />
    </div>
  );
}
