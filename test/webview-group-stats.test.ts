// Pruebas de webview/group-stats (Fase 3 del plan webview-copilot-p1).
// TDD: escritas ANTES del módulo; rojo esperado "Cannot find module".
import { describe, expect, it } from "vitest";
import { toolRuns } from "../webview/group-stats";
import type { Segment } from "../webview/types";

const text = (t: string): Segment => ({ kind: "text", text: t });
const tool = (id: string, durMs = 100, tok = 50): Segment => ({
	kind: "tool",
	tool: id,
	args: {},
	state: "ok",
	startedAt: 0,
	endedAt: durMs,
	tokensLLM: tok,
});

describe("group-stats: corridas contiguas de tools", () => {
	it("tools contiguas forman UNA corrida", () => {
		const runs = toolRuns({ status: null, segments: [text("a"), tool("read"), tool("grep"), text("b")] });
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ count: 2, totalMs: 200, totalTokens: 100 });
	});

	it("texto/thinking PARTE las corridas (cronología preservada)", () => {
		const runs = toolRuns({
			status: null,
			segments: [tool("read"), text("intermedio"), tool("grep")],
		});
		expect(runs).toHaveLength(2);
		expect(runs[0].count).toBe(1);
		expect(runs[1].count).toBe(1);
	});

	it("corrida de 1 tool → count 1 (la UI decide no pintar chrome de grupo)", () => {
		const runs = toolRuns({ status: null, segments: [text("x"), tool("bash")] });
		expect(runs[0].count).toBe(1);
	});

	it("turno EN VIVO (status !== null) → sin agrupación (filas sueltas)", () => {
		const runs = toolRuns({ status: "executing", segments: [tool("read"), tool("grep")] });
		expect(runs).toHaveLength(0);
	});

	it("thinking también parte corridas", () => {
		const runs = toolRuns({
			status: null,
			segments: [tool("read"), { kind: "thinking", text: "…", startedAt: 0 }, tool("edit")],
		});
		expect(runs).toHaveLength(2);
	});

	it("reasoning_hint se ignora (no parte corridas)", () => {
		const runs = toolRuns({
			status: null,
			segments: [tool("read"), { kind: "reasoning_hint", tokens: 10 }, tool("edit")],
		});
		expect(runs).toHaveLength(1);
		expect(runs[0].count).toBe(2);
	});

	it("índices de segmentos preservados para el renderer", () => {
		const runs = toolRuns({
			status: null,
			segments: [text("a"), tool("read"), tool("grep"), text("b"), tool("edit")],
		});
		expect(runs[0].startIndex).toBe(1); // incluye segment 1 y 2
		expect(runs[0].endIndex).toBe(2);
		expect(runs[1].startIndex).toBe(4);
		expect(runs[1].endIndex).toBe(4);
	});

	it("Σduración y Σtokens incluyen tools sin endedAt (running→live no agrupa, defensa)", () => {
		const runs = toolRuns({
			status: null,
			segments: [
				{ kind: "tool", tool: "read", args: {}, state: "ok", startedAt: 0, endedAt: 300, tokensLLM: 10 },
				{ kind: "tool", tool: "grep", args: {}, state: "ok", startedAt: 0, tokensLLM: 20 },
			],
		});
		expect(runs[0].totalTokens).toBe(30);
	});
});

describe("group-stats: resumen del summary pill", () => {
	it("summary con N herramientas y duración", () => {
		const runs = toolRuns({ status: null, segments: [tool("read", 1500), tool("grep", 500)] });
		expect(runs[0].summary).toContain("2 herramientas");
		expect(runs[0].summary).toMatch(/2\.0s/);
	});
	it("singular: 1 herramienta", () => {
		const runs = toolRuns({ status: null, segments: [tool("bash", 800)] });
		expect(runs[0].summary).toContain("1 herramienta");
	});
	it("tokens en el summary cuando hay atribución", () => {
		const runs = toolRuns({ status: null, segments: [tool("read", 100, 1200), tool("edit", 100, 340)] });
		expect(runs[0].summary).toContain("tok");
	});
});
