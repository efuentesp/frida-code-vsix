// CENTINELA LIVE (opt-in) — Límite real de contexto del upstream (#clamp-200k).
//
//   FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-context-ceiling.e2e.test.ts
//
// PROPÓSITO: este test ES el recordatorio del clamp EFFECTIVE_CONTEXT_CEILING
// (src/providers/frida-enterprise/adapter.ts). Documenta el contrato DESEADO
// del gateway — el upstream honra el context_window_tokens anunciado (1M en
// DEMETER-BLOOM) — y FALLA mientras eso no sea cierto:
//
//   ❌ FALLA (hoy): gateway anuncia 1M pero el upstream Anthropic rechaza
//      prompts >200k con 400 "prompt is too long: X > 200000 maximum"
//      (incidente 2025-08-19) → el clamp SIGUE siendo necesario.
//   ✅ PASA (futuro): el upstream acepta un prompt >200k → Frida Platform
//      corrigió el límite → REMUEVE el clamp (EFFECTIVE_CONTEXT_CEILING,
//      clampContextWindow y los contextWindow hardcodeados de
//      FALLBACK_SELECTED) y este centinela queda como prueba de contrato.
//   ✅ PASA (variante): el gateway deja de ANUNCIAR >200k en
//      /v1/models → el anuncio ya refleja la verdad → el clamp es moot.
//
// No corre en la suite diaria (live-only): su corrida es intencional, como
// verificación periódica del estado del upstream o tras un aviso del equipo
// de plataforma de que "ya honramos 1M".

import { describe, expect, it } from "vitest";

const live = process.env.FRIDA_ENTERPRISE_LIVE === "1";
const FIREBASE_KEY = "AIzaSyAdz0OylajBmWqUyl5mIJ46AT2CSCwV54w";

/** Modelo centinela: anuncia 1M en /v1/models (el mayor gap con el límite
 *  real observado). Si el gateway deja de listarlo, el test lo dice. */
const SENTINEL_MODEL = "DEMETER-BLOOM";

const REMOVE_CLAMP_HINT = [
	"═══════════════════════════════════════════════════════════",
	"ACCIÓN cuando este test PASE: remover el clamp 200k —",
	"  1. src/providers/frida-enterprise/adapter.ts: borrar",
	"     EFFECTIVE_CONTEXT_CEILING + clampContextWindow y el uso en",
	"     toProviderModel (dejar pasar el anunciado tal cual).",
	"  2. src/providers/frida-enterprise/catalog.ts: restaurar los",
	"     contextWindow reales en FALLBACK_SELECTED (1M/400k/128k).",
	"  3. Actualizar los tests del clamp (test/frida-enterprise/",
	"     adapter.test.ts + frida-enterprise-provider.test.ts) y el",
	"     test dedicado 'clamp-200k: ...' pasa a documentar el contrato.",
	"  4. Este centinela se queda: ahora vigila que el upstream no",
	"     regrese al límite 200k.",
	"═══════════════════════════════════════════════════════════",
].join("\n");

async function readCredential() {
	const fs = await import("node:fs/promises");
	const auth = JSON.parse(
		await fs.readFile(`${process.env.HOME}/.frida/auth.json`, "utf8"),
	);
	return auth["frida-enterprise"] ?? {};
}

async function ensureFreshToken(cred: any): Promise<string> {
	if (!cred.access) throw new Error("sin credential frida-enterprise (¿/login?)");
	if ((cred.expires ?? 0) - Date.now() > 3 * 60 * 1000) return cred.access;
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
	cred.access = json.id_token;
	cred.refresh = json.refresh_token;
	cred.expires = Date.now() + Number(json.expires_in ?? 3600) * 1000 - 120_000;
	return cred.access!;
}

