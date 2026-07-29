import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
	SOFTTEK_MODEL,
	SOFTTEK_PROVIDER,
} from "./providers/softtek-provider";
import { createApprovalGates } from "./gates/approval-gates";
import type { ApprovalMode } from "./gates/approval-gates";
import { ApprovalLogger } from "./gates/approval-logger";
import { ApprovalBridge, type ApprovalRequest } from "./approval-bridge";
import { readDevengineConfig, type GatePatterns } from "./settings";
import { createAskUserQuestionWeb } from "./tools/ask-user-question-web";
import { createFridaContext } from "./tools/frida-context";
import { createTodoWeb } from "./tools/todo-web";
import { UiBridge, type UiRequest } from "./ui-bridge";
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
	modelRuntime: any;
	bridge: ApprovalBridge;
	uiBridge: UiBridge;
	webBridge: WebBridge;
	sessionManager: any;
	setKey: (key: string) => Promise<void>;
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
	/** Cache síncrono de la key (before_provider_headers es síncrono). */
	getKey: () => string | undefined;
	onUnauthorized: () => void;
	/** Dumpea el request al gateway ante un 4xx/5xx (DevEngine no devuelve body en
	 *  el 500; el request nos dice qué campo lo rechaza). Ver ADR-0009. */
	onProviderError?: (payload: unknown, status: number) => void;
	/** Path para dumpear cada request enviado al gateway (overwrite). Ver ADR-0009. */
	requestDumpPath?: string;
	onPendingApprovals: (reqs: ApprovalRequest[]) => void;
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
	getMode: () => ApprovalMode;
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

	const keyHolder: { current?: string } = { current: opts.getKey() };

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
	// Registramos el proveedor DIRECTAMENTE en ModelRuntime para que getModel lo vea.
	modelRuntime.registerProvider(
		SOFTTEK_PROVIDER,
		buildSofttekProviderConfig(readDevengineConfig()),
	);
	// Si ya hay key (onboarding previo), la fijamos en el runtime para que getAuth
	// resuelva y Pi NO bloquee con "No API key found". El X-Api-Key real lo inyecta
	// before_provider_headers (authHeader:false ⇒ Pi no manda Authorization: Bearer).
	if (keyHolder.current) {
		await modelRuntime.setRuntimeApiKey(SOFTTEK_PROVIDER, keyHolder.current);
	}

	const bridge = new ApprovalBridge(opts.onPendingApprovals);
	// Fase de extensibilidad web: ExtensionUIContext de Frida. Implementa el slice
	// data-oriented (select/input/confirm) del contrato `pi.ui` del SDK y lo enruta
	// al webview. Cableado: session.bindExtensions({ uiContext, mode: 'rpc' }) más
	// abajo. Así las extensiones nativas que respetan el patrón RPC (rpiv-
	// ask-user-question) funcionan en el web sin su factory Ink del TUI.
	const uiBridge = new UiBridge(opts.onUiRequest);
	const webBridge = new WebBridge(opts.onWebCommit);
	const uiContext = createFridaUiContext(uiBridge, opts.onUiNotify, webBridge);
	// Logger de auditoría del gate (Prioridad 2). Una instancia por sesión;
	// escribe JSONL append-only con chmod 0600/0700 y nunca lanza.
	const approvalLogger = new ApprovalLogger(opts.approvalLogPath);

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

	const loader = new DefaultResourceLoader({
		cwd: opts.cwd,
		agentDir: opts.agentDir,
		settingsManager,
		extensionFactories: [
			...(fridaLensFactory
				? [{ name: "frida-lens", factory: fridaLensFactory }]
				: []),
			{
				name: "softtek-provider",
				factory: createSofttekProviderHooks({
					getKey: () => keyHolder.current,
					onUnauthorized: opts.onUnauthorized,
					onProviderError: opts.onProviderError,
					requestDumpPath: opts.requestDumpPath,
				}),
			},
			{
				name: "approval-gates",
				factory: createApprovalGates(
					bridge,
					opts.getMode,
					approvalLogger,
					() => opts.cwd,
					opts.getGatePatterns,
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

	// Resolver el modelo ACTIVO: el guardado por el host si está disponible
	// (y autenticado para OAuth), si no, el default de Softtek.
	let model: any;
	if (opts.activeModel) {
		const am = opts.activeModel;
		const authed =
			am.provider === SOFTTEK_PROVIDER ||
			modelRuntime.hasConfiguredAuth(am.provider);
		if (authed) model = modelRuntime.getModel(am.provider, am.modelId);
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
		modelRuntime,
		bridge,
		uiBridge,
		webBridge,
		sessionManager,
		setKey: async (key: string) => {
			keyHolder.current = key;
			await modelRuntime.setRuntimeApiKey(SOFTTEK_PROVIDER, key);
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
