import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Welcome } from "../webview/components/Welcome";

describe("Welcome component (Copilot Canvas & Categorized Tips Hub)", () => {
	it("renderiza el wrapper centrado verticalmente, logo, título y subtítulo", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-wrapper");
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

	it("renderiza las Starter Cards 2x2 interactivas", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-cards");
		expect(html).toContain("Planificar con AiDD");
		expect(html).toContain("Diseñar Pruebas (TEA)");
		expect(html).toContain("Auditar Codebase");
		expect(html).toContain("Explicar Arquitectura");
	});

	it("renderiza el panel colapsable con pestañas categorizadas de ayuda", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-help");
		expect(html).toContain("Guía rápida de atajos");
		expect(html).toContain("wh-tabs");
		expect(html).toContain("Archivos");
		expect(html).toContain("Workflows");
		expect(html).toContain("Skills");
		expect(html).toContain("Teclado");
		expect(html).toContain("Seguridad");
	});
});
