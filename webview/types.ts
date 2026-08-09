// Protocolo postMessage host ↔ webview + estado.

export type ToolState = "running" | "ok" | "error";

/** Nivel de un toast: error NO se auto-cierra (cierre manual); los demás sí. */
export type ToastLevel = "info" | "warning" | "error" | "success";

/** Progreso estructurado de un sub-agente (reenvía el host vía tool_update.details
 *  cuando kind === "subagent_progress"). Se renderiza rico en el ToolCard. */
export interface SubagentProgressDetails {
	kind: "subagent_progress";
	toolUses: number;
	turnCount: number;
	maxTurns?: number;
	tokens: number;
	activity: string;
}

export interface ToolEntry {
	tool: string;
	args: unknown;
	state: ToolState;
	startedAt: number;
	endedAt?: number;
	result?: string;
	diff?: string;
	toolCallId?: string; // del SDK: para emparejar updates/fin de tools largos
	partial?: string; // progreso parcial (tool_execution_update) mientras running
	partialDetails?: SubagentProgressDetails; // progreso estructurado del sub-agente
	tokensLLM?: number; // atribución ~llm del turno (usage ÷ tarjetas)
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
	data: string; // base64 (sin prefijo data:)
	mimeType: string;
}

export type CompactionReason = "manual" | "threshold" | "overflow";

// Segmentos reconstruidos al recargar una sesión (postHistory): incluye tools y thinking.
export type HistorySegment =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| {
			kind: "tool";
			tool: string;
			args?: unknown;
			result?: string;
			diff?: string;
			state?: ToolState;
	  };

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

// Resumen del contexto previo al bifurcar (branch) una sesión larga. pi lo
// genera llamando al modelo (como la compaction) y lo persiste como mensaje
// role:"branchSummary". Se renderiza al inicio del transcript (igual que el
// BranchSummaryMessageComponent del TUI).
export interface BranchSummaryEntry {
	summary: string;
}

export type TurnStatus = "thinking" | "executing" | null;

// Bloque ordenado del contenido de un turno del asistente. Preserva la cronología
// real (texto → tool → texto → …) en vez de separar texto y tools.
export type Segment =
	| { kind: "text"; text: string }
	| {
			kind: "thinking";
			text: string;
			startedAt: number;
			endedAt?: number;
			tokensLLM?: number;
	  }
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
	/** Mensaje del sistema (ej. salida de /todos): bloque multiline en el flujo,
	 *  sin avatares user/assistant. */
	notice?: string;
}

export interface ApprovalRequest {
	id: string;
	toolName: string;
	kind: "diff" | "bash" | "tool";
	path?: string;
	command?: string;
	diff?: string;
	warning?: string;
	/** Patrón sugerido para aprobar por sesión (Fase 4): la UI lo ofrece como botón. */
	suggestedPattern?: string;
}

/** Solicitud de confirmación de cambio de proveedor/modelo (red de seguridad).
 *  source: "manual" (ModelPanel//model/login), "skill" (skill-bracket override),
 *  "auto-detected" (cambio durante un turno, ¿fallo/ciclo/restore?). */
export interface ModelChangeRequest {
	id: string;
	from: { provider: string; modelId: string };
	to: { provider: string; modelId: string };
	source: "manual" | "skill" | "auto-detected";
	reason?: string;
}

/** Nodo del árbol Remote React (opción A). El host serializa cada commit; el
 *  webview lo materializa en RemoteRoot. Los handlers viajan como IDs "h#N". */
export interface WebNode {
	type: string;
	props: Record<string, unknown>;
	children: Array<WebNode | string>;
}

/** Dónde materializa el webview un root remoto (espejo de src/web-protocol.ts). */
export type WebPlacement = "overlay" | "footer" | "composer";

/** Diálogo data-oriented del ExtensionUIContext (pi.ui.select/input/confirm).
 *  Las extensiones nativas en modo RPC (rpiv-ask-user-question) las enrutan aquí
 *  en vez de la factory Ink del TUI. El webview renderiza según `method`. */
export interface UiRequest {
	id: string;
	method: "select" | "input" | "confirm";
	title: string;
	/** select: opciones ya formateadas por la extensión. */
	options?: string[];
	/** input: placeholder/prefill. */
	placeholder?: string;
	/** confirm: cuerpo del mensaje. */
	message?: string;
}