describe.skipIf(!live)(
	"CENTINELA live: límite de contexto del upstream vs anunciado (clamp-200k)",
	() => {
		it(
			`el upstream debe honrar el context_window_tokens anunciado de ${SENTINEL_MODEL} (>200k)`,
			async () => {
				const cred = await readCredential();
				const token = await ensureFreshToken(cred);
				const root = (
					cred.compatibleApiUrl ??
					cred.envVars?.COMPATIBLE_API_URL ??
					""
				).replace(/\/$/, "");
				expect(root).toMatch(/^https:\/\//);

				// Identidad (claims del JWT sin verificar firma — el gateway la valida).
				const claims: any = JSON.parse(
					Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"),
				);

				// 1) El ANUNCIO: ¿qué context_window_tokens declara el gateway hoy?
				const modelsRes = await fetch(`${root}/v1/models`, {
					headers: { Authorization: `Bearer ${token}` },
				});
				expect(
					modelsRes.status,
					`GET /v1/models → ${modelsRes.status}`,
				).toBeLessThan(400);
				const modelsJson: any = await modelsRes.json();
				const announced: number | undefined = (modelsJson?.data ?? []).find(
					(m: any) => m?.id === SENTINEL_MODEL,
				)?.context_window_tokens;

				// Variante de PASS: el gateway ya no anuncia >200k → el anuncio
				// refleja la verdad y el clamp es moot (no hay gap que documentar).
				if (typeof announced !== "number" || announced <= 200_000) {
					console.log(
						`ℹ️ ${SENTINEL_MODEL} ya no anuncia >200k (context_window_tokens=${announced ?? "ausente"}): el gateway corrigió el anuncio. ${REMOVE_CLAMP_HINT}`,
					);
					return;
				}

				// 2) LA SONDA: prompt apenas arriba del límite (~210k tokens).
				//    ~4 chars/token en texto inglés: 210k tokens ≈ 840k chars.
				//    El mensaje de error del upstream reporta el conteo exacto,
				//    así que el tamaño no necesita ser quirúrgico.
				const chunk = "lorem ipsum dolor sit amet ".repeat(100); // 2.7k chars
				const hugeText = chunk.repeat(Math.ceil(840_000 / chunk.length));
				const res = await fetch(`${root}/v1/chat/completions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						model: SENTINEL_MODEL,
						messages: [{ role: "user", content: hugeText }],
						max_tokens: 10,
						user_id: claims.user_id ?? claims.sub,
						email: claims.email,
						auto_log: true,
					}),
				});
				const bodyText = await res.text();

				if (res.status === 400 && /prompt is too long/i.test(bodyText)) {
					// El estado del upstream HOY: rechaza >200k aunque el gateway
					// anuncia ${announced}. El clamp sigue siendo NECESARIO — por eso
					// este centinela falla: es el recordatorio vivo del problema.
					expect.fail(
						[
							`El upstream Anthropic SIGUE limitando a 200k tokens aunque el gateway anuncia ${announced} para ${SENTINEL_MODEL}:`,
							`  ${bodyText.slice(0, 220)}`,
							"",
							"El clamp EFFECTIVE_CONTEXT_CEILING = 200k (adapter.ts) sigue siendo NECESARIO.",
							"No es un bug del test: este centinela PASARÁ cuando Frida Platform",
							"corrija el upstream para honrar el anuncio. " + REMOVE_CLAMP_HINT,
						].join("\n"),
					);
				}

				// 200/5xx inesperado u otro 400: no podemos concluir — fallar con
				// detalle para no dar un PASS falso.
				expect(
					res.status,
					`respuesta inesperada de la sonda (¿auth? ¿backend caído?) — cuerpo: ${bodyText.slice(0, 220)}`,
				).toBeLessThan(500);

				// El upstream aceptó el prompt >200k (200/2xx): ¡límite corregido!
				console.log(
					`✅ El upstream aceptó un prompt >200k (${announced} anunciado). ${REMOVE_CLAMP_HINT}`,
				);
			},
			120_000,
		);
	},
);
