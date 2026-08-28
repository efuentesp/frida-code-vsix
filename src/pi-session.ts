import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listProjectExtensionFiles } from "./extension-paths";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	buildSofttekProviderConfig,
	type CanonicalModelMeta,
	createSofttekProviderHooks,
	DEVENGINE_BASE_URL,
	fetchDevengineModelsContext,
	lookupCanonicalModelMeta,
	SOFTTEK_MODEL,
	SOFTTEK_MODELS,
	SOFTTEK_PROVIDER,
} from "./providers/softtek-provider";
import {
	createProviderAuditHooks,
	defaultProviderAuditDeps,
} from "./providers/provider-audit";
import { resolveActiveModel } from "./resolve-active-model";
import {
	KNOWN_MODEL_PROVIDERS,
	pickChildModel,
	pickStartupFallback,
	resolveModelRoles,
	type ModelRolesConfig,
	type ResolvedRole,
} from "./model-roles";
import {
	buildZaiCatalogOverride,
	createZaiProviderHooks,
	discoverZaiModels,
	ZAI_PROVIDER,
} from "./providers/z-ai-provider";
import {
	buildFridaEnterpriseProviderConfig,
	createFridaEnterpriseHooks,
	patchFridaSideChannelsOn,
	FRIDA_ENTERPRISE_PROVIDER,
} from "./providers/frida-enterprise";
import {
	buildAntigravityProviderConfig,
	ANTIGRAVITY_PROVIDER,
} from "./providers/frida-antigravity";
import {
	buildOllamaProviderConfig,
	OLLAMA_PROVIDER,
	type OllamaLocalModelDef,
} from "./providers/frida-ollama-local/catalog";
import { discoverOllamaLocalModels } from "./providers/frida-ollama-local/discover";
import {
	buildOllamaCloudProviderConfig,
	OLLAMA_CLOUD_BASE_URL,
	OLLAMA_CLOUD_PROVIDER,
	type OllamaCloudModelDef,
} from "./providers/frida-ollama-cloud/catalog";
import { discoverOllamaCloudModels } from "./providers/frida-ollama-cloud/discover";
import { API_KEY_PROVIDER_IDS } from "./providers/api-key-providers";
import { OPENAI_PROVIDER } from "./providers/openai-provider";
import { createPermissionSystem } from "./tools/frida-permission-system";
import { GateStatsStore } from "./tools/frida-permission-system/session-store";
import { SessionApprovals } from "./tools/frida-permission-system/session-approvals";
import { getConfig } from "./tools/frida-permission-system/config-store";
import type {
	GateStats,
	PermissionMode,
} from "./tools/frida-permission-system";
import { ApprovalLogger } from "./gates/approval-logger";
import { ApprovalBridge, type ApprovalRequest } from "./approval-bridge";
import {
	readDevengineConfig,
	readModelRolesConfig,
	readZaiConfig,
	type GatePatterns,
} from "./settings";
import { createAskUserQuestionWeb } from "./tools/ask-user-question-web";
import { createFridaContext } from "./tools/frida-context";
import { createFridaAgentBrowser } from "./tools/frida-agent-browser";
import {
	createFridaCodebaseIndex,
	CODEBASE_INDEX_FACTORY_NAME,
} from "./tools/frida-codebase-index";
import {
	createFridaHermesMemory,
	HERMES_MEMORY_FACTORY_NAME,
} from "./tools/frida-hermes-memory";
import {
	createFridaKnowledgeBase,
	KNOWLEDGE_BASE_FACTORY_NAME,
} from "./tools/frida-knowledge-base";
import {
	createFridaCcPlugins,
	CC_PLUGINS_FACTORY_NAME,
} from "./tools/frida-cc-plugins";
import {
	createFridaSandboxes,
	SANDBOXES_FACTORY_NAME,
} from "./tools/frida-sandboxes";
import {
	ensureGitignore,
	syncOpenAiKeyToAuthJson,
} from "./tools/frida-codebase-index/host-setup";
import { createFridaSupiWeb } from "./tools/frida-supi-web";
import { createFridaArgs } from "./tools/frida-args";
import { createFridaMultiSkills } from "./tools/frida-multi-skills";
import { createFridaPixSkills } from "./tools/frida-pix-skills";
import { createFridaPipeline } from "./tools/frida-pipeline";
import { createFridaSubagents } from "./tools/frida-subagents";
import { createFridaExtensibleWorkflows } from "./tools/frida-extensible-workflows";
import { createFridaMcpAdapter } from "./tools/frida-mcp-adapter";
import { createFridaGitSync } from "./tools/frida-git-sync";
import { createFridaAidd } from "./tools/frida-aidd";
import { createFridaTea } from "./tools/frida-tea";
import { createFridaAppWalkthrough } from "./tools/frida-app-walkthrough";
import { createFridaUnderstandApp } from "./tools/frida-understand-app";
import { createFridaTraffic2Api } from "./tools/frida-traffic2api";
import { createFridaSizeApp } from "./tools/frida-size-app";
import { SIZE_APP_FACTORY_NAME } from "./tools/frida-size-app/constants";
import { createFridaLensFactory } from "./tools/frida-extensible-workflows/moat-factories";
import { createFridaGoal } from "./tools/frida-goal";
import type { GoalStateSnapshot } from "./tools/frida-goal/state";
import { createFridaWorktree } from "./worktree";
import { createTodoWeb } from "./tools/todo-web";
import { UiBridge, type UiRequest } from "./ui-bridge";
import {
	QuestionnaireBridge,
	type QuestionnaireRequest,
	type WebQuestionSpec,
	type WebQuestionnaireResult,
} from "./questionnaire-bridge";
import { randomUUID } from "node:crypto";
import { createFridaUiContext } from "./extension-ui-context";
import { WebBridge } from "./web-bridge";
import type { WebNode, WebPlacement } from "./web-protocol";
import { preparePiLensConfig } from "./pilens-config";
import {
	createLensDiagnosticsBridge,
	type LensDiagnosticsPayload,
} from "./lens-diagnostics-bridge";

/** Una factory de Pi + un getter que decide si registrarse (toggle de config). */
function toggleable(
	getEnabled: () => boolean,
	factory: (pi: import("@earendil-works/pi-coding-agent").ExtensionAPI) => void,
): (pi: import("@earendil-works/pi-coding-agent").ExtensionAPI) => void {
	return (pi) => {
		if (getEnabled()) factory(pi);
	};
}

export interface FridaSession {
	session: any;
	/** ExtensionAPI (pi) capturada al registrar frida-args. El host la usa para
	 *  expandir /skill:name en runPrompt (B1: mostrar el bloque en vivo). Null si
	 *  frida-args no se registró o aún no corrió el factory. */
	extensionApi: any;
	modelRuntime: any;
	/** #121 (F7) — routing por roles resuelto al crear la sesión: config leída
	 *  de settings + resolución efectiva por rol + si las hijas corren en smol.
	 *  Para la UI (sección Roles del panel Modelos, chip del Composer). */
	modelRoles: {
		config: ModelRolesConfig;
		resolution: {
			default: ResolvedRole;
			smol: ResolvedRole;
			commit: ResolvedRole;
		};
		childModelActive: boolean;
	};
	bridge: ApprovalBridge;
	uiBridge: UiBridge;
	webBridge: WebBridge;
	/** ask_user_question nativo (ADR-0027): QuestionsPanel en el webview. */
	questionnaireBridge: QuestionnaireBridge;
	/** Helper: monta un cuestionario y devuelve el resultado (demo/tests). */
	askUserQuestion: (
		questions: WebQuestionSpec[],
	) => Promise<WebQuestionnaireResult>;
	/** Stats footer (Fase 3): contadores de la sesión. El host llama reset() al /new. */
	gateStats: GateStatsStore;
	/** Patrones aprobados por sesión (Fase 4): el host llama clear() al /new. */
	sessionApprovals: SessionApprovals;
	sessionManager: any;
	setKey: (providerId: string, key: string) => Promise<void>;
	/** Explora modelos del proveedor vía su endpoint /models y re-registra el
	 *  ProviderConfig con los descubiertos (ADR-0017). Best-effort: si falla, no
	 *  cambia el catálogo. */
	discoverModels: (providerId: string) => Promise<void>;
	/** Crea una sesión hija desprendida para una etapa de workflow (ADR-0020/D32).
	 *  Loader curado (provider hooks + gates; SIN todo-web/ask-user-question/
	 *  frida-context — montarían paneles duplicados por session_start). Skills se
	 *  recargan de disco; mismo modelo que la sesión interactiva. Los gates de la
	 *  hija confluyen en el mismo ApprovalBridge (paridad de seguridad). */
	createChildSession: (childOpts: {
		prompt: string;
		sessionDir: string;
		signal?: AbortSignal;
	}) => Promise<{ session: any; sessionManager: any }>;
}

