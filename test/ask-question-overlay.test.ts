// Test foco: ¿el puente del cuestionario (ADR-0027) publica y resuelve bien?
// Reemplaza al test sobre Remote React (webBridge.render + inspección del árbol
// WebNode), ya que ask_user_question migró a componente nativo del webview
// (QuestionsPanel). La lógica que vive en el host es ahora QuestionnaireBridge:
// request() publica el pendiente, resolve() entrega la respuesta, y el abort del
// turn → cancelledResponse (decline). La UI (QuestionsPanel) es un componente
// React del browser y se valida con el demo (frida.demoWebQuestionnaire).
import { describe, it, expect } from "vitest";
import {
	QuestionnaireBridge,
	type QuestionnaireRequest,
	type WebQuestionSpec,
} from "../src/questionnaire-bridge";

const Q: WebQuestionSpec[] = [
	{
		question: "¿Qué librería?",
		header: "Librería",
		options: [
			{ label: "A", description: "desc A" },
			{ label: "B", description: "desc B" },
		],
	},
];

describe("QuestionnaireBridge (ADR-0027)", () => {
	it("request() publica el cuestionario pendiente y resolve() lo entrega", async () => {
		const emitted: QuestionnaireRequest[][] = [];
		const bridge = new QuestionnaireBridge((reqs) => emitted.push(reqs));
		const p = bridge.request({ id: "q1", questions: Q });

		// Tras request, el puente emite la lista de pendientes (con nuestro req).
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toHaveLength(1);
		expect(emitted[0]![0]!.questions).toEqual(Q);

		// El webview (QuestionsPanel) responde con una opción elegida.
		bridge.resolve({
			id: "q1",
			cancelled: false,
			answers: [{ questionIndex: 0, kind: "option", answer: "A" }],
		});
		const result = await p;
		expect(result.cancelled).toBe(false);
		expect(result.answers[0]?.kind).toBe("option");
		expect(result.answers[0]?.answer).toBe("A");
		// Al resolver, emite de nuevo (lista vacía → el webview lo desmonta).
		expect(emitted[1]).toEqual([]);
	});

	it("resolve(cancelled: true) entrega decline (answers vacías)", async () => {
		const bridge = new QuestionnaireBridge(() => {});
		const p = bridge.request({ id: "q2", questions: Q });
		bridge.resolve({ id: "q2", cancelled: true, answers: [] });
		const result = await p;
		expect(result.cancelled).toBe(true);
		expect(result.answers).toEqual([]);
	});

	it("abort del turn → cancelledResponse (decline) y limpia el pendiente", async () => {
		const published: unknown[] = [];
		const bridge = new QuestionnaireBridge((reqs) => published.push(reqs));
		const controller = new AbortController();
		const p = bridge.request({ id: "q3", questions: Q }, controller.signal);
		controller.abort();
		const result = await p;
		// El decline por abort tiene la misma forma que un cancel manual.
		expect(result.cancelled).toBe(true);
		expect(result.answers).toEqual([]);
		// El puente emite la lista vacía (desmonta el diálogo del webview).
		expect(published.at(-1)).toEqual([]);
	});
});
