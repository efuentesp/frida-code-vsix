// frida-aidd — generador del script del workflow aidd-plan (issue #38).
//
// El script corre en el sandbox de frida-extensible-workflows (agent/parallel/
// phase/checkpoint/log/args). Prompts y rutas se interpolan del lado del host
// (generateAiddPlanWorkflow) para que el script quede declarativo: la cadena
// brief → prd → architecture → epics-and-stories con checkpoints, y spec como
// fan-out paralelo (una spec por historia).
//
// Contrato de artefactos: cada agente ESCRIBE su artefacto con sus tools de
// archivo (sesión desechable con tools completos) y devuelve un resumen corto.
// El stage siguiente lee los artefactos anteriores — si alguien no escribió,
// la cadena falla ruidosamente (no silenciosamente).

import type { ResolvedStage } from "./resolver";
import { AIDD_PLANNING_DIR, type AiddPlanStage } from "./skills";

export interface AiddPlanArgs {
	idea: string;
	project?: string;
	language?: string;
	/** "manual" (checkpoints entre stages) | "auto" (corre sin pausas). */
	review?: "manual" | "auto";
}

/** Escape de backslash/backtick/${ para interpolar strings en template literal. */
function lit(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("`", "\\`")
		.replaceAll("${", "\\${");
}

/** Ruta del artefacto por stage de la cadena (relativa a planningDir). */
const CHAIN_ARTIFACTS: Record<AiddPlanStage, string> = {
	"product-brief": "product-brief.md",
	prd: "prd.md",
	architecture: "architecture.md",
	"epics-and-stories": "epics-and-stories.md",
	spec: "specs.md",
};

/**
 * Genera el script del workflow `aidd-plan`. Los prompts ya resueltos (3 capas)
 * llegan interpolados como constantes del script.
 */
