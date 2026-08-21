import { describe, expect, it } from "vitest";
import {
	groupSegments,
	summarizeToolGroup,
	extractLastThought,
} from "../webview/turn-grouping";
import type { Segment, ToolEntry } from "../webview/types";

function makeTool(
	over: Partial<ToolEntry> = {},
): Extract<Segment, { kind: "tool" }> {
	return {
		kind: "tool",
		tool: "read",
		args: { path: "src/main.ts" },
		state: "ok",
		startedAt: 1000,
		endedAt: 2000,
		tokensLLM: 100,
		...over,
	};
}

describe("webview/turn-grouping (Fase 3: Estructura de Turnos y Agrupación)", () => {
	describe("groupSegments", () => {
		it("devuelve arreglo vacío para lista de segmentos vacía", () => {
			expect(groupSegments([])).toEqual([]);
		});

		it("preserva segmento de texto único", () => {
			const segments: Segment[] = [{ kind: "text", text: "Hola" }];
			const blocks = groupSegments(segments);
			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toEqual({
				kind: "text",
				segment: { kind: "text", text: "Hola" },
				index: 0,
			});
		});

		it("preserva segmento de thinking único", () => {
			const segments: Segment[] = [
				{ kind: "thinking", text: "Razonando...", startedAt: 100 },
			];
			const blocks = groupSegments(segments);
			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toEqual({
				kind: "thinking",
				segment: { kind: "thinking", text: "Razonando...", startedAt: 100 },
				index: 0,
			});
		});

		it("agrupa múltiples tools contiguas entre thinking y texto", () => {
			const t1 = makeTool({ tool: "read", startedAt: 1000, endedAt: 1500 });
			const t2 = makeTool({ tool: "edit", startedAt: 1500, endedAt: 2500 });
			const t3 = makeTool({ tool: "bash", startedAt: 2500, endedAt: 4000 });

			const segments: Segment[] = [
				{ kind: "thinking", text: "Plan", startedAt: 500, endedAt: 900 },
				t1,
				t2,
				t3,
				{ kind: "text", text: "Listo!" },
			];

			const blocks = groupSegments(segments);
			expect(blocks).toHaveLength(3);
			expect(blocks[0].kind).toBe("thinking");
			expect(blocks[1].kind).toBe("tools");
			if (blocks[1].kind === "tools") {
				expect(blocks[1].tools).toHaveLength(3);
				expect(blocks[1].tools[0].tool).toBe("read");
				expect(blocks[1].tools[1].tool).toBe("edit");
				expect(blocks[1].tools[2].tool).toBe("bash");
				expect(blocks[1].startIndex).toBe(1);
			}
			expect(blocks[2].kind).toBe("text");
		});

		it("separa grupos de tools si hay texto intermedio", () => {
			const t1 = makeTool({ tool: "read" });
			const t2 = makeTool({ tool: "write" });

			const segments: Segment[] = [
				t1,
				{ kind: "text", text: "Paso 1 completado" },
				t2,
				{ kind: "text", text: "Paso 2 completado" },
			];

			const blocks = groupSegments(segments);
			expect(blocks).toHaveLength(4);
			expect(blocks[0].kind).toBe("tools");
			expect(blocks[1].kind).toBe("text");
			expect(blocks[2].kind).toBe("tools");
			expect(blocks[3].kind).toBe("text");
		});
	});

	describe("summarizeToolGroup", () => {
		it("calcula conteo, duración y tokens para tools finalizadas", () => {
			const tools = [
				makeTool({ startedAt: 1000, endedAt: 2200, tokensLLM: 150 }),
				makeTool({ startedAt: 2200, endedAt: 3500, tokensLLM: 250 }),
			];

			const summary = summarizeToolGroup(tools);
			expect(summary.count).toBe(2);
			expect(summary.isRunning).toBe(false);
			expect(summary.hasError).toBe(false);
			expect(summary.durationMs).toBe(2500); // 3500 - 1000
			expect(summary.durationStr).toBe("2.5s");
			expect(summary.totalTokens).toBe(400);
			expect(summary.tokensStr).toBe("400 tok");
			expect(summary.label).toBe("2 herramientas usadas");
		});

		it("detecta herramientas en ejecución", () => {
			const tools = [
				makeTool({ startedAt: 1000, endedAt: 1500, state: "ok" }),
				makeTool({ startedAt: 1500, state: "running" }),
			];

			const summary = summarizeToolGroup(tools, 3000);
			expect(summary.count).toBe(2);
			expect(summary.isRunning).toBe(true);
			expect(summary.hasError).toBe(false);
			expect(summary.label).toBe("Ejecutando 2 herramientas…");
		});

		it("detecta errores en herramientas", () => {
			const tools = [
				makeTool({ startedAt: 1000, endedAt: 1500, state: "ok" }),
				makeTool({ startedAt: 1500, endedAt: 2000, state: "error" }),
			];

			const summary = summarizeToolGroup(tools);
			expect(summary.count).toBe(2);
			expect(summary.isRunning).toBe(false);
			expect(summary.hasError).toBe(true);
		});

		it("maneja caso de 1 sola herramienta", () => {
			const tool = makeTool({
				tool: "read",
				startedAt: 1000,
				endedAt: 1400,
				state: "ok",
			});
			const summary = summarizeToolGroup([tool]);
			expect(summary.count).toBe(1);
			expect(summary.label).toBe("1 herramienta usada");
		});
	});

	describe("extractLastThought", () => {
		it("extrae la última línea relevante omitiendo viñetas y comillas", () => {
			const text =
				"1. Primero examinamos el workspace\n2. Verificando dependencias en package.json";
			expect(extractLastThought(text)).toBe(
				"Verificando dependencias en package.json",
			);
		});

		it("trunca pensamientos largos a ~55 caracteres", () => {
			const long =
				"Esta es una reflexión sumamente larga que sobrepasa el límite visual del encabezado del pensamiento en vivo";
			const result = extractLastThought(long);
			expect(result.length).toBeLessThanOrEqual(55);
			expect(result.endsWith("…")).toBe(true);
		});

		it("devuelve fallback si el texto está vacío o no tiene líneas útiles", () => {
			expect(extractLastThought("")).toBe("Razonando…");
			expect(extractLastThought(null)).toBe("Razonando…");
		});
	});
});
