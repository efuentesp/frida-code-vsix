// E2E live OPT-IN (ADR-1002 §embeddings): matriz de los 4 modelos de
// EMBEDDINGS del gateway — la pieza clave del RAG con base vectorial que
// frida code planea implementar.
//
// OBJETIVO (análogo a live-reasoning.e2e.test.ts para chat/responses):
//   T1  el catálogo publica los 4 modelos embeddings conocidos, con
//       capability "embeddings" y SIN "chat"/"responses" (por eso el
//       selector no los lista — coherencia con el filtro del provider).
//   T2  el contrato Errata-2 APLICA a embeddings: sin user_id/email en el
//       body → 422 "Field required" (verificado en vivo 2026-08-17; el
//       gateway exige identidad también fuera de chat/completions).
//   T3  cada modelo responde 200 con vector válido: object=list,
//       data[0].embedding no vacío, dimensiones ESTABLES entre llamadas
//       (una colección vectorial exige dims fijas), batch de 2 inputs →
//       2 vectores, y usage.prompt_tokens > 0.
//   T4  semántica RAG con BENCHMARK de 6 tripletas ES/EN (batch de 18
//       inputs, 1 llamada por modelo): cos(query, relacionado) debe superar
//       a cos(query, no-relacionado) en TODAS — si falla, el embedding NO
//       sirve para recuperación. El reporte rankea por margen de
//       discriminación (base para elegir modelo del RAG).
//
//   FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-embeddings.e2e.test.ts
//   Override de muestra: FRIDA_ENTERPRISE_EMBED_MODELS="MNEMOSYNE-THREAD"
//
// Genera test/frida-enterprise/e2e/reporte-embeddings.md con la matriz
// (modelo × dims × batch × determinismo × semántica × usage) al terminar.
//
// NOTA: probes HTTP directos (como live.test.ts) — validan COMPORTAMIENTO
// del gateway por modelo, no wiring del host (embeddings están fuera del
// scope chat del provider; eso lo cubre live-runtime). Ejemplo equivalente
// en Python: frida-enterprise/examples/embedding_example.py (espejo).

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";

const live = process.env.FRIDA_ENTERPRISE_LIVE === "1";
const FIREBASE_KEY = "AIzaSyAdz0OylajBmWqUyl5mIJ46AT2CSCwV54w";

/** Los 4 modelos embeddings publicados por el gateway (capability
 *  "embeddings"; documentados en ADR-1002 §catálogo curado). */
const EMBEDDING_MODEL_IDS = (
	process.env.FRIDA_ENTERPRISE_EMBED_MODELS ??
	"MNEMOSYNE-THREAD,URANIA-VAST,CALLIOPE-GRAIN,CLIO-RELIC"
)
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

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

/** POST /v1/embeddings crudo (identity opcional para el caso negativo T2). */
async function postEmbeddings(
	body: Record<string, unknown>,
	identity?: Record<string, string>,
): Promise<{ status: number; json: any; text: string }> {
	const { token, identity: id, root } = await auth();
	const res = await fetch(`${root}/v1/embeddings`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ ...body, ...(identity ?? id) }),
	});
	const text = await res.text();
	let json: any = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* noop — respuestas no-JSON se reportan como texto */
	}
	return { status: res.status, json, text };
}

/** Similitud coseno entre dos vectores (dims coinciden por contrato). */
function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Vector de un input simple (asume 200 — T3/T4 asertan lo demás). */
async function embedOne(model: string, input: string): Promise<number[]> {
	const { status, json, text } = await postEmbeddings({ model, input });
	if (status !== 200)
		throw new Error(`${model} → HTTP ${status}: ${text.slice(0, 140)}`);
	return json.data[0].embedding as number[];
}

/** Fila de la matriz para el reporte MD. */
type Row = {
	model: string;
	status: number;
	dims: number | null;
	batch: boolean | null;
	deterministic: boolean | null;
	semantics: boolean | null;
	cosRelated: number | null;
	cosUnrelated: number | null;
	meanMargin: number | null;
	minMargin: number | null;
	wins: number | null;
	promptTokens: number | null;
	failed: string | null;
};

const rows: Row[] = [];

/** Tripletas semánticas del RAG (ES/EN, dominio frida code): la query debe
 *  acercarse más al chunk correcto que al distractor en TODAS. */