export function generateAiddPlanWorkflow(
	stages: ResolvedStage[],
	args: {
		idea: string;
		project: string;
		language: string;
		planningDir?: string;
	},
): string {
	// La cadena secuencial corre los 4 stages de descubrimiento; "spec" es
	// fan-out puro (una spec por historia) y no corre en la cadena.
	const chain = stages.filter((s) => s.stage !== "spec");
	const specStage = stages.find((s) => s.stage === "spec");
	if (!specStage) {
		throw new Error("aidd-plan: falta el stage 'spec' en el resolver.");
	}
	const planningDir = args.planningDir ?? AIDD_PLANNING_DIR;

	const consts = [
		...chain.map(
			(s, i) =>
				`\t// ${s.stage} — fuente del prompt: ${s.source}\n\tconst P${i} = \`${lit(s.prompt)}\`;\n\tconst A${i} = "${CHAIN_ARTIFACTS[s.stage]}";`,
		),
		`\t// spec — fuente del prompt: ${specStage.source}\n\tconst SPEC_PROMPT = \`${lit(specStage.prompt)}\`;`,
	].join("\n");

	return `// Patrón curado: aidd-plan (frida-aidd #38, Lote 1 — fase plan).
// Cadena BMAD adaptada: brief → prd → architecture → epics-and-stories → specs
// (fan-out por historia). Cada agente escribe su artefacto a disco y el stage
// siguiente lo lee. Checkpoints entre stages cuando review=manual.
const idea = (args && args.idea) || ""
const project = (args && args.project) || ${JSON.stringify(args.project)}
const language = (args && args.language) || ${JSON.stringify(args.language)}
const planningDir = ${JSON.stringify(planningDir)}
const review = (args && args.review) || "manual"
const STAGES = [${chain.map((s) => `"${s.stage}"`).join(", ")}]
${consts}

log("aidd-plan: " + project + " — " + STAGES.join(" → ") + " → spec(fan-out) [review=" + review + "]")

function ctxFor(stage, prompt, previous) {
	return prompt + "\\n\\n---\\n\\n" +
		"## Runtime context\\n" +
		"Project: " + project + "\\n" +
		"Language for ALL artifacts: " + language + ".\\n" +
		"Artifacts directory: " + planningDir + "\\n\\n" +
		"## Idea (verbatim)\\n" + idea + "\\n\\n" +
		"## Upstream artifacts (READ these files before working)\\n" +
		(previous.length ? previous.map(p => "- " + p).join("\\n") : "- (none — you are the first stage)") + "\\n\\n" +
		"## Headless contract\\n" +
		"You run headless — no interactive user in THIS session. Open questions go IN the artifact; tag un-groundable claims [ASSUMPTION]. Write the artifact file now with your file tools, then reply with a <=15-line summary: artifact path, key decisions, assumptions, open questions."
}

// ── Cadena secuencial con checkpoint opcional entre stages ────────────────
const summaries = {}
let prevPaths = []
${chain
	.map((s, i) => {
		const cp =
			i < chain.length - 1
				? `\nif (review === "manual") {\n\tconst cp = await checkpoint({ name: "stage-${s.stage}", prompt: "Stage ${s.stage} listo. Revisa/edita ${CHAIN_ARTIFACTS[s.stage]} y aprueba para continuar (o rechaza con notas en la respuesta).", context: { artifact: planningDir + "/" + A${i}, stage: "${s.stage}" } })\n\tif (cp !== "approved") throw new Error("stage ${s.stage}: checkpoint rechazado — workflow detenido")\n}`
				: "";
		return `\nphase("${s.stage}")\nsummaries["${s.stage}"] = await agent(ctxFor(STAGES[${i}], P${i}, prevPaths), { label: "stage ${s.stage}" })\n// Gate de artefacto (#65): el contrato «escribe el archivo» del agente NO es garantía —\n// el prd.md fantasma probó que un summary sin archivo rompía la cadena aguas abajo.\nconst gate${i}a = await shell("test -s ${planningDir}/${CHAIN_ARTIFACTS[s.stage]}")
if (gate${i}a.exitCode !== 0) {
	// Reintento informado (#67): el summary del intento 1 como evidencia ataca
	// la «completada mentirosa»; mismo prompt del stage + contexto del fracaso.
	log("stage ${s.stage}: gate en rojo — reintento informado (#67)")
	const intento1 = String(summaries["${s.stage}"] || "")
	summaries["${s.stage}"] = await agent(ctxFor(STAGES[${i}], P${i}, prevPaths) +
		'\\n\\n## FALLA ANTERIOR — última oportunidad\\n' +
		'Tu intento anterior NO escribió ${planningDir}/${CHAIN_ARTIFACTS[s.stage]} (verificado con test -s).\\n' +
		'Tu summary fue: "' + intento1.slice(0, 400) + '"\\n' +
		'ESCRÍBELO de verdad ahora con tus file tools — sin el archivo en disco el stage falla.',
		{ label: "stage ${s.stage} (reintento)" })
	const gate${i}b = await shell("test -s ${planningDir}/${CHAIN_ARTIFACTS[s.stage]}")
	if (gate${i}b.exitCode !== 0) {
		// Expediente (#67): ambos intentos + estado real del directorio para
		// diagnóstico inmediato (ruta equivocada / resumen sin escribir / nada).
		const diag${i} = await shell("ls -la ${planningDir}")
		throw new Error("stage ${s.stage}: tras 2 intentos el agente NO escribió ${planningDir}/${CHAIN_ARTIFACTS[s.stage]} — revisa el summary de ambos intentos y el ls del directorio; la cadena no continúa con artefactos fantasma\\n" +
			'Intento 1: ' + intento1.slice(0, 200) + '\\n' +
			'Intento 2: ' + String(summaries["${s.stage}"] || "").slice(0, 200) + '\\n' +
			'$ ls -la ${planningDir}\\n' + (diag${i}.stdout || '(sin salida)'))
	}
}\nprevPaths = prevPaths.concat([planningDir + "/" + A${i}])${cp}`;
	})
	.join("")}

// ── Fan-out: una spec por historia ────────────────────────────────────────
phase("spec (fan-out por historia)")
const epics = await agent(
	"Read the epics-and-stories artifact at " + prevPaths[prevPaths.length - 1] + " and return ONLY a JSON object: { \\"stories\\": [{ \\"id\\": \\"E1-S1\\", \\"title\\": \\"...\\" }] } — every story id and title, nothing else.",
	{ label: "extract stories", outputSchema: { type: "object", properties: { stories: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } }, required: ["id", "title"] } } }, required: ["stories"] } }
)
const stories = (epics && epics.stories) || []
log("aidd-plan: " + stories.length + " historias para spec")
if (!stories.length) throw new Error("epics-and-stories no produjo historias legibles")

const specTasks = {}
stories.forEach(s => {
	specTasks[s.id] = () => agent(
		ctxFor("spec", SPEC_PROMPT, prevPaths) + "\\n\\n## Story to spec\\n" + s.id + ": " + s.title + "\\nWrite the spec to " + planningDir + "/spec-" + s.id + ".md",
		{ label: "spec " + s.id }
	)
})
const specs = await parallel("specs", specTasks)

return {
	project,
	idea,
	planningDir,
	stages: STAGES,
	summaries,
	stories: stories.map(s => s.id),
	specs,
}
`;
}
