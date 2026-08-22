/**
 * #98: una sola ventana de confirmación al cambiar de proveedor.
 *
 * Regresión: el handler de select_model volvía a pedir confirmación vía
 * ModelChangeBridge (tarjeta vieja "Cambio de proveedor") DESPUÉS de que el
 * usuario ya confirmó en el ModelConfirmDialog del webview — doble ventana.
 *
 * El fix eliminó el disparador manual; el puente vive SOLO para la
 * vigilancia auto-detected en agent_end (divergencia session.model vs
 * activeModel: failover, restore corrupto). Este guard evita que alguien
 * re-introduzca el sitio manual: extension.ts debe instanciar
 * ModelChangeBridge exactamente UNA vez, y el caso select_model no debe
 * tocar model_changes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const extPath = resolve(__dirname, "../src/extension.ts");
const ext = readFileSync(extPath, "utf8");

describe("#98 · single-window de confirmación de cambio de proveedor", () => {
	it("ModelChangeBridge se instancia exactamente UNA vez (sólo auto-detected)", () => {
		const sites = ext.match(/new ModelChangeBridge\(/g) ?? [];
		expect(sites.length).toBe(1);
	});

	it("el sitio restante es la vigilancia auto-detected (agent_end), no selectModel", () => {
		const idx = ext.indexOf("new ModelChangeBridge(");
		const around = ext.slice(Math.max(0, idx - 600), idx + 600);
		expect(around).toMatch(/auto-detected|divergencia|cur\.provider/);
	});

	it("selectModel no pide re-confirmación (select_model ya confirmó el diálogo)", () => {
		const start = ext.indexOf("async function selectModel(");
		expect(start).toBeGreaterThan(0);
		const end = ext.indexOf("async function ", start + 10);
		const body = ext.slice(start, end > start ? end : undefined);
		// Código, no comentarios: el cuerpo no usa el puente ni emite el mensaje
		// model_changes (el comentario #98 sí puede mencionarlo como documentación).
		expect(body).not.toContain("modelChangeBridge");
		expect(body).not.toContain('type: "model_changes"');
	});

	it("el webview conserva la tarjeta para el camino auto-detected", async () => {
		const app = readFileSync(resolve(__dirname, "../webview/App.tsx"), "utf8");
		expect(app).toContain("state.modelChanges.length > 0");
		expect(app).toContain('type: "model_change_response"');
	});
});
