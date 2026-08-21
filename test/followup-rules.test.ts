import { describe, expect, it } from "vitest";
import {
	extractConclusionText,
	extractProposals,
	extractQuestionFollowups,
	getContextualFollowups,
} from "../webview/followup-rules";
import type { Turn } from "../webview/types";

function makeTurn(over: Partial<Turn> = {}): Turn {
	return {
		id: 1,
		user: "haz algo",
		segments: [],
		status: null,
		...over,
	};
}

describe("webview/followup-rules (Motor de Sugerencias Contextuales Semánticas)", () => {
	it("extrae el texto de conclusión del último turno", () => {
		const turn = makeTurn({
			segments: [
				{
					kind: "tool",
					tool: "read",
					args: { path: "x.ts" },
					state: "ok",
					startedAt: 10,
				},
				{ kind: "text", text: "He analizado el código y propongo cambios." },
			],
		});
		expect(extractConclusionText(turn)).toBe(
			"He analizado el código y propongo cambios.",
		);
	});

	it("no devuelve sugerencias si el agente está ocupado (busy=true)", () => {
		const turns: Turn[] = [
			makeTurn({ segments: [{ kind: "text", text: "ok" }] }),
		];
		expect(getContextualFollowups(turns, true)).toEqual([]);
	});

	it("no devuelve sugerencias si no hay turnos", () => {
		expect(getContextualFollowups([])).toEqual([]);
	});

	it("ofrece reintentar y explicar ante un error de turno", () => {
		const turns: Turn[] = [
			makeTurn({
				error: "Error: No se pudo compilar el archivo",
			}),
		];
		const followups = getContextualFollowups(turns);
		expect(followups).toHaveLength(2);
		expect(followups[0].id).toBe("retry-error");
		expect(followups[1].id).toBe("explain-error");
	});

	it("extrae propuestas explícitas cuando el asistente presenta alternativas", () => {
		const text = `
He evaluado las opciones:
### Propuesta A: Línea Fluida Integrada
Elimina los bordes y muestra texto en vivo.

### Propuesta B: Breadcrumbs estilo Monaco
Muestra ruta jerárquica.

### Propuesta C: Status Ticker Compacto
Ticker al lado del composer.

¿Cuál prefieres?
`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(3);
		expect(proposals[0].id).toBe("prop-a");
		expect(proposals[0].label).toContain("Propuesta A");
		expect(proposals[0].prompt).toBe("Procedamos con la Propuesta A.");
		expect(proposals[1].id).toBe("prop-b");
		expect(proposals[2].id).toBe("prop-c");
	});

	it("extrae botones de acción directa ante preguntas de release", () => {
		const text =
			"Todos los cambios están listos y probados. ¿Deseas que preparemos y publiquemos el release v0.26.0?";
		const followups = extractQuestionFollowups(text);
		expect(followups.some((f) => f.id === "release-publish")).toBe(true);
		expect(followups.some((f) => f.label.includes("v0.26.0"))).toBe(true);
		expect(followups.some((f) => f.id === "release-changelog")).toBe(true);
	});

	it("extrae botones ante preguntas de aplicar ajustes", () => {
		const text =
			"He preparado el plan para la barra. ¿Deseas que aplique estos ajustes de inmediato?";
		const followups = extractQuestionFollowups(text);
		expect(followups.some((f) => f.id === "apply-yes")).toBe(true);
		expect(followups.some((f) => f.id === "apply-adjust")).toBe(true);
	});

	it("prioriza propuestas semánticas sobre heurísticas genéricas de herramientas", () => {
		const turns: Turn[] = [
			makeTurn({
				segments: [
					{
						kind: "tool",
						tool: "edit",
						args: { path: "src/main.ts" },
						state: "ok",
						startedAt: 100,
					},
					{
						kind: "text",
						text: "### Propuesta 1: Usar Redux\n### Propuesta 2: Usar Zustand\n¿Cuál elegimos?",
					},
				],
			}),
		];
		const followups = getContextualFollowups(turns);
		expect(followups[0].id).toBe("prop-1");
		expect(followups[1].id).toBe("prop-2");
	});

	it("ofrece ejecutar tests y revisar diff tras ediciones si no hay preguntas", () => {
		const turns: Turn[] = [
			makeTurn({
				segments: [
					{
						kind: "tool",
						tool: "edit",
						args: { path: "src/main.ts" },
						state: "ok",
						startedAt: 100,
					},
					{ kind: "text", text: "Edité src/main.ts correctamente." },
				],
			}),
		];
		const followups = getContextualFollowups(turns);
		expect(followups.some((f) => f.id === "run-tests")).toBe(true);
		expect(followups.some((f) => f.id === "review-diff")).toBe(true);
	});

	it("ofrece comprobar diagnósticos tras correr tests o builds", () => {
		const turns: Turn[] = [
			makeTurn({
				segments: [
					{
						kind: "tool",
						tool: "bash",
						args: { command: "npm test" },
						state: "ok",
						startedAt: 100,
					},
					{ kind: "text", text: "Tests pasaron." },
				],
			}),
		];
		const followups = getContextualFollowups(turns);
		expect(followups.some((f) => f.id === "check-diagnostics")).toBe(true);
	});

	it("ofrece estado del workflow tras ejecutar una tool de workflow", () => {
		const turns: Turn[] = [
			makeTurn({
				segments: [
					{
						kind: "tool",
						tool: "workflow",
						args: { name: "aidd-plan" },
						state: "ok",
						startedAt: 100,
					},
					{ kind: "text", text: "Lanzando workflow." },
				],
			}),
		];
		const followups = getContextualFollowups(turns);
		expect(followups.some((f) => f.id === "workflow-status")).toBe(true);
	});
});
