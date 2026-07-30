import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ReactElement } from "react";
import { Type } from "typebox";
import {
	createWebQuestionnaireElement,
	type WebQuestionAnswer,
	type WebQuestionSpec,
} from "../web-questionnaire";
import {
	MAX_HEADER_LENGTH,
	MAX_LABEL_LENGTH,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
} from "./types";

// Extensión ask_user_question construida sobre Remote React (opción A, ADR-0012).
// Reemplaza al ask-user-question empotrado (QuestionBridge/QuestionCard) y a la
// versión RPC de rpiv: en vez de diálogos secuenciales o una QuestionCard propia,
// monta un WebQuestionnaire con React+estado en el host, serializado al webview.
//
// El execute valida params, llama ctx.ui.fridaWeb(factory) —que monta el componente
// y devuelve el resultado al cerrar— y envuelve todo en el envelope del tool
// (content legible + details {answers, cancelled}).

const optionSchema = Type.Object({
	label: Type.String({ maxLength: MAX_LABEL_LENGTH }),
	description: Type.String(),
	preview: Type.Optional(
		Type.String({
			description:
				"Contenido markdown opcional mostrado al enfocar esta opción. Úsalo SOLO para artefactos concretos que el usuario deba comparar visualmente (mockups ASCII, snippets de código, diagramas, ejemplos de configuración). NO lo uses para preguntas simples de preferencia donde label + description bastan — sólo sobrecargan la pantalla. Sólo aplica en single-select (se ignora en multiSelect).",
		}),
	),
});

const questionSchema = Type.Object({
	question: Type.String(),
	header: Type.String({ maxLength: MAX_HEADER_LENGTH }),
	multiSelect: Type.Optional(Type.Boolean()),
	options: Type.Array(optionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
	}),
});

const askSchema = Type.Object({
	questions: Type.Array(questionSchema, {
		minItems: 1,
		maxItems: MAX_QUESTIONS,
	}),
});

/** Slice del ExtensionUIContext de Frida que expone fridaWeb (no está en el SDK). */
type FridaWebUI = {
	fridaWeb: <T = void>(
		factory: (done: (result: T) => void) => ReactElement,
		placement?: import("../web-protocol").WebPlacement,
	) => Promise<T>;
};

type WebQuestionnaireResult = {
	answers: WebQuestionAnswer[];
	cancelled: boolean;
};

type ToolResult = {
	content: { type: "text"; text: string }[];
	details: WebQuestionnaireResult & { error?: string };
};

function ok(text: string, result: WebQuestionnaireResult): ToolResult {
	return { content: [{ type: "text", text }], details: { ...result } };
}
function declined(): ToolResult {
	return {
		content: [
			{ type: "text", text: "El usuario declinó responder las preguntas." },
		],
		details: { answers: [], cancelled: true },
	};
}
function invalid(error: string, message: string): ToolResult {
	return {
		content: [
			{ type: "text", text: `Pregunta inválida (${error}): ${message}` },
		],
		details: { answers: [], cancelled: true, error },
	};
}

/** Construye el texto que ve el modelo a partir de las respuestas. */
function summarize(
	typed: { questions: WebQuestionSpec[] },
	result: WebQuestionnaireResult,
): string {
	if (result.cancelled || result.answers.length === 0) {
		return "El usuario declinó responder las preguntas.";
	}
	const lines = result.answers.map((a) => {
		const q = typed.questions[a.questionIndex]?.question ?? "";
		const value =
			a.kind === "multi"
				? (a.selected ?? []).join(", ")
				: a.kind === "custom"
					? `«${a.answer ?? ""}»`
					: (a.answer ?? "");
		return `- «${q}» → ${value}`;
	});
	return `El usuario respondió tus preguntas:\n${lines.join("\n")}`;
}

/**
 * Factory de la extensión. Registra el tool ask_user_question; al ejecutarse monta
 * el WebQuestionnaire (React) en el host vía fridaWeb y devuelve el envelope.
 */
export function createAskUserQuestionWeb() {
	return (pi: ExtensionAPI) => {
		pi.registerTool({
			name: "ask_user_question",
			label: "Preguntar al usuario",
			description:
				"Pregunta al usuario hasta 4 preguntas con opciones concretas, en vez de adivinar. " +
				"Cada pregunta lleva 2-4 opciones con su descripción; el usuario siempre puede escribir " +
				"su propia respuesta en el campo de texto libre. Úsalo cuando una decisión tenga opciones " +
				"reales; no para confirmar pasos obvios. No apiles varias llamadas: agrupa todas las " +
				"preguntas en una. VE DIRECTO AL TOOL: no redactes las preguntas en tu texto antes. " +
				"Vista previa (preview): usa el campo opcional `preview` de las opciones SOLO para " +
				"artefactos concretos que el usuario deba comparar visualmente (mockups ASCII, código, " +
				"diagramas, ejemplos de configuración). NO uses previews para preguntas simples de " +
				"preferencia donde el label y la descripción bastan — sólo sobrecargan y distraen. " +
				"Los previews sólo aplican en single-select (se ignoran en multiSelect).",
			promptSnippet: "Pregunta al usuario hasta 4 cosas con opciones concretas",
			promptGuidelines: [
				"PROACTIVO con `ask_user_question`: si una petición es ambigua o una decisión tiene 2+ opciones concretas (enfoque, librería, alcance, nombres, trade-off), LLAMA AL TOOL en vez de preguntar en texto plano. Plantea la pregunta como opciones clicables — NUNCA como prosa de opción múltiple en tu respuesta.",
				"Pregunta ANTES de construir, no después. Si de otro modo adivinarías un requisito, pregunta primero. Agrupa preguntas relacionadas en una sola llamada (máx 4). Pero NO lo uses para pasos triviales/obvios ni confirmaciones sin valor — sólo cuando la respuesta cambia genuinamente tu enfoque.",
				"`multiSelect: true` cuando la pregunta admita VARIAS respuestas a la vez (¿cuáles quieres incluir?, ¿qué archivos tocar?, selecciona todo lo que aplique). `multiSelect` ausente/false = elección única mutuamente excluyente. NO fuerces multiSelect si las opciones son alternativas entre sí (ej. '¿qué librería usar?' → una sola). Mezcla en el mismo cuestionario preguntas single y multi según corresponda.",
			],
			parameters: askSchema,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const typed = params as { questions: WebQuestionSpec[] };
				const raw = typed?.questions ?? [];
				if (raw.length === 0) return invalid("no_questions", "Sin preguntas.");

				// Validación mínima de formato (TypeBox ya cubrió conteos/longitudes).
				for (const q of raw) {
					if (!q.question || !q.header || !Array.isArray(q.options)) {
						return invalid(
							"bad_shape",
							"Cada pregunta necesita question, header y options.",
						);
					}
				}

				// ctx.ui es el ExtensionUIContext de Frida, que añade fridaWeb (no tipado en el SDK).
				const ui = (ctx?.ui ?? {}) as unknown as FridaWebUI;
				if (typeof ui.fridaWeb !== "function") {
					return invalid(
						"no_frida_web",
						"El host no soporta UI React remota (fridaWeb). No es un decline: pregunta en texto plano.",
					);
				}

				const result = await ui.fridaWeb<WebQuestionnaireResult>(
					(done) =>
						createWebQuestionnaireElement(raw as WebQuestionSpec[], done),
					"composer",
				);

				if (result.cancelled) return declined();
				return ok(summarize(typed, result), result);
			},
		});
	};
}
