import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAutoIndexProgress } from "../src/tools/frida-codebase-index/progress";
import {
	IndexTab,
	StopIndexDialog,
	EmbeddingsEngine,
	EmbeddingsChangeDialog,
} from "../webview/components/IndexTab";
import type { CodebaseIndexUiState, State } from "../webview/types";

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
		// #117 — el comando de descarga vive en el botón copiable de la tarjeta
		expect(html).toContain("ollama pull…");
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
		expect(
			parseAutoIndexProgress("Indexed chunks: 1,204\nProvider: openai"),
		).toBeNull();
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

	it("#111 — el reloj deriva de busySince del store: elapsed inmediato sin reiniciarse en remount", () => {
		const post = vi.fn();
		const since = Date.now() - 125_000; // lleva 2m5s indexando
		const state: State = {
			...baseState,
			codebaseIndex: {
				installed: true,
				busy: "index",
				busySince: since,
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		// El primer render ya refleja el tiempo acumulado (no 0:00) — así, al
		// volver de otra pestaña, el reloj retoma donde iba en vez de reiniciarse.
		const m = html.match(/Tiempo:\s*<strong>([\d:]+)<\/strong>/);
		expect(m).toBeTruthy();
		const [mm, ss] = (m?.[1] ?? "").split(":").map(Number);
		const secs = mm * 60 + ss;
		expect(secs).toBeGreaterThanOrEqual(124);
		expect(secs).toBeLessThanOrEqual(127);
	});

	it("#112 — sección Archivos indexados: conteo, filas y fallidos", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: { installed: true, version: "0.23.0" },
			codebaseIndexFiles: {
				available: true,
				files: [
					{ path: "src/extension.ts", chunks: 142, language: "typescript" },
					{ path: "webview/App.tsx", chunks: 38, language: "typescriptreact" },
				],
				failed: [{ path: "docs/g.md", chunks: 48 }],
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("ARCHIVOS EN EL ÍNDICE");
		expect(html).toContain("Archivos indexados <strong>(2)</strong>");
		expect(html).toContain("src/extension.ts");
		expect(html).toContain("142");
		expect(html).toContain("typescript");
		expect(html).toContain("Fallidos en embedding");
		expect(html).toContain("docs/g.md");
	});

	it("#112 — sin índice construido: guía honesta", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: { installed: true },
			codebaseIndexFiles: { available: false, files: [], failed: [] },
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("Sin índice construido");
	});

	it("#113 — botón Detener visible solo durante index/rebuild (no install)", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: {
				installed: true,
				busy: "index",
				busySince: Date.now() - 60_000,
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("Detener");
	});

	it("#113 — sin botón Detener durante install ni sin busy", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(IndexTab, {
				state: {
					...baseState,
					codebaseIndex: { installed: false, busy: "install" },
				},
				post,
			}),
		);
		expect(html).not.toContain("ci-stop-btn");
	});

	it("#114 — banner muestra proveedor/modelo REAL del índice cuando existe", () => {
		// indexMeta: campo de CodebaseIndexUiState (webview/types.ts) leído de
		// la metadata real del índice por el host (refreshCiIndexMeta).
		const post = vi.fn();
		const state: State = {
			...baseState,
			codebaseIndex: {
				installed: true,
				version: "0.23.0",
				config: { provider: "auto" },
				indexMeta: {
					provider: "github-copilot",
					model: "text-embedding-3-small",
					dimensions: 1536,
				},
			},
		};

		const html = renderToStaticMarkup(
			React.createElement(IndexTab, { state, post }),
		);

		expect(html).toContain("GitHub Copilot · text-embedding-3-small");
		expect(html).toContain("1536d");
		// Nota Auto: el setting era auto pero el índice resolvió a Copilot
		expect(html).toContain("Auto resolvió a GitHub Copilot");
	});

	it("#114 — sin metadata del índice: banner conserva la etiqueta del setting", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(IndexTab, {
				state: {
					...baseState,
					codebaseIndex: {
						installed: true,
						version: "0.23.0",
						config: { provider: "auto" },
					},
				},
				post,
			}),
		);
		expect(html).toContain("Auto (Ollama/OpenAI)");
	});

	it("#115 — sin metadata + chunks fallidos acumulados: pendiente de confirmar con advertencia", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(IndexTab, {
				state: {
					...baseState,
					codebaseIndex: {
						installed: true,
						version: "0.23.0",
						config: { provider: "auto" },
					},
					codebaseIndexFiles: {
						available: true,
						files: [],
						failed: [
							{ path: "docs/g.md", chunks: 48 },
							{ path: "CLAUDE.md", chunks: 16 },
						],
					},
				},
				post,
			}),
		);
		// Estado honesto — NO la etiqueta engañosa del setting
		expect(html).toContain("pendiente de confirmar");
		expect(html).toContain("los embeddings están fallando");
		expect(html).not.toContain("Auto (Ollama/OpenAI)");
	});

	it("#115 — sin metadata + corrida activa sin confirmaciones (chunks 0/N): advertencia", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(IndexTab, {
				state: {
					...baseState,
					codebaseIndex: {
						installed: true,
						busy: "index",
						busySince: Date.now() - 300_000,
						progress: {
							phase: "embedding",
							percentage: 20,
							filesProcessed: 218,
							totalFiles: 218,
							chunksProcessed: 0,
							totalChunks: 64,
						},
						config: { provider: "auto" },
					},
				},
				post,
			}),
		);
		expect(html).toContain("pendiente de confirmar");
		expect(html).not.toContain("Auto (Ollama/OpenAI)");
	});

	it("#115 — sin índice en absoluto (available false, sin fallidos): etiqueta del setting", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(IndexTab, {
				state: {
					...baseState,
					codebaseIndex: {
						installed: true,
						config: { provider: "auto" },
					},
					codebaseIndexFiles: { available: false, files: [], failed: [] },
				},
				post,
			}),
		);
		expect(html).toContain("Auto (Ollama/OpenAI)");
	});

	describe("EmbeddingsEngine — tarjetas de proveedor (#117 Fase B)", () => {
		const noop = () => {};
		const mkCi = (
			over: Partial<CodebaseIndexUiState> = {},
		): CodebaseIndexUiState => ({
			installed: true,
			config: {
				provider: "ollama",
				enterpriseAuthed: false,
				openaiAuthed: false,
				fridaEnterpriseModel: "azure-embeddings-default",
				ollamaModel: "nomic-embed-text",
				openaiModel: "text-embedding-3-small",
			},
			...over,
		});

		it("semáforos: enterprise warn sin sesión, openai error sin key, activo en ollama", () => {
			const html = renderToStaticMarkup(
				React.createElement(EmbeddingsEngine, {
					ci: mkCi(),
					locking: false,
					onPing: noop,
					onSelect: noop,
					onLogin: noop,
					onCopyOllama: noop,
					copiedOllama: false,
					onOpenChangeDialog: noop,
				}),
			);
			expect(html).toContain("Requiere iniciar sesión");
			expect(html).toContain("is-warn"); // enterprise
			expect(html).toContain("Sin API key");
			expect(html).toContain("is-error"); // openai
			expect(html).toContain("Iniciar sesión"); // botón login enterprise
			expect(html).toContain("Activo"); // ollama seleccionado
			expect(html).toContain("Probar conexión");
		});

		it("ping ok: resultado inline con latencia y dimensions", () => {
			const html = renderToStaticMarkup(
				React.createElement(EmbeddingsEngine, {
					ci: mkCi(),
					ping: {
						provider: "ollama",
						ok: true,
						latencyMs: 85,
						dimensions: 768,
					},
					locking: false,
					onPing: noop,
					onSelect: noop,
					onLogin: noop,
					onCopyOllama: noop,
					copiedOllama: false,
					onOpenChangeDialog: noop,
				}),
			);
			expect(html).toContain("85ms");
			expect(html).toContain("768d");
			expect(html).toContain("is-ok");
		});

		it("candado: con indexMeta muestra bloqueo y selectores disabled", () => {
			const html = renderToStaticMarkup(
				React.createElement(EmbeddingsEngine, {
					ci: mkCi({
						indexMeta: {
							provider: "github-copilot",
							model: "text-embedding-3-small",
							dimensions: 1536,
						},
					}),
					locking: true,
					onPing: noop,
					onSelect: noop,
					onLogin: noop,
					onCopyOllama: noop,
					copiedOllama: false,
					onOpenChangeDialog: noop,
				}),
			);
			expect(html).toContain("🔒 Bloqueado");
			expect(html).toContain("GitHub Copilot · text-embedding-3-small");
			expect(html).toContain("Cambiar motor de embeddings…");
			expect(html).toContain('<select class="bar-select" disabled="">');
		});
	});

	describe("EmbeddingsChangeDialog — modal de reconstrucción (#117 Fase B)", () => {
		it("comparativa Actual→Nuevo + advertencia de invalidación + acciones", () => {
			const html = renderToStaticMarkup(
				React.createElement(EmbeddingsChangeDialog, {
					current: {
						provider: "github-copilot",
						model: "text-embedding-3-small",
					},
					target: { provider: "ollama", model: "nomic-embed-text" },
					onConfirm: () => {},
					onCancel: () => {},
				}),
			);
			expect(html).toContain("Actual");
			expect(html).toContain("GitHub Copilot · text-embedding-3-small");
			expect(html).toContain("Nuevo");
			expect(html).toContain("Ollama Local · nomic-embed-text");
			expect(html).toContain("invalidará los vectores existentes");
			expect(html).toContain("reconstrucción total");
			expect(html).toContain("Cambiar y Reconstruir Índice");
			expect(html).toContain("Cancelar");
		});
	});

	it("#113 — el diálogo de confirmación explica recarga e incrementalidad", () => {
		const html = renderToStaticMarkup(
			React.createElement(StopIndexDialog, {
				onConfirm: () => {},
				onCancel: () => {},
			}),
		);
		expect(html).toContain("recargará la ventana");
		expect(html).toContain("retomará desde donde quedó");
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
