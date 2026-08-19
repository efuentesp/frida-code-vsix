// E2E (ADR-1002, TDD): ciclo completo de tools por el camino real de frida
// code — con las 7 tools core del runtime, no schemas replicadas.
//
//   request #1 (tools presentes)
//     → gateway responde tool_call (finish_reason "tool_calls")
//     → el stream de pi-ai emite bloque toolCall
//   request #2 (historial + toolResult)
//     → gateway responde texto final
//     → el body grabado contiene role "tool" con tool_call_id e identidad

import { describe, expect, it } from "vitest";
import {
	collectStream,
	loadRuntimeTools,
	makeRunner,
	sseText,
	sseToolCall,
	startRecorder,
} from "./harness";
import {
	buildFridaEnterpriseOAuth,
	createFridaEnterpriseHooks,
	createFridaEnterpriseRuntime,
	FRIDA_ENTERPRISE_PROVIDER,
} from "../../../src/providers/frida-enterprise";

function makeIdToken(claims: object) {
	return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
}
const ID_TOKEN = makeIdToken({
	user_id: "uid-e2e",
	email: "e2e@softtek.com",
	aud: "frida-code-copilot-enterprise",
});
const CREDENTIAL = { access: ID_TOKEN, refresh: "RF", expires: 1 };

describe("E2E tools round-trip por el runtime real", () => {
	it("tool_call → toolResult → respuesta final, con tools reales e identidad en ambas requests", async () => {
		const server = await startRecorder();
		const runtime = createFridaEnterpriseRuntime();
		// El runtime real conoce el catálogo (semilla del barrel / refresh):
		runtime.rememberCatalogModels(["NIKE-VICTORY"]);
		const oauth = buildFridaEnterpriseOAuth(runtime);
		// OAuth y hooks reciben EXPLÍCITAMENTE la misma instancia — el wiring
		// real del barrel usa el singleton; la E2E prueba además la inyección DI.
		expect(oauth.getApiKey(CREDENTIAL as any)).toBe(ID_TOKEN);

		const hooks = await makeRunner();
		hooks.register(
			createFridaEnterpriseHooks({ onUnauthorized: () => {}, runtime }),
		);
		hooks.setModel({
			id: "NIKE-VICTORY",
			provider: FRIDA_ENTERPRISE_PROVIDER,
			api: "openai-completions",
			baseUrl: `${server.url}/v1`,
			contextWindow: 200_000,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});

		const { loadOpenAICompletions } = await import("./harness");
		const { stream } = await loadOpenAICompletions();
		const tools = loadRuntimeTools();
		expect(tools.length).toBe(7);

		// Turno 1: el modelo pide ejecutar bash
		server.respond([
			() => sseToolCall("call-1", "bash", { command: "echo hola" }),
			() => sseText("El comando imprimió: hola"),
		]);

		const authHeaders = { Authorization: `Bearer ${ID_TOKEN}` };
		await hooks.runner.emitBeforeProviderHeaders(authHeaders);

		const turn1 = await collectStream(
			stream(
			{
				id: "NIKE-VICTORY",
				provider: FRIDA_ENTERPRISE_PROVIDER,
				api: "openai-completions",
				baseUrl: `${server.url}/v1`,
				contextWindow: 200_000,
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "Ejecuta `echo hola` con bash." }],
					},
				],
				tools,
			} as any,
				{
					apiKey: ID_TOKEN,
					headers: authHeaders,
					maxTokens: 512,
					onPayload: (p: any) => hooks.runner.emitBeforeProviderRequest(p),
				},
			),
		);

		// El stream emitió el toolCall en formato pi
		const msg1 = turn1;
		const toolCall = (msg1?.content ?? []).find(
			(b: any) => b.type === "toolCall",
		);
		expect(toolCall).toBeTruthy();
		expect((toolCall as any).name).toBe("bash");
		// pi-ai entrega arguments ya parseado (objeto) tras streamSimple
		const rawArgs: any = (toolCall as any).arguments;
		const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
		expect(args.command).toBe("echo hola");
		expect(msg1.stopReason).toBe("toolUse");

		// Request #1 grabada: tools reales + identidad + tool_choice estándar
		const req1 = server.requests[0].body;
		expect(req1.user_id).toBe("uid-e2e");
		expect(req1.auto_log).toBe(true);
		expect(
			req1.tools.map((t: any) => t.function.name),
		).toEqual(
			expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find", "ls"]),
		);

		// Turno 2: la "ejecución" (frida code ejecutaría bash) devuelve el resultado
		const turn2 = await collectStream(
			stream(
			{
				id: "NIKE-VICTORY",
				provider: FRIDA_ENTERPRISE_PROVIDER,
				api: "openai-completions",
				baseUrl: `${server.url}/v1`,
				contextWindow: 200_000,
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "Ejecuta `echo hola` con bash." }],
					},
					{
						role: "assistant",
						content: [toolCall],
					} as any,
					// formato interno de pi: toolResult es mensaje TOP-LEVEL tras el
					// assistant con toolCalls (ver convertMessages de pi-ai)
					{
						role: "toolResult",
						toolCallId: (toolCall as any).id,
						content: [{ type: "text", text: "hola" }],
					} as any,
				],
				tools,
			} as any,
				{
					apiKey: ID_TOKEN,
					headers: authHeaders,
					maxTokens: 512,
					onPayload: (p: any) => hooks.runner.emitBeforeProviderRequest(p),
				},
			),
		);
		const msg2 = turn2;
		const text2 = (msg2?.content ?? [])
			.filter((b: any) => b.type === "text")
			.map((b: any) => b.text)
			.join("");
		expect(text2).toContain("hola");
		expect(msg2.stopReason).toBe("stop");

		// Request #2 grabada: historial con role "tool" (OpenAI) + identidad otra vez
		const req2 = server.requests[1].body;
		expect(req2.user_id).toBe("uid-e2e");
		expect(req2.auto_log).toBe(true);
		const toolMsg = req2.messages.find((m: any) => m.role === "tool");
		expect(toolMsg).toBeTruthy();
		expect(toolMsg.tool_call_id).toBe((toolCall as any).id);
		expect(toolMsg.content).toBe("hola");

		await server.close();
	});
});
