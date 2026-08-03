// Fetch HTTP con negociación de contenido y detección de Markdown (porte de supi-web).
//
// Estrategia en cascada para devolver el contenido "más limpio" posible:
//   1. HEAD → si el content-type ya es Markdown, GET directo.
//   2. Range GET (sniff de 8 KB) → clasifica el content-type / heurísticas.
//   3. URLs sibling .md / .markdown (README.md, index.md, <path>.md).
//   4. GET completo como HTML (luego convert.ts lo pasa a Markdown).
//
// Todos los fetch usan AbortController propio + timeout; el signal del caller
// (abort del agente) se enlaza para cancelar a tiempo.

// biome-ignore lint/style/noExcessiveLinesPerFile: el mapa expandido de guessLanguage supera el umbral; regla nursery, no estable
const USER_AGENT =
	"Mozilla/5.0 (compatible; frida-supi-web/1.0; +https://github.com/earendil-works/pi-coding-agent)";
const ACCEPT_SIBLING = "text/markdown,text/plain;q=0.9,*/*;q=0.1";
const DEFAULT_TIMEOUT_MS = 30_000;
const SNIFF_BYTES = 8192;

/** Resultado de un fetch validado. */
export interface FetchResult {
	/** URL final tras redirects. */
	url: string;
	/** Texto del cuerpo de la respuesta. */
	text: string;
	/** Content-type detectado (en minúsculas). */
	contentType: string;
	/** Si el cuerpo es Markdown crudo (sin conversión de HTML). */
	isMarkdown: boolean;
	/** Si el cuerpo es texto plano que debe cercarse como bloque de código. */
	isPlainText: boolean;
}

/** Opciones de fetch. */
export interface FetchOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

/** Valida que un string sea una URL http(s) real. */
export function isValidHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

/** Hace fetch con negociación completa de contenido y sniffing. */
export async function fetchWithNegotiation(
	url: string,
	options: FetchOptions = {},
): Promise<FetchResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const { signal } = options;

	// 1. HEAD para negociar Markdown.
	const headResult = await tryHeadNegotiation(url, timeoutMs, signal);
	if (headResult) return headResult;

	// 2. Range GET para oler el content-type.
	const sniffResult = await trySniffNegotiation(url, timeoutMs, signal);
	if (sniffResult) return sniffResult;

	// 3. Probar URLs sibling .md.
	const siblingResult = await trySiblingNegotiation(url, timeoutMs, signal);
	if (siblingResult) return siblingResult;

	// 4. GET completo como HTML → convertir a Markdown.
	return fetchAsHtml(url, timeoutMs, signal);
}

