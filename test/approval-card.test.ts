import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalCard } from "../webview/components/ApprovalCard";
import type { ApprovalRequest } from "../webview/types";

describe("ApprovalCard component (Propuesta 2: QuickPick VS Code style)", () => {
	it("renderiza solicitud de comando bash con QuickPick y badges de atajos", () => {
		const approval: ApprovalRequest = {
			id: "app-1",
			toolName: "bash",
			kind: "bash",
			command: "npm run build && git status",
		};
		const onRespond = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalCard, {
				approval,
				active: true,
				onRespond,
			}),
		);

		expect(html).toContain("approval");
		expect(html).toContain("Ejecución de comando");
		expect(html).toContain("npm run build &amp;&amp; git status");
		expect(html).toContain("Permitir ejecución de comando");
		expect(html).toContain("Rechazar");
		expect(html).toContain("Rechazar e indicar corrección al modelo");
		expect(html).toContain("ap-shortcut-badge");
		expect(html).toContain("ap-keys");
		expect(html).toContain("Copiar");
	});

	it("renderiza opción de permitir patrón cuando suggestedPattern está presente", () => {
		const approval: ApprovalRequest = {
			id: "app-2",
			kind: "tool",
			toolName: "read",
			suggestedPattern: "read(src/**)",
		};
		const onRespond = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalCard, {
				approval,
				active: true,
				onRespond,
			}),
		);

		expect(html).toContain("Herramienta — read");
		expect(html).toContain("Permitir siempre «read(src/**)» esta sesión");
		expect(html).toContain("ap-shortcut-badge");
	});

	it("renderiza advertencia y hint de herramienta de solo lectura", () => {
		const approval: ApprovalRequest = {
			id: "app-3",
			kind: "tool",
			toolName: "project_report",
			warning: "Operación de escaneo intensivo",
		};
		const onRespond = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalCard, {
				approval,
				active: true,
				onRespond,
			}),
		);

		expect(html).toContain("Operación de escaneo intensivo");
		expect(html).toContain("Herramienta de sólo lectura/análisis");
	});

	it("renderiza solicitud de edición de archivo diff", () => {
		const approval: ApprovalRequest = {
			id: "app-4",
			kind: "diff",
			toolName: "write",
			path: "src/extension.ts",
			diff: "+ export function activate() {}",
		};
		const onRespond = vi.fn();
		const html = renderToStaticMarkup(
			React.createElement(ApprovalCard, {
				approval,
				active: true,
				onRespond,
			}),
		);

		expect(html).toContain("Edición de archivo — src/extension.ts");
		expect(html).toContain("Permitir edición de archivo");
		expect(html).toContain("diff");
	});
});
