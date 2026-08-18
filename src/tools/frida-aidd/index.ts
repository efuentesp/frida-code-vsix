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
import {
	generateAiddShipWorkflow,
	validateAiddShipArgs,
} from "./ship";

/** Valida los args del patrón aidd-plan (eager, antes de lanzar). */
export function validateAiddPlanArgs(args: unknown): AiddPlanArgs {
	// #76: las llamadas directas con string JSON (double-encoded) antes
	// caían en el error genérico de abajo — el mensaje debía apuntar a la
	// capa real del problema. (La tool workflow ya decodifica antes de llegar
	// aquí; esto es defensa en profundidad para callers directos.)
	if (typeof args === "string") {
		throw new Error(
			'Patrón "aidd-plan": args llegó como STRING — pásalo como objeto { idea: "…" } (la tool workflow decodifica strings JSON, pero no era un JSON de objeto válido).',
		);
	}
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
			cwd: ctx?.cwd ?? process.cwd(),
		});
	},
};

/**
 * Patrón aidd-ship: loop determinista por historia (Lote 2, piezas 3-7). El
 * cwd no se necesita en resolve() — el script opera con rutas relativas al
 * cwd de la sesión (shell() corre en el cwd del workflow).
 */
export const AIDD_SHIP_PATTERN: BuiltinPattern = {
	name: "aidd-ship",
	description:
		"AiDD shipping phase (BMAD adapted): deterministic per-story loop — disposable dev agent, lie-detector (diff vs baseline commit), bounded review, deterministic verify commands, orchestrator commit. sprint-status.yaml is the single source of truth (never-regress). Deferred-work ledger + sweep at the end.",
	args: '{ sprint?: string, review?: "manual"|"auto", maxSweeps?: number (0-5, default 2) } — sin sprint-status.yaml hace bootstrap desde los artefactos de aidd-plan',
	resolve(args: unknown) {
		validateAiddShipArgs(args);
		return generateAiddShipWorkflow();
	},
};

/** Factory de la extensión frida-aidd. */
export function createFridaAidd() {
	return (_pi: ExtensionAPI): void => {
		// Registro en runtime (#38): el motor (frida-extensible-workflows)
		// consume REGISTERED_PATTERNS vía findBuiltinPattern/builtinPatternsCatalog.
		// Idempotente por nombre; el cwd se resuelve lazy en resolve().
		registerBuiltinPattern(AIDD_PLAN_PATTERN);
		registerBuiltinPattern(AIDD_SHIP_PATTERN);
	};
}
