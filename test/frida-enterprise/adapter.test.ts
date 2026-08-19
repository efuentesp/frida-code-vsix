// ADR-1002 — TDD: contrato del adaptador puro Pi→Frida Enterprise.
// Estas pruebas se escribieron ANTES que la implementación (rojo → verde).
// El adaptador NO hace I/O: funciones puras, deterministas, sin estado global.

import { describe, expect, it } from "vitest";
import {
	apiForCapabilities,
	buildFridaPayload,
	classifyGatewayError,
	translateFridaResponse,
	translateFridaStreamChunk,
	endpointForCapabilities,
	identityFromToken,
	isSuggested,
	reasoningEffortTag,
	toProviderModel,
	payloadShapeTag,
} from "../../src/providers/frida-enterprise/adapter";

// ─── identityFromToken ───────────────────────────────────────────────────────

describe("identityFromToken", () => {
	const jwt = (claims: unknown) =>
		`x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

	it("extrae user_id y email de un idToken Firebase", () => {
		expect(
			identityFromToken(
				jwt({ user_id: "uid-1", email: "u@softtek.com", aud: "x" }),
			),
		).toEqual({ user_id: "uid-1", email: "u@softtek.com" });
	});

	it("sin user_id explícito cae a sub (claim estándar Firebase)", () => {
		expect(identityFromToken(jwt({ sub: "sub-9", email: "a@b.c" }))).toEqual({
			user_id: "sub-9",
			email: "a@b.c",
		});
	});

	it("sin identidad conocida → undefined (no objeto vacío)", () => {
		expect(identityFromToken(jwt({ aud: "x" }))).toBeUndefined();
	});

	it("token malformado → undefined, sin lanzar", () => {
		expect(identityFromToken("no-es-un-jwt")).toBeUndefined();
		expect(identityFromToken("")).toBeUndefined();
	});
});

// ─── buildFridaPayload ───────────────────────────────────────────────────────

describe("buildFridaPayload", () => {
	const identity = { user_id: "uid-1", email: "u@softtek.com" };

	it("injecta user_id, email y auto_log (contrato obligatorio del gateway)", () => {
		const out = buildFridaPayload(
			{ model: "M", messages: [], stream: true },
			identity,
		);
		expect(out.user_id).toBe("uid-1");
		expect(out.email).toBe("u@softtek.com");
		expect(out.auto_log).toBe(true);
	});

	it("identidad ausente: sin user_id/email, pero auto_log sigue presente", () => {
		const out = buildFridaPayload({ model: "M" }, {});
		expect(out.user_id).toBeUndefined();
		expect(out.email).toBeUndefined();
		expect(out.auto_log).toBe(true);
	});

	it("traduce reasoning_effort (OpenAI) → reasoning:{effort} (Frida)", () => {
		const out = buildFridaPayload(
			{ model: "M", reasoning_effort: "high" },
			identity,
		);
		expect(out.reasoning).toEqual({ effort: "high" });
		expect(out.reasoning_effort).toBeUndefined();
	});

	it("no sobreescribe un reasoning ya presente (ni toca reasoning_effort)", () => {
		const out = buildFridaPayload(
			{ model: "M", reasoning_effort: "low", reasoning: { effort: "high" } },
			identity,
		);
		expect(out.reasoning).toEqual({ effort: "high" });
		expect(out.reasoning_effort).toBe("low");
	});

	it("NO muta el payload de entrada y devuelve un objeto nuevo", () => {
		const input = {
			model: "M",
			messages: [{ role: "user", content: "hola" }],
			stream: true,
			max_tokens: 100,
			tools: [{ type: "function", function: { name: "bash" } }],
		};
		const frozen = JSON.parse(JSON.stringify(input));
		const out = buildFridaPayload(input, identity);
		expect(input).toEqual(frozen); // sin mutación
		expect(out).not.toBe(input); // objeto nuevo
	});

	it("passthrough exacto de model/messages/stream/max_tokens/tools/tool_choice", () => {
		const tools = [
			{
				type: "function",
				function: { name: "bash", parameters: { type: "object" } },
			},
		];
		const out = buildFridaPayload(
			{
				model: "NIKE-VICTORY",
				messages: [{ role: "user", content: "x" }],
				stream: true,
				stream_options: { include_usage: true },
				max_tokens: 4096,
				tools,
				tool_choice: "auto",
			},
			identity,
		);
		expect(out.model).toBe("NIKE-VICTORY");
		expect(out.messages).toEqual([{ role: "user", content: "x" }]);
		expect(out.stream).toBe(true);
		expect(out.stream_options).toEqual({ include_usage: true });
		expect(out.max_tokens).toBe(4096);
		expect(out.tools).toBe(tools); // misma referencia: passthrough, no copia
		expect(out.tool_choice).toBe("auto");
	});

	it("payload no-objeto se devuelve tal cual (defensivo)", () => {
		expect(buildFridaPayload(null as any, identity)).toBeNull();
	});
});

// ─── endpointForCapabilities ─────────────────────────────────────────────────

describe("buildFridaPayload: role developer → system (Errata-8)", () => {
	const identity = { user_id: "uid-1", email: "u@softtek.com" };

	it("traduce el system prompt de 'developer' a 'system' sin mutar el original", () => {
		const input = {
			model: "NIKE-VICTORY",
			stream: true,
			messages: [
				{ role: "developer", content: "Eres frida code…" },
				{ role: "user", content: "hola" },
			],
		};
		const frozen = JSON.parse(JSON.stringify(input));
		const out = buildFridaPayload(input, identity) as typeof input;
		expect(out.messages[0].role).toBe("system");
		expect(out.messages[0].content).toBe("Eres frida code…");
		expect(out.messages[1].role).toBe("user");
		expect(input).toEqual(frozen); // inmutabilidad preservada
	});

	it("no toca mensajes sin developer (user/assistant/tool pasan tal cual)", () => {
		const messages = [
			{ role: "user", content: "a" },
			{ role: "assistant", content: "b" },
			{ role: "tool", tool_call_id: "c1", content: "r" },
		];
		const out = buildFridaPayload({ model: "M", messages }, identity) as {
			messages: typeof messages;
		};
		expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
		expect(out.messages[2]).toBe(messages[2]); // misma referencia si no cambia
	});

	it("payload sin messages o messages no-array → intacto", () => {
		expect(buildFridaPayload({ model: "M" }, identity).messages).toBeUndefined();
		expect(buildFridaPayload({ model: "M", messages: "x" }, identity).messages).toBe("x");
	});
});

describe("endpointForCapabilities", () => {
	it("matriz completa de combinaciones reales del catálogo", () => {
		expect(endpointForCapabilities(["chat"])).toBe("chat");
		expect(endpointForCapabilities(["chat", "responses"])).toBe("chat");
		expect(endpointForCapabilities(["chat", "reasoning"])).toBe("chat");
		expect(endpointForCapabilities(["CHAT"])).toBe("chat"); // case-insensitive
		expect(endpointForCapabilities(["responses"])).toBe("responses");
		expect(endpointForCapabilities(["embeddings"])).toBe("embeddings");
		expect(endpointForCapabilities([])).toBe("none");
		expect(endpointForCapabilities(undefined)).toBe("none");
		expect(endpointForCapabilities("chat")).toBe("none"); // no-array
		expect(endpointForCapabilities(null)).toBe("none");
	});
});

// ─── toProviderModel ─────────────────────────────────────────────────────────

describe("toProviderModel", () => {
	it("mapea entrada chat del catálogo con baseUrl raíz+/v1 (Errata-4)", () => {
		const m = toProviderModel(
			{
				id: "model-a",
				capabilities: ["chat", "reasoning"],
				context_window_tokens: 256000,
				max_output_tokens: 65536,
			},
			"https://gw.example",
		);
		expect(m).toMatchObject({
			id: "model-a",
			reasoning: true,
			// clamp-200k: 256k anunciado → 200k efectivo (upstream Anthropic
			// rechaza >200k; incidente 2025-08-19)
			contextWindow: 200000,
			maxTokens: 65536,
			baseUrl: "https://gw.example/v1",
		});
	});

	it("anota la CLASE de tamaño en el nombre (grande/mediano/compacto/meta)", () => {
		const root = "https://gw.example";
		// 1M+ → grande (con ctx humano EFECTIVO — el tier se clasifica por el
		// anunciado pero el número mostrado es el clampeado a 200k)
		expect(
			toProviderModel(
				{ id: "M1", capabilities: ["chat"], context_window_tokens: 1000000 },
				root,
			)?.name,
		).toBe("M1 (grande 200k)");
		expect(
			toProviderModel(
				{ id: "M2", capabilities: ["chat"], context_window_tokens: 1050000 },
				root,
			)?.name,
		).toBe("M2 (grande 200k)");
		// 200k..1M → mediano
		expect(
			toProviderModel(
				{ id: "M3", capabilities: ["chat"], context_window_tokens: 262144 },
				root,
			)?.name,
		).toBe("M3 (mediano 200k)");
		expect(
			toProviderModel(
				{ id: "M4", capabilities: ["chat"], context_window_tokens: 400000 },
				root,
			)?.name,
		).toBe("M4 (mediano 200k)");
		// < 200k → compacto
		expect(
			toProviderModel(
				{ id: "M5", capabilities: ["chat"], context_window_tokens: 128000 },
				root,
			)?.name,
		).toBe("M5 (compacto 128k)");
		// default 200k (sin ctx declarado) → mediano
		expect(
			toProviderModel({ id: "M6", capabilities: ["chat"] }, root)?.name,
		).toBe("M6 (mediano 200k)");
		// router → meta
		expect(
			toProviderModel(
				{ id: "model-router", capabilities: ["chat"], context_window_tokens: 1000000 },
				root,
			)?.name,
		).toBe("model-router (meta)");
	});

	it("F3-c: ⭐ medidos (razonamiento observable 2026-08-16): DEMETER-BLOOM, TITAN-CROWN, MIDAS-GOLD", () => {
		// Criterio medido (reporte-reasoning.md): uno por clase que SÍ razona
		// visible. Los ⭐ previos (NIKE/SELENE/MERCURY) quedaron desplazados:
		// NIKE pierde el reasoning en la traducción Anthropic→responses del
		// gateway y MERCURY no expone razonamiento.
		expect(isSuggested("DEMETER-BLOOM")).toBe(true); // grande, 686 tk
		expect(isSuggested("TITAN-CROWN")).toBe(true); // mediano, 721 tk
		expect(isSuggested("MIDAS-GOLD")).toBe(true); // compacto, 805 tk
		// los ⭐ anteriores YA NO
		expect(isSuggested("NIKE-VICTORY")).toBe(false);
		expect(isSuggested("SELENE-CIPHER")).toBe(false);
		expect(isSuggested("MERCURY-WING")).toBe(false);
		expect(isSuggested("GAIA-FLARE")).toBe(false);
		expect(isSuggested("model-router")).toBe(false);
		expect(isSuggested("")).toBe(false);
	});

	it("F3-c: toProviderModel prefija ⭐ a los sugeridos medidos", () => {
		const root = "https://gw.example";
		expect(
			toProviderModel(
				{ id: "DEMETER-BLOOM", capabilities: ["chat", "responses"], context_window_tokens: 1000000 },
				root,
			)?.name,
		).toBe("⭐ DEMETER-BLOOM (responses, grande 200k)");
		expect(
			toProviderModel(
				{ id: "TITAN-CROWN", capabilities: ["chat", "responses"], context_window_tokens: 400000 },
				root,
			)?.name,
		).toBe("⭐ TITAN-CROWN (responses, mediano 200k)");
	});

	it("chat+responses anota '(responses, …)' combinado con la clase", () => {
		const m = toProviderModel(
			{ id: "model-e", capabilities: ["chat", "responses"] },
			"https://gw.example",
		);
		expect(m?.name).toBe("model-e (responses, mediano 200k)");
	});

	it("no-chat (responses-only/embeddings/caps vacías/ausentes) → undefined", () => {
		const root = "https://gw.example";
		expect(
			toProviderModel({ id: "r", capabilities: ["responses"] }, root),
		).toBeUndefined();
		expect(
			toProviderModel({ id: "e", capabilities: ["embeddings"] }, root),
		).toBeUndefined();
		expect(toProviderModel({ id: "x", capabilities: [] }, root)).toBeUndefined();
		expect(toProviderModel({ id: "y" }, root)).toBeUndefined();
		expect(toProviderModel({ capabilities: ["chat"] }, root)).toBeUndefined();
	});

	it("defaults 200k/128k cuando el gateway no los expone", () => {
		const m = toProviderModel(
			{ id: "m", capabilities: ["chat"] },
			"https://gw.example",
		);
		expect(m?.contextWindow).toBe(200000);
		expect(m?.maxTokens).toBe(128000);
	});
});

// ─── classifyGatewayError ────────────────────────────────────────────────────

describe("translateFridaResponse (Frida → Pi, respuesta final)", () => {
	it("traduce texto, reasoning_content, tool_calls, finish_reason y usage", () => {
		const out = translateFridaResponse({
			id: "chatcmpl-1",
			model: "NIKE-VICTORY",
			choices: [
				{
					message: {
						role: "assistant",
						content: "resultado",
						reasoning_content: "pensamiento",
						tool_calls: [
							{
								id: "call-1",
								type: "function",
								function: { name: "bash", arguments: JSON.stringify({ command: "echo hola" }) },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		});
		expect(out).toMatchObject({
			content: "resultado",
			reasoning: "pensamiento",
			finishReason: "toolUse",
			usage: { input: 10, output: 5, totalTokens: 15 },
		});
		expect(out.toolCalls?.[0]).toMatchObject({
			id: "call-1",
			name: "bash",
			arguments: { command: "echo hola" },
		});
	});

	it("normaliza finish_reason length/stop/function_call", () => {
		expect(translateFridaResponse({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }).finishReason).toBe("stop");
		expect(translateFridaResponse({ choices: [{ message: { content: "x" }, finish_reason: "length" }] }).finishReason).toBe("length");
		expect(translateFridaResponse({ choices: [{ message: { content: "x" }, finish_reason: "function_call" }] }).finishReason).toBe("toolUse");
	});
});

describe("translateFridaStreamChunk (Frida SSE → Pi events)", () => {
	it("traduce delta de texto", () => {
		expect(translateFridaStreamChunk({ choices: [{ delta: { content: "hola" }, finish_reason: null }] })).toEqual({
			type: "text_delta",
			text: "hola",
		});
	});

	it("traduce delta de reasoning y cierre", () => {
		expect(translateFridaStreamChunk({ choices: [{ delta: { reasoning_content: "pensando" }, finish_reason: null }] })).toEqual({
			type: "reasoning_delta",
			text: "pensando",
		});
		expect(translateFridaStreamChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })).toEqual({
			type: "done",
			finishReason: "toolUse",
		});
	});

	it("traduce delta de tool call con arguments string u objeto", () => {
		const out = translateFridaStreamChunk({
			choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "bash", arguments: JSON.stringify({ command: "ls" }) } }] }, finish_reason: null }],
		});
		expect(out).toMatchObject({ type: "tool_call_delta", index: 0, id: "c", name: "bash", arguments: { command: "ls" } });
	});
});

describe("classifyGatewayError (errores reales capturados en vivo)", () => {
	it("401/403 → auth-expired (re-login)", () => {
		expect(classifyGatewayError(401).kind).toBe("auth-expired");
		expect(classifyGatewayError(403).kind).toBe("auth-expired");
	});

	it("422 con detalle FastAPI de user_id/email → identity", () => {
		const body = JSON.stringify({
			detail: [
				{ type: "missing", loc: ["body", "user_id"], msg: "Field required" },
			],
		});
		expect(classifyGatewayError(422, body).kind).toBe("identity");
	});

	it("400 'not available for chat' → model-unavailable", () => {
		expect(
			classifyGatewayError(400, '{"detail":"Model \'X\' is not available for chat."}')
				.kind,
		).toBe("model-unavailable");
	});

	it("502 con detalle de backend → model-unavailable", () => {
		expect(
			classifyGatewayError(502, '{"detail":"Unknown or unsupported provider"}')
				.kind,
		).toBe("model-unavailable");
	});

	it("422 sin detalle conocido / 500 → unknown", () => {
		expect(classifyGatewayError(422).kind).toBe("unknown");
		expect(classifyGatewayError(500).kind).toBe("unknown");
	});
});

// ─── ADR-1003: dual-endpoint + reasoning ─────────────────────────────────────

describe("apiForCapabilities (ADR-1003: responses tiene prioridad, como la original)", () => {
	it("caps [chat,responses] → openai-responses (NIKE-VICTORY y los 38 'responses')", () => {
		expect(apiForCapabilities(["chat", "responses"])).toBe("openai-responses");
	});

	it("caps [chat] → openai-completions (SELENE-CIPHER y los sólo-chat)", () => {
		expect(apiForCapabilities(["chat"])).toBe("openai-completions");
	});

	it("caps [responses] sin chat → openai-responses también sirve", () => {
		expect(apiForCapabilities(["responses"])).toBe("openai-responses");
	});

	it("embeddings / vacías / no-array → undefined (fuera del catálogo)", () => {
		expect(apiForCapabilities(["embeddings"])).toBeUndefined();
		expect(apiForCapabilities([])).toBeUndefined();
		expect(apiForCapabilities(undefined)).toBeUndefined();
		expect(apiForCapabilities("chat" as unknown as string[])).toBeUndefined();
	});
});

describe("toProviderModel: dual-endpoint (ADR-1003)", () => {
	const ROOT = "https://gw.example";

	it("modelo con responses en capabilities → api openai-responses, baseUrl {root}/v1", () => {
		const m = toProviderModel(
			{ id: "NIKE-VICTORY", capabilities: ["chat", "responses"], context_window_tokens: 1_000_000, max_output_tokens: 128_000 },
			ROOT,
		);
		expect(m).toBeDefined();
		expect(m!.api).toBe("openai-responses");
		expect(m!.baseUrl).toBe("https://gw.example/v1");
	});

	it("modelo sólo chat → api openai-completions", () => {
		const m = toProviderModel(
			{ id: "SELENE-CIPHER", capabilities: ["chat"] },
			ROOT,
		);
		expect(m).toBeDefined();
		expect(m!.api).toBe("openai-completions");
	});

	it("reasoning:true aunque el gateway no declare la capability reasoning (ADR-1003 E5/E6: lo decide el endpoint/modelo)", () => {
		const nike = toProviderModel({ id: "NIKE-VICTORY", capabilities: ["chat", "responses"] }, ROOT);
		const selene = toProviderModel({ id: "SELENE-CIPHER", capabilities: ["chat"] }, ROOT);
		expect(nike!.reasoning).toBe(true);
		expect(selene!.reasoning).toBe(true);
	});

	it("compat.supportsReasoningEffort:true SÓLO para modelos chat (responses la lleva nativa)", () => {
		const nike = toProviderModel({ id: "NIKE-VICTORY", capabilities: ["chat", "responses"] }, ROOT);
		const selene = toProviderModel({ id: "SELENE-CIPHER", capabilities: ["chat"] }, ROOT);
		expect((selene as any).compat).toEqual({ supportsReasoningEffort: true });
		expect((nike as any).compat?.supportsReasoningEffort).toBeUndefined();
	});

	it("responses-only sin chat sigue excluido del catálogo (no hay adapter que lo pida)", () => {
		// HEPHAESTUS-ANVIL etc: caps ["responses"] solas. La original los enruta por
		// responses, pero NO están en el catálogo verificado chat; se mantienen fuera.
		const m = toProviderModel({ id: "HEPHAESTUS-ANVIL", capabilities: ["responses"] }, ROOT);
		expect(m).toBeUndefined();
	});

	it("embeddings sigue excluido", () => {
		expect(toProviderModel({ id: "MNEMOSYNE-THREAD", capabilities: ["embeddings"] }, ROOT)).toBeUndefined();
	});
});

describe("buildFridaPayload: developer→system también en input (Errata-8 responses, E3/E10)", () => {
	it("traduce role developer a system dentro de input[] (payload openai-responses)", () => {
		const out = buildFridaPayload(
			{
				model: "NIKE-VICTORY",
				input: [
					{ role: "developer", content: "Eres un asistente" },
					{ role: "user", content: [{ type: "input_text", text: "hola" }] },
				],
				stream: true,
			},
			{ user_id: "u1", email: "a@b.c" },
		);
		expect((out.input as any[])[0].role).toBe("system");
		expect((out.input as any[])[1].role).toBe("user");
		// no muta el original
	});

	it("input con developer NO muta el payload de entrada", () => {
		const original = {
			input: [{ role: "developer", content: "x" }],
		};
		const out = buildFridaPayload(original as any, { user_id: "u", email: "e" });
		expect((original.input as any[])[0].role).toBe("developer");
		expect((out.input as any[])[0].role).toBe("system");
	});

	it("input sin developer pasa intacto (por referencia si no hay cambios)", () => {
		const original = { input: [{ role: "user", content: "x" }] };
		const out = buildFridaPayload(original as any, { user_id: "u", email: "e" });
		expect((out.input as any[])[0].role).toBe("user");
	});

	it("input no-array → intacto", () => {
		const out = buildFridaPayload({ input: "no-array" } as any, {
			user_id: "u",
			email: "e",
		});
		expect(out.input).toBe("no-array");
	});

	it("reasoning_effort → reasoning:{effort} también con input (canal responses)", () => {
		const out = buildFridaPayload(
			{ model: "M", input: [], stream: true, reasoning_effort: "high" },
			{ user_id: "u", email: "e" },
		);
		expect(out.reasoning).toEqual({ effort: "high" });
		expect(out.reasoning_effort).toBeUndefined();
	});

	it("no fabrica reasoning si ya existe (responses nativo con summary)", () => {
		const out = buildFridaPayload(
			{ model: "M", input: [], reasoning: { effort: "medium", summary: "auto" }, reasoning_effort: "high" },
			{ user_id: "u", email: "e" },
		);
		expect(out.reasoning).toEqual({ effort: "medium", summary: "auto" });
	});
});

// ─── Errata-13 fix: traducción de items previos del assistant ────────────────

describe("buildFridaPayload: traducción Errata-13 (output_text→input_text, drop reasoning)", () => {
	const ID = { user_id: "u1", email: "u@x.com" };

	it("assistant previo: content output_text → input_text (el gateway 500-kea con output_text)", () => {
		const out = buildFridaPayload({
			input: [
				{ role: "system", content: [{ type: "input_text", text: "s" }] },
				{ role: "user", content: [{ type: "input_text", text: "u" }] },
				{
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "Hace 22°C.", annotations: [] }],
					status: "completed",
					id: "msg_1",
				},
				{ role: "user", content: [{ type: "input_text", text: "gracias" }] },
			],
		}, ID);
		const ast = (out.input as any[]).find((i) => i.role === "assistant");
		expect(ast.content[0].type).toBe("input_text");
		expect(ast.content[0].text).toBe("Hace 22°C.");
		// el resto del item se preserva (id/status — forma estándar OpenAI)
		expect(ast.id).toBe("msg_1");
		expect(ast.status).toBe("completed");
	});

	it("items reasoning se DESCARTAN (el gateway 500-kea con ellos)", () => {
		const out = buildFridaPayload({
			input: [
				{ role: "user", content: [{ type: "input_text", text: "hola" }] },
				{ type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "x" }], encrypted_content: "ENC" },
				{
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "respuesta" }],
				},
			],
		}, ID);
		const types = (out.input as any[]).map((i) => i.type ?? i.role);
		expect(types).toEqual(["user", "message"]); // reasoning descartado
	});

	it("function_call / function_call_output pasan INTACTOS (el gateway los acepta)", () => {
		const fc = { type: "function_call", call_id: "c1", name: "get_weather", arguments: "{}" };
		const fco = { type: "function_call_output", call_id: "c1", output: '{"temp":22}' };
		const out = buildFridaPayload({ input: [{ role: "user", content: "u" }, fc, fco] }, ID);
		expect((out.input as any[])[1]).toEqual(fc);
		expect((out.input as any[])[2]).toEqual(fco);
	});

	it("developer→system (Errata-8) sigue aplicando JUNTO a la traducción", () => {
		const out = buildFridaPayload({
			input: [
				{ role: "developer", content: [{ type: "input_text", text: "s" }] },
				{ type: "reasoning", id: "rs_1", summary: [] },
			],
		}, ID);
		expect((out.input as any[])[0].role).toBe("system");
		expect((out.input as any[]).length).toBe(1);
	});

	it("sin items problemáticos → input queda igual (misma referencia)", () => {
		const input = [
			{ role: "system", content: [{ type: "input_text", text: "s" }] },
			{ role: "user", content: [{ type: "input_text", text: "u" }] },
		];
		const out = buildFridaPayload({ input }, ID);
		expect(out.input).toBe(input);
	});

	it("la rama chat (messages) NO se toca", () => {
		const messages = [
			{ role: "system", content: "s" },
			{ role: "assistant", content: "texto" },
		];
		const out = buildFridaPayload({ messages }, ID);
		expect(out.messages).toBe(messages);
	});
});

// ─── Errata-13: shape del payload (diagnóstico del 500 multi-turno) ──────────

describe("payloadShapeTag (histograma role:type, para el dbg del hook)", () => {
	it("responses: codifica roles, tipos de item y content-types", () => {
		const tag = payloadShapeTag({
			input: [
				{ role: "system", content: [{ type: "input_text", text: "s" }] },
				{ role: "user", content: [{ type: "input_text", text: "u" }] },
				{ role: "assistant", content: [{ type: "output_text", text: "a" }] },
				{ type: "reasoning", id: "rs_1", summary: [] },
				{ type: "function_call", call_id: "c1", name: "t", arguments: "{}" },
				{ type: "function_call_output", call_id: "c1", output: "r" },
			],
		});
		// Lo que pi-ai manda en el turno 2 real (el que el gateway 500-kea):
		// assistant con output_text + item reasoning (Errata-13).
		expect(tag).toBe(
			"shape=input[system(input_text),user(input_text),assistant(output_text),reasoning,fc,fc_out]",
		);
	});

	it("chat: roles con tool_calls marcados", () => {
		const tag = payloadShapeTag({
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "u" },
				{ role: "assistant", content: null, tool_calls: [{ id: "c1" }] },
				{ role: "tool", tool_call_id: "c1", content: "r" },
			],
		});
		expect(tag).toBe("shape=msgs[system,user,assistant(tool_calls),tool]");
	});

	it("rol repetido → cuenta compacta user×2", () => {
		const tag = payloadShapeTag({
			input: [
				{ role: "user", content: "u1" },
				{ role: "user", content: "u2" },
			],
		});
		expect(tag).toBe("shape=input[user×2]");
	});

	it("sin input ni messages → shape=—", () => {
		expect(payloadShapeTag({ model: "x" })).toBe("shape=—");
		expect(payloadShapeTag(undefined)).toBe("shape=—");
	});

	it("items raros no lanzan (defensivo, Errata-6)", () => {
		expect(payloadShapeTag({ input: [null, 42, {}] })).toMatch(/^shape=input\[/);
	});
});

// ─── ADR-1003-F2: observabilidad + off explícito del nivel de razonamiento ──

describe("reasoningEffortTag (observabilidad del effort en el dbg del hook)", () => {
	it("payload chat traducido (reasoning:{effort}) → reasoning=<effort>", () => {
		expect(reasoningEffortTag({ reasoning: { effort: "high" } })).toBe("reasoning=high");
		expect(reasoningEffortTag({ reasoning: { effort: "none" } })).toBe("reasoning=none");
	});

	it("payload responses (effort+summary) → reasoning=<effort>(<summary>)", () => {
		expect(
			reasoningEffortTag({ reasoning: { effort: "high", summary: "auto" } }),
		).toBe("reasoning=high(auto)");
	});

	it("payload sin traducir (reasoning_effort crudo) también lo reporta", () => {
		expect(reasoningEffortTag({ reasoning_effort: "medium" })).toBe("reasoning=medium");
	});

	it("payload SIN effort → reasoning=ausente (el gateway aplicará su default)", () => {
		expect(reasoningEffortTag({})).toBe("reasoning=ausente");
		expect(reasoningEffortTag({ reasoning: { summary: "auto" } })).toBe("reasoning=ausente");
	});

	it("payload malformado → ausente, sin lanzar (defensivo Errata-6)", () => {
		expect(() => reasoningEffortTag(undefined as any)).not.toThrow();
		expect(reasoningEffortTag({ reasoning: "no-objeto" } as any)).toBe("reasoning=ausente");
	});
});

describe("thinkingLevelMap: nivel Off del footer explícito para modelos chat", () => {
	const ROOT = "https://gw.example";

	it("modelo sólo-chat → thinkingLevelMap {off:'none'} (pi-ai emite reasoning_effort none al apagar)", () => {
		const m = toProviderModel(
			{ id: "SELENE-CIPHER", capabilities: ["chat"] },
			ROOT,
		);
		expect((m as any)?.thinkingLevelMap).toEqual({ off: "none" });
	});

	it("modelo responses (NIKE) → SIN thinkingLevelMap (pi-ai ya manda effort none nativo)", () => {
		const m = toProviderModel(
			{ id: "NIKE-VICTORY", capabilities: ["chat", "responses"] },
			ROOT,
		);
		expect((m as any)?.thinkingLevelMap).toBeUndefined();
	});

	it("getSupportedThinkingLevels sigue igual: off..high (sin xhigh/max)", () => {
		// thinkingLevelMap {off:'none'} NO restringe los niveles disponibles: sólo
		// mapea off→'none' en el payload. minimal/low/medium/high pasan tal cual.
		const m: any = toProviderModel(
			{ id: "SELENE-CIPHER", capabilities: ["chat"] },
			ROOT,
		);
		expect(Object.keys(m.thinkingLevelMap)).toEqual(["off"]);
		expect(m.thinkingLevelMap.minimal).toBeUndefined();
	});

	it("regresión: reasoning_effort 'none' se traduce a reasoning:{effort:'none'}", () => {
		const out = buildFridaPayload(
			{ model: "SELENE-CIPHER", messages: [], reasoning_effort: "none" },
			{ user_id: "u", email: "e" },
		);
		expect(out.reasoning).toEqual({ effort: "none" });
		expect(out.reasoning_effort).toBeUndefined();
	});
});
