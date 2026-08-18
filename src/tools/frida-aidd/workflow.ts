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
//
// Hardening v2 (#68):
//   - OUTPUT CONTRACT primero (primacy): ruta absoluta + prohibición de
//     dumpear el contenido inline — ataca el prd.md fantasma del Dev Host.
//   - Resume idempotente: si el artefacto de un stage ya existe, se preserva
//     y el agente se salta (relanzar es barato y NO pisa artefactos manuales).
//   - Gate por lote + reintento informado + expediente para las specs del
//     fan-out (misma clase de blindaje que #65/#67 para la cadena).
//   - Checkpoint pre-fan-out en manual: apruebas el gasto de N specs.

import { resolve } from "node:path";
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
		/** Cwd del proyecto (launch-time) — para rutas absolutas del contrato. */
		cwd?: string;
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
	const absDir = resolve(args.cwd ?? process.cwd(), planningDir);
	// Mapa stage→artefacto para el contrato de salida del script (JSON host-side).
	const artMap: Record<string, string> = {
		...Object.fromEntries(chain.map((s) => [s.stage, CHAIN_ARTIFACTS[s.stage]])),
		spec: "spec-<story-id>.md",
	};

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
const absDir = ${JSON.stringify(absDir)}
const review = (args && args.review) || "manual"
const STAGES = [${chain.map((s) => `"${s.stage}"`).join(", ")}]
${consts}
const ART = ${JSON.stringify(artMap)}

log("aidd-plan: " + project + " — " + STAGES.join(" → ") + " → spec(fan-out) [review=" + review + "]")

function ctxFor(stage, prompt, previous, artifact) {
	const art = artifact || (stage === "spec" ? ART["spec"] : ART[stage])
	return "## OUTPUT CONTRACT — READ FIRST\\n" +
		"You run headless. Your ONLY deliverable is the artifact FILE at:\\n" +
		"  " + absDir + "/" + art + "\\n" +
		"Write it with your file tools NOW. Your reply is ONLY a <=15-line summary\\n" +
		"(artifact path, key decisions, assumptions, open questions) —\\n" +
		"NEVER paste the artifact content inline.\\n\\n" +
		prompt + "\\n\\n---\\n\\n" +
		"## Runtime context\\n" +
		"Project: " + project + "\\n" +
		"Language for ALL artifacts: " + language + ".\\n" +
		"Artifacts directory: " + absDir + "\\n\\n" +
		"## Idea (verbatim)\\n" + idea + "\\n\\n" +
		"## Upstream artifacts (READ these files before working)\\n" +
		(previous.length ? previous.map(p => "- " + p).join("\\n") : "- (none — you are the first stage)") + "\\n\\n" +
		"## Reminder\\n" +
		"Write " + absDir + "/" + art + " now with your file tools — the file first, then the short summary reply."
}

