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
	createSofttekProviderHooks,
	SOFTTEK_MODEL,
	SOFTTEK_PROVIDER,
	SOFTTEK_PROVIDER_CONFIG,
} from "./providers/softtek-provider";
import { createApprovalGates } from "./gates/approval-gates";
import type { ApprovalMode } from "./gates/approval-gates";
import { ApprovalLogger } from "./gates/approval-logger";
import { ApprovalBridge, type ApprovalRequest } from "./approval-bridge";
import type { GatePatterns } from "./settings";
import { createAskUserQuestion } from "./tools/ask-user-question";
import { createTodoTool } from "./tools/todo/todo";
import { replayFromBranch } from "./tools/todo/replay";
import { QuestionBridge, type QuestionRequest } from "./question-bridge";
import { resetTodoState, setTodoState } from "./todo-state";
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
	questionBridge: QuestionBridge;
	sessionManager: any;
	setKey: (key: string) => Promise<void>;
}

export interface CreateFridaSessionOptions {
	/** cwd de trabajo = carpeta del workspace (donde el agente lee/edita archivos). */
	cwd: string;
	/** agentDir del dev (~/.pi/agent) para honrar el descubrimiento abierto (ADR-0005). */
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
	onPendingApprovals: (reqs: ApprovalRequest[]) => void;
	onPendingQuestions: (reqs: QuestionRequest[]) => void;
	getMode: () => ApprovalMode;
	/** Toggles de tools (Configuración). Las factories se registran según estos. */
	askUserQuestionEnabled: () => boolean;
	todoEnabled: () => boolean;
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

	const settingsManager = SettingsManager.create(opts.cwd, opts.agentDir);
	// D11 — apagar la telemetría de instalación (el update-check ya está off vía env).
	settingsManager.applyOverrides({ enableInstallTelemetry: false });

	// ModelRuntime por defecto usa ~/.pi/agent (= agentDir), alineado con ADR-0005.
	const modelRuntime = await ModelRuntime.create();
	// Registramos el proveedor DIRECTAMENTE en ModelRuntime para que getModel lo vea.
	modelRuntime.registerProvider(SOFTTEK_PROVIDER, SOFTTEK_PROVIDER_CONFIG);
	// Si ya hay key (onboarding previo), la fijamos en el runtime para que getAuth
	// resuelva y Pi NO bloquee con "No API key found". El X-Api-Key real lo inyecta
	// before_provider_headers (authHeader:false ⇒ Pi no manda Authorization: Bearer).
	if (keyHolder.current) {
		await modelRuntime.setRuntimeApiKey(SOFTTEK_PROVIDER, keyHolder.current);
	}

	const bridge = new ApprovalBridge(opts.onPendingApprovals);
	const questionBridge = new QuestionBridge(opts.onPendingQuestions);
	// Logger de auditoría del gate (Prioridad 2). Una instancia por sesión;
	// escribe JSONL append-only con chmod 0600/0700 y nunca lanza.
	const approvalLogger = new ApprovalLogger(opts.approvalLogPath);

	const loader = new DefaultResourceLoader({
		cwd: opts.cwd,
		agentDir: opts.agentDir,
		settingsManager,
		extensionFactories: [
			{
				name: "softtek-provider",
				factory: createSofttekProviderHooks({
					getKey: () => keyHolder.current,
					onUnauthorized: opts.onUnauthorized,
					onProviderError: opts.onProviderError,
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
			{
				name: "ask-user-question",
				factory: toggleable(
					opts.askUserQuestionEnabled,
					createAskUserQuestion(questionBridge),
				),
			},
			{ name: "todo", factory: toggleable(opts.todoEnabled, createTodoTool()) },
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

	// Reconstruir el estado del tool `todo` desde el historial de la sesión (cada
	// toolResult "todo" lleva el snapshot en details). Al crear sesión nueva el
	// branch está vacío → EMPTY_STATE. resetTodoState() garantiza un punto de
	// partida limpio antes del replay (no pisa sesiones anteriores en memoria).
	resetTodoState();
	setTodoState(replayFromBranch({ sessionManager }));

	const { session } = await createAgentSession({
		resourceLoader: loader,
		modelRuntime,
		model,
		settingsManager,
		sessionManager,
		agentDir: opts.agentDir,
		cwd: opts.cwd,
	} as any);

	return {
		session,
		modelRuntime,
		bridge,
		questionBridge,
		sessionManager,
		setKey: async (key: string) => {
			keyHolder.current = key;
			await modelRuntime.setRuntimeApiKey(SOFTTEK_PROVIDER, key);
		},
	};
}

export function defaultAgentDir(): string {
	return path.join(os.homedir(), ".pi", "agent");
}
