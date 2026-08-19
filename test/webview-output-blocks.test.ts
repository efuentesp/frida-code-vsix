import { describe, expect, it } from "vitest";
import {
	buildOutputBlocks,
	OUTPUT_MAX_LINES,
	diffStats,
	needsMore,
	type OutputBlock,
} from "../webview/output-blocks";
import type { ToolEntry } from "../webview/types";

/** ToolEntry mínima para pruebas (sólo los campos que output-blocks lee). */
function entry(p: Partial<ToolEntry> & { tool: string }): ToolEntry {
	return {
		args: {},
		state: "ok",
		startedAt: 0,
		endedAt: 1,
		...p,
	} as ToolEntry;
}

describe("webview/output-blocks — codeblock Copilot (F2 P2)", () => {
	it("OUTPUT_MAX_LINES es 13 (§5.2)", () => {
		expect(OUTPUT_MAX_LINES).toBe(13);
	});

	it("salida corta: un bloque code sin clamp ni ver-más", () => {
		const blocks = buildOutputBlocks(entry({ tool: "read", result: "a\nb\nc" }));
		expect(blocks).toHaveLength(1);
		const b = blocks[0] as Extract<OutputBlock, { kind: "code" }>;
		expect(b.kind).toBe("code");
		expect(b.lines).toEqual(["a", "b", "c"]);
		expect(needsMore(blocks)).toBe(false);
	});

	it("salida larga: clamp a 13 líneas + needsMore", () => {
		const many = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
		const blocks = buildOutputBlocks(entry({ tool: "grep", result: many }));
		const b = blocks[0] as Extract<OutputBlock, { kind: "code" }>;
		expect(b.lines).toHaveLength(13);
		expect(b.totalLines).toBe(40);
		expect(needsMore(blocks)).toBe(true);
	});

	it("tool con diff: bloque diff con líneas coloreables y conteo +/-", () => {
		const diff = "@@ -1 +1 @@\n-linea vieja\n+linea nueva\n contexto";
		const blocks = buildOutputBlocks(entry({ tool: "edit", diff }));
		expect(blocks.some((x) => x.kind === "diff")).toBe(true);
		const d = blocks.find((x) => x.kind === "diff") as Extract<
			OutputBlock,
			{ kind: "diff" }
		>;
		expect(d.lines).toEqual(["@@ -1 +1 @@", "-linea vieja", "+linea nueva", " contexto"]);
		const s = diffStats(diff);
		expect(s).toEqual({ added: 1, removed: 1 });
	});

	it("bash → bloque terminal (usa fondo de terminal)", () => {
		const blocks = buildOutputBlocks(entry({ tool: "bash", result: "$ cmd\nok" }));
		expect(blocks[0]?.kind).toBe("terminal");
	});

	it("diff largo también se clampa a 13", () => {
		const diff = Array.from({ length: 30 }, (_, i) => `+l${i}`).join("\n");
		const blocks = buildOutputBlocks(entry({ tool: "edit", diff }));
		const d = blocks.find((x) => x.kind === "diff") as Extract<
			OutputBlock,
			{ kind: "diff" }
		>;
		expect(d.lines).toHaveLength(13);
		expect(d.totalLines).toBe(30);
		expect(needsMore(blocks)).toBe(true);
	});

	it("sin result ni diff → sin bloques (nada que renderizar)", () => {
		expect(buildOutputBlocks(entry({ tool: "read" }))).toEqual([]);
	});

	it("línea final sin \\n no genera línea fantasma vacía", () => {
		const blocks = buildOutputBlocks(entry({ tool: "read", result: "a\nb" }));
		const b = blocks[0] as Extract<OutputBlock, { kind: "code" }>;
		expect(b.lines).toEqual(["a", "b"]);
	});

	it("result vacío '' → sin bloques", () => {
		expect(buildOutputBlocks(entry({ tool: "read", result: "" }))).toEqual([]);
	});

	it("clamp preserva el INICIO (fade inferior + ver más, no head/tail)", () => {
		const many = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
		const blocks = buildOutputBlocks(entry({ tool: "ls", result: many }));
		const b = blocks[0] as Extract<OutputBlock, { kind: "code" }>;
		expect(b.lines[0]).toBe("l0");
		expect(b.lines[12]).toBe("l12");
	});
});
