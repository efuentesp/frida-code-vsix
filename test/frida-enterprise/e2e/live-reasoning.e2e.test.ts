// E2E live OPT-IN (ADR-1003-F3): matriz de niveles de razonamiento + detector
// del incidente del canal /v1/responses.
//
// OBJETIVO DOBLE:
//   1. HOY demuestra el incidente: los modelos responses con backend roto
//      (NIKE-VICTORY → Anthropic 503/credenciales; ATHENA-LANCE → Bedrock
//      ValidationException, 2026-08-16) FALLAN con el error del gateway en el
//      mensaje. Es la evidencia automatizada para el equipo del gateway.
//   2. Cuando arreglen el incidente, esta suite pasa VERDE → al correrla se
//      sabe que ya está corregido, sin inspección manual.
//
//   FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-reasoning.e2e.test.ts
//   Override de muestras: FRIDA_ENTERPRISE_MODELS="NIKE-VICTORY,SELENE-CIPHER" (responses)
//                         FRIDA_ENTERPRISE_CHAT_MODELS="SELENE-CIPHER,TIRESIAS-PRISM"
//
// Genera test/frida-enterprise/e2e/reporte-reasoning.md con la matriz completa
// (modelo × canal × effort → status, texto, razonó?, tokens) al terminar.
//
// NOTA: probes HTTP directos (como live.test.ts) — validan COMPORTAMIENTO del
// gateway por effort/modelo, no wiring del host (eso lo cubre live-runtime).

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { VERIFIED_MODEL_IDS } from "../../../src/providers/frida-enterprise";

const live = process.env.FRIDA_ENTERPRISE_LIVE === "1";
const FIREBASE_KEY = "AIzaSyAdz0OylajBmWqUyl5mIJ46AT2CSCwV54w";

/** Muestra responses (⭐ por clase + los dos backends rotos conocidos). */
const RESPONSES_SAMPLE = (
	process.env.FRIDA_ENTERPRISE_MODELS ??
	"NIKE-VICTORY,ATHENA-LANCE,GAIA-FLARE,MERCURY-WING"
).split(",").map((s) => s.trim()).filter(Boolean);
/** Muestra chat (⭐ mediano + summary + fallback MODEL1). */
const CHAT_SAMPLE = (
	process.env.FRIDA_ENTERPRISE_CHAT_MODELS ??
	"SELENE-CIPHER,TIRESIAS-PRISM,AEOLUS-GALE"
).split(",").map((s) => s.trim()).filter(Boolean);
const EFFORTS = ["none", "low", "medium", "high"] as const;

type Credential = {
	access?: string;
	refresh?: string;
	expires?: number;
	compatibleApiUrl?: string;
	envVars?: { COMPATIBLE_API_URL?: string };
};

async function readCredential(): Promise<Credential> {
	const fsp = await import("node:fs/promises");
	const auth = JSON.parse(
		await fsp.readFile(`${process.env.HOME}/.frida/auth.json`, "utf8"),
	);
	return auth["frida-enterprise"] ?? {};
}

let cachedToken: { token: string; identity: Record<string, string> } | null =
	null;

async function auth(): Promise<{
	token: string;
	identity: Record<string, string>;
	root: string;
}> {
	if (!cachedToken) {
		const cred = await readCredential();
		if (!cred.access)
			throw new Error("sin credential frida-enterprise (¿/login?)");
		let token = cred.access;
		if ((cred.expires ?? 0) - Date.now() < 3 * 60 * 1000 && cred.refresh) {
			const res = await fetch(
				`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: new URLSearchParams({
						grant_type: "refresh_token",
						refresh_token: cred.refresh,
					}),
				},
			);
			if (!res.ok) throw new Error(`refresh → HTTP ${res.status}`);
			const j: any = await res.json();
			token = j.id_token;
		}
		const part = String(token).split(".")[1];
		const claims = JSON.parse(
			Buffer.from(part, "base64url").toString("utf8"),
		);
		cachedToken = {
			token,
			identity: {
				user_id: String(claims.user_id ?? claims.sub ?? ""),
				email: String(claims.email ?? ""),
			},
		};
	}
	const cred = await readCredential();
	const root = (
		cred.compatibleApiUrl ??
		cred.envVars?.COMPATIBLE_API_URL ??
		""
	).replace(/\/$/, "");
	return { ...cachedToken!, root };
}

/** Resultado por fila de la matriz (para el reporte MD). */
type Row = {
	model: string;
	channel: "chat" | "responses";
	effort: string;
	status: number;
	failed: string | null;
	text: boolean;
	hadReasoning: boolean;
	reasoningTokens: number | null;
};

const rows: Row[] = [];

const REASONING_PROMPT =
	"Tengo 3 cajas: A sólo manzanas, B sólo naranjas, C mixto. Las 3 etiquetas están mal puestas. Saco UNA fruta de UNA caja: ¿de cuál y cómo deduzco todo? Razona paso a paso.";

async function probeChat(model: string, effort: string): Promise<Row> {
	const { token, identity, root } = await auth();
	const res = await fetch(`${root}/v1/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: "Eres un asistente preciso." },
				{ role: "user", content: REASONING_PROMPT },
			],
			stream: true,
			max_tokens: 3000,
			auto_log: true,
			...identity,
			reasoning: { effort },
		}),
	});
	const row: Row = {
		model,
		channel: "chat",
		effort,
		status: res.status,
		failed: null,
		text: false,
		hadReasoning: false,
		reasoningTokens: null,
	};
	if (!res.ok) return row;
	for (const line of (await res.text()).split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const p = line.slice(6).trim();
		if (!p || p === "[DONE]") continue;
		try {
			const ev = JSON.parse(p);
			const d = ev.choices?.[0]?.delta ?? {};
			if (typeof d.reasoning_content === "string" && d.reasoning_content)
				row.hadReasoning = true;
			if (typeof d.content === "string" && d.content) row.text = true;
		} catch {
			/* noop */
		}
	}
	return row;
}

