// frida-understand-app — generador del script de workflow (issue #134, M1 Pista M).
//
// Genera el script JS determinista que corre en el sandbox de
// frida-extensible-workflows (agent/shell/parallel/checkpoint/phase/log).
// Los prompts (resueltos 3 capas por el resolver) se interpolan del lado del
// host; el script queda declarativo. Contrato de artefactos: los agentes
// ESCRIBEN a disco con sus tools de archivo y devuelven JSON (outputSchema) —
// la cadena de custodia es el filesystem (mismo contrato que M8).
//
// Estructura del script generado (fases estrictamente secuenciales):
//   bootstrap  — determinista: mkdir -p de docs/entendimiento/**, sonda de
//                capacidades híbrida (shell test -s del índice + const
//                CAPABILITIES interpolada host-side), fecha/epoch vía shell
//                (Date undefined), datos deterministas (ls/git log/manifiestos)
//                para el overview. Sin agente LLM.
//   overview   — 1 agente cartógrafo: confirma capacidades runtime
//                (index_status), levanta componentes/lenguajes/frameworks y
//                propone áreas de riesgo priorizadas (outputSchema areas[]).
//   hotspots   — fanout dinámico de scouts: corte de maxHotspots UNA vez
//                ANTES de construir tasks (D9), gate test -s por reporte +
//                reintento único informado. El wall-clock corta el
//                descubrimiento; las fases de entregable siempre corren.
//   analyze    — fanout de 3 escritores (entendimiento.md §Q1..§Q7,
//                mapa-riesgos.md, likec4/modelo.c4) sobre artefactos en disco.
//   synthesize — determinista: README.md + m4-m5-veredicto.md derivados del
//                MISMO inventario serializado (writer único, D10).
//   judge      — auditor detached PASS/CONCERNS/FAIL contra artefactos
//                reales + checkpoint final opcional (review manual).
//
// El inventario (docs/entendimiento/artifacts/inventory.json) es el registro
// auditable: run, capabilities, tools[] (disponibles/usadas/degradadas),
// degradations[], components[], hotspots[], questions[] (rúbrica 7 preguntas),
// stoppedBy/stoppedByTime — grep-verificable ex-post.

import type { ResolvedUnderstandAppStage } from "./resolver";
import {
	DEFAULT_ARTIFACT_LANGUAGE,
	UNDERSTAND_APP_ARTIFACTS_DIR,
	UNDERSTAND_APP_PREAMBLE,
	type UnderstandAppStage,
} from "./skills";

// ── Args ───────────────────────────────────────────────────────────────────

export interface UnderstandAppArgs {
	/** Tope de áreas de riesgo a scoutear: 0 = "todo" (sin tope). Requerido (D13). */
	maxHotspots: number;
	/** Backstop wall-clock en minutos: 0 = sin tope (D6/D13). */
	maxMinutes: number;
	/** Idioma (BCP-47) de los entregables. */
	language: string;
	review: "manual" | "auto";
}

/**
 * Capacidades del moat detectadas host-side en launch (D6): la resolución
 * flag→factory vive en el motor; el generador solo recibe el resultado como
 * datos declarativos (JSON-safe) y lo interpola al sandbox.
 */
