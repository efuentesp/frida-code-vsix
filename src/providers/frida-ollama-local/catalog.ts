/**
 * #123 — Proveedor Ollama LOCAL: núcleo PURO (sin red, sin vscode) para
 * registrar el daemon (http://localhost:11434) como proveedor pi.
 *
 * Diseño derivado de `ollama launch pi` (oficial Ollama) + docs pi Custom
 * Models: api "openai-completions", apiKey placeholder, compat flags para
 * servers OpenAI-compat (sin developer role ni reasoning_effort).
 *
 * Shapes verificados contra el daemon real del usuario (2026-08-22):
 *   GET /api/tags  → { models: [{ name, details: { family, families, ... } }] }
 *   POST /api/show → { capabilities: ["tools", ...], model_info: { "<arch>.context_length": N } }
 *   (nomic-embed-text: capabilities ["embedding"], family "nomic-bert")
 */

import type { OllamaShowResponse } from "../frida-ollama-cloud/catalog";
import { contextLengthFrom } from "../frida-ollama-cloud/catalog";

export const OLLAMA_PROVIDER = "ollama";
export const OLLAMA_PROVIDER_DISPLAY = "Ollama (local)";
export const OLLAMA_MAX_TOKENS = 8_192;
export const OLLAMA_DEFAULT_CONTEXT = 8_192;

/** Respuesta de GET /api/tags (daemon local). */
export interface OllamaTagsResponse {
	models?: Array<{
		name?: string;
		details?: {
			family?: string;
			families?: string[];
			parameter_size?: string;
		};
	}>;
}

/** Modelo pi resultante. */
export interface OllamaLocalModelDef {
	id: string;
	name: string;
	reasoning: boolean;
	input: ["text"] | ["text", "image"];
	contextWindow: number;
	maxTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** ¿El modelo es de chat (sirve para pi) y no solo de embeddings? */
function isChatModel(m: {
	name?: string;
	details?: { family?: string; families?: string[] };
}): boolean {
	const name = (m.name ?? "").toLowerCase();
	// Modelos de embeddings/feature-extraction no sirven para chat.
	if (/^(nomic-embed|mxbai-embed|all-minilm|bge-|snowflake-arctic-embed)/.test(name))
		return false;
	const family = (m.details?.family ?? "").toLowerCase();
	if (["nomic-bert", "bert"].includes(family)) return false;
	return true;
}

/** ¿Soporta visión? (familias clip/mllama según la convención de /api/tags). */
function supportsVision(m: {
	details?: { family?: string; families?: string[] };
}): boolean {
	const fams = (m.details?.families ?? []).map((f) => f.toLowerCase());
	const fam = (m.details?.family ?? "").toLowerCase();
	return fams.includes("clip") || fams.includes("mllama") || fam === "mllama";
}

/**
 * Convierte /api/tags en defs de modelo pi para chat.
 * Filtra embeddings, deduplica, mapea visión. Contexto desde showInfo
 * (opcional: solo si ya se consultó /api/show por modelo); si no, default.
 */
export function parseTagsResponse(
	tags: OllamaTagsResponse,
	showInfo?: Record<string, OllamaShowResponse | undefined>,
): OllamaLocalModelDef[] {
	const seen = new Set<string>();
	const out: OllamaLocalModelDef[] = [];
	for (const m of tags.models ?? []) {
		const id = (m.name ?? "").trim();
		if (!id || seen.has(id)) continue;
		if (!isChatModel(m)) continue;
		seen.add(id);
		const show = showInfo?.[id];
		// Si /api/show existe y no declara "tools", el modelo no sirve para
		// tool-calling (pi es agente); solo confiamos en el dato cuando está.
		if (show && !(show.capabilities ?? []).includes("tools")) continue;
		out.push({
			id,
			name: id,
			reasoning: false,
			input: supportsVision(m) ? ["text", "image"] : ["text"],
			contextWindow:
				(show ? contextLengthFrom(show.model_info) : undefined) ??
				OLLAMA_DEFAULT_CONTEXT,
			maxTokens: OLLAMA_MAX_TOKENS,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // local: gratis
		});
	}
	return out;
}

/** Config del provider pi para registerProvider("ollama", …). */
export function buildOllamaProviderConfig(host: string, models: OllamaLocalModelDef[]) {
	// Normaliza: acepta OLLAMA_HOST con o sin esquema/puerto/path /v1.
	const withScheme = host.startsWith("http") ? host : `http://${host}`;
	const base = withScheme.replace(/\/+$/, "").replace(/\/v1$/, "");
	return {
		baseUrl: `${base}/v1`,
		api: "openai-completions" as const,
		apiKey: "ollama", // placeholder: el daemon lo ignora, pi exige algo
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
		},
		models: models.map((m) => ({
			id: m.id,
			name: m.name,
			reasoning: m.reasoning,
			input: m.input,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			cost: m.cost,
		})),
	};
}
