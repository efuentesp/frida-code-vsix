// frida-app-walkthrough — resolver 3-capas (issue #133).
//
// Reusa el núcleo createLayeredStageResolver de frida-aidd (#38) — este pack
// es el tercer consumidor del customize-layer (aidd, tea, walkthrough), no
// una reimplementación. Capas: defaults (skills.ts) → equipo
// (.frida/app-walkthrough/stages.json) → usuario
// (~/.frida/app-walkthrough/stages.json). Un override es el prompt completo
// del stage; los invariantes de seguridad viven en WALKTHROUGH_PREAMBLE
// (no-stage) y sobreviven a cualquier override.

import { join } from "node:path";
import { homedir } from "node:os";
import {
	createLayeredStageResolver,
	type ResolvedLayeredStage,
} from "../frida-aidd/resolver";
import {
	DEFAULT_STAGE_PROMPTS,
	WALKTHROUGH_STAGES,
	type WalkthroughStage,
} from "./skills";

/** Archivo de overrides del equipo, relativo a la raíz del proyecto. */
export const TEAM_OVERRIDES_PATH = ".frida/app-walkthrough/stages.json";

/** Archivo de overrides del usuario, bajo el home de Frida. */
export function userOverridesPath(): string {
	return join(homedir(), ".frida", "app-walkthrough", "stages.json");
}

export type ResolvedWalkthroughStage = ResolvedLayeredStage<WalkthroughStage>;

const resolveWalkthroughStages = createLayeredStageResolver<WalkthroughStage>({
	stages: WALKTHROUGH_STAGES,
	defaults: DEFAULT_STAGE_PROMPTS,
	teamPath: TEAM_OVERRIDES_PATH,
	userPath: userOverridesPath,
});

/**
 * Resuelve los prompts efectivos de los 3 stages. JSON inválido en una capa
 * aborta ruidosamente (mismo contrato que frida-aidd/frida-tea).
 */
export function resolveStagePrompts(
	projectRoot: string,
): ResolvedWalkthroughStage[] {
	return resolveWalkthroughStages(projectRoot);
}
