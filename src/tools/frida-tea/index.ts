// frida-tea — extensión (issue #41, ADR-0053 Lote 1: núcleo de 4 workflows).
//
// Naturaleza: skill pack + 4 patrones de workflow que COMPONEN al motor
// existente (frida-extensible-workflows), igual que frida-aidd (#38). No
// registra tools propios ni toca el ciclo de vida de la sesión: su única
// superficie son los patrones tea-* registrados en runtime
// (registerBuiltinPattern) y los prompts bundled en skills.ts.
//
// Lote 1 (ADR-0053): tea-test-design, tea-framework, tea-automate,
// tea-test-review. Lote 2 pendiente: tea-ci, tea-nfr, tea-trace, tea-atdd,
// tea-teach + required_tools/execution_hints (extensión menor D8).
//
// Uso:  workflow({ name: "tea-test-design", args: { subject: "..." } })
// El resolver 3-capas (reusado de #38, D3) resuelve los prompts en
// launch-time: defaults → .frida/tea/stages.json → ~/.frida/tea/stages.json.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerBuiltinPattern,
	type BuiltinPattern,
} from "../frida-extensible-workflows/builtin-patterns";
import { resolveStagePrompts } from "./resolver";
import { DEFAULT_ARTIFACT_LANGUAGE } from "./skills";
import {
	generateTeaAutomateWorkflow,
	generateTeaFrameworkWorkflow,
	generateTeaTestDesignWorkflow,
	generateTeaTestReviewWorkflow,
	validateTeaAutomateArgs,
	validateTeaFrameworkArgs,
	validateTeaTestDesignArgs,
	validateTeaTestReviewArgs,
} from "./workflow";

/**
 * Patrón tea-test-design. El cwd se resuelve en launch-time desde el ctx que
 * el motor inyecta en resolve() (los overrides de equipo son por repo).
 */
export const TEA_TEST_DESIGN_PATTERN: BuiltinPattern = {
	name: "tea-test-design",
	description:
		"TEA (BMAD adapted): risk-grounded test plan — risk register P0-P3, strategy per risk level, test-level assignment (favor the lowest level that proves it), explicit not-in-scope with mitigation, entry/exit criteria, traceability. Ends with a PASS/CONCERNS/FAIL/WAIVED release gate over the plan.",
	args: '{ subject: string, language?: string, review?: "manual"|"auto" } — subject (el epic/sistema) es obligatorio',
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaTestDesignArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateTeaTestDesignWorkflow(stages, {
			subject: validated.subject,
			language: validated.language ?? DEFAULT_ARTIFACT_LANGUAGE,
		});
	},
};

/** Patrón tea-framework — setup auto-verificado del framework de pruebas. */
export const TEA_FRAMEWORK_PATTERN: BuiltinPattern = {
	name: "tea-framework",
	description:
		"TEA (BMAD adapted): initialize the test framework for this repo's real stack. Survey agent reads package.json/go.mod/... and picks (or honors preference), setup agent writes config + structure + a runnable EXAMPLE test it verifies by running it, then a gate audits the claims.",
	args: '{ preference?: string (slug o "auto", default "auto"), typescript?: boolean (default true), review?: "manual"|"auto" }',
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaFrameworkArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateTeaFrameworkWorkflow(stages, {
			preference: validated.preference ?? "auto",
			typescript: validated.typescript ?? true,
		});
	},
};

/** Patrón tea-automate — fan-out de automatización por target del plan. */
export const TEA_AUTOMATE_PATTERN: BuiltinPattern = {
	name: "tea-automate",
	description:
		"TEA (BMAD adapted): expand test automation — deterministic bootstrap extracts targets from a test-design plan (sorted by risk P0→P3, capped), fan-out runs one disposable agent per target that writes the test at the assigned level AND runs it (green|blocked), then a gate audits files vs claims.",
	args: '{ plan?: string (ruta del plan, default docs/tea/test-design.md), targets?: string ("T1,T3" filtro opcional), maxTargets?: number (1-8, default 5), review?: "manual"|"auto" }',
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaAutomateArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateTeaAutomateWorkflow(stages, {
			plan: validated.plan ?? "docs/tea/test-design.md",
			targets: validated.targets ?? "",
			maxTargets: validated.maxTargets ?? 5,
		});
	},
};

/** Patrón tea-test-review — auditoría de calidad de la suite (detached). */
export const TEA_TEST_REVIEW_PATTERN: BuiltinPattern = {
	name: "tea-test-review",
	description:
		"TEA (BMAD adapted): audit test quality with a fixed-severity criteria registry (flaky patterns, missing/tautological assertions, shared state, teardown; applicability-gated locators/API/error cases; convention criteria vs repo baseline). Fan-out per file + deterministic aggregate (0-100 score, unscorable manifest) + report. Coverage assessment is out of scope (that's trace).",
	args: '{ scope: string (directorio o glob de tests), review?: "manual"|"auto" } — scope es obligatorio',
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaTestReviewArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateTeaTestReviewWorkflow(stages, {
			scope: validated.scope,
		});
	},
};

/** Factory de la extensión frida-tea. */
export function createFridaTea() {
	return (_pi: ExtensionAPI): void => {
		// Registro en runtime (#41): el motor (frida-extensible-workflows)
		// consume REGISTERED_PATTERNS vía findBuiltinPattern/builtinPatternsCatalog.
		// Idempotente por nombre; el cwd se resuelve lazy en resolve().
		registerBuiltinPattern(TEA_TEST_DESIGN_PATTERN);
		registerBuiltinPattern(TEA_FRAMEWORK_PATTERN);
		registerBuiltinPattern(TEA_AUTOMATE_PATTERN);
		registerBuiltinPattern(TEA_TEST_REVIEW_PATTERN);
	};
}
