/**
 * #123 — descubrimiento del daemon Ollama local (red, fetch inyectable).
 * Separado del catálogo puro para poder testear con mocks.
 */

import {
	parseTagsResponse,
	type OllamaLocalModelDef,
	type OllamaTagsResponse,
} from "./catalog";
import type { OllamaShowResponse } from "../frida-ollama-cloud/catalog";

/** Fetch mínimo inyectable (tests). */
export type FetchLike = (
	url: string,
	init?: { method?: string; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function withTimeout(ms: number): AbortSignal {
	const ctl = new AbortController();
	setTimeout(() => ctl.abort(), ms).unref?.();
	return ctl.signal;
}

/** Normaliza el host a base sin /v1 (para /api/* del daemon). */
export function daemonBase(host: string): string {
	const withScheme = host.startsWith("http") ? host : `http://${host}`;
	return withScheme.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Descubre los modelos de chat instalados en el daemon.
 * - GET /api/tags (timeout tagsMs) → lista.
 * - Por cada modelo de chat: POST /api/show (timeout showMs) para
 *   capabilities/tools y context_length. Falla-soft: si /api/show falla,
 *   el modelo se queda con defaults (no se descarta).
 * Lanza si /api/tags no responde (daemon caído) — el caller decide registrar vacío.
 */
export async function discoverOllamaLocalModels(
	host: string,
	fetchImpl: FetchLike,
	opts: { tagsMs?: number; showMs?: number } = {},
): Promise<OllamaLocalModelDef[]> {
	const base = daemonBase(host);
	const tagsMs = opts.tagsMs ?? 2_000;
	const showMs = opts.showMs ?? 4_000;

	const tagsRes = await fetchImpl(`${base}/api/tags`, {
		signal: withTimeout(tagsMs),
	});
	if (!tagsRes.ok) {
		throw new Error(`Ollama /api/tags respondió ${tagsRes.ok ? "" : ""}error`);
	}
	const tags = (await tagsRes.json()) as OllamaTagsResponse;

	// Primera pasada: defs sin show (para saber a quién preguntar).
	const prelim = parseTagsResponse(tags);
	if (prelim.length === 0) return [];

	// Enriquecimiento con /api/show (best-effort, en paralelo).
	const shows = await Promise.allSettled(
		prelim.map((m) =>
			fetchImpl(`${base}/api/show`, {
				method: "POST",
				body: JSON.stringify({ name: m.id }),
				signal: withTimeout(showMs),
			}).then((r) => (r.ok ? (r.json() as Promise<OllamaShowResponse>) : null)),
		),
	);
	const showInfo: Record<string, OllamaShowResponse | undefined> = {};
	for (let i = 0; i < prelim.length; i++) {
		const s = shows[i];
		if (s.status === "fulfilled" && s.value) showInfo[prelim[i].id] = s.value;
	}
	// Segunda pasada con la info real (excluye modelos sin capability tools
	// SOLO cuando el show respondió; sin show se conserva — fail-soft).
	return parseTagsResponse(tags, showInfo);
}
