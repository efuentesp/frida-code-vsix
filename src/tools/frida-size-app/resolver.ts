// frida-size-app — resolver 3-capas (issue #139).
//
// Reusa el núcleo createLayeredStageResolver de frida-aidd (#38) — este
// pack es el SEXTO consumidor del customize-layer (aidd, tea, walkthrough,
// understand-app, traffic2api, size-app), no una reimplementación. Capas:
// defaults (skills.ts) → equipo (.frida/size-app/stages.json) → usuario
// (~/.frida/size-app/stages.json). Un override es el prompt completo del
// stage; el veto de solo-escritura y el juez de números viven en
// SIZE_APP_PREAMBLE (no-stage) y sobreviven a cualquier override.

import { join } from "node:path";
import { homedir } from "node:os";
import {
 createLayeredStageResolver,
 type ResolvedLayeredStage,
} from "../frida-aidd/resolver";
import {
 DEFAULT_STAGE_PROMPTS,
 SIZE_APP_STAGES,
 type SizeAppStage,
} from "./skills";

/** Archivo de overrides del equipo, relativo a la raíz del proyecto. */
export const TEAM_OVERRIDES_PATH = ".frida/size-app/stages.json";

/** Archivo de overrides del usuario, bajo el home de Frida. */
export function userOverridesPath(): string {
 return join(homedir(), ".frida", "size-app", "stages.json");
}

export type ResolvedSizeAppStage = ResolvedLayeredStage<SizeAppStage>;

const resolveSizeAppStages = createLayeredStageResolver<SizeAppStage>({
 stages: SIZE_APP_STAGES,
 defaults: DEFAULT_STAGE_PROMPTS,
 teamPath: TEAM_OVERRIDES_PATH,
 userPath: userOverridesPath,
});

/**
 * Resuelve los prompts efectivos de los 2 stages. JSON inválido en una capa
 * aborta ruidosamente (mismo contrato que frida-aidd/frida-tea/
 * frida-app-walkthrough/frida-understand-app/frida-traffic2api).
 */
export function resolveStagePrompts(
 projectRoot: string,
): ResolvedSizeAppStage[] {
 return resolveSizeAppStages(projectRoot);
}
