// frida-aidd — resolver de customización 3-capas (issue #38, ADR-0050 pieza 2).
//
// defaults (bundled en skills.ts) → equipo (repositorio del proyecto) →
// usuario (~/.frida). Cada capa puede sobre-escribir el prompt completo de un
// stage. Porte del modelo customize.toml de BMAD (MIT) simplificado a JSON:
//
//   { "stages": { "prd": "prompt completo que reemplaza al default" } }
//
// El resolver es deliberadamente mínimo: sin merge profundo de secciones ni
// variables — un override es el prompt nuevo del stage, punto. Eso mantiene la
// auditoría trivial (¿quién definió este prompt? la capa más profunda que lo
// declara) y evita reimprimir el motor de TOML del upstream.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AiddPlanStage } from "./skills";
import { AIDD_PLAN_STAGES, DEFAULT_STAGE_PROMPTS } from "./skills";

/** Archivo de overrides del equipo, relativo a la raíz del proyecto. */
export const TEAM_OVERRIDES_PATH = ".frida/aidd/stages.json";

/** Archivo de overrides del usuario, bajo el home de Frida. */
export function userOverridesPath(): string {
	return join(homedir(), ".frida", "aidd", "stages.json");
}

export interface ResolvedStage {
	stage: AiddPlanStage;
	/** Prompt efectivo tras aplicar las capas. */
	prompt: string;
	/** De dónde salió el prompt efectivo (para trazabilidad/auditoría). */
	source: "defaults" | "team" | "user";
}

/** Capa de overrides: mapa stage → prompt. Stages desconocidos se ignoran. */
export type OverridesMap = Partial<Record<AiddPlanStage, string>>;

function parseOverrides(text: string, origin: string): OverridesMap {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`${origin}: JSON inválido (${(error as Error).message}). Corrígelo o bórralo.`,
		);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${origin}: se esperaba un objeto JSON { "stages": {...} }.`);
	}
	const stages = (parsed as { stages?: unknown }).stages;
	if (stages === undefined) return {};
	if (stages === null || typeof stages !== "object" || Array.isArray(stages)) {
		throw new Error(`${origin}: "stages" debe ser un objeto.`);
	}
	const out: OverridesMap = {};
	for (const [key, value] of Object.entries(
		stages as Record<string, unknown>,
	)) {
		if (!(AIDD_PLAN_STAGES as readonly string[]).includes(key)) continue;
		if (typeof value === "string" && value.trim()) {
			out[key as AiddPlanStage] = value;
		}
	}
	return out;
}

function readLayer(path: string, origin: string): OverridesMap {
	try {
		return parseOverrides(readFileSync(path, "utf8"), origin);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error; // JSON roto u otro error de lectura: falla ruidosamente
	}
}

/**
 * Resuelve los prompts efectivos de TODOS los stages: defaults → team (repo) →
 * user (~/.frida). Un archivo de capa con JSON inválido aborta el resolve —
 * nunca se corre un prompt a medias sin saberlo.
 */
export function resolveStagePrompts(projectRoot: string): ResolvedStage[] {
	const team = existsSync(join(projectRoot, TEAM_OVERRIDES_PATH))
		? readLayer(join(projectRoot, TEAM_OVERRIDES_PATH), TEAM_OVERRIDES_PATH)
		: {};
	const userPath = userOverridesPath();
	const user = existsSync(userPath)
		? readLayer(userPath, userPath)
		: {};

	return AIDD_PLAN_STAGES.map((stage) => {
		if (user[stage] !== undefined) {
			return { stage, prompt: user[stage]!, source: "user" } as const;
		}
		if (team[stage] !== undefined) {
			return { stage, prompt: team[stage]!, source: "team" } as const;
		}
		return {
			stage,
			prompt: DEFAULT_STAGE_PROMPTS[stage],
			source: "defaults",
		} as const;
	}).map((r) => ({ ...r }));
}
