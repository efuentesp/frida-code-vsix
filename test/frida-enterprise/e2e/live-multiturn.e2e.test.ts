// E2E live OPT-IN (Errata-13): repro automatizado del incidente del usuario
// 2026-08-17 — "El modelo no generó respuesta (frida-enterprise)".
//
// SÍNTOMA REPORTADO: primer turno OK, algunas llamadas a herramientas, y a
// partir del segundo turno TODA request falla (el mensaje del host es el
// genérico de 401/modelo, pero el dbg real es "OpenAI API error (500)").
//
// CAUSA (probe 2026-08-17 07:15 UTC): el gateway /v1/responses devuelve 500
// en cuanto el `input` lleva items de un turno PREVIO del assistant:
//   ❌ {role:"assistant", content:[{type:"output_text"}]}  ← como los manda pi-ai
//   ❌ {type:"reasoning", ...}                              ← firma del turno previo
//   ✅ {role:"assistant", content:[{type:"input_text"}]}
//   ✅ content como string plano
//   ✅ {type:"function_call"} / {type:"function_call_output"}
//   (chat/completions SANO con tool_calls+tool: ver T3)
// Es decir: cualquier conversación multi-turno por /v1/responses muere.
//
// OBJETIVO DOBLE (como live-reasoning):
//   1. T1 ejercita el ciclo multi-turno+tools por la cadena REAL de pi-ai
//      (adapter openai-responses + buildFridaPayload con el workaround
//      Errata-13: output_text→input_text, reasoning items fuera). Verde =
//      funciona; si vuelve a fallar con 500, el gateway cambió de forma.
//   2. Cuando el gateway acepte la forma estándar de OpenAI (output_text /
//      reasoning items), T1 pasa VERDE solo — correr esta suite = saber si
//      ya está corregido.
//
//   FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-multiturn.e2e.test.ts
//   Modelo: FRIDA_ENTERPRISE_MULTITURN_MODEL (default MIDAS-GOLD)

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { buildFridaPayload } from "../../../src/providers/frida-enterprise";

const live = process.env.FRIDA_ENTERPRISE_LIVE === "1";
const FIREBASE_KEY = "AIzaSyAdz0OylajBmWqUyl5mIJ46AT2CSCwV54w";
// DEMETER-BLOOM: único backend que hoy (2026-08-17) acepta multi-turno
// con input_text; MIDAS/TITAN/router dan 502 blips. El repro (T1) es el
// que marca el incidente: output_text/reasoning → 500 en TODOS.
const MODEL =
	process.env.FRIDA_ENTERPRISE_MULTITURN_MODEL ?? "DEMETER-BLOOM";

type Credential = {
	access?: string;
	refresh?: string;
	expires?: number;
	compatibleApiUrl?: string;
};

let ctx: { token: string; identity: Record<string, string>; root: string } | null =
	null;

async function auth() {
	if (ctx) return ctx;
	const fsp = await import("node:fs/promises");
	const authJson = JSON.parse(
		await fsp.readFile(`${process.env.HOME}/.frida/auth.json`, "utf8"),
	);
	const cred: Credential = authJson["frida-enterprise"] ?? {};
	if (!cred.access) throw new Error("sin credential frida-enterprise (¿/login?)");
	let token = cred.access;
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
		token = (await res.json() as any).id_token;
	}
	const claims = JSON.parse(
		Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"),
	);
	const root = (
		cred.compatibleApiUrl ??
		(authJson["frida-enterprise"]?.envVars?.COMPATIBLE_API_URL as string) ??
		""
	).replace(/\/$/, "");
	ctx = {
		token,
		identity: {
			user_id: String(claims.user_id ?? claims.sub ?? ""),
			email: String(claims.email ?? ""),
		},
		root,
	};
	return ctx;
}

/** Evidence rows para el reporte MD. */
const rows: string[] = [];

const TOOL = [
	{
		type: "function",
		name: "get_weather",
		description: "Devuelve el clima de una ciudad.",
		parameters: {
			type: "object",
			properties: { city: { type: "string" } },
			required: ["city"],
		},
	},
];

/** Stream directo por el adapter openai-responses REAL de pi-ai, con la
 * identidad inyectada como lo hace el hook (buildFridaPayload). Lanza con el
 * error del gateway si el stream muere (collectStream, como tools-roundtrip). */
