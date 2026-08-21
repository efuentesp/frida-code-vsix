import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionsPanel } from "../webview/components/SessionsPanel";
import type { SessionItem } from "../webview/types";

describe("SessionsPanel component (Propuesta 1: Copilot Chat History style)", () => {
	const now = Date.now();
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
		},
		{
			path: "/sessions/s2.jsonl",
			cwd: "/workspace/project-a",
			name: "Diagnóstico Error 400",
			firstMessage: "revisando buildFridaPayload",
			messageCount: 6,
			modified: now - 1000 * 60 * 60 * 26, // hace 26h (Ayer)
			durationMs: 1000 * 60 * 12,
			inputTotal: 12000,
			outputTotal: 2500,
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