/** Opción de pregunta (ask_user_question nativo, ADR-0027). Espeja el host. */
export interface WebQuestionOption {
	label: string;
	description: string;
	/** Markdown opcional (single-select): se muestra al enfocar la opción. */
	preview?: string;
}
export interface WebQuestionSpec {
	question: string;
	header: string;
	multiSelect?: boolean;
	options: WebQuestionOption[];
}
export interface WebQuestionAnswer {
	questionIndex: number;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
}

export interface Usage {
	// Tokens acumulados de la sesión (estilo pi: ↑/↓/R/W/CH)
	inputTotal: number; // ↑ input acumulado
	outputTotal: number; // ↓ output acumulado
	cacheRead: number; // R cache read acumulado
	cacheWrite: number; // W cache write acumulado
	cacheHitRate?: number; // CH% del último request
	cost: number; // $ (0 si no aplica)
	// Contexto actual (barra)
	contextTokens: number; // tokens que ocupan el contexto vivo
	contextWindow: number;
	contextPercent: number | null; // % de la ventana bruta (null = desconocido, post-compactación)
	// Presión ajustada por el reserve de compactación (paridad frida-context). La
	// barra la usa para anticipar la compactación; >100% ⇒ compactar ya.
	pressurePercent?: number | null;
	reserveTokens?: number;
	// Duración de la sesión (primer→último mensaje, epoch ms), para el header.
	// Se reconstruye del JSONL en disco vía readSessionStats (robusto ante
	// compactación/reload) y se combina con el estado en memoria (último turno).
	sessionDurationMs?: number;
	turnInput?: number; // delta de usage del turno (para atribución ~llm)
	turnOutput?: number;
}

// === Reporte de uso (tab "Uso") — espeja UsageSnapshot del host (build separado) ===

export type UsagePeriod = "today" | "7d" | "30d" | "all";

export interface UsageKpisView {
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	sessions: number;
	turns: number;
	activeMs: number;
	cacheHitPct: number;
	avgTurnTokens: number;
}
export interface UsageByModel {
	model: string;
	provider: string;
	tokens: number;
	cost: number;
	turns: number;
}
export interface UsageByTool {
	tool: string;
	count: number;
	tokens: number;
}
export interface UsageByFileType {
	fileType: string;
	family: string;
	files: number;
	edits: number;
	assistedKloc: number;
	tokens: number;
}
export interface UsageByArtifact {
	kind: string;
	count: number;
}
export interface UsageByDay {
	date: string;
	tokens: number;
	cost: number;
	turns: number;
}
export interface UsageSession {
	path: string;
	name?: string;
	firstMessage: string;
	cwd: string;
	firstTs: number;
	lastTs: number;
	tokensIn: number;
	tokensOut: number;
	cost: number;
	turns: number;
	assistedKloc: number;
}
export interface UsageReportView {
	kpis: UsageKpisView;
	breakdowns: {
		byModel: UsageByModel[];
		byProvider: { provider: string; tokens: number; cost: number }[];
		byTool: UsageByTool[];
		byFileType: UsageByFileType[];
		byArtifact: UsageByArtifact[];
		byDay: UsageByDay[];
		byHour: number[];
		byDow: number[];
	};
	behavior: {
		compactations: number;
		subagentsLaunched: number;
		questionsAsked: number;
	};
	adoption: {
		browserUsed: boolean;
		subagentsUsed: boolean;
		contextToolUsed: boolean;
	};
	sessions: UsageSession[];
}

export interface SessionItem {
	path: string;
	/** cwd donde inició la sesión (para filtrar/etiquetar por proyecto). */
	cwd: string;
	name?: string;
	firstMessage: string;
	messageCount: number;
	modified: number; // epoch ms
	/** Duración primer→último mensaje (epoch ms), del JSONL en disco. */
	durationMs?: number;
	inputTotal?: number;
	outputTotal?: number;
}

