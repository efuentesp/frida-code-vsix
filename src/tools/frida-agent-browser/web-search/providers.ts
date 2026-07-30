/**
 * frida-agent-browser — web_search: proveedores Exa/Brave (Fase 5).
 *
 * Porte de web-search.js del referencia: limpieza de texto, normalización de
 * resultados, formateo compacto, builders de request y adapters por proveedor.
 * El fetch se inyecta (fetchFn) para tests; en runtime usa globalThis.fetch.
 */

import type { WebSearchParams } from "./schema";

// ── constantes ──

export const BRAVE_SEARCH_ENDPOINT =
	"https://api.search.brave.com/res/v1/web/search";
export const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
export const DEFAULT_SEARCH_RESULT_COUNT = 5;
export const MAX_SEARCH_RESULT_COUNT = 10;
export const SEARCH_REQUEST_TIMEOUT_MS = 15_000;
export const EXA_DEEP_SEARCH_REQUEST_TIMEOUT_MS = 45_000;
export const WEB_SEARCH_MIN_REQUEST_INTERVAL_MS = 1_100;

export type WebSearchProvider = "exa" | "brave";

// ── limpieza / normalización ──

const HTML_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&#x27;": "'",
};

export function decodeHtmlEntities(value: string): string {
	return value.replace(
		/&(?:amp|lt|gt|quot|#39|#x27);/g,
		(m) => HTML_ENTITIES[m] ?? m,
	);
}

export function cleanSearchText(
	value: unknown,
	maxLength = 500,
): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
	if (cleaned.length === 0) return undefined;
	return cleaned.length > maxLength
		? `${cleaned.slice(0, maxLength)}…`
		: cleaned;
}

export function normalizeSearchUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url.toString();
	} catch {
		return undefined;
	}
}

function getHostname(url: string): string | undefined {
	try {
		return new URL(url).hostname;
	} catch {
		return undefined;
	}
}

function normalizeHighlightList(highlights: unknown): string[] | undefined {
	if (!Array.isArray(highlights)) return undefined;
	const out = highlights
		.map((h) => cleanSearchText(h, 280))
		.filter((h): h is string => h !== undefined);
	return out.length > 0 ? out : undefined;
}

export interface SearchResult {
	title: string;
	url: string;
	description?: string;
	source?: string;
	age?: string;
	highlights?: string[];
}

export function normalizeBraveResult(
	result: unknown,
): SearchResult | undefined {
	if (typeof result !== "object" || result === null) return undefined;
	const r = result as Record<string, unknown>;
	const title = cleanSearchText(r.title, 180);
	const url = normalizeSearchUrl(r.url);
	if (!title || !url) return undefined;
	const profile =
		typeof r.profile === "object" && r.profile !== null
			? (r.profile as Record<string, unknown>)
			: undefined;
	const metaUrl =
		typeof r.meta_url === "object" && r.meta_url !== null
			? (r.meta_url as Record<string, unknown>)
			: undefined;
	return {
		title,
		url,
		description: cleanSearchText(r.description, 320),
		source:
			cleanSearchText(profile?.name, 120) ??
			cleanSearchText(metaUrl?.hostname, 120),
		age: cleanSearchText(r.age, 80),
	};
}

export function normalizeExaResult(result: unknown): SearchResult | undefined {
	if (typeof result !== "object" || result === null) return undefined;
	const r = result as Record<string, unknown>;
	const title = cleanSearchText(r.title, 180);
	const url = normalizeSearchUrl(r.url);
	if (!title || !url) return undefined;
	const highlights = normalizeHighlightList(r.highlights);
	return {
		title,
		url,
		description:
			cleanSearchText(r.summary, 320) ??
			highlights?.[0] ??
			cleanSearchText(r.text, 320),
		highlights,
		source:
			cleanSearchText(r.author, 120) ?? cleanSearchText(getHostname(url), 120),
		age: cleanSearchText(r.publishedDate, 80),
	};
}

// ── formato ──

export function formatSearchResults(
	provider: WebSearchProvider,
	query: string,
	results: SearchResult[],
): string {
	const label = provider === "exa" ? "Exa" : "Brave";
	if (results.length === 0)
		return `No ${label} web results found for: ${query}`;
	const lines = [`${label} web search results for: ${query}`, ""];
	results.forEach((result, index) => {
		lines.push(`${index + 1}. ${result.title}`);
		lines.push(`   URL: ${result.url}`);
		if (result.source) lines.push(`   Source: ${result.source}`);
		if (result.age) lines.push(`   Age: ${result.age}`);
		if (result.description) lines.push(`   Summary: ${result.description}`);
		if (result.highlights && result.highlights.length > 1) {
			lines.push("   Highlights:");
			for (const h of result.highlights) lines.push(`   - ${h}`);
		}
		lines.push("");
	});
	return lines.join("\n").trimEnd();
}

