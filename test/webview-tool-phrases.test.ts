// Pruebas de webview/tool-phrases (Fase 2 del plan webview-copilot-p1).
// TDD: escritas ANTES del módulo; el rojo esperado es
// "Cannot find module '../webview/tool-phrases'".
import { describe, expect, it } from "vitest";
import { toolPhrases, runningPhraseParts } from "../webview/tool-phrases";
import type { ToolEntry } from "../webview/types";

const entry = (tool: string, args: unknown, extra: Partial<ToolEntry> = {}): ToolEntry => ({
	tool,
	args,
	state: "ok",
	startedAt: 0,
	endedAt: 1000,
	...extra,
});

describe("tool-phrases: frases en pasado por tool", () => {
	it("read: basename + líneas", () => {
		const r = toolPhrases(
			entry("read", { path: "src/providers/frida-enterprise/oauth.ts" }, {
				result: Array(213).fill("x").join("\n"),
			}),
		);
		expect(r.past).toContain("Leído");
		expect(r.past).toContain("oauth.ts");
		expect(r.subtitle).toContain("213 líneas");
	});

	it("bash: comando completo", () => {
		const r = toolPhrases(entry("bash", { command: "npm run typecheck" }));
		expect(r.past).toContain("Ejecutado");
		expect(r.past).toContain("npm run typecheck");
	});

	it("edit: basename (sin líneas +N)", () => {
		const r = toolPhrases(entry("edit", { path: "webview/App.tsx" }));
		expect(r.past).toContain("Editado");
		expect(r.past).toContain("App.tsx");
	});

	it("write: basename", () => {
		const r = toolPhrases(entry("write", { path: "docs/x.md" }));
		expect(r.past).toContain("Escrito");
	});

	it("grep: patrón entre comillas", () => {
		const r = toolPhrases(entry("grep", { pattern: "getApiKey" }));
		expect(r.past).toContain("getApiKey");
	});

	it("find: patrón", () => {
		const r = toolPhrases(entry("find", { pattern: "*.ts" }));
		expect(r.past).toContain("*.ts");
	});

	it("ls: basename de la ruta", () => {
		const r = toolPhrases(entry("ls", { path: "webview/components/" }));
		expect(r.past).toContain("Listado");
		expect(r.past).toContain("components");
	});

	it("todo: subject de la acción", () => {
		const r = toolPhrases(entry("todo", { action: "create", _subject: "Migrar UI" }));
		expect(r.past).toContain("Tarea");
		expect(r.past).toContain("Migrar UI");
	});

	it("web_fetch_md: url", () => {
		const r = toolPhrases(entry("web_fetch_md", { url: "https://x.dev/a" }));
		expect(r.past).toContain("Descargada");
		expect(r.past).toContain("https://x.dev/a");
	});

	it("lens: label legible del tool", () => {
		const r = toolPhrases(entry("symbol_search", { query: "buildFridaPayload" }));
		expect(r.past).toContain("Símbolos encontrados");
		expect(r.past).toContain("buildFridaPayload");
	});

	it("agent: descripción", () => {
		const r = toolPhrases(entry("agent", { description: "analiza el store" }));
		expect(r.past).toContain("Agente");
		expect(r.past).toContain("analiza el store");
	});

	it("desconocido: genérico con nombre del tool", () => {
		const r = toolPhrases(entry("custom_tool_x", {}));
		expect(r.past).toContain("custom_tool_x");
	});
});

describe("tool-phrases: running (gerundio + verbo para shimmer parcial)", () => {
	it("running = gerundio y el verbo queda marcado para el shimmer", () => {
		const r = toolPhrases(entry("read", { path: "src/a.ts" }, { state: "running" }));
		expect(r.running).toContain("Leyendo");
		expect(r.runningVerb).toBe("Leyendo");
	});

	it("runningParts separa verbo del resto (el resto NO brilla)", () => {
		const parts = runningPhraseParts(entry("read", { path: "src/a.ts" }, { state: "running" }));
		expect(parts.verb).toBe("Leyendo");
		expect(parts.rest).toContain("a.ts");
	});
});

describe("tool-phrases: subtítulo tabular", () => {
	it("incluye duración en ms/s", () => {
		const r = toolPhrases(entry("read", { path: "a.ts" }, { endedAt: 1318 }));
		expect(r.subtitle).toMatch(/1\.3s/);
	});
	it("read con offset muestra rango", () => {
		const r = toolPhrases(
			entry("read", { path: "a.ts", offset: 5 }, { result: Array(10).fill("x").join("\n") }),
		);
		expect(r.subtitle).toContain("5–14");
	});
	it("diff stats entran al subtítulo", () => {
		// "+a" "+c" "+d" = +3 · "-b" = -1 (las líneas +++/--- no cuentan)
		const r = toolPhrases(entry("edit", { path: "a.ts" }, { diff: "+a\n-b\n+c\n+d\n" }));
		expect(r.subtitle).toContain("+3");
		expect(r.subtitle).toContain("-1");
	});
});
