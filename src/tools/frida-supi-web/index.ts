/**
 * frida-supi-web — porte nativo para Frida de @mrclrchtr/supi-web.
 *
 * Propósito: exponer tres tools al agente — `web_fetch_md` (descarga una URL
 * pública y la devuelve como Markdown limpio), `web_docs_search` y
 * `web_docs_fetch` (búsqueda/fetch de documentación de librerías vía Context7).
 *
 * A diferencia del referencia (que renderiza su UI colapsada en el TUI de Pi con
 * renderCall/renderResult), Frida NO usa esos renderers Ink: el webview ignora el
 * rendering TUI. Por eso aquí sólo registramos `execute` (que devuelve content +
 * details) y delegamos el rendering en el ToolCard genérico del webview (ver
 * webview/components/ToolCard.tsx), que ya renderiza Markdown para estos tools.
 *
 * La lógica de fetch/conversión/context7 es un porte (sin depender del paquete
 * npm): fetch.ts, convert.ts, context7-client.ts, output.ts.
 */

import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	TruncationResult,
} from "@earendil-works/pi-coding-agent";
import {
	getContext,
	searchLibrary,
	type SearchResult,
} from "./context7-client";
import { htmlToMarkdown, wrapAsCodeBlock } from "./convert";
import { fetchWithNegotiation, isValidHttpUrl } from "./fetch";
import { limitModelVisibleOutput } from "./output";
import { getWebToolPromptSurface } from "./prompt";
import { writeTempFile } from "./temp-file";
import {
	getWebToolSpec,
	WEB_DOCS_FETCH_TOOL_NAME,
	WEB_DOCS_SEARCH_TOOL_NAME,
	WEB_FETCH_INLINE_MAX_CHARS,
	WEB_FETCH_MD_TOOL_NAME,
	type WebDocsFetchInput,
	type WebDocsSearchInput,
	type WebFetchMdInput,
	type WebFetchOutputMode,
} from "./tool-specs";

