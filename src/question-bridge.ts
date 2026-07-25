// Puente entre el tool `ask_user_question` (corre en-proceso dentro de Pi) y el
// webview. El `execute` del tool llama request() y queda en await; el webview
// responde vía resolve() cuando el usuario envía o cancela.
//
// La lógica compartida (Map de pendientes + race con el AbortSignal del turn +
// emisión de cambios al webview) vive en DialogBridge<T> (ADR-0006,
// "Patrón reutilizable"). Aquí solo queda la forma específica de "abortado":
// cancelled.

import { DialogBridge } from "./dialog-bridge";

export interface QuestionOption {
	label: string;
	description: string;
	preview?: string;
}

export interface QuestionSpec {
	question: string;
	header: string;
	multiSelect?: boolean;
	options: QuestionOption[];
}

/** Una respuesta del usuario a una pregunta. */
export interface QuestionAnswer {
	questionIndex: number;
	/** option = eligió una opción · custom = escribió su propia respuesta · multi = varias. */
	kind: "option" | "custom" | "multi";
	/** Label elegido (option) o texto libre (custom); null para multi. */
	answer: string | null;
	/** Labels elegidos, solo en multi. */
	selected?: string[];
	/** Nota opcional del usuario. */
	notes?: string;
}

export interface QuestionRequest {
	/** Igual al toolCallId de Pi (igual que los approvals). */
	id: string;
	questions: QuestionSpec[];
}

export interface QuestionResponse {
	id: string;
	answers: QuestionAnswer[];
	cancelled: boolean;
}

export class QuestionBridge extends DialogBridge<QuestionRequest, QuestionResponse> {
	constructor(onChange: (reqs: QuestionRequest[]) => void) {
		super(onChange);
	}

	protected cancelledResponse(id: string): QuestionResponse {
		return { id, answers: [], cancelled: true };
	}
}
