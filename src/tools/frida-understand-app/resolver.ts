// frida-understand-app — resolver 3-capas (issue #134).
//
// Reusa el núcleo createLayeredStageResolver de frida-aidd (#38) — este pack
// es el CUARTO consumidor del customize-layer (aidd, tea, walkthrough), no
// una reimplementación. Capas: defaults (skills.ts) → equipo
// (.frida/understand-app/stages.json) → usuario
// (~/.frida/understand-app/stages.json). Un override es el prompt completo
// del stage; los invariantes de seguridad viven en UNDERSTAND_APP_PREAMBLE
// (no-stage) y sobreviven a cualquier override.

import { join } from "node:path";
import { homedir } from "node:os";
import {
	createLayeredStageResolver,
	type ResolvedLayeredStage,
} from "../frida-aidd/resolver";
import {
	DEFAULT_STAGE_PROMPTS,
	UNDERSTAND_APP_STAGES,
	type UnderstandAppStage,
} from "./skills";

/** Archivo de overrides del equipo, relativo a la raíz del proyecto. */
export const TEAM_OVERRIDES_PATH = ".frida/understand-app/stages.json";

/** Archivo de overrides del usuario, bajo el home de Frida. */
export function userOverridesPath(): string {
	return join(homedir(), ".frida", "understand-app", "stages.json");
}

export type ResolvedUnderstandAppStage =
	ResolvedLayeredStage<UnderstandAppStage>;

const resolveUnderstandAppStages =
	createLayeredStageResolver<UnderstandAppStage>({
		stages: UNDERSTAND_APP_STAGES,
		defaults: DEFAULT_STAGE_PROMPTS,
		teamPath: TEAM_OVERRIDES_PATH,
		userPath: userOverridesPath,
	});

/**
 * Resuelve los prompts efectivos de los 4 stages. JSON inválido en una capa
 * aborta ruidosamente (mismo contrato que frida-aidd/frida-tea/
 * frida-app-walkthrough).
 */
export function resolveStagePrompts(
	projectRoot: string,
): ResolvedUnderstandAppStage[] {
	return resolveUnderstandAppStages(projectRoot);
}
