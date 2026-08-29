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

	// #140: 7 cards (4 base + 3 de la Pista M); el nombre "2x2" quedó
	// obsoleto. renderToStaticMarkup no renderiza handlers — prompts y
	// actionType insert se verifican en el smoke manual (canal
	// composer_insert, estable desde su landed); la suite mantiene su
	// patrón estático existente.
	it("renderiza las Starter Cards interactivas (4 base + 3 de la Pista M)", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-cards");
		// 4 existentes sin tocar (D6 — FR-9).
		expect(html).toContain("Planificar con AiDD");
		expect(html).toContain("Diseñar Pruebas (TEA)");
		expect(html).toContain("Auditar Codebase");
		expect(html).toContain("Explicar Arquitectura");
		// 3 nuevas de la Pista M (#140): título + fragmento del desc.
		expect(html).toContain("Documentar una App");
		expect(html).toContain("documentación funcional");
		expect(html).toContain("Entender el Código");
		expect(html).toContain("7 preguntas del día 1");
		expect(html).toContain("Dimensionar para Preventa");
		expect(html).toContain("COCOMO");
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