// Recursos cargados por el resourceLoader de pi (ver panel de recursos).
export interface ResourceExtension {
	path: string;
	inline: boolean;
	tools?: string[];
	commands?: string[];
}
/** Procedencia de un recurso. Para skills: extensión (frida-pipeline),
 *  global (~/.frida), proyecto (.frida/.pi en el cwd) o path (adicional).
 *  Para comandos: built-in (host) o extensión (registrado vía API de Pi). */
export type ResourceOrigin =
	| "extension"
	| "global"
	| "project"
	| "path"
	| "built-in";

export interface ResourceSummary {
	extensions: ResourceExtension[];
	skills: {
		name: string;
		description: string;
		source: Exclude<ResourceOrigin, "built-in">;
		path: string;
	}[];
	prompts: { name: string; description: string }[];
	themes: { name: string }[];
	/** Comandos slash: built-in del host (fuente única: BUILTIN_COMMANDS en
	 *  extension.ts) o de extensión. Se muestran en Recursos > Comandos y
	 *  alimentan el autocompletado de "/" del Composer. */
	commands: {
		name: string;
		description: string;
		argumentHint?: string;
		source: "built-in" | "extension";
		/** Nombre legible de la extensión que aporta el comando (sólo source=extension). */
		extension?: string;
	}[];
	contextFiles: { path: string }[];
	errors: { path: string; error: string }[];
}

/** Conteo de cambios del árbol de trabajo (parse de `git status --porcelain`). */
export interface WorkspaceDiff {
	added: number;
	modified: number;
	deleted: number;
}

export interface WorkspaceInfo {
	cwd: string;
	branch?: string;
	dirty?: boolean;
	sessionName?: string;
	/** Path del archivo de la sesión activa (para renombrar in-place, issue #4). */
	sessionPath?: string;
	/** Conteo de archivos added/modified/deleted. */
	diff?: WorkspaceDiff;
	/** Commits adelantados / atrasados vs upstream (origin). */
	ahead?: number;
	behind?: number;
}

// Selector de proveedor/modelo (fase 2: multi-proveedor + GitHub Copilot).
export interface ModelOption {
	id: string;
	name: string;
	/** Metadatos del modelo del SDK (ADR-0018 Fase C: info rica en el selector). */
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	input?: ("text" | "image")[];
}
export interface ProviderOption {
	id: string;
	name: string;
	oauth: boolean; // autenticación por suscripción (OAuth) vs API key
	apiKey: boolean; // autenticación por API key (DevEngine/z.ai) → botón "Key"
	authed: boolean; // ¿tiene credenciales válidas?
	models: ModelOption[];
}

export type ApprovalMode = "manual" | "auto-edit" | "auto";

/** Stats footer (Fase 3): contadores del gate de la sesión actual. */
export interface GateStats {
	allow: number;
	block: number;
	autoAllow: number;
}

// Toggles de la Configuración (qué tools del agente están activos).
export interface ToolToggles {
	askUserQuestion: boolean;
	todo: boolean;
}

// D16 — resumen de diagnósticos de pi-lens para un turno (publicado por el host
// en turn_end/agent_end). NO son squiggles del editor; es visibilidad en el panel
// de lo que pi-lens calculó.
export interface LensFileSummary {
	path: string;
	errors: number;
	warnings: number;
	others: number;
	truncated: boolean;
}
export interface LensSummary {
	files: LensFileSummary[];
	totalErrors: number;
	totalWarnings: number;
	totalOthers: number;
	fileCount: number;
	truncated: boolean;
}

// Reintento automático del provider (auto_retry_start/end del SDK): el gateway
// devolvió un error retriable y el SDK reintentará con backoff. Equivalente al
// RetryStatusIndicator del TUI (countdown + cancelar).
export interface RetryState {
	attempt: number;
	maxAttempts: number;
	delayMs: number;
}

// Badge de pi-lens en el sub-header: loaded = está cargado como extensión;
// active = el pipeline emitió al menos un diagnóstico en la sesión.
export interface LensStatus {
	loaded: boolean;
	active: boolean;
}