// ── builders de request ──

export interface SearchRequest {
	url: string;
	method: "GET" | "POST";
	headers: Record<string, string>;
	/** Header donde va la API key (la inyecta el tool con la credencial resuelta). */
	keyHeader: string;
	body?: string;
	timeoutMs: number;
}

export interface NormalizedResponse {
	results: SearchResult[];
	returnedQuery: string;
	extraDetails?: Record<string, unknown>;
}

function buildBraveUrl(
	params: WebSearchParams & { count: number; offset: number },
): string {
	let url: URL;
	try {
		url = new URL(BRAVE_SEARCH_ENDPOINT);
	} catch {
		// BRAVE_SEARCH_ENDPOINT es constante válida; fallback defensivo.
		return `${BRAVE_SEARCH_ENDPOINT}?q=${encodeURIComponent(params.query)}`;
	}
	url.searchParams.set("q", params.query);
	url.searchParams.set("count", String(params.count));
	if (params.offset > 0) url.searchParams.set("offset", String(params.offset));
	if (params.country)
		url.searchParams.set("country", params.country.toUpperCase());
	if (params.searchLang) url.searchParams.set("search_lang", params.searchLang);
	if (params.safesearch) url.searchParams.set("safesearch", params.safesearch);
	if (params.freshness) url.searchParams.set("freshness", params.freshness);
	return url.toString();
}

function buildExaBody(
	params: WebSearchParams & { count: number; offset: number },
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		query: params.query,
		numResults: Math.min(params.count + params.offset, 100),
		type: params.searchType ?? "auto",
	};
	if (params.country)
		body.userLocation = { country: params.country.toUpperCase() };
	if (params.safesearch && params.safesearch !== "off") body.moderation = true;
	if (params.freshness) {
		const map: Record<string, string> = {
			pd: "24h",
			pw: "7d",
			pm: "30d",
			py: "365d",
		};
		const start = map[params.freshness];
		if (start) body.startPublishedDate = `${start}-ago`;
	}
	return body;
}

export interface SearchAdapter {
	provider: WebSearchProvider;
	buildRequest: (
		params: WebSearchParams & { count: number; offset: number },
	) => SearchRequest;
	normalizeResponse: (
		json: unknown,
		params: WebSearchParams,
	) => NormalizedResponse;
}

export const BRAVE_ADAPTER: SearchAdapter = {
	provider: "brave",
	buildRequest(params) {
		return {
			url: buildBraveUrl(params),
			method: "GET",
			headers: { Accept: "application/json" },
			keyHeader: "X-Subscription-Token",
			timeoutMs: SEARCH_REQUEST_TIMEOUT_MS,
		};
	},
	normalizeResponse(json, params) {
		const data = (json && typeof json === "object" ? json : {}) as Record<
			string,
			unknown
		>;
		const web =
			typeof data.web === "object" && data.web !== null
				? (data.web as Record<string, unknown>)
				: undefined;
		const query =
			typeof data.query === "object" && data.query !== null
				? (data.query as Record<string, unknown>)
				: undefined;
		const results = (Array.isArray(web?.results) ? web!.results : [])
			.map(normalizeBraveResult)
			.filter((r): r is SearchResult => r !== undefined);
		return {
			results,
			returnedQuery:
				cleanSearchText(query?.altered, 300) ??
				cleanSearchText(query?.original, 300) ??
				params.query,
		};
	},
};

export const EXA_ADAPTER: SearchAdapter = {
	provider: "exa",
	buildRequest(params) {
		const searchType = params.searchType ?? "auto";
		return {
			url: EXA_SEARCH_ENDPOINT,
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			keyHeader: "x-api-key",
			body: JSON.stringify(buildExaBody(params)),
			timeoutMs: searchType.startsWith("deep")
				? EXA_DEEP_SEARCH_REQUEST_TIMEOUT_MS
				: SEARCH_REQUEST_TIMEOUT_MS,
		};
	},
	normalizeResponse(json, params) {
		const data = (json && typeof json === "object" ? json : {}) as Record<
			string,
			unknown
		>;
		const results = (Array.isArray(data.results) ? data.results : [])
			.map(normalizeExaResult)
			.filter((r): r is SearchResult => r !== undefined);
		const searchType = params.searchType ?? "auto";
		return {
			results,
			returnedQuery: params.query,
			extraDetails: {
				requestId: cleanSearchText(data.requestId, 120),
				searchType: cleanSearchText(data.searchType, 80) ?? searchType,
			},
		};
	},
};

export function getAdapter(provider: WebSearchProvider): SearchAdapter {
	return provider === "exa" ? EXA_ADAPTER : BRAVE_ADAPTER;
}
