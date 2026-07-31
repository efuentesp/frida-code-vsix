// frida-pipeline — config de modelos (~/.frida/models.json).
//
// Porte de `rpiv-core/models-config.ts` (ADR-0021 Fase 3). Schema TypeBox +
// loader + cascade para overrides de modelo/thinking por skill, stage, agente
// y preset. Self-contained: no depende de `@juicesharp/rpiv-config` — usa
// `typebox` (ya dependencia) + `node:fs`.
//
// Fail-soft: JSON ausente o malformado → config vacía (sin overrides).
// Strings de modelo desconocidos pasan directo al modelRegistry.find del host
// (que rechaza lo que no reconoce).
//
// Cache de sesión: la primera llamada carga + valida + cachea. Se invalida
// con `invalidateModelsConfigCache()` (lo llama `/frida-models` tras editar).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

// ---------------------------------------------------------------------------
// Niveles de thinking.
//
// El host (pi-agent-core ThinkingLevel) Y el frontmatter de skills aceptan
// "off" como valor first-class (significa "sin razonamiento", incluso es el
// default de sesión). models.json persiste los 6 valores. Distinción clave
// vs AUSENCIA: un campo `thinking` ausente significa "heredar el nivel de
// sesión/baseline"; un "off" explícito significa "desactivar razonamiento".
// ---------------------------------------------------------------------------

/** Los 5 niveles graduados de razonamiento (excluye "off"). */
export const THINKING_LEVEL_VALUES = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;
export type ThinkingLevelValue = (typeof THINKING_LEVEL_VALUES)[number];

/** Los 6 valores persistibles, incluyendo "off" explícito. */
export const MODEL_THINKING_LEVEL_VALUES = [
	"off",
	...THINKING_LEVEL_VALUES,
] as const;
export type ModelThinkingLevelValue =
	(typeof MODEL_THINKING_LEVEL_VALUES)[number];

/** Cap de concurrencia de lanes en background (fallback fail-soft). */
export const DEFAULT_MAX_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// Schemas TypeBox
// ---------------------------------------------------------------------------

const ThinkingLevelSchema = Type.Union(
	[
		Type.Literal("off"),
		Type.Literal("minimal"),
		Type.Literal("low"),
		Type.Literal("medium"),
		Type.Literal("high"),
		Type.Literal("xhigh"),
	] as const,
	{
		description:
			"Nivel de thinking: off | minimal | low | medium | high | xhigh",
	},
);

/**
 * Entrada de modelo: string shorthand ("provider/modelId") u objeto con
 * thinking opcional. La barra es canónica; la forma con dos puntos
 * ("provider:modelId") se acepta en lectura por back-compat.
 */
const ModelEntrySchema = Type.Union(
	[
		Type.String({
			description:
				'Shorthand de modelo: "provider/modelId" (forma con dos puntos aceptada)',
		}),
		Type.Object(
			{
				model: Type.Optional(
					Type.String({
						description:
							'Modelo en formato "provider/modelId" (dos puntos aceptado)',
					}),
				),
				thinking: Type.Optional(ThinkingLevelSchema),
			},
			{ additionalProperties: false },
		),
	],
	{
		description:
			"Config de modelo: string shorthand o objeto { model?, thinking? }",
	},
);

/** Bloque por preset: sólo stages. */
const PresetSchema = Type.Object(
	{
		stages: Type.Optional(Type.Record(Type.String(), ModelEntrySchema)),
	},
	{ additionalProperties: false },
);

/**
 * Schema top-level de models.json.
 *
 * `defaults` cae en cascada hacia agents, stages, skills y entradas de
 * preset-stage. `skills` coincide con el nombre post-alias de la skill
 * (el que parsea el skill-bracket al invocar `/skill:<name>`).
 */
