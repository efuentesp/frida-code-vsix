// frida-tea — generadores de scripts de workflow (issue #41, ADR-0053 Lote 1).
//
// Cada generador produce el script JS determinista que corre en el sandbox de
// frida-extensible-workflows (agent/parallel/phase/checkpoint/log/args/shell).
// Los prompts (resueltos 3 capas) se interpolan del lado del host; el script
// queda declarativo. Contrato de artefactos: los agentes ESCRIBEN a disco con
// sus tools de archivo y devuelven resumen/JSON (outputSchema) — la cadena de
// custodia es el filesystem (mismo contrato que frida-aidd).
//
// Patrones materializados de #19 (D7 del ADR-0053):
//   tea-test-design  — cadena + extractor + gate de release.
//   tea-framework    — survey → setup que se auto-verifica → gate.
//   tea-automate     — bootstrap determinista + fan-out por target + gate.
//   tea-test-review  — discover (baseline de convenciones) + fan-out por
//                      archivo con criterios de severidad fija + agregado
//                      determinista + reporte (detached-auditor).

import type { ResolvedTeaStage } from "./resolver";
import { MURAT_PREAMBLE, TEA_ARTIFACTS_DIR, type TeaStage } from "./skills";

// ── Args ───────────────────────────────────────────────────────────────────

interface ReviewMode {
	review?: "manual" | "auto";
}

export interface TeaTestDesignArgs extends ReviewMode {
	subject: string;
	language?: string;
}

export interface TeaFrameworkArgs extends ReviewMode {
	preference?: string;
	typescript?: boolean;
}

export interface TeaAutomateArgs extends ReviewMode {
	plan?: string;
	targets?: string;
	maxTargets?: number;
}

export interface TeaTestReviewArgs extends ReviewMode {
	scope: string;
}

function asRecord(args: unknown): Record<string, unknown> {
	return args && typeof args === "object" && !Array.isArray(args)
		? (args as Record<string, unknown>)
		: {};
}

function parseReview(
	record: Record<string, unknown>,
	pattern: string,
): "manual" | "auto" {
	if (record.review === undefined) return "manual";
	if (record.review === "manual" || record.review === "auto")
		return record.review;
	throw new Error(
		`Patrón "${pattern}": args.review debe ser "manual" o "auto".`,
	);
}

function optionalString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

export function validateTeaTestDesignArgs(args: unknown): TeaTestDesignArgs {
	const record = asRecord(args);
	if (typeof record.subject !== "string" || !record.subject.trim()) {
		throw new Error(
			'Patrón "tea-test-design" requiere args.subject como string no vacío (el epic/sistema a planificar).',
		);
	}
	return {
		subject: record.subject,
		language: optionalString(record, "language"),
		review: parseReview(record, "tea-test-design"),
	};
}

export function validateTeaFrameworkArgs(args: unknown): TeaFrameworkArgs {
	const record = asRecord(args);
	return {
		preference: optionalString(record, "preference"),
		...(record.typescript === undefined
			? {}
			: typeof record.typescript === "boolean"
				? { typescript: record.typescript }
				: (() => {
						throw new Error(
							'Patrón "tea-framework": args.typescript debe ser boolean.',
						);
					})()),
		review: parseReview(record, "tea-framework"),
	};
}

export function validateTeaAutomateArgs(args: unknown): TeaAutomateArgs {
	const record = asRecord(args);
	if (
		record.maxTargets !== undefined &&
		(typeof record.maxTargets !== "number" ||
			!Number.isInteger(record.maxTargets) ||
			record.maxTargets < 1 ||
			record.maxTargets > 8)
	) {
		throw new Error(
			'Patrón "tea-automate": args.maxTargets debe ser entero 1-8.',
		);
	}
	return {
		plan: optionalString(record, "plan"),
		targets: optionalString(record, "targets"),
		maxTargets: record.maxTargets as number | undefined,
		review: parseReview(record, "tea-automate"),
	};
}

export function validateTeaTestReviewArgs(args: unknown): TeaTestReviewArgs {
	const record = asRecord(args);
	if (typeof record.scope !== "string" || !record.scope.trim()) {
		throw new Error(
			'Patrón "tea-test-review" requiere args.scope como string no vacío (directorio o glob de tests).',
		);
	}
	return { scope: record.scope, review: parseReview(record, "tea-test-review") };
}

// ── Args Lote 2 ───────────────────────────────────────────────────────────

export interface TeaCiArgs extends ReviewMode {
	platform?: string;
}

export interface TeaNfrArgs extends ReviewMode {
	subject?: string;
	categories?: string;
}

export interface TeaTraceArgs extends ReviewMode {
	requirements?: string;
	scope?: string;
	gate?: "story" | "epic" | "release";
}

export interface TeaAtddArgs extends ReviewMode {
	feature: string;
	level?: string;
}

export interface TeaTeachArgs extends ReviewMode {
	topic?: string;
	modules?: string;
}

export function validateTeaCiArgs(args: unknown): TeaCiArgs {
	const record = asRecord(args);
	return {
		platform: optionalString(record, "platform"),
		review: parseReview(record, "tea-ci"),
	};
}

export function validateTeaNfrArgs(args: unknown): TeaNfrArgs {
	const record = asRecord(args);
	return {
		subject: optionalString(record, "subject"),
		categories: optionalString(record, "categories"),
		review: parseReview(record, "tea-nfr"),
	};
}

const TRACE_GATES = ["story", "epic", "release"] as const;

