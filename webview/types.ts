// Protocolo postMessage host ↔ webview + estado.

export type ToolState = "running" | "ok" | "error";

export interface ToolEntry {
  tool: string;
  args: unknown;
  state: ToolState;
  startedAt: number;
  endedAt?: number;
  result?: string;
}

// Ejecución de bash del usuario (!command / !!command).
export interface BashRun {
  command: string;
  excludeFromContext: boolean; // true = "!!" (el output no fue al LLM)
  output: string;
  status: "running" | "ok" | "error" | "cancelled";
  exitCode?: number;
  truncated?: boolean;
  fullOutputPath?: string;
}

export type TurnStatus = "thinking" | "executing" | null;

// Bloque ordenado del contenido de un turno del asistente. Preserva la cronología
// real (texto → tool → texto → …) en vez de separar texto y tools.
export type Segment =
  | { kind: "text"; text: string }
  | ({ kind: "tool" } & ToolEntry);

export interface Turn {
  id: number;
  user: string;
  segments: Segment[];
  status: TurnStatus;
  executingTool?: string;
  bash?: BashRun;
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

export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface QuestionSpec {
  question: string;
  header: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export interface QuestionAnswer {
  questionIndex: number;
  kind: "option" | "custom" | "multi";
  answer: string | null;
  selected?: string[];
  notes?: string;
}

export interface QuestionRequest {
  id: string;
  questions: QuestionSpec[];
}

export interface Usage {
  // Tokens acumulados de la sesión (estilo pi: ↑/↓/R/W/CH)
  inputTotal: number;   // ↑ input acumulado
  outputTotal: number;  // ↓ output acumulado
  cacheRead: number;    // R cache read acumulado
  cacheWrite: number;   // W cache write acumulado
  cacheHitRate?: number; // CH% del último request
  cost: number;         // $ (0 si no aplica)
  // Contexto actual (barra)
  contextTokens: number;   // tokens que ocupan el contexto vivo
  contextWindow: number;
  contextPercent: number;
}

export interface SessionItem {
  path: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  modified: number; // epoch ms
}

// Recursos cargados por el resourceLoader de pi (ver panel de recursos).
export interface ResourceExtension {
  path: string;
  inline: boolean;
  tools?: string[];
  commands?: string[];
}
export interface ResourceSummary {
  extensions: ResourceExtension[];
  skills: { name: string; description: string }[];
  prompts: { name: string; description: string }[];
  themes: { name: string }[];
  contextFiles: { path: string }[];
  errors: { path: string; error: string }[];
}

export interface WorkspaceInfo {
  cwd: string;
  branch?: string;
  dirty?: boolean;
  sessionName?: string;
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
  questions: QuestionRequest[];
  usage?: Usage;
  files?: { query: string; items: string[] };
  sessions?: { items: SessionItem[]; currentPath?: string };
  resources?: ResourceSummary;
  workspace?: WorkspaceInfo;
  queued: string[];
  nextId: number;
}

// Host → webview
export type InMessage =
  | { type: "need_key" }
  | { type: "key_set" }
  | { type: "session_ready" }
  | { type: "user"; text: string }
  | { type: "agent_busy"; busy: boolean }
  | { type: "turn_active" }
  | { type: "delta"; text: string }
  | { type: "tool_start"; tool: string; args?: unknown }
  | { type: "tool_end"; tool: string; isError?: boolean; result?: string }
  | { type: "bash_start"; command: string; excludeFromContext: boolean }
  | { type: "bash_chunk"; text: string }
  | { type: "bash_end"; exitCode?: number; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string }
  | { type: "queued"; items: string[] }
  | { type: "approvals"; approvals: ApprovalRequest[] }
  | { type: "questions"; items: QuestionRequest[] }
  | { type: "info"; text: string }
  | { type: "cleared" }
  | ({ type: "usage" } & Usage)
  | { type: "files"; query: string; items: string[] }
  | { type: "sessions"; items: SessionItem[]; currentPath?: string }
  | { type: "resources"; data: ResourceSummary }
  | { type: "workspace"; cwd: string; branch?: string; dirty?: boolean }
  | { type: "history"; name?: string; items: { role: string; text: string }[] }
  | { type: "mode"; mode: ApprovalMode }
  | { type: "model_info"; model: string; thinking: string }
  | { type: "error"; text: string };

// webview → host
export type OutMessage =
  | { type: "webview_ready" }
  | { type: "submit"; text: string; mode: "steer" | "followUp" }
  | { type: "approval_response"; id: string; decision: "accept" | "reject"; acceptAll?: boolean }
  | { type: "question_response"; id: string; answers: QuestionAnswer[]; cancelled: boolean }
  | { type: "set_key"; key: string }
  | { type: "compact" }
  | { type: "reload" }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "search_files"; query: string }
  | { type: "list_sessions" }
  | { type: "list_resources" }
  | { type: "workspace" }
  | { type: "switch_session"; path: string }
  | { type: "rename_session"; path: string; name: string }
  | { type: "delete_session"; path: string }
  | { type: "set_mode"; mode: ApprovalMode }
  | { type: "set_thinking"; level: string };