export interface State {
	keyNeeded: boolean;
	busy: boolean;
	/** Subagentes en background corriendo (alimenta el indicador "N en curso"). */
	backgroundRunning?: number;
	mode: ApprovalMode;
	/** Stats footer (Fase 3): contadores del gate (✓N aprobadas / ✗M bloqueadas / ⚡Z auto). */
	gateStats?: GateStats;
	info?: { text: string; level: ToastLevel };
	model?: string;
	provider?: string;
	thinking?: string;
	/** Versión instalada de la extensión (badge del sub-header + /version). */
	version?: string;
	turns: Turn[];
	approvals: ApprovalRequest[];
	/** Confirmaciones de cambio de proveedor pendientes (red de seguridad). */
	modelChanges: ModelChangeRequest[];
	uiRequests: UiRequest[];
	/** Cuestionario ask_user_question activo (ADR-0027): QuestionsPanel nativo.
	 *  null = sin cuestionario pendiente. */
	questionnaire?: { id: string; questions: WebQuestionSpec[] } | null;
	/** Árbol Remote React actual (null = sin UI remota activa). */
	/** Roots Remote React activos, keyados por rootId, cada uno con su zona
	 *  ("overlay" = cuerpo/diálogo, "footer" = panel inferior). Coexisten. */
	webRoots?: Record<string, { tree: WebNode | null; placement: WebPlacement }>;
	usage?: Usage;
	usageReport?: {
		report: UsageReportView;
		period: UsagePeriod;
		scope: "project" | "all";
		periodFrom: number;
		periodTo: number;
	};
	files?: { query: string; items: string[] };
	sessions?: {
		items: SessionItem[];
		currentPath?: string;
		scope?: "project" | "all";
	};
	resources?: ResourceSummary;
	workspace?: WorkspaceInfo;
	models?: {
		providers: ProviderOption[];
		active?: { provider: string; modelId: string };
		/** ADR-0018 Fase B: estado del refresh asíncrono de catálogos. */
		refreshing?: boolean;
		refreshErrors?: string[];
	};
	forkPoints?: { entryId: string; text: string }[];
	oauthDeviceCode?: { userCode: string; verificationUri: string };
	queued: string[];
	isCompacting: boolean;
	compactReason?: CompactionReason;
	compactions: CompactionEntry[];
	branchSummaries: BranchSummaryEntry[];
	toolToggles?: ToolToggles;
	lens?: LensSummary | null;
	retry?: RetryState | null;
	/** Error efímero del provider (401/500/"sin respuesta"): banner en el footer,
	 *  NO en la conversación. Se limpia al recibir respuesta exitosa o nuevo run. */
	providerError?: string;
	lensStatus?: LensStatus;
	/** Texto a insertar en el composer (vía un overlay, p.ej. SkillsPanel al hacer
	 *  clic en "insertar $name"). `n` es un nonce: cada inserción lo incrementa para
	 *  que el useEffect del Composer dispare aun cuando el texto sea idéntico. */
	composerInsert?: { text: string; n: number };
	nextId: number;
}

