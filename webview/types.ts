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

export interface State {
  keyNeeded: boolean;
  busy: boolean;
  info?: string;
  turns: Turn[];
  approvals: ApprovalRequest[];
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
  | { type: "error"; text: string };

// webview → host
export type OutMessage =
  | { type: "webview_ready" }
  | { type: "submit"; text: string }
  | { type: "approval_response"; id: string; decision: "accept" | "reject"; acceptAll?: boolean }
  | { type: "set_key"; key: string }
  | { type: "compact" }
  | { type: "abort" }
  | { type: "new_session" };
