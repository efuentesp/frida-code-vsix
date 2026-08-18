// E2E live OPT-IN (ADR-1002): la MISMA cadena real de frida code
// (runner → hooks → oauth.getApiKey → pi-ai openai-completions → SDK OpenAI)
// contra el gateway REAL de Frida Enterprise. Sin fetch directo: cualquier
// fallo de wiring (identidad, orden de hooks, puerta ctx.model) se reproduce
// aquí exactamente como en la extensión.
//
//   FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-runtime.e2e.test.ts
//   FRIDA_ENTERPRISE_MODELS="NIKE-VICTORY,SELENE-CIPHER"  # subconjunto

import { describe, expect, it } from "vitest";
import {
	collectStream,
	loadRuntimeTools,
	makeRunner,
	sseToolCall,
	startRecorder,
} from "./harness";
import {
	createFridaEnterpriseHooks,
	createFridaEnterpriseRuntime,
	endpointForCapabilities,
	FRIDA_ENTERPRISE_PROVIDER,
	VERIFIED_MODEL_IDS,
} from "../../../src/providers/frida-enterprise";
import { apiForCapabilities } from "../../../src/providers/frida-enterprise/adapter";

const live = process.env.FRIDA_ENTERPRISE_LIVE === "1";
const FIREBASE_KEY = "AIzaSyAdz0OylajBmWqUyl5mIJ46AT2CSCwV54w";

type Credential = {
	access?: string;
	refresh?: string;
	expires?: number;
	compatibleApiUrl?: string;
	envVars?: { COMPATIBLE_API_URL?: string };
};

