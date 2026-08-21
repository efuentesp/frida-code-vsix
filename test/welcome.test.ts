import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Welcome } from "../webview/components/Welcome";

describe("Welcome component (Copilot Canvas & Starter Cards)", () => {
	it("renderiza el logo, título y subtítulo", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("Frida Code");
		expect(html).toContain("welcome-logo");
		expect(html).toContain("welcome-sub");
	});

	it("renderiza los atajos rápidos (@archivos, /workflows, $skills)", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-shortcuts");
		expect(html).toContain("@archivos");
		expect(html).toContain("/workflows");
		expect(html).toContain("$skills");
	});

	it("renderiza las Starter Cards interactivas", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-cards");
		expect(html).toContain("Planificar con AiDD");
		expect(html).toContain("Diseñar Pruebas (TEA)");
		expect(html).toContain("Auditar Codebase");
		expect(html).toContain("Explicar Arquitectura");
	});

	it("renderiza el tip del día y la sección de ayuda colapsable", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("tip-day");
		expect(html).toContain("Tip del día");
		expect(html).toContain("welcome-help");
		expect(html).toContain("Instrucciones y atajos");
	});
});