export interface CreateFridaSessionOptions {
	/** cwd de trabajo = carpeta del workspace (donde el agente lee/edita archivos). */
	cwd: string;
	/** agentDir PROPIO de Frida (~/.frida): extensiones/skills/auth/models
	 *  desacoplados de ~/.pi (CLI pi). Ver ADR-0010. */
	agentDir: string;
	/** Dónde guardar sesiones (globalStorageUri/sessions) — desacoplado del agentDir (D13). */
	sessionDir: string;
	/** Path del log de auditoría de aprobaciones (Prioridad 2). Lo pasa el host
	 *  desde globalStorageUri; el gate escribe JSONL append-only chmod 0600 aquí. */
	approvalLogPath: string;
	/** Si se da, abre la sesión existente (switch) en vez de crear una nueva. */
	openPath?: string;
	/** Proveedor/modelo activo persistido por el host. Si no resuelve o no está
	 * autenticado, cae al default (Softtek DevEngine). */
	activeModel?: { provider: string; modelId: string };
	/** Cache síncrono de la key POR proveedor (before_provider_headers es síncrono).
	 *  ADR-0017: generalizado del getKey() único de DevEngine. */
	getKeyFor: (providerId: string) => string | undefined;
	onUnauthorized: (providerId: string) => void;
	/** Dumpea el request al gateway ante un 4xx/5xx (DevEngine no devuelve body en
	 *  el 500; el request nos dice qué campo lo rechaza). Ver ADR-0009. */
	onProviderError?: (payload: unknown, status: number) => void;
	/** #86: deps del provider-audit (REQUEST/HTTP → provider-audit.log). Si se
	 *  da, se registra la extensión frida-provider-audit (pi.on) — los eventos
	 *  de provider son de la ExtensionAPI, NO métodos del AgentSession
	 *  (regresión 6fed59a: session.on crasheaba el arranque). */
	providerAudit?: import("./providers/provider-audit").ProviderAuditDeps;
	/** Path para dumpear cada request enviado al gateway (overwrite). Ver ADR-0009. */
	requestDumpPath?: string;
	/** H-2/H-3 (HALLAZGOS-GATEWAY): path del diagnóstico del último 500 opaco
	 *  (re-probe stream:false) y callback con el mensaje accionable. */
	diagnosticDumpPath?: string;
	onGatewayDiagnosis?: (diagnosis: {
		actionableMessage: string;
		probeStatus: number | null;
	}) => void;
	onPendingApprovals: (reqs: ApprovalRequest[]) => void;
	/** Stats footer (Fase 3): el gate cuenta decisiones de la sesión y las publica
	 *  aquí para el webview (✓N aprobadas / ✗M bloqueadas / ⚡Z auto-allow). */
	onGateStats?: (s: GateStats) => void;
	/** ExtensionUIContext (Fase de extensibilidad web): diálogos select/input/confirm
	 *  que las extensiones nativas (rpiv-ask-user-question en modo RPC) enrutan al
	 *  webview. El host publica los pendientes aquí; el webview responde vía ui_response. */
	onUiRequest: (reqs: UiRequest[]) => void;
	/** ui.notify() de las extensiones → toast/info en el webview (fire-and-forget). */
	onUiNotify: (message: string, level: "info" | "warning" | "error") => void;
	/** Remote React (opción A): el host publica cada commit del árbol aquí; el
	 *  webview lo materializa. tree:null = desmontar la UI remota. */
	onWebCommit: (
		rootId: string,
		tree: WebNode | null,
		placement: WebPlacement,
	) => void;
	/** ask_user_question nativo (ADR-0027): el host publica el cuestionario
	 *  pendiente aquí; el webview responde vía questionnaire_answer. */
	onQuestionnaire: (reqs: QuestionnaireRequest[]) => void;
	getMode: () => PermissionMode;
	/** Toggles Fase 2 (#53): gates de módulos conmutables (default true). */
	subagentsEnabled?: () => boolean;
	/** ¿Está activo frida-agent-browser? (frida.agentBrowser.enabled). */
	agentBrowserEnabled?: () => boolean;
	/** ¿Está activo frida-supi-web? (frida.supiWeb.enabled). */
	supiWebEnabled?: () => boolean;
	/** ¿Está activo frida-mcp-adapter? (frida.mcpAdapter.enabled). */
	mcpAdapterEnabled?: () => boolean;
	/** ¿Está activo frida-extensible-workflows? (frida.extensibleWorkflows.enabled). */
	extensibleWorkflowsEnabled?: () => boolean;
	/** ¿Está activo frida-git-sync? (frida.gitSync.enabled). */
	gitSyncEnabled?: () => boolean;
	/** ¿Está activo frida-worktree? (frida.worktree.enabled). */
	worktreeEnabled?: () => boolean;
	/** Toggles de tools (Configuración). Las factories se registran según estos. */
	askUserQuestionEnabled: () => boolean;
	todoEnabled: () => boolean;
	/** ¿Tool `context` (snapshot de presión, frida-context) activo? */
	contextEnabled: () => boolean;
	/** Patrones configurables del gate (frida.gates.*), leídos en vivo desde los
	 *  settings de VS Code. El gate los consulta en cada tool_call, así los cambios
	 *  aplican al instante sin recargar. */
	getGatePatterns: () => GatePatterns;
	/** D16 — callback invocado por cada evento `pilens:diagnostics` del bus de Pi
	 *  (cuando pi-lens recalcula diagnósticos). El host acumula por turno y publica
	 *  un resumen al webview. Es opt-in: si pi-lens no cargó, nunca se invoca. */
	onLensDiagnostics: (payload: LensDiagnosticsPayload) => void;
	/** #20 — snapshot del goal activo (chip 🎯 del footer). undefined = sin goal. */
	onGoalState?: (goal: GoalStateSnapshot | undefined) => void;
	/** #20 — avisos del runtime de frida-goal (guards, complete, blocked). */
	onGoalNotify?: (level: "info" | "warning" | "error", text: string) => void;
	/** API key de Context7 (frida-supi-web): cache síncrono que el host carga del
	 *  SecretStorage (`frida.context7Key`) al arrancar, con fallback a
	 *  `process.env.CONTEXT7_API_KEY`. Se inyecta en las tools web_docs_* para que
	 *  la key NUNCA viva en disco/env en claro (patrón ADR-0017 aplicado a Context7). */
	getContext7Key: () => string | undefined;
	/** ¿Está activo frida-codebase-index? (frida.codebaseIndex.enabled, default true). */
	codebaseIndexEnabled?: () => boolean;
	/** Estado del wrapper (installed/capturedTools) para el tab Index del webview. */
	onCodebaseIndexState?: (
		s: import("./tools/frida-codebase-index").CodebaseIndexState,
	) => void;
	/** ¿Está activo frida-hermes-memory? (frida.hermesMemory.enabled, default true). */
	hermesMemoryEnabled?: () => boolean;
	/** ¿Está activa frida-knowledge-base? (frida.knowledgeBase.enabled, default true). */
	knowledgeBaseEnabled?: () => boolean;
	onKnowledgeBaseState?: (
		s: import("./tools/frida-knowledge-base").KnowledgeBaseState,
	) => void;
	/** ¿Está activo frida-cc-plugins? (frida.ccPlugins.enabled, default true). */
	ccPluginsEnabled?: () => boolean;
	/** Team marketplaces de settings (frida.ccPlugins.extraMarketplaces). */
	ccPluginsExtraMarketplaces?: () => string[];
	/** enabledPlugins de settings (frida.ccPlugins.enabledPlugins). */
	ccPluginsEnabledPlugins?: () => Record<string, boolean>;
	/** Presenter VS Code de resultados de /ccplugin (output channel). */
	ccPluginsPresenter?: import("./tools/frida-cc-plugins/presenter").CcPluginsPresenter;
	/** Sink del panel nativo del webview para /ccplugin (null = cerrar). */
	ccPluginsPanel?: import("./tools/frida-cc-plugins/panel").CcPanelSink;
	onCcPluginsState?: (
		s: import("./tools/frida-cc-plugins").CcPluginsState,
	) => void;
	/** frida-sandboxes (#35): toggle, imagen default y allowlist de dominios. */
	sandboxesEnabled?: () => boolean;
	sandboxesDefaultImage?: () => string;
	sandboxesAllowDomains?: () => string[];
	/** Sink del panel nativo del webview para /sandbox (null = cerrar). */
	sandboxesPanel?: import("./tools/frida-sandboxes/panel").SandboxPanelSink;
	onSandboxesState?: (s: { ready: boolean; sandboxes: number }) => void;
	/** frida-subagents #26: sink del panel /detached (null = cerrar). */
	detachedPanel?: (
		panel:
			| import("./tools/frida-subagents/detached-panel").DetachedPanelData
			| null,
	) => void;
	/** Estado del wrapper hermes (installed/installing/error) para notificar /reload. */
	onHermesMemoryState?: (
		s: import("./tools/frida-hermes-memory").HermesMemoryState,
	) => void;
}

