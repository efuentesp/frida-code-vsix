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
import { createSofttekProviderHooks, SOFTTEK_MODEL, SOFTTEK_PROVIDER, SOFTTEK_PROVIDER_CONFIG } from "./providers/softtek-provider";
import { createApprovalGates } from "./gates/approval-gates";
import type { ApprovalMode } from "./gates/approval-gates";
import { ApprovalBridge, ApprovalRequest } from "./approval-bridge";
import { createAskUserQuestion } from "./tools/ask-user-question";
import { QuestionBridge, type QuestionRequest } from "./question-bridge";

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
  /** Si se da, abre la sesión existente (switch) en vez de crear una nueva. */
  openPath?: string;
  /** Proveedor/modelo activo persistido por el host. Si no resuelve o no está
   * autenticado, cae al default (Softtek DevEngine). */
  activeModel?: { provider: string; modelId: string };
  /** Cache síncrono de la key (before_provider_headers es síncrono). */
  getKey: () => string | undefined;
  onUnauthorized: () => void;
  onPendingApprovals: (reqs: ApprovalRequest[]) => void;
  onPendingQuestions: (reqs: QuestionRequest[]) => void;
  getMode: () => ApprovalMode;
}

export async function createFridaSession(opts: CreateFridaSessionOptions): Promise<FridaSession> {
  // D11 — desactivar phone-home a pi.dev.
  process.env.PI_SKIP_VERSION_CHECK = "1";
  process.env.PI_OFFLINE = "1"; // apaga también el chequeo de paquetes
  // D13 — sesiones desacopladas del agentDir (se pasa explícito a SessionManager).
  fs.mkdirSync(opts.sessionDir, { recursive: true });

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

  const loader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager,
    extensionFactories: [
      { name: "softtek-provider", factory: createSofttekProviderHooks({ getKey: () => keyHolder.current, onUnauthorized: opts.onUnauthorized }) },
      { name: "approval-gates", factory: createApprovalGates(bridge, opts.getMode) },
      { name: "ask-user-question", factory: createAskUserQuestion(questionBridge) },
    ],
  });
  await loader.reload();

  // Resolver el modelo ACTIVO: el guardado por el host si está disponible
  // (y autenticado para OAuth), si no, el default de Softtek.
  let model: any;
  if (opts.activeModel) {
    const am = opts.activeModel;
    const authed = am.provider === SOFTTEK_PROVIDER || modelRuntime.hasConfiguredAuth(am.provider);
    if (authed) model = modelRuntime.getModel(am.provider, am.modelId);
  }
  if (!model) model = modelRuntime.getModel(SOFTTEK_PROVIDER, SOFTTEK_MODEL);
  if (!model) {
    throw new Error(
      `No se resolvió un modelo utilizable (activo=${opts.activeModel?.provider}/${opts.activeModel?.modelId}).`
    );
  }

  const sessionManager = opts.openPath
    ? SessionManager.open(opts.openPath, opts.sessionDir, opts.cwd)
    : SessionManager.create(opts.cwd, opts.sessionDir);

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
