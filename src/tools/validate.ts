// Validación runtime PURA para los parámetros de `ask_user_question`, separada
// del schema TypeBox (que solo enforce conteos/longitudes) y del `execute`.
//
// Cubre los casos que TypeBox no puede —preguntas duplicadas, opciones
// duplicadas y etiquetas reservadas— y reimprime los de conteo con NUESTRO
// mensaje claro en vez del genérico de TypeBox. Sin efectos secundarios, por
// lo que es testeable aislada. Patrón de rpiv (`validate-questionnaire.ts`).

import { MAX_QUESTIONS, MIN_OPTIONS, RESERVED_LABELS, type ValidationResult } from "./types";

const RESERVED_LABEL_SET: ReadonlySet<string> = new Set(RESERVED_LABELS);

/**
 * Valida un cuestionario. `reserved_label` se cortocircuita antes de
 * `duplicate_option_label` (paridad con rpiv): importa más avisar de un label
 * reservado que de un duplicado.
 */
export function validateQuestionnaire(
	questions: { question: string; options: { label: string }[] }[],
): ValidationResult {
	if (questions.length === 0) {
		return { ok: false, error: "no_questions", message: "Se requiere al menos una pregunta." };
	}
	if (questions.length > MAX_QUESTIONS) {
		return {
			ok: false,
			error: "too_many_questions",
			message: `Máximo ${MAX_QUESTIONS} preguntas por invocación.`,
		};
	}

	const seenQuestions = new Set<string>();
	for (const q of questions) {
		if (seenQuestions.has(q.question)) {
			return {
				ok: false,
				error: "duplicate_question",
				message: "El texto de cada pregunta debe ser único dentro de la invocación.",
			};
		}
		seenQuestions.add(q.question);
	}

	for (const q of questions) {
		if (q.options.length < MIN_OPTIONS) {
			return {
				ok: false,
				error: "too_few_options",
				message: `Cada pregunta requiere al menos ${MIN_OPTIONS} opciones.`,
			};
		}
		const seenLabels = new Set<string>();
		for (const o of q.options) {
			if (RESERVED_LABEL_SET.has(o.label)) {
				return {
					ok: false,
					error: "reserved_label",
					message: `La etiqueta de opción «${o.label}» está reservada (fila interna / texto libre). No la autorices: el usuario ya tiene una fila para responder libremente.`,
				};
			}
			if (seenLabels.has(o.label)) {
				return {
					ok: false,
					error: "duplicate_option_label",
					message: "Las etiquetas de opción deben ser únicas dentro de cada pregunta.",
				};
			}
			seenLabels.add(o.label);
		}
	}

	return { ok: true };
}