export function validateTeaTraceArgs(args: unknown): TeaTraceArgs {
	const record = asRecord(args);
	if (
		record.gate !== undefined &&
		!(TRACE_GATES as readonly string[]).includes(record.gate as string)
	) {
		throw new Error(
			'Patrón "tea-trace": args.gate debe ser "story", "epic" o "release".',
		);
	}
	return {
		requirements: optionalString(record, "requirements"),
		scope: optionalString(record, "scope"),
		...(record.gate ? { gate: record.gate as TeaTraceArgs["gate"] } : {}),
		review: parseReview(record, "tea-trace"),
	};
}

const ATDD_LEVELS = ["auto", "e2e", "api", "component", "unit"] as const;

export function validateTeaAtddArgs(args: unknown): TeaAtddArgs {
	const record = asRecord(args);
	if (typeof record.feature !== "string" || !record.feature.trim()) {
		throw new Error(
			'Patrón "tea-atdd" requiere args.feature como string no vacío (la feature a trabajar en escenarios).',
		);
	}
	if (
		record.level !== undefined &&
		!(ATDD_LEVELS as readonly string[]).includes(record.level as string)
	) {
		throw new Error(
			'Patrón "tea-atdd": args.level debe ser auto, e2e, api, component o unit.',
		);
	}
	return {
		feature: record.feature,
		level: optionalString(record, "level"),
		review: parseReview(record, "tea-atdd"),
	};
}

export function validateTeaTeachArgs(args: unknown): TeaTeachArgs {
	const record = asRecord(args);
	return {
		topic: optionalString(record, "topic"),
		modules: optionalString(record, "modules"),
		review: parseReview(record, "tea-teach"),
	};
}

// ── Interpolación y bloques compartidos ────────────────────────────────────

/** Escape de backslash/backtick/${ para interpolar strings en template literal. */
function lit(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("`", "\\`")
		.replaceAll("${", "\\${");
}

/** Emite las constantes de prompt del script (MURAT + stages usados). */
function stageConsts(
	stages: ResolvedTeaStage[],
	names: Record<string, TeaStage>,
): string {
	const murat = `\tconst MURAT = \`${lit(MURAT_PREAMBLE)}\`;`;
	const lines = Object.entries(names).map(([constName, stage]) => {
		const found = stages.find((s) => s.stage === stage);
		if (!found) {
			throw new Error(
				`frida-tea: falta el stage '${stage}' en el resolver.`,
			);
		}
		return `\t// ${stage} — fuente del prompt: ${found.source}\n\tconst ${constName} = \`${lit(found.prompt)}\`;`;
	});
	return [murat, ...lines].join("\n");
}

/** Preludio común: args runtime + helper de contexto (persona + runtime). */
function scriptPrelude(pattern: string): string {
	return `// Patrón curado: ${pattern} (frida-tea #41, Lote 1 — adaptación BMAD TEA, MIT).
const review = (args && args.review) || "manual"

function teaCtx(prompt, blocks) {
	return MURAT + "\\n\\n" + prompt + "\\n\\n---\\n\\n## Runtime context\\n" + blocks.join("\\n")
}
`;
}

// ── tea-test-design ─────────────────────────────────────────────────────────

/** Genera el script del workflow `tea-test-design`. */
export function generateTeaTestDesignWorkflow(
	stages: ResolvedTeaStage[],
	args: { subject: string; language: string },
): string {
	return `${scriptPrelude("tea-test-design")}
${stageConsts(stages, { PLAN: "test-design", GATE: "gate" })}
const subject = (args && args.subject) || ${JSON.stringify(args.subject)}
const language = (args && args.language) || ${JSON.stringify(args.language)}
const TARGETS_SCHEMA = { type: "object", properties: { targets: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, risk: { type: "string" }, level: { type: "string" } }, required: ["id", "name", "risk", "level"] } } }, required: ["targets"] }
const GATE_SCHEMA = { type: "object", properties: { decision: { type: "string", enum: ["PASS", "CONCERNS", "FAIL", "WAIVED"] }, findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }, evidence: { type: "string" }, fix: { type: "string" } }, required: ["severity", "evidence", "fix"] } }, notes: { type: "string" } }, required: ["decision", "findings"] }

log("tea-test-design: plan de riesgo para: " + subject.slice(0, 80))

phase("plan")
const planSummary = await agent(
	teaCtx(PLAN, [
		"Artifacts directory: ${TEA_ARTIFACTS_DIR}",
		"Write the plan to: ${TEA_ARTIFACTS_DIR}/test-design.md",
		"Language for the artifact: " + language,
		"## Subject (verbatim)\\n" + subject,
	]),
	{ label: "test-design plan" }
)

phase("extract targets")
const extracted = await agent(
	"Read the test plan at ${TEA_ARTIFACTS_DIR}/test-design.md and return ONLY a JSON object: { \\"targets\\": [{ \\"id\\": \\"T1\\", \\"name\\": \\"...\\", \\"risk\\": \\"P0\\", \\"level\\": \\"e2e|api|component|unit\\" }] } — every automation target with its risk level and assigned test level, nothing else.",
	{ label: "extract targets", outputSchema: TARGETS_SCHEMA }
)
const targets = (extracted && extracted.targets) || []
log("tea-test-design: " + targets.length + " targets extraídos del plan")

phase("gate")
const gate = await agent(
	teaCtx(GATE, [
		"Audit the plan at ${TEA_ARTIFACTS_DIR}/test-design.md. Read it before judging.",
		"## Claims to audit\\n- Every P0 risk has a strategy with assigned depth\\n- Every exclusion carries reasoning AND mitigation\\n- Traceability risk→tests exists for all P0/P1\\n- Test levels favor the lowest level that can prove the behavior",
		"## Subject (verbatim)\\n" + subject,
	]),
	{ label: "gate", outputSchema: GATE_SCHEMA }
)
log("tea-test-design: gate=" + gate.decision + " findings=" + (gate.findings || []).length)

if (review === "manual") {
	const cp = await checkpoint({ name: "plan-gate", prompt: "Plan de pruebas listo en ${TEA_ARTIFACTS_DIR}/test-design.md (" + targets.length + " targets). Gate: " + gate.decision + " con " + (gate.findings || []).length + " findings. ¿Apruebas para terminar?", context: { artifact: "${TEA_ARTIFACTS_DIR}/test-design.md", gate: gate.decision } })
	if (cp !== "approved") throw new Error("tea-test-design: checkpoint rechazado — workflow detenido")
}

return {
	artifact: "${TEA_ARTIFACTS_DIR}/test-design.md",
	subject,
	targets,
	gate,
	planSummary,
}
`;
}