export async function createFridaSession(
	opts: CreateFridaSessionOptions,
): Promise<FridaSession> {
	// D11 — desactivar phone-home a pi.dev.
	process.env.PI_SKIP_VERSION_CHECK = "1";
	process.env.PI_OFFLINE = "1"; // apaga también el chequeo de paquetes
	// D13 — sesiones desacopladas del agentDir (se pasa explícito a SessionManager).
	fs.mkdirSync(opts.sessionDir, { recursive: true });

	// D16 — pi-lens: desactivar su auto-format y auto-fix (redundantes con el
	// formateo on-save de VS Code, y mutan archivos fuera del gate de D7). Vía
	// PI_LENS_CONFIG_PATH apuntando a un config propio en globalStorageUri, con
	// merge de la config del usuario (respetamos sus `ignore`/prefs). Dejamos
	// activos los tools del agente (module_report, ast_grep, …) y el LSP. Debe
	// ir ANTES de loader.reload(): pi-lens lee la config al cargar ahí.
	process.env.PI_LENS_CONFIG_PATH = preparePiLensConfig(
		path.dirname(opts.sessionDir),
	);

	// Cache de keys POR proveedor (ADR-0017). El host carga las keys del
	// SecretStorage al arrancar y las pasa vía getKeyFor; las mantiene sincronizadas.
	const keyHolders: Record<string, string> = {};
	for (const id of API_KEY_PROVIDER_IDS) {
		const k = opts.getKeyFor(id);
		if (k) keyHolders[id] = k;
	}

	// D4 (ADR-0036) — frida-codebase-index: exponer la OpenAI key de Frida (si
	// existe) al detector de embeddings del upstream vía ~/.frida/auth.json
	// (merge defensivo, la auth propia del usuario manda), y gitignore del
	// storage del índice (.codebase-index/ dentro del workspace). Best-effort.
	if (opts.codebaseIndexEnabled?.() ?? true) {
		syncOpenAiKeyToAuthJson(opts.agentDir, keyHolders[OPENAI_PROVIDER], (line) =>
			console.warn(line),
		);
		ensureGitignore(opts.cwd, (line) => console.warn(line));
	}

	// ADR-0010: agentDir propio (~/.frida); asegurarlo antes de usarlo (auth/models/loader).
	fs.mkdirSync(opts.agentDir, { recursive: true });
	const settingsManager = SettingsManager.create(opts.cwd, opts.agentDir);
	// D11 — apagar la telemetría de instalación (el update-check ya está off vía env).
	settingsManager.applyOverrides({ enableInstallTelemetry: false });

	// ADR-0010: ModelRuntime operando en NUESTRO agentDir (~/.frida): auth/models
	// propios, desacoplados de ~/.pi (donde vive el CLI pi). Así no leemos ni pisamos
	// la config/auth del `pi` de consola.
	const modelRuntime = await ModelRuntime.create({
		authPath: path.join(opts.agentDir, "auth.json"),
		modelsPath: path.join(opts.agentDir, "models.json"),
		modelsStorePath: path.join(opts.agentDir, "models-store.json"),
	});
	// Registramos los proveedores DIRECTAMENTE en ModelRuntime para que getModel los
	// vea. ADR-0017: cada proveedor de API-key trae su config y su auth.
	// ADR-0019: el contextWindow/maxTokens de cada modelo DevEngine se RESUELVEN por
	// prioridad: override (settings) > gateway (GET /models real) > catálogo canónico
	// (gpt-5.4-mini en azure/openai → 400000) > default. Los nuevos ids internos
	// (gpt-5.6-luna/sol/terra) NO están en los catálogos de pi-ai → caen a
	// gateway/default. Los demás metadatos (reasoning/input/thinkingLevelMap) del
	// catálogo canónico; el compat (requiresThinkingAsText etc.) es específico del
	// bug de DevEngine (ADR-0009) y se comparte entre todos los modelos.
	const devCfg = readDevengineConfig();
	const metaByModel: Record<string, CanonicalModelMeta | undefined> = {};
	for (const def of SOFTTEK_MODELS) {
		metaByModel[def.id] = lookupCanonicalModelMeta(modelRuntime, def.id);
	}
	// El GET /models a DevEngine SÓLO si DevEngine va a ser el modelo usado en esta
	// sesión (el activo, o el fallback si el activo no está autenticado). Así no
	// llamamos al gateway cuando el usuario usa z.ai/Copilot pero tiene la key de
	// DevEngine guardada. La resolución del modelo usa hasConfiguredAuth (no el
	// contextWindow), así que podemos pre-calcularlo aquí. UNA sola llamada trae
	// los contextWindow de TODOS los modelos del catálogo (mapa id → cw).
	const activeProvider = opts.activeModel?.provider;
	// ¿Usaremos DevEngine en esta sesión? Sólo si no hay modelo guardado o el
	// guardado es DevEngine. Ya NO exigimos hasConfiguredAuth aquí: la auth de la
	// API key se resuelve al hacer la petición (env/secretStorage/keychain), así
	// que restauramos el proveedor elegido aunque el credential-store del runtime
	// aún no lo refleje del todo. (Antes esto hacía que z.ai cayera a DevEngine en
	// cada recarga.)
	const willUseDevengine =
		!opts.activeModel || activeProvider === SOFTTEK_PROVIDER;
	let gatewayCtxByModel: Record<string, number> | undefined;
	const devKey = keyHolders[SOFTTEK_PROVIDER];
	if (devKey && willUseDevengine) {
		gatewayCtxByModel = await fetchDevengineModelsContext(
			DEVENGINE_BASE_URL,
			devKey,
		);
	}
	const limitsByModel: Record<
		string,
		{ contextWindow: number; maxTokens: number }
	> = {};
	for (const def of SOFTTEK_MODELS) {
		const meta = metaByModel[def.id];
		limitsByModel[def.id] = {
			contextWindow:
				devCfg.contextWindow ??
				gatewayCtxByModel?.[def.id] ??
				meta?.contextWindow ??
				300000,
			maxTokens: devCfg.maxTokens ?? meta?.maxTokens ?? 128000,
		};
	}
	modelRuntime.registerProvider(
		SOFTTEK_PROVIDER,
		buildSofttekProviderConfig({ limitsByModel, metaByModel }),
	);
	// Frida Enterprise (#58): OAuth corporativo de Frida Platform + Compatible
	// API (gateway OpenAI-compatible). Los tokens ROTAN (idToken ~1h): registramos
	// el OAuth nativo de pi-ai y el runtime persiste/rota la credential. El
	// catálogo llega vía refreshModels (GET /v1/models) una vez autenticado; por
	// eso el registro arranca con models: [] y baseUrl placeholder.
	modelRuntime.registerProvider(
		FRIDA_ENTERPRISE_PROVIDER,
		buildFridaEnterpriseProviderConfig() as any,
	);
	// frida-antigravity (#97): Google Antigravity / Cloud Code Assist (port de
	// pi-antigravity, MIT). OAuth de Google con callback local :51121 + streaming
	// nativo SSE propio (streamSimple) con puente custom-tools para Claude/GPT.
	// Catálogo estático de 7 modelos públicos; el discovery dinámico
	// (fetchAvailableModels) resuelve runtimes no mapeados en cada request.
	modelRuntime.registerProvider(
		ANTIGRAVITY_PROVIDER,
		buildAntigravityProviderConfig() as any,
	);
	// #123 — Ollama LOCAL: registra el daemon (OLLAMA_HOST o localhost:11434)
	// con los modelos de chat instalados (/api/tags + /api/show best-effort).
	// Daemon caído o sin modelos → provider con models: [] (aparece "sin
	// conexión" en Proveedores; nunca rompe el arranque). El semáforo de la UI
	// es getModels no vacío — mismo criterio que el resolvedor de roles F7.
	{
		const ollamaHost =
			process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";
		let ollamaLocalModels: OllamaLocalModelDef[] = [];
		try {
			ollamaLocalModels = await discoverOllamaLocalModels(
				ollamaHost,
				(url, init) => fetch(url, init),
			);
		} catch {
			/* daemon caído: registro vacío, fail-soft */
		}
		modelRuntime.registerProvider(
			OLLAMA_PROVIDER,
			buildOllamaProviderConfig(ollamaHost, ollamaLocalModels) as any,
		);
	}
	// #122 — Ollama Cloud (ollama.com/v1): registro con catálogo dinámico
	// SOLO cuando hay credencial resuelta (OLLAMA_API_KEY env o key guardada
	// vía SecretStorage) — mismo criterio que el plugin de referencia: el
	// descubrimiento es keyless pero el refresh vivo no corre sin credencial.
	// Sin key: provider con models: [] → visible "sin conexión" con botón Key
	// (entrada API_KEY_PROVIDERS); nunca rompe el arranque.
	{
		const cloudKey =
			process.env.OLLAMA_API_KEY?.trim() || keyHolders[OLLAMA_CLOUD_PROVIDER];
		let cloudModels: OllamaCloudModelDef[] = [];
		if (cloudKey) {
			try {
				cloudModels = await discoverOllamaCloudModels(
					OLLAMA_CLOUD_BASE_URL,
					(url, init) => fetch(url, init),
				);
			} catch {
				/* red caída: catálogo vacío, visible sin auth */
			}
		}
		modelRuntime.registerProvider(
			OLLAMA_CLOUD_PROVIDER,
			buildOllamaCloudProviderConfig(cloudModels, {
				apiKey: process.env.OLLAMA_API_KEY ? "$OLLAMA_API_KEY" : undefined,
			}) as any,
		);
	}
	// Errata-9: el compact/branch-summary llama streamSimple/completeSimple sin
	// onPayload (el SDK no pasa onPayload en ese canal). Instala el patch lateral
	// para inyectar identidad (user_id/email) y role developer→system en Enterprise.
	patchFridaSideChannelsOn(modelRuntime);
	// Z.ai es un provider BUILT-IN de pi-ai (`providers/zai`): NO se registra aquí.
	// El ModelRuntime ya lo carga con baseUrl, modelos oficiales (glm-4.5-air / 4.7 /
	// 5.x) y compat.thinkingFormat:"zai" (el SDK inyecta el `thinking` de GLM → el
	// razonamiento funciona nativamente, sin el workaround de DevEngine). Sólo falta
	// la API key (setRuntimeApiKey abajo).
	// Si ya hay keys (onboarding previo), las fijamos en el runtime para que getAuth
	// resuelva y Pi NO bloquee con "No API key found". El X-Api-Key de DevEngine lo
	// inyecta before_provider_headers (authHeader:false); el Bearer de z.ai lo inyecta
	// el built-in (authHeader nativo de pi-ai).
	for (const [id, key] of Object.entries(keyHolders)) {
		await modelRuntime.setRuntimeApiKey(id, key);
	}

	const bridge = new ApprovalBridge(opts.onPendingApprovals);
	// Fase de extensibilidad web: ExtensionUIContext de Frida. Implementa el slice
	// data-oriented (select/input/confirm) del contrato `pi.ui` del SDK y lo enruta
	// al webview. Cableado: session.bindExtensions({ uiContext, mode: 'rpc' }) más
	// abajo. Así las extensiones nativas que respetan el patrón RPC (rpiv-
	// ask-user-question) funcionan en el web sin su factory Ink del TUI.
	const uiBridge = new UiBridge(opts.onUiRequest);
	const webBridge = new WebBridge(opts.onWebCommit);
	const questionnaireBridge = new QuestionnaireBridge(opts.onQuestionnaire);
	const uiContext = createFridaUiContext(
		uiBridge,
		opts.onUiNotify,
		webBridge,
		questionnaireBridge,
	);
	// Logger de auditoría del gate (Prioridad 2). Una instancia por sesión;
	// escribe JSONL append-only con chmod 0600/0700 y nunca lanza.
	// #55: knob `auditLog` de permission.json (paridad permissionReviewLog de
	// pi-permission-system) — se consulta EN CADA entrada, así el toggle del panel
	// aplica en vivo. Ausente → true (behavior default: siempre auditar).
	const approvalLogger = new ApprovalLogger(
		opts.approvalLogPath,
		() => getConfig().auditLog !== false,
	);
	// Fase 3 — contadores de la sesión para el Stats footer (en memoria, se resetea
	// por sesión). El gate los alimenta vía stats.record() en cada decisión.
	const gateStats = new GateStatsStore(opts.onGateStats ?? (() => {}));
	// Fase 4 — patrones aprobados por sesión (en memoria, se resetea por sesión).
	const sessionApprovals = new SessionApprovals();

	// Fase 2 — frida-lens (pi-lens): desde M1 #134 (D2) la factory DIFERIDA
	// vive en el motor (frida-extensible-workflows/moat-factories.ts) y esta
	// es su única fuente: misma sonda (existsSync de la entry bajo
	// <agentDir>/npm/node_modules/pi-lens) y misma semántica de carga
	// (#57: import() por URL de archivo, no path crudo; error → warn sin
	// tumbar la sesión). Única
	// diferencia conductual: el import() corre DENTRO del loader.reload()
	// (`await factory(api)`) en vez de aquí — semánticamente equivalente.
	const fridaLens = createFridaLensFactory(opts.agentDir);

	// Fase de extensibilidad web: si la extensión nativa rpiv-ask-user-question está
	// declarada en settings.json packages (la cargaría el resourceLoader vía jiti),
	// desactivamos el ask_user_question EMPOTRADO (web) para evitar un tool duplicado.
	// OJO: se detecta por settings.json (no por el directorio en npm/node_modules, que
	// puede quedar tras un uninstall y daría falso positivo → el web se desactivaría
	// sin que rpiv cargue → nadie provee ask_user_question).
	let rpivAskPresent = false;
	try {
		const settingsRaw = fs.readFileSync(
			path.join(opts.agentDir, "settings.json"),
			"utf8",
		);
		const settings = JSON.parse(settingsRaw) as { packages?: string[] };
		rpivAskPresent =
			Array.isArray(settings.packages) &&
			settings.packages.some((p) => p.includes("rpiv-ask-user-question"));
	} catch {
		// settings.json ausente o inválido → rpiv no carga → web activo.
	}

	// Extensiones/skills externas en proyecto (Opción B): .frida/ además del global
	// ~/.frida/. Cargan estilo CLI (sin gate de trust), consistente con
	// .frida/workflows que ya se auto-carga vía jiti. Ver docs/tools/extensions.md.
	// NOTA: additionalSkillPaths acepta un directorio (loadSkills recursa .md), pero
	// additionalExtensionPaths trata un dir como package source y NO expande .ts
	// sueltos → enumeramos los archivos (loose *.ts + */index.ts) como hace el
	// descubrimiento estándar de Pi. Verificado en test/extensions-discovery.test.ts.
	const projExtDir = path.join(opts.cwd, ".frida", "extensions");
	const projSkillDir = path.join(opts.cwd, ".frida", "skills");
	// Captura la ExtensionAPI (pi) que el SDK inyecta al factory de frida-args.
	// El host la reutiliza para expandir /skill: en runPrompt y mostrar el bloque
	// <skill> en vivo. Sólo la sesión principal registra frida-args → sin race
	// con sesiones hijas (createChildSession usa una lista curada sin frida-args).
	let capturedExtensionApi:
		| import("@earendil-works/pi-coding-agent").ExtensionAPI
		| null = null;
	const loader = new DefaultResourceLoader({
		cwd: opts.cwd,
		agentDir: opts.agentDir,
		settingsManager,
		additionalExtensionPaths: listProjectExtensionFiles(projExtDir),
		additionalSkillPaths: fs.existsSync(projSkillDir) ? [projSkillDir] : [],
		extensionFactories: [
			// D2 (M1 #134): entry DIFERIDA del motor — misma forma {name, factory}
			// que el bloque inline que reemplaza.
			...(fridaLens ? [fridaLens] : []),
			{
				name: "softtek-provider",
				factory: createSofttekProviderHooks({
					getKey: () => keyHolders[SOFTTEK_PROVIDER],
					onUnauthorized: () => opts.onUnauthorized(SOFTTEK_PROVIDER),
					onProviderError: opts.onProviderError,
					requestDumpPath: opts.requestDumpPath,
					diagnosticDumpPath: opts.diagnosticDumpPath,
					onGatewayDiagnosis: opts.onGatewayDiagnosis,
				}),
			},
			// #86/#91: provider-audit — REQUEST (cada llamada al LLM, modelo REAL
			// del payload) y HTTP (≥400) a ~/.frida/logs/provider-audit.log.
			// Registrado como extensión (pi.on) porque los eventos de provider NO
			// son métodos del AgentSession (regresión 6fed59a). DEFAULT-ON (#91,
			// repro 20:52): el switch de sesión construía sus propios opts y
			// omitía providerAudit → la sesión continuada (la ACTIVA) corría sin
			// auditoría. Con default-on ningún call site puede olvidarlo; el host
			// sigue inyectando sus deps enriquecidos (tag de sesión + onHttpError
			// para causality de AUTO-CHANGE) cuando los pasa.
			{
				name: "frida-provider-audit",
				factory: createProviderAuditHooks(
					opts.providerAudit ?? defaultProviderAuditDeps(opts.cwd),
				),
			},
			{
				name: "z-ai-provider",
				factory: createZaiProviderHooks({
					onUnauthorized: () => opts.onUnauthorized(ZAI_PROVIDER),
				}),
			},
			{
				name: "frida-enterprise-provider",
				factory: createFridaEnterpriseHooks({
					onUnauthorized: () => opts.onUnauthorized(FRIDA_ENTERPRISE_PROVIDER),
				}),
			},
			{
				name: "frida-aidd",
				factory: createFridaAidd(),
			},
			{
				name: "frida-tea",
				factory: createFridaTea(),
			},
			{
				name: "frida-app-walkthrough",
				factory: createFridaAppWalkthrough(),
			},
			{
				name: "frida-understand-app",
				// M1 (#134): skill pack del patrón `understand-app`. Sin toggle
				// propio (los skill packs no se conmutan); recibe agentDir y el
				// getter de codebase-index para que la const CAPABILITIES del
				// script sea exacta respecto de instalación y toggle (D5/D6).
				factory: createFridaUnderstandApp({
					agentDir: opts.agentDir,
					codebaseIndexEnabled: () => opts.codebaseIndexEnabled?.() ?? true,
				}),
			},
			{
				name: "frida-traffic2api",
				// M9 (#135): skill pack del patrón `traffic2api` — primer pack
				// que combina moat declarativo (meta.moat, M1) y sesión
				// pinneada (args.session, M8). Sin toggle propio (los skill
				// packs no se conmutan); recibe agentDir y el getter de
				// codebase-index para que la const CAPABILITIES del script sea
				// exacta (misma forma que understand-app, D3).
				factory: createFridaTraffic2Api({
					agentDir: opts.agentDir,
					codebaseIndexEnabled: () => opts.codebaseIndexEnabled?.() ?? true,
				}),
			},
			{
				name: SIZE_APP_FACTORY_NAME,
				// M10 (#139): skill pack del patrón `size-app` — primera
				// dependencia binaria NO-npm del repo: scc v4.0.0 pineado al
				// agentDir (sha256 verificado), descarga fire-and-forget al
				// registrar la factory (D2, molde hermes). Sin toggle propio
				// (los skill packs no se conmutan); agentDir + getter de
				// codebase-index para que la const CAPABILITIES del script sea
				// exacta (misma forma que understand-app/traffic2api).
				factory: createFridaSizeApp({
					agentDir: opts.agentDir,
					codebaseIndexEnabled: () => opts.codebaseIndexEnabled?.() ?? true,
				}),
			},
			{
				name: "frida-permission-system",
				factory: createPermissionSystem(
					bridge,
					opts.getMode,
					approvalLogger,
					() => opts.cwd,
					opts.getGatePatterns,
					gateStats,
					sessionApprovals,
				),
			},
			// Tools conmutables desde la Configuración (frida.askUserQuestion.enabled /
			// frida.todo.enabled). El getter se re-evalúa en cada session.reload(), así
			// un cambio de toggle se aplica en caliente sin perder el historial.
			// ask_user_question usa Remote React (fridaWeb, ADR-0012): WebQuestionnaire con
			// estado en el host serializado al webview. Si rpiv está instalada en ~/.frida,
			// se omite esta para evitar duplicar el tool (rpiv cae al modo RPC).
			{
				name: "ask-user-question",
				factory: toggleable(
					() => opts.askUserQuestionEnabled() && !rpivAskPresent,
					createAskUserQuestionWeb(),
				),
			},
			// todo usa Remote React PERSISTENTE (fridaWebMount, ADR-0014): el panel se
			// monta al session_start y se re-renderiza solo ante cada mutation del store
			// reactivo; el host no publica nada (postTodos quedó obsoleto).
			{ name: "todo", factory: toggleable(opts.todoEnabled, createTodoWeb()) },
			// frida-context: tool `context` (snapshot de presión del contexto para que
			// el agente se auto-regule). El medidor para el humano ya vive en el webview
			// (ContextBar); el reporte detallado /context es fase B.
			{
				name: "frida-context",
				factory: toggleable(opts.contextEnabled, createFridaContext()),
			},
			// frida-args: argumentos ($1/$ARGUMENTS/${@:N:L}), variables (${SKILL_DIR}/
			// ${SESSION_ID}) y sustitución de shell (!`cmd` / ```!) en skills. Porte de
			// @juicesharp/rpiv-args como extensión embebida; 100% headless → modo rpc.
			// Intercepta /skill:<name> <args> antes del expansor nativo de Pi. Siempre
			// activa: una skill sin placeholders ni shell emite bytes idénticos a Pi.
			{
				name: "frida-args",
				factory: (pi) => {
					capturedExtensionApi = pi;
					return createFridaArgs()(pi);
				},
			},
			// frida-multi-skills: invocación multi-skill con `$skill_name` inline
			// (porte de pi-multi-skills). DEBE registrarse DESPUÉS de frida-args para
			// reutilizar su índice de skills (getSkillIndex). Reutiliza el hook input
			// como salvavidas; runPrompt (host) hace la expansión para display en vivo.
			{
				name: "frida-multi-skills",
				factory: createFridaMultiSkills(),
			},
			// frida-pix-skills: tool `read_skills` para cargar skills on-demand +
			// interpolación de directivas + skills.sh remoto (porte de pix-skills).
			// Sin bundle propio: opera sobre skills existentes, no añade nuevas → no
			// colisiona con frida-pipeline. Gate de directivas → frida-permission-system.
			{
				name: "frida-pix-skills",
				factory: createFridaPixSkills(),
			},
			// frida-agent-browser (D34): tool `agent_browser` que envuelve el binario
			// upstream agent-browser (Vercel) — automation de navegador real. Sesión
			// main only (las hijas de workflow quedan curadas: providers + gates).
			{
				name: "frida-agent-browser",
				// Gate #53 (frida.agentBrowser.enabled, default true).
				factory: (pi: any) =>
					(opts.agentBrowserEnabled?.() ?? true)
						? createFridaAgentBrowser({ agentDir: opts.agentDir })(pi)
						: undefined,
			},
			// frida-codebase-index (ADR-0036): búsqueda semántica + call graph vía
			// wrapper del paquete upstream open-codebase-index instalado on-demand
			// en ~/.frida/npm. La factory es ASYNC y el loader awaita su retorno
			// (loader.js:389) para que el import() del paquete complete antes de
			// dar la sesión por lista — por eso NO usamos toggleable() (su wrapper
			// síncrono descartaría la promesa y re-introduciría la race de registro
			// documentada en el plan). Gate manual: sólo registra si enabled.
			// Si falta el paquete/Ollama, las 6 tools se registran en modo guía
			// accionable (D6). Main only (igual que frida-agent-browser).
			{
				name: CODEBASE_INDEX_FACTORY_NAME,
				factory: (pi: any) =>
					(opts.codebaseIndexEnabled?.() ?? true)
						? createFridaCodebaseIndex({
								agentDir: opts.agentDir,
								onStateChange: opts.onCodebaseIndexState,
							})(pi)
						: undefined,
			},
			// frida-hermes-memory (ADR-0032): loop de aprendizaje cross-session vía
			// wrapper passthrough del paquete upstream pi-hermes-memory (MIT)
			// instalado on-demand en ~/.frida/npm. A diferencia de codebase-index,
			// corre la factory del upstream contra el ExtensionAPI REAL: el learning
			// loop necesita los eventos del lifecycle (before_agent_start para
			// inyección de contexto, turn_end para background learning,
			// session_shutdown para flush+index) y registra además las tools
			// memory_*/session_search y los comandos /memory-*. Factory async: el
			// loader awaita el jiti import (sin race de registro). Gate manual
			// (frida.hermesMemory.enabled, default true) porque el background
			// learning consume tokens. Si falta el paquete: tool guía + instalación
			// en background sin bloquear el arranque (D6). Main only — las hijas de
			// workflow no inyectan memoria ni aprenden.
			{
				name: HERMES_MEMORY_FACTORY_NAME,
				factory: (pi: any) =>
					(opts.hermesMemoryEnabled?.() ?? true)
						? createFridaHermesMemory({
								agentDir: opts.agentDir,
								distDir: __dirname,
								onStateChange: opts.onHermesMemoryState,
							})(pi)
						: undefined,
			},
			// frida-knowledge-base (ADR-0040): KB OKF v0.2 del proyecto vía wrapper
			// passthrough del paquete upstream @zosmaai/pi-llm-wiki (MIT) instalado
			// on-demand en ~/.frida/npm. Igual que hermes-memory corre la factory del
			// upstream contra el ExtensionAPI REAL (11 tools wiki_*, guardrails,
			// recall layering en before_agent_start) y añade la superficie que el
			// package loader de pi aportaría: prompts /wiki-* + skill llm-wiki
			// materializados como symlinks en ~/.frida, y los aliases frida
			// kb_search/kb_neighbors. Factory async: el loader awaita el jiti import
			// (sin race de registro). Gate (frida.knowledgeBase.enabled, default true).
			// Si falta el paquete: tool guía + instalación en background sin bloquear
			// el arranque (D6). Main only — la KB es del proyecto de la sesión main.
			{
				name: KNOWLEDGE_BASE_FACTORY_NAME,
				factory: (pi: any) =>
					(opts.knowledgeBaseEnabled?.() ?? true)
						? createFridaKnowledgeBase({
								agentDir: opts.agentDir,
								distDir: __dirname,
								cwd: opts.cwd,
								onStateChange: opts.onKnowledgeBaseState,
							})(pi)
						: undefined,
			},
			// frida-cc-plugins (ADR-0057): porte nativo para plugins de Claude Code.
			// Expone skills/prompts convertidos de plugins instalados vía
			// resources_discover (root aislado <agentDir>/cc-plugins — cero
			// contaminación de dirs del usuario) y el comando /ccplugin con el
			// ciclo de vida completo (marketplace add/list/remove/update,
			// add/remove/list/enable/disable, bootstrap). La extensión nunca
			// instala sola: todo install es /ccplugin add explícito (D8). MCP con
			// nombres originales + colisión = fallo (D5). Main only.
			{
				// frida-sandboxes (ADR-0047, #35): container Docker local por
				// agente — tier-2 de aislamiento (worktree = tier-1). Tools
				// sandbox_* + /sandbox + redirección bash→container (hook
				// tool_call) mientras haya sandbox activo. Gating D5: sin
				// Docker todo degrada con nota honesta. Main only.
				name: SANDBOXES_FACTORY_NAME,
				factory: (pi: any) =>
					(opts.sandboxesEnabled?.() ?? true)
						? createFridaSandboxes({
								agentDir: opts.agentDir,
								cwd: opts.cwd,
								panel: opts.sandboxesPanel,
								policy: {
									allowDomains: opts.sandboxesAllowDomains?.() ?? [],
								},
								onStateChange: opts.onSandboxesState,
							})(pi)
						: undefined,
			},
			{
				name: CC_PLUGINS_FACTORY_NAME,
				factory: (pi: any) =>
					(opts.ccPluginsEnabled?.() ?? true)
						? createFridaCcPlugins({
								agentDir: opts.agentDir,
								cwd: opts.cwd,
								onStateChange: opts.onCcPluginsState,
								extraMarketplaces: opts.ccPluginsExtraMarketplaces?.() ?? [],
								enabledPlugins: opts.ccPluginsEnabledPlugins?.() ?? {},
								presenter: opts.ccPluginsPresenter,
								panel: opts.ccPluginsPanel,
							})(pi)
						: undefined,
			},
			// frida-supi-web: porte nativo de @mrclrchtr/supi-web. Tools web_fetch_md
			// (URL pública → Markdown limpio), web_docs_search y web_docs_fetch (docs de
			// librerías vía Context7). Frida no incluye supi-web en ~/.frida, así que sin
			// este porte el agente carecería de estas capacidades. Sin renderers TUI: el
			// webview renderiza el Markdown vía ToolCard.tsx. Main only (igual que
			// frida-agent-browser).
			{
				name: "frida-supi-web",
				// Gate #53 (frida.supiWeb.enabled, default true).
				factory: (pi: any) =>
					(opts.supiWebEnabled?.() ?? true)
						? createFridaSupiWeb({ getKey: opts.getContext7Key })(pi)
						: undefined,
			},
			// frida-pipeline (ADR-0021): orquestador puro — 0 tools propios. Registra
			// los hooks invisibles de guidance recursiva (.frida/guidance/) y
			// git-context (branch+commit+user). customType `frida-*` para coexistir
			// con rpiv-pi. Fase 2: guidance + git-context; Fases 4–5 añaden
			// pipeline-pointer y agents-sync aquí.
			{
				name: "frida-pipeline",
				factory: createFridaPipeline(),
			},
			// frida-subagents (ADR-0022): sub-agentes autónomos estilo Claude Code.
			// Registra 3 tools del modelo (Agent, get_subagent_result,
			// steer_subagent). DEBE registrarse DESPUÉS de frida-pipeline para que
			// los agentes ya estén sincronizados al discovery.
			{
				name: "frida-subagents",
				// #26 detached: auth del provider activo (SecretStorage → --api-key
				// del child) + sink del panel /detached. Gate #53
				// (frida.subagents.enabled, default true).
				factory: (pi: any) =>
					(opts.subagentsEnabled?.() ?? true)
						? createFridaSubagents({
								agentDir: opts.agentDir,
								apiKey: activeProvider ? keyHolders[activeProvider] : undefined,
								provider: activeProvider,
								onDetachedPanel: (p) => {
									if (typeof opts.detachedPanel === "function") {
										opts.detachedPanel(p);
									}
								},
							})(pi)
						: undefined,
			},
			// frida-extensible-workflows (ADR-0028): orquestación multi-agente
			// determinista (porte de pi-extensible-workflows). Fase 2: registra el
			// tool `workflow` foreground-only. Sin dependencia de orden.
			{
				name: "frida-extensible-workflows",
				// Gate #53 (frida.extensibleWorkflows.enabled, default true).
				// M1 #134 (D5): el getter del toggle de codebase-index fluye al
				// motor para el seam del moat — las hijas de un patrón opt-in no
				// registran codebase-index si el usuario lo apagó (mismo getter
				// que la factory de la sesión principal de arriba).
				factory: (pi: any) =>
					(opts.extensibleWorkflowsEnabled?.() ?? true)
						? createFridaExtensibleWorkflows({
								codebaseIndexEnabled: () => opts.codebaseIndexEnabled?.() ?? true,
							})(pi)
						: undefined,
			},
			// frida-mcp-adapter (ADR-0023): integración MCP (Model Context Protocol).
			// Un único tool proxy mcp({}) (~200 tokens) da acceso a cientos de
			// servidores MCP sin quemar contexto. Registra /mcp y /mcp-auth.
			// DESPUÉS de frida-subagents para no interferir con el registro de tools.
			{
				name: "frida-mcp-adapter",
				// Gate #53 (frida.mcpAdapter.enabled, default true).
				factory: (pi: any) =>
					(opts.mcpAdapterEnabled?.() ?? true)
						? createFridaMcpAdapter()(pi)
						: undefined,
			},
			// frida-git-sync (ADR-0026): sincroniza el agentDir (~/.frida) entre
			// máquinas vía un repo Git privado. Porte nativo de @jachy/pi-git-sync.
			// Registra /fridasync (status/diff). No interactúa con otros módulos;
			// solo cablea el adapter git (pi.exec) y los comandos.
			{
				name: "frida-git-sync",
				// Gate #53 (frida.gitSync.enabled, default true).
				factory: (pi: any) =>
					(opts.gitSyncEnabled?.() ?? true) ? createFridaGitSync()(pi) : undefined,
			},
			// frida-worktree (issue #13): porte nativo de @narumitw/pi-worktree.
			// Registra /worktree (slash command del chat, UI vía ctx.ui). El comando
			// VS Code frida.worktree (botón SCM) se cablea aparte en extension.ts.
			{
				name: "frida-worktree",
				// Gate #53 (frida.worktree.enabled, default true). El comando VS Code
				// frida.worktree (botón SCM) se avisa aparte en extension.ts.
				factory: (pi: any) =>
					(opts.worktreeEnabled?.() ?? true) ? createFridaWorktree()(pi) : undefined,
			},
			// D16 — puente de diagnósticos de pi-lens al webview (resumen por turno,
			//  no squiggles del editor). Siempre activo: solo escucha el bus; si pi-lens
			//  no está presente, el callback nunca se invoca.
			{
				name: "lens-diagnostics-bridge",
				factory: createLensDiagnosticsBridge(opts.onLensDiagnostics),
			},
			// #20 — frida-goal: agente autónomo orientado a objetivos (ADR-0031).
			// Extensión REACTIVA del lifecycle (no workflow): inyecta continuaciones
			// en ESTA sesión principal desde agent_settled. NO se registra en las
			// sesiones hijas de workflows (createChildSession usa lista curada sin
			// esto — una hija no debe auto-continuarse).
			{
				name: "frida-goal",
				factory: createFridaGoal({
					onState: (snap) => opts.onGoalState?.(snap),
					notify: (level, text) => opts.onGoalNotify?.(level, text),
				}),
			},
		],
	});
	await loader.reload();

	// Resolver el modelo ACTIVO (#89): el guardado por el host. REGLA: nunca
	// cambiar de proveedor sin que el usuario lo pida. Si el catálogo del
	// proveedor guardado aún no cargó (frida-enterprise es async: OAuth +
	// GET /v1/models), refresh({providers}) bounded + reintento ANTES de caer
	// al fallback; si aún así cae, notice HONESTO por el que se entera el
	// usuario (antes: swap silencioso → sesión corría en devengine mientras el
	// selector mostraba el elegido — provider-audit.log 2026-08-19).
	// #121 (F7) — Routing por roles: resolvedor + catálogo autenticado
	// (getModels(p) no vacío = autenticado y con modelos). Se recalcula por
	// sesión (createFridaSession) con el modelo activo como rol default.
	const modelRolesConfig = readModelRolesConfig(
		opts.activeModel?.provider ?? "",
		opts.activeModel?.modelId ?? "",
	);
	const authedCatalog: Record<string, string[]> = {};
	for (const p of KNOWN_MODEL_PROVIDERS) {
		const ids = (modelRuntime.getModels?.(p) ?? [])
			.map((m: any) => String(m?.id ?? ""))
			.filter(Boolean);
		if (ids.length > 0) authedCatalog[p] = ids;
	}
	const modelRoles = resolveModelRoles({
		config: modelRolesConfig,
		authedCatalog,
	});
	// Modelo para sesiones hijas (subagents/workflows): rol smol si está
	// activo y explícito; null = modelo de la padre (comportamiento clásico).
	const childModel = pickChildModel(modelRolesConfig, modelRoles, (p, m) =>
		modelRuntime.getModel(p, m),
	);

	const resolved = await resolveActiveModel(opts.activeModel, {
		getModel: (p, m) => modelRuntime.getModel(p, m),
		getModels: (p) => modelRuntime.getModels?.(p) ?? [],
		refresh: (o) => modelRuntime.refresh(o as any),
		// #121 — respaldo por roles ANTES del fallback DevEngine de siempre:
		// primer candidato de la cadena del rol default que el runtime tenga.
		fallbackModel: () =>
			pickStartupFallback(modelRolesConfig, modelRoles, (p, m) =>
				modelRuntime.getModel(p, m),
			) ?? modelRuntime.getModel(SOFTTEK_PROVIDER, SOFTTEK_MODEL),
	});
	const model: any = resolved.model;
	if (resolved.usedFallback && resolved.notice) {
		console.warn(`[frida] ${resolved.notice}`);
		opts.onUiNotify(resolved.notice, "warning");
	}
	if (!model) {
		throw new Error(
			`No se resolvió un modelo utilizable (activo=${opts.activeModel?.provider}/${opts.activeModel?.modelId}).`,
		);
	}

	const sessionManager = opts.openPath
		? SessionManager.open(opts.openPath, opts.sessionDir, opts.cwd)
		: SessionManager.create(opts.cwd, opts.sessionDir);

	// El estado del tool `todo` lo reconstruye la propia extensión (todo-web) al
	// session_start vía replay, y monta el panel persistente. Aquí no se toca.

	const { session } = await createAgentSession({
		resourceLoader: loader,
		modelRuntime,
		model,
		settingsManager,
		sessionManager,
		agentDir: opts.agentDir,
		cwd: opts.cwd,
	} as any);

	// Fase de extensibilidad web: inyectar el ExtensionUIContext de Frida como
	// `pi.ui` y fijar mode='rpc'. El runner lo expone a las extensiones; las que
	// detectan ctx.mode==='rpc' + hasDialogUI(ctx.ui) enrutan por diálogos
	// (select/input) en vez de la factory Ink del TUI. Debe ir TRAS crear la
	// sesión: bindExtensions propaga uiContext+mode al ExtensionRunner.
	await session.bindExtensions({ uiContext, mode: "rpc" });

	return {
		session,
		extensionApi: capturedExtensionApi,
		modelRuntime,
		// #121 (F7) — routing por roles resuelto (para la UI: sección Roles del
		// panel Modelos + chip del Composer) y el modelo efectivo de hijas.
		modelRoles: {
			config: modelRolesConfig,
			resolution: modelRoles,
			childModelActive: !!childModel,
		},
		bridge,
		uiBridge,
		webBridge,
		questionnaireBridge,
		// Helper para diálogos/demo/tests: monta un cuestionario y devuelve el resultado.
		askUserQuestion: async (
			questions: WebQuestionSpec[],
		): Promise<WebQuestionnaireResult> => {
			const r = await questionnaireBridge.request({
				id: randomUUID(),
				questions,
			});
			return { answers: r.answers, cancelled: r.cancelled };
		},
		gateStats,
		sessionApprovals,
		sessionManager,
		setKey: async (providerId: string, key: string) => {
			keyHolders[providerId] = key;
			await modelRuntime.setRuntimeApiKey(providerId, key);
		},
		discoverModels: async (providerId: string) => {
			if (providerId === ZAI_PROVIDER) {
				const key = keyHolders[ZAI_PROVIDER];
				if (!key) return; // sin key, no hay nada que explorar
				const { baseUrl, contextWindow, maxTokens } = readZaiConfig();
				const ids = await discoverZaiModels(baseUrl, key);
				// Override que PRESERVA los modelos built-in (con thinkingFormat:"zai") +
				// añade los descubiertos nuevos. Si /models no trajo nada nuevo, no
				// tocamos el catálogo (el built-in queda intacto).
				// SAFETY: modelRuntime.getModels devuelve descriptores de modelo (objetos JSON planos);
				// buildZaiCatalogOverride solo los lee estructuralmente, no depende de su tipo nominal.
				const builtin = (modelRuntime.getModels?.(ZAI_PROVIDER) ??
					[]) as unknown as Array<Record<string, unknown>>;
				const override = buildZaiCatalogOverride(builtin, ids, {
					contextWindow,
					maxTokens,
				});
				if ((override.models as unknown[]).length > builtin.length) {
					modelRuntime.registerProvider(ZAI_PROVIDER, override as any);
				}
			}
			// DevEngine no expone discovery útil (los modelos son alias internos del
			// gateway); se omite. Otros proveedores aquí cuando se añadan.
		},
		// ADR-0020/D32 — sesión hija para etapas de workflow. Loader CURADO (no el
		// interactivo): provider hooks + permission system atados a los bridges
		// COMPARTIDOS. Sin todo-web/ask-user-question/frida-context (montarían paneles
		// duplicados). Spike Fase 0 (Q1) confirmó que DefaultResourceLoader es seguro
		// de construir por separado; las skills se recargan de disco (costo aceptable
		// en Fase 1; optimizar si se mide). El gate de la hija → mismo ApprovalBridge.
		createChildSession: async (childOpts: {
			prompt: string;
			sessionDir: string;
			signal?: AbortSignal;
		}) => {
			const childLoader = new DefaultResourceLoader({
				cwd: opts.cwd,
				agentDir: opts.agentDir,
				settingsManager,
				extensionFactories: [
					{
						name: "softtek-provider",
						factory: createSofttekProviderHooks({
							getKey: () => keyHolders[SOFTTEK_PROVIDER],
							onUnauthorized: () => opts.onUnauthorized(SOFTTEK_PROVIDER),
							onProviderError: opts.onProviderError,
							requestDumpPath: opts.requestDumpPath,
							diagnosticDumpPath: opts.diagnosticDumpPath,
							onGatewayDiagnosis: opts.onGatewayDiagnosis,
						}),
					},
					{
						name: "z-ai-provider",
						factory: createZaiProviderHooks({
							onUnauthorized: () => opts.onUnauthorized(ZAI_PROVIDER),
						}),
					},
					{
						name: "frida-enterprise-provider",
						factory: createFridaEnterpriseHooks({
							onUnauthorized: () => opts.onUnauthorized(FRIDA_ENTERPRISE_PROVIDER),
						}),
					},
					{
						name: "frida-permission-system",
						factory: createPermissionSystem(
							bridge,
							opts.getMode,
							approvalLogger,
							() => opts.cwd,
							opts.getGatePatterns,
							gateStats,
							sessionApprovals,
						),
					},
				],
			});
			await childLoader.reload();
			fs.mkdirSync(childOpts.sessionDir, { recursive: true });
			const childSM = SessionManager.create(opts.cwd, childOpts.sessionDir);
			const { session: childSession } = await createAgentSession({
				resourceLoader: childLoader,
				modelRuntime,
				// #121 (F7) — sesiones hijas con el rol smol cuando los roles están
				// activos (subagents/extracciones → Ollama local, costo 0); sin
				// roles o heredado: el modelo de la padre, como siempre.
				model: childModel ?? session.model,
				settingsManager,
				sessionManager: childSM,
				agentDir: opts.agentDir,
				cwd: opts.cwd,
			} as any);
			await childSession.bindExtensions({ uiContext, mode: "rpc" });
			// Abort cooperativo: al cancelar el run (botón Detener del WorkflowPanel),
			// abortamos la child session en pleno vuelo — parity con rpiv-workflow
			// (run.signal → session.abort()).
			childOpts.signal?.addEventListener("abort", () => childSession.abort?.());
			return { session: childSession, sessionManager: childSM };
		},
	};
}

export function defaultAgentDir(): string {
	// ADR-0010: agentDir PROPIO de Frida (~/.frida), desacoplado de ~/.pi (config y
	// extensiones del CLI pi). Evita choques y errores de carga: las extensiones de
	// pi asumen runtime Node CLI y fallan en el extension host de VS Code (p. ej.
	// import.meta.resolve). Las skills/extensiones de Frida viven aquí.
	return path.join(os.homedir(), ".frida");
}
