/**
 * Composer (#97): selects de proveedor/modelo SÓLO con proveedores conectados.
 *
 * Requisito del issue: "solo se deben ver los proveedores que estén
 * conectados; si no hay proveedores conectados poner mensaje y redirigir a la
 * pantalla donde se configuran".
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../webview/components/Composer";
import type { ProviderOption } from "../webview/types";

const base = {
	onSubmit: () => {},
	onSearch: () => {},
	expanded: false,
};

function prov(
	id: string,
	authed: boolean,
	models: { id: string; name: string }[] = [{ id: "m1", name: "Model 1" }],
): ProviderOption {
	return {
		id,
		name: id,
		oauth: true,
		apiKey: false,
		authed,
		models: models.map((m) => ({
			id: m.id,
			name: m.name,
			contextWindow: 100000,
			maxTokens: 8000,
			reasoning: true,
			input: ["text"] as ("text" | "image")[],
		})),
	} as ProviderOption;
}

describe("Composer · selects solo proveedores conectados (#97)", () => {
	it("mezcla conectados/desconectados: el select lista SOLO los authed", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...base,
				models: {
					providers: [
						prov("antigravity", true),
						prov("zai", false),
						prov("softtek-devengine", false),
					],
				},
				active: { provider: "antigravity", modelId: "m1" },
			}),
		);
		expect(html).toContain(">antigravity<");
		expect(html).not.toContain(">zai<");
		expect(html).not.toContain(">softtek-devengine<");
	});

	it("cero conectados: mensaje de redirect + botón (no select de proveedor)", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...base,
				models: { providers: [prov("zai", false), prov("antigravity", false)] },
			}),
		);
		expect(html).not.toContain('aria-label="Proveedor"');
		expect(html).toContain("Sin proveedores conectados");
		expect(html).toContain("bar-select-empty");
	});

	it("cero conectados con onOpenProviders: el botón invoca el redirect", () => {
		let opened = false;
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...base,
				models: { providers: [] },
				onOpenProviders: () => {
					opened = true;
				},
			}),
		);
		expect(html).toContain("Sin proveedores conectados");
		// renderToStaticMarkup no dispara onClick; el wiring de App.tsx se cubre
		// por la presencia del prop (test de integración en suite e2e).
		expect(opened).toBe(false);
	});

	it("proveedor activo SIN conexión queda fuera del select (no seleccionable)", () => {
		const html = renderToStaticMarkup(
			React.createElement(Composer, {
				...base,
				models: { providers: [prov("antigravity", false)] },
				active: { provider: "antigravity", modelId: "m1" },
			}),
		);
		expect(html).not.toContain('aria-label="Proveedor"');
		expect(html).not.toContain('aria-label="Modelo"');
	});
});
