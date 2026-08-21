import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalPanel } from "../webview/components/ApprovalPanel";
import type { State } from "../webview/types";

describe("ApprovalPanel (Propuesta 1: VS Code Security Matrix & Policy Cards)", () => {
	const baseState: State = {
		keyNeeded: false,
		busy: false,
		mode: "auto-edit",
		turns: [],
		approvals: [],
		modelChanges: [],
		uiRequests: [],
		queued: [],
		isCompacting: false,
		compactions: [],
		branchSummaries: [],
		nextId: 1,
		permissions: {
			mode: "auto-edit",
			auditLog: true,
			tool: {
				read: "allow",
				edit: "ask",
				write: "ask",
				bash: "ask",
			},
			path: {
				"*.env": "deny",
				"~/.ssh/*": "deny",
			},
			bash: {
				"rm -rf *": "deny",
				"git status": "allow",
			},
			externalDirectory: "deny",
		},
		sessionPatterns: [
			{ kind: "bash", pattern: "git diff" },
			{ kind: "diff", pattern: "test/*" },
		],
	};

	it("renderiza selector visual de modo global con tarjetas/chips interactivos", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalPanel, {
				state: baseState,
				post,
			}),
		);

		expect(html).toContain("perm-body");
		expect(html).toContain("Modo de automatización global");
		expect(html).toContain("Manual");
		expect(html).toContain("Auto-edit");
		expect(html).toContain("Auto");
		expect(html).toContain("codicon-shield");
		expect(html).toContain("codicon-edit");
		expect(html).toContain("codicon-zap");
	});

	it("renderiza lista de herramientas con iconos y botones tri-state de codicons", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalPanel, {
				state: baseState,
				post,
			}),
		);

		expect(html).toContain("Herramientas del sistema");
		expect(html).toContain("read");
		expect(html).toContain("edit");
		expect(html).toContain("bash");
		expect(html).toContain("perm-seg");
		// Codicons para tri-state (pass, question, error)
		expect(html).toContain("codicon-pass");
		expect(html).toContain("codicon-question");
		expect(html).toContain("codicon-error");
	});

	it("renderiza tarjetas de reglas de protección para paths y comandos bash", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalPanel, {
				state: baseState,
				post,
			}),
		);

		expect(html).toContain("Archivos y rutas protegidas");
		expect(html).toContain("*.env");
		expect(html).toContain("~/.ssh/*");
		expect(html).toContain("Comandos bash");
		expect(html).toContain("rm -rf *");
		expect(html).toContain("git status");
	});

	it("renderiza patrones aprobados temporalmente en la sesión activa", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalPanel, {
				state: baseState,
				post,
			}),
		);

		expect(html).toContain("Aprobado en esta sesión");
		expect(html).toContain("git diff");
		expect(html).toContain("test/*");
		expect(html).toContain("Revocar");
	});

	it("renderiza sección de auditoría y botón de restablecer valores por defecto", () => {
		const post = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalPanel, {
				state: baseState,
				post,
			}),
		);

		expect(html).toContain("Auditoría y registro");
		expect(html).toContain("approvals.jsonl");
		expect(html).toContain("Restablecer defaults");
	});
});
