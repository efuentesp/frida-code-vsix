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
