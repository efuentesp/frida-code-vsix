// frida-traffic2api — resolver 3-capas (issue #135).
//
// Reusa el núcleo createLayeredStageResolver de frida-aidd (#38) — este
// pack es el quinto consumidor del customize-layer (aidd, tea, walkthrough,
// understand-app, traffic2api), no una reimplementación. Capas: defaults
// (skills.ts) → equipo (.frida/traffic2api/stages.json) → usuario
// (~/.frida/traffic2api/stages.json). Un override es el prompt completo del
// stage; los invariantes de seguridad viven en TRAFFIC2API_PREAMBLE
// (no-stage) y sobreviven a cualquier override.

import { join } from "node:path";
import { homedir } from "node:os";
import {
	createLayeredStageResolver,
	type ResolvedLayeredStage,
} from "../frida-aidd/resolver";
import {
	DEFAULT_STAGE_PROMPTS,
	TRAFFIC2API_STAGES,
	type Traffic2ApiStage,
} from "./skills";

/** Archivo de overrides del equipo, relativo a la raíz del proyecto. */
export const TEAM_OVERRIDES_PATH = ".frida/traffic2api/stages.json";

/** Archivo de overrides del usuario, bajo el home de Frida. */
export function userOverridesPath(): string {
	return join(homedir(), ".frida", "traffic2api", "stages.json");
}

export type ResolvedTraffic2ApiStage = ResolvedLayeredStage<Traffic2ApiStage>;

const resolveTraffic2ApiStages = createLayeredStageResolver<Traffic2ApiStage>({
	stages: TRAFFIC2API_STAGES,
	defaults: DEFAULT_STAGE_PROMPTS,
	teamPath: TEAM_OVERRIDES_PATH,
	userPath: userOverridesPath,
});

/**
 * Resuelve los prompts efectivos de los 4 stages. JSON inválido en una capa
 * aborta ruidosamente (mismo contrato que frida-aidd/frida-tea/
 * frida-app-walkthrough/frida-understand-app).
 */
export function resolveStagePrompts(
	projectRoot: string,
): ResolvedTraffic2ApiStage[] {
	return resolveTraffic2ApiStages(projectRoot);
}