// ── tea-framework ───────────────────────────────────────────────────────────

/** Genera el script del workflow `tea-framework`. */
export function generateTeaFrameworkWorkflow(
	stages: ResolvedTeaStage[],
	args: { preference: string; typescript: boolean },
): string {
	return `${scriptPrelude("tea-framework")}
${stageConsts(stages, { SETUP: "framework", GATE: "gate" })}
const preference = (args && args.preference) || ${JSON.stringify(args.preference)}
const typescript = (args && args.typescript) || ${JSON.stringify(args.typescript)}
const SURVEY_SCHEMA = { type: "object", properties: { framework: { type: "string" }, evidence: { type: "string" }, rationale: { type: "string" } }, required: ["framework", "evidence", "rationale"] }
const SETUP_SCHEMA = { type: "object", properties: { configFiles: { type: "array", items: { type: "string" } }, examplePath: { type: "string" }, exampleStatus: { type: "string", enum: ["green", "blocked"] }, notes: { type: "string" } }, required: ["configFiles", "examplePath", "exampleStatus", "notes"] }
const GATE_SCHEMA = { type: "object", properties: { decision: { type: "string", enum: ["PASS", "CONCERNS", "FAIL", "WAIVED"] }, findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }, evidence: { type: "string" }, fix: { type: "string" } }, required: ["severity", "evidence", "fix"] } }, notes: { type: "string" } }, required: ["decision", "findings"] }

phase("survey")
const survey = await agent(
	teaCtx(
		"Survey this repository's real stack to choose the test framework. Read package.json / go.mod / pom.xml / existing configs — do not guess. Preference given by the user: " + (preference === "auto" ? "auto-detect (you choose)" : preference + " (honor it unless it cannot run here — then say why in the rationale)") + ". TypeScript preferred: " + typescript + ". Return ONLY the JSON per your output contract.",
		["Return framework as a short slug (playwright, cypress, vitest, jest, pytest, go-test, ...)."]
	),
	{ label: "survey", outputSchema: SURVEY_SCHEMA }
)
log("tea-framework: framework=" + survey.framework)

phase("setup")
const setup = await agent(
	teaCtx(SETUP, [
		"## Survey decision (honor it)\\n" + JSON.stringify(survey),
		"TypeScript preferred: " + typescript,
	]),
	{ label: "setup " + survey.framework, outputSchema: SETUP_SCHEMA }
)
log("tea-framework: example=" + setup.exampleStatus + " (" + setup.examplePath + ")")

phase("gate")
const gate = await agent(
	teaCtx(GATE, [
		"Audit the test framework setup. Read the files listed below before judging — do not trust the claims.",
		"## Claims to audit\\n" + JSON.stringify(setup, null, 2),
		"## Survey decision\\n" + JSON.stringify(survey),
	]),
	{ label: "gate", outputSchema: GATE_SCHEMA }
)
log("tea-framework: gate=" + gate.decision + " findings=" + (gate.findings || []).length)

if (review === "manual") {
	const cp = await checkpoint({ name: "framework-gate", prompt: "Framework " + survey.framework + " montado (ejemplo: " + setup.exampleStatus + "). Gate: " + gate.decision + " con " + (gate.findings || []).length + " findings. ¿Apruebas para terminar?", context: { framework: survey.framework, example: setup.examplePath, gate: gate.decision } })
	if (cp !== "approved") throw new Error("tea-framework: checkpoint rechazado — workflow detenido")
}

return { framework: survey.framework, survey, setup, gate }
`;
}

// ── tea-automate ────────────────────────────────────────────────────────────

