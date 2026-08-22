import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageDashboard } from "../webview/components/UsageDashboard";
import type { State, UsageReportView } from "../webview/types";

describe("UsageDashboard (#101 — Opción 2: Developer Velocity & Telemetry Stream)", () => {
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
				{
					model: "gemini-2.0-flash",
					provider: "google",
					tokens: 400_000,
					cost: 0.28,
					turns: 20,
				},
				{
					model: "gpt-4o",
					provider: "openai",
					tokens: 250_000,
					cost: 0.12,
					turns: 14,
				},
			],
			byProvider: [
				{ provider: "anthropic", tokens: 1_150_000, cost: 0.84 },
				{ provider: "google", tokens: 400_000, cost: 0.28 },
				{ provider: "openai", tokens: 250_000, cost: 0.12 },
			],
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
					fileType: "CSS / Styles",
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
			byArtifact: [
				{ kind: "plan", count: 2 },
				{ kind: "research", count: 1 },
			],
			byDay: [
				{ date: "2026-08-19", tokens: 450_000, cost: 0.32, turns: 24 },
				{ date: "2026-08-20", tokens: 680_000, cost: 0.48, turns: 35 },
				{ date: "2026-08-21", tokens: 670_000, cost: 0.44, turns: 25 },
			],
			byHour: Array(24).fill(10),
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
			{
				path: "/path/to/session-2.jsonl",
				firstMessage: "arregla la doble ventana de confirmacion",
				cwd: "/Users/dev/frida-code",
				firstTs: 2000,
				lastTs: 360000,
				tokensIn: 40_000,
				tokensOut: 24_000,
				cost: 0.05,
				turns: 8,
				assistedKloc: 0.6,
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

	it("renderiza el banner ejecutivo de velocidad y telemetría", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(UsageDashboard, { state: baseState, post }),
		);

		expect(html).toContain("usage-velocity-banner");
		expect(html).toContain("Velocidad y Telemetría de Desarrollo");
		expect(html).toContain("Código Asistido:");
		expect(html).toContain("21k líneas"); // 14.2k + 4.5k + 1.8k = 20.5k -> fmt => 21k
		expect(html).toContain("1.8M");
		expect(html).toContain("$1.24 USD");
		expect(html).toContain("Cache Hit: 78%");
		expect(html).toContain("4.2h activo");
	});

	it("renderiza las 6 tarjetas KPI clave", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(UsageDashboard, { state: baseState, post }),
		);

		expect(html).toContain("usage-kpis");
		expect(html).toContain("Tokens ↑↓");
		expect(html).toContain("Costo Est.");
		expect(html).toContain("Código Asistido");
		expect(html).toContain("Sesiones / Turnos");
		expect(html).toContain("12 ses / 84 tur");
		expect(html).toContain("Cache Hit");
		expect(html).toContain("Tiempo Activo");
	});

	it("renderiza las 4 secciones temáticas de analítica", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(UsageDashboard, { state: baseState, post }),
		);

		// Sección 1: Ritmo y Actividad
		expect(html).toContain("RITMO Y ACTIVIDAD EN EL TIEMPO");
		expect(html).toContain("Consumo de tokens por día");
		expect(html).toContain("Actividad por hora y día de la semana");

		// Sección 2: Impacto en Código y Herramientas
		expect(html).toContain("IMPACTO EN EL CÓDIGO Y HERRAMIENTAS");
		expect(html).toContain("Código asistido por tipo de archivo");
		expect(html).toContain("TypeScript");
		expect(html).toContain("Top herramientas invocadas");
		expect(html).toContain("read");
		expect(html).toContain("142 llamadas");

		// Sección 3: Modelos y Adopción
		expect(html).toContain("MODELOS UTILIZADOS Y ADOPCIÓN");
		expect(html).toContain("Distribución por modelo");
		expect(html).toContain("Adopción de capacidades avanzadas");
		expect(html).toContain("8 lanzados");
		expect(html).toContain("14 preguntas");
		expect(html).toContain("3 podas");

		// Sección 4: Sesiones Recientes
		expect(html).toContain("SESIONES RECIENTES DE DESARROLLO");
		expect(html).toContain("Tab Entorno &amp; Dependencias");
		expect(html).toContain("18 turnos");
		expect(html).toContain("180k tokens");
		expect(html).toContain("arregla la doble ventana de confirmacion");
	});

	it("renderiza estado de carga cuando no hay reporte disponible", () => {
		const post = vi.fn();
		const state: State = {
			...baseState,
			usageReport: undefined,
		};
		const html = renderToStaticMarkup(
			React.createElement(UsageDashboard, { state, post }),
		);

		expect(html).toContain("Cargando telemetría de uso...");
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
			React.createElement(UsageDashboard, { state, post }),
		);

		expect(html).toContain("Sin datos de uso de este proyecto en este periodo todavía.");
	});
});
