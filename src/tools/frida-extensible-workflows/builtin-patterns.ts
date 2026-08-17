// frida-extensible-workflows — patrones curados del Lote 1 de #19 (ADR-0030).
//
// Porto `multi-perspective` y `codebase-audit` de
// @quintinshaw/pi-dynamic-workflows (MIT) como PATRONES NOMBRADOS: el tool
// `workflow` resuelve `name` (sin script/scriptPath) al script generado aquí.
// El script es ESTÁTICO y lee sus inputs de `args` en runtime (estilo
// adversarial-review del upstream): identidad de journaling estable entre
// corridas con args distintos, cero interpolación de strings de usuario en el
// código (no hay superficie de inyección).
//
// Adaptaciones al runtime de Frida (difieren del upstream):
//  - Sin `export const meta` (G3): el body corre envuelto en una async fn del
//    sandbox node:vm; `export` sería un syntax error. Las fases nacen de las
//    llamadas phase() en runtime.
//  - `parallel(nombre, tareas)` exige RECORD (no array): los scripts arman el
//    objeto de tareas con forEach y leen resultados por key.
//  - Sin `schema`/`tier` (G1/G2, Lote 2): los agentes devuelven texto plano.
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

/** Patrones curados del Lote 1 de #19, en orden de registro. */
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