/** Genera el script del workflow `tea-automate`. */
export function generateTeaAutomateWorkflow(
	stages: ResolvedTeaStage[],
	args: { plan: string; targets: string; maxTargets: number },
): string {
	return `${scriptPrelude("tea-automate")}
${stageConsts(stages, { AUTOMATE: "automate", GATE: "gate" })}
const planPath = (args && args.plan) || ${JSON.stringify(args.plan)}
const only = (args && args.targets) || ${JSON.stringify(args.targets)}
const maxTargets = (args && args.maxTargets) || ${JSON.stringify(args.maxTargets)}
const TARGETS_SCHEMA = { type: "object", properties: { targets: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, risk: { type: "string" }, level: { type: "string" } }, required: ["id", "name", "risk", "level"] } } }, required: ["targets"] }
const AUTOMATE_SCHEMA = { type: "object", properties: { target: { type: "string" }, file: { type: "string" }, status: { type: "string", enum: ["green", "blocked"] }, notes: { type: "string" } }, required: ["target", "file", "status", "notes"] }
const GATE_SCHEMA = { type: "object", properties: { decision: { type: "string", enum: ["PASS", "CONCERNS", "FAIL", "WAIVED"] }, findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }, evidence: { type: "string" }, fix: { type: "string" } }, required: ["severity", "evidence", "fix"] } }, notes: { type: "string" } }, required: ["decision", "findings"] }

phase("bootstrap")
const extracted = await agent(
	"Read the test plan at " + planPath + " and return ONLY a JSON object: { \\"targets\\": [{ \\"id\\": \\"T1\\", \\"name\\": \\"...\\", \\"risk\\": \\"P0\\", \\"level\\": \\"e2e|api|component|unit\\" }] } — every automation target with its risk level and assigned test level, nothing else.",
	{ label: "extract targets", outputSchema: TARGETS_SCHEMA }
)
let list = (extracted && extracted.targets) || []
if (only) {
	const want = only.split(",").map(function (s) { return s.trim() }).filter(Boolean)
	list = list.filter(function (t) { return want.indexOf(t.id) !== -1 })
}
const RANK = { P0: 0, P1: 1, P2: 2, P3: 3 }
function cmpId(a, b) { return a < b ? -1 : a > b ? 1 : 0 }
list.sort(function (x, y) {
	const rx = RANK[x.risk] !== undefined ? RANK[x.risk] : 9
	const ry = RANK[y.risk] !== undefined ? RANK[y.risk] : 9
	return rx - ry || cmpId(String(x.id), String(y.id))
})
list = list.slice(0, maxTargets)
if (!list.length) throw new Error("tea-automate: sin targets que automatizar (plan sin targets o filtro vacío)")
log("tea-automate: " + list.length + " targets ← " + planPath + " [review=" + review + "]")

phase("automate (fan-out por target)")
const tasks = {}
list.forEach(function (t) {
	tasks[t.id] = function () {
		return agent(
			teaCtx(AUTOMATE, [
				"## Target to automate\\n" + t.id + ": " + t.name + " (risk " + t.risk + ", level " + t.level + ")",
				"## Plan (READ it first)\\n" + planPath,
			]),
			{ label: "automate " + t.id, outputSchema: AUTOMATE_SCHEMA }
		)
	}
})
const results = await parallel("targets", tasks)
const green = list.filter(function (t) { return results[t.id] && results[t.id].status === "green" }).length
log("tea-automate: " + green + "/" + list.length + " targets en verde")

phase("gate")
const gate = await agent(
	teaCtx(GATE, [
		"Audit the automated tests against the plan. READ the test files before judging — verify the files exist and match their claimed level.",
		"## Plan\\n" + planPath,
		"## Targets\\n" + JSON.stringify(list, null, 2),
		"## Implementation results (claims)\\n" + JSON.stringify(results, null, 2),
	]),
	{ label: "gate", outputSchema: GATE_SCHEMA }
)
log("tea-automate: gate=" + gate.decision + " findings=" + (gate.findings || []).length)

if (review === "manual") {
	const cp = await checkpoint({ name: "automate-gate", prompt: "Automatización lista: " + green + "/" + list.length + " targets en verde. Gate: " + gate.decision + " con " + (gate.findings || []).length + " findings. ¿Apruebas para terminar?", context: { plan: planPath, targets: list.map(function (t) { return t.id }), green: green, gate: gate.decision } })
	if (cp !== "approved") throw new Error("tea-automate: checkpoint rechazado — workflow detenido")
}

return { plan: planPath, targets: list.map(function (t) { return t.id }), results, gate }
`;
}

// ── tea-test-review ─────────────────────────────────────────────────────────

