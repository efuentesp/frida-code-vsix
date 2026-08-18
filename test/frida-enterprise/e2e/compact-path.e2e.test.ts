// E2E Errata-9: réplica del CAMINO DEL COMPACT — el que hace 422 en el host.
//
// compact() → agent.streamFunction (sdk.js) → modelRuntime.streamSimple SIN
// onPayload. Esta E2E reproduce exactamente ese flujo (prepareRequest real:
// getAuth → getApiKey alimenta identidad; sin emitBeforeProviderRequest) y
// exige que el patch de canales laterales entregue el payload correcto al
// servidor grabador: role "system" (no developer) + user_id/email/auto_log.

import { describe, expect, it } from "vitest";
import { loadOpenAICompletions, startRecorder } from "./harness";
import {
	createFridaEnterpriseRuntime,
	patchFridaSideChannels,
} from "../../../src/providers/frida-enterprise";

function makeIdToken(claims: object) {
	return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
}
const ID_TOKEN = makeIdToken({
	user_id: "uid-9",
	email: "e9@softtek.com",
	aud: "frida-code-copilot-enterprise",
});
const CREDENTIAL = { access: ID_TOKEN, refresh: "RF", expires: Date.now() + 3600_000 };

describe("E2E camino compact (streamSimple sin onPayload)", () => {
	it("el patch entrega identidad + developer→system al server grabador", async () => {
		const server = await startRecorder();
		const runtime = createFridaEnterpriseRuntime(["NIKE-VICTORY", "SELENE-CIPHER"]);

		// ModelRuntime fidedigno mínimo: getAuth (getApiKey del oauth real del
		// barrel alimenta la identidad) + streamSimple delegando al adapter
		// openai-completions REAL de pi-ai (como hace prepareRequest).
		const { stream } = await loadOpenAICompletions();
		const modelRuntime: any = {
			async getAuth() {
				const access = runtime.getIdentity().user_id ? ID_TOKEN : "";
				return { auth: { apiKey: access, headers: { Authorization: `Bearer ${access}` } } };
			},
			streamSimple(model: any, context: any, options: any) {
				return stream(model, context, options);
			},
		};
		patchFridaSideChannels(modelRuntime, {
			runtime,
			isFridaModel: (m: any) => m.provider === "frida-enterprise",
		});
		// auth del compact: getApiKey alimenta identidad ANTES (como getAuth real)
		runtime.rememberToken(ID_TOKEN);

		const model = {
			id: "NIKE-VICTORY",
			provider: "frida-enterprise",
			api: "openai-completions",
			baseUrl: `${server.url}/v1`,
			contextWindow: 1_000_000,
			maxTokens: 128_000,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		// EL CAMINO DEL COMPACT: systemPrompt + SIN onPayload.
		let final: any;
		const s = modelRuntime.streamSimple(
			model,
			{
				systemPrompt: "Resume la conversación…",
				messages: [
					{ role: "user", content: [{ type: "text", text: "contenido largo" }] },
				],
			} as any,
			{ apiKey: ID_TOKEN, headers: { Authorization: `Bearer ${ID_TOKEN}` }, maxTokens: 256 },
		);
		for await (const ev of s) {
			if (ev.type === "done") final = ev.message ?? ev.partial;
		}

		const body = server.requests[0].body;
		expect(body.messages[0].role).toBe("system"); // NO "developer"
		expect(body.messages[0].content).toContain("Resume");
		expect(body.user_id).toBe("uid-9");
		expect(body.email).toBe("e9@softtek.com");
		expect(body.auto_log).toBe(true);
		expect(final?.stopReason).not.toBe("error");
		await server.close();
	});
});
