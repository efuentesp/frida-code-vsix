// Puente entre el gate `tool_call` (corre en-proceso dentro de Pi) y el webview.
// El handler del gate llama request() y queda en await; el webview responde vía
// resolve() cuando el usuario hace clic en Aceptar/Rechazar.
//
// La lógica compartida (Map de pendientes + race con el AbortSignal del turn +
// emisión de cambios) vive en DialogBridge<T> (ADR-0006, "Patrón
// reutilizable"). Aquí solo queda la forma específica de "abortado": reject
// (la acción no procede). Mismo race+limpieza que QuestionBridge.

import { DialogBridge } from "./dialog-bridge";

export interface ApprovalRequest {
	id: string;
	toolName: string;
	kind: "diff" | "bash";
	path?: string;
	command?: string;
	diff?: string;
}

export interface ApprovalResponse {
	id: string;
	decision: "accept" | "reject";
	acceptAll?: boolean;
}

export class ApprovalBridge extends DialogBridge<ApprovalRequest, ApprovalResponse> {
	constructor(onChange: (reqs: ApprovalRequest[]) => void) {
		super(onChange);
	}

	protected cancelledResponse(id: string): ApprovalResponse {
		return { id, decision: "reject" };
	}
}
