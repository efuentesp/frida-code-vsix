import { describe, expect, it } from "vitest";
import {
	formatCurrentActivity,
	formatPathTarget,
} from "../webview/activity-formatter";
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

describe("webview/activity-formatter", () => {
	describe("formatPathTarget", () => {
		it("maneja rutas vacías", () => {
			expect(formatPathTarget("")).toEqual({ file: "" });
		});

		it("maneja archivos simples sin carpetas", () => {
			expect(formatPathTarget("README.md")).toEqual({ file: "README.md" });
		});

		it("destaca basename y carpeta padre", () => {
			expect(formatPathTarget("src/providers/frida-enterprise/adapter.ts")).toEqual({
				file: "adapter.ts",
				parent: "(providers/frida-enterprise)",
			});
		});

		it("normaliza backslashes de Windows", () => {
			expect(formatPathTarget("src\\tools\\todo.ts")).toEqual({
				file: "todo.ts",
				parent: "(src/tools)",
			});
		});
	});

	describe("formatCurrentActivity", () => {
		it("prioriza reintento de conexión", () => {
			const res = formatCurrentActivity(
				undefined,
				true,
				false,
				undefined,
				{ attempt: 2, maxAttempts: 5, delayMs: 4000 },
				0,
				3,
			);
			expect(res).toEqual({
				icon: "sync",
				spin: true,
				verb: "Reintentando conexión",
				target: "(intento 2/5, en 3s)",
				kind: "retry",
			});
		});

		it("prioriza compactación de contexto", () => {
			const res = formatCurrentActivity(
				undefined,
				true,
				true,
				"threshold",
				null,
				0,
			);
			expect(res?.verb).toBe("Compactando contexto");
			expect(res?.target).toBe("(automática)");
			expect(res?.canCancel).toBe(true);
			expect(res?.kind).toBe("compacting");
		});

		it("muestra subagentes en segundo plano si el agente principal no está busy", () => {
			const res = formatCurrentActivity(
				undefined,
				false,
				false,
				undefined,
				null,
				3,
			);
			expect(res).toEqual({
				icon: "hubot",
				spin: false,
				verb: "Subagentes activos",
				target: "3 en segundo plano",
				kind: "subagent",
			});
		});

		it("devuelve null si no está busy ni hay subagentes", () => {
			expect(formatCurrentActivity(undefined, false, false)).toBeNull();
		});

		it("formatea comando en terminal (bash)", () => {
			const turn = makeTurn({
				bash: {
					command: "git status --short",
					excludeFromContext: false,
					status: "running",
					output: "",
					exitCode: undefined,
				},
			});
			const res = formatCurrentActivity(turn, true, false);
			expect(res).toEqual({
				icon: "terminal",
				spin: false,
				verb: "Ejecutando en terminal",
				target: "git status --short",
				kind: "bash",
			});
		});

		it("trunca comandos bash largos a 35 caracteres", () => {
			const turn = makeTurn({
				bash: {
					command: "npm run test -- --filter=very-long-test-suite-name-for-testing",
					excludeFromContext: false,
					status: "running",
					output: "",
					exitCode: undefined,
				},
			});
			const res = formatCurrentActivity(turn, true, false);
			expect(res?.target?.endsWith("…")).toBe(true);
			expect(res?.target?.length).toBeLessThanOrEqual(35);
		});

		it("formatea lectura de archivo (read)", () => {
			const runningTool: Extract<Turn["segments"][number], { kind: "tool" }> = {
				kind: "tool",
				tool: "read",
				state: "running",
				startedAt: Date.now(),
				args: { path: "src/main.ts" },
			};
			const turn = makeTurn({ segments: [runningTool] });
			const res = formatCurrentActivity(turn, true, false);
			expect(res).toEqual({
				icon: "file-text",
				spin: false,
				verb: "Leyendo",
				target: "main.ts",
				parentDir: "(src)",
				kind: "tool",
			});
		});

		it("formatea edición de archivo (edit)", () => {
			const runningTool: Extract<Turn["segments"][number], { kind: "tool" }> = {
				kind: "tool",
				tool: "edit",
				state: "running",
				startedAt: Date.now(),
				args: { path: "webview/App.tsx" },
			};
			const turn = makeTurn({ segments: [runningTool] });
			const res = formatCurrentActivity(turn, true, false);
			expect(res).toEqual({
				icon: "edit",
				spin: false,
				verb: "Editando",
				target: "App.tsx",
				parentDir: "(webview)",
				kind: "tool",
			});
		});

		it("formatea búsqueda en proyecto (ffgrep)", () => {
			const runningTool: Extract<Turn["segments"][number], { kind: "tool" }> = {
				kind: "tool",
				tool: "ffgrep",
				state: "running",
				startedAt: Date.now(),
				args: { pattern: "formatCurrentActivity" },
			};
			const turn = makeTurn({ segments: [runningTool] });
			const res = formatCurrentActivity(turn, true, false);
			expect(res).toEqual({
				icon: "search",
				spin: false,
				verb: "Buscando",
				target: '"formatCurrentActivity"',
				kind: "tool",
			});
		});

		it("formatea exploración de archivos (fffind)", () => {
			const runningTool: Extract<Turn["segments"][number], { kind: "tool" }> = {
				kind: "tool",
				tool: "fffind",
				state: "running",
				startedAt: Date.now(),
				args: { pattern: "*.tsx" },
			};
			const turn = makeTurn({ segments: [runningTool] });
			const res = formatCurrentActivity(turn, true, false);
			expect(res).toEqual({
				icon: "list-tree",
				spin: false,
				verb: "Explorando archivos",
				target: "(*.tsx)",
				kind: "tool",
			});
		});

		it("formatea subagentes con su descripción", () => {
			const runningTool: Extract<Turn["segments"][number], { kind: "tool" }> = {
				kind: "tool",
				tool: "Agent",
				state: "running",
				startedAt: Date.now(),
				args: { description: "Revisando arquitectura" },
			};
			const turn = makeTurn({ segments: [runningTool] });
			const res = formatCurrentActivity(turn, true, false);
			expect(res).toEqual({
				icon: "hubot",
				spin: false,
				verb: "Subagente en ejecución",
				target: "Revisando arquitectura",
				kind: "subagent",
			});
		});

		it("formatea estado de razonamiento / thinking", () => {
			const turn = makeTurn({
				status: "thinking",
				segments: [{ kind: "thinking", text: "Analizando...", startedAt: 100 }],
			});
			const res = formatCurrentActivity(turn, true, false);
			expect(res).toEqual({
				icon: "sparkle",
				spin: false,
				verb: "Razonando la respuesta…",
				kind: "thinking",
			});
		});
	});
});
