// Catálogo central de las 3 tools web (porte de supi-web).
//
// Define nombre, label, parámetros (typebox), descripción y metadata de prompt
// para web_fetch_md / web_docs_search / web_docs_fetch. Un único punto de verdad
// que consumen index.ts (registro) y el webview (rendering).

import { type Static, type TSchema, Type } from "typebox";
import { MODEL_OUTPUT_LIMIT_DESCRIPTION } from "./output";

export const WEB_FETCH_MD_TOOL_NAME = "web_fetch_md";
export const WEB_DOCS_SEARCH_TOOL_NAME = "web_docs_search";
export const WEB_DOCS_FETCH_TOOL_NAME = "web_docs_fetch";

export const WEB_TOOL_NAMES = [
	WEB_FETCH_MD_TOOL_NAME,
	WEB_DOCS_SEARCH_TOOL_NAME,
	WEB_DOCS_FETCH_TOOL_NAME,
] as const;
export type WebToolName = (typeof WEB_TOOL_NAMES)[number];

export const WEB_FETCH_INLINE_MAX_CHARS = 15_000;
export const WEB_FETCH_OUTPUT_MODES = ["auto", "inline", "file"] as const;
export type WebFetchOutputMode = (typeof WEB_FETCH_OUTPUT_MODES)[number];

/** Helper local equivalente al StringEnum del referencia (Union de Literals).
 *  Sin anotar el retorno para preservar el tipo del union (Static<...> = "a" | "b" | ...). */
function stringEnum<T extends string>(values: readonly T[]) {
	return Type.Union(values.map((v) => Type.Literal(v)));
}

const OutputModeSchema = Type.Optional(stringEnum(WEB_FETCH_OUTPUT_MODES));

const WebFetchMdParameters = Type.Object(
	{
		url: Type.String({ description: "Public http(s) URL" }),
		output_mode: OutputModeSchema,
		abs_links: Type.Optional(
			Type.Boolean({ description: "Absolute links/images", default: true }),
		),
		timeout_ms: Type.Optional(
			Type.Number({ description: "Fetch timeout (ms)", default: 30_000 }),
		),
	},
	{ additionalProperties: false },
);

const WebDocsSearchParameters = Type.Object(
	{
		library_name: Type.String({
			description: "Library name (e.g. react, next.js, fastapi)",
		}),
		query: Type.String({
			description: "Task/question for relevance ranking",
		}),
	},
	{ additionalProperties: false },
);

const WebDocsFetchParameters = Type.Object(
	{
		library_id: Type.String({
			description:
				"Context7 ID (e.g. /facebook/react); search first if unknown",
		}),
		query: Type.String({ description: "Specific docs question" }),
		raw: Type.Optional(
			Type.Boolean({
				description: "Return JSON snippets instead of Markdown",
				default: false,
			}),
		),
	},
	{ additionalProperties: false },
);

export type WebFetchMdInput = Static<typeof WebFetchMdParameters>;
export type WebDocsSearchInput = Static<typeof WebDocsSearchParameters>;
export type WebDocsFetchInput = Static<typeof WebDocsFetchParameters>;

export interface WebToolSpec {
	name: WebToolName;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: readonly string[];
	parameters: TSchema;
}

export const WEB_TOOL_SPECS = [
	{
		name: WEB_FETCH_MD_TOOL_NAME,
		label: "Web Fetch",
		description: `Fetch public http(s) URL as Markdown. Not for login/private pages. output_mode auto inlines <=${WEB_FETCH_INLINE_MAX_CHARS.toLocaleString()} chars else temp; inline may truncate; file returns a temp path. Links are absolute by default. ${MODEL_OUTPUT_LIMIT_DESCRIPTION}`,
		promptSnippet: "web_fetch_md: public URL to Markdown",
		promptGuidelines: [
			"Use web_fetch_md only for public http(s); ask if login/private.",
		],
		parameters: WebFetchMdParameters,
	},
	{
		name: WEB_DOCS_SEARCH_TOOL_NAME,
		label: "Web Docs Search",
		description: `Search Context7 for library IDs; returns compact Markdown. ${MODEL_OUTPUT_LIMIT_DESCRIPTION}`,
		promptSnippet: "web_docs_search: Context7 library IDs",
		promptGuidelines: [
			"Use web_docs_search before web_docs_fetch if ID unknown.",
		],
		parameters: WebDocsSearchParameters,
	},
	{
		name: WEB_DOCS_FETCH_TOOL_NAME,
		label: "Web Docs Fetch",
		description: `Fetch focused Context7 docs for a known Context7 library_id. Markdown by default; raw=true returns JSON snippets. Search first if unknown. ${MODEL_OUTPUT_LIMIT_DESCRIPTION}`,
		promptSnippet: "web_docs_fetch: focused Context7 docs",
		promptGuidelines: [
			"Use web_docs_fetch with a known library_id and narrow query; raw only for JSON.",
		],
		parameters: WebDocsFetchParameters,
	},
] as const satisfies readonly WebToolSpec[];

export function getWebToolSpec(name: WebToolName): WebToolSpec {
	const spec = WEB_TOOL_SPECS.find((candidate) => candidate.name === name);
	if (!spec) throw new Error(`Unknown web tool: ${name}`);
	return spec;
}
