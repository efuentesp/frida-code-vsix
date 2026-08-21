import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InfoToast } from "../webview/components/InfoToast";

describe("InfoToast (Opción 1: VS Code Native Notification Card)", () => {
	it("renderiza toast de error con role='alert', icono de error, botón copiar y cerrar", () => {
		const html = renderToStaticMarkup(
			React.createElement(InfoToast, {
				toast: {
					text: "No se pudo conectar con el servidor de Frida",
					level: "error",
				},
			}),
		);

		expect(html).toContain("info-toast");
		expect(html).toContain("error");
		expect(html).toContain('role="alert"');
		expect(html).toContain("No se pudo conectar con el servidor de Frida");
		expect(html).toContain("codicon-error");
		expect(html).toContain("codicon-copy");
		expect(html).toContain("codicon-close");
		// Los errores no tienen barra de auto-cierre efímero
		expect(html).not.toContain("info-toast-progress");
	});

	it("renderiza toast de advertencia con nivel warning", () => {
		const html = renderToStaticMarkup(
			React.createElement(InfoToast, {
				toast: {
					text: "El contexto está superando el 75%",
					level: "warning",
				},
			}),
		);

		expect(html).toContain("info-toast");
		expect(html).toContain("warning");
		expect(html).toContain("codicon-warning");
		expect(html).toContain("El contexto está superando el 75%");
	});

	it("renderiza toast efímero de éxito con barra de progreso", () => {
		const html = renderToStaticMarkup(
			React.createElement(InfoToast, {
				toast: {
					text: "Configuración guardada exitosamente",
					level: "success",
				},
			}),
		);

		expect(html).toContain("info-toast");
		expect(html).toContain("success");
		expect(html).toContain('role="status"');
		expect(html).toContain("codicon-pass-filled");
		expect(html).toContain("info-toast-progress");
		expect(html).toContain("info-toast-progress-bar");
	});

	it("renderiza toast efímero de información", () => {
		const html = renderToStaticMarkup(
			React.createElement(InfoToast, {
				toast: {
					text: "Sesión bifurcada en el mensaje #12",
					level: "info",
				},
			}),
		);

		expect(html).toContain("info-toast");
		expect(html).toContain("info");
		expect(html).toContain("codicon-info");
		expect(html).toContain("info-toast-progress");
	});

	it("no renderiza nada cuando toast es undefined", () => {
		const html = renderToStaticMarkup(
			React.createElement(InfoToast, {
				toast: undefined,
			}),
		);

		expect(html).toBe("");
	});
});
