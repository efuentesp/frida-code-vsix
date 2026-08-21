import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Statusline } from "../webview/components/Statusline";

describe("Statusline component (Propuesta 1: VS Code Native Statusline)", () => {
	it("renderiza carpeta de trabajo con tooltip de ruta completa y rama git con diff", () => {
		const html = renderToStaticMarkup(
			React.createElement(Statusline, {
				ws: {
					cwd: "/Users/dev/project/subfolder",
					branch: "main",
					dirty: true,
					diff: { added: 3, modified: 1, deleted: 0 },
				},
			}),
		);
		expect(html).toContain("statusline");
		expect(html).toContain("subfolder");
		expect(html).toContain('title="/Users/dev/project/subfolder"');
		expect(html).toContain("main");
		expect(html).toContain("+3 ~1");
	});

	it("renderiza badge de worktree cuando está en checkout vinculado", () => {
		const html = renderToStaticMarkup(
			React.createElement(Statusline, {
				ws: {
					cwd: "/Users/dev/project",
					branch: "feat-x",
					worktreeName: "feat-x",
				},
			}),
		);
		expect(html).toContain("statusline-wt");
		expect(html).toContain("wt:feat-x");
	});

	it("renderiza el goal activo cuando está presente", () => {
		const html = renderToStaticMarkup(
			React.createElement(Statusline, {
				goal: {
					id: "g1",
					text: "Completar rediseño UI",
					status: "active",
					iteration: 1,
					automaticTurns: 2,
					tokensUsed: 500,
					updatedAt: Date.now(),
				},
			}),
		);
		expect(html).toContain("statusline-goal");
		expect(html).toContain("Completar rediseño UI");
	});

	it("renderiza nombre de la sesión y métricas de contexto", () => {
		const html = renderToStaticMarkup(
			React.createElement(Statusline, {
				ws: {
					cwd: "/Users/dev/project",
					sessionName: "Sesión Refactor",
					sessionPath: "/path/to/session",
				},
				usage: {
					contextTokens: 25000,
					contextWindow: 200000,
					contextPercent: 12.5,
					inputTotal: 2000,
					outputTotal: 500,
					cacheRead: 10000,
					cacheWrite: 2000,
					cost: 0.015,
				},
			}),
		);
		expect(html).toContain("Sesión Refactor");
		expect(html).toContain("statusline-ctx");
		expect(html).toContain("25k/200k");
		expect(html).toContain("13%");
		expect(html).toContain("$0.015");
	});
});
