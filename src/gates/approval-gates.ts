import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ApprovalBridge, ApprovalRequest } from "../approval-bridge";
import { ApprovalLogger, type ApprovalLogEntry } from "./approval-logger";
import { isSensitivePath } from "./sensitive-paths";
import { isDangerousBash } from "./dangerous-commands";
import { hasShellIndirection } from "./bash-indirection";
import { isExternalPath } from "./external-paths";
import type { GatePatterns } from "../settings";

export type ApprovalMode = "manual" | "auto-edit" | "auto";

// Libres = lectura segura + tools PROPIOS de Frida que no tocan el FS ni
// ejecutan nada peligroso. `todo` muta un holder en memoria; `ask_user_question`
// ES ya un diálogo (gatearlo sería circular). MCP/extensiones de terceros NO
// están aquí: caen en el camino "desconocido" y piden aprobación.
const FREE_TOOLS = new Set(["read", "grep", "find", "ls", "todo", "ask_user_question"]);
const DIFF_TOOLS = new Set(["edit", "write"]);
// Tools de archivo con `input.path` que pueden apuntar fuera del workspace.
const PATH_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls"]);

/**
 * Gates de aprobación (D7). Van como extensión de Pi porque SOLO el handler del
 * evento `tool_call` puede BLOQUEAR la ejecución ({block:true}); session.subscribe
 * es observador pasivo y no frena el tool.
 *
 * Política: libres = read/grep/find/ls + tools propios seguros; diff = edit+write
 * (toggle per-session compartido); siempre gateado y SIN toggle = bash;
 * desconocido (MCP/extensiones) = pide aprobación (no se cuela).
 *
 * Robustez (Prioridad 1):
 *  - FAIL-CLOSED: el handler entero va en try/catch. El SDK NO atrapa un throw
 *    del handler de tool_call (a diferencia de emitUserBash) → sin este catch,
 *    una excepción dejaría correr el tool sin gatear. Ante error, bloqueamos.
 *  - PATHS SENSIBLES: gate cross-cutting que bloquea (.env, claves, ~/.ssh, …)
 *    ANTES de la clasificación libre/diff/bash. Aplica a cualquier tool con
 *    input.path (read incluido). Disuasivo de fuga por egress (ADR-0001).
 *
 * Auditoría + deny explícito (Prioridad 2):
 *  - LOGGER: cada decisión terminal se registra en JSONL (chmod 0600) para
 *    cerrar el pilar de auditoría de Frida. No-throw.
 *  - COMANDOS PELIGROSOS: patrones destructivos irreversibles (rm -rf /, mkfs,
 *    fork bomb, dd a dispositivo…) se bloquean SIN preguntar (deny por policy).
 *
 * Disuasivo de bash/paths (Prioridad 3):
 *  - FORCE-ASK: un bash compuesto/wrapper (&&/;/sudo/bash -c…) o un path FUERA
 *    del workspace fuerza `ask` incluso en modo auto/auto-edit. Traducción del
 *    "flooding" de gotgenes: un allow nunca cubre algo que esconda sub-comandos.
 *    Aviso visible en la UI (campo `warning`) + flag en el log de auditoría.
 */
