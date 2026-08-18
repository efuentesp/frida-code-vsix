// frida-aidd — extensión (issue #38, ADR-0050 pieza 8, Lote 1: fase plan).
//
// Naturaleza: skill pack + patrón de workflow que COMPONE al motor existente
// (frida-extensible-workflows). No registra tools propios ni toca el ciclo de
// vida de la sesión: su única superficie es el patrón `aidd-plan` registrado en
// runtime (registerBuiltinPattern) y los recursos bundled del skill pack.
//
// Uso:  workflow({ name: "aidd-plan", args: { idea: "..." } })
// El patrón corre la cadena brief → prd → architecture → epics-and-stories
// con checkpoints y un fan-out de specs (una por historia). Artefactos en
// docs/aidd/planning/.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerBuiltinPattern,
	type BuiltinPattern,
} from "../frida-extensible-workflows/builtin-patterns";
import { resolveStagePrompts } from "./resolver";
import {
	AIDD_PLANNING_DIR,
	DEFAULT_ARTIFACT_LANGUAGE,
} from "./skills";
import { generateAiddPlanWorkflow, type AiddPlanArgs } from "./workflow";

/** Valida los args del patrón aidd-plan (eager, antes de lanzar). */
export function validateAiddPlanArgs(args: unknown): AiddPlanArgs {
	const record =
		args && typeof args === "object" && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: {};
	if (typeof record.idea !== "string" || !record.idea.trim()) {
		throw new Error(
			'Patrón "aidd-plan" requiere args.idea como string no vacío (la idea del producto).',
		);
	}
	if (
		record.review !== undefined &&
		record.review !== "manual" &&
		record.review !== "auto"
	) {
		throw new Error(
			'Patrón "aidd-plan": args.review debe ser "manual" o "auto".',
		);
	}
	return {
		idea: record.idea,
		...(typeof record.project === "string" && record.project.trim()
			? { project: record.project }
			: {}),
		...(typeof record.language === "string" && record.language.trim()
			? { language: record.language }
			: {}),
		...(record.review ? { review: record.review as "manual" | "auto" } : {}),
	};
}

/**
 * Patrón aidd-plan. El cwd se resuelve en launch-time desde el ctx que el
 * motor inyecta en resolve() (los overrides de equipo son por repo).
 */
export const AIDD_PLAN_PATTERN: BuiltinPattern = {
	name: "aidd-plan",
	description:
		"AiDD planning phase (BMAD adapted): runs brief → PRD → architecture → epics-and-stories as disposable agents that write markdown artifacts, then fans out one spec per story. Checkpoints between stages.",
	args:
		'{ idea: string, project?: string, language?: string, review?: "manual"|"auto" } — idea es obligatoria; review=auto omite los checkpoints',
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateAiddPlanArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateAiddPlanWorkflow(stages, {
			idea: validated.idea,
			project: validated.project ?? "project",
			language: validated.language ?? DEFAULT_ARTIFACT_LANGUAGE,
			planningDir: AIDD_PLANNING_DIR,
		});
	},
};

/** Factory de la extensión frida-aidd. */
export function createFridaAidd() {
	return (_pi: ExtensionAPI): void => {
		// Registro en runtime (#38): el motor (frida-extensible-workflows)
		// consume REGISTERED_PATTERNS vía findBuiltinPattern/builtinPatternsCatalog.
		// Idempotente por nombre; el cwd se resuelve lazy en resolve().
		registerBuiltinPattern(AIDD_PLAN_PATTERN);
	};
}
