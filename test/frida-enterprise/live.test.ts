// ADR-1002 — TDD: matriz en vivo OPT-IN. Verifica que TODOS los modelos que el
// provider anuncia como disponibles no sólo responden, sino que ejecutan el
// ciclo completo de tools que frida code necesita:
//
//   (a) completion básica        → 200 + content
//   (b) tool-call FORZADO        → finish_reason "tool_calls" + arguments JSON válidos
//   (c) round-trip tool result   → el modelo continúa tras recibir el resultado
//   (d) streaming SSE            → primer chunk parseable
//
// No corre en la suite normal (requiere credential local y red):
//   FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/live.test.ts
// Subconjunto de modelos: FRIDA_ENTERPRISE_MODELS="NIKE-VICTORY,SELENE-CIPHER"
//
// Renueva el idToken vía securetoken si está por expirar (como hace el runtime).

import { describe, expect, it } from "vitest";
import { endpointForCapabilities } from "../../src/providers/frida-enterprise/adapter";

const live = process.env.FRIDA_ENTERPRISE_LIVE === "1";

type Credential = {
	access?: string;
	refresh?: string;
	expires?: number;
	compatibleApiUrl?: string;
	envVars?: { COMPATIBLE_API_URL?: string };
};

const FIREBASE_KEY = "AIzaSyAdz0OylajBmWqUyl5mIJ46AT2CSCwV54w";

async function readCredential(): Promise<Credential> {
	const fs = await import("node:fs/promises");
	const auth = JSON.parse(
		await fs.readFile(`${process.env.HOME}/.frida/auth.json`, "utf8"),
	);
	return auth["frida-enterprise"] ?? {};
}

/** Renueva el idToken si quedan <3 min (mismo contrato que oauth.refreshToken). */
async function ensureFreshToken(cred: Credential): Promise<string> {
	if (!cred.access) throw new Error("sin credential frida-enterprise (¿/login?)");
	const remaining = (cred.expires ?? 0) - Date.now();
	if (remaining > 3 * 60 * 1000) return cred.access;
	if (!cred.refresh) throw new Error("idToken expirado y sin refreshToken");
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
	const json: any = await res.json();
	// Local tipada: asignar `any` a cred.access resetea el narrowing del guard
	// inicial, por lo que retornamos el token capturado, no la propiedad.
	const token = String(json.id_token);
	cred.access = token;
	cred.refresh = json.refresh_token;
	cred.expires = Date.now() + Number(json.expires_in ?? 3600) * 1000 - 120_000;
	return token;
}

function claimsOf(token: string) {
	return JSON.parse(
		Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
	);
}

