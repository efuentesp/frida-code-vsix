import path from "node:path";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import { createFridaSession, defaultAgentDir, FridaSession } from "./pi-session";
import { ApprovalRequest } from "./approval-bridge";
import { getWebviewHtml } from "./webview-html";

const SECRET_KEY = "frida.devengineKey";

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf", "zip", "gz", "tar",
  "woff", "woff2", "ttf", "otf", "node", "wasm", "mp3", "mp4", "class", "exe", "dll", "so", "dylib",
]);

/** Busca archivos del workspace cuyo path contiene la consulta (fuzzy-simple). */
async function searchFiles(query: string): Promise<string[]> {
  const wf = vscode.workspace.workspaceFolders?.[0];
  if (!wf) return [];
  const exclude = "**/node_modules/**,**/.git/**,**/dist/**,**/dist-webview/**,**/.vscode/**";
  const safe = query.trim().replace(/[*?{}[\]]/g, "?");
  const include = safe ? `**/*${safe}*` : "**/*";
  try {
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(wf, include), exclude, 40);
    return uris
      .map((u) => vscode.workspace.asRelativePath(u))
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
      .slice(0, 20);
  } catch {
    return [];
  }
}

/** Expande los tokens @ruta del prompt al contenido del archivo (texto), como Pi. */
async function expandAtFiles(text: string, cwd: string): Promise<string> {
  const re = /@([^\s@]+)/g;
  const matches: { index: number; full: string; rel: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) matches.push({ index: m.index, full: m[0], rel: m[1] });
  if (matches.length === 0) return text;
  let out = text;
  for (const mt of matches.slice().reverse()) {
    const ext = path.extname(mt.rel).slice(1).toLowerCase();
    if (BINARY_EXT.has(ext)) continue; // binarios: se deja el token (no se adjunta)
    const abs = path.join(cwd, mt.rel);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) continue;
      const content = await fs.readFile(abs, "utf8");
      const trunc = content.length > 200_000 ? content.slice(0, 200_000) + "\n…(truncado)" : content;
      const block = `\n\n\`\`\`${ext} // @${mt.rel}\n${trunc}\n\`\`\`\n`;
      out = out.slice(0, mt.index) + block + out.slice(mt.index + mt.full.length);
    } catch {
      /* no existe / no legible → se deja el token tal cual */
    }
  }
  return out;
}

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
  function postUsage(session: any): void {
    try {
      const msgs: any[] = session?.agent?.state?.messages ?? [];
      const contextWindow: number = session?.model?.contextWindow ?? 0;
      let sessionTokens = 0, lastInput = 0, lastOutput = 0, cacheRead = 0, cacheWrite = 0;
      for (const m of msgs) {
        if (m?.role === "assistant" && m?.usage) {
          const u = m.usage;
          sessionTokens += (u.input ?? 0) + (u.output ?? 0);
          lastInput = u.input ?? 0; lastOutput = u.output ?? 0;
          cacheRead += u.cacheRead ?? 0; cacheWrite += u.cacheWrite ?? 0;
        }
      }
      post({
        type: "usage",
        inputTokens: lastInput,
        outputTokens: lastOutput,
        cacheRead,
        cacheWrite,
        sessionTokens,
        contextWindow,
        contextPercent: contextWindow ? Math.min(100, (lastInput / contextWindow) * 100) : 0,
      });
    } catch {
      /* noop */
    }
  }

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
          postUsage(session);
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
      case "search_files": {
        const q = String(msg.query ?? "");
        const items = await searchFiles(q);
        post({ type: "files", query: q, items });
        break;
      }
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
      const expanded = await expandAtFiles(trimmed, workspaceCwd());
      await session.prompt(expanded);
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
