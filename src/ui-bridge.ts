// Puente host↔webview para los diálogos data-oriented de ExtensionUIContext
// (select/input/confirm). Es el slice que el modo RPC del SDK usa y que la
// extensión nativa rpiv-ask-user-question consume vía runRpcQuestionnaire()
// (hasDialogUI(ui) ⇒ select + input). Mismo patrón que WebBridge/
// ApprovalBridge: el execute de un tool llama request() y queda en await; el
// webview responde vía resolve() cuando el usuario elige o cancela.
//
// Reusa DialogBridge<TReq,TResp> (ADR-0006, "Patrón reutilizable"): Map de
// pendientes + race con el AbortSignal del turn + emisión de cambios al
// webview. Aquí solo queda la forma de "abortado": { cancelled: true }.

import { DialogBridge } from "./dialog-bridge";

/** Una petición de diálogo UI. `method` distingue cómo la renderiza el webview. */
export interface UiRequest {
	/** UUID por diálogo (no toolCallId: los diálogos UI no cuelgan de un tool). */
	id: string;
	method: "select" | "input" | "confirm";
	title: string;
	/** select: lista de opciones (strings, ya formateadas por la extensión). */
	options?: string[];
	/** input: placeholder. */
	placeholder?: string;
	/** confirm: cuerpo del mensaje. */
	message?: string;
}

/** Respuesta del webview a un diálogo UI. */
export interface UiResponse {
	id: string;
	/** select → label elegido · input → texto · confirm → "true"/"false". */
	value?: string;
	/** true si el usuario cerró sin elegir (Esc / cancelar). */
	cancelled: boolean;
}

/**
 * Puente de diálogos UI. request() publica la petición al webview (onChange) y
 * resuelve cuando llega resolve() o cuando el turn se aborta (signal).
 */
export class UiBridge extends DialogBridge<UiRequest, UiResponse> {
	constructor(onChange: (reqs: UiRequest[]) => void) {
		super(onChange);
	}

	protected cancelledResponse(id: string): UiResponse {
		return { id, cancelled: true };
	}
}