/** Genera el script del workflow `tea-test-review`. */
export function generateTeaTestReviewWorkflow(
	stages: ResolvedTeaStage[],
	args: { scope: string },
): string {
	return `${scriptPrelude("tea-test-review")}
${stageConsts(stages, { REVIEWER: "test-review" })}
const scope = (args && args.scope) || ${JSON.stringify(args.scope)}
const DISCOVER_SCHEMA = { type: "object", properties: { files: { type: "array", items: { type: "string" } }, baseline: { type: "string" } }, required: ["files", "baseline"] }
const REVIEW_SCHEMA = { type: "object", properties: { file: { type: "string" }, unscorable: { type: "boolean" }, score: { type: "number" }, findings: { type: "array", items: { type: "object", properties: { criterion: { type: "string" }, severity: { type: "string" }, evidence: { type: "string" }, fix: { type: "string" } }, required: ["criterion", "severity", "evidence", "fix"] } } }, required: ["file", "findings"] }

log("tea-test-review: auditando tests bajo " + scope)

phase("discover")
const discovered = await agent(
	teaCtx(
		"Discover the test suite under the given scope and compute the repo's test convention BASELINE. List ONLY test files (not fixtures/helpers unless indistinguishable), capped at 12. The baseline states each convention (naming, priority markers, fixture usage) with its status: established (≥50% of sampled corpus, corpus ≥4), emerging (≥1 file), absent, or unknown (corpus <4) — cite adoption counts. Return ONLY the JSON per your output contract.",
		["## Scope\\n" + scope]
	),
	{ label: "discover", outputSchema: DISCOVER_SCHEMA }
)
const files = ((discovered && discovered.files) || []).slice(0, 12)
if (!files.length) throw new Error("tea-test-review: sin archivos de test bajo " + scope)
log("tea-test-review: " + files.length + " archivos; baseline calculada")

phase("review (fan-out por archivo)")
const tasks = {}
files.forEach(function (f) {
	tasks[f] = function () {
		return agent(
			teaCtx(REVIEWER, [
				"## File under review\\n" + f,
				"## Repo convention baseline (from discovery)\\n" + ((discovered && discovered.baseline) || "(none)"),
				"Read the file before judging. Score only if scorable."
			]),
			{ label: "review " + f, outputSchema: REVIEW_SCHEMA }
		)
	}
})
const reviews = await parallel("files", tasks)

phase("aggregate")
const list = files.map(function (f) { return reviews[f] }).filter(Boolean)
const scored = list.filter(function (r) { return !r.unscorable && typeof r.score === "number" })
const unscorable = list.filter(function (r) { return r.unscorable }).map(function (r) { return r.file })
const score = scored.length ? Math.round(scored.reduce(function (a, r) { return a + r.score }, 0) / scored.length) : null
const bySeverity = {}
list.forEach(function (r) {
	;(r.findings || []).forEach(function (f) {
		bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1
	})
})
log("tea-test-review: score=" + score + " (scored " + scored.length + ", unscorable " + unscorable.length + ")")

phase("report")
const report = await agent(
	"Write the test-review report to ${TEA_ARTIFACTS_DIR}/test-review.md (create the directory if needed) from the JSON below. MARKDOWN: headline (scope, score, scored/unscorable counts), per-file table (file | score | findings), findings grouped by severity with criterion + evidence + fix, unscorable manifest with format, baseline note. Do not invent findings beyond the JSON. End the file with: <!-- tea: workflow=test-review -->\\n\\n## JSON\\n" + JSON.stringify({ scope: scope, score: score, scored: scored.length, unscorable: unscorable, bySeverity: bySeverity, reviews: list }, null, 2),
	{ label: "report" }
)

if (review === "manual") {
	const cp = await checkpoint({ name: "review-report", prompt: "Review listo en ${TEA_ARTIFACTS_DIR}/test-review.md. Score: " + score + " sobre " + scored.length + " archivos puntuados (" + unscorable.length + " unscorable). ¿Apruebas para terminar?", context: { artifact: "${TEA_ARTIFACTS_DIR}/test-review.md", score: score } })
	if (cp !== "approved") throw new Error("tea-test-review: checkpoint rechazado — workflow detenido")
}

return { scope, files: files.length, scored: scored.length, unscorable, score, bySeverity, reportPath: "${TEA_ARTIFACTS_DIR}/test-review.md", reportSummary: report }
`;
}

// ── tea-ci (Lote 2) ─────────────────────────────────────────────────────────

/** Genera el script del workflow `tea-ci`. */
export function generateTeaCiWorkflow(
	stages: ResolvedTeaStage[],
	args: { platform: string },
): string {
	return `${scriptPrelude("tea-ci")}
${stageConsts(stages, { CI: "ci", GATE: "gate" })}
const platform = (args && args.platform) || ${JSON.stringify(args.platform)}
const SURVEY_SCHEMA = { type: "object", properties: { platform: { type: "string" }, testCommand: { type: "string" }, framework: { type: "string" }, packageManager: { type: "string" }, nodeVersion: { type: "string" }, existingCI: { type: "string" } }, required: ["platform", "testCommand", "framework", "packageManager"] }
const SETUP_SCHEMA = { type: "object", properties: { pipelineFile: { type: "string" }, jobs: { type: "array", items: { type: "string" } }, localVerification: { type: "string", enum: ["green", "blocked", "na"] }, notes: { type: "string" } }, required: ["pipelineFile", "jobs", "localVerification", "notes"] }
const GATE_SCHEMA = { type: "object", properties: { decision: { type: "string", enum: ["PASS", "CONCERNS", "FAIL", "WAIVED"] }, findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }, evidence: { type: "string" }, fix: { type: "string" } }, required: ["severity", "evidence", "fix"] } }, notes: { type: "string" } }, required: ["decision", "findings"] }

phase("survey")
const survey = await agent(
	teaCtx(
		"Survey this repository to configure CI: read package.json / go.mod / CI configs — do not guess. Platform preference: " + (platform === "auto" ? "auto-detect (github-actions if .github/workflows exists, else choose the most standard for this repo and say why)" : platform + " (honor it)") + ". Resolve the REAL test command (from package.json scripts or the language's convention), framework, package manager and node version (.nvmrc/engines). Return ONLY the JSON per your output contract.",
		["Return platform as a short slug (github-actions, gitlab-ci, circle-ci, jenkins, azure-devops)."]
	),
	{ label: "survey", outputSchema: SURVEY_SCHEMA }
)
log("tea-ci: platform=" + survey.platform + " cmd=" + survey.testCommand)

phase("pipeline")
const setup = await agent(
	teaCtx(CI, [
		"## Survey decision (honor it)\\n" + JSON.stringify(survey),
	]),
	{ label: "pipeline " + survey.platform, outputSchema: SETUP_SCHEMA }
)
log("tea-ci: " + setup.pipelineFile + " localVerification=" + setup.localVerification)

phase("gate")
const gate = await agent(
	teaCtx(GATE, [
		"Audit the CI pipeline. Read the pipeline file before judging — verify jobs fail on failure (no soft skips) and only reference commands/scripts that exist in the repo.",
		"## Claims to audit\\n" + JSON.stringify(setup, null, 2),
		"## Survey decision\\n" + JSON.stringify(survey),
	]),
	{ label: "gate", outputSchema: GATE_SCHEMA }
)
log("tea-ci: gate=" + gate.decision + " findings=" + (gate.findings || []).length)

if (review === "manual") {
	const cp = await checkpoint({ name: "ci-gate", prompt: "Pipeline CI listo (" + setup.pipelineFile + ", verificación local: " + setup.localVerification + "). Gate: " + gate.decision + " con " + (gate.findings || []).length + " findings. ¿Apruebas para terminar?", context: { pipeline: setup.pipelineFile, platform: survey.platform, gate: gate.decision } })
	if (cp !== "approved") throw new Error("tea-ci: checkpoint rechazado — workflow detenido")
}

return { platform: survey.platform, survey, setup, gate }
`;
}