async function probeResponses(model: string, effort: string): Promise<Row> {
	const { token, identity, root } = await auth();
	const res = await fetch(`${root}/v1/responses`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			model,
			input: [
				{
					role: "system",
					content: [{ type: "input_text", text: "Eres un asistente preciso." }],
				},
				{
					role: "user",
					content: [{ type: "input_text", text: REASONING_PROMPT }],
				},
			],
			stream: true,
			max_output_tokens: 4000,
			auto_log: true,
			...identity,
			reasoning: { effort, summary: "auto" },
			store: false,
		}),
	});
	const row: Row = {
		model,
		channel: "responses",
		effort,
		status: res.status,
		failed: null,
		text: false,
		hadReasoning: false,
		reasoningTokens: null,
	};
	if (!res.ok) return row;
	for (const line of (await res.text()).split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const p = line.slice(6).trim();
		if (!p || p === "[DONE]") continue;
		try {
			const ev = JSON.parse(p);
			if (ev.type === "response.reasoning_summary_text.delta")
				row.hadReasoning = true;
			if (ev.type === "response.output_text.delta" && ev.delta)
				row.text = true;
			if (ev.type === "response.failed")
				row.failed = String(
					ev.response?.error?.message ?? "sin detalle",
				).slice(0, 140);
			if (ev.type === "response.completed")
				row.reasoningTokens =
					ev.response?.usage?.output_tokens_details?.reasoning_tokens ?? 0;
		} catch {
			/* noop */
		}
	}
	return row;
}

/** Registra la fila y devuelve la aserción base: 200 + sin response.failed + texto. */
function expectHealthy(row: Row, ctx: string) {
	rows.push(row);
	expect(
		{
			status: row.status,
			failed: row.failed,
			text: row.text,
		},
		`${ctx} — backend del gateway: ${row.failed ?? "ok"}`,
	).toEqual({ status: 200, failed: null, text: true });
}

afterAll(() => {
	// Reporte MD con la matriz completa (sólo si corrió algo)
	if (rows.length === 0) return;
	const stamp = new Date().toISOString();
	const lines = [
		`# Reporte de razonamiento en vivo (matriz modelo × effort)`,
		``,
		`Generado por \`live-reasoning.e2e.test.ts\` (opt-in). Re-correr para refrescar:`,
		"\n```bash",
		"FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-reasoning.e2e.test.ts",
		"```\n",
		`| Modelo | Canal | Effort | HTTP | response.failed | Texto | Razonó | reasoning_tokens |`,
		`|---|---|---|---|---|---|---|---|`,
	];
	for (const r of rows) {
		lines.push(
			`| ${r.model} | ${r.channel} | ${r.effort} | ${r.status} | ${
				r.failed ? `**${r.failed.slice(0, 60)}**` : "—"
			} | ${r.text ? "✓" : "✗"} | ${r.hadReasoning ? "✓" : "✗"} | ${
				r.reasoningTokens ?? "—" 
			} |`,
		);
	}
	// Sección "¿qué modelos razonan visible?" — agrega por modelo desde las
	// filas del barrido (canal según capabilities, effort high).
	const byModel = new Map<string, Row>();
	for (const r of rows) {
		const prev = byModel.get(r.model);
		if (
			!prev ||
			r.hadReasoning ||
			(prev.reasoningTokens ?? -1) < (r.reasoningTokens ?? -1)
		)
			byModel.set(r.model, r);
	}
	if (byModel.size > 0) {
		lines.push("", "## ¿Qué modelos razonan visible? (agregado por modelo)", "");
		for (const [model, r] of byModel) {
			const marca =
				r.hadReasoning || (r.reasoningTokens ?? 0) > 0
					? "✅ razona visible"
					: "❌ no expone razonamiento";
			lines.push(
				`- **${model}** (${r.channel}) — ${marca}${
					(r.reasoningTokens ?? 0) > 0
						? ` · reasoning_tokens=${r.reasoningTokens}`
						: ""
				}${r.failed ? ` · ⚠️ backend roto: ${r.failed.slice(0, 60)}` : ""}`,
			);
		}
	}
	lines.push("");
	const out = `${__dirname}/reporte-reasoning.md`;
	try {
		fs.writeFileSync(out, lines.join("\n"), "utf8");
		// eslint-disable-next-line no-console
		console.log(`matriz escrita → ${out}`);
	} catch {
		/* noop */
	}
});

