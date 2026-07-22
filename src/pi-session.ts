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
import { ApprovalBridge, ApprovalRequest } from "./approval-bridge";

export interface FridaSession {
  session: any;
  bridge: ApprovalBridge;
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
  /** Cache síncrono de la key (before_provider_headers es síncrono). */
  getKey: () => string | undefined;
  onUnauthorized: () => void;
  onPendingApprovals: (reqs: ApprovalRequest[]) => void;
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

  const loader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager,
    extensionFactories: [
      createSofttekProviderHooks({ getKey: () => keyHolder.current, onUnauthorized: opts.onUnauthorized }),
      createApprovalGates(bridge),
    ],
  });
  await loader.reload();

  const model = modelRuntime.getModel(SOFTTEK_PROVIDER, SOFTTEK_MODEL);
  if (!model) {
    // ⚠️ Verificar en runtime: el provider se registra en la factory; según el
    // timing/registro, getModel podría no verlo todavía. Si ocurre, revisar cómo
    // ModelRuntime expone los providers registrados por extensión.
    throw new Error(
      `No se resolvió el modelo ${SOFTTEK_PROVIDER}/${SOFTTEK_MODEL} tras registrar el provider. ` +
        `Verifica que ModelRuntime vea los providers de extensión.`
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
    bridge,
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
