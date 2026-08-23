// Protocolo postMessage host ↔ webview + estado.

// Cola de mensajes encolados (issue #45): id estable para acciones del panel
// (quitar/editar/mover), mode = cómo se entregará (paridad con el SDK).
export interface QueueItem {
	id: string;
	text: string;
	mode: "steer" | "followUp";
}

export type ToolState = "running" | "ok" | "error";

/** Nivel de un toast: error y warning NO se auto-cierran (cierre manual); info/success sí (4.5s). */
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
	/** #107 — epoch ms del envío del mensaje user (apertura del turno). Lo usa
	 *  el header para el timer en vivo del turno en curso (ahora − startedAt).
	 *  0 en turns reconstruidos del historial (sin timestamp transportado):
	 *  el total cerrado ya viene del JSONL vía usage.activeMs. */
	startedAt?: number;
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
	// #107 — Tiempo ACTIVO (Σ duraciones de turnos cerrados, sin gaps de
	// lectura) + conteo + duraciones individuales (sparkline del popover).
	// Fuente: readSessionStats (JSONL). El turno en curso lo suma el webview
	// en vivo (ahora − ts del user msg) mientras busy.
	activeMs?: number;
	turnCount?: number;
	turnDurations?: number[];
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

// ── /tree (#126): árbol de la sesión activa ──
// Nodo serializado por el host (serializeTreeNode): sólo los campos que la UI
// necesita. La forma espeja SessionTreeNode del SDK, con preview corto y kind
// normalizado para iconos/filtros (paridad TreeSelectorComponent de Pi).
export type TreeEntryKind =
	| "user"
	| "assistant"
	| "toolResult"
	| "branchSummary"
	| "compaction"
	| "modelChange"
	| "thinking"
	| "customMessage"
	| "other";

export interface TreeEntryNode {
	id: string;
	parentId: string | null;
	timestamp: string;
	/** Etiqueta de checkpoint (label entry del SDK), si la entrada tiene una. */
	label?: string;
	kind: TreeEntryKind;
	/** Preview corto del contenido (≤160 chars, host-side). */
	text: string;
	/** Assistant: tiene partes de texto (para el filtro default de Pi). */
	hasText?: boolean;
	/** Assistant: número de tool_calls en el mensaje. */
	toolCalls?: number;
	/** Assistant: stopReason (error/abort visibles en modo default). */
	stopReason?: string;
	/** custom_message: display del entry (false = material interno del host). */
	display?: boolean;
	children: TreeEntryNode[];
}

/** Snapshot del árbol publicado por el host al abrir /tree. */
export interface TreeData {
	nodes: TreeEntryNode[];
	/** Hoja activa (posición actual de la sesión). */
	leafId: string | null;
	sessionName?: string;
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
	/** #54 — Recursos por módulo frida para el acordeón de Configuración >
	 *  Herramientas (toggles #53 + módulos base). Lo general queda en las
	 *  secciones de arriba. */
	modules?: ModuleResources[];
}

