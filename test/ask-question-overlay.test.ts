// Test foco: ¿monta el WebQuestionnaire (ask_user_question) un árbol válido?
// Diagnóstico del reporte "la pregunta no apareció".
import { describe, it, expect } from "vitest";
import { WebBridge } from "../src/web-bridge";
import { createWebQuestionnaireElement } from "../src/web-questionnaire";
import type {
	WebQuestionSpec,
	WebQuestionnaireResult,
} from "../src/web-questionnaire";
import type { WebNode } from "../src/web-protocol";

interface Commit {
	rootId: string;
	tree: WebNode | null;
	placement: string;
}

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

describe("ask_user_question — webBridge.render(WebQuestionnaire)", () => {
	it("comete un árbol fbox con la pregunta + botones (footer)", async () => {
		const commits: Commit[] = [];
		const bridge = new WebBridge((rootId, tree, placement) =>
			commits.push({ rootId, tree: tree as WebNode, placement }),
		);

		const promise = bridge.render<WebQuestionnaireResult>(
			(done) => createWebQuestionnaireElement(Q, done),
			"composer",
		);

		// Debe haber al menos un commit con árbol no nulo (footer).
		expect(commits.length).toBeGreaterThanOrEqual(1);
		const tree = commits[0]!.tree!;
		expect(tree).toBeTruthy();
		expect((tree as { type: string }).type).toBe("fbox");
		expect(commits[0]!.placement).toBe("composer");

		// Contiene botones de acción (Enviar/Siguiente/Cancelar).
		const labels = collectText(tree, "fbutton");
		expect(labels.some((t) => /Enviar|Siguiente|Cancelar/i.test(t))).toBe(true);

		// La promesa de render() sólo resuelve al hacer Submit (done). No la
		// esperamos (no hay fireEvent del host); descartamos para no colgar.
		void promise.catch(() => undefined);
		bridge.dispose();
	});
});

function collectText(node: WebNode | null, type: string): string[] {
	if (!node || typeof node !== "object" || !("type" in node)) return [];
	const out: string[] = node.type === type ? [textOf(node)] : [];
	for (const c of (node as any).children ?? [])
		out.push(...collectText(c, type));
	return out;
}
function textOf(node: WebNode): string {
	return ((node as any).children ?? [])
		.map((c: any) =>
			c?.__text ? c.value : typeof c === "string" ? c : textOf(c as WebNode),
		)
		.join("");
}
