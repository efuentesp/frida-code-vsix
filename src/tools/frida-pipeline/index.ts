// frida-pipeline — punto de entrada público (Fases 1–2).
//
// ADR-0021 / D2-D7. Espejo de la organización de `frida-workflow/index.ts`:
// toda la API pública re-exportada desde aquí. El host (extension.ts y
// pi-session.ts) sólo importa de `frida-pipeline` (no de submódulos), igual
// que el resto de las extensiones nativas embebidas.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWorkflows } from "../frida-workflow/command";
import { registerSessionHooks } from "./session-hooks";
import { PIPELINE_WORKFLOWS } from "./workflows";

// ---------------------------------------------------------------------------
// Factory — registra la extensión de Pi con sus hooks (Fase 2).
// ---------------------------------------------------------------------------
//
// Espejo de `createFridaArgs()` / `createFridaContext()`: devuelve una función
// que Pi invoca con la instancia de ExtensionAPI. Por ahora (Fase 2) registra
// los hooks de sesión (guidance + git-context). Las Fases 4–5 añadirán aquí
// el pipeline-pointer y el agents-sync sin tocar la firma.

/**
 * Factory de la extensión frida-pipeline para el loader de Pi.
 *
 * Registra los hooks invisibles (guidance recursiva + git-context +
 * pipeline-pointer + skill-bracket + agents-sync) y los 3 workflows built-in
 * (build, vet, polish) en el registry de frida-workflow.
 */
export function createFridaPipeline() {
	return (pi: ExtensionAPI): void => {
		registerSessionHooks(pi);
		// Fase 10: registrar los 3 workflows built-in. Idempotente si Pi
		// recarga la extensión (registerWorkflows usa un Map, sobreescribe).
		registerWorkflows(PIPELINE_WORKFLOWS);
	};
}

// ---------------------------------------------------------------------------
// Re-exports públicos
// ---------------------------------------------------------------------------

// Tipos públicos
export type {
	PipelineStatus,
	PipelineCounts,
} from "./setup-command";
export type {
	PipelineSiblingsStatus,
	SiblingInfo,
	SiblingId,
} from "./siblings";
export { REQUIRED_SIBLINGS } from "./siblings";

// Funciones de status
export {
	computePipelineStatus,
	formatPipelineStatus,
	detectSiblings,
	formatSiblingsStatus,
} from "./setup-command";

// Guidance (Fase 2) — exportado para tests y verificación del gate
export {
	resolveGuidance,
	injectRootGuidance,
	resolveAndFormatNewGuidance,
	handleToolCallGuidance,
	clearInjectionState,
} from "./guidance";
export type { GuidanceFile } from "./guidance";

// Git-context (Fase 2)
export {
	getGitContext,
	takeGitContextIfChanged,
	isGitMutatingCommand,
	clearGitContextCache,
	resetInjectedMarker,
} from "./git-context";
export type { GitContext } from "./git-context";

// Session hooks (Fase 2)
export { registerSessionHooks } from "./session-hooks";

// Pipeline pointer (Fase 4)
export {
	injectPipelinePointer,
	PIPELINE_POINTER,
} from "./pipeline-pointer";

// Agents sync (Fase 5)
export {
	syncBundledAgents,
	totalSynced,
	formatSyncReport,
} from "./agents-sync";
export type { SyncResult, SyncError } from "./agents-sync";

// Skills sync (Fase 11)
export { syncBundledSkills, getBundledSkillNames } from "./skills-sync";
export type { SkillSyncResult } from "./skills-sync";
export {
	BUNDLED_AGENTS_DIR,
	getGlobalAgentsDir,
} from "./paths";

// Models config (Fase 3)
export {
	loadModelsConfig,
	invalidateModelsConfigCache,
	getModelsConfigPath,
	getSkillModelConfig,
	resolveStageModel,
	resolveMaxConcurrency,
	modelsConfigTemplate,
	THINKING_LEVEL_VALUES,
	MODEL_THINKING_LEVEL_VALUES,
	DEFAULT_MAX_CONCURRENCY,
} from "./models-config";
export type {
	ModelsConfig,
	ResolvedModelConfig,
	ThinkingLevelValue,
	ModelThinkingLevelValue,
} from "./models-config";

// Session capture + skill-bracket (Fase 3)
export {
	registerSessionCapture,
	getCapturedModel,
	getCapturedModelRegistry,
	applyEffectiveModel,
	restoreBaseline,
	applyOrSkipIfStale,
	__resetSessionCaptureState,
} from "./session-capture";
export type { CapturedModel, BaselineSnapshot } from "./session-capture";
export {
	registerSkillBracket,
	parseSkillInvocation,
	__resetSkillBracketState,
} from "./skill-bracket";

// Constantes (Fase 2)
export {
	FLAG_DEBUG,
	MSG_TYPE_GUIDANCE,
	MSG_TYPE_GIT_CONTEXT,
	MSG_TYPE_PIPELINE_INDEX,
	FRIDA_DIR,
} from "./constants";

// Workflows built-in (Fase 10)
export {
	buildWorkflow,
	vetWorkflow,
	polishWorkflow,
	PIPELINE_WORKFLOWS,
} from "./workflows";
