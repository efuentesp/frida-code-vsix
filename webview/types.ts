// Protocolo postMessage host ↔ webview + estado.

export type ToolState = "running" | "ok" | "error";

export interface ToolEntry {
  tool: string;
  args: string;
  state: ToolState;
}

export type TurnStatus = "thinking" | "executing" | null;

export interface Turn {
  id: number;
  user: string;
  assistantMd: string;
  status: TurnStatus;
  executingTool?: string;
  tools: ToolEntry[];
  error?: string;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  kind: "diff" | "bash";
  path?: string;
  command?: string;
  diff?: string;
}

export interface Usage {
  inputTokens: number;   // tokens del último request (= llenado actual del contexto)
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  sessionTokens: number;  // acumulado de la sesión (input+output)
  contextWindow: number;  // tamaño de la ventana del modelo
  contextPercent: number; // inputTokens / contextWindow * 100
}

export interface SessionItem {
  path: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  modified: number; // epoch ms
}

export type ApprovalMode = "manual" | "auto-edit" | "auto";

export interface State {
  keyNeeded: boolean;
  busy: boolean;
  mode: ApprovalMode;
  info?: string;
  model?: string;
  thinking?: string;
  turns: Turn[];
  approvals: ApprovalRequest[];
  usage?: Usage;
  files?: { query: string; items: string[] };
  sessions?: { items: SessionItem[]; currentPath?: string };
  nextId: number;
}

// Host → webview
export type InMessage =
  | { type: "need_key" }
  | { type: "key_set" }
  | { type: "session_ready" }
  | { type: "user"; text: string }
  | { type: "turn_start" }
  | { type: "delta"; text: string }
  | { type: "tool_start"; tool: string; args?: string }
  | { type: "tool_end"; tool: string; isError?: boolean }
  | { type: "turn_end" }
  | { type: "approvals"; approvals: ApprovalRequest[] }
  | { type: "info"; text: string }
  | { type: "cleared" }
  | ({ type: "usage" } & Usage)
  | { type: "files"; query: string; items: string[] }
  | { type: "sessions"; items: SessionItem[]; currentPath?: string }
  | { type: "history"; name?: string; items: { role: string; text: string }[] }
  | { type: "mode"; mode: ApprovalMode }
  | { type: "model_info"; model: string; thinking: string }
  | { type: "error"; text: string };

// webview → host
export type OutMessage =
  | { type: "webview_ready" }
  | { type: "submit"; text: string }
  | { type: "approval_response"; id: string; decision: "accept" | "reject"; acceptAll?: boolean }
  | { type: "set_key"; key: string }
  | { type: "compact" }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "search_files"; query: string }
  | { type: "list_sessions" }
  | { type: "switch_session"; path: string }
  | { type: "rename_session"; path: string; name: string }
  | { type: "set_mode"; mode: ApprovalMode }
  | { type: "set_thinking"; level: string };
