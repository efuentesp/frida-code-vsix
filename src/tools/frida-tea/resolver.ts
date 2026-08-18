// frida-tea — resolver 3-capas (issue #41, ADR-0053 D3).
//
// Reusa el núcleo createLayeredStageResolver de frida-aidd (#38) — TEA es el
// 3er consumidor del customize-layer, no una reimplementación. Capas:
// defaults (skills.ts) → equipo (.frida/tea/stages.json) → usuario
// (~/.frida/tea/stages.json). Un override es el prompt completo del stage.

import { join } from "node:path";
import { homedir } from "node:os";
import {
	createLayeredStageResolver,
	type ResolvedLayeredStage,
} from "../frida-aidd/resolver";
import { DEFAULT_STAGE_PROMPTS, TEA_STAGES, type TeaStage } from "./skills";

/** Archivo de overrides del equipo, relativo a la raíz del proyecto. */
export const TEAM_OVERRIDES_PATH = ".frida/tea/stages.json";

/** Archivo de overrides del usuario, bajo el home de Frida. */
export function userOverridesPath(): string {
	return join(homedir(), ".frida", "tea", "stages.json");
}

export type ResolvedTeaStage = ResolvedLayeredStage<TeaStage>;

const resolveTeaStages = createLayeredStageResolver<TeaStage>({
	stages: TEA_STAGES,
	defaults: DEFAULT_STAGE_PROMPTS,
	teamPath: TEAM_OVERRIDES_PATH,
	userPath: userOverridesPath,
});

/**
 * Resuelve los prompts efectivos de todos los stages TEA. JSON inválido en
 * una capa aborta ruidosamente (mismo contrato que frida-aidd).
 */
export function resolveStagePrompts(projectRoot: string): ResolvedTeaStage[] {
	return resolveTeaStages(projectRoot);
}
