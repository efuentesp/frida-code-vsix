/**
 * frida-antigravity (#97) — routing de modelos.
 *
 * Contrato crítico portado de pi-antigravity: cada modelo público se mapea a
 * un runtime ID del backend Cloud Code Assist según el esfuerzo de thinking.
 * Gemini 3.7 Flash usa UN runtime tiered (el esfuerzo viaja en
 * thinkingConfig); 3.6/3.5/Pro usan runtimes específicos por esfuerzo.
 */
import { describe, expect, it } from "vitest";
import {
	ANTIGRAVITY_MODELS,
	ANTIGRAVITY_ROUTING,
	getAntigravityRequestModelId,
	getFallbackRuntimeModel,
	getMaxOutputTokens,
} from "../../src/providers/frida-antigravity/models/models";

describe("frida-antigravity · catálogo y routing", () => {
	it("expone los 7 modelos públicos del catálogo (paridad con `agy models`)", () => {
		expect(ANTIGRAVITY_MODELS.map((m) => m.id).sort()).toEqual([
			"claude-opus-4-6",
			"claude-sonnet-4-6",
			"gemini-3.1-pro",
			"gemini-3.5-flash",
			"gemini-3.6-flash",
			"gemini-3.7-flash",
			"gpt-oss-120b",
		]);
	});

	it("todos los modelos son gratuitos en costo reportado (facturación por suscripción)", () => {
		for (const m of ANTIGRAVITY_MODELS) {
			expect(m.cost.input).toBe(0);
			expect(m.cost.output).toBe(0);
		}
	});

	it("gemini-3.7-flash SIEMPRE enruta al runtime tiered (el esfuerzo va en thinkingConfig)", () => {
		for (const effort of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
			expect(getAntigravityRequestModelId("gemini-3.7-flash", effort)).toBe(
				"gemini-3.7-flash-tiered",
			);
		}
	});

	it("gemini-3.6-flash enruta por esfuerzo a runtimes low/medium/high", () => {
		expect(getAntigravityRequestModelId("gemini-3.6-flash", "off")).toBe(
			"gemini-3.6-flash-low",
		);
		expect(getAntigravityRequestModelId("gemini-3.6-flash", "medium")).toBe(
			"gemini-3.6-flash-medium",
		);
		expect(getAntigravityRequestModelId("gemini-3.6-flash", "high")).toBe(
			"gemini-3.6-flash-high",
		);
	});

	it("gemini-3.5-flash mapea high al runtime agent (labels ≠ runtime ids del backend)", () => {
		expect(getAntigravityRequestModelId("gemini-3.5-flash", "high")).toBe(
			"gemini-3-flash-agent",
		);
		expect(getAntigravityRequestModelId("gemini-3.5-flash", "off")).toBe(
			"gemini-3.5-flash-extra-low",
		);
	});

	it("gemini-3.1-pro high usa gemini-pro-agent (el -high directo 400a en producción)", () => {
		expect(getAntigravityRequestModelId("gemini-3.1-pro", "high")).toBe(
			"gemini-pro-agent",
		);
		expect(getAntigravityRequestModelId("gemini-3.1-pro", "low")).toBe(
			"gemini-3.1-pro-low",
		);
	});

	it("claude/gpt-oss tienen runtime único independiente del esfuerzo", () => {
		expect(getAntigravityRequestModelId("claude-opus-4-6", "high")).toBe(
			"claude-opus-4-6-thinking",
		);
		expect(getAntigravityRequestModelId("claude-sonnet-4-6", "high")).toBe(
			"claude-sonnet-4-6",
		);
		expect(getAntigravityRequestModelId("gpt-oss-120b", "medium")).toBe(
			"gpt-oss-120b-medium",
		);
	});

	it("ids desconocidos pasan intactos (ruting dinámico vía fetchAvailableModels)", () => {
		expect(getAntigravityRequestModelId("custom-model-x", "high")).toBe(
			"custom-model-x",
		);
	});

	it("xhigh degrada a high y luego a los niveles disponibles", () => {
		// thinking: sólo high definido
		expect(getAntigravityRequestModelId("claude-sonnet-4-6", "xhigh")).toBe(
			"claude-sonnet-4-6",
		);
	});
});

describe("frida-antigravity · límites de salida verificados", () => {
	it("respeta RUNTIME_MAX_OUTPUT_TOKENS por runtime y familia", () => {
		expect(getMaxOutputTokens("gemini-3.7-flash")).toBe(65536);
		expect(getMaxOutputTokens("model", "claude-sonnet-4-6")).toBe(64000);
		expect(getMaxOutputTokens("model", "gpt-oss-120b")).toBe(32768);
		expect(getMaxOutputTokens("model", "gemini-pro-agent")).toBe(65535);
	});

	it("fallback por prefijo de familia cuando el runtime es desconocido", () => {
		expect(getMaxOutputTokens("m", "claude-future-9")).toBe(64000);
		expect(getMaxOutputTokens("m", "gemini-4-flash")).toBe(65536);
		expect(getMaxOutputTokens("unknown-model")).toBe(8192);
	});
});

describe("frida-antigravity · fallback de runtime", () => {
	it("3.7 cae a 3.6 con el mismo esfuerzo", () => {
		expect(getFallbackRuntimeModel("gemini-3.7-flash-tiered", "high")).toBe(
			"gemini-3.6-flash-high",
		);
	});

	it("otros runtimes no tienen fallback", () => {
		expect(getFallbackRuntimeModel("claude-sonnet-4-6")).toBeUndefined();
		expect(getFallbackRuntimeModel("gemini-3.6-flash-low")).toBeUndefined();
	});
});

describe("frida-antigravity · ANTIGRAVITY_ROUTING consistencia", () => {
	it("cada modelo del catálogo tiene entrada de routing", () => {
		for (const m of ANTIGRAVITY_MODELS) {
			expect(ANTIGRAVITY_ROUTING[m.id]).toBeDefined();
		}
	});

	it("todo runtime referenciado por routing tiene su límite verificado", () => {
		for (const entry of Object.values(ANTIGRAVITY_ROUTING)) {
			const ids = new Set<string>([
				...(entry.off ? [entry.off] : []),
				...Object.values(entry.routing ?? {}),
			]);
			for (const id of ids) {
				expect(getMaxOutputTokens("x", id)).toBeGreaterThan(8192);
			}
		}
	});
});