describe.skipIf(!live)("Frida Enterprise live matrix (todos los modelos × tools)", () => {
	it(
		"cada modelo chat: responde, llama tools, continua tras tool result y streamea",
		async () => {
			const cred = await readCredential();
			const root = (
				cred.compatibleApiUrl ??
				cred.envVars?.COMPATIBLE_API_URL ??
				""
			).replace(/\/$/, "");
			expect(root).toMatch(/^https:\/\//);

			// Catálogo vivo con el MISMO criterio del provider (adapter).
			await ensureFreshToken(cred);
			const catRes = await fetch(`${root}/v1/models`, {
				headers: { Authorization: `Bearer ${cred.access}` },
			});
			expect(catRes.ok).toBe(true);
			const catalog: any = await catRes.json();
			const models = (catalog.data ?? []).filter(
				(m: any) => endpointForCapabilities(m.capabilities) === "chat",
			);
			expect(models.length).toBeGreaterThan(0);

			// Subconjunto opcional para iterar rápido.
			const only = (
				process.env.FRIDA_ENTERPRISE_MODELS ?? ""
			)
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			const targets = only.length
				? models.filter((m: any) => only.includes(m.id))
				: models;
			expect(targets.length).toBeGreaterThan(0);

			const identity = () => {
				const c = claimsOf(cred.access!);
				return {
					user_id: c.user_id ?? c.sub,
					email: c.email,
					auto_log: true as const,
				};
			};

			async function call(body: Record<string, unknown>) {
				await ensureFreshToken(cred);
				return fetch(`${root}/v1/chat/completions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${cred.access}`,
					},
					body: JSON.stringify({ ...body, ...identity() }),
				});
			}

			// Tool representativa (esquema igual a la real "bash" del runtime).
			const bashTool = {
				type: "function",
				function: {
					name: "bash",
					description: "Execute a bash command",
					parameters: {
						type: "object",
						required: ["command"],
						properties: {
							command: { type: "string", description: "Command to run" },
							timeout: { type: "number", description: "Timeout seconds" },
						},
					},
				},
			};

			const failures: string[] = [];
			const ok: string[] = [];

			for (const model of targets as any[]) {
				const id = model.id;
				try {
					// (a) completion básica
					const a = await call({
						model: id,
						messages: [{ role: "user", content: "Responde solo: pong" }],
						max_tokens: 64,
					});
					if (!a.ok) {
						failures.push(`${id} (a completion): HTTP ${a.status}`);
						await a.text();
						continue;
					}

					// (b) tool-call forzado
					const b = await call({
						model: id,
						messages: [
							{ role: "user", content: "Ejecuta `echo hola` con la herramienta." },
						],
						max_tokens: 512,
						tools: [bashTool],
						tool_choice: {
							type: "function",
							function: { name: "bash" },
						},
					});
					const bj: any = await b.json();
					if (!b.ok) {
						failures.push(
							`${id} (b tool-call): HTTP ${b.status} ${JSON.stringify(bj).slice(0, 120)}`,
						);
						continue;
					}
					const choice = bj.choices?.[0];
					const tc = choice?.message?.tool_calls?.[0];
					if (choice?.finish_reason !== "tool_calls" || !tc) {
						failures.push(
							`${id} (b tool-call): finish=${choice?.finish_reason} sin tool_calls`,
						);
						continue;
					}
					let argsOk = false;
					try {
						const parsed = JSON.parse(tc.function.arguments);
						argsOk = typeof parsed.command === "string" && parsed.command.length > 0;
					} catch {
						argsOk = false;
					}
					if (!argsOk) {
						failures.push(
							`${id} (b tool-call): arguments inválidos ${String(tc.function.arguments).slice(0, 80)}`,
						);
						continue;
					}

					// (c) round-trip: el modelo recibe el resultado y continúa.
					const c = await call({
						model: id,
						messages: [
							{ role: "user", content: "Ejecuta `echo hola` y dime qué imprimió." },
							{
								role: "assistant",
								content: null,
								tool_calls: [tc],
							},
							{
								role: "tool",
								tool_call_id: tc.id,
								content: "hola",
							},
						],
						max_tokens: 512,
						tools: [bashTool],
					});
					const cj: any = await c.json();
					if (!c.ok) {
						failures.push(
							`${id} (c round-trip): HTTP ${c.status} ${JSON.stringify(cj).slice(0, 120)}`,
						);
						continue;
					}
					const content = cj.choices?.[0]?.message?.content;
					if (typeof content !== "string" || !content.trim()) {
						failures.push(
							`${id} (c round-trip): sin contenido final (finish=${cj.choices?.[0]?.finish_reason})`,
						);
						continue;
					}

					// (d) streaming: consumir el SSE corto completo y validar chunks.
					const d = await call({
						model: id,
						messages: [{ role: "user", content: "Di: pong" }],
						max_tokens: 64,
						stream: true,
					});
					if (!d.ok) {
						failures.push(`${id} (d stream): HTTP ${d.status}`);
						continue;
					}
					const sse = await d.text();
					if (!sse.includes("chat.completion.chunk")) {
						failures.push(
							`${id} (d stream): SSE sin chunks esperados ${sse.slice(0, 80)}`,
						);
						continue;
					}

					ok.push(id);
				} catch (e: any) {
					failures.push(`${id} (excepción): ${String(e?.message ?? e).slice(0, 140)}`);
				}
			}

			// eslint-disable-next-line no-console
			console.log(
				`\n[live matrix] ${ok.length}/${targets.length} modelos pasaron el ciclo completo: ${ok.join(", ")}\n` +
					(failures.length ? `[live matrix] fallos:\n  - ${failures.join("\n  - ")}` : ""),
			);
			expect(failures, `modelos con fallos en el ciclo de tools:\n${failures.join("\n")}`).toEqual([]);
		},
		600_000,
	);
});
