/**
 * frida-agent-browser — web_search: factory del tool (Fase 5).
 *
 * Porte de web-search.js#createAgentBrowserWebSearchTool del referencia. Registra el
 * tool `agent_browser_web_search` (Exa/Brave). Cada execute RECARGA la config (un
 * disable o error aborta aunque el tool sea visible), resuelve la credencial lazy,
 * construye el request del proveedor, hace el fetch (timeout+abort), normaliza y
 * devuelve resultados compactos citando URLs.
 */

import type { ConfigState } from "../config/load";
import {
	resolvePreferredCredential,
	buildMissingCredentialError,
} from "./credentials";
import {
	DEFAULT_SEARCH_RESULT_COUNT,
	formatSearchResults,
	getAdapter,
	MAX_SEARCH_RESULT_COUNT,
	WEB_SEARCH_MIN_REQUEST_INTERVAL_MS,
	type SearchRequest,
	type WebSearchProvider,
} from "./providers";
import {
	AGENT_BROWSER_WEB_SEARCH_PARAMS,
	type WebSearchParams,
} from "./schema";

export const AGENT_BROWSER_WEB_SEARCH_TOOL_NAME = "agent_browser_web_search";

/** Fetch inyectable para tests (default: globalThis.fetch). */
export type FetchFn = (
	url: string,
	init: Record<string, unknown>,
) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	text: () => Promise<string>;
}>;

export interface WebSearchToolOptions {
	configState: ConfigState;
	/** Recarga la config por llamada (para honrar enabled/errors en caliente). */
	loadConfigState?: (cwd: string) => ConfigState;
	fetchFn?: FetchFn;
}

/** Rate-gate mínimo: espacia llamadas WEB_SEARCH_MIN_REQUEST_INTERVAL_MS. */
class RequestGate {
	private lastMs = 0;
	async run<T>(
		signal: AbortSignal | undefined,
		fn: () => Promise<T>,
	): Promise<T> {
		const now = Date.now();
		const wait = WEB_SEARCH_MIN_REQUEST_INTERVAL_MS - (now - this.lastMs);
		if (wait > 0) await sleep(wait, signal);
		this.lastMs = Date.now();
		return fn();
	}
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				reject(new Error("agent_browser_web_search cancelled"));
			},
			{ once: true },
		);
	});
}

async function fetchSearchJson(
	request: SearchRequest,
	apiKey: string,
	signal: AbortSignal | undefined,
	fetchFn: FetchFn,
): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("Search timed out")),
		request.timeoutMs,
	);
	const abort = () =>
		controller.abort(signal?.reason ?? new Error("Search cancelled"));
	signal?.addEventListener("abort", abort, { once: true });
	try {
		const response = await fetchFn(request.url, {
			method: request.method,
			headers: { ...request.headers, [request.keyHeader]: apiKey },
			...(request.body !== undefined ? { body: request.body } : {}),
			signal: controller.signal,
		});
		const text = await response.text();
		if (!response.ok) {
			const preview = text.slice(0, 300);
			throw new Error(
				`${providerLabel(getProviderOfRequest(request))} search HTTP ${response.status} ${response.statusText}: ${preview}`,
			);
		}
		try {
			return JSON.parse(text);
		} catch (e) {
			throw new Error(
				`${providerLabel(getProviderOfRequest(request))} search returned invalid JSON: ${(e as Error).message}`,
			);
		}
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}

function getProviderOfRequest(request: SearchRequest): WebSearchProvider {
	return request.keyHeader === "x-api-key" ? "exa" : "brave";
}
function providerLabel(provider: WebSearchProvider): string {
	return provider === "exa" ? "Exa" : "Brave";
}

export function createWebSearchTool(opts: WebSearchToolOptions) {
	// SAFETY: globalThis.fetch (Node ≥18) cumple la firma (url, init?) => Promise<Response>;
	// el doble cast solo reconcilia la declaración DOM de lib.d.ts con FetchFn del port.
	const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
	const gate = new RequestGate();
	return {
		name: AGENT_BROWSER_WEB_SEARCH_TOOL_NAME,
		label: "Agent Browser Web Search",
		description: `Search the web with Exa or Brave when configured. Returns up to ${MAX_SEARCH_RESULT_COUNT} concise web results. Prefer this over browser-automated public search-engine forms (anti-bot/CAPTCHA).`,
		promptSnippet:
			"Search the live web with Exa or Brave for current or external information.",
		promptGuidelines: [
			"Use agent_browser_web_search for quick live search/URL discovery; prefer it over public search-engine forms that can hit anti-bot/CAPTCHA-gated pages. Use agent_browser after you have a target URL; one query, one follow-up max; stop on HTTP 429.",
			"agent_browser_web_search chooses Exa or Brave from configured keys; Exa is preferred by default unless webSearch.preferredProvider says otherwise.",
			"Do not issue parallel or repeated calls; use one high-signal query, inspect results, then a focused follow-up only if needed. Cite result URLs in the final answer.",
		],
		parameters: AGENT_BROWSER_WEB_SEARCH_PARAMS,
		async execute(
			_toolCallId: string,
			params: WebSearchParams,
			signal: AbortSignal | undefined,
		) {
			const state = opts.loadConfigState
				? opts.loadConfigState(process.cwd())
				: opts.configState;
			if (state.errors.length > 0) {
				throw new Error(
					`agent_browser_web_search config is invalid: ${state.errors.join("; ")}`,
				);
			}
			if (!state.webSearchEnabled) {
				throw new Error(
					"agent_browser_web_search is disabled by config (webSearch.enabled=false).",
				);
			}
			const resolved = await resolvePreferredCredential(state, {
				provider: params.provider,
				signal,
			});
			if (!resolved)
				throw new Error(buildMissingCredentialError(params.provider ?? "auto"));

			const query = params.query.trim();
			if (!query) throw new Error("query must not be blank");
			const count = Math.min(
				Math.max(params.count ?? DEFAULT_SEARCH_RESULT_COUNT, 1),
				MAX_SEARCH_RESULT_COUNT,
			);
			const offset = Math.max(params.offset ?? 0, 0);

			const adapter = getAdapter(resolved.provider);
			const request = adapter.buildRequest({ ...params, query, count, offset });
			const json = await gate.run(signal, () =>
				fetchSearchJson(request, resolved.credential.value, signal, fetchFn),
			);
			const normalized = adapter.normalizeResponse(json, { ...params, query });

			const details = {
				provider: adapter.provider,
				query,
				returnedQuery: normalized.returnedQuery,
				count,
				offset,
				fetchedAt: new Date().toISOString(),
				...normalized.extraDetails,
				results: normalized.results,
			};
			return {
				content: [
					{
						type: "text" as const,
						text: formatSearchResults(
							adapter.provider,
							normalized.returnedQuery,
							normalized.results,
						),
					},
				],
				details,
			};
		},
	};
}
