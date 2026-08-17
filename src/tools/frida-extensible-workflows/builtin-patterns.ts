// frida-extensible-workflows — patrones curados de #19 (ADR-0030).
//
// Lote 1: multi-perspective + codebase-audit (agent()/parallel() puro).
// Lote 2: code-review + adversarial-review (usan agent({ outputSchema, tier }),
// habilitados por structured-output.ts + resolución tier→alias de settings).
// Puertos de @quintinshaw/pi-dynamic-workflows (MIT).
//
// El tool `workflow` resuelve `name` (sin script/scriptPath) al script
// generado aquí. Los scripts son ESTÁTICOS y leen sus inputs de `args` en
// runtime (estilo adversarial-review del upstream): identidad de journaling
// estable entre corridas con args distintos, cero interpolación de strings de
// usuario en el código (no hay superficie de inyección).
//
// Adaptaciones al runtime de Frida (difieren del upstream):
//  - Sin `export const meta` (G3): el body corre envuelto en una async fn del
//    sandbox node:vm; `export` sería un syntax error. Las fases nacen de las
//    llamadas phase() en runtime.
//  - `parallel(nombre, tareas)` exige RECORD (no array): los scripts arman el
//    objeto de tareas con forEach y leen resultados por key.
//  - `schema` del upstream → `outputSchema` (el nombre de opción que valida el
//    porte de rpiv-workflow, G1 resuelto en structured-output.ts).
//  - `tier` (small/medium/big) resuelve vía modelAliases de settings; sin
//    alias configurado cae al modelo de la sesión (degradación silenciosa).
//
// Validación de args: EAGER en resolve() (falla antes de lanzar el run, con
// mensaje accionable) + defensiva en el script (defaults) para el caso de un
// script guardado/reanudado que llegue con args distintos.

/** Perspectivas por defecto cuando el caller no provee ≥2 (espejo del upstream). */
export const DEFAULT_MULTI_PERSPECTIVES: readonly string[] = [
	"technical",
	"product",
	"security",
	"user experience",
	"maintainability",
];

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function requireNonEmptyString(
	value: unknown,
	argName: string,
	patternName: string,
): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(
			`Patrón "${patternName}" requiere args.${argName} como string no vacío.`,
		);
	}
	return value;
}

function requireStringArray(
	value: unknown,
	argName: string,
	patternName: string,
): string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		!value.every((v) => typeof v === "string" && v.trim())
	) {
		throw new Error(
			`Patrón "${patternName}" requiere args.${argName} como array no vacío de strings no vacíos.`,
		);
	}
	return value as string[];
}

/** Script de `multi-perspective`: análisis en paralelo por perspectiva + síntesis. */
export function generateMultiPerspectiveWorkflow(): string {
	return `// Patrón curado: multi-perspective (#19, Lote 1).
const topic = (args && args.topic) || ""
const perspectives = (args && Array.isArray(args.perspectives) && args.perspectives.length >= 2)
	? args.perspectives
	: ${JSON.stringify(DEFAULT_MULTI_PERSPECTIVES)}

phase("Perspective Analysis")
const tasks = {}
perspectives.forEach((p, i) => {
	tasks["p" + (i + 1)] = () =>
		agent(
			"Analyze the following topic strictly from the " + p +
			" perspective. Provide concrete, actionable insights specific to that perspective; do not cover other angles.\\n\\nTOPIC: " + topic,
			{ label: "perspective " + (i + 1) + ": " + p }
		)
})
const analyses = await parallel("perspectives", tasks)

phase("Synthesis")
const synthesis = await agent(
	"Synthesize these independent perspective analyses into one balanced recommendation. " +
	"Highlight agreements, tensions between perspectives, and open trade-offs.\\n\\nTOPIC: " + topic +
	"\\n\\nANALYSES:\\n" + Object.keys(analyses).map((k, i) => "--- " + perspectives[i] + " ---\\n" + analyses[k]).join("\\n\\n"),
	{ label: "synthesis" }
)

return { topic, perspectives, analyses, synthesis }`;
}

