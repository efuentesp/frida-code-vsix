// E2E (ADR-1002, TDD): el camino REAL de frida code contra un gateway grabado.
//
// ExtensionRunner real + oauth real (getApiKey) + adapter openai-completions
// real de pi-ai + servidor HTTP local. El orden de eventos replica models.js:
// getApiKey → before_provider_headers → before_provider_request → HTTP.
//
// Escenarios (los marcados [RED] fallan con el código actual — son el bug):
//   S1  happy path: ctx.model frida + getApiKey  → identidad inyectada
//   S2  [RED] ctx.model undefined (getModel sin bindCore, el DEFAULT del
//       runner) + headers-first → identidad AUN ASÍ inyectada
//   S2b [RED] ctx.model getter que LANZA → identidad inyectada (el runner
//       traga errores de handlers: hoy la inyección se pierde en silencio)
//   S3  seguridad: model undefined y sin identidad frida vista → NO inyectar
//   S4  seguridad: model zai → NO inyectar (otros providers intactos)
//   S5  [RED] un Bearer no-Frida (zai) en before_provider_headers NO debe
//       borrar la identidad frida ya capturada

import { describe, expect, it, vi } from "vitest";
import { collectStream, loadRuntimeTools, makeRunner } from "./harness";

/** Barrel fresco por escenario: el runtime compartido oauth↔hooks arranca limpio. */
async function freshBarrel() {
	vi.resetModules();
	return await import("../../../src/providers/frida-enterprise");
}

function makeIdToken(claims: object) {
	return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
}

const ID_TOKEN = makeIdToken({
	user_id: "uid-e2e",
	email: "e2e@softtek.com",
	aud: "frida-code-copilot-enterprise",
});
const CREDENTIAL = { access: ID_TOKEN, refresh: "RF", expires: 1 };

