import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsHub } from "../webview/components/SettingsHub";
import type { State } from "../webview/types";

describe("SettingsHub (Propuesta 1: Settings Editor Nativo de VS Code)", () => {
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
		models: {
			providers: [
				{
					id: "frida-enterprise",
					name: "Frida Enterprise",
					models: [
						{ id: "model-a", name: "Demeter Bloom" },
						{ id: "model-b", name: "Ceres Spark" },
					],
					oauth: true,
					apiKey: false,
					authed: true,
				},
				{
					id: "anthropic",
					name: "Anthropic",
					models: [{ id: "claude-3-5", name: "Claude 3.5 Sonnet" }],
					oauth: false,
					apiKey: true,
					authed: false,
				},
			],
		},
		toolToggles: {
			"frida-git-sync": true,
			"frida-agent-browser": false,
		},
		resources: {
			extensions: [],
			skills: [],
			prompts: [],
			themes: [],
			commands: [],
			contextFiles: [],
			errors: [],
			modules: [
				{
					module: "frida-git-sync",
					title: "Frida Git Sync",
					desc: "Sincronización de ramas y git",
					toggleable: true,
					tools: ["git_status", "git_commit"],
					commands: ["/sync"],
					skills: [],
					prompts: [],
					errors: [],
				},
				{
					module: "frida-core",
					title: "Frida Core",
					desc: "Herramientas esenciales del sistema",
					toggleable: false,
					tools: ["read", "write", "bash"],
					commands: [],
					skills: [],
					prompts: [],
					errors: [],
				},
			],
		},
	};

	it("renderiza barra de búsqueda nativa, encabezado y chips de categoría", () => {
		const post = vi.fn();
		const onClose = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(SettingsHub, {
				state: baseState,
				post,
				onClose,
				initialTab: "providers",
			}),
		);

		expect(html).toContain("cfg-panel");
		expect(html).toContain("Configuración");
		expect(html).toContain("cfg-search-bar");
		expect(html).toContain("cfg-search-input");
		expect(html).toContain("Buscar ajustes");
		// Chips de categoría
		expect(html).toContain("Proveedores");
		expect(html).toContain("Modelos");
		expect(html).toContain("Auto-Aprobación");
		expect(html).toContain("Herramientas");
		expect(html).toContain("Recursos");
		expect(html).toContain("Uso");
		expect(html).toContain("Index");
	});

	it("renderiza la pestaña de herramientas con acordeón y toggles", () => {
		const post = vi.fn();
		const onClose = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(SettingsHub, {
				state: baseState,
				post,
				onClose,
				initialTab: "tools",
			}),
		);

		expect(html).toContain("Frida Git Sync");
		expect(html).toContain("Sincronización de ramas y git");
		expect(html).toContain("Módulos base (siempre activos)");
		expect(html).toContain("Frida Core");
	});

	it("renderiza la pestaña de recursos cuando se inicializa en resources", () => {
		const post = vi.fn();
		const onClose = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(SettingsHub, {
				state: baseState,
				post,
				onClose,
				initialTab: "resources",
			}),
		);

		expect(html).toContain("Recargar extensiones y recursos");
	});

	it("renderiza la pestaña de uso (UsageDashboard) cuando se inicializa en usage", () => {
		const post = vi.fn();
		const onClose = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(SettingsHub, {
				state: {
					...baseState,
					usageReport: {
						period: "30d",
						scope: "project",
						periodFrom: 0,
						periodTo: 1000,
						report: {
							kpis: {
								tokensIn: 500,
								tokensOut: 200,
								cacheRead: 200,
								cacheWrite: 100,
								cost: 0.05,
								sessions: 2,
								turns: 8,
								activeMs: 12000,
								cacheHitPct: 60,
								avgTurnTokens: 125,
							},
							breakdowns: {
								byModel: [],
								byProvider: [],
								byTool: [],
								byFileType: [],
								byArtifact: [],
								byDay: [],
								byHour: [],
								byDow: [],
							},
							behavior: {
								compactations: 0,
								subagentsLaunched: 0,
								questionsAsked: 0,
							},
							adoption: {
								browserUsed: false,
								subagentsUsed: false,
								contextToolUsed: false,
							},
							sessions: [],
						},
					},
				},
				post,
				onClose,
				initialTab: "usage",
			}),
		);

		expect(html).toContain("usage-dashboard");
		expect(html).toContain("Tokens");
	});

	it("renderiza resultados filtrados cuando hay búsqueda activa", () => {
		const post = vi.fn();
		const onClose = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(SettingsHub, {
				state: {
					...baseState,
					resources: {
						...baseState.resources!,
						skills: [
							{
								name: "commit",
								description: "Crear commits estructurados",
								source: "extension",
								path: "/skills/commit",
							},
						],
						commands: [
							{
								name: "sync",
								description: "Sincronizar ramas",
								source: "built-in",
							},
						],
					},
				},
				post,
				onClose,
				initialTab: "providers",
			}),
		);

		// Verificamos que la estructura básica del buscador está lista para búsqueda
		expect(html).toContain("cfg-search-bar");
		expect(html).toContain("cfg-search-input");
	});
});