// ── tea-nfr (Lote 2) ────────────────────────────────────────────────────────

/** Categorías NFR estándar del upstream (performance, security, reliability, maintainability). */
export const STANDARD_NFR_CATEGORIES = [
	"performance",
	"security",
	"reliability",
	"maintainability",
] as const;

/** Genera el script del workflow `tea-nfr`. */
export function generateTeaNfrWorkflow(
	stages: ResolvedTeaStage[],
	args: { subject: string; categories: string[] },
): string {
	return `${scriptPrelude("tea-nfr")}
${stageConsts(stages, { NFR: "nfr" })}
const subject = (args && args.subject) || ${JSON.stringify(args.subject)}
const NFR_SCHEMA = { type: "object", properties: { category: { type: "string" }, status: { type: "string", enum: ["PASS", "CONCERNS", "FAIL", "NO_EVIDENCE"] }, evidence: { type: "array", items: { type: "string" } }, gaps: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }, gap: { type: "string" }, nextStep: { type: "string" } }, required: ["severity", "gap", "nextStep"] } }, summary: { type: "string" } }, required: ["category", "status", "evidence", "gaps", "summary"] }
const CATEGORIES = ${JSON.stringify(args.categories)}

log("tea-nfr: auditando evidencia de " + CATEGORIES.join(", ") + " — " + subject.slice(0, 60))

phase("audit (fan-out por categoría)")
const tasks = {}
CATEGORIES.forEach(function (c) {
	tasks[c] = function () {
		return agent(
			teaCtx(NFR, [
				"## Category to audit\\n" + c,
				"## Subject\\n" + subject,
				"Search the repo (tests, CI config, docs, metrics, logs) for concrete evidence of this category. Cite every evidence item as a path or command output.",
			]),
			{ label: "nfr " + c, outputSchema: NFR_SCHEMA }
		)
	}
})
const audits = await parallel("categories", tasks)

phase("aggregate (gate determinista)")
// Determinista (espejo del upstream): FAIL > CONCERNS/NO_EVIDENCE > PASS.
const byStatus = {}
CATEGORIES.forEach(function (c) {
	const s = audits[c] && audits[c].status ? audits[c].status : "NO_EVIDENCE"
	byStatus[s] = (byStatus[s] || 0) + 1
})
const overall = byStatus["FAIL"] ? "FAIL" : (byStatus["CONCERNS"] || byStatus["NO_EVIDENCE"]) ? "CONCERNS" : "PASS"
log("tea-nfr: " + overall + " — " + JSON.stringify(byStatus))

phase("report")
const report = await agent(
	"Write the NFR evidence assessment to ${TEA_ARTIFACTS_DIR}/nfr-assessment.md (create the directory if needed) from the JSON below. MARKDOWN: headline (subject, overall " + overall + ", status counts), per-category table (category | status | evidence count | gaps), evidence list with citations, gaps with severity + next step, explicit NO_EVIDENCE callouts. Do not invent findings beyond the JSON. End the file with: <!-- tea: workflow=nfr -->\\n\\n## JSON\\n" + JSON.stringify({ subject: subject, overall: overall, byStatus: byStatus, audits: CATEGORIES.map(function (c) { return audits[c] }) }, null, 2),
	{ label: "report" }
)

if (review === "manual") {
	const cp = await checkpoint({ name: "nfr-gate", prompt: "NFR assessment listo en ${TEA_ARTIFACTS_DIR}/nfr-assessment.md. Gate determinista: " + overall + " (" + JSON.stringify(byStatus) + "). ¿Apruebas para terminar?", context: { artifact: "${TEA_ARTIFACTS_DIR}/nfr-assessment.md", overall: overall } })
	if (cp !== "approved") throw new Error("tea-nfr: checkpoint rechazado — workflow detenido")
}

return { subject, overall, byStatus, audits: CATEGORIES.map(function (c) { return { category: c, status: audits[c] && audits[c].status, gaps: (audits[c] && audits[c].gaps || []).length } }), reportSummary: report }
`;
}

// ── tea-trace (Lote 2) ──────────────────────────────────────────────────────

