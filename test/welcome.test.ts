// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Welcome } from "../webview/components/Welcome";

describe("Welcome component (Frida Studio — Agentic Software Factory)", () => {
	// §10 (b) — cadena monitor_url (fix Step 4, precedente 32d874d): la Welcome
	// renderiza el ancla «Abrir monitor ↗» con la URL publicada por el host.
	it("renderiza el ancla al monitor cuando monitorUrl llegó por monitor_url", () => {
		const html = renderToStaticMarkup(
			React.createElement(Welcome, {
				monitorUrl: "http://127.0.0.1:45678/",
			}),
		);
		expect(html).toContain("http://127.0.0.1:45678/");
		expect(html).toContain("Abrir monitor");
	});

	it("renderiza el wrapper centrado verticalmente, logo, título Frida Studio y subtítulo", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-wrapper");
		expect(html).toContain("Frida Studio");
		expect(html).toContain("welcome-logo");
		expect(html).toContain("welcome-sub");
		expect(html).toContain("Agentic Software Factory");
	});

	it("renderiza los atajos rápidos (@archivos, /workflows, $skills)", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-shortcuts");
		expect(html).toContain("@archivos");
		expect(html).toContain("/workflows");
		expect(html).toContain("$skills");
	});

	it("renderiza los selectores de categorías (De cero, Existente, Control Studio)", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-category-tabs");
		expect(html).toContain("De cero");
		expect(html).toContain("Existente");
		expect(html).toContain("Control Studio");
	});

	it("renderiza las Starter Cards de la categoría activa por defecto (Greenfield)", () => {
		const html = renderToStaticMarkup(React.createElement(Welcome, {}));
		expect(html).toContain("welcome-cards");
		expect(html).toContain("Planificar con AiDD");
		expect(html).toContain("Desarrollo Autónomo (SDD)");
		expect(html).toContain("Diseñar Pruebas (TEA)");
		expect(html).toContain("Packs de Equipo");
		expect(html).toContain("ROADMAP");
	});

	it("auto-detecta categoría Brownfield cuando el workspace tiene rama o diff", () => {
		const html = renderToStaticMarkup(
			React.createElement(Welcome, {
				workspace: {
					cwd: "/path/to/project",
					branch: "main",
					diff: { added: 2, modified: 1, deleted: 0 },
				},
			}),
		);
		expect(html).toContain("welcome-cards");
		expect(html).toContain("Entender el Código");
		expect(html).toContain("Documentar la App");
		expect(html).toContain("Dimensionar para Preventa");
		expect(html).toContain("Del Tráfico a la API");
		expect(html).toContain("Mapa del Proyecto");
		expect(html).toContain("Auditar Codebase");
		expect(html).toContain("Explicar Arquitectura");
		expect(html).toContain("Modernizar Legado");
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

	it("corrige la tab a Brownfield cuando el workspace llega después del primer render (race de webview_ready)", async () => {
		// Reproduce la secuencia real: el webview monta SIN workspace (greenfield)
		// y el mensaje "workspace" (git status asíncrono de la extensión) llega
		// después. Antes del fix, useState ignoraba la detección tardía.
		const container = document.createElement("div");
		const root: Root = createRoot(container);

		act(() => {
			root.render(React.createElement(Welcome, { workspace: undefined }));
		});
		expect(container.innerHTML).toContain("Planificar con AiDD"); // aún greenfield

		act(() => {
			root.render(
				React.createElement(Welcome, {
					workspace: {
						cwd: "/path/to/sele-dev",
						branch: "main",
						dirty: false,
						diff: { added: 0, modified: 0, deleted: 0 },
					},
				}),
			);
		});
		expect(container.innerHTML).toContain("Entender el Código"); // ahora brownfield
		expect(container.innerHTML).not.toContain("Planificar con AiDD");

		act(() => {
			root.unmount();
		});
	});
});
