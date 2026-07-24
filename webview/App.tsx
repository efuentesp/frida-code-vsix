import { useEffect, useReducer, useRef, useState } from "react";
import { reduce, initialState } from "./store";
import type { ApprovalMode, InMessage, OutMessage } from "./types";
import { Onboarding } from "./components/Onboarding";
import { TurnView } from "./components/Turn";
import { ApprovalCard } from "./components/ApprovalCard";
import { QuestionCard } from "./components/QuestionCard";
import { Composer } from "./components/Composer";
import { ContextBar } from "./components/ContextBar";
import { SessionsPanel } from "./components/SessionsPanel";
import { Welcome } from "./components/Welcome";
import { ResourcesBar } from "./components/ResourcesBar";
import { ResourcesPanel } from "./components/ResourcesPanel";
import { WorkspaceBar } from "./components/WorkspaceBar";

type VsCodeApi = { postMessage(msg: OutMessage): void };

// acquireVsCodeApi() solo puede llamarse UNA VEZ por webview → singleton de módulo.
declare function acquireVsCodeApi(): VsCodeApi;
let _vscode: VsCodeApi | null = null;
function getVsCode(): VsCodeApi {
  if (!_vscode) _vscode = acquireVsCodeApi();
  return _vscode;
}

function nextMode(m: ApprovalMode): ApprovalMode {
  return m === "manual" ? "auto-edit" : m === "auto-edit" ? "auto" : "manual";
}
function labelMode(m: ApprovalMode): string {
  return m === "manual" ? "Manual" : m === "auto-edit" ? "Auto-edit" : "Auto";
}

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const approvalsRef = useRef<HTMLDivElement>(null);
  const [escHint, setEscHint] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [resDismissed, setResDismissed] = useState(false);
  const resSigRef = useRef("");
  const lastEscRef = useRef(0);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const vscode = getVsCode();
    const handler = (e: MessageEvent) => dispatch(e.data as InMessage);
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "webview_ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    if (state.approvals.length > 0 || state.questions.length > 0) {
      approvalsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [state.approvals, state.questions]);

  // Doble Escape (mientras responde) → abort, como el botón Detener.
  useEffect(() => {
    if (!state.busy) {
      setEscHint(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const now = Date.now();
      if (now - lastEscRef.current < 450) {
        lastEscRef.current = 0;
        if (escTimerRef.current) clearTimeout(escTimerRef.current);
        setEscHint(false);
        getVsCode().postMessage({ type: "abort" });
      } else {
        lastEscRef.current = now;
        setEscHint(true);
        if (escTimerRef.current) clearTimeout(escTimerRef.current);
        escTimerRef.current = setTimeout(() => setEscHint(false), 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.busy]);

  // Vuelve a mostrar la barra de recursos cuando cambia su contenido
  // (inicio, nueva sesión, abrir sesión, reload). Respeta el descarte del
  // usuario si los recursos no cambiaron (p. ej. un list_resources bajo demanda).
  useEffect(() => {
    const r = state.resources;
    if (!r) return;
    const sig =
      `${r.extensions.length}|${r.skills.length}|${r.prompts.length}|` +
      `${r.themes.length}|${r.contextFiles.length}|${r.errors.length}|` +
      `${r.extensions[0]?.path ?? ""}`;
    if (sig !== resSigRef.current) {
      resSigRef.current = sig;
      setResDismissed(false);
    }
  }, [state.resources]);

  const post = (msg: OutMessage) => getVsCode().postMessage(msg);

  if (state.keyNeeded) {
    return <Onboarding onSubmit={(key) => post({ type: "set_key", key })} />;
  }

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <span className="avatar ai sm">✦</span> Frida Code
        </span>
        <span className="model-info">
          <span className="model-name">{state.model ?? "…"}</span>
          <select
            className="thinking-select"
            value={state.thinking ?? "medium"}
            onChange={(e) => post({ type: "set_thinking", level: e.target.value })}
            title="Nivel de esfuerzo / thinking"
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </span>
        <span className="spacer" />
        <button
          onClick={() => { post({ type: "list_resources" }); setResourcesOpen(true); }}
          title="Recursos cargados (extensiones, skills, prompts, themes, contexto)"
        >
          Recursos
        </button>
        <button onClick={() => { setSessionsOpen(true); post({ type: "list_sessions" }); }}>
          Sesiones
        </button>
        <button onClick={() => post({ type: "new_session" })} disabled={state.busy}>
          Nueva sesión
        </button>
        <button onClick={() => post({ type: "compact" })} disabled={state.busy || state.turns.length === 0}>
          Compactar
        </button>
        <button
          onClick={() => post({ type: "reload" })}
          disabled={state.busy}
          title="Recargar extensiones, skills, prompts, themes y archivos de contexto"
        >
          ↻ Recargar
        </button>
        <button
          className={"toggle " + state.mode}
          title="Modo de aprobación: Manual → Auto-edit → Auto (clic para ciclar)"
          onClick={() => post({ type: "set_mode", mode: nextMode(state.mode) })}
        >
          {labelMode(state.mode)}
        </button>
        {state.busy && (
          <button className="sec" onClick={() => post({ type: "abort" })}>
            ■ Detener
          </button>
        )}
      </header>

      {state.mode === "auto-edit" && <div className="info-bar warn">⚠ Edición automática: crear/editar archivos sin confirmación (bash sí pide).</div>}
      {state.mode === "auto" && <div className="info-bar warn">⚠ Auto ON: edit/write/bash corren sin pedirte confirmación.</div>}
      {escHint && <div className="info-bar">⎋ Presiona Esc de nuevo para detener…</div>}
      {!escHint && state.info && <div className="info-bar">{state.info}</div>}
      {state.usage && <ContextBar usage={state.usage} />}
      {state.resources && !resDismissed && (
        <ResourcesBar
          res={state.resources}
          onDetails={() => setResourcesOpen(true)}
          onDismiss={() => setResDismissed(true)}
        />
      )}

      <div className="log">
        {state.turns.length === 0 && <Welcome />}
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
          {state.questions.length > 0 && (
            <div className="approvals-banner">❓ Frida necesita tu respuesta:</div>
          )}
          {state.questions.map((q) => (
            <QuestionCard
              key={q.id}
              request={q}
              onRespond={(r) => post({ type: "question_response", id: q.id, ...r })}
            />
          ))}
        </div>
      </div>
      <div className="footer">
        <WorkspaceBar ws={state.workspace} onRefresh={() => post({ type: "workspace" })} />
        <Composer
          onSubmit={(text) => post({ type: "submit", text })}
          onSearch={(q) => post({ type: "search_files", query: q })}
          files={state.files}
        />
      </div>
      {sessionsOpen && state.sessions && (
        <SessionsPanel
          sessions={state.sessions}
          onClose={() => setSessionsOpen(false)}
          onSwitch={(p) => { post({ type: "switch_session", path: p }); setSessionsOpen(false); }}
          onRename={(p, n) => post({ type: "rename_session", path: p, name: n })}
        />
      )}
      {resourcesOpen && state.resources && (
        <ResourcesPanel
          res={state.resources}
          model={state.model}
          onClose={() => setResourcesOpen(false)}
        />
      )}
    </div>
  );
}
