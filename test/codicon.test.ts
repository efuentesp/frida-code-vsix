import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Codicon } from "../webview/components/Codicon";

describe("Codicon component (Fase 1 Fundaciones)", () => {
	it("renderiza un span con las clases base de codicon", () => {
		const html = renderToStaticMarkup(
			React.createElement(Codicon, { name: "sparkle" }),
		);
		expect(html).toContain("codicon");
		expect(html).toContain("codicon-sparkle");
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("font-size:16px");
	});

	it("normaliza nombres que ya traen el prefijo 'codicon-'", () => {
		const html = renderToStaticMarkup(
			React.createElement(Codicon, { name: "codicon-check" }),
		);
		expect(html).toContain("codicon-check");
		expect(html).not.toContain("codicon-codicon-check");
	});

	it("aplica animación de spin para loading o cuando spin es true", () => {
		const loadingHtml = renderToStaticMarkup(
			React.createElement(Codicon, { name: "loading" }),
		);
		expect(loadingHtml).toContain("codicon-modifier-spin");

		const customSpinHtml = renderToStaticMarkup(
			React.createElement(Codicon, { name: "sync", spin: true }),
		);
		expect(customSpinHtml).toContain("codicon-modifier-spin");
	});

	it("aplica accesibilidad y role='img' cuando se provee ariaLabel", () => {
		const html = renderToStaticMarkup(
			React.createElement(Codicon, {
				name: "warning",
				size: 24,
				ariaLabel: "Advertencia",
			}),
		);
		expect(html).toContain('aria-label="Advertencia"');
		expect(html).toContain('role="img"');
		expect(html).toContain("font-size:24px");
		expect(html).not.toContain('aria-hidden="true"');
	});

	it("utiliza fallback a SVG de marca para 'bot' y 'brain'", () => {
		const botHtml = renderToStaticMarkup(
			React.createElement(Codicon, { name: "bot", size: 18 }),
		);
		expect(botHtml).toContain("svg");
		expect(botHtml).toContain("codicon-brand");

		const brainHtml = renderToStaticMarkup(
			React.createElement(Codicon, { name: "brain" }),
		);
		expect(brainHtml).toContain("svg");
		expect(brainHtml).toContain("codicon-brand");
	});
});
