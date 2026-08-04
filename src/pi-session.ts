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
	createSofttekProviderHooks,
	DEVENGINE_BASE_URL,
	fetchDevengineContextWindow,
	lookupCanonicalModelMeta,
	SOFTTEK_MODEL,
	SOFTTEK_PROVIDER,
} from "./providers/softtek-provider";
import {
	buildZaiCatalogOverride,
	createZaiProviderHooks,
	discoverZaiModels,
	ZAI_PROVIDER,
} from "./providers/z-ai-provider";
import { API_KEY_PROVIDER_IDS } from "./providers/api-key-providers";
import { createPermissionSystem } from "./tools/frida-permission-system";
import { GateStatsStore } from "./tools/frida-permission-system/session-store";
import { SessionApprovals } from "./tools/frida-permission-system/session-approvals";
import type {
	GateStats,
	PermissionMode,
} from "./tools/frida-permission-system";
import { ApprovalLogger } from "./gates/approval-logger";
import { ApprovalBridge, type ApprovalRequest } from "./approval-bridge";
import {
	readDevengineConfig,
	readZaiConfig,
	type GatePatterns,
} from "./settings";
import { createAskUserQuestionWeb } from "./tools/ask-user-question-web";
import { createFridaContext } from "./tools/frida-context";
import { createFridaAgentBrowser } from "./tools/frida-agent-browser";
import { createFridaSupiWeb } from "./tools/frida-supi-web";
import { createFridaArgs } from "./tools/frida-args";
import { createFridaMultiSkills } from "./tools/frida-multi-skills";
import { createFridaPixSkills } from "./tools/frida-pix-skills";
import { createFridaPipeline } from "./tools/frida-pipeline";
import { createFridaSubagents } from "./tools/frida-subagents";
import { createFridaMcpAdapter } from "./tools/frida-mcp-adapter";
import { createFridaGitSync } from "./tools/frida-git-sync";
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
	/** Path para dumpear cada request enviado al gateway (overwrite). Ver ADR-0009. */
	requestDumpPath?: string;
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
	/** API key de Context7 (frida-supi-web): cache síncrono que el host carga del
	 *  SecretStorage (`frida.context7Key`) al arrancar, con fallback a
	 *  `process.env.CONTEXT7_API_KEY`. Se inyecta en las tools web_docs_* para que
	 *  la key NUNCA viva en disco/env en claro (patrón ADR-0017 aplicado a Context7). */
	getContext7Key: () => string | undefined;
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
	// ADR-0019: el contextWindow/maxTokens del modelo DevEngine se RESUELVEN por
	// prioridad: override (settings) > gateway (GET /models real) > catálogo canónico
	// (gpt-5.4-mini en azure/openai → 400000) > default. Los demás metadatos
	// (reasoning/input/thinkingLevelMap) del catálogo canónico; el compat
	// (requiresThinkingAsText etc.) es específico del bug de DevEngine (ADR-0009).
	const devCfg = readDevengineConfig();
	const canonicalMeta = lookupCanonicalModelMeta(modelRuntime, SOFTTEK_MODEL);
	// El GET /models a DevEngine SÓLO si DevEngine va a ser el modelo usado en esta
	// sesión (el activo, o el fallback si el activo no está autenticado). Así no
	// llamamos al gateway cuando el usuario usa z.ai/Copilot pero tiene la key de
	// DevEngine guardada. La resolución del modelo usa hasConfiguredAuth (no el
	// contextWindow), así que podemos pre-calcularlo aquí.
	const activeProvider = opts.activeModel?.provider;
	// ¿Usaremos DevEngine en esta sesión? Sólo si no hay modelo guardado o el
	// guardado es DevEngine. Ya NO exigimos hasConfiguredAuth aquí: la auth de la
	// API key se resuelve al hacer la petición (env/secretStorage/keychain), así
	// que restauramos el proveedor elegido aunque el credential-store del runtime
	// aún no lo refleje del todo. (Antes esto hacía que z.ai cayera a DevEngine en
	// cada recarga.)
	const willUseDevengine =
		!opts.activeModel || activeProvider === SOFTTEK_PROVIDER;
	let gatewayCtx: number | undefined;
	const devKey = keyHolders[SOFTTEK_PROVIDER];
	if (devKey && willUseDevengine) {
		gatewayCtx = await fetchDevengineContextWindow(
			DEVENGINE_BASE_URL,
			devKey,
			SOFTTEK_MODEL,
		);
	}
	const contextWindow =
		devCfg.contextWindow ??
		gatewayCtx ??
		canonicalMeta?.contextWindow ??
		300000;
	const maxTokens = devCfg.maxTokens ?? canonicalMeta?.maxTokens ?? 128000;
	modelRuntime.registerProvider(
		SOFTTEK_PROVIDER,
		buildSofttekProviderConfig({
			contextWindow,
			maxTokens,
			meta: canonicalMeta,
		}),
	);
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
	const approvalLogger = new ApprovalLogger(opts.approvalLogPath);
	// Fase 3 — contadores de la sesión para el Stats footer (en memoria, se resetea
	// por sesión). El gate los alimenta vía stats.record() en cada decisión.
	const gateStats = new GateStatsStore(opts.onGateStats ?? (() => {}));
	// Fase 4 — patrones aprobados por sesión (en memoria, se resetea por sesión).
	const sessionApprovals = new SessionApprovals();

	// Fase 2: cargar frida-lens (pi-lens) desde ~/.frida vía import() nativo (no
	// jiti, para evitar el bug de import.meta.url bajo jiti en módulos ESM).
	// Si no está instalado, se omite silenciosamente.
	let fridaLensFactory: ((pi: any) => void) | undefined;
	const fridaLensEntry = path.join(
		opts.agentDir,
		"npm",
		"node_modules",
		"pi-lens",
		"dist",
		"index.js",
	);
	if (fs.existsSync(fridaLensEntry)) {
		try {
			const fridaLensEntryPath = fridaLensEntry;
			const mod = await import(fridaLensEntryPath);
			fridaLensFactory = (mod as any).default ?? (mod as any);
		} catch (e: any) {
			console.warn("[frida-lens] No se pudo cargar:", e?.message ?? e);
		}
	}

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
			...(fridaLensFactory
				? [{ name: "frida-lens", factory: fridaLensFactory }]
				: []),
			{
				name: "softtek-provider",
				factory: createSofttekProviderHooks({
					getKey: () => keyHolders[SOFTTEK_PROVIDER],
					onUnauthorized: () => opts.onUnauthorized(SOFTTEK_PROVIDER),
					onProviderError: opts.onProviderError,
					requestDumpPath: opts.requestDumpPath,
				}),
			},
			{
				name: "z-ai-provider",
				factory: createZaiProviderHooks({
					onUnauthorized: () => opts.onUnauthorized(ZAI_PROVIDER),
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
				factory: createFridaAgentBrowser({ agentDir: opts.agentDir }),
			},
			// frida-supi-web: porte nativo de @mrclrchtr/supi-web. Tools web_fetch_md
			// (URL pública → Markdown limpio), web_docs_search y web_docs_fetch (docs de
			// librerías vía Context7). Frida no incluye supi-web en ~/.frida, así que sin
			// este porte el agente carecería de estas capacidades. Sin renderers TUI: el
			// webview renderiza el Markdown vía ToolCard.tsx. Main only (igual que
			// frida-agent-browser).
			{
				name: "frida-supi-web",
				factory: createFridaSupiWeb({ getKey: opts.getContext7Key }),
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
				factory: createFridaSubagents(),
			},
			// frida-mcp-adapter (ADR-0023): integración MCP (Model Context Protocol).
			// Un único tool proxy mcp({}) (~200 tokens) da acceso a cientos de
			// servidores MCP sin quemar contexto. Registra /mcp y /mcp-auth.
			// DESPUÉS de frida-subagents para no interferir con el registro de tools.
			{
				name: "frida-mcp-adapter",
				factory: createFridaMcpAdapter(),
			},
			// frida-git-sync (ADR-0026): sincroniza el agentDir (~/.frida) entre
			// máquinas vía un repo Git privado. Porte nativo de @jachy/pi-git-sync.
			// Registra /fridasync (status/diff). No interactúa con otros módulos;
			// solo cablea el adapter git (pi.exec) y los comandos.
			{
				name: "frida-git-sync",
				factory: createFridaGitSync(),
			},
			// D16 — puente de diagnósticos de pi-lens al webview (resumen por turno,
			//  no squiggles del editor). Siempre activo: solo escucha el bus; si pi-lens
			//  no está presente, el callback nunca se invoca.
			{
				name: "lens-diagnostics-bridge",
				factory: createLensDiagnosticsBridge(opts.onLensDiagnostics),
			},
		],
	});
	await loader.reload();

	// Resolver el modelo ACTIVO: el guardado por el host. NO exigimos
	// hasConfiguredAuth (antes sí): la auth se resuelve al disparar la petición
	// (env/secretStorage/keychain), y si de verdad falta, el 401 dispara
	// onUnauthorized → prompt de la key. Antes, exigir authed hacía que z.ai
	// cayera al fallback DevEngine en cada recarga. Además, si el modelId guardado
	// ya no existe (catálogo cambió tras un refresh), usamos el primer modelo del
	// mismo proveedor antes de caer a DevEngine — así nunca se te cambia de
	// proveedor sin que tú lo pidas.
	let model: any;
	if (opts.activeModel) {
		const am = opts.activeModel;
		model = modelRuntime.getModel(am.provider, am.modelId);
		if (!model) {
			const alts = modelRuntime.getModels?.(am.provider) ?? [];
			model = alts[0];
			if (model) {
				console.warn(
					`[frida] Modelo guardado ${am.provider}/${am.modelId} no encontrado en el catálogo; ` +
						`usando el primero disponible de ${am.provider}: ${model.id}.`,
				);
			}
		}
	}
	if (!model) model = modelRuntime.getModel(SOFTTEK_PROVIDER, SOFTTEK_MODEL);
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
						}),
					},
					{
						name: "z-ai-provider",
						factory: createZaiProviderHooks({
							onUnauthorized: () => opts.onUnauthorized(ZAI_PROVIDER),
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
				model: session.model, // mismo modelo que la interactiva
				settingsManager,
				sessionManager: childSM,
				agentDir: opts.agentDir,
				cwd: opts.cwd,
			} as any);
			await childSession.bindExtensions({ uiContext, mode: "rpc" });
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
