import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
});
