import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { QuestionBridge, type QuestionAnswer, type QuestionSpec } from "../question-bridge";
import {
	MAX_HEADER_LENGTH,
	MAX_LABEL_LENGTH,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	type QuestionnaireError,
} from "./types";
import { validateQuestionnaire } from "./validate";

// Extensión de Pi que registra el tool `ask_user_question` (ADR-0006). El modelo lo
// llama para preguntar al usuario con opciones concretas en vez de adivinar. El
// `execute` enruta la pregunta al webview por QuestionBridge (mismo patrón que los
// gates de aprobación) y queda en await hasta que el usuario responde o aborta.
//
// El schema deriva sus límites y descripciones de las constantes de `./types`
// (fuente única de verdad); la validación runtime pura vive en `./validate`.
// El envelope hace eco del preview markdown de la opción elegida: aunque la
// QuestionCard del MVP no renderiza previews, el HOST sí los conoce aquí en
// `params.questions`, así que los resolvemos al construir el mensaje (paridad
// con rpiv, sin tocar el webview).

const optionSchema = Type.Object({
	label: Type.String({
		maxLength: MAX_LABEL_LENGTH,
		description: `MAX ${MAX_LABEL_LENGTH} CARACTERES — límite duro. Etiqueta corta de la opción (1-5 palabras) que el usuario ve y elige.`,
	}),
	description: Type.String({
		description: "Qué significa la opción o su contraparte / coste.",
	}),
	preview: Type.Optional(
		Type.String({
			description: "Vista previa markdown (mockup/código/diagrama). El MVP aún no la renderiza, pero el host la devuelve si la opción elegida la trae.",
		}),
	),
});

const questionSchema = Type.Object({
	question: Type.String({
		description: "Texto completo de la pregunta. Claro, específico, terminando en '?'.",
	}),
	header: Type.String({
		maxLength: MAX_HEADER_LENGTH,
		description: `MAX ${MAX_HEADER_LENGTH} CARACTERES — límite duro. Etiqueta corta para el chip.`,
	}),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "¿Permitir varias respuestas? Por defecto false." }),
	),
	options: Type.Array(optionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description: `Entre ${MIN_OPTIONS} y ${MAX_OPTIONS} opciones mutuamente excluyentes (salvo multiSelect). La fila de texto libre se añade sola: NO autorices «Otro»/«Escribe algo»/«Type something.».`,
	}),
});

const askSchema = Type.Object({
	questions: Type.Array(questionSchema, { minItems: 1, maxItems: MAX_QUESTIONS }),
});

type AskDetails = { answers: QuestionAnswer[]; cancelled: boolean; error?: QuestionnaireError };

function content(text: string): { type: "text"; text: string }[] {
	return [{ type: "text", text }];
}

function ok(
	text: string,
	answers: QuestionAnswer[],
): { content: { type: "text"; text: string }[]; details: AskDetails } {
	return { content: content(text), details: { answers, cancelled: false } };
}

function declined(): { content: { type: "text"; text: string }[]; details: AskDetails } {
	return {
		content: [{ type: "text", text: "El usuario declinó responder las preguntas." }],
		details: { answers: [], cancelled: true },
	};
}

function invalid(
	error: QuestionnaireError,
	message: string,
): { content: { type: "text"; text: string }[]; details: AskDetails } {
	return {
		content: [{ type: "text", text: `Pregunta inválida (${error}): ${message} Revisa tus preguntas y opciones.` }],
		details: { answers: [], cancelled: true, error },
	};
}

export function createAskUserQuestion(bridge: QuestionBridge) {
	return (pi: ExtensionAPI) => {
		pi.registerTool({
			name: "ask_user_question",
			label: "Preguntar al usuario",
			description:
				"Pregunta al usuario hasta 4 preguntas con opciones concretas, en vez de adivinar. " +
				"Cada pregunta lleva 2-4 opciones, cada una con una descripción. El usuario siempre " +
				"puede responder en sus propias palabras (la fila de texto libre se añade sola: no la " +
				"autorices como opción, ni «Otro»/«Escribe algo»/«Type something.»). Úsalo cuando una " +
				"decisión tenga opciones reales (estrategia, alcance, convención, nombre, formato); no " +
				"para confirmar pasos obvios ni pedir información que puedes deducir del contexto del " +
				"proyecto. No apiles varias llamadas seguidas: agrupa todas las preguntas en una. " +
				"VE DIRECTO AL TOOL: no redactes las preguntas en tu texto antes ni después de llamarlo, " +
				"porque el usuario las verá dos veces (en tu prosa y en la tarjeta) y puede responder " +
				"dos veces, confundiéndote. Si necesitas contexto, di solo una frase corta y dispara el tool.",
			promptSnippet: "Pregunta al usuario hasta 4 cosas con opciones concretas, en vez de adivinar",
			parameters: askSchema,
			async execute(toolCallId, params, signal) {
				const raw = (params as { questions: QuestionSpec[] }).questions ?? [];

				// Validación runtime exhaustiva (TypeBox ya cubrió conteos y
				// longitudes; aquí cubrimos duplicados y reserved labels, y
				// reimprimimos los de conteo con nuestro mensaje claro).
				const v = validateQuestionnaire(raw);
				if (!v.ok) return invalid(v.error, v.message);

				const resp = await bridge.request({ id: toolCallId, questions: raw }, signal);
				if (resp.cancelled || resp.answers.length === 0) return declined();

				// Resolución del preview elegido en el HOST (no en el webview): el
				// MVP no renderiza previews, pero params.questions los trae. Para
				// cada opción elegida, recuperamos su markdown y lo devolvemos al
				// modelo (paridad con rpiv).
				const previewByQuestion = new Map<number, string>();
				for (const a of resp.answers) {
					if (a.kind === "option" && a.answer) {
						const opt = raw[a.questionIndex]?.options.find((o) => o.label === a.answer);
						if (opt?.preview && opt.preview.length > 0) {
							previewByQuestion.set(a.questionIndex, opt.preview);
						}
					}
				}

				const lines = resp.answers.map((a) => {
					const q = raw[a.questionIndex]?.question ?? "";
					const value =
						a.kind === "multi"
							? (a.selected ?? []).join(", ")
							: a.kind === "custom"
								? `«${a.answer ?? ""}»`
								: (a.answer ?? "");
					const note = a.notes ? ` (nota: ${a.notes})` : "";
					const preview = previewByQuestion.get(a.questionIndex);
					const previewBlock = preview
						? `\n  Vista previa elegida:\n\`\`\`\n${preview}\n\`\`\``
						: "";
					return `- «${q}» → ${value}${note}${previewBlock}`;
				});

				return ok("El usuario respondió tus preguntas:\n" + lines.join("\n"), resp.answers);
			},
		});
	};
}