async function tryHeadNegotiation(
	url: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<FetchResult | null> {
	try {
		const headRes = await timedFetch(
			url,
			{
				method: "HEAD",
				redirect: "follow",
				headers: { "User-Agent": USER_AGENT },
			},
			timeoutMs,
			signal,
		);
		if (!headRes.ok) return null;
		const ct = headRes.headers.get("content-type") || "";
		if (!isMarkdownContentType(ct)) return null;

		const getRes = await timedFetch(
			url,
			{
				method: "GET",
				redirect: "follow",
				headers: { "User-Agent": USER_AGENT },
			},
			timeoutMs,
			signal,
		);
		if (!getRes.ok)
			throw new FetchError(
				`Fetch failed: ${getRes.status} ${getRes.statusText}`,
				{
					status: getRes.status,
				},
			);
		return {
			url: getRes.url || url,
			text: await getRes.text(),
			contentType: ct,
			isMarkdown: true,
			isPlainText: false,
		};
	} catch (err) {
		if (signal?.aborted) throw err;
		return null;
	}
}

async function trySniffNegotiation(
	url: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<FetchResult | null> {
	try {
		const sniffRes = await timedFetch(
			url,
			{
				method: "GET",
				redirect: "follow",
				headers: {
					"User-Agent": USER_AGENT,
					Range: `bytes=0-${SNIFF_BYTES - 1}`,
				},
			},
			timeoutMs,
			signal,
		);
		const sniffText = await readPartialText(sniffRes, SNIFF_BYTES);
		const ct = sniffRes.headers.get("content-type") || "";
		const finalUrl = sniffRes.url || url;

		if (!sniffRes.ok || isHtml(sniffText)) return null;
		if (isMarkdownCandidate(ct, finalUrl, sniffText)) {
			return fetchFullTextResult({
				url,
				timeoutMs,
				signal,
				contentType: ct,
				kind: MARKDOWN_RESPONSE_KIND,
				headers: { "User-Agent": USER_AGENT },
			});
		}
		if (isPlainTextCandidate(ct, finalUrl, sniffText)) {
			return fetchFullTextResult({
				url,
				timeoutMs,
				signal,
				contentType: ct,
				kind: PLAIN_TEXT_RESPONSE_KIND,
				headers: { "User-Agent": USER_AGENT },
			});
		}
		return null;
	} catch (err) {
		if (signal?.aborted) throw err;
		return null;
	}
}

async function trySiblingNegotiation(
	url: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<FetchResult | null> {
	for (const sibling of generateSiblingUrls(url)) {
		try {
			const result = await fetchMarkdownSibling(sibling, timeoutMs, signal);
			if (result) return result;
		} catch (err) {
			if (signal?.aborted) throw err;
			// Probar el siguiente sibling
		}
	}
	return null;
}

async function fetchMarkdownSibling(
	sibling: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<FetchResult | null> {
	const headers = { "User-Agent": USER_AGENT, Accept: ACCEPT_SIBLING };
	const sibRes = await timedFetch(
		sibling,
		{ method: "GET", redirect: "follow", headers },
		timeoutMs,
		signal,
	);
	const sibText = await readPartialText(sibRes, SNIFF_BYTES);
	const sibCt = sibRes.headers.get("content-type") || "";

	if (!sibRes.ok || isHtml(sibText) || isHtmlContentType(sibCt)) return null;
	if (!looksLikeMarkdown(sibText) && !isMarkdownContentType(sibCt)) return null;

	const fullRes = await timedFetch(
		sibling,
		{ method: "GET", redirect: "follow", headers },
		timeoutMs,
		signal,
	);
	if (!fullRes.ok) return null;
	return buildFetchResult(fullRes, sibling, sibCt, MARKDOWN_RESPONSE_KIND);
}

interface ResponseKind {
	isMarkdown: boolean;
	isPlainText: boolean;
}

interface FetchFullTextOptions {
	url: string;
	timeoutMs: number;
	signal: AbortSignal | undefined;
	contentType: string;
	kind: ResponseKind;
	headers: Record<string, string>;
}

const MARKDOWN_RESPONSE_KIND = {
	isMarkdown: true,
	isPlainText: false,
} as const;
const PLAIN_TEXT_RESPONSE_KIND = {
	isMarkdown: false,
	isPlainText: true,
} as const;

async function fetchFullTextResult(
	options: FetchFullTextOptions,
): Promise<FetchResult> {
	const fullRes = await timedFetch(
		options.url,
		{ method: "GET", redirect: "follow", headers: options.headers },
		options.timeoutMs,
		options.signal,
	);
	if (!fullRes.ok)
		throw new FetchError(
			`Fetch failed: ${fullRes.status} ${fullRes.statusText}`,
			{
				status: fullRes.status,
			},
		);
	return buildFetchResult(
		fullRes,
		options.url,
		options.contentType,
		options.kind,
	);
}

async function buildFetchResult(
	response: Response,
	fallbackUrl: string,
	contentType: string,
	kind: ResponseKind,
): Promise<FetchResult> {
	return {
		url: response.url || fallbackUrl,
		text: await response.text(),
		contentType,
		isMarkdown: kind.isMarkdown,
		isPlainText: kind.isPlainText,
	};
}

function isMarkdownCandidate(
	contentType: string,
	finalUrl: string,
	sniffText: string,
): boolean {
	return (
		isMarkdownContentType(contentType) ||
		looksLikeMarkdownUrl(finalUrl) ||
		looksLikeMarkdown(sniffText)
	);
}

function isPlainTextCandidate(
	contentType: string,
	finalUrl: string,
	sniffText: string,
): boolean {
	return (
		isPlainTextContentType(contentType) &&
		!looksLikeMarkdownUrl(finalUrl) &&
		!looksLikeMarkdown(sniffText)
	);
}

async function fetchAsHtml(
	url: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<FetchResult> {
	const res = await timedFetch(
		url,
		{
			method: "GET",
			redirect: "follow",
			headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.1" },
		},
		timeoutMs,
		signal,
	);
	if (!res.ok)
		throw new FetchError(`Fetch failed: ${res.status} ${res.statusText}`, {
			status: res.status,
		});
	return {
		url: res.url || url,
		text: await res.text(),
		contentType: res.headers.get("content-type") || "",
		isMarkdown: false,
		isPlainText: false,
	};
}

/** Error lanzado en fallos de fetch. */
export interface FetchErrorOptions extends ErrorOptions {
	status?: number;
}

export class FetchError extends Error {
	readonly status?: number;

	constructor(message: string, options: FetchErrorOptions = {}) {
		super(message, options);
		this.name = "FetchError";
		this.status = options.status;
	}
}

async function timedFetch(
	url: string,
	init: RequestInit,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<Response> {
	const controller = new AbortController();
	let timedOut = false;
	const abortFromParent = () => controller.abort();
	if (signal?.aborted) abortFromParent();
	else signal?.addEventListener("abort", abortFromParent, { once: true });

	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (err) {
		if (timedOut)
			throw new FetchError(`Fetch timed out after ${timeoutMs}ms`, {
				cause: err,
			});
		throw err;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", abortFromParent);
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lectura de stream con lógica de salida temprana
async function readPartialText(
	res: Response,
	maxBytes: number,
): Promise<string> {
	const body = res.body;
	if (
		body &&
		typeof (body as unknown as { getReader: () => unknown }).getReader ===
			"function"
	) {
		const reader = (body as unknown as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder("utf-8");
		let text = "";
		let bytes = 0;
		try {
			while (bytes < maxBytes) {
				const { value, done } = await reader.read();
				if (done) break;
				if (value) {
					bytes += value.byteLength;
					text += decoder.decode(value, { stream: true });
				}
				if (bytes >= maxBytes) break;
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
				/* ignorar */
			}
		}
		return (text + decoder.decode()).slice(0, Math.max(0, maxBytes));
	}
	return (await res.text()).slice(0, Math.max(0, maxBytes));
}

function isMarkdownContentType(ct: string): boolean {
	const lower = ct.toLowerCase();
	return (
		lower.includes("text/markdown") ||
		lower.includes("text/x-markdown") ||
		lower.includes("application/markdown") ||
		lower.includes("application/x-markdown")
	);
}

function isHtmlContentType(ct: string): boolean {
	const lower = ct.toLowerCase();
	return lower.includes("text/html") || lower.includes("application/xhtml+xml");
}

export function isPlainTextContentType(ct: string): boolean {
	const lower = ct.toLowerCase();
	if (isHtmlContentType(ct)) return false;
	return lower.startsWith("text/") || lower.includes("application/xml");
}

export function isHtml(text: string): boolean {
	const trimmed = (text || "").trimStart().slice(0, 2000).toLowerCase();
	return Boolean(
		trimmed.startsWith("<!doctype html") ||
			trimmed.startsWith("<html") ||
			trimmed.startsWith("<?xml") ||
			/<(head|body)\b/.test(trimmed) ||
			(trimmed.startsWith("<") && /<\/(html|head|body)>/.test(trimmed)),
	);
}

export function looksLikeMarkdown(text: string): boolean {
	const sample = (text || "").slice(0, 4000);
	return Boolean(
		/^\s*#\s+\S+/m.test(sample) ||
			/^\s*---\s*$/m.test(sample) ||
			/```/.test(sample) ||
			/^\s*[-*+]\s+\S+/m.test(sample) ||
			/^\s*\d+\.\s+\S+/m.test(sample) ||
			/\[[^\]]+\]\([^)]+\)/.test(sample),
	);
}

function looksLikeMarkdownUrl(url: string): boolean {
	try {
		const path = new URL(url).pathname.toLowerCase();
		return path.endsWith(".md") || path.endsWith(".markdown");
	} catch {
		return false;
	}
}

function generateSiblingUrls(url: string): string[] {
	try {
		const parsed = new URL(url);
		parsed.hash = "";
		parsed.search = "";
		const path = parsed.pathname;
		const siblings: string[] = [];

		if (path.endsWith("/")) {
			siblings.push(new URL("index.md", parsed).toString());
			siblings.push(new URL("README.md", parsed).toString());
		} else if (!path.toLowerCase().endsWith(".md")) {
			const withMd = new URL(parsed.toString());
			withMd.pathname = `${path}.md`;
			siblings.push(withMd.toString());
		}

		const withMarkdown = new URL(parsed.toString());
		if (!path.toLowerCase().endsWith(".markdown")) {
			withMarkdown.pathname = path.endsWith("/")
				? `${path}index.markdown`
				: `${path}.markdown`;
			siblings.push(withMarkdown.toString());
		}

		return siblings;
	} catch {
		// URL inválida (no debería llegar aquí: ya validada aguas arriba).
		return [];
	}
}

/** Infiere un identificador de lenguaje desde la extensión del pathname de la URL. */
export function guessLanguage(url: string): string {
	try {
		const ext =
			new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
		const map: Record<string, string> = {
			bash: "bash",
			c: "c",
			cc: "cpp",
			conf: "conf",
			cpp: "cpp",
			css: "css",
			cxx: "cpp",
			dart: "dart",
			dockerfile: "dockerfile",
			elixir: "elixir",
			ex: "elixir",
			exs: "elixir",
			go: "go",
			graphql: "graphql",
			gql: "graphql",
			h: "c",
			hpp: "cpp",
			html: "html",
			htm: "html",
			ini: "ini",
			java: "java",
			js: "javascript",
			json: "json",
			jsx: "jsx",
			kt: "kotlin",
			kts: "kotlin",
			less: "less",
			lua: "lua",
			mjs: "javascript",
			cjs: "javascript",
			md: "markdown",
			php: "php",
			pl: "perl",
			ps: "powershell",
			ps1: "powershell",
			py: "python",
			r: "r",
			rb: "ruby",
			rs: "rust",
			scss: "scss",
			sh: "sh",
			sql: "sql",
			svelte: "svelte",
			swift: "swift",
			toml: "toml",
			ts: "ts",
			tsx: "tsx",
			vue: "vue",
			yaml: "yaml",
			yml: "yaml",
			xml: "xml",
			zsh: "zsh",
		};
		return map[ext] || "";
	} catch {
		return "";
	}
}
