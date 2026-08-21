import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../webview/components/Composer";

describe("Composer component (Fase 4: Footer — Input Stack, Composer y Border Beam)", () => {
	const defaultProps = {
		onSubmit: () => {},
		onSearch: () => {},
		expanded: false,
	};

	it("renderiza el contenedor .chat-input-stack con textarea y botón circular", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...defaultProps,
			}),
		);
		expect(html).toContain("chat-input-stack");
		expect(html).toContain("chat-submit-btn");
		expect(html).toContain("codicon-arrow-up");
	});

	it("aplica la clase .working y el botón de stop cuando busy es true (Border Beam activo)", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...defaultProps,
				busy: true,
			}),
		);
		expect(html).toContain("chat-input-stack working");
		expect(html).toContain("chat-submit-btn stop");
		expect(html).toContain("codicon-debug-stop");
	});

	it("aplica la clase .expanded cuando expanded es true", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...defaultProps,
				expanded: true,
			}),
		);
		expect(html).toContain("chat-input-stack");
		expect(html).toContain("expanded");
		expect(html).toContain("input-expanded");
	});

	it("aplica la clase .yolo-mode cuando el modo es auto", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...defaultProps,
				mode: "auto",
			}),
		);
		expect(html).toContain("chat-input-stack");
		expect(html).toContain("yolo-mode");
	});

	it("aplica .input-blocked y modo readonly cuando pendingDialog es true", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...defaultProps,
				pendingDialog: true,
			}),
		);
		expect(html).toContain("input-blocked");
		expect(html).toContain("readonly");
	});

	it("renderiza los selectores compactos en .bar-controls", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...defaultProps,
				models: {
					providers: [
						{
							id: "softtek",
							name: "Softtek",
							oauth: false,
							apiKey: true,
							authed: true,
							models: [{ id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet" }],
						},
					],
				},
				active: { provider: "softtek", modelId: "claude-3-7-sonnet" },
				thinking: "high",
			}),
		);
		expect(html).toContain("bar-controls");
		expect(html).toContain("bar-select");
		expect(html).toContain("Softtek");
		expect(html).toContain("Claude 3.7 Sonnet");
	});
});
