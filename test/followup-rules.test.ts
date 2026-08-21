import { describe, expect, it } from "vitest";
import { getContextualFollowups } from "../webview/followup-rules";
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

describe("webview/followup-rules (Fase 5: Sugerencias Contextuales)", () => {
	it("no devuelve sugerencias si el agente está ocupado (busy=true)", () => {
		const turns: Turn[] = [makeTurn({ segments: [{ kind: "text", text: "ok" }] })];
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

	it("ofrece ejecutar tests y revisar diff tras ediciones (edit/write)", () => {
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
					{ kind: "text", text: "Edité src/main.ts" },
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
					{ kind: "text", text: "Tests pasaron" },
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
				],
			}),
		];
		const followups = getContextualFollowups(turns);
		expect(followups.some((f) => f.id === "workflow-status")).toBe(true);
	});
});