export function createApprovalGates(
  bridge: ApprovalBridge,
  getMode: () => ApprovalMode,
  logger: ApprovalLogger,
  getCwd: () => string,
  getPatterns: () => GatePatterns,
) {
  let acceptAllEdits = false; // per-session; solo edit/write; bash NUNCA

  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event: any, ctx: any) => {
      const sessionId = bestEffortSessionId(ctx);
      // kind se computa una vez y de forma segura (nothrow) para que esté
      // disponible tanto en evaluate como en el catch del fail-closed.
      const kind = safeKind(event);
      try {
        return await evaluate(event, ctx?.signal, sessionId, kind);
      } catch (error) {
        // Fail-closed: cualquier error (renderDiff, bridge caído, input raro)
        // bloquea en vez de dejar correr el tool sin gatear.
        const detail = error instanceof Error ? error.message : String(error);
        const reason = `El gate de aprobación falló y se bloqueó la acción (fail-closed): ${detail}`;
        logger.log(makeEntry(event, sessionId, "block", "gate_error", { kind, reason }));
        return { block: true as const, reason };
      }
    });
  };

  // Lógica separada del catch para que el try/catch cubra TODO (incluido el
  // armado del ApprovalRequest y el await del bridge).
  async function evaluate(
    event: any,
    signal: AbortSignal | undefined,
    sessionId: string | undefined,
    kind: ApprovalRequest["kind"],
  ) {
    const mode = getMode();
    const tool: string = event.toolName;
    const patterns = getPatterns();

    // 1) Deny por POLICY (absoluto, incluso en modo auto — auto solo anula los
    //    `ask`, no los `deny`, igual que el yoloMode de gotgenes).
    // 1a) Gate cross-cutting de paths sensibles: ni siquiera los tools libres
    //     (read) pasan si tocan un secreto. Disuasivo de fuga por egress (ADR-0001).
    const pathCheck = isSensitivePath(event.input?.path, {
      extraExtensions: patterns.sensitiveExtensions,
      extraBasenames: patterns.sensitiveBasenames,
      extraAllow: patterns.sensitiveAllowBasenames,
    });
    if (pathCheck.denied) {
      logger.log(
        makeEntry(event, sessionId, "block", "sensitive_path", {
          kind,
          reason: pathCheck.reason,
        }),
      );
      return { block: true as const, reason: pathCheck.reason };
    }
    // 1b) Comandos bash destructivos (rm -rf /, mkfs, fork bomb…): bloqueo sin preguntar.
    if (tool === "bash") {
      const cmdCheck = isDangerousBash(event.input?.command, {
        extraSubstrings: patterns.dangerousCommandSubstrings,
      });
      if (cmdCheck.denied) {
        logger.log(
          makeEntry(event, sessionId, "block", "dangerous_command", {
            kind,
            reason: cmdCheck.reason,
            pattern: cmdCheck.pattern,
          }),
        );
        return { block: true as const, reason: cmdCheck.reason };
      }
    }

    // 2) FORCE-ASK (Prioridad 3): un bash compuesto/wrapper o un path FUERA del
    //    workspace fuerza `ask` incluso en auto. Es disuasivo: en auto el usuario
    //    no mira, y un sub-comando peligroso podría colarse amparado por uno
    //    benigno, o el agente podría salir de la zona de trabajo sin avisar.
    const isBash = tool === "bash";
    const flags: string[] = [];
    let warning: string | undefined;
    if (isBash) {
      const indir = hasShellIndirection(event.input?.command);
      if (indir.detected) {
        flags.push("compound_command");
        warning = indir.reason;
      }
    }
    if (PATH_TOOLS.has(tool)) {
      const ext = isExternalPath(event.input?.path, getCwd());
      if (ext.external) {
        flags.push("external_path");
        warning =
          "Ruta fuera del workspace" +
          (ext.absPath ? ` (${ext.absPath})` : "") +
          ". Revisa que sea intencional antes de aceptar.";
      }
    }
    const forceAsk = flags.length > 0;

    // 3) Tools libres: pasan (paths peligrosos ya descartados arriba). Pero un
    //    path externo lo floora (read externo → pide). No se loguean salvo que
    //    haya force-ask (entonces caen al diálogo y se loguean abajo).
    if (FREE_TOOLS.has(tool) && !forceAsk) return;

    const isDiff = DIFF_TOOLS.has(tool);
    // Cae aquí (no libre, no diff, no bash) → MCP / extensión de terceros:
    // pedimos aprobación con kind "tool" en vez de colarse.

    // 4) Modo auto: bypass SOLO si no hay force-ask. force-ask cae al diálogo.
    if (mode === "auto" && !forceAsk) {
      logger.log(makeEntry(event, sessionId, "allow", "mode", { kind }));
      return;
    }

    // auto-edit: crear/editar archivos pasan; bash/desconocidos y (con
    // force-ask) los externos siguen pidiendo aprobación.
    if (isDiff && mode === "auto-edit" && !forceAsk) {
      logger.log(makeEntry(event, sessionId, "allow", "mode", { kind }));
      return;
    }
    // manual: toggle per-session sigue aplicando solo a edit/write (no a externos).
    if (isDiff && acceptAllEdits && !forceAsk) {
      logger.log(makeEntry(event, sessionId, "allow", "mode", { kind }));
      return;
    }

    const req: ApprovalRequest = {
      id: event.toolCallId,
      toolName: tool,
      kind,
      path: event.input?.path,
      command: isBash ? event.input?.command : undefined,
      diff: isDiff ? renderDiff(event.input) : undefined,
      warning,
    };

    const resp = await bridge.request(req, signal);
    if (resp.decision === "reject") {
      logger.log(
        makeEntry(event, sessionId, "block", "user_rejected", { kind, flags }),
      );
      return { block: true as const, reason: "El usuario rechazó la acción." };
    }
    if (isDiff && resp.acceptAll) acceptAllEdits = true; // recordar para esta sesión
    logger.log(makeEntry(event, sessionId, "allow", "user_approved", { kind, flags }));
    // accept → dejar ejecutar (no retornar nada)
  }
}