interface WebFetchDetails extends Record<string, unknown> {
	chars: number;
	lines: number;
	url: string;
	outputMode: WebFetchOutputMode;
	filePath?: string;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

interface SearchDetails extends Record<string, unknown> {
	count: number;
	libraryName: string;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

interface FetchDetails extends Record<string, unknown> {
	libraryId: string;
	raw: boolean;
	chars: number;
	lines: number;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

const MAX_SEARCH_RESULTS = 10;
const MAX_DESCRIPTION_CHARS = 120;
const MAX_VERSION_COUNT = 5;

/** Getter de la API key de Context7 (inyectada por el host desde SecretStorage). */
export interface FridaSupiWebOptions {
	getKey?: () => string | undefined;
}

/**
 * Factory de la extensión. Sigue el patrón `createFridaXxx()` de las tools
 * internas: devuelve `(pi) => { registra los tools }`. `opts.getKey` permite que
 * el host inyecte la API key de Context7 leída del SecretStorage (con fallback a
 * `process.env.CONTEXT7_API_KEY` dentro del cliente).
 */
export function createFridaSupiWeb(opts: FridaSupiWebOptions = {}) {
	const { getKey } = opts;
	return (pi: ExtensionAPI): void => {
		registerWebFetchMd(pi);
		registerWebDocsSearch(pi, getKey);
		registerWebDocsFetch(pi, getKey);
	};
}

function registerWebFetchMd(pi: ExtensionAPI): void {
	const spec = getWebToolSpec(WEB_FETCH_MD_TOOL_NAME);
	const surface = getWebToolPromptSurface(WEB_FETCH_MD_TOOL_NAME);

	pi.registerTool({
		name: spec.name,
		label: spec.label,
		description: surface.description,
		promptSnippet: surface.promptSnippet,
		promptGuidelines: surface.promptGuidelines,
		parameters: spec.parameters,
		// biome-ignore lint/complexity/useMaxParams: firma execute del SDK
		execute: runWebFetch,
	});
}

function registerWebDocsSearch(
	pi: ExtensionAPI,
	getKey?: () => string | undefined,
): void {
	const spec = getWebToolSpec(WEB_DOCS_SEARCH_TOOL_NAME);
	const surface = getWebToolPromptSurface(WEB_DOCS_SEARCH_TOOL_NAME);

	pi.registerTool({
		name: spec.name,
		label: spec.label,
		description: surface.description,
		promptSnippet: surface.promptSnippet,
		promptGuidelines: surface.promptGuidelines,
		parameters: spec.parameters,
		// biome-ignore lint/complexity/useMaxParams: firma execute del SDK
		execute: (_id, params, signal, onUpdate, ctx) =>
			runSearch(_id, params, signal, onUpdate, ctx, getKey),
	});
}

function registerWebDocsFetch(
	pi: ExtensionAPI,
	getKey?: () => string | undefined,
): void {
	const spec = getWebToolSpec(WEB_DOCS_FETCH_TOOL_NAME);
	const surface = getWebToolPromptSurface(WEB_DOCS_FETCH_TOOL_NAME);

	pi.registerTool({
		name: spec.name,
		label: spec.label,
		description: surface.description,
		promptSnippet: surface.promptSnippet,
		promptGuidelines: surface.promptGuidelines,
		parameters: spec.parameters,
		// biome-ignore lint/complexity/useMaxParams: firma execute del SDK
		execute: (_id, params, signal, onUpdate, ctx) =>
			runFetch(_id, params, signal, onUpdate, ctx, getKey),
	});
}

// biome-ignore lint/complexity/useMaxParams: firma execute del SDK
async function runWebFetch(
	_toolCallId: string,
	params: unknown,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined,
	_ctx: ExtensionContext,
): Promise<AgentToolResult<WebFetchDetails>> {
	const input = (params ?? {}) as WebFetchMdInput;
	const url = String(input.url || "").trim();
	if (!isValidHttpUrl(url)) {
		throw new Error(`URL must be http(s): ${url}`);
	}

	const outputMode = input.output_mode ?? "auto";
	const absLinks = input.abs_links ?? true;
	const timeoutMs =
		typeof input.timeout_ms === "number" ? input.timeout_ms : 30_000;

	onUpdate?.({
		content: [{ type: "text", text: `Fetching ${url}...` }],
		details: { url, outputMode },
	});

	const result = await fetchWithNegotiation(url, { timeoutMs, signal });
	const markdown = await resolveMarkdown(result, absLinks);
	const lines = markdown.split("\n").length;
	const chars = markdown.length;
	const details: WebFetchDetails = {
		chars,
		lines,
		url: result.url,
		outputMode,
	};

	if (shouldReturnFile(outputMode, chars)) {
		const filePath = await writeTempFile(markdown, "web-fetch-md", ".md");
		return {
			content: [
				{
					type: "text",
					text: `Content written to ${filePath} (${chars.toLocaleString()} chars, ${lines.toLocaleString()} lines). Use the read tool to access it.`,
				},
			],
			details: { ...details, filePath },
		};
	}

	const output = await limitModelVisibleOutput(markdown, {
		tempPrefix: "web-fetch-md",
		suffix: ".md",
	});

	return {
		content: [{ type: "text", text: output.text }],
		details: {
			...details,
			truncation: output.truncation,
			fullOutputPath: output.fullOutputPath,
		},
	};
}

function shouldReturnFile(
	outputMode: WebFetchOutputMode,
	chars: number,
): boolean {
	return (
		outputMode === "file" ||
		(outputMode === "auto" && chars > WEB_FETCH_INLINE_MAX_CHARS)
	);
}

async function resolveMarkdown(
	result: {
		isMarkdown: boolean;
		isPlainText: boolean;
		text: string;
		url: string;
	},
	absLinks: boolean,
): Promise<string> {
	if (result.isMarkdown) return result.text;
	if (result.isPlainText) return wrapAsCodeBlock(result.text, result.url);
	return await htmlToMarkdown(result.text, result.url, { absLinks });
}

// biome-ignore lint/complexity/useMaxParams: firma execute del SDK
async function runSearch(
	_toolCallId: string,
	params: unknown,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined,
	_ctx: ExtensionContext,
	getKey?: () => string | undefined,
): Promise<AgentToolResult<SearchDetails>> {
	const input = (params ?? {}) as WebDocsSearchInput;
	const libraryName = input.library_name?.trim();
	const query = input.query?.trim();

	if (!libraryName) throw new Error("'library_name' parameter is required");
	if (!query) throw new Error("'query' parameter is required");

	onUpdate?.({
		content: [
			{ type: "text", text: `Searching Context7 for ${libraryName}...` },
		],
		details: { libraryName },
	});

	const requestOptions = { signal, getKey };
	const results = await searchLibrary(query, libraryName, requestOptions);

	if (results.length === 0) {
		return {
			content: [
				{
					type: "text",
					text: `No libraries found for "${libraryName}". Try a different search term.`,
				},
			],
			details: { count: 0, libraryName },
		};
	}

	const markdown = formatSearchResults(libraryName, results);
	const output = await limitModelVisibleOutput(markdown, {
		tempPrefix: "web-docs-search",
		suffix: ".md",
	});

	return {
		content: [{ type: "text", text: output.text }],
		details: {
			count: results.length,
			libraryName,
			truncation: output.truncation,
			fullOutputPath: output.fullOutputPath,
		},
	};
}

// biome-ignore lint/complexity/useMaxParams: firma execute del SDK
async function runFetch(
	_toolCallId: string,
	params: unknown,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined,
	_ctx: ExtensionContext,
	getKey?: () => string | undefined,
): Promise<AgentToolResult<FetchDetails>> {
	const input = (params ?? {}) as WebDocsFetchInput;
	const libraryId = input.library_id?.trim();
	const query = input.query?.trim();
	const raw = Boolean(input.raw);

	if (!libraryId) throw new Error("'library_id' parameter is required");
	if (!query) throw new Error("'query' parameter is required");

	onUpdate?.({
		content: [
			{ type: "text", text: `Fetching Context7 docs for ${libraryId}...` },
		],
		details: { libraryId, raw },
	});

	const requestOptions = { signal, getKey };
	const content = await getContext(query, libraryId, raw, requestOptions);
	const textContent =
		typeof content === "string" ? content : JSON.stringify(content, null, 2);
	const output = await limitModelVisibleOutput(textContent, {
		tempPrefix: "web-docs-fetch",
		suffix: raw ? ".json" : ".md",
	});

	return {
		content: [{ type: "text", text: output.text }],
		details: {
			libraryId,
			raw,
			chars: textContent.length,
			lines: textContent.split("\n").length,
			truncation: output.truncation,
			fullOutputPath: output.fullOutputPath,
		},
	};
}

function formatSearchResults(
	libraryName: string,
	results: SearchResult[],
): string {
	const visibleResults = results.slice(0, MAX_SEARCH_RESULTS);
	const hiddenCount = results.length - visibleResults.length;
	const rows = visibleResults.map(formatSearchRow);
	const noun = results.length === 1 ? "library" : "libraries";
	const hiddenNote =
		hiddenCount > 0
			? [
					`_${hiddenCount} more omitted; refine \`library_name\` or \`query\` if needed._`,
					"",
				]
			: [];

	return [
		`Found ${results.length} Context7 ${noun} for "${libraryName}"${hiddenCount > 0 ? `; showing top ${visibleResults.length}` : ""}:`,
		"",
		"| ID | Name | Trust | Bench | Snips | Versions | Description |",
		"|---|---|---|---|---|---|---|",
		...rows,
		"",
		...hiddenNote,
		"> Use `web_docs_fetch` with the chosen ID.",
	].join("\n");
}

function formatSearchRow(lib: SearchResult): string {
	const cells = [
		`\`${escapeMd(lib.id)}\``,
		escapeMd(lib.name),
		String(lib.trustScore ?? ""),
		String(lib.benchmarkScore ?? ""),
		String(lib.totalSnippets ?? ""),
		escapeMd(formatVersions(lib.versions)),
		escapeMd(truncateCell(lib.description ?? "", MAX_DESCRIPTION_CHARS)),
	];

	return `| ${cells.join(" | ")} |`;
}

function formatVersions(versions?: string[]): string {
	if (!versions?.length) return "";
	const visibleVersions = versions.slice(0, MAX_VERSION_COUNT);
	const hiddenCount = versions.length - visibleVersions.length;
	return `${visibleVersions.join(", ")}${hiddenCount > 0 ? `, +${hiddenCount}` : ""}`;
}

function truncateCell(text: string, maxChars: number): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length <= maxChars) return compact;
	return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function escapeMd(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