/** Script de `codebase-audit`: checks en paralelo + cross-validation + reporte. */
export function generateCodebaseAuditWorkflow(): string {
	return `// Patrón curado: codebase-audit (#19, Lote 1).
const scope = (args && args.scope) || ""
const checks = (args && Array.isArray(args.checks)) ? args.checks : []

phase("Individual Checks")
const tasks = {}
checks.forEach((c, i) => {
	tasks["c" + (i + 1)] = () =>
		agent(
			"Audit the following check across the given scope. Report concrete findings with file:line evidence from the codebase; if everything looks clean, say so explicitly.\\n\\nCHECK: " + c + "\\nSCOPE: " + scope,
			{ label: "check " + (i + 1) + ": " + c }
		)
})
const findings = await parallel("checks", tasks)

phase("Cross-Validation")
const validated = await agent(
	"Cross-validate these audit findings against the codebase: read the cited code, discard false positives, confirm real issues, and deduplicate overlaps.\\n\\nSCOPE: " + scope +
	"\\n\\nFINDINGS:\\n" + Object.keys(findings).map((k, i) => "--- check: " + checks[i] + " ---\\n" + findings[k]).join("\\n\\n"),
	{ label: "validator" }
)

phase("Report")
const report = await agent(
	"Generate a prioritized audit report with actionable recommendations, ranked by severity.\\n\\nSCOPE: " + scope +
	"\\n\\nVALIDATED FINDINGS:\\n" + validated,
	{ label: "report" }
)

return { scope, checks, findings, validated, report }`;
}

/** Script de `adversarial-review`: hallazgos → refutadores escépticos → consenso. */
export function generateAdversarialReviewWorkflow(): string {
	return `// Patrón curado: adversarial-review (#19, Lote 2).
// Cada hallazgo lo juzgan N revisores INDEPENDIENTES instruidos a REFUTARLO;
// sobrevive sólo si la fracción de votos real >= threshold.
const task = (args && args.task) || ""
const reviewers = (args && args.reviewers) || 2
const threshold = (args && args.threshold) || 0.5

phase("Investigate")
const investigation = await agent(
	"Investigate the following and list concrete, individually-checkable findings:\\n" + task,
	{
		label: "investigate",
		outputSchema: {
			type: "object",
			properties: {
				findings: { type: "array", items: { type: "string" } },
			},
			required: ["findings"],
		},
	}
)
const findings = (investigation && investigation.findings) || []

phase("Refute")
const refuteTasks = {}
findings.forEach((f, i) => {
	refuteTasks["f" + (i + 1)] = async () => {
		const voteTasks = {}
		for (let r = 0; r < reviewers; r++) {
			voteTasks["r" + (r + 1)] = () =>
				agent(
					"You are a skeptical reviewer. Try to REFUTE this finding for the task below. " +
					"Default to real=false when uncertain. Investigate with the available tools if needed.\\n\\n" +
					"TASK: " + task + "\\nFINDING: " + f,
					{
						label: "refute " + (i + 1) + "." + (r + 1),
						outputSchema: {
							type: "object",
							properties: {
								real: { type: "boolean" },
								reason: { type: "string" },
							},
							required: ["real"],
						},
					}
				)
		}
		const votes = await parallel("votes " + (i + 1), voteTasks)
		const vals = Object.keys(votes).map((k) => votes[k]).filter(Boolean)
		const realCount = vals.filter((v) => v && v.real).length
		const ratio = vals.length ? realCount / vals.length : 0
		return { finding: f, realVotes: realCount, totalVotes: vals.length, survives: ratio >= threshold }
	}
})
const judged = findings.length ? await parallel("refutes", refuteTasks) : {}
const judgedList = Object.keys(judged).map((k) => judged[k])
const survivors = judgedList.filter((j) => j && j.survives)

phase("Consensus")
const report = await agent(
	"Write a final review report. Include ONLY the findings that survived adversarial review (listed below), " +
	"each with a short justification. Note how many were discarded.\\n\\n" +
	"SURVIVING FINDINGS JSON:\\n" + JSON.stringify(survivors),
	{ label: "consensus" }
)

return { total: findings.length, survivors, report }`;
}