function fridaModel(baseUrl: string) {
	return {
		id: "NIKE-VICTORY",
		provider: "frida-enterprise",
		api: "openai-completions",
		baseUrl, // .../v1 como el catálogo del provider
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

/** Una generación completa por el camino real; devuelve el barrel y la request. */
async function generate(opts: {
	serverUrl: string;
	setup: (hooks: Awaited<ReturnType<typeof makeRunner>>, barrel: any) => void;
	model?: any;
	withTools?: boolean;
	withGetApiKey?: boolean;
	headers?: Record<string, string>;
	systemPrompt?: string;
}) {
	const barrel = await freshBarrel();
	const { loadOpenAICompletions } = await import("./harness");
	const { stream } = await loadOpenAICompletions();
	const hooks = await makeRunner();
	opts.setup(hooks, barrel);

	if (opts.withGetApiKey !== false) {
		// auth resolution real: getApiKey alimenta la identidad ANTES del stream
		expect(barrel.buildFridaEnterpriseOAuth().getApiKey(CREDENTIAL)).toBe(
			ID_TOKEN,
		);
	}

	// models.js de pi-ai: headers (before_provider_headers) ANTES de api.stream.
	const headers = opts.headers ?? { Authorization: `Bearer ${ID_TOKEN}` };
	await hooks.runner.emitBeforeProviderHeaders(headers);

	const model = opts.model ?? fridaModel(`${opts.serverUrl}/v1`);
	const context: any = {
		messages: [{ role: "user", content: [{ type: "text", text: "Di: pong" }] }],
	};
	if (opts.systemPrompt) context.systemPrompt = opts.systemPrompt;
	if (opts.withTools) context.tools = loadRuntimeTools();

	const result = await collectStream(
		stream(model, context, {
			apiKey: ID_TOKEN,
			headers,
			maxTokens: 512,
			onPayload: (payload: any) => hooks.runner.emitBeforeProviderRequest(payload),
		}),
	);
	return { barrel, result };
}

describe("E2E runtime real → gateway grabado", () => {
	it("S1 happy path: URL /v1/chat/completions, Bearer idToken, identidad y tools reales", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			const { result } = await generate({
				serverUrl: server.url,
				withTools: true,
				setup: (h, barrel) => {
					h.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
					h.setModel(fridaModel(`${server.url}/v1`));
				},
			});
			const req = server.requests[0];
			expect(req.method).toBe("POST");
			expect(req.url).toBe("/v1/chat/completions");
			expect(req.authorization).toBe(`Bearer ${ID_TOKEN}`);
			expect(req.body.model).toBe("NIKE-VICTORY");
			expect(req.body.user_id).toBe("uid-e2e");
			expect(req.body.email).toBe("e2e@softtek.com");
			expect(req.body.auto_log).toBe(true);
			const names = (req.body.tools ?? []).map((t: any) => t.function.name);
			expect(names).toEqual(
				expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find", "ls"]),
			);
			const msg = result;
			expect(msg?.stopReason).not.toBe("error");
		} finally {
			await server.close();
		}
	});

	it("S2 [RED] ctx.model undefined (default del runner) → identidad IGUAL inyectada vía headers-first", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			await generate({
				serverUrl: server.url,
				setup: (h, barrel) => {
					h.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
					// NO setModel: getModel queda en el default () => undefined,
					// como un runner sin bindCore (p.ej. sesión de título/summarize).
				},
			});
			const body = server.requests[0].body;
			expect(body.user_id).toBe("uid-e2e");
			expect(body.email).toBe("e2e@softtek.com");
			expect(body.auto_log).toBe(true);
		} finally {
			await server.close();
		}
	});

	it("S2b [RED] ctx.model getter que lanza → identidad inyectada", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			await generate({
				serverUrl: server.url,
				setup: (h, barrel) => {
					h.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
					h.breakModel();
				},
			});
			const body = server.requests[0].body;
			expect(body.user_id).toBe("uid-e2e");
			expect(body.auto_log).toBe(true);
		} finally {
			await server.close();
		}
	});

	it("S3 seguridad: sin identidad frida vista → no inyectar nada (ni auto_log)", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			await generate({
				serverUrl: server.url,
				withGetApiKey: false,
				headers: { Authorization: "Bearer sk-zai-no-es-jwt" },
				setup: (h, barrel) => {
					h.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
					// sin setModel, sin getApiKey, sin Bearer frida
				},
			});
			const body = server.requests[0].body;
			expect(body.user_id).toBeUndefined();
			expect(body.email).toBeUndefined();
			expect(body.auto_log).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	it("S4 seguridad: model zai → payload de otro provider intacto", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			const zaiModel = {
				id: "glm-5.2",
				provider: "zai",
				api: "openai-completions",
				baseUrl: `${server.url}/v1`,
				contextWindow: 200_000,
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			};
			await generate({
				serverUrl: server.url,
				model: zaiModel,
				// identidad frida PRESENTE (getApiKey corre) y aun así no inyecta
				setup: (h, barrel) => {
					h.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
					h.setModel(zaiModel);
				},
			});
			const body = server.requests[0].body;
			expect(body.user_id).toBeUndefined();
			expect(body.email).toBeUndefined();
			expect(body.auto_log).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	it("S6 [RED·Errata-7] ctx.model VENCIDO dice zai pero el request es frida (payload NIKE) → inyecta IGUAL", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			// Escenario REAL observado en el debug log del host (15:32:59):
			// la request llevaba NIKE-VICTORY pero ctx.model decía zai.
			await generate({
				serverUrl: server.url,
				model: fridaModel(`${server.url}/v1`), // payload.model = NIKE-VICTORY
				setup: (h, barrel) => {
					h.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
					h.setModel({
						id: "glm-5.2",
						provider: "zai", // ← ctx VENCIDO que apunta a otro provider
						api: "openai-completions",
						baseUrl: `${server.url}/v1`,
						contextWindow: 200_000,
						reasoning: true,
						input: ["text", "image"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					});
				},
			});
			const body = server.requests[0].body;
			expect(body.model).toBe("NIKE-VICTORY");
			expect(body.user_id).toBe("uid-e2e");
			expect(body.auto_log).toBe(true);
		} finally {
			await server.close();
		}
	});

	it("S7 [RED·Errata-7] ctx.model dice frida pero payload es de OTRO provider (glm) → NO inyecta", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			const zaiPayloadModel = {
				id: "glm-5.2",
				provider: "zai",
				api: "openai-completions",
				baseUrl: `${server.url}/v1`,
				contextWindow: 200_000,
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			};
			await generate({
				serverUrl: server.url,
				model: zaiPayloadModel, // el request REAL es z.ai
				setup: (h, barrel) => {
					h.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
					// ctx miente al revés: dice frida
					h.setModel(fridaModel(`${server.url}/v1`));
					// identidad frida PRESENTE (getApiKey corre en generate)
				},
			});
			const body = server.requests[0].body;
			expect(body.model).toBe("glm-5.2");
			expect(body.user_id).toBeUndefined();
			expect(body.auto_log).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	it("S8 [RED·Errata-8] systemPrompt + modelo reasoning: SDK manda 'developer', el gateway exige 'system'", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			await generate({
				serverUrl: server.url,
				systemPrompt: "Eres frida code, asistente de código.",
				setup: (h, barrel) => {
					h.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
					h.setModel(fridaModel(`${server.url}/v1`));
				},
			});
			const body = server.requests[0].body;
			expect(body.messages[0].role).toBe("system");
			expect(body.messages[0].content).toContain("frida code");
			expect(body.user_id).toBe("uid-e2e");
		} finally {
			await server.close();
		}
	});

	it("S5 [RED] Bearer no-Frida en headers NO borra la identidad frida capturada", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			const barrel = await freshBarrel();
			const { loadOpenAICompletions } = await import("./harness");
			const { stream } = await loadOpenAICompletions();
			const hooks = await makeRunner();
			hooks.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
			// sin setModel: la puerta depende de la identidad (escenario S2)

			// 1) auth frida resuelta → identidad capturada
			barrel.buildFridaEnterpriseOAuth().getApiKey(CREDENTIAL);
			// 2) request de OTRA provider pasa por headers con su Bearer…
			await hooks.runner.emitBeforeProviderHeaders({
				Authorization: "Bearer sk-zai-no-es-jwt",
			});
			// 3) la request frida posterior conserva la identidad
			const fridaHeaders = { Authorization: `Bearer ${ID_TOKEN}` };
			await hooks.runner.emitBeforeProviderHeaders(fridaHeaders);
			await collectStream(
				stream(fridaModel(`${server.url}/v1`), {
					messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
				} as any, {
					apiKey: ID_TOKEN,
					headers: fridaHeaders,
					maxTokens: 64,
					onPayload: (p: any) => hooks.runner.emitBeforeProviderRequest(p),
				}),
			);
			const body = server.requests[0].body;
			expect(body.user_id).toBe("uid-e2e");
			expect(body.auto_log).toBe(true);
		} finally {
			await server.close();
		}
	});
});

