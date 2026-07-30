/**
 * frida-agent-browser — web_search companion tool: schema (Fase 5).
 *
 * Porte de web-search.js#createAgentBrowserWebSearchParamsSchema del referencia.
 * Permite al agente buscar la web viva (Exa/Brave) cuando hay credencial configurada
 * — evita chocar con anti-bot/CAPTCHA de los buscadores públicos.
 */

import { Type, type TSchema } from "typebox";
import {
	DEFAULT_WEB_SEARCH_PROVIDER,
	WEB_SEARCH_PROVIDERS,
} from "../config/policy";

/** Exa search types (deep/deep-reasoning son más lentos). */
export const EXA_SEARCH_TYPES = [
	"auto",
	"fast",
	"instant",
	"deep-lite",
	"deep",
	"deep-reasoning",
] as const;

function stringEnum<T extends string>(values: readonly T[]): TSchema {
	return Type.Union(values.map((v) => Type.Literal(v)));
}

/** Parámetros del tool agent_browser_web_search. */
export const AGENT_BROWSER_WEB_SEARCH_PARAMS = Type.Object(
	{
		query: Type.String({
			minLength: 1,
			description:
				"Search query to run with the configured Exa or Brave web search provider.",
		}),
		provider: Type.Optional(stringEnum(["auto", ...WEB_SEARCH_PROVIDERS])),
		searchType: Type.Optional(stringEnum(EXA_SEARCH_TYPES)),
		count: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: 10,
				description: "Number of web results to return. Defaults to 5; max 10.",
			}),
		),
		offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 9 })),
		country: Type.Optional(
			Type.String({
				pattern: "^[A-Za-z]{2}$",
				description: "Optional 2-letter country code, such as US or GB.",
			}),
		),
		searchLang: Type.Optional(
			Type.String({
				minLength: 2,
				maxLength: 8,
				description:
					"Optional Brave search language code, such as en or en-US.",
			}),
		),
		safesearch: Type.Optional(stringEnum(["off", "moderate", "strict"])),
		freshness: Type.Optional(stringEnum(["pd", "pw", "pm", "py"])),
	},
	{ additionalProperties: false },
);

export interface WebSearchParams {
	query: string;
	provider?: "auto" | "exa" | "brave";
	searchType?: string;
	count?: number;
	offset?: number;
	country?: string;
	searchLang?: string;
	safesearch?: "off" | "moderate" | "strict";
	freshness?: "pd" | "pw" | "pm" | "py";
}

export { DEFAULT_WEB_SEARCH_PROVIDER };
