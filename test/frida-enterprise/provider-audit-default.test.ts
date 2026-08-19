// #91/#89 (parte 2 — hallazgo del repro 20:52–20:54): el switch de sesión
// (continuar sesión existente) construye su propio objeto de opts y OMITÍA
// activeModel y providerAudit → la sesión continuada (la ACTIVA) arrancaba
// en el fallback DevEngine (tarjeta AUTO-CHANGE: «cambió de proveedor») y
// sin la extensión de auditoría (0 REQUESTs del chat — el falso misterio
// E3). El fix estructural: provider-audit DEFAULT-ON en createFridaSession
// — ningún call site puede olvidarlo. Este módulo prueba el builder puro
// de los deps por defecto.

import { describe, expect, it } from "vitest";
import { defaultProviderAuditDeps } from "../../src/providers/provider-audit";

describe("defaultProviderAuditDeps (#91: default-on, sin wiring del host)", () => {
	it("tag deriva del cwd (ws-<basename>) — mismo namespace que abort.log", () => {
		const d = defaultProviderAuditDeps("/Users/x/dev/nutrimetrics");
		expect(d.tag()).toBe("ws-nutrimetrics");
	});

	it("cwd con trailing slash → tag igual (normalizado)", () => {
		expect(defaultProviderAuditDeps("/Users/x/dev/nutrimetrics/").tag()).toBe(
			"ws-nutrimetrics",
		);
	});

	it("append no lanza aunque el path no exista (forense best-effort)", () => {
		const d = defaultProviderAuditDeps("/tmp");
		expect(() => d.append("línea de prueba forense")).not.toThrow();
	});

	it("es deps completos: append + tag usables directamente por la factory", () => {
		const d = defaultProviderAuditDeps("/proj/p");
		expect(typeof d.append).toBe("function");
		expect(typeof d.tag()).toBe("string");
	});
});