// ─── ADR-1003: camino /v1/responses (modelos con capability "responses") ────

describe("E2E runtime real → /v1/responses (openai-responses de pi-ai)", () => {
	/** SSE mínimo válido del endpoint responses: reasoning summary + texto +
	 *  completed (los tipos que pi-ai openai-responses-shared traduce). */
	function sseResponses(think: string, text: string): string {
		const chunks = [
			{ type: "response.created", response: { id: "resp_e2e", status: "in_progress" } },
			// El parser de pi-ai crea slots por output_item.added (sin esto, los
			// deltas se ignoran: getSlot devuelve null y continúa en silencio).
			{ type: "response.output_item.added", output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [] } },
			{ type: "response.reasoning_summary_text.delta", output_index: 0, delta: think },
			{ type: "response.reasoning_summary_text.done", output_index: 0, text: think },
			{ type: "response.output_item.added", output_index: 1, item: { id: "msg_1", type: "message", content: [] } },
			{ type: "response.output_text.delta", output_index: 1, delta: text },
			{ type: "response.output_text.done", output_index: 1, text },
			{
				type: "response.completed",
				response: {
					id: "resp_e2e",
					status: "completed",
					usage: { input_tokens: 9, output_tokens: 5, total_tokens: 14 },
				},
			},
		];
		return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
	}

	function responsesModel(baseUrl: string) {
		return {
			...fridaModel(baseUrl),
			api: "openai-responses",
			compat: undefined,
		};
	}

	it("S9 ADR-1003: URL /v1/responses, sin 'developer' en input, reasoning presente, identidad inyectada y thinking traducido", async () => {
		const { startRecorder, sseText: _unused } = await import("./harness");
		const server = await startRecorder();
		server.respond(() => sseResponses("Estoy pensando…", "pong"));
		try {
			const barrel = await freshBarrel();
			const { loadOpenAIResponses } = await import("./harness");
			const { stream } = await loadOpenAIResponses();
			const hooks = await makeRunner();
			hooks.register(
				barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }),
			);
			hooks.setModel(responsesModel(`${server.url}/v1`));
			expect(barrel.buildFridaEnterpriseOAuth().getApiKey(CREDENTIAL)).toBe(ID_TOKEN);
			const headers = { Authorization: `Bearer ${ID_TOKEN}` };
			await hooks.runner.emitBeforeProviderHeaders(headers);

			const result = await collectStream(
				stream(responsesModel(`${server.url}/v1`) as any, {
					systemPrompt: "Eres un asistente breve.",
					messages: [
						{ role: "user", content: [{ type: "text", text: "Di: pong" }] },
					],
				} as any, {
					apiKey: ID_TOKEN,
					headers,
					maxTokens: 512,
					reasoningEffort: "high",
					onPayload: (payload: any) =>
						hooks.runner.emitBeforeProviderRequest(payload),
				}),
			);

			const req = server.requests[0];
			// Endpoint correcto (E4: capability responses ⇒ /v1/responses)
			expect(req.url).toBe("/v1/responses");
			expect(req.authorization).toBe(`Bearer ${ID_TOKEN}`);
			// Errata-8 (responses): el adapter manda system como "developer";
			// buildFridaPayload DEBE traducirlo a "system" (E3: 500 si no)
			const roles = (req.body.input ?? []).map((i: any) => i.role);
			expect(roles).not.toContain("developer");
			expect(roles).toContain("system");
			// El reasoning va nativo del adapter (E7: {effort, summary})
			expect(req.body.reasoning).toMatchObject({ effort: "high" });
			expect(req.body.reasoning.summary).toBeDefined();
			// Contrato de identidad (E2)
			expect(req.body.user_id).toBe("uid-e2e");
			expect(req.body.email).toBe("e2e@softtek.com");
			expect(req.body.auto_log).toBe(true);
			expect(req.body.model).toBe("NIKE-VICTORY");
			expect(req.body.store).toBe(false);
			// El stream traduce reasoning_summary → thinking (E9) y el texto llega
			expect(result?.stopReason).not.toBe("error");
			const joined = (result?.content ?? [])
				.map((b: any) => (b.type === "thinking" ? b.thinking : b.type === "text" ? b.text : ""))
				.join("");
			expect(joined).toContain("Estoy pensando");
			expect(joined).toContain("pong");
		} finally {
			await server.close();
		}
	});

	it("S13 Errata-13: turno 2 (assistant previo + toolResult) viaja traducido — sin reasoning items, output_text→input_text, fc intactos", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		server.respond(() => sseResponses("pensando…", "listo"));
		try {
			const barrel = await freshBarrel();
			const { loadOpenAIResponses } = await import("./harness");
			const { stream } = await loadOpenAIResponses();
			const hooks = await makeRunner();
			hooks.register(
				barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }),
			);
			hooks.setModel(responsesModel(`${server.url}/v1`));
			const headers = { Authorization: `Bearer ${ID_TOKEN}` };
			await hooks.runner.emitBeforeProviderHeaders(headers);

			// Turno 2 real: assistant previo con thinking(firma=reasoning item)
			// + texto + toolCall, seguido del toolResult — lo que pi-ai
			// convierte a assistant(output_text)+reasoning+fc+fc_out.
			const result = await collectStream(
				stream(responsesModel(`${server.url}/v1`) as any, {
					systemPrompt: "Eres un asistente breve.",
					messages: [
						{ role: "user", content: [{ type: "text", text: "clima de CDMX?" }] },
						{
							role: "assistant",
							content: [
								{
									type: "thinking",
									thinking: "Voy a consultar la herramienta",
									thinkingSignature: JSON.stringify({
										type: "reasoning",
										id: "rs_previo",
										summary: [],
									}),
								},
								{ type: "text", text: "Consulto el clima." },
								{
									type: "toolCall",
									id: "call-1|fc_1",
									name: "get_weather",
									arguments: { city: "CDMX" },
								},
							],
						} as any,
						{
							role: "toolResult",
							toolCallId: "call-1|fc_1",
							content: [{ type: "text", text: '{"temp":22}' }],
						} as any,
					],
				} as any, {
					apiKey: ID_TOKEN,
					headers,
					maxTokens: 512,
					reasoningEffort: "low",
					onPayload: (payload: any) =>
						hooks.runner.emitBeforeProviderRequest(payload),
				}),
			);

			const req = server.requests[0];
			expect(req.url).toBe("/v1/responses");
			const input = req.body.input ?? [];
			// Errata-13: sin items reasoning (el gateway 500-kea con ellos)
			expect(input.map((i: any) => i.type)).not.toContain("reasoning");
			// assistant previo traducido: NINGÚN output_text puede quedar
			// (pi-ai emite uno por bloque de texto — y otro para el thinking
			// previo si su firma no viaja como item reasoning separado)
			const astMsgs = input.filter(
				(i: any) => i.type === "message" && i.role === "assistant",
			);
			expect(astMsgs.length).toBeGreaterThanOrEqual(1);
			const allContent = astMsgs.flatMap((m: any) => m.content ?? []);
			expect(
				allContent.every((c: any) => c.type !== "output_text"),
				`quedó output_text: ${JSON.stringify(allContent.map((c: any) => c.type))}`,
			).toBe(true);
			const texto = allContent.find(
				(c: any) => c.text === "Consulto el clima.",
			);
			expect(texto?.type).toBe("input_text");
			// fc/fc_out intactos (el gateway los acepta)
			const fc = input.find((i: any) => i.type === "function_call");
			const fco = input.find((i: any) => i.type === "function_call_output");
			expect(fc?.name).toBe("get_weather");
			// invariante: fc y fc_out quedan EMPAREJADOS por call_id
			// (pi-ai normaliza "call-1|fc_1" según el camino; lo estable es el par)
			expect(fc?.call_id).toBeTruthy();
			expect(fco?.call_id).toBe(fc?.call_id);
			// identidad (Errata-2) y respuesta del stream
			expect(req.body.user_id).toBe("uid-e2e");
			expect(result?.stopReason).not.toBe("error");
		} finally {
			await server.close();
		}
	});

	it("S10 ADR-1003: mismo camino por streamSimple (canal lateral compact/título) también lleva identidad", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		server.respond(() => sseResponses("resumen…", "ok"));
		try {
			const barrel = await freshBarrel();
			const { loadOpenAIResponses } = await import("./harness");
			const { streamSimple } = await loadOpenAIResponses();
			const hooks = await makeRunner();
			hooks.register(
				barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }),
			);
			hooks.setModel(responsesModel(`${server.url}/v1`));
			const headers = { Authorization: `Bearer ${ID_TOKEN}` };
			await hooks.runner.emitBeforeProviderHeaders(headers);

			await collectStream(
				streamSimple(responsesModel(`${server.url}/v1`) as any, {
					messages: [
						{ role: "user", content: [{ type: "text", text: "Resume" }] },
					],
				} as any, {
					apiKey: ID_TOKEN,
					headers,
					maxTokens: 128,
					reasoning: "medium",
					onPayload: (payload: any) =>
						hooks.runner.emitBeforeProviderRequest(payload),
				}),
			);
			const req = server.requests[0];
			expect(req.url).toBe("/v1/responses");
			expect(req.body.user_id).toBe("uid-e2e");
			expect(req.body.reasoning).toMatchObject({ effort: "medium" });
			const roles = (req.body.input ?? []).map((i: any) => i.role);
			expect(roles).not.toContain("developer");
		} finally {
			await server.close();
		}
	});

	// S11/S12 (ADR-1003-F2): el nivel del footer (select Bajo/Medio/Alto del
	// Composer) debe viajar SIEMPRE al gateway en modelos chat, incluyendo el
	// nuevo nivel Off. El modelo sale de toProviderModel (el MISMO catálogo que
	// registra el provider): si el catálogo pierde compat o thinkingLevelMap,
	// estos tests lo detectan en el payload HTTP real.
	async function chatCatalogModel(serverUrl: string) {
		const barrel = await freshBarrel();
		const m = barrel.toProviderModel(
			{ id: "SELENE-CIPHER", capabilities: ["chat"], context_window_tokens: 262_144 },
			serverUrl,
		);
		if (!m) throw new Error("toProviderModel descartó el modelo chat");
		return { barrel, model: m };
	}

	it("S11 ADR-1003-F2: nivel Alto del footer → body.reasoning {effort:'high'} en chat", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			const { barrel, model } = await chatCatalogModel(server.url);
			const { loadOpenAICompletions } = await import("./harness");
			const { stream } = await loadOpenAICompletions();
			const hooks = await makeRunner();
			hooks.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
			const headers = { Authorization: `Bearer ${ID_TOKEN}` };
			await hooks.runner.emitBeforeProviderHeaders(headers);
			expect(barrel.buildFridaEnterpriseOAuth().getApiKey(CREDENTIAL)).toBe(ID_TOKEN);

			await collectStream(
				stream(model as any, {
					messages: [{ role: "user", content: [{ type: "text", text: "Di: pong" }] }],
				} as any, {
					apiKey: ID_TOKEN,
					headers,
					maxTokens: 128,
					reasoningEffort: "high",
					onPayload: (payload: any) => hooks.runner.emitBeforeProviderRequest(payload),
				}),
			);
			const req = server.requests[0];
			expect(req.url).toBe("/v1/chat/completions");
			expect(req.body.reasoning).toEqual({ effort: "high" });
		} finally {
			await server.close();
		}
	});

	it("S12 ADR-1003-F2 [RED]: nivel Off del footer → body.reasoning {effort:'none'} explícito", async () => {
		const { startRecorder } = await import("./harness");
		const server = await startRecorder();
		try {
			const { barrel, model } = await chatCatalogModel(server.url);
			const { loadOpenAICompletions } = await import("./harness");
			const { stream } = await loadOpenAICompletions();
			const hooks = await makeRunner();
			hooks.register(barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {} }));
			const headers = { Authorization: `Bearer ${ID_TOKEN}` };
			await hooks.runner.emitBeforeProviderHeaders(headers);
			expect(barrel.buildFridaEnterpriseOAuth().getApiKey(CREDENTIAL)).toBe(ID_TOKEN);

			// streamSimple con thinkingLevel 'off': reasoningEffort queda undefined;
			// pi-ai debe emitir reasoning_effort:'none' vía thinkingLevelMap.off y
			// buildFridaPayload traducirlo a reasoning:{effort:'none'}.
			const { streamSimple } = await loadOpenAICompletions();
			await collectStream(
				streamSimple(model as any, {
					messages: [{ role: "user", content: [{ type: "text", text: "Di: pong" }] }],
				} as any, {
					apiKey: ID_TOKEN,
					headers,
					maxTokens: 128,
					reasoning: "off",
					onPayload: (payload: any) => hooks.runner.emitBeforeProviderRequest(payload),
				}),
			);
			const req = server.requests[0];
			expect(req.url).toBe("/v1/chat/completions");
			expect(req.body.reasoning).toEqual({ effort: "none" });
		} finally {
			await server.close();
		}
	});
});