const TRIPLETS: ReadonlyArray<readonly [string, string, string]> = [
	[
		"¿Cómo renuevo el token expirado?",
		"El refresh_token se usa con el endpoint securetoken para obtener un idToken nuevo cada hora.",
		"La receta de pan requiere harina, agua, sal y levadura.",
	],
	[
		"¿Dónde se guardan las credenciales del provider?",
		"Las credenciales OAuth se persisten en ~/.frida/auth.json con permisos chmod 600.",
		"El partido de fútbol terminó tres a dos en el tiempo extra.",
	],
	[
		"How do I stream SSE responses from the gateway?",
		"El streaming usa chunks chat.completion.chunk con delta.content en líneas data:.",
		"Las vacaciones de verano en la playa fueron muy relajantes.",
	],
	[
		"¿Qué causa el error 422?",
		"El gateway exige user_id y email en el body; si faltan responde 422 Field required.",
		"El gato duerme sobre el teclado de la laptop.",
	],
	[
		"¿Cómo se filtran los modelos del selector?",
		"VERIFIED_MODEL_IDS filtra el catálogo a los 32 modelos verificados en la matriz live.",
		"El clima de hoy está nublado con probabilidad de lluvia.",
	],
	[
		"What endpoint serves reasoning summaries?",
		"Los modelos responses razonan vía /v1/responses, que emite response.reasoning_summary_text.",
		"La música de Mozart se compuso en el siglo XVIII.",
	],
];