/** Recursos atribuidos a un módulo frida (toggle o base), issue #54. */
export interface ModuleResources {
	/** Key del toggle (#53) o factory para los módulos base. */
	module: string;
	title: string;
	desc: string;
	/** true = conmutable (toggle); false = módulo base. */
	toggleable: boolean;
	tools: string[];
	commands: string[];
	skills: string[];
	prompts: string[];
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
	/** Nombre del worktree vinculado si el cwd es uno (undefined en el checkout principal). Issue #13. */
	worktreeName?: string;
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

/** #121 (F7) — snapshot de la config de roles para la UI. */
export interface ModelRolesUi {
	/** Switch maestro: OFF = todo por el modelo activo (modo clásico). */
	enabled: boolean;
	/** Rol Rápido (subagents/extracciones). null = hereda default. */
	smol: { provider: string; modelId: string } | null;
	/** Rol Commits (changelogs). null = hereda default. */
	commit: { provider: string; modelId: string } | null;
	/** Respaldo por turno: cadena al siguiente proveedor autenticado. */
	fallbackEnabled: boolean;
}

export type ApprovalMode = "manual" | "auto-edit" | "auto";

/** Stats footer (Fase 3): contadores del gate de la sesión actual. */
export interface GateStats {
	allow: number;
	block: number;
	autoAllow: number;
}

// Toggles de la Configuración (qué módulos del agente están activos, #53).
// El host publica valores + descriptores desde el registro central
// (src/tool-toggles.ts); la UI no duplica la lista.
export interface ToolToggleDescriptor {
	key: string;
	title: string;
	desc: string;
}
export type ToolToggles = Record<string, boolean>;

// ── Panel de auto-aprobación (#55): snapshot publicado por el host ──
// Espejo del config-store (fuente de verdad en el host); el gate lee esa misma
// política en cada tool_call, así que lo que ves acá es lo que aplica YA.

/** Tri-state de permiso (paridad con el motor declarativo). */
export type PermState = "allow" | "ask" | "deny";

/** Snapshot de `~/.frida/permission.json` + modo vivo, para el panel. */
export interface PermissionsConfigUi {
	mode: ApprovalMode;
	auditLog: boolean;
	tool: Record<string, PermState>;
	path: Record<string, PermState>;
	bash: Record<string, PermState>;
	externalDirectory: PermState;
}

/** Patrón aprobado en la sesión (en memoria, revocable desde el panel). */
export interface SessionPatternUi {
	kind: "tool" | "diff" | "bash";
	pattern: string;
}

/** Estado publicado por el host para el tab "Index" del SettingsHub. */
export interface CodebaseIndexUiState {
	/** Paquete upstream instalado al pin (y tools capturadas). */
	installed: boolean;
	/** Versión instalada del paquete upstream. */
	version?: string;
	capturedTools?: string[];
	/** Acción en curso (botones deshabilitados). */
	busy?: "install" | "index" | null;
	/** Epoch ms del inicio de la acción en curso (#111): el reloj de la
	 *  tarjeta deriva de aquí y así SOBREVIVE cambios de pestaña (remount). */
	busySince?: number | null;
	/** Última línea de progreso/resultado/error (guía incluida). */
	lastLine?: string;
	/** Provider/modelo/dimensiones REALES del índice construido (#114),
	 *  leídos de su metadata. Ausente si no hay índice o sin claves. */
	indexMeta?: {
		provider: string;
		model: string;
		dimensions: number;
	};
	/** Progreso en vivo de la indexación (#109) — null cuando el coordinador
	 *  aún no reporta (la barra se muestra indeterminada). */
	progress?: {
		phase: string;
		percentage: number;
		filesProcessed: number;
		totalFiles: number;
		chunksProcessed: number;
		totalChunks: number;
	} | null;
	/** Último archivo confirmado durante la indexación (#118). */
	lastFile?: string | null;
	/** #120 — indexación automática activa del proyecto (indexing.autoIndex). */
	autoIndex?: boolean;
	/** Configuración activa del motor de embeddings (#100; modelos #116). */
	config?: {
		provider: "auto" | "frida-enterprise" | "ollama" | "openai" | "custom";
		/** ¿Existe sesión OAuth de Frida Enterprise viva? (Fase B semáforo) */
		enterpriseAuthed?: boolean;
		fridaEnterpriseModel?: string;
		ollamaModel?: string;
		openaiModel?: string;
		/** ¿Hay API key de OpenAI guardada en Frida? */
		openaiAuthed?: boolean;
		customBaseUrl?: string;
		customModel?: string;
		customDimensions?: number;
	};
}

export type DependencyCategory = "core" | "extension" | "optional";
export type SupportedPlatform = "win32" | "darwin" | "linux";

export interface InstallGuide {
	command: string;
	guide?: string;
	url?: string;
}

export interface DependencyStatus {
	id: string;
	name: string;
	category: DependencyCategory;
	installed: boolean;
	version?: string;
	path?: string;
	description: string;
	usedBy: string;
	notes?: string;
	installGuides: Record<SupportedPlatform, InstallGuide>;
}

export interface EnvironmentReport {
	platform: SupportedPlatform;
	platformLabel: string;
	arch: string;
	checkedAt: number;
	readyCount: number;
	totalCount: number;
	coreReady: boolean;
	dependencies: DependencyStatus[];
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

// #20 — snapshot del goal activo publicado por frida-goal (chip 🎯 del footer).
// undefined = sin goal; status complete llega una vez (con resumen) y luego se
// limpia desde el host.
export interface GoalState {
	id: string;
	text: string;
	status: "active" | "paused" | "blocked" | "complete";
	iteration: number;
	automaticTurns: number;
	tokensUsed: number;
	tokenBudget?: number;
	pausedReason?: string;
	blockedReason?: string;
	completionSummary?: string;
	updatedAt: number;
}

/** Fila del panel /ccplugin (serializada del host — panel.ts). */
export interface CcPanelRowWs {
	ref: string;
	label: string;
	version?: string;
	status: "available" | "installed" | "disabled";
	markdown: string;
	category?: string;
	author?: string;
	homepage?: string;
	/** Llega async vía ccplugins_row_meta (git log cacheado). */
	lastUpdated?: string;
	/** Solo instaladas: chips compactos (skill/cmd/mcp). */
	components?: string[];
	/** Costo de contexto estimado (tokens/turno). */
	tokens?: number;
	/** Dir real de instalación. */
	path?: string;
	description?: string;
}

/** Recurso instalado (skill/command/MCP — unidad de la tab Instalados). */
export interface CcInstalledResourceWs {
	pluginRef: string;
	plugin: string;
	name: string;
	kind: "skill" | "cmd" | "mcp";
	status: "installed" | "disabled";
	tokens?: number;
	path?: string;
	description?: string;
}

/** Tarjeta de marketplace (tab Marketplaces). */
export interface CcMarketplaceWs {
	name: string;
	url: string;
	plugins: number;
	refreshedAt?: string;
	autoUpdate: boolean;
}

/** Entrada de error (tab Errores). */
export interface CcPanelErrorWs {
	id: string;
	when: string;
	source: "bootstrap" | "marketplace" | "install";
	message: string;
}

/** Panel /ccplugin abierto (null = cerrado) — tabs completas. */
/** frida-sandboxes (#35): fila del panel /sandbox (serializable). */
export interface SandboxInfoWs {
	name: string;
	image: string;
	state: "active" | "paused";
	createdAt: string;
	projectDir: string;
	createdBy: string;
	lastSeen?: string;
}

export interface SandboxPanelWs {
	id: string;
	title: string;
	sandboxes: SandboxInfoWs[];
	docker: { available: boolean; reason?: string };
}

/** frida-subagents #26: fila del panel /detached (serializable). */
export interface DetachedRunWs {
	id: string;
	name: string;
	agentType: string;
	model?: string;
	status: "running" | "completed" | "failed" | "killed" | "orphaned" | "lost";
	startedAt: number;
	endedAt?: number;
	turnCount: number;
	toolUses: number;
	tokensIn: number;
	tokensOut: number;
	activity: string;
	text: string;
	promptPreview: string;
	failureReason?: string;
}

export interface DetachedPanelWs {
	id: string;
	title: string;
	runs: DetachedRunWs[];
}

export interface CcPanelWs {
	id: string;
	/** Interna: true = patch async (row_meta) — NO limpia pendientes. */
	_patch?: true;
	title: string;
	rows: CcPanelRowWs[];
	installed: CcPanelRowWs[];
	resources: CcInstalledResourceWs[];
	marketplaces: CcMarketplaceWs[];
	errors: CcPanelErrorWs[];
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
	/** Panel /ccplugin activo (UX #49): lista filtrable + ficha lado a lado.
	 *  null = cerrado. */
	ccPanel?: CcPanelWs | null;
	sbxPanel?: SandboxPanelWs | null;
	dtPanel?: DetachedPanelWs | null;
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
		/** #121 (F7) — config de roles de modelo para el panel. */
		roles?: ModelRolesUi;
	};
	/** #121 — preferencias de UI persistidas (Transcript). */
	ui?: {
		/** Ocultar el razonamiento del modelo en el transcript. */
		hideThinking?: boolean;
	};
	/** #20 — snapshot del goal activo (chip 🎯 del footer); undefined = sin goal. */
	goal?: GoalState;
	forkPoints?: { entryId: string; text: string }[];
	/** /tree (#126): árbol de la sesión activa publicado por el host. */
	treeData?: TreeData;
	oauthDeviceCode?: { userCode: string; verificationUri: string };
	queued: QueueItem[];
	isCompacting: boolean;
	compactReason?: CompactionReason;
	compactions: CompactionEntry[];
	branchSummaries: BranchSummaryEntry[];
	toolToggles?: ToolToggles;
	/** Descriptores de toggles (título/desc) publicados por el host (#53). */
	toolToggleDefs?: ToolToggleDescriptor[];
	/** Snapshot del panel de auto-aprobación (#55). */
	permissions?: PermissionsConfigUi;
	sessionPatterns?: SessionPatternUi[];
	/** Estado del índice de código (frida-codebase-index) para el tab Index. */
	codebaseIndex?: CodebaseIndexUiState;
	/** Archivos presentes en el índice (#112) — respuesta a action:"files". */
	codebaseIndexFiles?: {
		available: boolean;
		files: { path: string; chunks: number; language: string }[];
		failed: { path: string; chunks: number }[];
	};
	/** Último resultado de Ping por proveedor (#116 Fase A). */
	codebaseIndexPing?: {
		provider: string;
		ok: boolean;
		latencyMs?: number;
		dimensions?: number;
		error?: string;
		at: number;
	};
	/** Reporte de diagnóstico del entorno y dependencias del sistema (#99). */
	environment?: EnvironmentReport;
	environmentChecking?: boolean;
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
	| { type: "ccplugins_panel"; panel: CcPanelWs | null }
	| { type: "sandbox_panel"; panel: SandboxPanelWs | null }
	| { type: "detached_panel"; panel: DetachedPanelWs | null }
	| {
			/** Patch async: "Last updated" de una fila (git log). */
			type: "ccplugins_row_meta";
			id: string;
			ref: string;
			lastUpdated: string;
	  }
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
	| { type: "queued"; items: QueueItem[] }
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
	| { type: "clear_provider_error" }
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
			/** #121 (F7) — config de roles de modelo (lo que el usuario puso). */
			roles?: ModelRolesUi;
	  }
	| {
			/** #121 — preferencias de UI persistidas (Transcript). */
			type: "ui_prefs";
			hideThinking?: boolean;
	  }
	| { type: "open_models" }
	| { type: "refresh_models" }
	| { type: "oauth_device_code"; userCode: string; verificationUri: string }
	| { type: "oauth_clear" }
	| { type: "fork_points"; points: { entryId: string; text: string }[] }
	| {
			/** /tree (#126): snapshot del árbol de la sesión activa. */
			type: "tree_data";
			nodes: TreeEntryNode[];
			leafId: string | null;
			sessionName?: string;
	  }
	| {
			type: "history";
			name?: string;
			items: HistoryItem[];
			branchSummaries?: BranchSummaryEntry[];
	  }
	| { type: "mode"; mode: ApprovalMode }
	| { type: "gate_stats"; stats: GateStats }
	| { type: "version"; version: string }
	| { type: "goal_state"; goal: GoalState | null }
	| { type: "model_info"; provider?: string; model: string; thinking: string }
	| { type: "tool_toggles"; values: ToolToggles; defs: ToolToggleDescriptor[] }
	| {
			type: "permissions_config";
			config: PermissionsConfigUi;
			sessionPatterns: SessionPatternUi[];
	  }
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
	| { type: "open_settings"; tab?: string }
	| { type: "codebase_index_state"; state: CodebaseIndexUiState }
	| {
			type: "codebase_index_ping_result";
			provider: string;
			ok: boolean;
			latencyMs?: number;
			dimensions?: number;
			error?: string;
	  }
	| {
			type: "codebase_index_files";
			available: boolean;
			files: { path: string; chunks: number; language: string }[];
			failed: { path: string; chunks: number }[];
	  }
	| { type: "environment_status"; status: EnvironmentReport }
	| { type: "environment_checking"; checking: boolean }
	| { type: "error"; text: string };

// webview → host
export type OutMessage =
	| { type: "webview_ready" }
	| {
			type: "ccplugins_panel_action";
			id: string;
			action:
				| "install"
				| "uninstall"
				| "enable"
				| "disable"
				| "mkt_add"
				| "mkt_remove"
				| "mkt_update"
				| "retry";
			ref?: string;
			/** mkt_add: spec; mkt_remove/update: nombre. */
			value?: string;
			name?: string;
			source?: string;
	  }
	| { type: "ccplugins_panel_close"; id: string }
	| {
			type: "sandbox_panel_action";
			id: string;
			action: "refresh" | "pause" | "resume" | "destroy" | "reprobe";
			name?: string;
	  }
	| { type: "sandbox_panel_changes"; id: string; name: string }
	| { type: "sandbox_panel_merge"; id: string; name: string; files: string[] }
	| { type: "sandbox_panel_terminal"; id: string; name: string }
	| { type: "sandbox_panel_close"; id: string }
	| {
			type: "detached_panel_action";
			id: string;
			action: "refresh" | "stop";
			runId?: string;
	  }
	| { type: "detached_panel_close"; id: string }
	| { type: "ccplugins_row_meta"; id: string; ref: string }
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
	| { type: "clear_provider_error" }
	| { type: "queue_remove"; id: string }
	| { type: "queue_edit"; id: string }
	| { type: "queue_move"; id: string; dir: -1 | 1 }
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
	| { type: "tree" }
	| {
			/** /tree: confirmar navegación a una entrada (misma sesión). */
			type: "tree_navigate";
			entryId: string;
			/** Resumir la rama abandonada (branch summary). */
			summarize?: boolean;
			customInstructions?: string;
	  }
	| {
			/** /tree: poner/quitar etiqueta de checkpoint en una entrada. */
			type: "tree_label";
			entryId: string;
			/** Vacío/undefined limpia la etiqueta. */
			label?: string;
	  }
	| { type: "switch_session"; path: string }
	| { type: "rename_session"; path: string; name: string }
	| { type: "delete_session"; path: string }
	| { type: "set_mode"; mode: ApprovalMode }
	| { type: "set_thinking"; level: string }
	| {
			type: "set_tool_toggle";
			key: string;
			enabled: boolean;
	  }
	// ── Panel de auto-aprobación (#55): mismos setters que el puente del host ──
	| { type: "get_permissions_config" }
	| { type: "perm_set_tool"; tool: string; state: PermState }
	| { type: "perm_set_path"; pattern: string; state: PermState }
	| { type: "perm_remove_path"; pattern: string }
	| { type: "perm_set_bash"; pattern: string; state: PermState }
	| { type: "perm_remove_bash"; pattern: string }
	| { type: "perm_set_external"; state: PermState }
	| { type: "perm_set_audit"; enabled: boolean }
	| { type: "perm_reset" }
	| {
			type: "perm_revoke_session_pattern";
			kind: SessionPatternUi["kind"];
			pattern: string;
	  }
	| {
			type: "codebase_index_action";
			action: "install" | "index" | "rebuild" | "status" | "files" | "stop";
	  }
	| {
			/** #120 — toggle de indexación automática (indexing.autoIndex del
			 *  config.json del proyecto). enabled=false apaga. */
			type: "codebase_index_autoindex";
			enabled: boolean;
	  }
	| {
			/** #116 Fase A — Ping de conectividad del proveedor de embeddings. */
			type: "codebase_index_ping";
			provider: "frida-enterprise" | "ollama" | "openai" | "custom";
			model?: string;
	  }
	| {
			/** #117 Fase B — elegir proveedor/modelo: persiste settings + sync
			 *  config.json. Con rebuild=true dispara reconstrucción (modal). */
			type: "codebase_index_select";
			provider: "auto" | "frida-enterprise" | "ollama" | "openai" | "custom";
			model?: string;
			rebuild?: boolean;
	  }
	| {
			/** #121 (F7) — la UI cambia la config de roles; el host persiste en
			 *  settings y re-publica el estado de modelos. */
			type: "model_roles_set";
			enabled?: boolean;
			smol?: { provider: string; modelId: string } | null;
			commit?: { provider: string; modelId: string } | null;
			fallbackEnabled?: boolean;
	  }
	| {
			/** #121 — toggle de Transcript (Configuración → Modelos): ocultar el
			 *  razonamiento del modelo en los turnos. Persistido por el host. */
			type: "ui_hide_thinking_set";
			value: boolean;
	  }
	| { type: "check_environment" };
