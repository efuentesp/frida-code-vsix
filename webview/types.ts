// Protocolo postMessage host ↔ webview + estado.

export type ToolState = "running" | "ok" | "error";

export interface ToolEntry {
  tool: string;
  args: unknown;
  state: ToolState;
  startedAt: number;
  endedAt?: number;
  result?: string;
  diff?: string;
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

export interface ImageAttachment {
  data: string;   // base64 (sin prefijo data:)
  mimeType: string;
}

export type CompactionReason = "manual" | "threshold" | "overflow";

// Segmentos reconstruidos al recargar una sesión (postHistory): incluye tools y thinking.
export type HistorySegment =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; tool: string; args?: unknown; result?: string; diff?: string; state?: ToolState };

export type HistoryItem =
  | { role: "user"; text: string }
  | { role: "assistant"; segments: HistorySegment[] };

// Resumen de una compactación de contexto (evento compaction_end del SDK).
export interface CompactionEntry {
  id: number;
  afterTurnId: number | null; // turn tras el cual se inserta (cronología)
  tokensBefore: number;
  summary: string;
  reason: CompactionReason;
}

export type TurnStatus = "thinking" | "executing" | null;

// Bloque ordenado del contenido de un turno del asistente. Preserva la cronología
// real (texto → tool → texto → …) en vez de separar texto y tools.
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | ({ kind: "tool" } & ToolEntry);

export interface Turn {
  id: number;
  user: string;
  images?: ImageAttachment[];
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

// Selector de proveedor/modelo (fase 2: multi-proveedor + GitHub Copilot).
export interface ModelOption { id: string; name: string; }
export interface ProviderOption {
  id: string;
  name: string;
  oauth: boolean;   // autenticación por suscripción (OAuth) vs API key
  authed: boolean;  // ¿tiene credenciales válidas?
  models: ModelOption[];
}

export type ApprovalMode = "manual" | "auto-edit" | "auto";

export interface State {
  keyNeeded: boolean;
  busy: boolean;
  mode: ApprovalMode;
  info?: string;
  model?: string;
  provider?: string;
  thinking?: string;
  turns: Turn[];
  approvals: ApprovalRequest[];
  questions: QuestionRequest[];
  usage?: Usage;
  files?: { query: string; items: string[] };
  sessions?: { items: SessionItem[]; currentPath?: string };
  resources?: ResourceSummary;
  workspace?: WorkspaceInfo;
  models?: { providers: ProviderOption[]; active?: { provider: string; modelId: string } };
  forkPoints?: { entryId: string; text: string }[];
  oauthDeviceCode?: { userCode: string; verificationUri: string };
  queued: string[];
  isCompacting: boolean;
  compactReason?: CompactionReason;
  compactions: CompactionEntry[];
  nextId: number;
}

// Host → webview
export type InMessage =
  | { type: "need_key" }
  | { type: "key_set" }
  | { type: "session_ready" }
  | { type: "user"; text: string; images?: ImageAttachment[] }
  | { type: "agent_busy"; busy: boolean }
  | { type: "turn_active" }
  | { type: "delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; tool: string; args?: unknown }
  | { type: "tool_end"; tool: string; isError?: boolean; result?: string; diff?: string }
  | { type: "bash_start"; command: string; excludeFromContext: boolean }
  | { type: "bash_chunk"; text: string }
  | { type: "bash_end"; exitCode?: number; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string }
  | { type: "queued"; items: string[] }
  | { type: "approvals"; approvals: ApprovalRequest[] }
  | { type: "questions"; items: QuestionRequest[] }
  | { type: "info"; text: string }
  | { type: "cleared" }
  | ({ type: "usage" } & Usage)
  | { type: "compact_start"; reason: CompactionReason }
  | { type: "compact_end"; reason: CompactionReason; aborted: boolean; tokensBefore?: number; summary?: string; errorMessage?: string }
  | { type: "files"; query: string; items: string[] }
  | { type: "sessions"; items: SessionItem[]; currentPath?: string }
  | { type: "resources"; data: ResourceSummary }
  | { type: "workspace"; cwd: string; branch?: string; dirty?: boolean }
  | { type: "models"; providers: ProviderOption[]; active?: { provider: string; modelId: string } }
  | { type: "open_models" }
  | { type: "oauth_device_code"; userCode: string; verificationUri: string }
  | { type: "oauth_clear" }
  | { type: "fork_points"; points: { entryId: string; text: string }[] }
  | { type: "history"; name?: string; items: HistoryItem[] }
  | { type: "mode"; mode: ApprovalMode }
  | { type: "model_info"; provider?: string; model: string; thinking: string }
  | { type: "error"; text: string };

// webview → host
export type OutMessage =
  | { type: "webview_ready" }
  | { type: "submit"; text: string; mode: "steer" | "followUp"; images?: ImageAttachment[] }
  | { type: "approval_response"; id: string; decision: "accept" | "reject"; acceptAll?: boolean }
  | { type: "question_response"; id: string; answers: QuestionAnswer[]; cancelled: boolean }
  | { type: "set_key"; key: string }
  | { type: "rotate_key" }
  | { type: "copy_text"; text: string }
  | { type: "compact" }
  | { type: "cancel_compaction" }
  | { type: "reload" }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "search_files"; query: string }
  | { type: "list_sessions" }
  | { type: "list_resources" }
  | { type: "workspace" }
  | { type: "list_models" }
  | { type: "select_model"; provider: string; model: string }
  | { type: "login_provider"; provider: string }
  | { type: "logout_provider"; provider: string }
  | { type: "fork" }
  | { type: "fork_at"; entryId: string }
  | { type: "switch_session"; path: string }
  | { type: "rename_session"; path: string; name: string }
  | { type: "delete_session"; path: string }
  | { type: "set_mode"; mode: ApprovalMode }
  | { type: "set_thinking"; level: string };