/**
 * Tope de caracteres del diff que revisa code-review (espejo del upstream):
 * acota el peor caso de 7 finders + verify por candidato. Trunca en vez de
 * rechazar (los hallazgos del prefijo siguen teniendo valor) y lo anuncia
 * con log(), no en silencio.
 */
export const CODE_REVIEW_MAX_DIFF_CHARS = 200_000;

/** Script de `code-review`: 7 finders especializados → verify → reporte rankeado. */
export function generateCodeReviewWorkflow(): string {
	return `// Patrón curado: code-review (#19, Lote 2).
// Tier routing (espejo del upstream): A/B/C medium (correctness), D/E/F small
// (cleanup), G big (altitude); síntesis big. Sin aliases de tier configurados,
// todos caen al modelo de la sesión.
const MAX_DIFF_CHARS = ${CODE_REVIEW_MAX_DIFF_CHARS}
const rawDiff = (args && args.diff) || ""
const diffSource = (args && args.diffSource) || "git diff HEAD"
const diffTruncated = rawDiff.length > MAX_DIFF_CHARS
const diff = diffTruncated ? rawDiff.slice(0, MAX_DIFF_CHARS) : rawDiff
if (diffTruncated) {
	log("Diff truncated for review: showing the first " + MAX_DIFF_CHARS + " of " + rawDiff.length +
		" characters (" + (rawDiff.length - MAX_DIFF_CHARS) + " omitted). Findings past the cut are not covered.")
}

const candidateSchema = {
	type: "object",
	properties: {
		candidates: {
			type: "array",
			items: {
				type: "object",
				properties: {
					file: { type: "string" },
					line: { type: "number" },
					summary: { type: "string" },
					failure_scenario: { type: "string" },
				},
				required: ["file", "line", "summary", "failure_scenario"],
			},
		},
	},
	required: ["candidates"],
}
const verdictSchema = {
	type: "object",
	properties: {
		verdict: { type: "string", enum: ["CONFIRMED", "PLAUSIBLE", "REFUTED"] },
		reason: { type: "string" },
	},
	required: ["verdict"],
}

const diffBlock = "\\n\\n<diff source=\\"" + diffSource + "\\"" + (diffTruncated ? " truncated=\\"true\\"" : "") + ">\\n" +
	diff + (diffTruncated ? "\\n\\n[... diff truncated: " + (rawDiff.length - MAX_DIFF_CHARS) + " more characters omitted ...]" : "") +
	"\\n</diff>\\n"
const base = "Use the read/grep tools to pull in any additional file context you need." + diffBlock

const finderDefs = [
	["A", "You are a line-by-line correctness scanner. Hunt ONLY for: inverted conditions, off-by-one errors, null/nil dereferences, wrong variable used, swallowed errors. For each candidate name the exact file, line number, a one-line summary, and the concrete failure scenario. Return ONLY issues you can justify with a line in the diff.", "medium"],
	["B", "You are a removed-behavior auditor. For every deleted line or block in the diff: name the invariant or contract it enforced, then find where (or prove) that contract is re-established elsewhere. Report only gaps where the invariant is NOT re-established.", "medium"],
	["C", "You are a cross-file call-site tracer. For each function/method whose signature or behavior changed in the diff: grep the codebase for callers, then check whether each call site is still correct after the change. Report only call sites that are now broken or need updating.", "medium"],
	["D", "You are a reuse finder. Identify new code in the diff that duplicates existing helpers, utilities, or patterns already present in the codebase. Propose the existing symbol that should be used instead.", "small"],
	["E", "You are a simplification finder. Look for: redundant state that could be derived, copy-paste variation that could be a shared function, and dead code introduced by the diff.", "small"],
	["F", "You are an efficiency finder. Identify: redundant I/O or network calls, sequential work that could be parallel, and blocking operations on the startup or hot path introduced by the diff.", "small"],
	["G", "You are an altitude reviewer. Assess whether the change is made at the RIGHT abstraction level. Look for: bandaids on shared infrastructure that should be fixed at the root, fixes in the wrong layer (e.g. compensating in the UI for a data model problem), or the change solving a symptom rather than the cause.", "big"],
]

phase("Find")
const finderTasks = {}
finderDefs.forEach((fd) => {
	finderTasks[fd[0]] = () => agent(fd[1] + base, { label: fd[0] + "-finder", tier: fd[2], outputSchema: candidateSchema })
})
const finders = await parallel("finders", finderTasks)

const allRaw = finderDefs.flatMap((fd) => {
	const r = finders[fd[0]]
	const cands = (r && r.candidates) || []
	return cands.map((c) => ({ ...c, angle: fd[0] }))
})

// Dedup: mismo file + line + primeros 40 chars de summary → conserva el primero.
const seen = new Set()
const allCandidates = allRaw.filter((c) => {
	const key = (c.file || "") + ":" + (c.line || 0) + ":" + (c.summary || "").slice(0, 40)
	if (seen.has(key)) return false
	seen.add(key)
	return true
})

phase("Verify")
// 3 vías (CONFIRMED/PLAUSIBLE/REFUTED), no boolean: la síntesis necesita el matiz.
const verdictTasks = {}
allCandidates.forEach((c, i) => {
	verdictTasks["v" + (i + 1)] = () =>
		agent(
			"You are a verifier. Determine whether this code review finding is CONFIRMED, PLAUSIBLE, or REFUTED. " +
			"CONFIRMED = you can trace the exact failure in the diff. PLAUSIBLE = concern is valid but not certain. " +
			"REFUTED = finding is wrong or already handled.\\n\\n" +
			"FINDING:\\nFile: " + c.file + "\\nLine: " + c.line + "\\nSummary: " + c.summary + "\\n" +
			"Failure scenario: " + c.failure_scenario + diffBlock,
			{ label: "verify-" + (i + 1), outputSchema: verdictSchema }
		)
})
const verdicts = allCandidates.length ? await parallel("verdicts", verdictTasks) : {}

const surviving = allCandidates
	.map((c, i) => ({
		...c,
		verdict: (verdicts["v" + (i + 1)] && verdicts["v" + (i + 1)].verdict) || "PLAUSIBLE",
		verifyReason: (verdicts["v" + (i + 1)] && verdicts["v" + (i + 1)].reason) || "",
	}))
	.filter((c) => c.verdict !== "REFUTED")

// Rank: correctness (A/B/C) < cleanup (D/E/F) < altitude (G); tope 10.
const rankAngle = (a) => ["A", "B", "C"].includes(a) ? 0 : ["D", "E", "F"].includes(a) ? 1 : 2
surviving.sort((x, y) => rankAngle(x.angle) - rankAngle(y.angle))
const top = surviving.slice(0, 10)

phase("Report")
const synthesis = await agent(
	"You are a senior code reviewer writing the final report. Below are the verified findings from a " +
	"multi-angle code review (already ranked by severity). Write a concise markdown report: " +
	"1 sentence per finding with file, line, and the failure scenario. Note the total found vs shown. " +
	"Correctness issues (A/B/C) come first, then cleanup (D/E/F), then altitude (G).\\n\\n" +
	"FINDINGS JSON:\\n" + JSON.stringify(top, null, 2),
	{ label: "synthesis", tier: "big" }
)

return { total: allCandidates.length, surviving: surviving.length, findings: top, report: synthesis, diffTruncated }`;
}

