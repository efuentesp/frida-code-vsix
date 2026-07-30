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

const Q2: WebQuestionSpec[] = [
	{
		question: "¿Auth method?",
		header: "Auth",
		options: [{ label: "Supabase", description: "d" }],
	},
	{
		question: "¿Library?",
		header: "Library",
		options: [{ label: "Zod", description: "d" }],
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

		// Con 1 pregunta no hay tab bar.
		expect(collectCls(tree).some((c) => c.includes("q-tabs"))).toBe(false);
		// Las opciones renderizan como filas (q-opt), no como botones.
		expect(collectCls(tree).some((c) => c.includes("q-opt"))).toBe(true);

		// La promesa de render() sólo resuelve al hacer Submit (done). No la
		// esperamos (no hay fireEvent del host); descartamos para no colgar.
		void promise.catch(() => undefined);
		bridge.dispose();
	});

	it("muestra tab bar (q-tabs) sólo con 2+ preguntas; una pestaña activa", async () => {
		const commits: Commit[] = [];
		const bridge = new WebBridge((rootId, tree, placement) =>
			commits.push({ rootId, tree: tree as WebNode, placement }),
		);
		const promise = bridge.render<WebQuestionnaireResult>(
			(done) => createWebQuestionnaireElement(Q2, done),
			"composer",
		);
		const cls = collectCls(commits[0]!.tree!);
		// Hay una barra de pestañas.
		expect(cls.some((c) => c.includes("q-tabs"))).toBe(true);
		// Una pestaña por pregunta (excluyendo el contenedor q-tabs).
		const tabs = cls.filter((c) => /(^|\s)q-tab(\s|$)/.test(c));
		expect(tabs.length).toBe(2);
		// Exactamente una activa (la inicial, tab 0).
		expect(tabs.filter((c) => c.includes("active")).length).toBe(1);
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
function collectCls(node: WebNode | null): string[] {
	if (!node || typeof node !== "object" || !("type" in node)) return [];
	const out: string[] = [];
	const cls = (node as any).props?.cls;
	if (typeof cls === "string") out.push(cls);
	for (const c of (node as any).children ?? [])
		if (typeof c === "object") out.push(...collectCls(c as WebNode));
	return out;
}
function textOf(node: WebNode): string {
	return ((node as any).children ?? [])
		.map((c: any) =>
			c?.__text ? c.value : typeof c === "string" ? c : textOf(c as WebNode),
		)
		.join("");
}
