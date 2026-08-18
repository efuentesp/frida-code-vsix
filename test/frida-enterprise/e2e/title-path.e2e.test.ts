// E2E Errata-11: el canal del TÍTULO DE SESIÓN — el que hace 422 en el host.
//
// generateSessionTitle (extension.ts) crea su PROPIO DefaultResourceLoader
// SIN extensionFactories → la sesión hija viaja sin hooks del provider →
// sin before_provider_request → sin user_id/email (Errata-2) → 422 del
// gateway. Reproducido contra el gateway real (2026-08-16): payload de
// título sin identidad → 422 missing user_id; con identidad → 200.
//
// Casos:
//   T1 [bug, documento de regresión] réplica del host ROTO (sin hooks):
//       el payload grabado NO lleva user_id (mecánica exacta del 422).
//   T2 [fix] réplica del host CORREGIDO (loader con factories del barrel):
//       por el runner real (before_provider_headers + before_provider_request)
//       el payload lleva user_id/email/auto_log y role system — en el adapter
//       openai-completions Y openai-responses (el título usa el modelo
//       ACTIVO, que tras ADR-1003 puede ser cualquiera de los dos).
//   T3 [wiring] aserción estática: generateSessionTitle de extension.ts
//       efectivamente pasa extensionFactories con los hooks frida.
//       (RED hasta aplicar el fix del host — el único bloque que no puede
//       importarse en vitest por el `import vscode`.)

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	collectStream,
	loadOpenAICompletions,
	loadOpenAIResponses,
	makeRunner,
	startRecorder,
} from "./harness";
import {
	createFridaEnterpriseHooks,
	createFridaEnterpriseRuntime,
} from "../../../src/providers/frida-enterprise";

function makeIdToken(claims: object) {
	return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
}
const ID_TOKEN = makeIdToken({
	user_id: "uid-titulo",
	email: "titulo@softtek.com",
	aud: "frida-code-copilot-enterprise",
});
const TITLE_SYSTEM =
	"Eres un generador de títulos de sesión. Responde SOLO con un título conciso de máximo 5 palabras.";
const TITLE_USER =
	"Genera un título de máximo 5 palabras para una sesión que empieza con este mensaje del usuario:\n\ncontinua";

function fridaModel(baseUrl: string, api: "openai-completions" | "openai-responses") {
	return {
		id: "NIKE-VICTORY",
		provider: "frida-enterprise",
		api,
		baseUrl,
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

describe("E2E camino del título de sesión (Errata-11)", () => {
	/** SSE mínimo formato responses (slots por output_item.added — ver
	 *  runtime-payload S9: sin output_item.added los deltas se ignoran). */
	function sseResponsesTitle(): string {
		const chunks = [
			{ type: "response.created", response: { id: "resp_t", status: "in_progress" } },
			{ type: "response.output_item.added", output_index: 0, item: { id: "m_1", type: "message", content: [] } },
			{ type: "response.output_text.delta", output_index: 0, delta: "Título corto" },
			{ type: "response.output_text.done", output_index: 0, text: "Título corto" },
			{
				type: "response.completed",
				response: { id: "resp_t", status: "completed", usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } },
			},
		];
		return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
	}

	it("T1 [bug] sin hooks (host roto): payload SIN user_id → el gateway respondería 422", async () => {
		const server = await startRecorder();
		try {
			const { stream } = await loadOpenAICompletions();
			// Exactamente como la sesión hija del título hoy: adapter directo,
			// sin runner, sin hooks — sólo apiKey/headers del getAuth.
			await collectStream(
				stream(fridaModel(`${server.url}/v1`, "openai-completions") as any, {
					systemPrompt: TITLE_SYSTEM,
					messages: [{ role: "user", content: [{ type: "text", text: TITLE_USER }] }],
				} as any, {
					apiKey: ID_TOKEN,
					headers: { Authorization: `Bearer ${ID_TOKEN}` },
					maxTokens: 512,
					// sin onPayload: nadie inyecta identidad
				}),
			);
			const body = server.requests[0].body;
			expect(body.user_id).toBeUndefined(); // ← la mecánica del 422
			expect(body.email).toBeUndefined();
			expect(body.auto_log).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	for (const api of ["openai-completions", "openai-responses"] as const) {
		it(`T2 [fix] con hooks del barrel (host corregido): identidad presente vía ${api}`, async () => {
			const server = await startRecorder();
			if (api === "openai-responses") server.respond(() => sseResponsesTitle());
			try {
				const barrel = await import("../../../src/providers/frida-enterprise");
				const { stream } =
					api === "openai-responses"
						? await loadOpenAIResponses()
						: await loadOpenAICompletions();
				// Runner real + factories del barrel (lo que el loader del host
				// corregido registra) + getAuth→headers-first (orden de models.js).
				const runtime = createFridaEnterpriseRuntime(["NIKE-VICTORY"]);
				const hooks = await makeRunner();
				hooks.register(
					barrel.createFridaEnterpriseHooks({ onUnauthorized: () => {}, runtime }),
				);
				const headers = { Authorization: `Bearer ${ID_TOKEN}` };
				await hooks.runner.emitBeforeProviderHeaders(headers);
				runtime.rememberToken(ID_TOKEN);

				await collectStream(
					stream(fridaModel(`${server.url}/v1`, api) as any, {
						systemPrompt: TITLE_SYSTEM,
						messages: [
							{ role: "user", content: [{ type: "text", text: TITLE_USER }] },
						],
					} as any, {
						apiKey: ID_TOKEN,
						headers,
						maxTokens: 512,
						onPayload: (payload: any) =>
							hooks.runner.emitBeforeProviderRequest(payload),
					}),
				);

				const body = server.requests[0].body;
				expect(body.user_id).toBe("uid-titulo");
				expect(body.email).toBe("titulo@softtek.com");
				expect(body.auto_log).toBe(true);
				// Errata-8: sin "developer" en ninguno de los dos formatos
				if (api === "openai-responses") {
					const roles = (body.input ?? []).map((i: any) => i.role);
					expect(roles).not.toContain("developer");
					expect(roles).toContain("system");
				} else {
					expect(body.messages[0].role).toBe("system");
				}
			} finally {
				await server.close();
			}
		});
	}

	it("T3 [wiring] generateSessionTitle pasa extensionFactories con los hooks frida (RED hasta el fix)", () => {
		const src = readFileSync(
			join(__dirname, "../../../src/extension.ts"),
			"utf8",
		);
		const start = src.indexOf("generateSessionTitle");
		expect(start).toBeGreaterThan(-1);
		// bloque de la función: hasta el "finally" del dispose (suficiente)
		const block = src.slice(start, start + 3500);
		expect(block).toContain("extensionFactories");
		expect(block).toContain("frida-enterprise");
		expect(block).toContain("createFridaEnterpriseHooks");
	});
});
