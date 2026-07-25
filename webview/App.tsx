import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { reduce, initialState } from "./store";
import type { ApprovalMode, InMessage, OutMessage } from "./types";
import { Onboarding } from "./components/Onboarding";
import { TurnView } from "./components/Turn";
import { ApprovalCard } from "./components/ApprovalCard";
import { CompactionCard } from "./components/CompactionCard";
import { QuestionCard } from "./components/QuestionCard";
import { Composer, type CommandItem } from "./components/Composer";
import { ContextBar } from "./components/ContextBar";
import { SessionsPanel } from "./components/SessionsPanel";
import { Welcome } from "./components/Welcome";
import { ResourcesBar } from "./components/ResourcesBar";
import { ResourcesPanel } from "./components/ResourcesPanel";
import { WorkspaceBar } from "./components/WorkspaceBar";
import { Bot, Brain, CircleHelp, CircleStop, CornerDownRight, History, Key, Library, Minimize2, Pause, RotateCw, ShieldCheck, SquarePen, TriangleAlert } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { Tooltip } from "./components/Tooltip";
import { Spinner } from "./components/Spinner";
import { ModelPanel } from "./components/ModelPanel";
import { ForkPanel } from "./components/ForkPanel";

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
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [escHint, setEscHint] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [hideThinking, setHideThinking] = useState(false);
  const lastEscRef = useRef(0);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const vscode = getVsCode();
    const handler = (e: MessageEvent) => {
      const msg = e.data as InMessage;
      if (msg.type === "open_models") {
        setModelsOpen(true);
        getVsCode().postMessage({ type: "list_models" });
        return;
      }
      if (msg.type === "fork_points") {
        setForkOpen(true);
        return;
      }
      dispatch(msg);
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "webview_ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    if (state.approvals.length > 0 || state.questions.length > 0) {
      approvalsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [state.approvals, state.questions]);

  // Auto-scroll: mantiene la vista en la última respuesta salvo que el usuario
  // haya subido a leer (stick-to-bottom). Se dispara con cada delta/tool/turno.
  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [state.turns, state.queued]);

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

  const post = (msg: OutMessage) => getVsCode().postMessage(msg);

  // Built-in slash commands (siempre disponibles, ejecutados por el host).
  const builtinCommands: CommandItem[] = useMemo(
    () => [
      { kind: "builtin", label: "/compact", name: "compact", description: "Compactar el contexto de la sesión" },
      { kind: "builtin", label: "/reload", name: "reload", description: "Recargar extensiones, skills y prompts" },
      { kind: "builtin", label: "/new", name: "new", description: "Iniciar una sesión nueva" },
      { kind: "builtin", label: "/model", name: "model", description: "Abrir el selector de modelo/proveedor", argumentHint: "<provider/model>" },
      { kind: "builtin", label: "/login", name: "login", description: "Iniciar sesión con un proveedor (suscripción)", argumentHint: "<provider>" },
      { kind: "builtin", label: "/logout", name: "logout", description: "Cerrar sesión de un proveedor", argumentHint: "<provider>" },
      { kind: "builtin", label: "/name", name: "name", description: "Renombrar la sesión actual", argumentHint: "<nombre>" },
      { kind: "builtin", label: "/copy", name: "copy", description: "Copiar el último mensaje al portapapeles" },
      { kind: "builtin", label: "/clone", name: "clone", description: "Duplicar la sesión actual" },
      { kind: "builtin", label: "/fork", name: "fork", description: "Bifurcar desde un mensaje anterior" },
      { kind: "builtin", label: "/help", name: "help", description: "Mostrar atajos y comandos" },
    ],
    []
  );

  // Lista de comandos para el autocompletado de "/": built-in + skills + prompts.
  const commands: CommandItem[] = useMemo(() => {
    const r = state.resources;
    if (!r) return builtinCommands;
    return [
      ...builtinCommands,
      ...r.skills.map((s) => ({ kind: "skill" as const, label: `/skill:${s.name}`, name: s.name, description: s.description })),
      ...r.prompts.map((p) => ({ kind: "prompt" as const, label: `/${p.name}`, name: p.name, description: p.description })),
    ];
  }, [state.resources, builtinCommands]);

  // Etiqueta del indicador de procesamiento (fijo en el footer). Refleja el
  // sub-estado cuando se conoce; no depende del scroll de la conversación.
  const procLabel = (() => {
    if (!state.busy) return null;
    const last = state.turns[state.turns.length - 1];
    if (last?.bash?.status === "running") return "Ejecutando bash…";
    if (last?.status === "executing" && last.executingTool) return `Ejecutando ${last.executingTool}…`;
    if (last?.status === "thinking") return "Pensando…";
    return "Procesando…";
  })();

  if (state.keyNeeded) {
    return (
      <Onboarding
        deviceCode={state.oauthDeviceCode}
        onSubmit={(key) => post({ type: "set_key", key })}
        onLoginCopilot={() => post({ type: "login_provider", provider: "github-copilot" })}
      />
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <span className="avatar ai sm"><Bot size={13} /></span> Frida Code
        </span>
        <span className="spacer" />
        <span className="tb-group">
          <Tooltip label="Recursos cargados (extensiones, skills, prompts, themes, contexto)" side="bottom">
            <button className="ico" onClick={() => { post({ type: "list_resources" }); setResourcesOpen(true); }}>
              <Library size={15} />
            </button>
          </Tooltip>
          <Tooltip label="Sesiones anteriores" side="bottom">
            <button className="ico" onClick={() => { setSessionsOpen(true); post({ type: "list_sessions" }); }}>
              <History size={15} />
            </button>
          </Tooltip>
        </span>
        <span className="tb-sep" />
        <span className="tb-group">
          <Tooltip label="Nueva sesión" side="bottom">
            <button className="ico" onClick={() => post({ type: "new_session" })} disabled={state.busy}>
              <SquarePen size={15} />
            </button>
          </Tooltip>
          <Tooltip label="Compactar contexto" side="bottom">
            <button className="ico" onClick={() => post({ type: "compact" })} disabled={state.busy || state.isCompacting || state.turns.length === 0}>
              <Minimize2 size={15} />
            </button>
          </Tooltip>
          <Tooltip label={hideThinking ? "Mostrar razonamiento" : "Ocultar razonamiento"} side="bottom">
            <button className={"ico" + (hideThinking ? " off" : " active")} onClick={() => setHideThinking((v) => !v)}>
              <Brain size={15} />
            </button>
          </Tooltip>
          <Tooltip label="Recargar extensiones y recursos" side="bottom">
            <button className="ico" onClick={() => post({ type: "reload" })} disabled={state.busy}>
              <RotateCw size={15} />
            </button>
          </Tooltip>
        </span>
        <span className="tb-sep" />
        <span className="tb-group">
          <Tooltip label="Modo de aprobación: Manual → Auto-edit → Auto (clic para ciclar)" side="bottom">
            <button className={"toggle " + state.mode} onClick={() => post({ type: "set_mode", mode: nextMode(state.mode) })}>
              <ShieldCheck size={14} /> {labelMode(state.mode)}
            </button>
          </Tooltip>
        </span>
      </header>

      <div className="sub-header">
        <Tooltip label="Proveedor" side="bottom">
          <span className="sub-provider">{state.provider ?? "…"}</span>
        </Tooltip>
        <span className="sub-sep">·</span>
        <Tooltip label="Cambiar modelo / proveedor" side="bottom">
          <button className="sub-model-btn" onClick={() => { setModelsOpen(true); post({ type: "list_models" }); }}>
            {state.model ?? "…"} <ChevronDown size={12} />
          </button>
        </Tooltip>
        <span className="sub-sep">·</span>
        <Tooltip label="Nivel de esfuerzo / thinking" side="bottom">
          <select
            className="thinking-select"
            value={state.thinking ?? "medium"}
            onChange={(e) => post({ type: "set_thinking", level: e.target.value })}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </Tooltip>
        <Tooltip label={state.keyNeeded ? "Configurar API key" : "Cambiar API key"} side="bottom">
          <button className={"sub-key" + (state.keyNeeded ? " missing" : "")} onClick={() => post({ type: "rotate_key" })}>
            <Key size={12} />
          </button>
        </Tooltip>
      </div>

      {state.mode === "auto-edit" && <div className="info-bar warn"><TriangleAlert size={12} /> Edición automática: crear/editar archivos sin confirmación (bash sí pide).</div>}
      {state.mode === "auto" && <div className="info-bar warn"><TriangleAlert size={12} /> Auto ON: edit/write/bash corren sin pedirte confirmación.</div>}
      {escHint && <div className="info-bar"><CircleStop size={12} /> Presiona Esc de nuevo para detener…</div>}
      {!escHint && state.info && <div className="info-bar">{state.info}</div>}
      {state.resources && <ResourcesBar res={state.resources} />}

      <div
        className="log"
        ref={logRef}
        onScroll={() => {
          const el = logRef.current;
          if (!el) return;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {state.turns.length === 0 && <Welcome />}
        {state.compactions.filter((c) => c.afterTurnId === null).map((c) => (
          <CompactionCard key={c.id} entry={c} />
        ))}
        {state.turns.map((t) => (
          <Fragment key={t.id}>
            <TurnView turn={t} hideThinking={hideThinking} onCopy={(text) => post({ type: "copy_text", text })} />
            {state.compactions.filter((c) => c.afterTurnId === t.id).map((c) => (
              <CompactionCard key={c.id} entry={c} />
            ))}
          </Fragment>
        ))}
        <div ref={approvalsRef} className="approvals-area">
          {state.queued.map((q, i) => (
            <div key={i} className="queued-msg"><CornerDownRight size={12} /> encolado: {q}</div>
          ))}
          {state.approvals.length > 0 && (
            <div className="approvals-banner"><Pause size={12} /> Frida espera tu aprobación:</div>
          )}
          {state.approvals.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              onRespond={(r) => post({ type: "approval_response", id: a.id, ...r })}
            />
          ))}
          {state.questions.length > 0 && (
            <div className="approvals-banner"><CircleHelp size={12} /> Frida necesita tu respuesta:</div>
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
        {state.isCompacting ? (
          <div className="proc-bar">
            <Spinner size={14} />
            Compactando contexto{state.compactReason && state.compactReason !== "manual" ? " (automática)" : ""}…
            <button className="proc-cancel" onClick={() => post({ type: "cancel_compaction" })}>Cancelar</button>
          </div>
        ) : (
          procLabel && (
            <div className="proc-bar"><Spinner size={14} /> {procLabel}</div>
          )
        )}
        <Composer
          onSubmit={(text, mode, images) => post({ type: "submit", text, mode, images })}
          onSearch={(q) => post({ type: "search_files", query: q })}
          files={state.files}
          commands={commands}
          models={state.models}
          busy={state.busy}
          onAbort={() => post({ type: "abort" })}
        />
        <WorkspaceBar ws={state.workspace} onRefresh={() => post({ type: "workspace" })} />
        {state.usage && <ContextBar usage={state.usage} />}
      </div>
      {sessionsOpen && state.sessions && (
        <SessionsPanel
          sessions={state.sessions}
          onClose={() => setSessionsOpen(false)}
          onSwitch={(p) => { post({ type: "switch_session", path: p }); setSessionsOpen(false); }}
          onRename={(p, n) => post({ type: "rename_session", path: p, name: n })}
          onDelete={(p) => post({ type: "delete_session", path: p })}
        />
      )}
      {resourcesOpen && state.resources && (
        <ResourcesPanel
          res={state.resources}
          model={state.model}
          onClose={() => setResourcesOpen(false)}
        />
      )}
      {modelsOpen && state.models && (
        <ModelPanel
          providers={state.models.providers}
          active={state.models.active}
          deviceCode={state.oauthDeviceCode}
          onClose={() => setModelsOpen(false)}
          onSelect={(provider, model) => post({ type: "select_model", provider, model })}
          onLogin={(provider) => post({ type: "login_provider", provider })}
          onLogout={(provider) => post({ type: "logout_provider", provider })}
        />
      )}
      {forkOpen && state.forkPoints && state.forkPoints.length > 0 && (
        <ForkPanel
          points={state.forkPoints}
          onClose={() => setForkOpen(false)}
          onFork={(entryId) => post({ type: "fork_at", entryId })}
        />
      )}
    </div>
  );
}
