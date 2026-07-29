import type { ApprovalRequest } from "../types";
import { Icon } from "./Icon";
import { Diff } from "./Diff";

// Tools propios de frida-lens (pi-lens): de lectura/análisis, no mutan archivos.
// Se muestran con un mensaje distinto al de un MCP/extensión desconocida real.
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

export function ApprovalCard({
	approval,
	onRespond,
}: {
	approval: ApprovalRequest;
	onRespond: (r: {
		decision: "accept" | "reject";
		acceptAll?: boolean;
	}) => void;
}) {
	const isBash = approval.kind === "bash";
	const isDiff = approval.kind === "diff";
	const isTool = approval.kind === "tool";
	const icon = isBash ? "term" : isTool ? "wrench" : "edit";
	const label = isBash
		? "Ejecución de comando"
		: isTool
			? `Herramienta — ${approval.toolName}`
			: "Edición de archivo" + (approval.path ? " — " + approval.path : "");
	return (
		<div className="approval">
			<div className="ttl">
				<span className="ic">
					<Icon name={icon} />
				</span>
				<span>{label}</span>
			</div>
			{approval.command && <pre className="cmd">{approval.command}</pre>}
			{approval.diff && <Diff text={approval.diff} />}
			{approval.warning && (
				<p className="warning">
					<span className="ic">⚠</span> {approval.warning}
				</p>
			)}
			{isTool && (
				<p className="hint">
					{FRIDA_LENS_TOOLS.has(approval.toolName)
						? "Herramienta de frida-lens (sólo lectura/análisis; no modifica archivos). Revisa la acción antes de aceptar."
						: "Herramienta no reconocida (MCP o extensión de terceros). Revisa la acción antes de aceptar."}
				</p>
			)}
			<div className="acts">
				<button onClick={() => onRespond({ decision: "accept" })}>
					Aceptar
				</button>
				<button
					className="sec"
					onClick={() => onRespond({ decision: "reject" })}
				>
					Rechazar
				</button>
				{/* "Aceptar todas" solo para diffs: bash siempre pide, y un tool
            desconocido no debe silenciarse para toda la sesión. */}
				{isDiff && (
					<button
						className="sec"
						onClick={() => onRespond({ decision: "accept", acceptAll: true })}
					>
						Aceptar todas (esta sesión)
					</button>
				)}
			</div>
		</div>
	);
}
