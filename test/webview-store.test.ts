// Unitarias del reducer del webview (ADR-1003-F3): el indicador
// "razonó N tokens" — cuando el modelo gastó reasoning_tokens pero el backend
// no emitió resumen (sin thinking_delta), el turn debe mostrar la pista.
//
// El store es un reducer PURO (sin React) → testeable directo.

import { describe, expect, it } from "vitest";
import { reduce, initialState } from "../webview/store";

function stateWithTurn() {
	return reduce(initialState, { type: "user", text: "pregunta" } as any);
}

describe("reducer: reasoning_hint (ADR-1003-F3)", () => {
	it("sin thinking en el turn → añade el segmento con los tokens", () => {
		let state = reduce(stateWithTurn(), { type: "delta", text: "respuesta" } as any);
		state = reduce(state, { type: "reasoning_hint", tokens: 427 } as any);
		const turn = state.turns[state.turns.length - 1];
		const hint = turn.segments.find((s: any) => s.kind === "reasoning_hint");
		expect(hint).toBeDefined();
		expect((hint as any).tokens).toBe(427);
	});

	it("con tarjeta de pensamiento YA presente → IGNORA el hint (redundante)", () => {
		let state = reduce(stateWithTurn(), { type: "thinking_delta", text: "pienso…" } as any);
		state = reduce(state, { type: "reasoning_hint", tokens: 427 } as any);
		const turn = state.turns[state.turns.length - 1];
		expect(
			turn.segments.find((s: any) => s.kind === "reasoning_hint"),
		).toBeUndefined();
	});

	it("idempotente: dos hints no duplican el segmento (conserva el máximo)", () => {
		let state = reduce(stateWithTurn(), { type: "delta", text: "x" } as any);
		state = reduce(state, { type: "reasoning_hint", tokens: 100 } as any);
		state = reduce(state, { type: "reasoning_hint", tokens: 300 } as any);
		const turn = state.turns[state.turns.length - 1];
		const hints = turn.segments.filter((s: any) => s.kind === "reasoning_hint");
		expect(hints.length).toBe(1);
		expect((hints[0] as any).tokens).toBe(300);
	});

	it("sin turns activos → sin crash ni turn creado", () => {
		const state = reduce(initialState, { type: "reasoning_hint", tokens: 5 } as any);
		expect(state.turns.length).toBe(0);
		expect(state.busy).toBe(initialState.busy);
	});
});
