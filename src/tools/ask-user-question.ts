import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { QuestionBridge, type QuestionAnswer, type QuestionSpec } from "../question-bridge";

// Extensión de Pi que registra el tool `ask_user_question` (ADR-0006). El modelo lo
// llama para preguntar al usuario con opciones concretas en vez de adivinar. El
// `execute` enruta la pregunta al webview por QuestionBridge (mismo patrón que los
// gates de aprobación) y queda en await hasta que el usuario responde o aborta.

const optionSchema = Type.Object({
  label: Type.String({ description: "Etiqueta corta de la opción (1-5 palabras, máx 60 caracteres)." }),
  description: Type.String({ description: "Qué significa la opción o su contraparte / coste." }),
  preview: Type.Optional(Type.String({ description: "Vista previa markdown (mockup/código/diagrama)." })),
});

const questionSchema = Type.Object({
  question: Type.String({ description: "Texto completo de la pregunta, terminando en '?'." }),
  header: Type.String({ maxLength: 16, description: "Etiqueta corta para el chip (máx 16 caracteres)." }),
  multiSelect: Type.Optional(Type.Boolean({ description: "¿Permitir varias respuestas? Por defecto false." })),
  options: Type.Array(optionSchema, { minItems: 2, maxItems: 4 }),
});

const askSchema = Type.Object({
  questions: Type.Array(questionSchema, { minItems: 1, maxItems: 4 }),
});

type AskDetails = { answers: QuestionAnswer[]; cancelled: boolean; error?: string };

function ok(text: string, answers: QuestionAnswer[]): { content: { type: "text"; text: string }[]; details: AskDetails } {
  return { content: [{ type: "text", text }], details: { answers, cancelled: false } };
}

function declined(): { content: { type: "text"; text: string }[]; details: AskDetails } {
  return {
    content: [{ type: "text", text: "El usuario declinó responder las preguntas." }],
    details: { answers: [], cancelled: true },
  };
}

function invalid(code: string): { content: { type: "text"; text: string }[]; details: AskDetails } {
  return {
    content: [{ type: "text", text: `Pregunta inválida (${code}). Revisa preguntas y opciones.` }],
    details: { answers: [], cancelled: true, error: code },
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
        "puede responder en sus propias palabras. Úsalo cuando una decisión tenga opciones " +
        "reales (estrategia, alcance, convención, nombre, formato); no para confirmar pasos " +
        "obvios ni pedir información que puedes deducir del contexto del proyecto.",
      promptSnippet: "Pregunta al usuario hasta 4 cosas con opciones concretas, en vez de adivinar",
      parameters: askSchema,
      async execute(toolCallId, params, signal) {
        const raw = (params as { questions: QuestionSpec[] }).questions ?? [];

        // Validación runtime mínima (TypeBox ya cubrió conteos y longitudes).
        if (raw.length === 0) return invalid("no_questions");
        const seen = new Set<string>();
        for (const q of raw) {
          if (seen.has(q.question)) return invalid("duplicate_question");
          seen.add(q.question);
        }

        const resp = await bridge.request({ id: toolCallId, questions: raw }, signal);
        if (resp.cancelled || resp.answers.length === 0) return declined();

        const lines = resp.answers.map((a) => {
          const q = raw[a.questionIndex]?.question ?? "";
          const value =
            a.kind === "multi" ? (a.selected ?? []).join(", ")
            : a.kind === "custom" ? `«${a.answer ?? ""}»`
            : (a.answer ?? "");
          const note = a.notes ? ` (nota: ${a.notes})` : "";
          return `- «${q}» → ${value}${note}`;
        });

        return ok("El usuario respondió tus preguntas:\n" + lines.join("\n"), resp.answers);
      },
    });
  };
}
