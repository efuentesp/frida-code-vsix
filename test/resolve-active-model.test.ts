// #89: resolución del modelo activo al crear sesión — el catálogo de algunos
// proveedores (frida-enterprise) carga ASYNC (OAuth + GET /v1/models). Antes,
// getModel fallaba en ese gap → fallback SILENCIOSO a DevEngine aunque el
// usuario eligió otro proveedor (issue #89: «nunca cambiar de proveedor sin
// que el usuario lo pida»). Contrato del resolver puro aquí.

import { describe, expect, it } from "vitest";
import {
	resolveActiveModel,
	DEFAULT_CATALOG_WAIT_MS,
} from "../src/resolve-active-model";

const devengine = { provider: "softtek-devengine", id: "gpt-5.4-mini" };
const bloom = { provider: "frida-enterprise", id: "DEMETER-BLOOM" };
// Shape REAL del saved (CreateFridaSessionOptions.activeModel): modelId, no id.
const savedBloom = { provider: "frida-enterprise", modelId: "DEMETER-BLOOM" };

function deps(over: Partial<Parameters<typeof resolveActiveModel>[1]> = {}) {
	return {
		getModel: (_p: string, _m: string) => undefined,
		getModels: (_p: string) => [],
		refresh: async (_o?: { providers?: readonly string[] }) => {},
		fallbackModel: () => devengine,
		...over,
	};
}

describe("resolveActiveModel (#89: nunca cambiar de proveedor sin pedirlo)", () => {
	it("saved resuelve directo → se usa, sin refresh ni fallback", async () => {
		const d = deps({ getModel: (p, m) => (p === bloom.provider && m === bloom.id ? bloom : undefined) });
		const r = await resolveActiveModel(savedBloom, d);
		expect(r.model).toBe(bloom);
		expect(r.usedFallback).toBe(false);
		expect(r.refreshedProviders).toEqual([]);
	});

	it("catálogo async: getModel falla + getModels vacío → refresh del proveedor y REINTENTO — NO cae a DevEngine", async () => {
		let refreshed = false;
		const d = deps({
			getModel: (p, m) =>
				refreshed && p === bloom.provider && m === bloom.id ? bloom : undefined,
			refresh: async (o) => {
				expect(o?.providers).toEqual(["frida-enterprise"]);
				refreshed = true;
			},
		});
		const r = await resolveActiveModel(savedBloom, d);
		expect(r.model).toBe(bloom);
		expect(r.usedFallback).toBe(false);
		expect(r.refreshedProviders).toEqual(["frida-enterprise"]);
		expect(r.notice).toBeUndefined();
	});

	it("refresh no ayuda (sigue vacío) → fallback DevEngine PERO con notice honesto (no silencioso)", async () => {
		const d = deps();
		const r = await resolveActiveModel(savedBloom, d);
		expect(r.model).toBe(devengine);
		expect(r.usedFallback).toBe(true);
		expect(r.notice).toMatch(/frida-enterprise/);
		expect(r.notice).toMatch(/DevEngine/i);
	});

	it("refresh lanza → fallback + notice, nunca rechaza (arranque no puede morir por esto)", async () => {
		const d = deps({ refresh: async () => { throw new Error("network"); } });
		const r = await resolveActiveModel(savedBloom, d);
		expect(r.model).toBe(devengine);
		expect(r.usedFallback).toBe(true);
		expect(r.notice).toMatch(/frida-enterprise/);
	});

	it("refresh cuelga → bounded por timeout → fallback + notice", async () => {
		const d = deps({
			refresh: () => new Promise(() => {}), // nunca resuelve
			waitMs: 10,
		});
		const r = await resolveActiveModel(savedBloom, d);
		expect(r.model).toBe(devengine);
		expect(r.usedFallback).toBe(true);
	});

	it("modelId guardado ya no existe PERO el proveedor tiene otros → alt del MISMO proveedor (comportamiento preservado, sin refresh)", async () => {
		const alt = { provider: bloom.provider, id: "TITAN-CROWN" };
		const d = deps({
			getModels: (p) => (p === bloom.provider ? [alt] : []),
		});
		const r = await resolveActiveModel(savedBloom, d);
		expect(r.model).toBe(alt);
		expect(r.usedFallback).toBe(false);
		expect(r.refreshedProviders).toEqual([]);
	});

	it("sin saved → fallback directo sin notice (estado inicial legítimo)", async () => {
		const r = await resolveActiveModel(undefined, deps());
		expect(r.model).toBe(devengine);
		expect(r.usedFallback).toBe(true);
		expect(r.notice).toBeUndefined();
	});

	it("fallback también ausente → throw explícito (no hay nada usable)", async () => {
		await expect(
			resolveActiveModel(savedBloom, deps({ fallbackModel: () => undefined })),
		).rejects.toThrow(/frida-enterprise/);
	});

	it("default del timeout documentado y acotado", () => {
		expect(DEFAULT_CATALOG_WAIT_MS).toBeLessThanOrEqual(5000);
		expect(DEFAULT_CATALOG_WAIT_MS).toBeGreaterThan(0);
	});
});
