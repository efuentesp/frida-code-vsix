/**
 * Paridad del registro central de toggles (issue #53).
 *
 * TOOL_TOGGLES (src/tool-toggles.ts) es la fuente única de verdad de qué
 * módulos son conmutables. Este test evita el drift: todo setting del
 * registro debe existir en contributes.configuration de package.json con
 * default true, las keys deben ser únicas, y los toggles históricos
 * (askUserQuestion/todo/context/…) no deben perderse.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_TOGGLES, TOOL_TOGGLE_BY_KEY } from "../src/tool-toggles";

interface PkgConfig {
	contributes: {
		configuration:
			| { properties: Record<string, { default?: unknown }> }
			| { properties: Record<string, { default?: unknown }> }[];
	};
}

const pkg = JSON.parse(
	readFileSync(resolve(__dirname, "../package.json"), "utf-8"),
) as PkgConfig;

/** Aplana contributes.configuration (objeto o lista) → mapa de propiedades. */
function configProps(): Record<string, { default?: unknown }> {
	const cfg = pkg.contributes.configuration;
	if (Array.isArray(cfg)) {
		return Object.assign({}, ...cfg.map((c) => c.properties));
	}
	return cfg.properties;
}

describe("tool-toggles ↔ package.json (#53)", () => {
	it("cada toggle del registro existe en contributes.configuration con default true", () => {
		const props = configProps();
		for (const t of TOOL_TOGGLES) {
			const key = `frida.${t.setting}`;
			expect(props, `falta ${key} en package.json`).toHaveProperty(key);
			expect(props[key].default, `${key} debe tener default true`).toBe(true);
		}
	});

	it("keys y settings son únicos", () => {
		const keys = TOOL_TOGGLES.map((t) => t.key);
		expect(new Set(keys).size).toBe(keys.length);
		const settings = TOOL_TOGGLES.map((t) => t.setting);
		expect(new Set(settings).size).toBe(settings.length);
	});

	it("el mapa BY_KEY cubre todo el registro", () => {
		expect(TOOL_TOGGLE_BY_KEY.size).toBe(TOOL_TOGGLES.length);
		for (const t of TOOL_TOGGLES) {
			expect(TOOL_TOGGLE_BY_KEY.get(t.key)).toBe(t);
		}
	});

	it("conserva los toggles históricos (fase 1 completa)", () => {
		const esperados = [
			"askUserQuestion",
			"todo",
			"context",
			"codebaseIndex",
			"hermesMemory",
			"knowledgeBase",
			"ccPlugins",
			"sandboxes",
		];
		for (const k of esperados) {
			expect(TOOL_TOGGLE_BY_KEY.has(k), `falta ${k}`).toBe(true);
		}
	});

	it("los 7 gates nuevos de fase 2 están en el registro", () => {
		const esperados = [
			"subagents",
			"agentBrowser",
			"supiWeb",
			"mcpAdapter",
			"extensibleWorkflows",
			"gitSync",
			"worktree",
		];
		for (const k of esperados) {
			expect(TOOL_TOGGLE_BY_KEY.has(k), `falta ${k}`).toBe(true);
		}
	});

	it("todo descriptor tiene título y descripción no vacíos", () => {
		for (const t of TOOL_TOGGLES) {
			expect(t.title.trim().length).toBeGreaterThan(0);
			expect(t.desc.trim().length).toBeGreaterThan(0);
		}
	});
});