export interface UnderstandAppCapabilities {
	/** pi-lens instalado (existsSync de la entry, misma sonda que pi-session). */
	lens: boolean;
	/** frida-codebase-index instalado Y habilitado (isInstalledAtPin + toggle). */
	codebaseIndex: boolean;
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

/**
 * Validación eager (molde validateAppWalkthroughArgs, workflow.ts:93). Sin
 * `url`: el target es el cwd del repo. maxHotspots es requerido A PROPÓSITO
 * (D13): la corrida es desatendida tras el launch, así que el presupuesto se
 * pregunta ANTES con ask_user_question en la sesión principal.
 */
export function validateUnderstandAppArgs(args: unknown): UnderstandAppArgs {
	const record = asRecord(args);
	if (record.maxHotspots === undefined) {
		throw new Error(
			'Patrón "understand-app": falta args.maxHotspots (entero 0-100; 0 = "todo"). Pregunta el presupuesto al usuario con ask_user_question en la sesión principal ANTES de lanzar (opciones: "10 hotspots", "todo" (= 0), o un número propio) y relanza el workflow con el valor resuelto — tras el launch la corrida es desatendida y no puede preguntar.',
		);
	}
	if (
		typeof record.maxHotspots !== "number" ||
		!Number.isInteger(record.maxHotspots) ||
		record.maxHotspots < 0 ||
		record.maxHotspots > 100
	) {
		throw new Error(
			'Patrón "understand-app": args.maxHotspots debe ser entero 0-100 (0 = sin tope).',
		);
	}
	if (
		record.maxMinutes !== undefined &&
		(typeof record.maxMinutes !== "number" ||
			!Number.isInteger(record.maxMinutes) ||
			record.maxMinutes < 1 ||
			record.maxMinutes > 240)
	) {
		throw new Error(
			'Patrón "understand-app": args.maxMinutes debe ser entero 1-240 (minutos) u omitirse.',
		);
	}
	return {
		maxHotspots: record.maxHotspots,
		maxMinutes: record.maxMinutes ?? 0,
		language: optionalString(record, "language") ?? DEFAULT_ARTIFACT_LANGUAGE,
		review: parseReview(record, "understand-app"),
	};
}

// ── Constantes interpoladas ────────────────────────────────────────────────

/** Catálogo declarativo del moat (10 tools) — available se resuelve en runtime. */
const MOAT_TOOL_CATALOG: ReadonlyArray<{
	name: string;
	extension: "pi-lens" | "frida-codebase-index";
}> = [
	{ name: "project_report", extension: "pi-lens" },
	{ name: "symbol_search", extension: "pi-lens" },
	{ name: "module_report", extension: "pi-lens" },
	{ name: "read_symbol", extension: "pi-lens" },
	{ name: "semantic_context", extension: "frida-codebase-index" },
	{ name: "semantic_search", extension: "frida-codebase-index" },
	{ name: "call_graph", extension: "frida-codebase-index" },
	{ name: "implementation_lookup", extension: "frida-codebase-index" },
	{ name: "index_codebase", extension: "frida-codebase-index" },
	{ name: "index_status", extension: "frida-codebase-index" },
];

/**
 * Rúbrica del día 1 — las 7 preguntas del día 1 de docs/modernization-apps.md
 * §7, normalizadas a forma de pregunta.
 */
export const DAY1_QUESTIONS: readonly string[] = [
	"¿Dónde se autentican los usuarios?",
	"¿Qué módulos llaman al servicio de pagos?",
	"¿Dónde se valida el estado de autenticación antes de una petición?",
	"¿Qué impacto tendría cambiar esta interfaz?",
	"¿Cuál es el flujo desde este endpoint hasta la base de datos?",
	"¿Qué implementaciones parecidas existen a este flujo?",
	"¿Qué código está muerto y nunca se llama?",
];

/** Escape de backslash/backtick/${ para interpolar strings en template literal. */
function lit(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("`", "\\`")
		.replaceAll("${", "\\${");
}

/** Emite las constantes de prompt del script (preamble no-stage + 4 stages). */
function stageConsts(stages: ResolvedUnderstandAppStage[]): string {
	const preamble = `\t// Preamble no-stage (D8): el veto de solo-lectura vive AQUÍ, fuera del\n\t// mapa de stages — un override 3-capas REEMPLAZA el prompt completo del\n\t// stage y no puede tocar esto.\n\tconst PREAMBLE = \`${lit(UNDERSTAND_APP_PREAMBLE)}\`;`;
	const names: Record<string, UnderstandAppStage> = {
		OVERVIEW: "overview",
		HOTSPOTS: "hotspots",
		ANALYZE: "analyze",
		JUDGE: "judge",
	};
	const lines = Object.entries(names).map(([constName, stage]) => {
		const found = stages.find((s) => s.stage === stage);
		if (!found) {
			throw new Error(
				`frida-understand-app: falta el stage '${stage}' en el resolver.`,
			);
		}
		return `\t// ${stage} — fuente del prompt: ${found.source}\n\tconst ${constName} = \`${lit(found.prompt)}\`;`;
	});
	return [preamble, ...lines].join("\n");
}

/**
 * Escritores del fanout de análisis: clave → archivo (relativo a
 * docs/entendimiento/) + brief de contenido. Se interpola al sandbox como
 * specs planas; el script las mapea a rutas con ART.
 */
const ANALYZE_WRITERS: ReadonlyArray<{
	key: string;
	file: string;
	brief: string;
}> = [
	{
		key: "entendimiento",
		file: "entendimiento.md",
		brief:
			"Entendimiento técnico del códigobase respondiendo las 7 preguntas del día 1 (secciones §Q1..§Q7, texto verbatim del inventario.questions). Cada respuesta: status (answered/partial/sin-evidencia), hallazgos que la sostienen con evidencia file:line (origen: artifacts/hotspots/), y qué faltó. 'Sin evidencia suficiente' es una respuesta válida y valiosa — nunca inventes rutas ni símbolos. Además del JSON de salida, devuelve questions[] con {id, status, evidence[]} por cada Q1..Q7 para sincronizar el inventario.",
	},
	{
		key: "riesgos",
		file: "mapa-riesgos.md",
		brief:
			"Mapa de riesgos priorizado (R01..) derivado de los hallazgos de los scouts: cada riesgo referencia su hotspot de origen (H01.. rastreable al inventario), severidad estimada, evidencia file:line y acción sugerida. Si un hotspot quedó 'sin evidencia suficiente', ese vacío ES un riesgo documentable. Nada que no esté en los hallazgos o el inventario.",
	},
	{
		key: "likec4",
		file: "likec4/modelo.c4",
		brief:
			"Modelo LikeC4 semilla en DSL válido: elementos (person, component, storage) desde inv.components (IDs C01..), relaciones desde las dependencias observadas en hallazgos/overview. Es un SEMILLA para tooling externo (§9.5): sin visualización ni refino — solo DSL sintácticamente válido con comentarios que citen la evidencia de cada elemento.",
	},
];

/** Genera el script del workflow `understand-app`. */
export function generateUnderstandAppWorkflow(
	stages: ResolvedUnderstandAppStage[],
	args: UnderstandAppArgs,
	capabilities: UnderstandAppCapabilities,
): string {
	return `// Patrón builtin: understand-app (frida-understand-app #134, M1 Pista M).
const maxHotspots = (args && typeof args.maxHotspots === "number" && args.maxHotspots >= 0 && args.maxHotspots <= 100) ? args.maxHotspots : ${JSON.stringify(args.maxHotspots)}
const maxMinutes = (args && typeof args.maxMinutes === "number" && args.maxMinutes >= 0 && args.maxMinutes <= 240) ? args.maxMinutes : ${JSON.stringify(args.maxMinutes)}
const language = (args && args.language) || ${JSON.stringify(args.language)}
const review = (args && (args.review === "manual" || args.review === "auto")) ? args.review : ${JSON.stringify(args.review)}
const ART = ${JSON.stringify(UNDERSTAND_APP_ARTIFACTS_DIR)}
const CAPABILITIES = ${JSON.stringify({ lens: capabilities.lens === true, codebaseIndex: capabilities.codebaseIndex === true })}
const TOOL_CATALOG = ${JSON.stringify(MOAT_TOOL_CATALOG)}
const QUESTIONS = ${JSON.stringify(DAY1_QUESTIONS)}
${stageConsts(stages)}
const OVERVIEW_SCHEMA = { type: "object", properties: { components: { type: "array", items: { type: "object", properties: { name: { type: "string" }, kind: { type: "string" }, path: { type: "string" }, purpose: { type: "string" }, entryPoints: { type: "array", items: { type: "string" } }, hubs: { type: "array", items: { type: "string" } } }, required: ["name", "path", "purpose"] } }, languages: { type: "array", items: { type: "string" } }, frameworks: { type: "array", items: { type: "string" } }, areas: { type: "array", items: { type: "object", properties: { name: { type: "string" }, why: { type: "string" }, priority: { type: "integer" }, hints: { type: "array", items: { type: "string" } } }, required: ["name", "why", "priority"] } }, toolsUsed: { type: "array", items: { type: "string" } }, degradations: { type: "array", items: { type: "object", properties: { phase: { type: "string" }, tool: { type: "string" }, reason: { type: "string" }, workaround: { type: "string" }, evidence: { type: "string" } }, required: ["reason"] } }, indexStatus: { type: "string" }, embeddingsProvider: { type: "string" }, summary: { type: "string" } }, required: ["components", "languages", "frameworks", "areas", "summary"] }
const SCOUT_SCHEMA = { type: "object", properties: { summary: { type: "string" }, findingsCount: { type: "integer" }, keyRisks: { type: "array", items: { type: "string" } }, unanswered: { type: "array", items: { type: "string" } }, toolsUsed: { type: "array", items: { type: "string" } }, degradations: { type: "array", items: { type: "object", properties: { phase: { type: "string" }, tool: { type: "string" }, reason: { type: "string" }, workaround: { type: "string" }, evidence: { type: "string" } }, required: ["reason"] } } }, required: ["summary"] }
const WRITER_SCHEMA = { type: "object", properties: { doc: { type: "string" }, sections: { type: "array", items: { type: "string" } }, questions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["answered", "partial", "sin-evidencia"] }, evidence: { type: "array", items: { type: "string" } } }, required: ["id", "status"] } }, summary: { type: "string" } }, required: ["doc", "summary"] }
const JUDGE_SCHEMA = { type: "object", properties: { decision: { type: "string", enum: ["PASS", "CONCERNS", "FAIL"] }, findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }, evidence: { type: "string" }, fix: { type: "string" } }, required: ["severity", "evidence", "fix"] } }, summary: { type: "string" } }, required: ["decision", "findings", "summary"] }

function wkCtx(prompt, blocks) {
	return PREAMBLE + "\\n\\n" + prompt + "\\n\\n---\\n\\n## Runtime context\\n" + blocks.join("\\n")
}

async function tryRun(command) {
	return await shell(command)
}
async function run(command) {
	const r = await shell(command)
	if (r.exitCode !== 0) throw new Error("shell falló (" + r.exitCode + "): " + command + " — " + String(r.stderr || "").slice(0, 500))
	return r.stdout
}
// Writer determinista (D10): heredoc con fence-guard — molde writeText de
// M8/frida-aidd. NADA más escribe README.md / m4-m5-veredicto.md / inventory.json.
async function writeText(path, content) {
	let text = String(content)
	if (text.indexOf("UA_EOF") >= 0) throw new Error("writeText: contenido no puede contener UA_EOF: " + path)
	if (text.charAt(text.length - 1) !== "\\n") text = text + "\\n"
	await run("mkdir -p $(dirname " + path + ")")
	const r = await tryRun("cat > " + path + " << 'UA_EOF'\\n" + text + "UA_EOF")
	if (r.exitCode !== 0) throw new Error("writeText falló: " + path + " — " + String(r.stderr || "").slice(0, 500))
}

// Quoting shell POSIX para rutas de reportes derivadas de nombres de áreas.
function shq(value) {
	return "'" + String(value).replace(/'/g, "'\\\\''") + "'"
}

async function epochNow() {
	return parseInt((await run("date +%s")).trim(), 10)
}

function outOf(r) {
	return String((r && r.stdout) || "").trim() || String((r && r.stderr) || "").trim()
}

// Slug ASCII [a-z0-9-] máx 24 para reportes de hotspots. Sin Intl en el
// sandbox — tabla manual de acentos (molde M8 slug()).
function slug(name) {
	const ACC = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n" }
	let s = String(name || "").toLowerCase()
	let out = ""
	for (let i = 0; i < s.length; i++) { const c = ACC[s.charAt(i)]; out += (c || s.charAt(i)) }
	out = out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
	return out || "area"
}

// Celda segura para tablas markdown.
function mdCell(value) {
	return String(value === null || value === undefined ? "" : value).replace(/\\|/g, "\\\\|")
}

function asArray(value) {
	return Array.isArray(value) ? value : []
}

// ── Inventario: writer único el script (registro auditable, D10) ───────────
const inv = {
	run: { pattern: "understand-app", language: language, maxHotspots: maxHotspots, maxMinutes: maxMinutes, review: review, startedAt: "", startedAtEpoch: 0, finishedAt: "" },
	capabilities: { lensAvailable: CAPABILITIES.lens, codebaseIndexAvailable: CAPABILITIES.codebaseIndex, indexPresent: false, indexStatus: "desconocido", embeddingsProvider: "" },
	tools: TOOL_CATALOG.map(function (t0) { return { name: t0.name, extension: t0.extension, available: t0.extension === "pi-lens" ? CAPABILITIES.lens : CAPABILITIES.codebaseIndex, usedCount: 0, phases: [], degraded: false } }),
	degradations: [],
	components: [],
	languages: [],
	frameworks: [],
	hotspots: [],
	questions: QUESTIONS.map(function (q, i) { return { id: "Q" + (i + 1), question: q, status: "sin-evidencia", evidence: [] } }),
	stoppedBy: "",
	stoppedByTime: false,
}
function invSerialize() {
	return JSON.stringify(inv, null, 2) + "\\n"
}
async function invWrite() {
	await writeText(ART + "/artifacts/inventory.json", invSerialize())
}

function toolByName(name) {
	for (let i = 0; i < inv.tools.length; i++) { if (inv.tools[i].name === String(name)) return inv.tools[i] }
	return null
}
function registerToolUse(names, phase) {
	asArray(names).forEach(function (n) {
		const t = toolByName(n)
		if (!t) return
		t.usedCount = t.usedCount + 1
		if (t.phases.indexOf(phase) === -1) t.phases.push(phase)
	})
}
function registerDegradations(list, phase) {
	asArray(list).forEach(function (d0) {
		if (!d0 || typeof d0 !== "object") return
		const d = { phase: String(d0.phase || phase), tool: String(d0.tool || ""), reason: String(d0.reason || ""), workaround: String(d0.workaround || ""), evidence: String(d0.evidence || "") }
		inv.degradations.push(d)
		const t = d.tool ? toolByName(d.tool) : null
		if (t) t.degraded = true
	})
}
function capabilitiesForPrompt() {
	const avail = inv.tools.filter(function (t) { return t.available }).map(function (t) { return t.name })
	const absent = inv.tools.filter(function (t) { return !t.available }).map(function (t) { return t.name })
	return JSON.stringify(inv.capabilities, null, 2) + "\\nTools disponibles: " + (avail.join(", ") || "(ninguna)") + "\\nTools NO disponibles: " + (absent.join(", ") || "(ninguna)")
}
function mergeQuestions(list) {
	asArray(list).forEach(function (q0) {
		if (!q0 || typeof q0 !== "object") return
		const id = String(q0.id || "")
		let existing = null
		for (let i = 0; i < inv.questions.length; i++) { if (inv.questions[i].id === id) { existing = inv.questions[i]; break } }
		if (!existing) return
		const status = String(q0.status || "")
		if (status === "answered" || status === "partial" || status === "sin-evidencia") existing.status = status
		existing.evidence = asArray(q0.evidence).map(function (e) { return String(e) })
	})
}
function questionCounts() {
	const c = { answered: 0, partial: 0, "sin-evidencia": 0 }
	inv.questions.forEach(function (q) { if (c[q.status] !== undefined) c[q.status] = c[q.status] + 1 })
	return c
}

log("understand-app: cwd [maxHotspots=" + (maxHotspots === 0 ? "todo" : maxHotspots) + (maxMinutes > 0 ? " maxMinutes=" + maxMinutes : "") + "]")

// ── bootstrap (determinista) ───────────────────────────────────────────────
phase("bootstrap")
// mkdir -p de TODOS los directorios AL ARRANQUE (lesson bffd6f1).
await run("mkdir -p " + ART + "/artifacts/hotspots " + ART + "/likec4")
// Sonda híbrida (D6): mitad shell (presencia física del índice), mitad const
// CAPABILITIES ya interpolada host-side; la confirmación funcional la hace
// el agente de overview ejercitando index_status (modo guía = isError).
inv.capabilities.indexPresent = (await shell("test -s .codebase-index/index/codebase.db")).exitCode === 0
// D5: si el toggle/instalación dejó sin codebase-index, la degradación se
// registra DETERMINISTAMENTE (no depende del reporte del LLM) y el hint
// accionable llega al cartógrafo en el runtime block del overview.
if (!CAPABILITIES.codebaseIndex) {
	registerDegradations([{ phase: "bootstrap", tool: "index_codebase", reason: "frida-codebase-index no disponible en las sesiones hijas (CAPABILITIES.codebaseIndex=false)", workaround: "verifica instalación/pin y el toggle frida.codebaseIndex.enabled", evidence: "const CAPABILITIES interpolada host-side en launch" }], "bootstrap")
}
inv.run.startedAt = (await run("date '+%Y-%m-%d %H:%M:%S %z'")).trim()
inv.run.startedAtEpoch = await epochNow()
const deadline = maxMinutes > 0 ? inv.run.startedAtEpoch + maxMinutes * 60 : 0
const rootListing = outOf(await tryRun("ls -la | head -c 6000")) || "(ls sin salida)"
const gitLog = outOf(await tryRun("git log --oneline -n 15 2>&1 | head -c 4000")) || "(sin git o sin commits)"
const manifests = outOf(await tryRun("ls package.json pyproject.toml go.mod Cargo.toml pom.xml build.gradle settings.gradle composer.json 2>/dev/null | head -c 2000")) || "(ninguno detectado)"
await invWrite()

// ── overview: cartógrafo (1 agente) ────────────────────────────────────────
phase("overview")
let areas = []
if (deadline > 0 && (await epochNow()) >= deadline) {
	inv.stoppedBy = "time"
	inv.stoppedByTime = true
	log("understand-app: deadline alcanzado antes del overview — se salta el descubrimiento")
	await invWrite()
} else {
	const ov = await agent(
		wkCtx(OVERVIEW, [
			"## Presupuesto\\n" + (maxHotspots === 0 ? "sin tope de hotspots (modo \\"todo\\")" : maxHotspots + " hotspots máx.") + (deadline > 0 ? " · deadline epoch " + deadline : ""),
			"## Capacidades detectadas (sonda híbrida — confirma runtime con index_status)\\n" + capabilitiesForPrompt() + "\\nÍndice presente en disco: " + (inv.capabilities.indexPresent ? "sí" : "no") + (CAPABILITIES.codebaseIndex ? "" : "\\nHint accionable: frida-codebase-index NO disponible según la sonda — ¿instalación/pin ausente o toggle frida.codebaseIndex.enabled apagado? Si index_status está registrada, ejercítala una vez: el modo guía (isError con guía de instalación) es una degradación a registrar, no un obstáculo. Continúa con lo que sí tengas (pi-lens + shell/read/grep)."),
			"## Datos deterministas del cwd\\n### ls -la\\n" + rootListing + "\\n### git log (últimos 15)\\n" + gitLog + "\\n### Manifiestos detectados\\n" + manifests,
			"## Inventario (fuente de verdad — léelo también de disco)\\nRuta: " + ART + "/artifacts/inventory.json\\n\\n" + invSerialize(),
			"## Idioma\\n" + language,
		]),
		{ label: "overview", outputSchema: OVERVIEW_SCHEMA }
	)
	inv.components = asArray(ov.components).map(function (c0, i) {
		return { id: "C" + String(i + 1).padStart(2, "0"), name: String(c0.name || ""), kind: String(c0.kind || ""), path: String(c0.path || ""), purpose: String(c0.purpose || ""), entryPoints: asArray(c0.entryPoints).map(String), hubs: asArray(c0.hubs).map(String) }
	})
	inv.languages = asArray(ov.languages).map(String)
	inv.frameworks = asArray(ov.frameworks).map(String)
	areas = asArray(ov.areas).filter(function (a0) { return a0 && typeof a0 === "object" && String(a0.name || "").trim() })
	if (ov.indexStatus) inv.capabilities.indexStatus = String(ov.indexStatus)
	if (ov.embeddingsProvider) inv.capabilities.embeddingsProvider = String(ov.embeddingsProvider)
	registerToolUse(ov.toolsUsed, "overview")
	registerDegradations(ov.degradations, "overview")
	await invWrite()
	log("understand-app: overview — " + inv.components.length + " componentes, " + areas.length + " áreas propuestas")
}

// ── hotspots: fanout dinámico de scouts (D9) ───────────────────────────────
phase("hotspots")
// Corte UNA vez, ANTES de construir tasks (D9): prioridad 1 = máxima.
const prioritized = areas.slice().sort(function (a, b) { return (Number(a.priority) || 5) - (Number(b.priority) || 5) })
const selected = maxHotspots > 0 ? prioritized.slice(0, maxHotspots) : prioritized
if (maxHotspots > 0 && prioritized.length > selected.length) {
	inv.stoppedBy = "budget"
	await invWrite()
	log("understand-app: corte de presupuesto — " + selected.length + " de " + prioritized.length + " áreas (maxHotspots=" + maxHotspots + ")")
}
const scouts = selected.map(function (a1, i) {
	return { id: "H" + String(i + 1).padStart(2, "0"), name: String(a1.name || ""), why: String(a1.why || ""), priority: Number(a1.priority) || 5, hints: asArray(a1.hints).map(String) }
})
scouts.forEach(function (s0) { s0.report = ART + "/artifacts/hotspots/" + s0.id + "-" + slug(s0.name) + ".md" })

// El wall-clock corta el DESCUBRIMIENTO; analyze/synthesize/judge siempre
// corren sobre lo alcanzado (el corte NO aborta — espejo M8).
if (scouts.length && deadline > 0 && (await epochNow()) >= deadline) {
	inv.stoppedBy = "time"
	inv.stoppedByTime = true
	log("understand-app: deadline alcanzado antes del fanout — se saltan los scouts")
	await invWrite()
} else if (scouts.length) {
	const scoutTasks = {}
	scouts.forEach(function (s1) {
		scoutTasks[s1.id] = function () {
			return agent(
				wkCtx(HOTSPOTS, [
					"## Área asignada\\n" + JSON.stringify(s1, null, 2),
					"## Tu reporte\\nRuta EXACTA donde escribir tus hallazgos: " + s1.report,
					"## Inventario (fuente de verdad — léelo también de disco)\\nRuta: " + ART + "/artifacts/inventory.json\\n\\n" + invSerialize(),
					"## Directorio de hermanos\\n" + ART + "/artifacts/hotspots/",
					"## Idioma\\n" + language,
				]),
				{ label: "hotspots " + s1.id, outputSchema: SCOUT_SCHEMA }
			)
		}
	})
	const scoutResults = await parallel("hotspots", scoutTasks)

	// Gate de artefacto por scout (lesson d203630) + reintento informado una
	// vez (lesson 619d9e7) — molde spec-retry de M8/frida-aidd.
	const scoutGate = "for f in " + scouts.map(function (s2) { return shq(s2.report) }).join(" ") + "; do test -s \\"$f\\" || echo \\"missing:$f\\"; done"
	let gate = await shell(scoutGate)
	if ((gate.stdout || "").trim()) {
		const missing = gate.stdout.trim().split("\\n").map(function (l) { return l.replace(/^missing:/, "") })
		log("understand-app: scouts sin escribir " + missing.join(", ") + " — reintento informado")
		const retryTasks = {}
		scouts.forEach(function (s3) {
			if (missing.indexOf(s3.report) === -1) return
			retryTasks[s3.id] = function () {
				return agent(
					wkCtx(HOTSPOTS, [
						"## Área asignada\\n" + JSON.stringify(s3, null, 2),
						"## Tu reporte\\nRuta EXACTA donde escribir tus hallazgos: " + s3.report,
						"## Inventario (fuente de verdad — léelo también de disco)\\nRuta: " + ART + "/artifacts/inventory.json\\n\\n" + invSerialize(),
						"## Directorio de hermanos\\n" + ART + "/artifacts/hotspots/",
						"## Idioma\\n" + language,
						"## FALLA ANTERIOR — última oportunidad\\nTu intento anterior NO escribió " + s3.report + " (verificado con test -s). Tu summary fue: \\"" + String((scoutResults[s3.id] && scoutResults[s3.id].summary) || "").slice(0, 300) + "\\"\\nESCRÍBELO de verdad ahora con tus file tools — sin el archivo en disco el stage falla.",
					]),
					{ label: "hotspots " + s3.id + " (reintento)", outputSchema: SCOUT_SCHEMA }
				)
			}
		})
		const retried = await parallel("hotspots-retry", retryTasks)
		Object.assign(scoutResults, retried)
		gate = await shell(scoutGate)
		if ((gate.stdout || "").trim()) {
			const diag = await shell("ls -la " + ART + "/artifacts/hotspots")
			throw new Error("understand-app: tras reintentos los scouts NO escribieron:\\n" + gate.stdout.trim() + "\\n$ ls -la " + ART + "/artifacts/hotspots\\n" + String(diag.stdout || diag.stderr || "(sin salida)"))
		}
	}

	// Registro SOLO de reportes que existen en disco (claims verificables).
	scouts.forEach(function (s4) {
		const r = scoutResults[s4.id] || {}
		inv.hotspots.push({ id: s4.id, name: s4.name, why: s4.why, priority: s4.priority, report: s4.report, status: "scouted", summary: String(r.summary || ""), keyRisks: asArray(r.keyRisks).map(String), unanswered: asArray(r.unanswered).map(String) })
		registerToolUse(r.toolsUsed, "hotspots")
		registerDegradations(r.degradations, "hotspots")
	})
	await invWrite()
	log("understand-app: " + inv.hotspots.length + " hotspots documentados")
} else {
	log("understand-app: sin áreas para scoutear (overview vacío o corte previo)")
}

// ── analyze: fan-out de 3 escritores sobre artefactos en disco (R6) ───────
phase("analyze")
const WRITER_SPECS = ${JSON.stringify(ANALYZE_WRITERS)}
const WRITERS = WRITER_SPECS.map(function (w0) { return { key: w0.key, file: ART + "/" + w0.file, brief: w0.brief } })
const writerTasks = {}
WRITERS.forEach(function (w1) {
	writerTasks[w1.key] = function () {
		return agent(
			wkCtx(ANALYZE, [
				"## Tu documento\\nRuta EXACTA donde escribirlo: " + w1.file,
				"## Especificación de contenido\\n" + w1.brief,
				"## Idioma\\n" + language,
				"## Inventario (fuente de verdad — léelo también de disco)\\nRuta: " + ART + "/artifacts/inventory.json\\n\\n" + invSerialize(),
				"## Hallazgos de los scouts\\nDirectorio: " + ART + "/artifacts/hotspots/\\nReportes: " + (inv.hotspots.map(function (h0) { return h0.report }).join(", ") || "(ninguno — documentalo explícitamente)"),
			]),
			{ label: "analyze " + w1.key, outputSchema: WRITER_SCHEMA }
		)
	}
})
const writerResults = await parallel("writers", writerTasks)

// Gate de artefacto por escritor + reintento informado una vez (molde M8).
const writerGate = "for f in " + WRITERS.map(function (w2) { return shq(w2.file) }).join(" ") + "; do test -s \\"$f\\" || echo \\"missing:$f\\"; done"
let wGate = await shell(writerGate)
if ((wGate.stdout || "").trim()) {
	const wMissing = wGate.stdout.trim().split("\\n").map(function (l) { return l.replace(/^missing:/, "") })
	log("understand-app: analyze sin escribir " + wMissing.join(", ") + " — reintento informado")
	const wRetryTasks = {}
	WRITERS.forEach(function (w3) {
		if (wMissing.indexOf(w3.file) === -1) return
		wRetryTasks[w3.key] = function () {
			return agent(
				wkCtx(ANALYZE, [
					"## Tu documento\\nRuta EXACTA donde escribirlo: " + w3.file,
					"## Especificación de contenido\\n" + w3.brief,
					"## Idioma\\n" + language,
					"## Inventario (fuente de verdad — léelo también de disco)\\nRuta: " + ART + "/artifacts/inventory.json\\n\\n" + invSerialize(),
					"## Hallazgos de los scouts\\nDirectorio: " + ART + "/artifacts/hotspots/\\nReportes: " + (inv.hotspots.map(function (h1) { return h1.report }).join(", ") || "(ninguno — documentalo explícitamente)"),
					"## FALLA ANTERIOR — última oportunidad\\nTu intento anterior NO escribió " + w3.file + " (verificado con test -s). Tu summary fue: \\"" + String((writerResults[w3.key] && writerResults[w3.key].summary) || "").slice(0, 300) + "\\"\\nESCRÍBELO de verdad ahora con tus file tools — sin el archivo en disco el stage falla.",
				]),
				{ label: "analyze " + w3.key + " (reintento)", outputSchema: WRITER_SCHEMA }
			)
		}
	})
	const wRetried = await parallel("writers-retry", wRetryTasks)
	Object.assign(writerResults, wRetried)
	wGate = await shell(writerGate)
	if ((wGate.stdout || "").trim()) {
		const diag = await shell("ls -la " + ART + " " + ART + "/likec4")
		throw new Error("understand-app: tras reintentos los escritores NO escribieron:\\n" + wGate.stdout.trim() + "\\n$ ls -la " + ART + " " + ART + "/likec4\\n" + String(diag.stdout || diag.stderr || "(sin salida)"))
	}
}
// Sincroniza el inventario con el estado de las 7 preguntas que reporta el
// escritor de entendimiento (optional en el schema; los demás no lo usan).
mergeQuestions(writerResults.entendimiento && writerResults.entendimiento.questions)
await invWrite()
log("understand-app: 3 documentos escritos")

// ── synthesize: README + m4-m5-veredicto deterministas (D10) ──────────────
phase("synthesize")
inv.run.finishedAt = (await run("date '+%Y-%m-%d %H:%M:%S %z'")).trim()
await invWrite()
const projectLabel = (await run("basename \\"$PWD\\"")).trim()
const qc = questionCounts()

// Veredicto M4/M5 preliminar determinista: SOLO derivado del inventario —
// un gap que no está en el inventario no puede aparecer aquí, y viceversa.
function m4m5Verdict() {
	const signals = []
	if (!inv.capabilities.lensAvailable) signals.push("pi-lens no disponible en las hijas — estructura/hubs sin grounding")
	if (!inv.capabilities.codebaseIndexAvailable) signals.push("frida-codebase-index no disponible — búsqueda semántica/call graph degradadas (¿instalación/pin ausente o toggle frida.codebaseIndex.enabled apagado?)")
	if (inv.capabilities.codebaseIndexAvailable && !inv.capabilities.indexPresent) signals.push("índice ausente en disco; index_status reporta: " + inv.capabilities.indexStatus)
	if (qc["sin-evidencia"] > 0) signals.push(qc["sin-evidencia"] + " de 7 preguntas sin evidencia suficiente")
	if (qc.partial > 0) signals.push(qc.partial + " de 7 preguntas parciales")
	if (inv.degradations.length) signals.push(inv.degradations.length + " degradaciones registradas")
	if (inv.stoppedBy) signals.push("corrida cortada por " + inv.stoppedBy + (inv.stoppedByTime ? " (wall-clock)" : ""))
	const coreMissing = !inv.capabilities.lensAvailable || !inv.capabilities.codebaseIndexAvailable
	let headline
	if (coreMissing || qc["sin-evidencia"] >= 4 || inv.degradations.length >= 3) {
		headline = "EL MOAT SE QUEDÓ CORTO — mantener M4 (evaluar/cancelar) y M5 (watchlist) abiertos"
	} else if (signals.length) {
		headline = "SUFICIENTE CON RESERVAS — M4 sigue en evaluar/cancelar y M5 en watchlist"
	} else {
		headline = "EL MOAT BASTÓ — recomendar cerrar M4 (cancelar) y dejar M5 en watchlist"
	}
	return { headline: headline, signals: signals }
}
const m4m5 = m4m5Verdict()

const md = []
md.push("# Entendimiento técnico — " + projectLabel)
md.push("")
md.push("> Generado por el patrón \`understand-app\` (frida-understand-app). FUENTE DE VERDAD: \`artifacts/inventory.json\`.")
md.push("")
md.push("## Corrida")
md.push("")
md.push("- Inicio: " + inv.run.startedAt + " · Fin: " + inv.run.finishedAt)
md.push("- Presupuesto: " + (maxHotspots === 0 ? "sin tope (todo)" : maxHotspots + " hotspots") + (maxMinutes > 0 ? " · " + maxMinutes + " min" : ""))
md.push("- Componentes: **" + inv.components.length + "** · Hotspots: **" + inv.hotspots.length + "**")
md.push("- Preguntas: " + qc.answered + " answered · " + qc.partial + " partial · " + qc["sin-evidencia"] + " sin evidencia")
md.push("- Corte: " + (inv.stoppedBy ? inv.stoppedBy + (inv.stoppedByTime ? " (wall-clock)" : "") : "sin corte registrado"))
md.push("")
md.push("## Capacidades del moat")
md.push("")
md.push("| Tool | Disponible | Usos | Degradada |")
md.push("| --- | --- | --- | --- |")
inv.tools.forEach(function (t1) {
	md.push("| \`" + t1.name + "\` | " + (t1.available ? "sí" : "no") + " | " + t1.usedCount + " | " + (t1.degraded ? "sí" : "no") + " |")
})
md.push("")
md.push("Índice presente: " + (inv.capabilities.indexPresent ? "sí" : "no") + " · index_status: " + inv.capabilities.indexStatus + " · embeddings: " + (inv.capabilities.embeddingsProvider || "desconocido"))
md.push("")
md.push("## Documentos")
md.push("")
md.push("| Documento | Contenido |")
md.push("| --- | --- |")
md.push("| [entendimiento.md](entendimiento.md) | §Q1..§Q7 con evidencia file:line |")
md.push("| [mapa-riesgos.md](mapa-riesgos.md) | Riesgos priorizados (origen H01..) |")
md.push("| [m4-m5-veredicto.md](m4-m5-veredicto.md) | ¿Bastó el moat? (preliminar) |")
md.push("| [likec4/modelo.c4](likec4/modelo.c4) | Modelo LikeC4 semilla |")
md.push("")
md.push("## Componentes")
md.push("")
md.push("| ID | Nombre | Tipo | Path | Propósito |")
md.push("| --- | --- | --- | --- | --- |")
inv.components.forEach(function (c1) {
	md.push("| " + c1.id + " | " + mdCell(c1.name) + " | " + mdCell(c1.kind) + " | " + mdCell(c1.path) + " | " + mdCell(c1.purpose) + " |")
})
md.push("")
md.push("## Hotspots")
md.push("")
md.push("| ID | Prioridad | Área | Reporte |")
md.push("| --- | --- | --- | --- |")
inv.hotspots.forEach(function (h2) {
	md.push("| " + h2.id + " | " + h2.priority + " | " + mdCell(h2.name) + " | [ver](" + h2.report.slice(ART.length + 1) + ") |")
})
md.push("")
md.push("## Las 7 preguntas del día 1")
md.push("")
md.push("| ID | Status | Pregunta | Evidencias |")
md.push("| --- | --- | --- | --- |")
inv.questions.forEach(function (q1) {
	md.push("| " + q1.id + " | " + q1.status + " | " + mdCell(q1.question) + " | " + q1.evidence.length + " |")
})
md.push("")
if (inv.degradations.length) {
	md.push("## Degradaciones")
	md.push("")
	inv.degradations.forEach(function (d1) {
		md.push("- [" + d1.phase + (d1.tool ? "/" + d1.tool : "") + "] " + mdCell(d1.reason) + (d1.workaround ? " — _" + mdCell(d1.workaround) + "_" : ""))
	})
	md.push("")
}
md.push("## Cómo leer")
md.push("")
md.push("- IDs estables: componentes \`C01..\`, hotspots \`H01..\`, preguntas \`Q1..Q7\`.")
md.push("- Cada afirmación de los documentos cita evidencia file:line localizable; los hallazgos crudos viven en \`artifacts/hotspots/\`.")
md.push("- \`m4-m5-veredicto.md\` es preliminar y determinista: se deriva SOLO del inventario.")
md.push("")
await writeText(ART + "/README.md", md.join("\\n"))

const vm = []
vm.push("# Veredicto preliminar M4/M5 — ¿bastó el moat?")
vm.push("")
vm.push("> " + m4m5.headline)
vm.push("")
vm.push("Decisión preliminar derivada deterministamente de \`artifacts/inventory.json\` (writer único). La decisión final de M4/M5 depende del piloto formal (fuera de alcance de esta corrida).")
vm.push("")
vm.push("## Señales (todas desde el inventario)")
vm.push("")
if (m4m5.signals.length) {
	m4m5.signals.forEach(function (s5) { vm.push("- " + s5) })
} else {
	vm.push("- Sin señales negativas: moat completo, 7/7 preguntas con evidencia y sin degradaciones.")
}
vm.push("")
vm.push("## Regla aplicada")
vm.push("")
vm.push("- Núcleo faltante (lens o codebase-index) O ≥4 preguntas sin evidencia O ≥3 degradaciones → mantener M4/M5 abiertos.")
vm.push("- Cualquier otra señal (preguntas parciales, corte, degradación puntual) → suficiente con reservas.")
vm.push("- Sin señales → el moat bastó; cerrar M4 y dejar M5 en watchlist.")
vm.push("")
vm.push("## Estado de la rúbrica")
vm.push("")
vm.push("| Status | Preguntas |")
vm.push("| --- | --- |")
vm.push("| answered | " + qc.answered + " |")
vm.push("| partial | " + qc.partial + " |")
vm.push("| sin-evidencia | " + qc["sin-evidencia"] + " |")
vm.push("")
await writeText(ART + "/m4-m5-veredicto.md", vm.join("\\n"))
log("understand-app: README.md + m4-m5-veredicto.md sintetizados desde el inventario")

// ── judge: auditor detached contra artefactos reales (R8) ─────────────────
phase("judge")
const judge = await agent(
	wkCtx(JUDGE, [
		"## Entregables a auditar (lee los archivos REALES)\\n- " + ART + "/README.md\\n- " + ART + "/entendimiento.md\\n- " + ART + "/mapa-riesgos.md\\n- " + ART + "/m4-m5-veredicto.md\\n- " + ART + "/likec4/modelo.c4\\n- " + ART + "/artifacts/inventory.json (fuente de verdad)\\n- " + ART + "/artifacts/hotspots/ (hallazgos crudos)",
		"## Inventario (claims base)\\n" + invSerialize(),
		"## Contexto de corte\\nstoppedBy=" + JSON.stringify(inv.stoppedBy) + " stoppedByTime=" + inv.stoppedByTime + " degradations=" + inv.degradations.length + " — un corte por presupuesto o tiempo (stoppedBy/stoppedByTime del inventario) es un gap CONOCIDO: repórtalo como CONCERNS con lo faltante, no como FAIL.",
	]),
	{ label: "judge", outputSchema: JUDGE_SCHEMA }
)
log("understand-app: judge=" + judge.decision + " findings=" + (judge.findings || []).length)

if (review === "manual") {
	const cp = await checkpoint({ name: "understand-app-final", prompt: "Entendimiento técnico listo en " + ART + " (" + inv.components.length + " componentes, " + inv.hotspots.length + " hotspots, 7 preguntas: " + qc.answered + "/" + qc.partial + "/" + qc["sin-evidencia"] + "). Juez: " + judge.decision + " con " + (judge.findings || []).length + " findings. ¿Apruebas para terminar?", context: { dir: ART, components: inv.components.length, hotspots: inv.hotspots.length, judge: judge.decision, findings: (judge.findings || []).length } })
	if (cp !== "approved") throw new Error("understand-app: checkpoint rechazado — workflow detenido")
}

return {
	pattern: "understand-app",
	language: language,
	maxHotspots: maxHotspots,
	maxMinutes: maxMinutes,
	components: inv.components.length,
	hotspots: inv.hotspots.length,
	questions: qc,
	degradations: inv.degradations.length,
	stoppedBy: inv.stoppedBy,
	stoppedByTime: inv.stoppedByTime,
	docs: { readme: ART + "/README.md", entendimiento: ART + "/entendimiento.md", riesgos: ART + "/mapa-riesgos.md", veredicto: ART + "/m4-m5-veredicto.md", likec4: ART + "/likec4/modelo.c4", inventory: ART + "/artifacts/inventory.json" },
	judge: judge,
}
`;
}
