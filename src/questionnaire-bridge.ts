// Puente host↔webview para el cuestionario de ask_user_question (ADR-0027).
//
// ask_user_question dejó de usar Remote React (fridaWeb, ADR-0012) y ahora es un
// componente NATIVO del webview (QuestionsPanel), igual que los permisos
// (ApprovalCard/ApprovalBridge). Esto permite selección por teclado (parity con
// permisos): el webview tiene `window` real para keydown, cosa imposible con el
// árbol serializado del host.
//
// Mismo patrón que ApprovalBridge/UiBridge (DialogBridge, ADR-0006): request()
// publica la petición y queda en await; el webview responde vía resolve() cuando
// el usuario envía o cancela. Remote React se mantiene para los widgets footer
// persistentes (subagents/workflow/git-sync/todo).

import { DialogBridge } from "./dialog-bridge";

/** Una opción de pregunta (espeja webview/types.ts y el schema del tool). */
export interface WebQuestionOption {
	label: string;
	description: string;
	/** Markdown opcional (single-select): se muestra al enfocar la opción. */
	preview?: string;
}

/** Una pregunta del cuestionario. */
export interface WebQuestionSpec {
	question: string;
	header: string;
	multiSelect?: boolean;
	options: WebQuestionOption[];
}

/** Respuesta a una pregunta (kind distingue opción elegida / texto libre / multi). */
export interface WebQuestionAnswer {
	questionIndex: number;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	/** multiSelect → labels seleccionados. */
	selected?: string[];
}

/** Resultado completo del cuestionario. */
export interface WebQuestionnaireResult {
	answers: WebQuestionAnswer[];
	cancelled: boolean;
}

/** Petición: el host pide al webview que muestre un cuestionario. */
export interface QuestionnaireRequest {
	id: string;
	questions: WebQuestionSpec[];
}

/** Respuesta: el webview entrega el resultado al cerrar (enviar o cancelar). */
export interface QuestionnaireResponse {
	id: string;
	cancelled: boolean;
	answers: WebQuestionAnswer[];
}

/**
 * Puente del cuestionario. request() publica la petición al webview (onChange) y
 * resuelve cuando llega resolve() o cuando el turn se aborta (signal) → decline.
 */
export class QuestionnaireBridge extends DialogBridge<
	QuestionnaireRequest,
	QuestionnaireResponse
> {
	constructor(onChange: (reqs: QuestionnaireRequest[]) => void) {
		super(onChange);
	}

	protected cancelledResponse(id: string): QuestionnaireResponse {
		return { id, cancelled: true, answers: [] };
	}
}