const ModelsConfigSchema = Type.Object(
	{
		defaults: Type.Optional(ModelEntrySchema),
		agents: Type.Optional(Type.Record(Type.String(), ModelEntrySchema)),
		stages: Type.Optional(Type.Record(Type.String(), ModelEntrySchema)),
		skills: Type.Optional(Type.Record(Type.String(), ModelEntrySchema)),
		presets: Type.Optional(Type.Record(Type.String(), PresetSchema)),
		maxConcurrency: Type.Optional(
			Type.Integer({
				minimum: 1,
				description: "Cap de concurrencia de lanes en background (default 4)",
			}),
		),
	},
	{ additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Entrada de config de modelo ya resuelta (post-schema + cascade). */
export interface ResolvedModelConfig {
	model?: string;
	/** Nivel explícito incluyendo "off". Ausente ⇒ heredar sesión/baseline. */
	thinking?: ModelThinkingLevelValue;
}

/** Forma resuelta que devuelve loadModelsConfig. */
export interface ModelsConfig {
	defaults?: ResolvedModelConfig;
	agents?: Record<string, ResolvedModelConfig>;
	stages?: Record<string, ResolvedModelConfig>;
	skills?: Record<string, ResolvedModelConfig>;
	presets?: Record<string, { stages?: Record<string, ResolvedModelConfig> }>;
	maxConcurrency?: number;
}

// ---------------------------------------------------------------------------
// Path del config
// ---------------------------------------------------------------------------

/**
 * Path del config de modelos: `~/.frida/models.json` (ADR-0010 agentDir).
 * Respetado por `/frida-models` para abrir/editar el archivo.
 */
export function getModelsConfigPath(): string {
	return join(homedir(), ".frida", "models.json");
}

// ---------------------------------------------------------------------------
// Helpers — resolver ModelEntry (string u objeto) a ResolvedModelConfig
// ---------------------------------------------------------------------------

/** Resuelve un valor ModelEntry crudo a ResolvedModelConfig. */
function resolveModelEntry(entry: unknown): ResolvedModelConfig {
	if (typeof entry === "string") {
		return { model: entry };
	}
	if (typeof entry === "object" && entry !== null) {
		const obj = entry as Record<string, unknown>;
		const result: ResolvedModelConfig = {};
		if (typeof obj.model === "string") {
			result.model = obj.model;
		}
		if (typeof obj.thinking === "string") {
			if (
				(MODEL_THINKING_LEVEL_VALUES as readonly string[]).includes(
					obj.thinking,
				)
			) {
				result.thinking = obj.thinking as ModelThinkingLevelValue;
			} else {
				console.warn(
					`[frida-pipeline] models.json: nivel de thinking desconocido "${obj.thinking}" — valores válidos: ${MODEL_THINKING_LEVEL_VALUES.join(", ")}`,
				);
			}
		}
		return result;
	}
	return {};
}

/** Resolver una sola entrada (sin cascade). */
function resolvedEntry(entry: unknown): ResolvedModelConfig | undefined {
	if (entry === undefined || entry === null) return undefined;
	const resolved = resolveModelEntry(entry);
	if (Object.keys(resolved).length === 0) return undefined;
	return resolved;
}

/** Resolver con cascade: los campos del objeto pisan a defaults. */
function resolvedEntryWithCascade(
	entry: unknown,
	defaults?: ResolvedModelConfig,
): ResolvedModelConfig {
	const resolved = resolveModelEntry(entry);
	return {
		...defaults,
		...resolved,
	};
}

// ---------------------------------------------------------------------------
// Carga del config — fail-soft, validar, cascade defaults
// ---------------------------------------------------------------------------

/** Cache de sesión — se puebla en la primera llamada, se limpia con invalidate. */
let modelsConfigCache: ModelsConfig | undefined;

/**
 * Carga, valida y resuelve models.json. Devuelve config vacía ante cualquier
 * fallo (archivo ausente, JSON inválido, schema inválido).
 */
export function loadModelsConfig(): ModelsConfig {
	if (modelsConfigCache !== undefined) return modelsConfigCache;

	const configPath = getModelsConfigPath();
	let raw: unknown = {};

	if (existsSync(configPath)) {
		try {
			const text = readFileSync(configPath, "utf-8");
			raw = JSON.parse(text);
		} catch {
			console.warn(
				`[frida-pipeline] models.json inválido en ${configPath} — usando config vacía`,
			);
			raw = {};
		}
	}

	// Value.Clean quita propiedades desconocidas (additionalProperties: false).
	// Value.Errors recolectaría errores de validación; Clean es más resiliente.
	const cleaned = Value.Clean(ModelsConfigSchema, raw);
	const validated = cleaned as Static<typeof ModelsConfigSchema>;

	const defaults = resolvedEntry(validated.defaults);
	const agents: Record<string, ResolvedModelConfig> = {};
	const stages: Record<string, ResolvedModelConfig> = {};
	const skills: Record<string, ResolvedModelConfig> = {};
	const presets: Record<
		string,
		{ stages?: Record<string, ResolvedModelConfig> }
	> = {};

	if (validated.agents && typeof validated.agents === "object") {
		for (const [name, entry] of Object.entries(validated.agents)) {
			agents[name] = resolvedEntryWithCascade(entry, defaults);
		}
	}

	if (validated.stages && typeof validated.stages === "object") {
		for (const [name, entry] of Object.entries(validated.stages)) {
			stages[name] = resolvedEntryWithCascade(entry, defaults);
		}
	}

	if (validated.skills && typeof validated.skills === "object") {
		for (const [name, entry] of Object.entries(validated.skills)) {
			skills[name] = resolvedEntryWithCascade(entry, defaults);
		}
	}

	if (validated.presets && typeof validated.presets === "object") {
		for (const [wf, presetBlock] of Object.entries(validated.presets)) {
			if (!presetBlock || typeof presetBlock !== "object") continue;
			const presetStages: Record<string, ResolvedModelConfig> = {};
			if (presetBlock.stages && typeof presetBlock.stages === "object") {
				for (const [stageName, entry] of Object.entries(presetBlock.stages)) {
					presetStages[stageName] = resolvedEntryWithCascade(entry, defaults);
				}
			}
			if (Object.keys(presetStages).length > 0) {
				presets[wf] = { stages: presetStages };
			}
		}
	}

	const result: ModelsConfig = {
		defaults,
		agents: Object.keys(agents).length > 0 ? agents : undefined,
		stages: Object.keys(stages).length > 0 ? stages : undefined,
		skills: Object.keys(skills).length > 0 ? skills : undefined,
		presets: Object.keys(presets).length > 0 ? presets : undefined,
		maxConcurrency: validated.maxConcurrency,
	};
	modelsConfigCache = result;
	return result;
}

/** Invalida el cache de sesión de models.json. Lo llama `/frida-models`
 *  tras editar el archivo. */
export function invalidateModelsConfigCache(): void {
	modelsConfigCache = undefined;
}

// ---------------------------------------------------------------------------
// Helpers de consulta — usados por skill-bracket y (Fase 10) workflow lifecycle
// ---------------------------------------------------------------------------

/** Lookup de override por skill, cayendo a defaults. */
export function getSkillModelConfig(
	config: ModelsConfig,
	skillName: string,
): ResolvedModelConfig | undefined {
	return config.skills?.[skillName] ?? config.defaults;
}

/**
 * Cascade lookup por stage (más específico primero):
 *   1. presets[workflow].stages[stage]
 *   2. stages[stage]
 *   3. skills[skill]
 *   4. defaults
 *
 * Fase 3: la usa el skill-bracket con `stage` y `workflow` undefined.
 * Fase 10: la usarán los workflows built-in.
 */
export function resolveStageModel(
	config: ModelsConfig,
	args: { workflow?: string; stage?: string; skill?: string },
): ResolvedModelConfig | undefined {
	const { workflow, stage, skill } = args;
	if (workflow && stage) {
		const presetStage = config.presets?.[workflow]?.stages?.[stage];
		if (presetStage) return presetStage;
	}
	if (stage) {
		const flatStage = config.stages?.[stage];
		if (flatStage) return flatStage;
	}
	if (skill) {
		const perSkill = config.skills?.[skill];
		if (perSkill) return perSkill;
	}
	return config.defaults;
}

/**
 * Resuelve el cap de concurrencia. DEFAULT_MAX_CONCURRENCY (4) cuando la clave
 * está ausente o tiene un valor inválido.
 */
export function resolveMaxConcurrency(config: ModelsConfig): number {
	const v = config.maxConcurrency;
	return v !== undefined && Number.isInteger(v) && v >= 1
		? v
		: DEFAULT_MAX_CONCURRENCY;
}

// ---------------------------------------------------------------------------
// Template para /frida-models (crear archivo nuevo)
// ---------------------------------------------------------------------------

/** Devuelve un template JSON con ejemplos comentados para que el usuario
 *  arranque. `/frida-models` lo escribe si el archivo no existe. */
export function modelsConfigTemplate(): string {
	return `{
  "defaults": { "model": "anthropic/claude-sonnet-4-20250514" },
  "skills": {
    "commit": { "model": "github-copilot/gpt-5", "thinking": "low" },
    "discover": { "thinking": "high" }
  }
}
`;
}
