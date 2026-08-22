import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAutoIndexProgress } from "../src/tools/frida-codebase-index/progress";
import { IndexTab } from "../webview/components/IndexTab";
import type { State } from "../webview/types";

describe("IndexTab (Opción 1: Semantic Search Engine & Health Matrix)", () => {
	const baseState: State = {
		keyNeeded: false,
		busy: false,
		mode: "manual",
		turns: [],
		approvals: [],
		modelChanges: [],
		uiRequests: [],
		queued: [],
		isCompacting: false,
		compactions: [],
		branchSummaries: [],
		nextId: 1,
	};

	it("renderiza banner no-instalado con botón de instalación y tools en espera", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: {
				installed: false,
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("ci-banner");
		expect(html).toContain("Paquete No Instalado");
		expect(html).toContain("Instalar paquete");
		expect(html).toContain("6 tools del agente esperando");
		expect(html).toContain("semantic_search");
		expect(html).toContain("call_graph");
		expect(html).toContain("is-disabled");
	});

	it("renderiza banner listo y operativo con paquete, motor y 6 tools activas", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: {
				installed: true,
				version: "0.23.0",
				config: {
					provider: "ollama",
				},
				capturedTools: [
					"semantic_search",
					"semantic_context",
					"call_graph",
					"implementation_lookup",
					"index_codebase",
					"index_status",
				],
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("Listo y Operativo");
		expect(html).toContain("open-codebase-index@0.23.0");
		expect(html).toContain("Ollama Local");
		expect(html).toContain("6 tools activas para el agente");
		expect(html).toContain("Re-indexar");
		expect(html).toContain("Reconstruir desde Cero");
		expect(html).toContain("Ver Diagnóstico y Salud");
		expect(html).toContain("ollama pull nomic-embed-text");
		expect(html).toContain("is-active");
	});

	it("renderiza barra de progreso y reloj cuando busy es activo", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: {
				installed: false,
				busy: "install",
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("ci-busy-card");
		expect(html).toContain("ci-busy-bar");
		expect(html).toContain(
			"Descargando e instalando el paquete open-codebase-index",
		);
		expect(html).toContain("Instalando…");
	});

	it("renderiza caja de log cuando hay lastLine y no está ocupado", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: {
				installed: true,
				version: "0.23.0",
				lastLine:
					"Workspace indexado sin errores. 142 archivos procesados en 3.4s.",
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("ci-log-box");
		expect(html).toContain(
			"Workspace indexado sin errores. 142 archivos procesados en 3.4s.",
		);
	});

	it("#109 — parser de progreso: línea válida, sin progreso y números con coma", () => {
		const p = parseAutoIndexProgress(
			"Auto-index: disabled (state: indexing)\nAuto-index progress: embedding 45% (120/266 files, 1,540/3,404 chunks)",
		);
		expect(p).toEqual({
			phase: "embedding",
			percentage: 45,
			filesProcessed: 120,
			totalFiles: 266,
			chunksProcessed: 1540,
			totalChunks: 3404,
		});
		expect(parseAutoIndexProgress("Indexed chunks: 1,204\nProvider: openai")).toBeNull();
		expect(parseAutoIndexProgress("")).toBeNull();
		// clamping de porcentaje fuera de rango
		expect(
			parseAutoIndexProgress(
				"Auto-index progress: parsing 120% (5/4 files, 0/0 chunks)",
			)?.percentage,
		).toBe(100);
	});

	it("#109 — tarjeta de progreso determinada: %, contadores y fase durante index", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: {
				installed: true,
				busy: "index",
				progress: {
					phase: "embedding",
					percentage: 45,
					filesProcessed: 120,
					totalFiles: 266,
					chunksProcessed: 500,
					totalChunks: 1100,
				},
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("45%");
		expect(html).toContain("120/266");
		expect(html).toContain("500/1,100");
		expect(html).toContain("Fase: vectorizando");
		expect(html).toContain('aria-valuenow="45"');
	});

	it("#109 — sin datos del coordinador: barra indeterminada y contadores en —", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: { installed: true, busy: "index", progress: null },
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("ci-busy-bar");
		expect(html).not.toContain("aria-valuenow");
		expect(html).toContain("—/—");
	});
});
