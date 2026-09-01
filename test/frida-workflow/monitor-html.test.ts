// monitor-html.test.ts — páginas del monitor (FR#7/FR#16/D7).
//
// Las páginas son strings self-contained; los tests afirman el CONTRATO con
// el servidor (Slice 6): endpoints usados, token embebido para los POST,
// controles data-action y el hub espejo de «De cero» (D7). Molde de
// aislamiento: test/frida-workflow/panel-spec.test.ts.
import { describe, expect, it } from "vitest";
import {
	renderMonitorHubPage,
	renderSddPage,
} from "../../src/tools/frida-workflow/monitor-html";

const TOKEN = "11111111-2222-3333-4444-555555555555";

describe("hub (/) — espejo de «De cero» (D7/FR#7)", () => {
	it("título Frida Monitor + SDD activo enlazado a /sdd", () => {
		const html = renderMonitorHubPage();
		expect(html).toContain("Frida Monitor");
		expect(html).toContain('href="/sdd"');
		expect(html).toContain("SDD");
		expect(html).toContain("activo");
	});

	it("AiDD y TEA listados como próximamente (sin página)", () => {
		const html = renderMonitorHubPage();
		expect(html).toContain("AiDD");
		expect(html).toContain("TEA");
		expect(html).toContain("próximamente");
		expect(html).not.toContain('href="/aidd"');
	});

	it("estático: sin fetch ni EventSource (el estado vivo vive en /sdd)", () => {
		const html = renderMonitorHubPage();
		expect(html).not.toContain("fetch(");
		expect(html).not.toContain("EventSource");
	});
});

describe("/sdd — token embebido y contrato del servidor (FR#7/FR#8)", () => {
	it("embebe el token como string JSON para los POST autenticados", () => {
		const html = renderSddPage(TOKEN);
		expect(html).toContain(`var TOKEN = "${TOKEN}"`);
	});

	it("consume el contrato Slice 6: /api/state, SSE /events y POST /api/*", () => {
		const html = renderSddPage(TOKEN);
		expect(html).toContain("/api/state");
		expect(html).toContain('"/events"');
		expect(html).toContain("/api/advance");
		expect(html).toContain("/api/pause");
		expect(html).toContain("/api/ship");
		expect(html).toContain("EventSource");
		expect(html).toContain("x-frida-monitor-token");
	});

	it("controles POST y dismiss declarados por data-action", () => {
		const html = renderSddPage(TOKEN);
		for (const a of ['"advance"', '"ship"', '"pause"', '"copy"', '"dismiss"']) {
			expect(html).toContain(a);
		}
	});

	it("título del documento contiene Frida Monitor (test S6 del servidor)", () => {
		// El test locked de monitor-server.test.ts asume toContain("Frida Monitor")
		// en AMBAS rutas — esta página no debe romperlo.
		expect(renderSddPage(TOKEN)).toContain("Frida Monitor");
	});
});

describe("/sdd — fallback y detalle FR#16 (degradación sin host)", () => {
	it("fallback del spec SDD espeja SDD_PANEL_SPEC (columnas + emptyState)", () => {
		const html = renderSddPage(TOKEN);
		expect(html).toContain("/skill:discover <idea>");
		expect(html).toContain("ready-to-ship");
		expect(html).toContain("Continuar a research");
		expect(html).toContain("Ship → fases a ejecución");
	});

	it("detalle por feature: <details> con timeline, artefactos e historial", () => {
		const html = renderSddPage(TOKEN);
		expect(html).toContain("data-fid"); // <details> por feature + reapertura SSE
		expect(html).toContain("pendiente"); // estado individual del artefacto
		expect(html).toContain("Historial");
		expect(html).toContain("timeline y artefactos"); // summary del detalle
	});

	it("escape HTML presente (ids/rutas nunca rompen el markup)", () => {
		const html = renderSddPage(TOKEN);
		expect(html).toContain("&amp;"); // tabla de escape en esc()
	});
});

// ── #194 — «+ Nueva feature»: capturar la idea en el navegador ─────────────
describe("/sdd — «+ Nueva feature» (#194)", () => {
	it("form con input de idea y botón submit junto a N1", () => {
		const html = renderSddPage(TOKEN);
		expect(html).toContain('id="newfeat"');
		expect(html).toContain('name="idea"');
		expect(html).toContain('maxlength="300"');
		expect(html).toContain("＋ Nueva feature");
	});

	it("POST /api/discover con guard y timeout de seguridad", () => {
		const html = renderSddPage(TOKEN);
		expect(html).toContain('"/api/discover"');
		expect(html).toContain("pendingDiscover");
		expect(html).toContain("form#newfeat"); // delegación global de submit
		expect(html).toContain("90000"); // timeout: la skill puede tardar
	});
});
