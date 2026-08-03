// Cliente de la API REST de Context7 (porte de supi-web).
//
// Llama directamente a la API de Context7 con fetch(). La clave se lee de la
// variable de entorno CONTEXT7_API_KEY; sin ella, las peticiones van sin header
// Authorization y la API responde 401.

const BASE_URL = "https://context7.com/api";

export class Context7Error extends Error {
	constructor(message: string) {
		super(message);
		this.name = "Context7Error";
	}
}

export interface SearchResult {
	id: string;
	name: string;
	description: string;
	totalSnippets: number;
	trustScore: number;
	benchmarkScore: number;
	versions?: string[];
}

export interface DocSnippet {
	title: string;
	content: string;
	source: string;
}

/** Opciones de petición compartidas por las llamadas REST de Context7. */
export interface Context7RequestOptions {
	signal?: AbortSignal;
	/** Getter de la API key inyectada por el host (SecretStorage). Fallback: process.env.CONTEXT7_API_KEY. */
	getKey?: () => string | undefined;
}

/** Resuelve la API key: la inyectada por el host (SecretStorage) o la de entorno. */
function resolveApiKey(options?: Context7RequestOptions): string | undefined {
	return options?.getKey?.() ?? process.env.CONTEXT7_API_KEY;
}

function authHeaders(options?: Context7RequestOptions): Record<string, string> {
	const apiKey = resolveApiKey(options);
	return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** Construye una URL de la API con query params (encoding correcto vía URL.searchParams). */
function buildApiUrl(path: string, params: Record<string, string>): string {
	try {
		const url = new URL(`${BASE_URL}${path}`);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		return url.toString();
	} catch {
		// BASE_URL es una constante válida; no debería ocurrir.
		return `${BASE_URL}${path}`;
	}
}

async function parseErrorResponse(
	response: Response,
	hasKey: boolean,
): Promise<string> {
	try {
		const json = (await response.json()) as { message?: string };
		if (json.message) return json.message;
	} catch {
		// Falló el parseo JSON → mensaje basado en el status.
	}

	if (response.status === 429) {
		return hasKey
			? "Rate limited or quota exceeded. Upgrade your plan at https://context7.com/plans for higher limits."
			: "Rate limited or quota exceeded. Create a free API key at https://context7.com/dashboard for higher limits.";
	}
	if (response.status === 404) {
		return "The library you are trying to access does not exist. Please try with a different library ID.";
	}
	if (response.status === 401) {
		return "Invalid API key. Please check your API key. API keys should start with 'ctx7sk' prefix.";
	}
	return `Request failed with status ${response.status}. Please try again later.`;
}

interface ApiSearchResult {
	id: string;
	title: string;
	description: string;
	totalSnippets: number;
	trustScore: number;
	benchmarkScore: number;
	versions?: string[];
}

interface ApiSearchResponse {
	error?: string;
	results: ApiSearchResult[];
}

function mapSearchResult(r: ApiSearchResult): SearchResult {
	return {
		id: r.id,
		name: r.title,
		description: r.description,
		totalSnippets: r.totalSnippets,
		trustScore: r.trustScore,
		benchmarkScore: r.benchmarkScore,
		versions: r.versions,
	};
}

export async function searchLibrary(
	query: string,
	libraryName: string,
	options: Context7RequestOptions = {},
): Promise<SearchResult[]> {
	const url = buildApiUrl("/v2/libs/search", { query, libraryName });

	const response = await fetch(url, {
		headers: authHeaders(options),
		signal: options.signal,
	});

	if (!response.ok) {
		throw new Context7Error(
			await parseErrorResponse(response, Boolean(resolveApiKey(options))),
		);
	}

	const data = (await response.json()) as ApiSearchResponse;
	return (data.results ?? []).map(mapSearchResult);
}

export async function getContext(
	query: string,
	libraryId: string,
	raw?: boolean,
	options: Context7RequestOptions = {},
): Promise<string | DocSnippet[]> {
	const url = buildApiUrl("/v2/context", { query, libraryId });

	const response = await fetch(url, {
		headers: authHeaders(options),
		signal: options.signal,
	});

	if (!response.ok) {
		throw new Context7Error(
			await parseErrorResponse(response, Boolean(resolveApiKey(options))),
		);
	}

	if (raw) {
		return (await response.json()) as DocSnippet[];
	}

	return response.text();
}
