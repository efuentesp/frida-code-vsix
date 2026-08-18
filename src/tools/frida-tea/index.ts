// frida-tea — extensión (issue #41, ADR-0053).
//
// Naturaleza: skill pack + patrones de workflow que COMPONEN al motor
// existente (frida-extensible-workflows), igual que frida-aidd (#38). No
// registra tools propios ni toca el ciclo de vida de la sesión: su única
// superficie son los patrones tea-* registrados en runtime
// (registerBuiltinPattern) y los prompts bundled en skills.ts.
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
	generateTeaAtddWorkflow,
	generateTeaAutomateWorkflow,
	generateTeaCiWorkflow,
	generateTeaFrameworkWorkflow,
	generateTeaNfrWorkflow,
	generateTeaTeachWorkflow,
	generateTeaTestDesignWorkflow,
	generateTeaTestReviewWorkflow,
	generateTeaTraceWorkflow,
	STANDARD_NFR_CATEGORIES,
	TEA_ACADEMY_MODULES,
	validateTeaAtddArgs,
	validateTeaAutomateArgs,
	validateTeaCiArgs,
	validateTeaFrameworkArgs,
	validateTeaNfrArgs,
	validateTeaTeachArgs,
	validateTeaTestDesignArgs,
	validateTeaTestReviewArgs,
	validateTeaTraceArgs,
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

/** Patrón tea-ci — pipeline CI con quality gates, auto-verificado localmente. */
export const TEA_CI_PATTERN: BuiltinPattern = {
	name: "tea-ci",
	description:
		"TEA (BMAD adapted): configure the CI pipeline so tests run on every push with quality gates. Survey reads the repo (platform, real test command, framework, package manager, node version), pipeline agent writes the config AND verifies it locally by running the exact commands, then a gate audits it. No soft skips; no jobs for tools the repo doesn't have.",
	args: '{ platform?: string (slug o "auto", default "auto"), review?: "manual"|"auto" }',
	meta: { requiredTools: ["shell"], executionHints: { autonomous: true, iterative: true } },
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaCiArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateTeaCiWorkflow(stages, {
			platform: validated.platform ?? "auto",
		});
	},
};

/** Patrón tea-nfr — auditoría de evidencia no funcional con gate determinista. */
export const TEA_NFR_PATTERN: BuiltinPattern = {
	name: "tea-nfr",
	description:
		"TEA (BMAD adapted): audit non-functional evidence (performance, security, reliability, maintainability + custom) AFTER implementation exists. Fan-out per category — each detached auditor hunts citable evidence (tests, scans, metrics, logs; plans are NOT evidence) with honest NO_EVIDENCE answers. Deterministic overall gate: any FAIL → FAIL, any CONCERNS/NO_EVIDENCE → CONCERNS, else PASS. Report at docs/tea/nfr-assessment.md.",
	args: '{ subject?: string (qué auditar), categories?: string (csv, default "performance,security,reliability,maintainability"), review?: "manual"|"auto" }',
	meta: { requiredTools: ["read"], executionHints: { autonomous: true, iterative: true } },
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaNfrArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		const categories = (
			validated.categories
				? validated.categories
						.split(",")
						.map((c) => c.trim())
						.filter(Boolean)
				: [...STANDARD_NFR_CATEGORIES]
		).slice(0, 6);
		return generateTeaNfrWorkflow(stages, {
			subject: validated.subject ?? "release readiness",
			categories,
		});
	},
};

/** Patrón tea-trace — matriz de trazabilidad requisito→test con coverage gate. */
export const TEA_TRACE_PATTERN: BuiltinPattern = {
	name: "tea-trace",
	description:
		"TEA (BMAD adapted): traceability matrix requirements → tests with a deterministic coverage gate. Extracts requirements from a doc (or synthesizes them from the code — synthetic oracle), maps each to the tests that genuinely verify it, computes coverage (total, by priority, by level), and gates: any P0 uncovered → FAIL, any P1 uncovered → CONCERNS, else PASS. Matrix at docs/tea/traceability-matrix.md.",
	args: '{ requirements?: string (ruta del doc de requisitos, default docs/aidd/planning/prd.md), scope?: string (dir de tests, default "tests/"), gate?: "story"|"epic"|"release", review?: "manual"|"auto" }',
	meta: { requiredTools: ["read"], executionHints: { autonomous: true, iterative: true } },
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaTraceArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateTeaTraceWorkflow(stages, {
			requirements:
				validated.requirements ?? "docs/aidd/planning/prd.md",
			scope: validated.scope ?? "tests/",
			gate: validated.gate ?? "release",
		});
	},
};

/** Patrón tea-atdd — escenarios como contrato + fase roja (TDD red). */
export const TEA_ATDD_PATTERN: BuiltinPattern = {
	name: "tea-atdd",
	description:
		"TEA (BMAD adapted): ATDD red phase — draft Given/When/Then acceptance scenarios grounded in the real code (user approves/edits them at a checkpoint: they are the CONTRACT), then implement failing acceptance tests that encode them (status red|green|blocked) plus an implementation checklist. Never implements the feature.",
	args: '{ feature: string (la feature, requerida), level?: "auto"|"e2e"|"api"|"component"|"unit" (default "auto"), review?: "manual"|"auto" }',
	meta: { requiredTools: ["shell"], executionHints: { interactive: true, autonomous: true, iterative: true } },
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaAtddArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateTeaAtddWorkflow(stages, {
			feature: validated.feature,
			level: validated.level ?? "auto",
		});
	},
};

/** Patrón tea-teach — academia de testing (lecciones + ejercicios en el repo). */
export const TEA_TEACH_PATTERN: BuiltinPattern = {
	name: "tea-teach",
	description:
		"TEA (BMAD adapted, teach-me-testing): write a self-paced testing academy INTO this repo — one lesson per module (risk-based testing, test levels, flakiness, release gates, ATDD) with concrete examples from this codebase, anti-patterns, verifiable exercises with answers, and self-check questions. Index at docs/tea/academy/README.md.",
	args: '{ topic?: string (enfoque de la academia), modules?: string (csv de ids: risk,levels,flakiness,gates,atdd — default todos), review?: "manual"|"auto" }',
	meta: { requiredTools: ["read"], executionHints: { autonomous: true, iterative: true } },
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateTeaTeachArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		const moduleIds = (
			validated.modules
				? validated.modules
						.split(",")
						.map((m) => m.trim())
						.filter(Boolean)
				: []
		).slice(0, 5);
		return generateTeaTeachWorkflow(stages, {
			topic: validated.topic ?? "",
			moduleIds,
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
		registerBuiltinPattern(TEA_CI_PATTERN);
		registerBuiltinPattern(TEA_NFR_PATTERN);
		registerBuiltinPattern(TEA_TRACE_PATTERN);
		registerBuiltinPattern(TEA_ATDD_PATTERN);
		registerBuiltinPattern(TEA_TEACH_PATTERN);
	};
}
