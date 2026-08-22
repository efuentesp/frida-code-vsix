import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductivityTab } from "../webview/components/ProductivityTab";
import type { State, UsageReportView } from "../webview/types";

describe("ProductivityTab (#102 — Scorecard Multimarco DX AI × SPACE)", () => {
	const mockReport: UsageReportView = {
		kpis: {
			tokensIn: 1_200_000,
			tokensOut: 600_000,
			cacheRead: 900_000,
			cacheWrite: 300_000,
			cost: 1.24,
			sessions: 12,
			turns: 84,
			activeMs: 15_120_000, // 4.2h
			cacheHitPct: 78,
			avgTurnTokens: 21_428,
		},
		breakdowns: {
			byModel: [
				{
					model: "claude-3-5-sonnet",
					provider: "anthropic",
					tokens: 1_150_000,
					cost: 0.84,
					turns: 50,
				},
			],
			byProvider: [{ provider: "anthropic", tokens: 1_150_000, cost: 0.84 }],
			byTool: [
				{ tool: "read", count: 142, tokens: 480_000 },
				{ tool: "edit", count: 98, tokens: 310_000 },
				{ tool: "bash", count: 45, tokens: 120_000 },
			],
			byFileType: [
				{
					fileType: "TypeScript",
					family: "code",
					files: 15,
					edits: 45,
					tokens: 950_000,
					assistedKloc: 14.2,
				},
				{
					fileType: "CSS",
					family: "styles",
					files: 4,
					edits: 12,
					tokens: 320_000,
					assistedKloc: 4.5,
				},
				{
					fileType: "Markdown",
					family: "docs",
					files: 6,
					edits: 8,
					tokens: 180_000,
					assistedKloc: 1.8,
				},
			],
			byArtifact: [{ kind: "plan", count: 2 }],
			byDay: [
				{ date: "2026-08-21", tokens: 670_000, cost: 0.44, turns: 25 },
			],
			byHour: [
				0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 15, 20, 25, 30, 45, 40, 35, 25, 20, 10, 5, 0, 0, 0,
			], // peak at 14:00 (idx 14 = 45)
			byDow: Array(7).fill(25),
		},
		behavior: {
			compactations: 3,
			subagentsLaunched: 8,
			questionsAsked: 14,
		},
		adoption: {
			browserUsed: true,
			subagentsUsed: true,
			contextToolUsed: true,
		},
		sessions: [
			{
				path: "/path/to/session-1.jsonl",
				name: "Tab Entorno & Dependencias",
				firstMessage: "crea el tab de entorno",
				cwd: "/Users/dev/frida-code",
				firstTs: 1000,
				lastTs: 720000,
				tokensIn: 120_000,
				tokensOut: 60_000,
				cost: 0.12,
				turns: 18,
				assistedKloc: 1.4,
			},
		],
	};

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
		usageReport: {
			period: "30d",
			scope: "project",
			periodFrom: 0,
			periodTo: Date.now(),
			report: mockReport,
		},
	};

	it("renderiza el Scorecard Multimarco con los 3 pilares DX AI", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ProductivityTab, { state: baseState, post }),
		);

		expect(html).toContain("productivity-tab");
		expect(html).toContain("SCORECARD MULTIMARCO (DX AI × SPACE)");

		// Pilar 1: Utilización
		expect(html).toContain("UTILIZACIÓN (DX AI)");
		expect(html).toContain("100%");
		expect(html).toContain("Adopción de capacidades");
		expect(html).toContain("3 de 3 capacidades activas");

		// Pilar 2: Impacto
		expect(html).toContain("IMPACTO &amp; THROUGHPUT");
		expect(html).toContain("21k lin"); // 14.2 + 4.5 + 1.8 = 20.5 -> 21k
		expect(html).toContain("84 turnos en 12 sesiones");

		// Pilar 3: Costo & Eficiencia
		expect(html).toContain("COSTO &amp; EFICIENCIA");
		expect(html).toContain("$1.24");
		expect(html).toContain("78% Cache Hit");
	});

	it("renderiza la barra de cobertura de dimensiones SPACE con sus estados", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ProductivityTab, { state: baseState, post }),
		);

		expect(html).toContain("Cobertura de dimensiones del framework SPACE:");
		expect(html).toContain("Activity (100%)");
		expect(html).toContain("Efficiency &amp; Flow (100%)");
		expect(html).toContain("Performance (~60%)");
		expect(html).toContain("Satisfaction (Encuesta)");
		expect(html).toContain("Communication (Org)");
	});

	it("renderiza la sección El Agente como Equipo (DX Agent Lead Model)", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ProductivityTab, { state: baseState, post }),
		);

		expect(html).toContain("EL AGENTE COMO EQUIPO (DX AGENT LEAD MODEL)");
		expect(html).toContain("8"); // subagents
		expect(html).toContain("14"); // questions HITL
		expect(html).toContain("3"); // compactations
		expect(html).toContain("7.0"); // 84 / 12 = 7.0 turns/ses

		// Capabilities
		expect(html).toContain("Navegador Web (`agent_browser`)");
		expect(html).toContain("Búsqueda Semántica (`codebase-index`)");
		expect(html).toContain("Subagentes Autónomos (`Agent`)");
		expect(html).toContain("Dictado por Voz");
		expect(html).toContain("Próximo (#95)");
	});

	it("renderiza la sección de Ritmo y Flow con hora pico de actividad", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ProductivityTab, { state: baseState, post }),
		);

		expect(html).toContain("RITMO DE DESARROLLO &amp; FLOW (SPACE-E)");
		expect(html).toContain("4.2h");
		expect(html).toContain("21k");
		expect(html).toContain("14:00 hrs"); // peakHour
	});

	it("renderiza la tarjeta de preparación DORA y botón de exportar telemetría", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ProductivityTab, { state: baseState, post }),
		);

		expect(html).toContain("PREPARACIÓN DORA &amp; FLOW FRAMEWORK (EXPORT)");
		expect(html).toContain("«Frida etiqueta telemetría; el concentrador externo cruza»");
		expect(html).toContain("frida-usage-report/v1");
		expect(html).toContain("Copiar JSON Telemetría (v1)");
	});

	it("renderiza estado de carga cuando no hay datos", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			usageReport: undefined,
		};
		const html = renderToStaticMarkup(
			React.createElement(ProductivityTab, { state, post }),
		);

		expect(html).toContain("Cargando scorecard de productividad...");
	});

	it("renderiza estado vacío cuando no hay sesiones en el periodo", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			usageReport: {
				period: "30d",
				scope: "project",
				periodFrom: 0,
				periodTo: Date.now(),
				report: {
					...mockReport,
					kpis: {
						...mockReport.kpis,
						sessions: 0,
					},
				},
			},
		};
		const html = renderToStaticMarkup(
			React.createElement(ProductivityTab, { state, post }),
		);

		expect(html).toContain("Sin datos de telemetría de este proyecto en este periodo todavía.");
	});
});