/** Genera el script del workflow `tea-trace`. */
export function generateTeaTraceWorkflow(
	stages: ResolvedTeaStage[],
	args: { requirements: string; scope: string; gate: string },
): string {
	return `${scriptPrelude("tea-trace")}
${stageConsts(stages, { MAPPER: "trace" })}
const requirementsPath = (args && args.requirements) || ${JSON.stringify(args.requirements)}
const scope = (args && args.scope) || ${JSON.stringify(args.scope)}
const gateScope = (args && args.gate) || ${JSON.stringify(args.gate)}
const REQ_SCHEMA = { type: "object", properties: { source: { type: "string" }, requirements: { type: "array", items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" }, priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] } }, required: ["id", "text", "priority"] } } }, required: ["source", "requirements"] }
const MAP_SCHEMA = { type: "object", properties: { mappings: { type: "array", items: { type: "object", properties: { id: { type: "string" }, tests: { type: "array", items: { type: "string" } }, level: { type: "string", enum: ["e2e", "api", "component", "unit", "none"] }, note: { type: "string" } }, required: ["id", "tests", "level", "note"] } } }, required: ["mappings"] }

phase("requirements")
const extracted = await agent(
	"Extract the verifiable requirements from " + requirementsPath + ". If the file does not exist, synthesize requirements from the codebase's observable behavior (synthetic oracle — mark source accordingly) prioritizing user-visible behavior. Cap at 20 requirements; merge duplicates. Return ONLY the JSON per your output contract with source = the path read or \\"synthetic\\".",
	{ label: "extract requirements", outputSchema: REQ_SCHEMA }
)
const requirements = ((extracted && extracted.requirements) || []).slice(0, 20)
if (!requirements.length) throw new Error("tea-trace: sin requisitos extraíbles de " + requirementsPath + " ni del código")
log("tea-trace: " + requirements.length + " requisitos (" + (extracted && extracted.source) + ")")

phase("map")
const mapped = await agent(
	teaCtx(MAPPER, [
		"## Requirements\\n" + JSON.stringify(requirements, null, 2),
		"## Test scope\\n" + scope,
	]),
	{ label: "mapper", outputSchema: MAP_SCHEMA }
)
const byId = {}
requirements.forEach(function (r) { byId[r.id] = r })
;(mapped && mapped.mappings || []).forEach(function (m) { if (byId[m.id]) byId[m.id] = Object.assign({}, byId[m.id], m) })

phase("coverage (gate determinista)")
// Determinista (espejo del upstream decision_mode: rule-based).
const covered = requirements.filter(function (r) { return (byId[r.id] && byId[r.id].tests || []).length > 0 })
const uncovered = requirements.filter(function (r) { return (byId[r.id] && byId[r.id].tests || []).length === 0 })
const byPriority = {}
requirements.forEach(function (r) {
	const p = byId[r.id] && byId[r.id].tests && byId[r.id].tests.length ? "covered" : "uncovered"
	byPriority[r.priority] = byPriority[r.priority] || { covered: 0, uncovered: 0 }
	byPriority[r.priority][p]++
})
const pct = requirements.length ? Math.round((covered.length / requirements.length) * 100) : 0
const gateStatus = uncovered.some(function (r) { return r.priority === "P0" }) ? "FAIL" : uncovered.some(function (r) { return r.priority === "P1" }) ? "CONCERNS" : "PASS"
log("tea-trace: " + pct + "% (" + covered.length + "/" + requirements.length + ") gate=" + gateStatus + " [" + gateScope + "]")

phase("report")
const report = await agent(
	"Write the traceability matrix to ${TEA_ARTIFACTS_DIR}/traceability-matrix.md (create the directory if needed) from the JSON below. MARKDOWN: headline (requirements source, coverage %, gate " + gateStatus + " for scope " + gateScope + "), matrix table (id | priority | requirement (short) | tests | level | note), coverage by priority table, uncovered list with the gate reasoning. Do not invent tests beyond the JSON. End the file with: <!-- tea: workflow=trace -->\\n\\n## JSON\\n" + JSON.stringify({ source: extracted && extracted.source, gateScope: gateScope, coverage: { covered: covered.length, total: requirements.length, pct: pct }, gateStatus: gateStatus, byPriority: byPriority, requirements: requirements.map(function (r) { return { id: r.id, priority: r.priority, text: r.text, tests: (byId[r.id] && byId[r.id].tests || []), level: (byId[r.id] && byId[r.id].level) || "none", note: (byId[r.id] && byId[r.id].note) || "" } }) }, null, 2),
	{ label: "report" }
)

if (review === "manual") {
	const cp = await checkpoint({ name: "trace-gate", prompt: "Matriz de trazabilidad lista en ${TEA_ARTIFACTS_DIR}/traceability-matrix.md. Cobertura " + pct + "% (" + covered.length + "/" + requirements.length + "). Gate " + gateStatus + " [" + gateScope + "]. ¿Apruebas para terminar?", context: { artifact: "${TEA_ARTIFACTS_DIR}/traceability-matrix.md", coverage: pct, gate: gateStatus } })
	if (cp !== "approved") throw new Error("tea-trace: checkpoint rechazado — workflow detenido")
}

return { requirementsSource: extracted && extracted.source, gateScope, coverage: { covered: covered.length, total: requirements.length, pct: pct }, gateStatus, byPriority, uncovered: uncovered.map(function (r) { return r.id }), reportSummary: report }
`;
}

// ── tea-atdd (Lote 2) ───────────────────────────────────────────────────────