describe.skipIf(!live)("E2E live: embeddings del gateway (RAG-ready)", () => {
	it(
		"T1 catálogo: los 4 modelos embeddings publicados, capability embeddings y SIN chat/responses",
		async () => {
			const { token, root } = await auth();
			const catRes = await fetch(`${root}/v1/models`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(catRes.ok, "GET /v1/models").toBe(true);
			const cat: any = await catRes.json();
			const byId = new Map<string, string[]>(
				(cat.data ?? []).map((m: any) => [
					String(m.id),
					Array.isArray(m.capabilities)
						? m.capabilities.map((c: any) => String(c).toLowerCase())
						: [],
				]),
			);
			const embedIds = [...byId.entries()]
				.filter(([, caps]) => caps.includes("embeddings"))
				.map(([id]) => id);
			// Contracto del catálogo: exactamente los 4 conocidos (nuevo modelo ⇒
			// actualizar EMBEDDING_MODEL_IDS tras pasar esta matriz).
			expect(embedIds.sort()).toEqual([...EMBEDDING_MODEL_IDS].sort());
			for (const id of EMBEDDING_MODEL_IDS) {
				const caps = byId.get(id) ?? [];
				expect(caps, `${id} capabilities`).toContain("embeddings");
				expect(
					caps.some((c) => c === "chat" || c === "responses"),
					`${id} no debe ser chat/responses (el selector los excluye)`,
				).toBe(false);
			}
		},
		120_000,
	);

	it(
		"T2 Errata-2 aplica a embeddings: sin user_id/email → 422 Field required",
		async () => {
			const model = EMBEDDING_MODEL_IDS[0];
			const { status, json, text } = await postEmbeddings(
				{ model, input: "hola mundo" },
				{}, // SIN identidad — caso negativo del contrato
			);
			expect(status).toBe(422);
			const detail = json?.detail ?? [];
			const missing = detail
				.filter((d: any) => d?.type === "missing")
				.map((d: any) => d?.loc?.join("."));
			expect(missing, `body 422 → ${text.slice(0, 160)}`).toEqual(
				expect.arrayContaining(["body.user_id", "body.email"]),
			);
		},
		120_000,
	);

	it(
		"T3 matriz: cada modelo → 200, vector válido, dims estables, batch y usage",
		async () => {
			for (const model of EMBEDDING_MODEL_IDS) {
				const row: Row = {
					model,
					status: 0,
					dims: null,
					batch: null,
					deterministic: null,
					semantics: null,
					cosRelated: null,
					cosUnrelated: null,
					meanMargin: null,
					minMargin: null,
					wins: null,
					promptTokens: null,
					failed: null,
				};
				try {
					const first = await postEmbeddings({
						model,
						input: "hola mundo",
					});
					row.status = first.status;
					expect(first.status, `${model} HTTP`).toBe(200);
					expect(first.json?.object, `${model} object`).toBe("list");
					expect(first.json?.model, `${model} echo`).toBe(model);
					const vec = first.json?.data?.[0]?.embedding;
					expect(
						Array.isArray(vec) && vec.length > 0,
						`${model} data[0].embedding`,
					).toBe(true);
					row.dims = vec.length;
					expect(
						typeof first.json?.usage?.prompt_tokens === "number" &&
							first.json.usage.prompt_tokens > 0,
						`${model} usage.prompt_tokens`,
					).toBe(true);
					row.promptTokens = first.json.usage.prompt_tokens;

					// Dims ESTABLES (segunda llamada, texto distinto).
					const second = await embedOne(model, "otro texto diferente");
					expect(second.length, `${model} dims estables`).toBe(row.dims);

					// Determinismo (mismo texto ⇒ ¿mismo vector?): registro para
					// el reporte, NO aserción (el backend puede cachear/batch).
					const third = await embedOne(model, "hola mundo");
					row.deterministic =
						third.length === vec.length &&
						third.every((v, i) => v === vec[i]);

					// Batch OpenAI: array de inputs ⇒ N vectores con mismas dims.
					const batch = await postEmbeddings({
						model,
						input: ["hola", "mundo vectorial"],
					});
					row.batch =
						batch.status === 200 &&
						batch.json?.data?.length === 2 &&
						batch.json.data.every(
							(d: any) => Array.isArray(d?.embedding) && d.embedding.length === row.dims,
						);
					expect(row.batch, `${model} batch de 2 inputs`).toBe(true);
				} catch (err) {
					row.failed = String(err).slice(0, 140);
					throw err;
				} finally {
					rows.push(row);
				}
			}
		},
		600_000,
	);

	it(
		"T4 semántica RAG (benchmark 6 tripletas ES/EN): cos(query,rel) > cos(query,unrel) en TODAS",
		async () => {
			for (const model of EMBEDDING_MODEL_IDS) {
				// Una sola llamada batch con los 18 textos (6 tripletas × 3).
				const flat = TRIPLETS.flatMap(([q, r, u]) => [q, r, u]);
				const { status, json, text } = await postEmbeddings({
					model,
					input: flat,
				});
				expect(status, `${model} HTTP`).toBe(200);
				const data = json?.data;
				expect(
					Array.isArray(data) && data.length === flat.length,
					`${model} batch de ${flat.length} inputs`,
				).toBe(true);
				const vecs = data.map((d: any) => d.embedding as number[]);

				const rels: number[] = [];
				const unrels: number[] = [];
				for (const [i] of TRIPLETS.entries()) {
					const cosRel = cosine(vecs[i * 3], vecs[i * 3 + 1]);
					const cosUnrel = cosine(vecs[i * 3], vecs[i * 3 + 2]);
					rels.push(cosRel);
					unrels.push(cosUnrel);
					expect(
						cosRel > cosUnrel,
						`${model} triplete ${i + 1}/6: cos(relacionado)=${cosRel.toFixed(4)} debe superar a cos(no-relacionado)=${cosUnrel.toFixed(4)} — si falla, el embedding no sirve para RAG`,
					).toBe(true);
				}
				const margins = rels.map((rel, i) => rel - unrels[i]);
				const mean = (a: number[]) =>
					a.reduce((x, y) => x + y, 0) / a.length;

				// Actualiza la fila de T3 (ya registrada) con las stats del benchmark.
				let row = rows.find((r) => r.model === model);
				if (!row) {
					row = {
						model,
						status,
						dims: vecs[0]?.length ?? null,
						batch: true,
						deterministic: null,
						semantics: null,
						cosRelated: null,
						cosUnrelated: null,
						meanMargin: null,
						minMargin: null,
						wins: null,
						promptTokens: null,
						failed: null,
					};
					rows.push(row);
				}
				row.semantics = margins.every((m) => m > 0);
				row.cosRelated = Number(mean(rels).toFixed(4));
				row.cosUnrelated = Number(mean(unrels).toFixed(4));
				row.meanMargin = Number(mean(margins).toFixed(4));
				row.minMargin = Number(Math.min(...margins).toFixed(4));
				row.wins = margins.filter((m) => m > 0).length;
			}
		},
		600_000,
	);
});

afterAll(() => {
	// Reporte MD con la matriz completa (sólo si corrió algo)
	if (rows.length === 0) return;
	const stamp = new Date().toISOString();
	const lines = [
		`# Reporte de embeddings en vivo (matriz RAG-ready)`,
		``,
		`Generado por \`live-embeddings.e2e.test.ts\` (opt-in) — ${stamp}. Re-correr:`,
		"\n```bash",
		"FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-embeddings.e2e.test.ts",
		"```\n",
		`Contrato verificado: Bearer idToken + user_id/email en el body (Errata-2 aplica a embeddings) + POST {COMPATIBLE_API_URL}/v1/embeddings.`,
		`Semántica: benchmark de 6 tripletas ES/EN (query · chunk relevante · distractor); cos(rel)/cos(unrel) son MEDIAS de las 6.`,
		``,
		`| Modelo | HTTP | Dims | Batch | Determinista | Semántica | cos(rel) | cos(unrel) | Margen medio | Margen mín | Wins | prompt_tokens | Fallo |`,
		`|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
	];
	for (const r of rows) {
		lines.push(
			`| ${r.model} | ${r.status} | ${r.dims ?? "—"} | ${
				r.batch ? "✓" : "✗"
			} | ${r.deterministic === null ? "—" : r.deterministic ? "✓" : "✗"} | ${
				r.semantics === null ? "—" : r.semantics ? "✓" : "✗"
			} | ${r.cosRelated ?? "—"} | ${r.cosUnrelated ?? "—"} | ${
				r.meanMargin ?? "—"
			} | ${r.minMargin ?? "—"} | ${
				r.wins === null ? "—" : `${r.wins}/6`
			} | ${r.promptTokens ?? "—"} | ${
				r.failed ? `**${r.failed.slice(0, 60)}**` : "—"
			} |`,
		);
	}
	// Ranking por margen MÍNIMO (peor caso del benchmark) — base para elegir
	// el modelo del RAG: margen pequeño ⇒ distractores cerca de la query.
	const ranked = rows
		.filter((r) => r.minMargin !== null)
		.sort((a, b) => (b.minMargin ?? 0) - (a.minMargin ?? 0));
	if (ranked.length > 0) {
		lines.push(
			"",
			"## Ranking de discriminación (por margen mínimo, peor caso)",
			"",
		);
		ranked.forEach((r, i) =>
			lines.push(
				`${i + 1}. **${r.model}** — margen medio ${r.meanMargin}, mínimo ${r.minMargin} (${r.wins}/6 tripletas, ${r.dims} dims)`,
			),
		);
	}
	lines.push(
		"",
		"## Notas para el RAG de frida code",
		"",
		"- **Dims por modelo**: una colección vectorial exige dims fijas — los valores de la columna Dims son los que hay que configurar por modelo.",
		"- **Determinista** (FLAKY, observado 2026-08-17: ✓/✗ entre corridas en URANIA/CALLIOPE — réplicas del backend): mismo input ⇒ mismo vector SÓLO dentro de una corrida. Para el RAG: NO comparar embeddings entre corridas (similitud≠1.0); re-indexar documentos completos juntos, nunca parcialmente.",
		"- **Batch**: el gateway acepta `input: string[]` (indexado por lotes).",
		"- **Semántica**: benchmark de 6 tripletas ES/EN — la query se acerca más al chunk relevante que al distractor en TODAS (requisito mínimo de recuperación).",
		"- **Ranking**: ordenado por margen MÍNIMO (peor caso). Márgenes ≲0.15 indican anisotropía (distractores a cos alto de la query ⇒ falsos positivos con umbral de similitud). Dos modelos con vectores idénticos son el mismo backend subyacente.",
		"- Ejemplo mínimo en Python: `frida-enterprise/examples/embedding_example.py`.",
		"",
	);
	const out = `${__dirname}/reporte-embeddings.md`;
	try {
		fs.writeFileSync(out, lines.join("\n"), "utf8");
		// eslint-disable-next-line no-console
		console.log(`matriz escrita → ${out}`);
	} catch {
		/* noop */
	}
});