/** Clasifica el tool en la "vista" que ve el usuario y el log. */
function deriveKind(tool: string): ApprovalRequest["kind"] {
  if (DIFF_TOOLS.has(tool)) return "diff";
  if (tool === "bash") return "bash";
  return "tool";
}

/** Igual que deriveKind pero no lanza: para el catch del fail-closed. */
function safeKind(event: any): ApprovalRequest["kind"] {
  try {
    return deriveKind(String(event?.toolName ?? ""));
  } catch {
    return "tool";
  }
}

/** Construye una entrada de log a partir del evento + campos variables. */
function makeEntry(
  event: any,
  sessionId: string | undefined,
  decision: "allow" | "block",
  source: ApprovalLogEntry["source"],
  opts: { kind: ApprovalRequest["kind"]; reason?: string; pattern?: string; flags?: string[] },
): ApprovalLogEntry {
  return {
    ts: new Date().toISOString(),
    sessionId,
    tool: String(event?.toolName ?? "<unknown>"),
    kind: opts.kind,
    decision,
    source,
    path: typeof event?.input?.path === "string" ? event.input.path : undefined,
    command:
      typeof event?.input?.command === "string" ? event.input.command : undefined,
    reason: opts.reason,
    pattern: opts.pattern,
    flags: opts.flags,
  };
}

/** Id de sesión best-effort; el shape de ctx no es estable, leemos defensivamente. */
function bestEffortSessionId(ctx: any): string | undefined {
  const id = ctx?.session?.id ?? ctx?.sessionId ?? ctx?.sessionFile;
  return typeof id === "string" ? id : undefined;
}

function renderDiff(input: any): string {
  if (!input) return "(sin input)";
  if (Array.isArray(input.edits)) {
    return input.edits
      .map((e: any, i: number) =>
        [
          `--- edit #${i + 1}${input.path ? `  (${input.path})` : ""}`,
          "- " + indent(String(e.oldText ?? ""), "- "),
          "+ " + indent(String(e.newText ?? ""), "+ "),
        ].join("\n")
      )
      .join("\n\n");
  }
  if (typeof input.content === "string") {
    return `write ${input.path ?? ""}:\n+ ` + indent(input.content, "+ ").slice(0, 2000);
  }
  return JSON.stringify(input, null, 2).slice(0, 2000);
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .slice(0, 40)
    .map((l) => prefix + l)
    .join("\n");
}
