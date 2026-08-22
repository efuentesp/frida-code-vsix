/**
 * frida-antigravity (#97) — construcción de requests y mapping de respuesta.
 *
 * Contratos críticos del port (stream.ts exportado para tests, upstream lo
 * igual): conversión tools→Gemini con allowlist Protobuf para el puente
 * custom-tools (Claude/GPT), stopReason SSE→pi-ai y errores amigables.
 */
import { describe, expect, it } from "vitest";
import type { Api, Model, Context, Tool } from "@earendil-works/pi-ai";
import {
	convertTools,
	mapStopReason,
	friendlyAntigravityError,
} from "../../src/providers/frida-antigravity/stream/stream";
import { PROVIDER_ID } from "../../src/providers/frida-antigravity/models/models";

function fakeModel(id = "gemini-3.7-flash"): Model<Api> {
	return {
		id,
		provider: PROVIDER_ID,
		name: id,
		api: "antigravity-api",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1048576,
		maxTokens: 65536,
	} as unknown as Model<Api>;
}

describe("frida-antigravity · convertTools (puente custom-tools)", () => {
	it("Gemini usa parametersJsonSchema (JSON Schema nativo)", () => {
		const tools: Tool[] = [
			{
				name: "read",
				description: "lee archivos",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			} as unknown as Tool,
		];
		const out = convertTools(tools, false);
		expect(out?.[0]?.functionDeclarations[0]?.parametersJsonSchema).toBeDefined();
		expect(out?.[0]?.functionDeclarations[0]?.parameters).toBeUndefined();
	});

	it("Claude/GPT usan legacy `parameters` con allowlist Protobuf Schema", () => {
		const tools: Tool[] = [
			{
				name: "edit",
				description: "edita",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string", nullable: true },
						limit: { type: "integer", format: "int32" },
						mode: { type: ["string", "null"] },
					},
					required: ["path"],
					additionalProperties: false,
					anyOf: [{ type: "string" }],
				},
			} as unknown as Tool,
		];
		const out = convertTools(tools, true);
		const decl = out?.[0]?.functionDeclarations[0];
		expect(decl?.parameters).toBeDefined();
		expect(decl?.parametersJsonSchema).toBeUndefined();
		const params = decl?.parameters as Record<string, any>;
		// Allowlist: sólo type/description/properties/required/items/enum.
		expect(Object.keys(params).sort()).toEqual([
			"properties",
			"required",
			"type",
		]);
		// format/nullable/anyOf/aditionalProperties fuera; union → primer escalar.
		const props = params.properties as Record<string, any>;
		expect(Object.keys(props.limit ?? {})).toEqual(["type"]);
		expect(props.mode?.type).toBe("string");
		expect(props.path?.nullable).toBeUndefined();
	});

	it("sin tools → undefined (no se envía tools)", () => {
		expect(convertTools(undefined, false)).toBeUndefined();
		expect(convertTools([], false)).toBeUndefined();
	});
});

describe("frida-antigravity · mapStopReason (SSE → pi-ai)", () => {
	it("STOP→stop, MAX_TOKENS→length, otros→error, ausente→stop", () => {
		expect(mapStopReason("STOP")).toBe("stop");
		expect(mapStopReason("MAX_TOKENS")).toBe("length");
		expect(mapStopReason("SAFETY")).toBe("error");
		expect(mapStopReason(undefined)).toBe("stop");
	});
});

describe("frida-antigravity · friendlyAntigravityError", () => {
	it("401 → mensaje con acción de re-login", () => {
		expect(friendlyAntigravityError(401, "")).toMatch(/login antigravity/i);
	});

	it("429 con quota → espera + sugerencia de reset", () => {
		const msg = friendlyAntigravityError(
			429,
			"Individual quota reached. Resets in 1h 30m.",
		);
		expect(msg).toMatch(/Quota reached/);
		expect(msg).toMatch(/1h 30m/);
	});

	it("404 entidad no encontrada → lista de modelos sugeridos", () => {
		expect(
			friendlyAntigravityError(404, "Requested entity was not found"),
		).toMatch(/gemini-3\.7-flash/);
	});

	it("redacta secretos del body del error", () => {
		const msg = friendlyAntigravityError(400, "Bearer ya29.LEAKEDTOKEN xyz");
		expect(msg).not.toContain("LEAKEDTOKEN");
	});
});

describe("frida-antigravity · convertMessages (invariante Gemini)", () => {
	it("primer turno model → antepone user 'Hello' (backend 400 si no)", async () => {
		const { convertMessages } = await import(
			"../../src/providers/frida-antigravity/stream/stream"
		);
		const model = fakeModel();
		const context = {
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Hola, soy Frida" }],
				} as any,
			],
			systemPrompt: "",
			tools: [],
		} as unknown as Context;
		const contents = convertMessages(model, context, "gemini-3.7-flash-tiered");
		expect(contents[0]?.role).toBe("user");
		expect(contents[0]?.parts[0]).toEqual({ text: "Hello" });
	});

	it("thinking del MISMO provider/model viaja como thought:true con firma", async () => {
		const { convertMessages } = await import(
			"../../src/providers/frida-antigravity/stream/stream"
		);
		const model = fakeModel();
		const context = {
			messages: [
				{
					role: "assistant",
					provider: PROVIDER_ID,
					model: model.id,
					content: [
						{ type: "thinking", thinking: "razonando", thinkingSignature: "sig123" },
					],
				} as any,
			],
			systemPrompt: "",
			tools: [],
		} as unknown as Context;
		const contents = convertMessages(model, context, "gemini-3.7-flash-tiered");
		// El thinking quedó en el turno model (después del user Hello antepuesto).
		const modelTurn = contents.find((c) => c.role === "model");
		const part = modelTurn?.parts[0] as any;
		expect(part?.thought).toBe(true);
		expect(part?.thoughtSignature).toBe("sig123");
	});
});
