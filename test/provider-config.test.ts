import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderConfig } from "../webview/components/ProviderConfig";
import { ProveedoresTab } from "../webview/components/ProveedoresTab";
import type { ProviderOption } from "../webview/types";

describe("ProviderConfig & ProveedoresTab (Propuesta 1: VS Code Accounts & Model Hub)", () => {
	const mockEnterprise: ProviderOption = {
		id: "frida-enterprise",
		name: "Frida Enterprise",
		oauth: true,
		apiKey: false,
		authed: true,
		models: [
			{ id: "demeter-bloom", name: "Demeter Bloom" },
			{ id: "ceres-spark", name: "Ceres Spark" },
		],
	};

	const mockAnthropic: ProviderOption = {
		id: "anthropic",
		name: "Anthropic",
		oauth: false,
		apiKey: true,
		authed: true,
		models: [
			{ id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
		],
	};

	const mockOpenAI: ProviderOption = {
		id: "openai",
		name: "OpenAI",
		oauth: false,
		apiKey: true,
		authed: false,
		models: [],
	};

	it("renderiza proveedor OAuth conectado con status pill, modelos y botón de cerrar sesión", () => {
		const onSetKey = vi.fn();
		const onLogin = vi.fn();
		const onLogout = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(ProviderConfig, {
				provider: mockEnterprise,
				meta: {
					id: "frida-enterprise",
					name: "Frida Enterprise",
					authType: "oauth",
					blurb: "Modelos optimizados para desarrollo y razonamiento profundo.",
				},
				activeModelId: "demeter-bloom",
				onSetKey,
				onLogin,
				onLogout,
			}),
		);

		expect(html).toContain("pc-card");
		expect(html).toContain("Frida Enterprise");
		expect(html).toContain("pc-badge ok");
		expect(html).toContain("Conectado");
		expect(html).toContain("Demeter Bloom");
		expect(html).toContain("Ceres Spark");
		expect(html).toContain("En uso");
		expect(html).toContain("pc-link-btn");
		expect(html).toContain("Olvidar acceso");
	});

	it("renderiza proveedor API Key conectado con status pill y modelos", () => {
		const onSetKey = vi.fn();
		const onLogin = vi.fn();
		const onLogout = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(ProviderConfig, {
				provider: mockAnthropic,
				meta: {
					id: "anthropic",
					name: "Anthropic",
					authType: "apikey",
					blurb: "Modelos Claude de última generación.",
				},
				onSetKey,
				onLogin,
				onLogout,
			}),
		);

		expect(html).toContain("Anthropic");
		expect(html).toContain("Claude 3.5 Sonnet");
		expect(html).toContain("Cambiar API key");
		expect(html).toContain("Olvidar API key");
	});

	it("renderiza proveedor no conectado con formulario de ingreso de clave y link externo", () => {
		const onSetKey = vi.fn();
		const onLogin = vi.fn();
		const onLogout = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(ProviderConfig, {
				provider: mockOpenAI,
				meta: {
					id: "openai",
					name: "OpenAI",
					authType: "apikey",
					keyPlaceholder: "sk-...",
					getKeyUrl: "https://platform.openai.com/api-keys",
				},
				onSetKey,
				onLogin,
				onLogout,
			}),
		);

		expect(html).toContain("OpenAI");
		expect(html).toContain("pc-input");
		expect(html).toContain("Guardar key");
		expect(html).toContain("Obtener key");
		expect(html).toContain("https://platform.openai.com/api-keys");
	});

	it("renderiza flujo OAuth Device Code cuando deviceCode está presente", () => {
		const onSetKey = vi.fn();
		const onLogin = vi.fn();
		const onLogout = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(ProviderConfig, {
				provider: { ...mockEnterprise, authed: false },
				meta: {
					id: "frida-enterprise",
					name: "Frida Enterprise",
					authType: "oauth",
				},
				deviceCode: {
					userCode: "ABCD-1234",
					verificationUri: "https://github.com/login/device",
				},
				onSetKey,
				onLogin,
				onLogout,
			}),
		);

		expect(html).toContain("oauth-banner");
		expect(html).toContain("ABCD-1234");
		expect(html).toContain("https://github.com/login/device");
	});

	it("ProveedoresTab agrupa proveedores configurados y disponibles con sus modelos", () => {
		const onSetKey = vi.fn();
		const onLogin = vi.fn();
		const onLogout = vi.fn();

		const html = renderToStaticMarkup(
			React.createElement(ProveedoresTab, {
				providers: [mockEnterprise, mockOpenAI],
				activeModel: { provider: "frida-enterprise", modelId: "demeter-bloom" },
				onSetKey,
				onLogin,
				onLogout,
			}),
		);

		expect(html).toContain("Configurados (1)");
		expect(html).toContain("Disponibles (1)");
		expect(html).toContain("Frida Enterprise");
		expect(html).toContain("OpenAI");
	});
});
