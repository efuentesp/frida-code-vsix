// Issue: "El modelo no generó respuesta (401)" aparecía y DESPUÉS llegaba la
// respuesta. Causa: el fallo del intento 1 era retriable → pi-ai emitía
// agent_end con willRetry=true → la rama del fallback genérico NO filtraba
// por !willRetry (las ramas de errorMessage/lastMessageError sí) → se
// publicaba el error, el auto-retry respondía y el usuario veía AMBOS.
//
// Contrato del helper puro agentEndFallbackText (extraído de extension.ts):
//   • willRetry=true  → null (silencio: el reintento puede responder; si
//     falla terminalmente, el agent_end final sin willRetry publica).
//   • errorMessage terminal → se publica tal cual (rama 1).
//   • lastMessageError terminal → se publica (rama 2, issue #6).
//   • sin texto ni tools ni error → fallback consciente del proveedor
//     (rama 3: DevEngine vs resto).
//   • con texto o tools → null (el turno produjo salida; no hay error).

import { describe, expect, it } from "vitest";
import { agentEndFallbackText } from "../src/agent-end-fallback";

const base = {
	hadText: false,
	hadToolCall: false,
	willRetry: false,
	isDevEngine: true,
	providerDisplayName: "DevEngine",
};

describe("agentEndFallbackText", () => {
	it("willRetry=true → null (el auto-retry responderá; no alarmar) — bug del mensaje fantasma", () => {
		expect(
			agentEndFallbackText({ ...base, willRetry: true, hadText: false }),
		).toBeNull();
	});

	it("willRetry=true con errorMessage → igualmente null (las ramas 1-2 ya filtraban)", () => {
		expect(
			agentEndFallbackText({
				...base,
				willRetry: true,
				errorMessage: "HTTP 500 fetch failed",
			}),
		).toBeNull();
	});

	it("errorMessage terminal → se publica tal cual", () => {
		expect(
			agentEndFallbackText({ ...base, errorMessage: "Invalid API key" }),
		).toBe("Invalid API key");
	});

	it("lastMessageError terminal (issue #6) → se publica", () => {
		expect(
			agentEndFallbackText({ ...base, lastMessageError: "model not found" }),
		).toBe("model not found");
	});

	it("sin texto/tools/error → fallback DevEngine con hint de diagnóstico", () => {
		const text = agentEndFallbackText({ ...base });
		expect(text).toContain("El modelo no generó respuesta");
		expect(text).toContain("Diagnosticar gateway DevEngine");
	});

	it("fallback de otro proveedor menciona su displayName y el panel de Proveedores", () => {
		const text = agentEndFallbackText({
			...base,
			isDevEngine: false,
			providerDisplayName: "Moonshot AI",
		});
		expect(text).toContain("(Moonshot AI)");
		expect(text).toContain("panel de Proveedores");
		expect(text).not.toContain("DevEngine");
	});

	it("el turno produjo texto (o tools) sin error → null", () => {
		expect(agentEndFallbackText({ ...base, hadText: true })).toBeNull();
		expect(agentEndFallbackText({ ...base, hadToolCall: true })).toBeNull();
	});

	it("errorMessage tiene precedencia sobre lastMessageError", () => {
		expect(
			agentEndFallbackText({
				...base,
				errorMessage: "E1",
				lastMessageError: "E2",
			}),
		).toBe("E1");
	});
});