/** Genera el script del workflow `tea-atdd`. */
export function generateTeaAtddWorkflow(
	stages: ResolvedTeaStage[],
	args: { feature: string; level: string },
): string {
	return `${scriptPrelude("tea-atdd")}
${stageConsts(stages, { ATDD: "atdd" })}
const feature = (args && args.feature) || ${JSON.stringify(args.feature)}
const level = (args && args.level) || ${JSON.stringify(args.level)}
const RED_SCHEMA = { type: "object", properties: { level: { type: "string", enum: ["e2e", "api", "component", "unit"] }, files: { type: "array", items: { type: "string" } }, testStatus: { type: "string", enum: ["red", "green", "blocked"] }, checklistPath: { type: "string" }, scenariosCovered: { type: "number" }, notes: { type: "string" } }, required: ["level", "files", "testStatus", "checklistPath", "scenariosCovered", "notes"] }

log("tea-atdd: escenarios para: " + feature.slice(0, 70))

phase("scenarios")
const scenariosSummary = await agent(
	teaCtx(ATDD, [
		"## Your role\\nA — scenarios",
		"## Feature (verbatim)\\n" + feature,
		"Write the scenarios to ${TEA_ARTIFACTS_DIR}/atdd-scenarios.md (create the directory if needed).",
	]),
	{ label: "scenarios" }
)

if (review === "manual") {
	const cp = await checkpoint({ name: "scenarios", prompt: "Escenarios ATDD listos en ${TEA_ARTIFACTS_DIR}/atdd-scenarios.md. Revísalos/edítalos (son el contrato) y aprueba para pasar a la fase roja (o rechaza con notas).", context: { artifact: "${TEA_ARTIFACTS_DIR}/atdd-scenarios.md", feature: feature.slice(0, 80) } })
	if (cp !== "approved") throw new Error("tea-atdd: checkpoint rechazado — workflow detenido")
}

phase("red phase")
const red = await agent(
	teaCtx(ATDD, [
		"## Your role\\nB — red phase",
		"## Feature (verbatim)\\n" + feature,
		"## Scenarios (the CONTRACT — read the file)\\n${TEA_ARTIFACTS_DIR}/atdd-scenarios.md",
		"Assigned level: " + level + ("auto" === level ? " (choose the lowest level that can verify the behavior; report your choice)" : " (honor it)"),
		"Write the failing acceptance tests, run them, and write the implementation checklist to ${TEA_ARTIFACTS_DIR}/atdd-checklist.md.",
	]),
	{ label: "red phase", outputSchema: RED_SCHEMA }
)
log("tea-atdd: red phase status=" + red.testStatus + " level=" + red.level + " scenarios=" + red.scenariosCovered)

if (review === "manual") {
	const cp = await checkpoint({ name: "red-phase", prompt: "Fase roja lista: " + red.files.length + " archivos de test (" + red.testStatus + ", nivel " + red.level + ", " + red.scenariosCovered + " escenarios). Checklist en " + red.checklistPath + ". ¿Apruebas para terminar?", context: { status: red.testStatus, files: red.files, checklist: red.checklistPath } })
	if (cp !== "approved") throw new Error("tea-atdd: checkpoint rechazado — workflow detenido")
}

return { feature: feature.slice(0, 120), scenarios: "${TEA_ARTIFACTS_DIR}/atdd-scenarios.md", red, scenariosSummary }
`;
}

// ── tea-teach (Lote 2) ──────────────────────────────────────────────────────

/** Módulos de la academia (espejo del currículo del upstream, derecho de tamaño). */
export const TEA_ACADEMY_MODULES = [
	{ id: "risk", topic: "risk-based testing: clasificar P0-P3 y decidir profundidad" },
	{ id: "levels", topic: "test levels y la pirámide: el nivel más bajo que puede probar el comportamiento" },
	{ id: "flakiness", topic: "flakiness y anti-patrones: hard waits, estado compartido, aserciones tautológicas" },
	{ id: "gates", topic: "gates de release y evidencia: PASS/CONCERNS/FAIL/WAIVED con severidades fijas" },
	{ id: "atdd", topic: "ATDD: escenarios como contrato y la fase roja" },
] as const;

/** Genera el script del workflow `tea-teach`. */
export function generateTeaTeachWorkflow(
	stages: ResolvedTeaStage[],
	args: { topic: string; moduleIds: string[] },
): string {
	return `${scriptPrelude("tea-teach")}
${stageConsts(stages, { TEACH: "teach" })}
const topic = (args && args.topic) || ${JSON.stringify(args.topic)}
const MODULES = ${JSON.stringify(TEA_ACADEMY_MODULES.filter((m) => args.moduleIds.length === 0 || args.moduleIds.includes(m.id)).map((m) => ({ id: m.id, topic: m.topic })))}

if (!MODULES.length) throw new Error("tea-teach: sin módulos que escribir")
log("tea-teach: academia — " + MODULES.length + " módulos" + (topic ? " (enfoque: " + topic.slice(0, 50) + ")" : ""))

phase("lessons (fan-out por módulo)")
const tasks = {}
MODULES.forEach(function (m, i) {
	tasks[m.id] = function () {
		return agent(
			teaCtx(TEACH, [
				"## Module to write\\n" + (i + 1) + ". " + m.id + " — " + m.topic,
				"Write the lesson to ${TEA_ARTIFACTS_DIR}/academy/" + (i + 1) + "-" + m.id + ".md (create the directory if needed).",
				topic ? "## Learner focus\\n" + topic : "",
			]),
			{ label: "lesson " + m.id }
		)
	}
})
const lessons = await parallel("modules", tasks)

phase("index")
const index = await agent(
	"Write the academy index to ${TEA_ARTIFACTS_DIR}/academy/README.md (create the directory if needed): suggested order (the numbering), one line per module (what the learner walks away with), and how to practice against this repo. End the file with: <!-- tea: workflow=teach -->",
	{ label: "index" }
)

if (review === "manual") {
	const cp = await checkpoint({ name: "academy", prompt: "Academia lista: " + MODULES.length + " lecciones en ${TEA_ARTIFACTS_DIR}/academy/ (índice en README.md). ¿Apruebas para terminar?", context: { dir: "${TEA_ARTIFACTS_DIR}/academy", modules: MODULES.map(function (m) { return m.id }) } })
	if (cp !== "approved") throw new Error("tea-teach: checkpoint rechazado — workflow detenido")
}

return { dir: "${TEA_ARTIFACTS_DIR}/academy", modules: MODULES.map(function (m) { return m.id }), lessons, indexSummary: index }
`;
}
