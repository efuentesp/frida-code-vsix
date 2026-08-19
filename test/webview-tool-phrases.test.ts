import { describe, expect, it } from "vitest";
import { fmtDuration, getToolPhrase } from "../webview/tool-phrases";
import type { ToolEntry } from "../webview/types";

function makeEntry(over: Partial<ToolEntry> = {}): ToolEntry {
	return {
		tool: "read",
		args: {},
		state: "ok",
		startedAt: Date.now() - 1000,
		endedAt: Date.now(),
		...over,
	};
}

describe("webview/tool-phrases (Fase 2: Catálogo Tool por Tool)", () => {
	describe("fmtDuration", () => {
		it("formatea milisegundos y segundos legibles", () => {
			expect(fmtDuration(318)).toBe("318 ms");
			expect(fmtDuration(1400)).toBe("1.4s");
			expect(fmtDuration(10500)).toBe("10.5s");
			expect(fmtDuration(-1)).toBe("");
		});
	});

	describe("Archivos: read, write, edit", () => {
		it("read: estado running y completado con líneas", () => {
			const active = getToolPhrase(
				makeEntry({
					tool: "read",
					args: { path: "src/app.ts" },
					state: "running",
				}),
			);
			expect(active.verb).toBe("Leyendo");
			expect(active.arg).toBe("src/app.ts");
			expect(active.isAnchor).toBe(true);
			expect(active.iconName).toBe("file-text");

			const done = getToolPhrase(
				makeEntry({
					tool: "read",
					args: { path: "src/app.ts" },
					state: "ok",
					result: "line 1\nline 2\nline 3",
				}),
			);
			expect(done.verb).toBe("Leyó");
			expect(done.arg).toBe("src/app.ts");
			expect(done.detail).toBe("3 líneas");
		});

		it("write: estado running y completado", () => {
			const active = getToolPhrase(
				makeEntry({
					tool: "write",
					args: { path: "src/nuevo.ts", content: "export const x = 1;\n" },
					state: "running",
				}),
			);
			expect(active.verb).toBe("Escribiendo");
			expect(active.arg).toBe("src/nuevo.ts");
			expect(active.iconName).toBe("file-code");

			const done = getToolPhrase(
				makeEntry({
					tool: "write",
					args: { path: "src/nuevo.ts", content: "a\nb\n" },
					state: "ok",
				}),
			);
			expect(done.verb).toBe("Escribió");
			expect(done.detail).toBe("2 líneas");
		});

		it("edit: estado running y completado con diff stats", () => {
			const active = getToolPhrase(
				makeEntry({
					tool: "edit",
					args: { path: "src/comp.tsx" },
					state: "running",
				}),
			);
			expect(active.verb).toBe("Editando");
			expect(active.iconName).toBe("edit");

			const done = getToolPhrase(
				makeEntry({
					tool: "edit",
					args: { path: "src/comp.tsx" },
					state: "ok",
					diff: "--- a\n+++ b\n+nuevo 1\n+nuevo 2\n-viejo 1",
				}),
			);
			expect(done.verb).toBe("Editó");
			expect(done.detail).toBe("+2 -1");
		});
	});

	describe("Terminal y Shell: bash", () => {
		it("bash: running, exit 0 y error", () => {
			const active = getToolPhrase(
				makeEntry({
					tool: "bash",
					args: { command: "npm test" },
					state: "running",
				}),
			);
			expect(active.verb).toBe("Ejecutando");
			expect(active.arg).toBe("npm test");
			expect(active.iconName).toBe("terminal");

			const done = getToolPhrase(
				makeEntry({
					tool: "bash",
					args: { command: "npm test" },
					state: "ok",
					startedAt: 1000,
					endedAt: 2500,
				}),
			);
			expect(done.verb).toBe("Ejecutó");
			expect(done.detail).toBe("exit 0 (1.5s)");

			const err = getToolPhrase(
				makeEntry({
					tool: "bash",
					args: { command: "npm test" },
					state: "error",
				}),
			);
			expect(err.verb).toBe("Falló");
			expect(err.detail).toBe("exit 1");
		});
	});

	describe("Búsqueda y Diagnósticos", () => {
		it("ffgrep / grep: coincidencias en resultado", () => {
			const done = getToolPhrase(
				makeEntry({
					tool: "ffgrep",
					args: { pattern: "myVar" },
					state: "ok",
					result: "file1:line1\nfile2:line2",
				}),
			);
			expect(done.verb).toBe("Buscó");
			expect(done.arg).toBe('"myVar"');
			expect(done.detail).toBe("2 coincidencias");
		});

		it("fffind / find: archivos encontrados", () => {
			const done = getToolPhrase(
				makeEntry({
					tool: "fffind",
					args: { pattern: "*.ts" },
					state: "ok",
					result: "a.ts\nb.ts\nc.ts",
				}),
			);
			expect(done.verb).toBe("Encontró");
			expect(done.detail).toBe("3 archivos");
		});

		it("diagnósticos: pulse icon", () => {
			const diag = getToolPhrase(
				makeEntry({
					tool: "lens_diagnostics",
					state: "running",
				}),
			);
			expect(diag.verb).toBe("Comprobando diagnósticos");
			expect(diag.iconName).toBe("pulse");
		});
	});

	describe("Subagentes y Workflows", () => {
		it("Agent: muestra tipo y descripción", () => {
			const agent = getToolPhrase(
				makeEntry({
					tool: "Agent",
					args: { subagent_type: "Plan", description: "Diseñar arquitectura" },
					state: "running",
				}),
			);
			expect(agent.verb).toBe("Lanzando sub-agente");
			expect(agent.arg).toBe("[Plan] Diseñar arquitectura");
			expect(agent.iconName).toBe("hubot");
		});

		it("workflow: muestra nombre y finalizado", () => {
			const wf = getToolPhrase(
				makeEntry({
					tool: "workflow",
					args: { name: "aidd-plan" },
					state: "ok",
				}),
			);
			expect(wf.verb).toBe("Workflow finalizado");
			expect(wf.arg).toBe('"aidd-plan"');
			expect(wf.iconName).toBe("play-circle");
		});
	});

	describe("Web, MCP y Fallback", () => {
		it("agent_browser: globe icon", () => {
			const browser = getToolPhrase(
				makeEntry({
					tool: "agent_browser",
					state: "running",
				}),
			);
			expect(browser.verb).toBe("Navegando");
			expect(browser.iconName).toBe("globe");
		});

		it("mcp: plug icon", () => {
			const mcp = getToolPhrase(
				makeEntry({
					tool: "mcp",
					args: { tool: "sqlite_query" },
					state: "ok",
				}),
			);
			expect(mcp.verb).toBe("MCP respondió");
			expect(mcp.arg).toBe("sqlite_query");
			expect(mcp.iconName).toBe("plug");
		});

		it("fallback para tool desconocido", () => {
			const custom = getToolPhrase(
				makeEntry({
					tool: "mi_tool_custom",
					state: "running",
				}),
			);
			expect(custom.verb).toBe("Ejecutando mi_tool_custom");
			expect(custom.iconName).toBe("tools");
		});
	});
});
