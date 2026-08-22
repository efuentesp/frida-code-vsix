/**
 * Ping de proveedores de embeddings (#116, Fase A).
 *
 * POST {baseUrl}/embeddings con input:"ping" — protocolo OpenAI-compatible
 * que sirven los 4 proveedores soportados (Frida Enterprise vía
 * ${COMPATIBLE_API_URL}/v1 con Bearer idToken, Ollama local :11434/v1,
 * OpenAI api.openai.com/v1, endpoint custom). Mide latencia y DEDUCE las
 * dimensions del vector de respuesta — el upstream exige dimensions entero
 * >0 para customProvider y el Ping es la fuente de verdad (decisión de
 * diseño: auto-detección, no catálogo hardcodeado).
 */

export interface PingArgs {
	baseUrl: string;
	model: string;
	/** Bearer token (Enterprise/OpenAI). Sin apiKey (Ollama) no se envía Authorization. */
	apiKey?: string;
	/** Inyectable para tests. Default: global fetch. */
	fetchImpl?: typeof fetch;
	/** Timeout del request. Default 10s. */
	timeoutMs?: number;
}

export interface PingResult {
	ok: boolean;
	latencyMs?: number;
	/** Dimensiones reales del vector devuelto (deducidas). */
	dimensions?: number;
	error?: string;
}

export async function pingEmbeddingsProvider(
	args: PingArgs,
): Promise<PingResult> {
	const base = args.baseUrl.replace(/\/+$/, "");
	const url = `${base}/embeddings`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`;

	const started = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 10_000);
	try {
		const fetchImpl = args.fetchImpl ?? fetch;
		const res = await fetchImpl(url, {
			method: "POST",
			headers,
			body: JSON.stringify({ model: args.model, input: "ping" }),
			signal: controller.signal,
		});
		const latencyMs = Date.now() - started;
		if (!res.ok) {
			return { ok: false, latencyMs, error: `HTTP ${res.status}` };
		}
		const json: unknown = await res.json();
		const body = json as { data?: { embedding?: unknown[] }[] };
		const embedding = body?.data?.[0]?.embedding;
		if (!Array.isArray(embedding) || embedding.length === 0) {
			return {
				ok: false,
				latencyMs,
				error: "respuesta sin embedding válido",
			};
		}
		return { ok: true, latencyMs, dimensions: embedding.length };
	} catch (e: any) {
		const msg =
			e?.name === "AbortError"
				? `timeout tras ${args.timeoutMs ?? 10_000}ms`
				: (e?.message ?? String(e));
		return { ok: false, error: msg };
	} finally {
		clearTimeout(timer);
	}
}