describe.skipIf(!live)("E2E live: razonamiento por modelo y effort", () => {
	it(
		"T1 detector de incidente /v1/responses (hoy ROJO = backend roto; VERDE = incidente corregido)",
		async () => {
			for (const model of RESPONSES_SAMPLE) {
				const row = await probeResponses(model, "high");
				expectHealthy(
					row,
					`T1 ${model} effort=high — si falla, el backend del gateway está caído (reportar al equipo del gateway con este error)`,
				);
			}
		},
		240_000,
	);

	it(
		"T2 matriz chat × {none,low,medium,high}: el gateway ACEPTA todos los niveles (contrato cliente E8)",
		async () => {
			for (const model of CHAT_SAMPLE) {
				for (const effort of EFFORTS) {
					const row = await probeChat(model, effort);
					expectHealthy(row, `T2 ${model} effort=${effort}`);
				}
			}
		},
		600_000,
	);

	it(
		"T3 matriz responses × {low,medium,high} en modelos SANOS de T1 (razonamiento informativo)",
		async () => {
			// Sólo aplica a modelos que T1 dejó sanos (rows con status 200 sin failed).
			const healthy = new Set(
				rows
					.filter((r) => r.channel === "responses" && !r.failed)
					.map((r) => r.model),
			);
			for (const model of RESPONSES_SAMPLE) {
				if (!healthy.has(model)) {
					console.log(`(skip ${model}: backend roto según T1)`);
					continue;
				}
				for (const effort of ["low", "medium", "high"]) {
					const row = await probeResponses(model, effort);
					expectHealthy(row, `T3 ${model} effort=${effort}`);
				}
			}
		},
		600_000,
	);

	it(
		"T4 barrido ¿qué modelos verificados razonan visible a effort=high? (32; falla sólo si hay backend roto)",
		async () => {
			// Enruta cada modelo por SU canal real (capabilities del gateway),
			// como hace el catálogo (apiForCapabilities): "responses" ⇒
			// /v1/responses, resto chat-capable ⇒ /v1/chat/completions.
			const { token, root } = await auth();
			const catRes = await fetch(`${root}/v1/models`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(catRes.ok, "GET /v1/models").toBe(true);
			const cat: any = await catRes.json();
			const capsById = new Map<string, string[]>(
				(cat.data ?? []).map((m: any) => [
					String(m.id),
					Array.isArray(m.capabilities)
						? m.capabilities.map((c: any) => String(c).toLowerCase())
						: [],
				]),
			);
			const broken: string[] = [];
			for (const id of VERIFIED_MODEL_IDS) {
				const caps = capsById.get(id) ?? [];
				const row = caps.includes("responses")
					? await probeResponses(id, "high")
					: await probeChat(id, "high");
				rows.push(row);
				if (row.status !== 200 || row.failed || !row.text) {
					broken.push(
						`${id} (${caps.includes("responses") ? "responses" : "chat"}): ${
							row.failed ?? `HTTP ${row.status}${row.text ? "" : " sin texto"}`
						}`,
					);
				}
			}
			// No razonar NO es fallo (comportamiento del backend): la lista de
			// quiénes razonan queda en el reporte. Falla sólo si hay backend roto.
			expect(
				broken,
				"modelos con backend roto (reportar al equipo del gateway)",
			).toEqual([]);
		},
		1_200_000,
	);
});
