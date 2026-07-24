import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ApprovalBridge, ApprovalRequest } from "../approval-bridge";

export type ApprovalMode = "manual" | "auto-edit" | "auto";

const FREE_TOOLS = new Set(["read", "grep", "find", "ls"]);
const DIFF_TOOLS = new Set(["edit", "write"]);

/**
 * Gates de aprobación (D7). Van como extensión de Pi porque SOLO el handler del
 * evento `tool_call` puede BLOQUEAR la ejecución ({block:true}); session.subscribe
 * es observador pasivo y no frena el tool.
 *
 * Política: libres = read/grep/find/ls; diff = edit+write (toggle per-session
 * compartido); siempre gateado y SIN toggle = bash.
 */
export function createApprovalGates(bridge: ApprovalBridge, getMode: () => ApprovalMode) {
  let acceptAllEdits = false; // per-session; solo edit/write; bash NUNCA

  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event: any, ctx: any) => {
      const mode = getMode();
      if (mode === "auto") return; // auto: todo pasa sin preguntar
      const tool: string = event.toolName;

      if (FREE_TOOLS.has(tool)) return; // libre
      const isDiff = DIFF_TOOLS.has(tool);
      const isBash = tool === "bash";
      if (!isDiff && !isBash) return; // tool desconocido: dejamos pasar (PoC)

      // auto-edit: crear/editar archivos pasan; bash sigue pidiendo aprobación
      if (isDiff && mode === "auto-edit") return;
      // manual: toggle per-session sigue aplicando a edit/write
      if (isDiff && acceptAllEdits) return;

      const req: ApprovalRequest = {
        id: event.toolCallId,
        toolName: tool,
        kind: isBash ? "bash" : "diff",
        path: event.input?.path,
        command: isBash ? event.input?.command : undefined,
        diff: isDiff ? renderDiff(event.input) : undefined,
      };

      const resp = await bridge.request(req, ctx?.signal);
      if (resp.decision === "reject") {
        return { block: true, reason: "El usuario rechazó la acción." };
      }
      if (isDiff && resp.acceptAll) acceptAllEdits = true; // recordar para esta sesión
      // accept → dejar ejecutar (no retornar nada)
    });
  };
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
