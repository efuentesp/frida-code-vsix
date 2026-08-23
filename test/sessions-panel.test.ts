import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionsPanel } from "../webview/components/SessionsPanel";
import type { SessionItem } from "../webview/types";

describe("SessionsPanel component (Propuesta 1: Copilot Chat History style)", () => {
	// Fechas relativas al DÍA CALENDARIO (no a horas corridas): correr la suite
	// entre 00:00 y 02:00 AM hacia que now-26h cayera dos días atrás y el grupo
	// "Ayer" nunca aparecía (flake reportado en #126).
	const now = Date.now();
	const hoyStart = new Date();
	hoyStart.setHours(0, 0, 0, 0);
	const ayer = hoyStart.getTime() - 1000 * 60 * 60 * 23; // = ayer 01:00 — siempre "Ayer"
	const sampleSessions: SessionItem[] = [
		{
			path: "/sessions/s1.jsonl",
			cwd: "/workspace/project-a",
			name: "Refactor UI Copilot",
			firstMessage: "ajustando contraste y barra de estado",
			messageCount: 14,
			modified: now - 1000 * 60 * 5, // hace 5 mins (Hoy)
			durationMs: 1000 * 60 * 25,
			inputTotal: 45000,
			outputTotal: 8000,
			// #107 — timing del header: activo (Σ turnos) + nº de turnos.
			activeMs: 1000 * 60 * 19,
			turnCount: 7,
			cost: 0.42,
		},
		{
			path: "/sessions/s2.jsonl",
			cwd: "/workspace/project-a",
			name: "Diagnóstico Error 400",
			firstMessage: "revisando buildFridaPayload",
			messageCount: 6,
			modified: ayer, // inicio de ayer +1h (Ayer) — robusto a la hora de corrida
			durationMs: 1000 * 60 * 12,
			inputTotal: 12000,
			outputTotal: 2500,
			activeMs: 1000 * 60 * 9,
			turnCount: 3,
		},
		{
			path: "/sessions/s3.jsonl",
			cwd: "/workspace/project-b",
			name: "Patrones /wf Lote 2",
			firstMessage: "implementando runner de workflows",
			messageCount: 30,
			modified: now - 1000 * 60 * 60 * 24 * 4, // hace 4 días (Últimos 7 días)
			durationMs: 1000 * 60 * 90,
			inputTotal: 85000,
			outputTotal: 14000,
			// Sin activeMs/turnCount → debe caer al chip legacy de reloj (pared).
		},
	];

	it("renderiza lista agrupada cronológicamente con buscador y tarjetas", () => {
		const onScopeChange = vi.fn();
		const onClose = vi.fn();
		const onSwitch = vi.fn();
		const onRename = vi.fn();
		const onDelete = vi.fn();
		const onNewSession = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(SessionsPanel, {
				sessions: {
					items: sampleSessions,
					currentPath: "/sessions/s1.jsonl",
				},
				scope: "project",
				onScopeChange,
				onClose,
				onSwitch,
				onRename,
				onDelete,
				onNewSession,
			}),
		);

		expect(html).toContain("Historial de Sesiones");
		expect(html).toContain("sessions-search-bar");
		expect(html).toContain("Hoy");
		expect(html).toContain("Ayer");
		expect(html).toContain("Últimos 7 días");
		expect(html).toContain("Refactor UI Copilot");
		expect(html).toContain("ACTUAL");
		expect(html).toContain("«ajustando contraste y barra de estado»");
		expect(html).toContain("Diagnóstico Error 400");
		expect(html).toContain("Patrones /wf Lote 2");
		expect(html).toContain("Nueva Sesión");
		expect(html).toContain("3 sesiones");
	});

	it("muestra el chip fusionado ⚡ activo·turnos con Σ en el pie y fallback al reloj legacy", () => {
		const html = renderToStaticMarkup(
			React.createElement(SessionsPanel, {
				sessions: {
					items: sampleSessions,
					currentPath: "/sessions/s1.jsonl",
				},
				scope: "project",
				onScopeChange: vi.fn(),
				onClose: vi.fn(),
				onSwitch: vi.fn(),
				onRename: vi.fn(),
				onDelete: vi.fn(),
			}),
		);

		// Sesiones con timing #107: chip fusionado «activo · Nt» (formatDuration
		// de 19min = "19m", 9min = "9m").
		expect(html).toContain("session-timing-chip");
		expect(html).toContain("19m · 7t");
		expect(html).toContain("9m · 3t");
		// Sesión pre-#107 (sin stats de turns): chip legacy de reloj (1h 30m pared).
		expect(html).toContain("1h 30m");
		// Σ del pie: 19m + 9m = 28m · 7t + 3t = 10t.
		expect(html).toContain("sessions-footer-total");
		expect(html).toContain("28m · 10t");
		// Controles de orden (recencia / actividad / turnos) presentes.
		expect(html).toContain("Más tiempo activo primero");
		expect(html).toContain("Más turnos primero");
	});

	it("renderiza etiqueta de proyecto cuando el scope es 'all'", () => {
		const html = renderToStaticMarkup(
			React.createElement(SessionsPanel, {
				sessions: {
					items: sampleSessions,
					currentPath: "/sessions/s1.jsonl",
				},
				scope: "all",
				onScopeChange: vi.fn(),
				onClose: vi.fn(),
				onSwitch: vi.fn(),
				onRename: vi.fn(),
				onDelete: vi.fn(),
			}),
		);

		expect(html).toContain("project-a");
		expect(html).toContain("project-b");
	});

	it("renderiza estado vacío cuando no hay sesiones", () => {
		const html = renderToStaticMarkup(
			React.createElement(SessionsPanel, {
				sessions: {
					items: [],
				},
				scope: "project",
				onScopeChange: vi.fn(),
				onClose: vi.fn(),
				onSwitch: vi.fn(),
				onRename: vi.fn(),
				onDelete: vi.fn(),
			}),
		);

		expect(html).toContain("Aún no hay sesiones guardadas en este proyecto");
	});
});
