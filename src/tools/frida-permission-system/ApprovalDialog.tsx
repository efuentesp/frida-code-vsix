// ApprovalDialog — diálogo de aprobación en Remote React (ADR-0016, Fase 6).
//
// Reemplaza a la ApprovalCard nativa del webview (webview/components/ApprovalCard.tsx)
// por un componente del catálogo frida-webview (fbox/ftext/fbutton), unificando la
// estética con AuditPanel/ConfigPanel/ContextReport. Se monta como root overlay
// efímero desde el host (extension.ts:syncApprovalDialogs) cuando hay approvals
// pendientes; onRespond es una closure del host que llama bridge.resolve.
//
// Contrato preservado: onRespond dispara fireEvent(handlerId) → el host ejecuta la
// closure (bridge.resolve) → el gate desbloquea el tool. Igual que la ApprovalCard
// nativa, pero sin el conducto approval_response del webview.

import type { ReactElement } from "react";
import type { ApprovalRequest } from "../../approval-bridge";

// Tools propios de frida-lens (pi-lens): de lectura/análisis, no mutan archivos.
const FRIDA_LENS_TOOLS = new Set([
	"project_report",
	"module_report",
	"symbol_search",
	"read_symbol",
	"read_enclosing",
	"lsp_diagnostics",
	"lens_diagnostics",
	"pi_lens_activate_tools",
]);

export type ApprovalRespond = {
	decision: "accept" | "reject";
	acceptAll?: boolean;
	pattern?: string;
};

export function createApprovalDialogElement(
	req: ApprovalRequest,
	onRespond: (r: ApprovalRespond) => void,
): ReactElement {
	return <ApprovalDialog req={req} onRespond={onRespond} />;
}

function ApprovalDialog({
	req,
	onRespond,
}: {
	req: ApprovalRequest;
	onRespond: (r: ApprovalRespond) => void;
}): ReactElement {
	const isBash = req.kind === "bash";
	const isDiff = req.kind === "diff";
	const isTool = req.kind === "tool";
	const label = isBash
		? "Ejecución de comando"
		: isTool
			? `Herramienta — ${req.toolName}`
			: "Edición de archivo" + (req.path ? ` — ${req.path}` : "");

	return (
		<fbox flexDirection="column" gap={8} padding={12} bordered>
			{/* Título */}
			<ftext bold>{label}</ftext>

			{/* Comando (bash) */}
			{req.command ? <ftext wrap={true}>{req.command}</ftext> : null}

			{/* Diff (edit/write) */}
			{req.diff ? <ftext wrap={true}>{req.diff}</ftext> : null}

			{/* Aviso disuasivo (force-ask) */}
			{req.warning ? (
				<ftext color="var(--vscode-editorWarning-foreground)" wrap={true}>
					⚠ {req.warning}
				</ftext>
			) : null}

			{/* Hint para tools desconocidos */}
			{isTool ? (
				<ftext color="var(--vscode-descriptionForeground)" wrap={true}>
					{FRIDA_LENS_TOOLS.has(req.toolName)
						? "Herramienta de frida-lens (sólo lectura/análisis; no modifica archivos). Revisa la acción antes de aceptar."
						: "Herramienta no reconocida (MCP o extensión de terceros). Revisa la acción antes de aceptar."}
				</ftext>
			) : null}

			{/* Acciones */}
			<fbox flexDirection="row" gap={8} justifyContent="flex-end">
				<fbutton
					variant="primary"
					onClick={() => onRespond({ decision: "accept" })}
				>
					Aceptar
				</fbutton>
				<fbutton
					variant="secondary"
					onClick={() => onRespond({ decision: "reject" })}
				>
					Rechazar
				</fbutton>
				{/* Aprobar un patrón para la sesión (Fase 4). */}
				{req.suggestedPattern ? (
					<fbutton
						variant="secondary"
						onClick={() =>
							onRespond({
								decision: "accept",
								pattern: req.suggestedPattern,
							})
						}
					>
						Aprobar «{req.suggestedPattern}» (esta sesión)
					</fbutton>
				) : null}
				{/* "Aceptar todas" sólo para diffs: bash siempre pide, y un tool
				    desconocido no debe silenciarse para toda la sesión. */}
				{isDiff ? (
					<fbutton
						variant="secondary"
						onClick={() => onRespond({ decision: "accept", acceptAll: true })}
					>
						Aceptar todas (esta sesión)
					</fbutton>
				) : null}
			</fbox>
		</fbox>
	);
}
