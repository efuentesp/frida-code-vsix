import path from "node:path";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createFridaSession, defaultAgentDir, FridaSession } from "./pi-session";
import { ApprovalRequest } from "./approval-bridge";
import type { ApprovalMode } from "./gates/approval-gates";
import { SOFTTEK_MODEL_DISPLAY } from "./providers/softtek-provider";
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
  const sessionDirPath = path.join(context.globalStorageUri.fsPath, "sessions");
  let approvalMode: ApprovalMode = "manual";
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
        sessionDir: sessionDirPath,
        getKey: () => keyCache,
        onUnauthorized: () => {
          keyCache = undefined;
          void promptKey(true);
        },
        onPendingApprovals: (reqs: ApprovalRequest[]) => post({ type: "approvals", approvals: reqs }),
        getMode: () => approvalMode,
      });
      wireSession(frida.session);
      sendModelInfo();
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

  function sendModelInfo(): void {
    post({ type: "model_info", model: SOFTTEK_MODEL_DISPLAY, thinking: frida?.session?.thinkingLevel ?? "medium" });
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
        post({ type: "mode", mode: approvalMode });
        sendModelInfo();
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
      case "list_sessions":
        await sendSessions();
        break;
      case "switch_session":
        await switchSession(String(msg.path ?? ""));
        break;
      case "rename_session":
        await renameSession(String(msg.path ?? ""), String(msg.name ?? ""));
        break;
      case "set_mode":
        approvalMode = msg.mode === "auto-edit" || msg.mode === "auto" ? msg.mode : "manual";
        post({ type: "mode", mode: approvalMode });
        break;
      case "set_thinking":
        try { frida?.session?.setThinkingLevel?.(String(msg.level ?? "medium")); } catch { /* noop */ }
        sendModelInfo();
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

  async function sendSessions(): Promise<void> {
    try {
      const infos = await SessionManager.listAll(sessionDirPath);
      const items = infos
        .map((i: any) => ({
          path: String(i.path),
          name: i.name as string | undefined,
          firstMessage: String(i.firstMessage ?? "").slice(0, 160),
          messageCount: Number(i.messageCount ?? 0),
          modified: i.modified instanceof Date ? i.modified.getTime() : Number(i.modified) || 0,
        }))
        .sort((a: any, b: any) => b.modified - a.modified);
      post({ type: "sessions", items, currentPath: frida?.session?.sessionFile });
    } catch (e: any) {
      post({ type: "info", text: "Error al listar sesiones: " + String(e?.message ?? e) });
    }
  }

  async function switchSession(pathStr: string): Promise<void> {
    if (!pathStr) return;
    if (frida) {
      try { await frida.session.dispose?.(); } catch { /* noop */ }
      frida = undefined;
    }
    try {
      frida = await createFridaSession({
        cwd: workspaceCwd(),
        agentDir: defaultAgentDir(),
        sessionDir: sessionDirPath,
        openPath: pathStr,
        getKey: () => keyCache,
        onUnauthorized: () => { keyCache = undefined; void promptKey(true); },
        onPendingApprovals: (reqs: ApprovalRequest[]) => post({ type: "approvals", approvals: reqs }),
        getMode: () => approvalMode,
      });
      wireSession(frida.session);
      postHistory();
      sendModelInfo();
    } catch (e: any) {
      post({ type: "info", text: "Error al abrir sesión: " + String(e?.message ?? e) });
    }
  }

  async function renameSession(pathStr: string, name: string): Promise<void> {
    const clean = name.trim();
    if (!pathStr || !clean) return;
    try {
      if (frida && frida.session?.sessionFile === pathStr) {
        frida.sessionManager?.appendSessionInfo?.(clean);
      } else {
        const sm = SessionManager.open(pathStr, sessionDirPath, workspaceCwd());
        sm.appendSessionInfo(clean);
      }
      post({ type: "info", text: "Sesión renombrada: " + clean });
      await sendSessions();
    } catch (e: any) {
      post({ type: "info", text: "Error al renombrar: " + String(e?.message ?? e) });
    }
  }

  function postHistory(): void {
    try {
      const msgs: any[] = frida?.session?.agent?.state?.messages ?? [];
      const items = msgs
        .map((m: any) => ({ role: String(m?.role ?? ""), text: extractText(m) }))
        .filter((x) => x.text || x.role === "user");
      const name = frida?.sessionManager?.getSessionName?.();
      post({ type: "history", name, items: items.slice(-200) });
    } catch {
      /* noop */
    }
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
    vscode.commands.registerCommand("frida.newSession", () => void newSession()),
    vscode.commands.registerCommand("frida.approvalMode", () => {
      approvalMode = approvalMode === "manual" ? "auto-edit" : approvalMode === "auto-edit" ? "auto" : "manual";
      post({ type: "mode", mode: approvalMode });
    })
  );
}

function extractText(m: any): string {
  const c = m?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((b: any) => b?.type === "text").map((b: any) => b?.text ?? "").join("");
  return "";
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
