/**
 * #122 — descubrimiento del catálogo Ollama Cloud (red, fetch inyectable).
 *
 * GET https://ollama.com/v1/models es PÚBLICO (keyless); POST /api/show
 * por modelo trae capabilities. El plugin de referencia solo corre el
 * refresh vivo cuando hay credencial resuelta — aquí el caller decide.
 */

import {
	modelIdsFromList,
	parseShowResponse,
	type OllamaCloudModelDef,
	type OllamaModelsListResponse,
	type OllamaShowResponse,
} from "./catalog";

export type FetchLike = (
	url: string,
	init?: { method?: string; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function withTimeout(ms: number): AbortSignal {
	const ctl = new AbortController();
	setTimeout(() => ctl.abort(), ms).unref?.();
	return ctl.signal;
}

/** Descubre el catálogo cloud: lista + /api/show por modelo (solo tools).
 * - Degrada parcial: si algún /api/show falla, el modelo se OMITE (no
 *   registramos capabilities desconocidas — distinto del local, donde el
 *   fail-soft conserva el modelo porque el usuario ya lo eligió descargándolo).
 * - Lanza si /v1/models no responde (red caída) — caller decide catálogo vacío.
 */
export async function discoverOllamaCloudModels(
	baseUrl: string,
	fetchImpl: FetchLike,
	opts: { listMs?: number; showMs?: number } = {},
): Promise<OllamaCloudModelDef[]> {
	const listMs = opts.listMs ?? 4_000;
	const showMs = opts.showMs ?? 10_000; // como el plugin: 10s por request

	const listRes = await fetchImpl(`${baseUrl}/models`, {
		signal: withTimeout(listMs),
	});
	if (!listRes.ok) {
		throw new Error(`Ollama Cloud /v1/models respondió !ok`);
	}
	const list = (await listRes.json()) as OllamaModelsListResponse;
	const ids = modelIdsFromList(list);
	if (ids.length === 0) return [];

	const shows = await Promise.allSettled(
		ids.map((id) =>
			fetchImpl(`${baseUrl}/api/show`, {
				method: "POST",
				body: JSON.stringify({ name: id }),
				signal: withTimeout(showMs),
			}).then((r) => (r.ok ? (r.json() as Promise<OllamaShowResponse>) : null)),
		),
	);
	const out: OllamaCloudModelDef[] = [];
	for (let i = 0; i < ids.length; i++) {
		const s = shows[i];
		if (s.status !== "fulfilled" || !s.value) continue;
		const def = parseShowResponse(ids[i], s.value);
		if (def) out.push(def);
	}
	return out;
}