/** Un patrón curado del catálogo, ejecutable por nombre desde el tool workflow. */
export interface BuiltinPattern {
	/** Nombre estable (workflow({ name }) sin script lo resuelve). */
	name: string;
	/** Descripción corta para el catálogo y el modelo. */
	description: string;
	/** Documentación de args para el catálogo. */
	args: string;
	/** Valida args (eager) y devuelve el script del patrón. */
	resolve(args: unknown): string;
}

/** Patrones curados de #19 (Lotes 1 y 2), en orden de registro. */
export const BUILTIN_PATTERNS: readonly BuiltinPattern[] = [
	{
		name: "multi-perspective",
		description:
			"Analyze a topic from several independent perspectives in parallel, then synthesize one balanced recommendation.",
		args:
			'{ topic: string, perspectives?: string[] } — perspectives usa las 5 por defecto si faltan o hay menos de 2',
		resolve(args: unknown): string {
			const record = asRecord(args);
			requireNonEmptyString(record.topic, "topic", "multi-perspective");
			if (record.perspectives !== undefined) {
				requireStringArray(record.perspectives, "perspectives", "multi-perspective");
			}
			return generateMultiPerspectiveWorkflow();
		},
	},
	{
		name: "codebase-audit",
		description:
			"Run parallel checks against a codebase scope, cross-validate the findings, and produce a prioritized report.",
		args:
			'{ scope: string, checks: string[] } — p. ej. { scope: "src/tools/", checks: ["imports circulares", "exports muertos"] }',
		resolve(args: unknown): string {
			const record = asRecord(args);
			requireNonEmptyString(record.scope, "scope", "codebase-audit");
			requireStringArray(record.checks, "checks", "codebase-audit");
			return generateCodebaseAuditWorkflow();
		},
	},
	{
		name: "adversarial-review",
		description:
			"Investigate a task, then cross-check each finding with skeptical reviewers; only findings that survive the refutation threshold make the final report.",
		args:
			'{ task: string, reviewers?: number (1-5, default 2), threshold?: number (0-1, default 0.5) }',
		resolve(args: unknown): string {
			const record = asRecord(args);
			requireNonEmptyString(record.task, "task", "adversarial-review");
			if (record.reviewers !== undefined) {
				const r = record.reviewers;
				if (typeof r !== "number" || !Number.isInteger(r) || r < 1 || r > 5) {
					throw new Error(
						'Patrón "adversarial-review" requiere args.reviewers como entero 1-5.',
					);
				}
			}
			if (record.threshold !== undefined) {
				const t = record.threshold;
				if (typeof t !== "number" || t < 0 || t > 1) {
					throw new Error(
						'Patrón "adversarial-review" requiere args.threshold como número 0-1.',
					);
				}
			}
			return generateAdversarialReviewWorkflow();
		},
	},
	{
		name: "code-review",
		description:
			"Multi-angle parallel code review: 7 specialized finders (correctness, reuse, simplification, efficiency, altitude) + verify pass → ranked findings.",
		args:
			'{ diff: string, diffSource?: string } — el diff a revisar (trunca a 200k chars); diffSource etiqueta la procedencia',
		resolve(args: unknown): string {
			const record = asRecord(args);
			requireNonEmptyString(record.diff, "diff", "code-review");
			return generateCodeReviewWorkflow();
		},
	},
];

/** Busca un patrón por nombre exacto (estable, sin normalización). */
export function findBuiltinPattern(name: string): BuiltinPattern | undefined {
	return BUILTIN_PATTERNS.find((p) => p.name === name);
}

/** Listado de patrones para la salida de workflow_catalog. */
export function builtinPatternsCatalog(): Array<{
	name: string;
	description: string;
	args: string;
}> {
	return BUILTIN_PATTERNS.map(({ name, description, args }) => ({
		name,
		description,
		args,
	}));
}