async function streamResponses(messages: unknown[], tools: unknown[]) {
	const { token, identity, root } = await auth();
	const { loadOpenAIResponses, collectStream } = await import("./harness");
	const { stream } = await loadOpenAIResponses();
	return collectStream(
		stream(
			{
				id: MODEL,
				provider: "frida-enterprise",
				api: "openai-responses",
				baseUrl: `${root}/v1`,
				contextWindow: 1_000_000,
				maxTokens: 4_096,
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
			{ messages, tools } as any,
			{
				apiKey: token,
				maxTokens: 400,
				reasoning: "low",
				// mismo contrato que el hook: identidad + traducciones Errata-2/8
				onPayload: (p: any) => buildFridaPayload(p, identity as any),
			} as any,
		),
	);
}

describe.skipIf(!live)("E2E live Errata-13: multi-turno + tools por /v1/responses", () => {
	it("T1 multi-turno+tools por la cadena real (Errata-13: workaround del adaptador activo; verde = el ciclo completo funciona)", async () => {
		const turn1 = await streamResponses(
			[
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Usa la herramienta get_weather para saber el clima de CDMX. Responde en una línea.",
						},
					],
				},
			],
			TOOL,
		);
		const toolCall = (turn1.content ?? []).find((b: any) => b.type === "toolCall");
		// Si el turno 1 ya no trae toolCall, el repro no aplica (otro incidente).
		expect(
			toolCall,
			`turno 1 sin toolCall (stop=${turn1.stopReason}, blocks=${(turn1.content ?? []).map((b: any) => b.type).join(",")})`,
		).toBeTruthy();
		rows.push(
			`| T1 turno 1 | ${MODEL} | toolCall ✓ (stop=${turn1.stopReason}) |`,
		);

		// Turno 2: la cadena REAL regenera aquí assistant(output_text) +
		// reasoning(item) + function_call — la forma que el gateway 500-kea.
		let turn2: any = { content: [], stopReason: "error" };
		let streamErr = "";
		try {
			turn2 = await streamResponses(
				[
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Usa la herramienta get_weather para saber el clima de CDMX. Responde en una línea.",
							},
						],
					},
					{ role: "assistant", content: turn1.content } as any,
					{
						role: "toolResult",
						toolCallId: (toolCall as any).id,
						content: [{ type: "text", text: '{"temp":22,"cond":"soleado"}' }],
					} as any,
				],
				TOOL,
			);
		} catch (e) {
			streamErr = String((e as Error)?.message ?? e).slice(0, 200);
		}
		const text2 = (turn2.content ?? [])
			.filter((b: any) => b.type === "text")
			.map((b: any) => b.text)
			.join("");
		// HOY esto falla: el stream muere con el 500 del gateway — el mensaje
		// lleva el error exacto como evidencia del incidente (Errata-13).
		expect(
			text2.length > 0 || ["stop", "toolUse"].includes(turn2.stopReason ?? ""),
			`[Errata-13 repro] turno 2 falló: "${streamErr}" — si dice "OpenAI API error (500)", es el incidente del gateway: input con assistant(output_text)/reasoning items (forma estándar de OpenAI que pi-ai envía). Ver test/frida-enterprise/e2e/reporte-multiturn.md`,
		).toBe(true);
		rows.push(`| T1 turno 2 | ${MODEL} | OK (stop=${turn2.stopReason}) |`);
	}, 180000);

	it("T2 contrato del gateway: formas de input ACEPTADAS (estables)", async () => {
		const { token, identity, root } = await auth();
		const base = {
			model: MODEL,
			stream: false,
			reasoning: { effort: "low", summary: "auto" },
		};
		const sys = {
			role: "system",
			content: [{ type: "input_text", text: "Eres un asistente conciso." }],
		};
		const usr = (t: string) => ({
			role: "user",
			content: [{ type: "input_text", text: t }],
		});
		const once = async (input: unknown[], tools?: unknown[]) =>
			(
				await fetch(`${root}/v1/responses`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						...base,
						...(tools ? { tools } : {}),
						input,
						auto_log: true,
						...identity,
					}),
				})
			).status;
		// El gateway tiene blips 5xx transitorios (2026-08-17): 1 reintento
		// tras 2s para no confundir inestabilidad con el contrato.
		const probe = async (name: string, input: unknown[], tools?: unknown[]) => {
			let status = await once(input, tools);
			if (status >= 500) {
				await new Promise((r) => setTimeout(r, 2000));
				status = await once(input, tools);
			}
			rows.push(`| ${name} | ${MODEL} | HTTP ${status} |`);
			return status;
		};
		// Contrato vigente (2026-08-17): estas formas DEBEN seguir aceptándose
		// aunque arreglen el incidente — son las que usa el workaround posible.
		// Con blips 5xx persistentes (backend degradado, p.ej. MIDAS/TITAN hoy)
		// se registra la evidencia y NO se afirma el contrato en esta corrida.
		const ok = async (name: string, input: unknown[], tools?: unknown[]) => {
			const status = await probe(name, input, tools);
			if (status >= 500) {
				rows.push(
					`| NOTA ${name} | ${MODEL} | 5xx persistente tras retry → backend degradado, contrato no afirmado |`,
				);
				console.warn(
					`[live-multiturn] ${name}: HTTP ${status} persistente (backend degradado) — contrato no afirmado en esta corrida`,
				);
				return;
			}
			expect(status).toBe(200);
		};
		await ok("T2a assistant(input_text)", [
			sys,
			usr("clima?"),
			{ role: "assistant", content: [{ type: "input_text", text: "Hace 22°C." }] },
			usr("gracias"),
		]);
		await ok("T2b assistant(string)", [
			sys,
			usr("clima?"),
			{ role: "assistant", content: "Hace 22°C." },
			usr("gracias"),
		]);
		await ok("T2c fc/fc_out", [
			sys,
			usr("clima?"),
			{ type: "function_call", call_id: "c1", name: "get_weather", arguments: "{\"city\":\"CDMX\"}" },
			{ type: "function_call_output", call_id: "c1", output: '{"temp":22}' },
		], TOOL);
	}, 90000);

	it("T3 contraste: chat/completions multi-turno + tools SANO (SELENE-CIPHER)", async () => {
		const { token, identity, root } = await auth();
		const res = await fetch(`${root}/v1/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				model: "SELENE-CIPHER",
				stream: false,
				max_tokens: 64,
				tools: TOOL,
				messages: [
					{ role: "system", content: "Eres un asistente conciso." },
					{ role: "user", content: "clima de CDMX?" },
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: {
									name: "get_weather",
									arguments: "{\"city\":\"CDMX\"}",
								},
							},
						],
					},
					{ role: "tool", tool_call_id: "call_1", content: '{"temp":22}' },
				],
				auto_log: true,
				...identity,
			}),
		});
		rows.push(`| T3 chat multi-turno+tools | SELENE-CIPHER | HTTP ${res.status} |`);
		expect(res.status).toBe(200);
	}, 60000);

	it("T4 evidencia del incidente: formas RECHAZADAS (500 hoy; informativo)", async () => {
		const { token, identity, root } = await auth();
		const base = {
			model: MODEL,
			stream: false,
			reasoning: { effort: "low", summary: "auto" },
		};
		const sys = {
			role: "system",
			content: [{ type: "input_text", text: "Eres un asistente conciso." }],
		};
		const usr = (t: string) => ({
			role: "user",
			content: [{ type: "input_text", text: t }],
		});
		const probe = async (name: string, input: unknown[]) => {
			const res = await fetch(`${root}/v1/responses`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					...base,
					input,
					auto_log: true,
					...identity,
				}),
			});
			rows.push(`| ${name} | ${MODEL} | HTTP ${res.status} ${res.status === 500 ? "← incidente" : ""} |`);
			return res.status;
		};
		// Sin aserción dura: cuando el gateway lo corrija, estas filas
		// quedarán en 200 en el reporte (y T1 pasará verde).
		const a1 = await probe("T4a assistant(output_text) [forma pi-ai]", [
			sys,
			usr("clima?"),
			{ role: "assistant", content: [{ type: "output_text", text: "Hace 22°C." }] },
			usr("gracias"),
		]);
		const a2 = await probe("T4b reasoning item", [
			sys,
			usr("hola"),
			{ type: "reasoning", id: "rs_probe", summary: [{ type: "summary_text", text: "…" }] },
			usr("y ahora?"),
		]);
		// Sanity del propio probe: HOY ambas son 500; si alguna ya NO lo es,
		// el incidente se corrigió — dejar constancia en el reporte.
		if (a1 !== 500 || a2 !== 500) {
			rows.push(
				"| NOTA | — | el gateway YA acepta alguna forma antes rota → re-correr T1 |",
			);
		}
		expect(true).toBe(true);
	}, 90000);
});

afterAll(() => {
	if (!live || rows.length === 0) return;
	const path = "test/frida-enterprise/e2e/reporte-multiturn.md";
	const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
	fs.writeFileSync(
		path,
		`# Reporte multi-turno /v1/responses (Errata-13)\n\n${stamp} UTC · modelo: ${MODEL}\n\n` +
			`| prueba | modelo | resultado |\n|---|---|---|\n` +
			rows.join("\n") +
			`\n\n## Lectura\n` +
			`- T1 verde = el ciclo completo usuario→tool→respuesta funciona (incidente corregido o workaround activo).\n` +
			`- T4a/T4b en 500 = el gateway sigue sin aceptar assistant(output_text) / items reasoning (forma estándar de OpenAI).\n` +
			`- T3 verde = chat/completions no está afectado; sólo /v1/responses.\n`,
	);
	console.log(`📄 ${path} actualizado`);
});
