import path from "node:path";
import * as vscode from "vscode";
import { createFridaSession, defaultAgentDir, FridaSession } from "./pi-session";
import { ApprovalRequest } from "./approval-bridge";
import { getWebviewHtml } from "./webview-html";

const SECRET_KEY = "frida.devengineKey";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let keyCache: string | undefined = await context.secrets.get(SECRET_KEY);
  let frida: FridaSession | undefined;

  let panel: vscode.WebviewPanel | undefined;
  const post = (msg: unknown): void => {
    panel?.webview.postMessage(msg);
  };

  function workspaceCwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  async function ensureSession(): Promise<FridaSession> {
    if (!frida) {
      frida = await createFridaSession({
        cwd: workspaceCwd(),
        agentDir: defaultAgentDir(),
        sessionDir: path.join(context.globalStorageUri.fsPath, "sessions"),
        getKey: () => keyCache,
        onUnauthorized: () => {
          keyCache = undefined;
          void promptKey(true);
        },
        onPendingApprovals: (reqs: ApprovalRequest[]) => post({ type: "approvals", approvals: reqs }),
      });
      wireSession(frida.session);
    }
    return frida;
  }

  // session.subscribe: observador para MOSTRAR (streaming + tarjetas de tool).
  // El BLOQUEO de tools vive en la extensión de gates (createApprovalGates).
  function wireSession(session: any): void {
    session.subscribe((event: any) => {
      switch (event?.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta") {
            post({ type: "delta", text: event.assistantMessageEvent.delta });
          }
          break;
        case "tool_execution_start":
          post({ type: "tool_start", tool: event.toolName, args: safeArgs(event.args) });
          break;
        case "tool_execution_end":
          post({ type: "tool_end", tool: event.toolName, isError: !!event.isError });
          break;
        case "agent_end":
          post({ type: "turn_end" });
          break;
      }
    });
  }

  async function openPanel(): Promise<void> {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Two, true);
      return;
    }
    panel = vscode.window.createWebviewPanel("frida", "Frida Code", vscode.ViewColumn.Two, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist-webview")],
    });
    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
    panel.onDidDispose(() => {
      panel = undefined;
    });
    panel.webview.onDidReceiveMessage((msg: any) => {
      void handleWebviewMessage(msg);
    });
  }

  async function handleWebviewMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case "webview_ready":
        if (!keyCache) post({ type: "need_key" });
        else post({ type: "session_ready" });
        break;
      case "submit":
        await runPrompt(String(msg.text ?? ""));
        break;
      case "approval_response":
        (await ensureSession()).bridge.resolve({
          id: msg.id,
          decision: msg.decision === "accept" ? "accept" : "reject",
          acceptAll: !!msg.acceptAll,
        });
        break;
      case "set_key":
        await setKey(String(msg.key ?? ""));
        break;
      case "compact":
        await compactContext();
        break;
      case "abort":
        await abortRun();
        break;
      case "new_session":
        await newSession();
        break;
    }
  }

  async function runPrompt(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!keyCache) {
      post({ type: "need_key" });
      return;
    }
    post({ type: "user", text: trimmed });
    post({ type: "turn_start" });
    try {
      const { session } = await ensureSession();
      await session.prompt(trimmed);
    } catch (e: any) {
      post({ type: "error", text: String(e?.message ?? e) });
    } finally {
      post({ type: "turn_end" });
    }
  }

  async function compactContext(): Promise<void> {
    try {
      const { session } = await ensureSession();
      post({ type: "info", text: "Compactando contexto…" });
      await session.compact();
      post({ type: "info", text: "Contexto compactado." });
    } catch (e: any) {
      post({ type: "info", text: "Error al compactar: " + String(e?.message ?? e) });
    }
  }

  async function abortRun(): Promise<void> {
    try {
      const { session } = await ensureSession();
      await session.abort();
    } catch {
      /* noop */
    }
  }

  async function newSession(): Promise<void> {
    if (frida) {
      try {
        await frida.session.dispose?.();
      } catch {
        /* noop */
      }
      frida = undefined;
    }
    post({ type: "cleared" });
    post({ type: "info", text: "Nueva sesión iniciada." });
  }

  async function setKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) return;
    await context.secrets.store(SECRET_KEY, trimmed);
    keyCache = trimmed;
    if (frida) await frida.setKey(trimmed); // inyecta la key al runtime (setRuntimeApiKey)
    post({ type: "key_set" });
    post({ type: "session_ready" });
  }

  async function promptKey(isRotation = false): Promise<void> {
    const key = await vscode.window.showInputBox({
      prompt: isRotation
        ? "Tu API key de DevEngine fue rechazada (401). Vuelve a introducirla."
        : "Introduce tu API key de DevEngine (se envía como X-Api-Key).",
      password: true,
      ignoreFocusOut: true,
    });
    if (key) {
      await setKey(key);
    } else {
      post({ type: "need_key" });
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("frida.openPanel", () => void openPanel()),
    vscode.commands.registerCommand("frida.setKey", () => void promptKey(true)),
    vscode.commands.registerCommand("frida.compact", () => void compactContext()),
    vscode.commands.registerCommand("frida.abort", () => void abortRun()),
    vscode.commands.registerCommand("frida.newSession", () => void newSession())
  );
}

function safeArgs(args: unknown): string {
  try {
    return JSON.stringify(args).slice(0, 500);
  } catch {
    return String(args).slice(0, 500);
  }
}

export function deactivate(): void {
  /* sin cleanup especial por ahora */
}