// ── Cadena secuencial: resume idempotente + gate + reintento (#65/#67/#68) ──
const summaries = {}
let prevPaths = []
${chain
	.map((s, i) => {
		const cp =
			i < chain.length - 1
				? `\nif (review === "manual") {\n\tconst cp = await checkpoint({ name: "stage-${s.stage}", prompt: "Stage ${s.stage} listo. Revisa/edita ${CHAIN_ARTIFACTS[s.stage]} y aprueba para continuar (o rechaza con notas en la respuesta).", context: { artifact: absDir + "/" + A${i}, stage: "${s.stage}" } })\n\tif (cp !== "approved") throw new Error("stage ${s.stage}: checkpoint rechazado — workflow detenido")\n}`
				: "";
		return `\nphase("${s.stage}")\n// Resume idempotente (#68): si el artefacto ya existe (p. ej. escrito a mano\n// en un intento anterior), se PRESERVA y el agente del stage se omite.\nconst pre${i} = await shell("test -s ${planningDir}/${CHAIN_ARTIFACTS[s.stage]}")\nif (pre${i}.exitCode === 0) {\n\tsummaries["${s.stage}"] = "${CHAIN_ARTIFACTS[s.stage]} preservado — ya existía (resume idempotente #68)"\n\tlog("stage ${s.stage}: artefacto ya existe — preservado, agente omitido")\n} else {\n\tsummaries["${s.stage}"] = await agent(ctxFor(STAGES[${i}], P${i}, prevPaths), { label: "stage ${s.stage}" })\n\t// Gate de artefacto (#65): el contrato «escribe el archivo» del agente NO es garantía —\n\t// el prd.md fantasma probó que un summary sin archivo rompía la cadena aguas abajo.\n\tconst gate${i}a = await shell("test -s ${planningDir}/${CHAIN_ARTIFACTS[s.stage]}")\n\tif (gate${i}a.exitCode !== 0) {\n\t\t// Reintento informado (#67): el summary del intento 1 como evidencia ataca\n\t\t// la «completada mentirosa»; mismo prompt del stage + contexto del fracaso.\n\t\tlog("stage ${s.stage}: gate en rojo — reintento informado (#67)")\n\t\tconst intento1 = String(summaries["${s.stage}"] || "")\n\t\tsummaries["${s.stage}"] = await agent(ctxFor(STAGES[${i}], P${i}, prevPaths) +\n\t\t\t'\\n\\n## FALLA ANTERIOR — última oportunidad\\n' +\n\t\t\t'Tu intento anterior NO escribió ${planningDir}/${CHAIN_ARTIFACTS[s.stage]} (verificado con test -s).\\n' +\n\t\t\t'Tu summary fue: "' + intento1.slice(0, 400) + '"\\n' +\n\t\t\t'ESCRÍBELO de verdad ahora con tus file tools — sin el archivo en disco el stage falla.',\n\t\t\t{ label: "stage ${s.stage} (reintento)" })\n\t\tconst gate${i}b = await shell("test -s ${planningDir}/${CHAIN_ARTIFACTS[s.stage]}")\n\t\tif (gate${i}b.exitCode !== 0) {\n\t\t\t// Expediente (#67): ambos intentos + estado real del directorio para\n\t\t\t// diagnóstico inmediato (ruta equivocada / resumen sin escribir / nada).\n\t\t\tconst diag${i} = await shell("ls -la ${planningDir}")\n\t\t\tthrow new Error("stage ${s.stage}: tras 2 intentos el agente NO escribió ${planningDir}/${CHAIN_ARTIFACTS[s.stage]} — revisa el summary de ambos intentos y el ls del directorio; la cadena no continúa con artefactos fantasma\\n" +\n\t\t\t\t'Intento 1: ' + intento1.slice(0, 200) + '\\n' +\n\t\t\t\t'Intento 2: ' + String(summaries["${s.stage}"] || "").slice(0, 200) + '\\n' +\n\t\t\t\t'$ ls -la ${planningDir}\\n' + (diag${i}.stdout || diag${i}.stderr || "(sin salida)"))\n\t\t}\n\t}\n}\nprevPaths = prevPaths.concat([absDir + "/" + A${i}])${cp}`;
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

// Checkpoint pre-fan-out (#68): en manual apruebas el gasto de N agentes.
if (review === "manual") {
	const cp = await checkpoint({ name: "spec-fanout", prompt: stories.length + " historias detectadas — el fan-out generará " + stories.length + " specs (una por historia). Aprueba para continuar (o rechaza con notas en la respuesta).", context: { stage: "spec-fanout", stories: stories.map(s => s.id) } })
	if (cp !== "approved") throw new Error("spec-fanout: checkpoint rechazado — workflow detenido")
}

// Resume idempotente por spec (#68): una sola llamada ls detecta las existentes.
const specPre = await shell("ls " + planningDir + "/spec-*.md 2>/dev/null")
const specExisting = new Set(specPre.stdout.split("\\n").map(l => l.trim()).filter(Boolean))
const specTasks = {}
stories.forEach(s => {
	if (specExisting.has(planningDir + "/spec-" + s.id + ".md")) return
	specTasks[s.id] = () => agent(
		ctxFor("spec", SPEC_PROMPT, prevPaths, "spec-" + s.id + ".md") + "\\n\\n## Story to spec\\n" + s.id + ": " + s.title + "\\nWrite the spec to " + absDir + "/spec-" + s.id + ".md",
		{ label: "spec " + s.id }
	)
})
let specs = {}
if (Object.keys(specTasks).length) specs = await parallel("specs", specTasks)
else log("spec fan-out: todas las specs ya existen — preservadas (resume idempotente #68)")

// Gate por lote (#68): un solo shell compuesto (callsite estable, sin loops JS).
const specGate = await shell("for f in " + stories.map(s => planningDir + "/spec-" + s.id + ".md").join(" ") + "; do test -s $f || echo missing:$f; done")
if (specGate.stdout.trim()) {
	log("spec fan-out: specs fantasma — reintento informado (#68): " + specGate.stdout.trim().replace(/\\n/g, " "))
	const retryTasks = {}
	specGate.stdout.trim().split("\\n").forEach(line => {
		const path = line.replace(/^missing:/, "")
		const id = path.replace(/^.*spec-/, "").replace(/\\.md$/, "")
		const story = stories.find(x => x.id === id)
		if (!story) return
		retryTasks[id] = () => agent(
			ctxFor("spec", SPEC_PROMPT, prevPaths, "spec-" + id + ".md") + "\\n\\n## Story to spec\\n" + id + ": " + story.title + "\\nWrite the spec to " + absDir + "/spec-" + id + ".md" + "\\n\\n## FALLA ANTERIOR — última oportunidad\\nTu intento anterior NO escribió " + path + " (verificado con test -s). ESCRÍBELO de verdad ahora con tus file tools — sin el archivo en disco el stage falla.",
			{ label: "spec " + id + " (reintento)" }
		)
	})
	const retried = await parallel("spec-retry", retryTasks)
	Object.assign(specs, retried)
	const specRetryGate = await shell("for f in " + stories.map(s => planningDir + "/spec-" + s.id + ".md").join(" ") + "; do test -s $f || echo missing:$f; done")
	if (specRetryGate.stdout.trim()) {
		const specDiag = await shell("ls -la " + planningDir)
		throw new Error("spec fan-out: specs fantasma tras reintento (#68) — la cadena no continúa. Faltantes:\\n" + specRetryGate.stdout.trim() + "\\n$ ls -la " + planningDir + "\\n" + (specDiag.stdout || specDiag.stderr || "(sin salida)"))
	}
}

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
