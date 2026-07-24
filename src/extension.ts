import path from "node:path";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createFridaSession, defaultAgentDir, FridaSession } from "./pi-session";
import { ApprovalRequest } from "./approval-bridge";
import type { ApprovalMode } from "./gates/approval-gates";
import { SOFTTEK_MODEL_DISPLAY } from "./providers/softtek-provider";
import { getWebviewHtml } from "./webview-html";

const execFileP = promisify(execFile);

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
  // Message Queue (pi): mensajes encolados mientras el agente trabaja + contador
  // de turnos dentro del agent run actual (para saber cuándo se entrega uno).
  const pendingQueue: { text: string }[] = [];
  let turnsInRun = 0;

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
        onPendingQuestions: (reqs) => post({ type: "questions", items: reqs }),
        getMode: () => approvalMode,
      });
      wireSession(frida.session);
      sendModelInfo();
      postResources();
    }
    return frida;
  }

  // session.subscribe: observador para MOSTRAR (streaming + tarjetas de tool).
  // El BLOQUEO de tools vive en la extensión de gates (createApprovalGates).
  function postUsage(session: any): void {
    try {
      const msgs: any[] = session?.agent?.state?.messages ?? [];
      let sessionTokens = 0, lastInput = 0, lastOutput = 0, cacheRead = 0, cacheWrite = 0;
      for (const m of msgs) {
        if (m?.role === "assistant" && m?.usage) {
          const u = m.usage;
          sessionTokens += (u.input ?? 0) + (u.output ?? 0);
          lastInput = u.input ?? 0; lastOutput = u.output ?? 0;
          cacheRead += u.cacheRead ?? 0; cacheWrite += u.cacheWrite ?? 0;
        }
      }
      // Contexto ACTUAL: pi estima los tokens del contexto vivo con
      // estimateContextTokens (getContextUsage). Es más confiable que el
      // `input` del último usage, que según el gateway puede venir vacío y
      // dejar el % en 0.
      const ctx = session?.getContextUsage?.();
      const contextTokens = ctx?.tokens ?? null;
      const contextWindow = ctx?.contextWindow ?? session?.model?.contextWindow ?? 0;
      const contextPercent =
        ctx?.percent ??
        (contextTokens != null && contextWindow ? Math.min(100, (contextTokens / contextWindow) * 100) : 0);
      post({
        type: "usage",
        inputTokens: contextTokens ?? lastInput, // tokens que ocupan el contexto
        outputTokens: lastOutput,
        cacheRead,
        cacheWrite,
        sessionTokens,
        contextWindow,
        contextPercent,
      });
    } catch {
      /* noop */
    }
  }

  function sendModelInfo(): void {
    post({ type: "model_info", model: SOFTTEK_MODEL_DISPLAY, thinking: frida?.session?.thinkingLevel ?? "medium" });
  }

  // Recolecta los recursos cargados por el resourceLoader de pi (extensiones,
  // skills, prompts, themes, archivos de contexto) para mostrarlos en el panel.
  // Equivalente al showLoadedResources de la TUI. Los tipos internos de pi no se
  // reexportan por el SDK, así que se tratan como any.
  function collectResources(): any {
    const session: any = frida?.session;
    const rl: any = session?.resourceLoader;
    if (!rl) return undefined;
    const ext = rl.getExtensions?.() ?? { extensions: [], errors: [] };
    const skills = rl.getSkills?.() ?? { skills: [], diagnostics: [] };
    const prompts = rl.getPrompts?.() ?? { prompts: [], diagnostics: [] };
    const themes = rl.getThemes?.() ?? { themes: [] };
    const agents = rl.getAgentsFiles?.() ?? { agentsFiles: [] };
    const errors: { path: string; error: string }[] = [];
    for (const e of ext.errors ?? []) errors.push({ path: String(e.path), error: String(e.error) });
    for (const d of [...(skills.diagnostics ?? []), ...(prompts.diagnostics ?? [])]) {
      errors.push({ path: String(d?.path ?? d?.file ?? ""), error: String(d?.message ?? d) });
    }
    return {
      extensions: (ext.extensions ?? [])
        .filter((e: any) => !e.hidden)
        .map((e: any) => {
          const p = String(e.path ?? "");
          return {
            path: p,
            // pi marca las factories registradas en código como "<inline:...>"
            // (resource-loader.js). Las de disco tienen un path real de archivo.
            inline: p.startsWith("<inline:"),
            tools: Array.from(e.tools?.keys?.() ?? []),
            commands: Array.from(e.commands?.keys?.() ?? []),
          };
        }),
      skills: (skills.skills ?? []).map((s: any) => ({ name: String(s.name), description: String(s.description ?? "") })),
      prompts: (prompts.prompts ?? []).map((p: any) => ({ name: String(p.name), description: String(p.description ?? "") })),
      themes: (themes.themes ?? []).map((t: any) => ({ name: String(t.name) })),
      contextFiles: (agents.agentsFiles ?? []).map((f: any) => ({ path: String(f.path) })),
      errors,
    };
  }

  function postResources(): void {
    const data = collectResources();
    if (data) post({ type: "resources", data });
  }

  // Info del workspace: carpeta de trabajo + branch git (y si hay cambios
  // sin committer). Lo ejecuta el HOST directamente (no el modelo), así que no
  // pasa por el gate de bash de D7. No depende de la extensión Git de VS Code.
  async function collectWorkspace(): Promise<{ cwd: string; branch?: string; dirty?: boolean }> {
    const cwd = workspaceCwd();
    try {
      const { stdout: branchOut } = await execFileP("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 3000 });
      const branch = branchOut.trim();
      let dirty = false;
      try {
        const { stdout: status } = await execFileP("git", ["status", "--porcelain"], { cwd, timeout: 3000 });
        dirty = status.trim().length > 0;
      } catch { /* ignore */ }
      return { cwd, branch, dirty };
    } catch {
      return { cwd }; // no es repo o git no disponible
    }
  }

  async function postWorkspace(): Promise<void> {
    try {
      const ws = await collectWorkspace();
      post({ type: "workspace", ...ws });
    } catch { /* ignore */ }
  }

  // Crea la sesión en segundo plano (onboarding/listo/inicio) para poder mostrar
  // los recursos cuanto antes. Captura errores para no dejar promesas sin manejar.
  function bootstrapSession(): void {
    void ensureSession().catch((e: any) => {
      post({ type: "info", text: "No se pudo iniciar la sesión: " + String(e?.message ?? e) });
    });
  }

  function postQueued(): void {
    post({ type: "queued", items: pendingQueue.map((q) => q.text) });
  }

  function resetQueue(): void {
    pendingQueue.length = 0;
    turnsInRun = 0;
    postQueued();
  }

  function wireSession(session: any): void {
    session.subscribe((event: any) => {
      switch (event?.type) {
        case "agent_start":
          turnsInRun = 0;
          post({ type: "agent_busy", busy: true });
          post({ type: "turn_active" });
          break;
        case "agent_end":
          postUsage(session);
          post({ type: "agent_busy", busy: false });
          break;
        case "turn_start":
          // turn_start tras el primero (turnsInRun>0) = entrega de un mensaje
          // encolado: creamos su turno aquí para que los deltas caigan en él.
          if (turnsInRun > 0 && pendingQueue.length > 0) {
            const next = pendingQueue.shift()!;
            post({ type: "user", text: next.text });
            postQueued();
          }
          turnsInRun++;
          post({ type: "turn_active" });
          break;
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta") {
            post({ type: "delta", text: event.assistantMessageEvent.delta });
          }
          break;
        case "tool_execution_start":
          post({ type: "tool_start", tool: event.toolName, args: compactArgs(event.args) });
          break;
        case "tool_execution_end":
          post({ type: "tool_end", tool: event.toolName, isError: !!event.isError, result: summarizeResult(event.result) });
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
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "dist-webview"),
        vscode.Uri.joinPath(context.extensionUri, "media"),
      ],
    });
    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
    panel.onDidDispose(() => {
      panel = undefined;
    });
    panel.onDidChangeViewState(() => {
      if (panel?.visible) void postWorkspace();
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
        else {
          post({ type: "session_ready" });
          bootstrapSession(); // crea la sesión para mostrar recursos al inicio
          void postWorkspace();
        }
        break;
      case "submit":
        await runPrompt(String(msg.text ?? ""), msg.mode === "followUp" ? "followUp" : "steer");
        break;
      case "approval_response":
        (await ensureSession()).bridge.resolve({
          id: msg.id,
          decision: msg.decision === "accept" ? "accept" : "reject",
          acceptAll: !!msg.acceptAll,
        });
        break;
      case "question_response":
        (await ensureSession()).questionBridge.resolve({
          id: msg.id,
          answers: msg.answers ?? [],
          cancelled: !!msg.cancelled,
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
      case "reload":
        await reloadResources();
        break;
      case "list_resources":
        postResources();
        break;
      case "workspace":
        await postWorkspace();
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
      case "delete_session":
        await deleteSession(String(msg.path ?? ""));
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

  async function runPrompt(text: string, mode: "steer" | "followUp" = "steer"): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!keyCache) {
      post({ type: "need_key" });
      return;
    }

    // Modo bash del usuario: "!comando" ejecuta y envía el output al LLM;
    // "!!comando" ejecuta sin enviarlo (solo se muestra en el panel).
    // Es ejecución directa del usuario (no pasa por el gate de bash de D7).
    if (trimmed.startsWith("!")) {
      const exclude = trimmed.startsWith("!!");
      const command = (exclude ? trimmed.slice(2) : trimmed.slice(1)).trim();
      if (!command) return; // "!" a secas → se ignora
      await runBashShortcut(command, exclude, trimmed);
      return;
    }

    let session: FridaSession;
    try {
      session = await ensureSession();
    } catch (e: any) {
      post({ type: "error", text: String(e?.message ?? e) });
      return;
    }
    const expanded = await expandAtFiles(trimmed, workspaceCwd());

    // Si el agente está ocupado, encolamos (Message Queue de pi): el turno de
    // este mensaje NO se crea ahora, sino cuando el agente lo entregue
    // (turn_start>0 en wireSession), para que los deltas del turno en curso
    // sigan cayendo en su propio turno y no se mezclen.
    if (session.session?.isStreaming) {
      pendingQueue.push({ text: trimmed });
      postQueued();
      try {
        await session.session.prompt(expanded, { streamingBehavior: mode });
      } catch (e: any) {
        const idx = pendingQueue.findIndex((q) => q.text === trimmed);
        if (idx >= 0) pendingQueue.splice(idx, 1);
        postQueued();
        post({ type: "error", text: String(e?.message ?? e) });
      }
      return;
    }

    // Agente libre: turno normal. El busy lo marcan los eventos agent_start/end
    // reales de pi (no turn_start/turn_end manuales).
    post({ type: "user", text: trimmed });
    try {
      await session.session.prompt(expanded);
    } catch (e: any) {
      post({ type: "error", text: String(e?.message ?? e) });
    }
  }

  // Ejecuta un atajo de bash del usuario (!comando / !!comando).
  // Usa session.executeBash del SDK: si excludeFromContext=false, el resultado
  // queda registrado en el contexto del LLM (igual que la TUI de pi).
  async function runBashShortcut(command: string, exclude: boolean, raw: string): Promise<void> {
    let session: FridaSession;
    try {
      session = await ensureSession();
    } catch (e: any) {
      post({ type: "error", text: String(e?.message ?? e) });
      return;
    }
    if (session.session?.isBashRunning) {
      post({ type: "error", text: "Ya hay un comando bash en ejecución. Cancela primero." });
      return;
    }
    if (session.session?.isStreaming) {
      // El atajo de bash directo del usuario compite con el agent run por el
      // indicador de “busy”; pídele que espere (como hace pi con el bash).
      post({ type: "error", text: "Espera a que Frida termine de procesar para ejecutar bash directo (!)." });
      return;
    }
    post({ type: "user", text: raw });
    post({ type: "bash_start", command, excludeFromContext: exclude });
    try {
      const result: any = await session.session.executeBash(
        command,
        (chunk: string) => post({ type: "bash_chunk", text: chunk }),
        { excludeFromContext: exclude }
      );
      post({
        type: "bash_end",
        exitCode: result?.exitCode,
        cancelled: !!result?.cancelled,
        truncated: !!result?.truncated,
        fullOutputPath: result?.fullOutputPath,
      });
    } catch (e: any) {
      post({ type: "bash_end", exitCode: undefined, cancelled: false });
      post({ type: "error", text: String(e?.message ?? e) });
    }
    // El comando pudo cambiar el branch/estado de git (p. ej. !git checkout).
    void postWorkspace();
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
      if (session.session?.isBashRunning) {
        await session.session.abortBash?.();
        return;
      }
      await session.session.abort();
    } catch {
      /* noop */
    }
  }

  // Recarga en caliente de extensiones, skills, prompts, themes, archivos de
  // contexto y settings (equivalente al /reload de la TUI de pi). No pierde el
  // historial ni la sesión; re-ejecuta las factories (gates, provider hooks,
  // ask_user_question) y reescanea el descubrimiento abierto (ADR-0005).
  async function reloadResources(): Promise<void> {
    let sess: FridaSession;
    try {
      sess = await ensureSession();
    } catch (e: any) {
      post({ type: "info", text: "Error al recargar: " + String(e?.message ?? e) });
      return;
    }
    const session = sess.session;
    if (session?.isStreaming) {
      post({ type: "info", text: "Espera a que termine la respuesta actual antes de recargar." });
      return;
    }
    if (session?.isCompacting) {
      post({ type: "info", text: "Espera a que termine la compactación antes de recargar." });
      return;
    }
    post({ type: "info", text: "Recargando extensiones, skills, prompts, themes y contexto…" });
    try {
      await session.reload();
      sendModelInfo(); // por si settings cambió el thinking level
      // ⚠ Verificar en runtime: la key inyectada (setRuntimeApiKey) vive en el
      // ModelRuntime, que el reload no toca; debería persistir. Si llegara a
      // fallar la autenticación tras un reload, reinyectar con sess.setKey(keyCache).
      const rl: any = session?.resourceLoader;
      const extCount = rl?.getExtensions?.()?.extensions?.length;
      const skillCount = rl?.getSkills?.()?.skills?.length;
      const counts =
        extCount !== undefined || skillCount !== undefined
          ? ` · ${extCount ?? 0} extensiones, ${skillCount ?? 0} skills`
          : "";
      post({ type: "info", text: "Recarga completada" + counts });
      postResources();
    } catch (e: any) {
      post({ type: "info", text: "Error al recargar: " + String(e?.message ?? e) });
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
    resetQueue();
    post({ type: "info", text: "Nueva sesión iniciada." });
    if (keyCache) bootstrapSession(); // recrea la sesión para mostrar recursos
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
    resetQueue();
    try {
      frida = await createFridaSession({
        cwd: workspaceCwd(),
        agentDir: defaultAgentDir(),
        sessionDir: sessionDirPath,
        openPath: pathStr,
        getKey: () => keyCache,
        onUnauthorized: () => { keyCache = undefined; void promptKey(true); },
        onPendingApprovals: (reqs: ApprovalRequest[]) => post({ type: "approvals", approvals: reqs }),
        onPendingQuestions: (reqs) => post({ type: "questions", items: reqs }),
        getMode: () => approvalMode,
      });
      wireSession(frida.session);
      postHistory();
      sendModelInfo();
      postResources();
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

  // Elimina una sesión borrando su archivo JSONL. SessionManager no expone
  // delete, pero no hace falta: listAll lee los archivos del disco cada vez.
  // La sesión activa se bloquea para no romper el agente en curso.
  async function deleteSession(pathStr: string): Promise<void> {
    if (!pathStr) return;
    if (frida && frida.session?.sessionFile === pathStr) {
      post({ type: "info", text: "No puedes eliminar la sesión activa." });
      return;
    }
    try {
      await fs.unlink(pathStr);
      post({ type: "info", text: "Sesión eliminada." });
      await sendSessions();
    } catch (e: any) {
      post({ type: "info", text: "Error al eliminar: " + String(e?.message ?? e) });
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
    if (frida) {
      await frida.setKey(trimmed); // inyecta la key al runtime (setRuntimeApiKey)
      postResources();
    } else {
      bootstrapSession(); // crea sesión y publica recursos al terminar el onboarding
    }
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
    vscode.commands.registerCommand("frida.reload", () => void reloadResources()),
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

// Compacta los args de un tool a un objeto legible, truncando strings largos
// (content/oldText/newText…) para no inflar el postMessage. El webview usa
// solo los campos clave (path, command, pattern, edits.length) para la cabecera.
function compactArgs(args: unknown): unknown {
  if (args == null || typeof args !== "object") return args;
  try {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (typeof v === "string") {
        out[k] = v.length > 120 ? v.slice(0, 120) + "…" : v;
      } else if (Array.isArray(v)) {
        out[k] = v.map((item) => (item && typeof item === "object" ? compactArgs(item) : item));
      } else if (v && typeof v === "object") {
        out[k] = compactArgs(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return args;
  }
}

// Extrae el texto del resultado de un tool (result.content = bloques text/image)
// y lo trunca para mostrarlo en el cuerpo plegable de la tarjeta.
function summarizeResult(result: any): string {
  if (!result) return "";
  try {
    const content = result.content;
    if (Array.isArray(content)) {
      const text = content
        .filter((b: any) => b?.type === "text")
        .map((b: any) => String(b?.text ?? ""))
        .join("");
      if (!text) return "";
      return text.length > 2000 ? text.slice(0, 2000) + "\n…(truncado)" : text;
    }
    if (typeof result === "string") return result.slice(0, 2000);
    if (typeof result.details === "string") return result.details.slice(0, 2000);
    return "";
  } catch {
    return "";
  }
}

export function deactivate(): void {
  /* sin cleanup especial por ahora */
}