// Host → webview
export type InMessage =
	| { type: "need_key" }
	| { type: "key_set" }
	| { type: "session_ready" }
	| { type: "user"; text: string; images?: ImageAttachment[] }
	| { type: "agent_busy"; busy: boolean }
	| { type: "agents_running"; count: number }
	| { type: "turn_active" }
	| { type: "delta"; text: string }
	| { type: "thinking_delta"; text: string }
	| { type: "tool_start"; tool: string; args?: unknown; toolCallId?: string }
	| {
			type: "tool_update";
			tool: string;
			toolCallId?: string;
			partial?: string;
			details?: SubagentProgressDetails;
	  }
	| {
			type: "tool_end";
			tool: string;
			isError?: boolean;
			result?: string;
			diff?: string;
			toolCallId?: string;
	  }
	| { type: "bash_start"; command: string; excludeFromContext: boolean }
	| { type: "bash_chunk"; text: string }
	| {
			type: "bash_end";
			exitCode?: number;
			cancelled?: boolean;
			truncated?: boolean;
			fullOutputPath?: string;
	  }
	| { type: "queued"; items: string[] }
	| { type: "approvals"; approvals: ApprovalRequest[] }
	| { type: "model_changes"; items: ModelChangeRequest[] }
	| { type: "ui_requests"; items: UiRequest[] }
	| {
			type: "questionnaire";
			req: { id: string; questions: WebQuestionSpec[] } | null;
	  }
	| { type: "ui_notify"; message: string; level: "info" | "warning" | "error" }
	| {
			type: "web_commit";
			rootId: string;
			tree: WebNode | null;
			placement?: WebPlacement;
	  }
	| { type: "info"; text: string; level?: ToastLevel }
	| { type: "notice"; text: string }
	| { type: "provider_error"; text: string }
	| { type: "cleared" }
	| ({ type: "usage" } & Usage)
	| {
			type: "usage_report";
			report: UsageReportView;
			period: UsagePeriod;
			scope: "project" | "all";
			periodFrom: number;
			periodTo: number;
	  }
	| { type: "compact_start"; reason: CompactionReason }
	| {
			type: "compact_end";
			reason: CompactionReason;
			aborted: boolean;
			tokensBefore?: number;
			summary?: string;
			errorMessage?: string;
	  }
	| { type: "files"; query: string; items: string[] }
	| {
			type: "sessions";
			items: SessionItem[];
			currentPath?: string;
			scope?: "project" | "all";
	  }
	| { type: "resources"; data: ResourceSummary }
	| {
			type: "workspace";
			cwd: string;
			branch?: string;
			dirty?: boolean;
			sessionName?: string;
			sessionPath?: string;
			diff?: WorkspaceDiff;
			ahead?: number;
			behind?: number;
	  }
	| {
			type: "models";
			providers: ProviderOption[];
			active?: { provider: string; modelId: string };
			refreshing?: boolean;
			refreshErrors?: string[];
	  }
	| { type: "open_models" }
	| { type: "refresh_models" }
	| { type: "oauth_device_code"; userCode: string; verificationUri: string }
	| { type: "oauth_clear" }
	| { type: "fork_points"; points: { entryId: string; text: string }[] }
	| {
			type: "history";
			name?: string;
			items: HistoryItem[];
			branchSummaries?: BranchSummaryEntry[];
	  }
	| { type: "mode"; mode: ApprovalMode }
	| { type: "gate_stats"; stats: GateStats }
	| { type: "version"; version: string }
	| { type: "model_info"; provider?: string; model: string; thinking: string }
	| { type: "tool_toggles"; askUserQuestion: boolean; todo: boolean }
	| { type: "lens_diagnostics"; summary: LensSummary | null }
	| {
			type: "retry_start";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
	  }
	| { type: "retry_end"; success: boolean }
	| { type: "lens_status"; loaded: boolean; active: boolean }
	| { type: "composer_insert"; text: string }
	| { type: "error"; text: string };

// webview → host
export type OutMessage =
	| { type: "webview_ready" }
	| {
			type: "submit";
			text: string;
			mode: "steer" | "followUp";
			images?: ImageAttachment[];
	  }
	| {
			type: "approval_response";
			id: string;
			decision: "accept" | "reject";
			acceptAll?: boolean;
			pattern?: string;
			reason?: string;
	  }
	| {
			type: "ui_response";
			id: string;
			value?: string;
			cancelled: boolean;
	  }
	| {
			type: "model_change_response";
			id: string;
			decision: "accept" | "cancel";
	  }
	| {
			type: "questionnaire_answer";
			id: string;
			cancelled: boolean;
			answers: WebQuestionAnswer[];
	  }
	| {
			type: "web_event";
			rootId: string;
			handlerId: string;
			payload: { value?: string; checked?: boolean };
	  }
	| { type: "set_key"; provider: string; key: string }
	| { type: "rotate_key"; provider?: string }
	| { type: "discover_models"; provider: string }
	| { type: "copy_text"; text: string }
	| { type: "compact" }
	| { type: "cancel_compaction" }
	| { type: "reload" }
	| { type: "abort" }
	| { type: "abort_diag"; text: string }
	| { type: "new_session" }
	| { type: "search_files"; query: string }
	| { type: "list_sessions"; scope?: "project" | "all" }
	| { type: "list_resources" }
	| { type: "list_usage"; period: UsagePeriod; scope: "project" | "all" }
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
	| { type: "set_thinking"; level: string }
	| {
			type: "set_tool_toggle";
			key: "askUserQuestion" | "todo";
			enabled: boolean;
	  };