async function freshCredential(): Promise<Credential> {
	const fs = await import("node:fs/promises");
	const auth = JSON.parse(
		await fs.readFile(`${process.env.HOME}/.frida/auth.json`, "utf8"),
	);
	const cred: Credential = auth["frida-enterprise"] ?? {};
	if (!cred.access) throw new Error("sin credential frida-enterprise (¿/login?)");
	if ((cred.expires ?? 0) - Date.now() < 3 * 60 * 1000 && cred.refresh) {
		const res = await fetch(
			`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: cred.refresh,
				}),
			},
		);
		if (!res.ok) throw new Error(`refresh → HTTP ${res.status}`);
		const j: any = await res.json();
		cred.access = j.id_token;
		cred.refresh = j.refresh_token;
		cred.expires = Date.now() + Number(j.expires_in ?? 3600) * 1000 - 120_000;
	}
	return cred;
}

describe.skipIf(!live)("E2E live: cadena real de frida code → gateway", () => {
	it("F3-c/d: COMBO del selector tras 'cambiar al proveedor' — online y offline muestran SÓLO los 4 ⭐ medidos", async () => {
		const cred = await freshCredential();
		const root = (
			cred.compatibleApiUrl ?? cred.envVars?.COMPATIBLE_API_URL ?? ""
		).replace(/\/$/, "");
		expect(root).toMatch(/^https:\/\//);
		const cfg = (await import("../../../src/providers/frida-enterprise"))
			.buildFridaEnterpriseProviderConfig();

		// CAMINO ONLINE (el que corre al seleccionar el proveedor con sesión):
		// refreshModels contra el gateway REAL → lo que postModels manda al combo.
		const online = await cfg.refreshModels({
			allowNetwork: true,
			credential: { ...cred, compatibleApiUrl: root } as any,
			store: {
				read: async () => ({} as any),
				write: async () => {},
			},
		});
		expect(online.map((m: any) => m.name)).toEqual([
			"\u2b50 DEMETER-BLOOM (responses, grande 1M)",
			"\u2b50 TITAN-CROWN (responses, mediano 400k)",
			"\u2b50 MIDAS-GOLD (responses, compacto 128k)",
			"model-router (responses, meta)",
		]);

		// CAMINO OFFLINE (PI_OFFLINE/arranque sin store): el combo debe mostrar
		// los MISMOS 4 — nunca el fallback viejo MODEL1..4 (F3-d).
		const offline = await cfg.refreshModels({
			allowNetwork: false,
			credential: {
				compatibleApiUrl: root,
				envVars: {
					COMPATIBLE_API_URL: root,
					MODEL1: "AEOLUS-GALE",
					MODEL2: "NIKE-VICTORY",
					MODEL3: "TIRESIAS-PRISM",
					MODEL4: "SELENE-CIPHER",
				},
			} as any,
			store: { read: async () => ({}) as any, write: async () => {} },
		});
		expect(offline.map((m: any) => m.name)).toEqual(online.map((m: any) => m.name));
	});
	it(
		"generación y tool round-trip por el runtime real (sin fetch directo)",
		async () => {
			const cred = await freshCredential();
			const root = (
				cred.compatibleApiUrl ?? cred.envVars?.COMPATIBLE_API_URL ?? ""
			).replace(/\/$/, "");
			expect(root).toMatch(/^https:\/\//);

			const cat = await fetch(`${root}/v1/models`, {
				headers: { Authorization: `Bearer ${cred.access}` },
			});
			expect(cat.ok).toBe(true);
			const catalog: any = await cat.json();
			const chatModels = (catalog.data ?? []).filter(
				(m: any) => endpointForCapabilities(m.capabilities) === "chat",
			);
			const only = (process.env.FRIDA_ENTERPRISE_MODELS ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			const targets = only.length
				? chatModels.filter((m: any) => only.includes(m.id))
				: chatModels.filter((m: any) =>
						["NIKE-VICTORY", "SELENE-CIPHER", "TIRESIAS-PRISM"].includes(m.id),
					);
			expect(targets.length).toBeGreaterThan(0);

			// ADR-1003: adapter por modelo según capabilities (responses ⇒ /v1/responses)
			const { loadOpenAICompletions, loadOpenAIResponses } = await import(
				"./harness"
			);
			const completions = await loadOpenAICompletions();
			const responses = await loadOpenAIResponses();
			const streamFor = (m: any) =>
				m.api === "openai-responses" ? responses.stream : completions.stream;
			const tools = loadRuntimeTools();

			const failures: string[] = [];
			for (const model of targets as any[]) {
				const runtime = createFridaEnterpriseRuntime(VERIFIED_MODEL_IDS);
				const hooks = await makeRunner();
				hooks.register(
					createFridaEnterpriseHooks({ onUnauthorized: () => {}, runtime }),
				);
				// EXACTAMENTE como el host: el modelo activo es frida-enterprise
				hooks.setModel({
					id: model.id,
					provider: FRIDA_ENTERPRISE_PROVIDER,
					api: apiForCapabilities(model.capabilities) ?? "openai-completions",
					baseUrl: `${root}/v1`,
					contextWindow: model.context_window_tokens ?? 200_000,
					reasoning: true,
					input: ["text", "image"],
				});
				// auth resolution real: getApiKey alimenta la identidad del runtime
				runtime.rememberToken(cred.access!);

				const opts = {
					apiKey: cred.access!,
					headers: { Authorization: `Bearer ${cred.access}` },
					maxTokens: 512,
					onPayload: (p: any) => hooks.runner.emitBeforeProviderRequest(p),
				};
				const piModel = {
					id: model.id,
					provider: FRIDA_ENTERPRISE_PROVIDER,
					api: apiForCapabilities(model.capabilities) ?? "openai-completions",
					baseUrl: `${root}/v1`,
					contextWindow: model.context_window_tokens ?? 200_000,
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				};

				try {
					// Fase 1: generación simple
					const m1 = await collectStream(
					streamFor(model)(piModel as any, {
						messages: [
							{ role: "user", content: [{ type: "text", text: "Responde solo: pong" }] },
						],
						} as any, opts as any),
					);
					if (m1?.stopReason === "error" || !m1) {
						failures.push(`${model.id} (fase 1): ${m1?.stopReason ?? "sin mensaje"} ${JSON.stringify(m1 ?? {}).slice(0, 140)}`);
						continue;
					}

					// Fase 2: tool call real con las 7 tools del runtime
					const m2 = await collectStream(
					streamFor(model)(piModel as any, {
						messages: [
							{
								role: "user",
								content: [{ type: "text", text: "Ejecuta `echo hola` con la herramienta bash." }],
							},
						],
						tools,
						} as any, opts as any),
					);
					const toolCall = (m2?.content ?? []).find(
						(b: any) => b.type === "toolCall",
					);
					if (!toolCall) {
						failures.push(`${model.id} (fase 2): sin toolCall (stop=${m2?.stopReason})`);
						continue;
					}

					// Fase 3: round-trip con toolResult
					const m3 = await collectStream(
						streamFor(model)(piModel as any, {
							messages: [
								{ role: "user", content: [{ type: "text", text: "Ejecuta `echo hola` con la herramienta bash." }] },
								{ role: "assistant", content: [toolCall] } as any,
								// formato interno de pi: toolResult TOP-LEVEL tras el assistant
								{
									role: "toolResult",
									toolCallId: (toolCall as any).id,
									content: [{ type: "text", text: "hola" }],
								} as any,
							],
							tools,
						} as any, opts as any),
					);
					if (m3?.stopReason === "error" || !m3) {
						failures.push(`${model.id} (fase 3): ${m3?.stopReason ?? "sin mensaje"}`);
						continue;
					}
				} catch (e: any) {
					failures.push(`${model.id} (excepción): ${String(e?.message ?? e).slice(0, 160)}`);
				}
			}
			expect(failures, failures.join("\n")).toEqual([]);
		},
		300_000,
	);
});
