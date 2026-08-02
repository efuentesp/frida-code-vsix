// Puente entre el gate `tool_call` (corre en-proceso dentro de Pi) y el webview.
// El handler del gate llama request() y queda en await; el webview responde vía
// resolve() cuando el usuario hace clic en Aceptar/Rechazar.
//
// La lógica compartida (Map de pendientes + race con el AbortSignal del turn +
// emisión de cambios) vive en DialogBridge<T> (ADR-0006, "Patrón
// reutilizable"). Aquí solo queda la forma específica de "abortado": reject
// (la acción no procede). Mismo race+limpieza que WebBridge.

import { DialogBridge } from "./dialog-bridge";

export interface ApprovalRequest {
	id: string;
	toolName: string;
	// "diff" = edit/write; "bash" = shell; "tool" = MCP/extension de terceros
	// (desconocido) que pedimos aprobar explícitamente.
	kind: "diff" | "bash" | "tool";
	path?: string;
	command?: string;
	diff?: string;
	// Aviso disuasivo (Prioridad 3): comando compuesto/wrapper o path fuera del
	// workspace. La UI lo destaca para que el usuario preste atención.
	warning?: string;
	/** Patrón sugerido para aprobar por sesión (Fase 4): el gate lo calcula
	 *  (bash → `npm *`, diff → `src/*`) y la UI lo ofrece como botón. */
	suggestedPattern?: string;
}

export interface ApprovalResponse {
	id: string;
	decision: "accept" | "reject";
	acceptAll?: boolean;
	/** Patrón a aprobar para la sesión (Fase 4): el gate lo registra y las próximas
	 *  llamadas que matcheen pasan sin diálogo. Ej. `npm *`, `src/*`. */
	pattern?: string;
	/** Motivo del rechazo (opcional, opción "No, indicar motivo"): se inyecta en
	 *  el tool_result que ve el modelo para que entienda por qué se bloqueó. */
	reason?: string;
}

export class ApprovalBridge extends DialogBridge<
	ApprovalRequest,
	ApprovalResponse
> {
	constructor(onChange: (reqs: ApprovalRequest[]) => void) {
		super(onChange);
	}

	protected cancelledResponse(id: string): ApprovalResponse {
		return { id, decision: "reject" };
	}
}
