/**
 * #122 — frida-ollama-cloud: núcleo PURO (sin red, sin vscode) para el
 * proveedor Ollama Cloud (ollama.com/v1).
 *
 * Diseño derivado del plugin de referencia fgrehm/pi-ollama-cloud (MIT):
 * descubrimiento GET /v1/models (público) + POST /api/show por modelo para
 * capacidades; solo modelos con capability "tools" sirven para tool-calling.
 *
 * El shape de /api/show fue verificado contra un daemon local real
 * (capabilities[], model_info con claves "<arch>.context_length") — el
 * endpoint de cloud comparte formato con el daemon.
 */

export const OLLAMA_CLOUD_PROVIDER = "ollama-cloud";
export const OLLAMA_CLOUD_DISPLAY = "Ollama Cloud";
export const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";
/** Timeout por request de descubrimiento (como el plugin: 10s). */
export const OLLAMA_CLOUD_FETCH_TIMEOUT_MS = 10_000;
/** maxTokens fijo que asigna el plugin de referencia. */
export const OLLAMA_CLOUD_MAX_TOKENS = 32_768;
export const OLLAMA_CLOUD_DEFAULT_CONTEXT = 128_000;

/** Respuesta de GET https://ollama.com/v1/models (formato OpenAI). */
export interface OllamaModelsListResponse {
	data?: Array<{ id?: string }>;
}

/** Campos de POST /api/show que usamos (shape verificado contra daemon). */
export interface OllamaShowResponse {
	capabilities?: string[];
	model_info?: Record<string, unknown>;
}

/** Modelo pi resultante (subset que registerProvider acepta). */
export interface OllamaCloudModelDef {
	id: string;
	name?: string;
	reasoning: boolean;
	input: ["text"] | ["text", "image"];
	contextWindow: number;
	maxTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	thinkingLevelMap?: Record<string, string | null>;
}

/* ──────────────────────────────────────────────────────────────────────────
 * thinkingLevelMap — port de las 5 tablas del plugin (derivadas de pruebas
 * reales contra la API; ver docs/think-experiment.md del repo de referencia).
 * Niveles pi: off, minimal, low, medium, high, xhigh, max.
 *──────────────────────────────────────────────────────────────────────────*/

const LEVELS = ["off", "low", "medium", "high", "xhigh"] as const;

function map(
	levels: readonly (typeof LEVELS)[number][],
): Record<string, string | null> {
	const out: Record<string, string | null> = {
		off: null,
		minimal: null,
		low: null,
		medium: null,
		high: null,
		xhigh: null,
		max: null,
	};
	for (const l of levels) out[l] = l;
	return out;
}

/** Tablas por familia (id-match por prefijo). */
const THINKING_MAPS: Array<{
	test: RegExp;
	levels: readonly (typeof LEVELS)[number][];
}> = [
	// GPT_OSS: no se puede apagar el thinking; sin xhigh.
	{ test: /^gpt-oss/, levels: ["low", "medium", "high"] },
	// QWEN3 (excepto vl): binario — off y medium nada más.
	{ test: /^qwen3(?!-vl)/, levels: ["off", "medium"] },
	// GLM 5.2: off, high, xhigh.
	{ test: /^glm-5\.2/, levels: ["off", "high", "xhigh"] },
	// NO_OFF: "none" no apaga el thinking en estos.
	{
		test: /^(qwen3-vl|kimi-k2-thinking|minimax)/,
		levels: ["low", "medium", "high", "xhigh"],
	},
];

/** Niveles por defecto para modelos thinking (minimal duplica a low → oculto). */
const DEFAULT_LEVELS: readonly (typeof LEVELS)[number][] = [
	"off",
	"low",
	"medium",
	"high",
	"xhigh",
];

/** thinkingLevelMap para un id de modelo (tabla DEFAULT si ninguna aplica). */
export function thinkingLevelMapFor(id: string): Record<string, string | null> {
	const entry = THINKING_MAPS.find((e) => e.test.test(id));
	return map(entry ? entry.levels : DEFAULT_LEVELS);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Parser /api/show → modelo pi
 *──────────────────────────────────────────────────────────────────────────*/

/** Extrae context_length de model_info (<arch>.context_length). */
export function contextLengthFrom(
	modelInfo: Record<string, unknown> | undefined,
): number | undefined {
	if (!modelInfo) return undefined;
	for (const [k, v] of Object.entries(modelInfo)) {
		if (k.endsWith(".context_length") && typeof v === "number" && v > 0) {
			return v;
		}
	}
	return undefined;
}

/** Convierte un /api/show en def de modelo pi. null si no soporta tools. */
export function parseShowResponse(
	id: string,
	show: OllamaShowResponse,
): OllamaCloudModelDef | null {
	const caps = show.capabilities ?? [];
	// Solo modelos con capability "tools": pi es un agente tool-calling.
	if (!caps.includes("tools")) return null;

	const reasoning = caps.includes("thinking");
	const input: ["text"] | ["text", "image"] = caps.includes("vision")
		? ["text", "image"]
		: ["text"];

	const def: OllamaCloudModelDef = {
		id,
		name: id,
		reasoning,
		input,
		contextWindow:
			contextLengthFrom(show.model_info) ?? OLLAMA_CLOUD_DEFAULT_CONTEXT,
		maxTokens: OLLAMA_CLOUD_MAX_TOKENS,
		// Suscripción (Free/Pro/Max): equivalentes pay-as-you-go estimados;
		// sin mapping → cero (como el plugin: models.dev en releases).
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	if (reasoning) def.thinkingLevelMap = thinkingLevelMapFor(id);
	return def;
}

/** Filtra ids de la lista /v1/models (dedup, no vacíos). */
export function modelIdsFromList(list: OllamaModelsListResponse): string[] {
	const ids = (list.data ?? [])
		.map((m) => (typeof m?.id === "string" ? m.id.trim() : ""))
		.filter(Boolean);
	return [...new Set(ids)];
}
