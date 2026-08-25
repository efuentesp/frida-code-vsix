// frida-app-walkthrough — generador del script de workflow (issue #133, M8 Pista M).
//
// Genera el script JS determinista que corre en el sandbox de
// frida-extensible-workflows (agent/shell/parallel/checkpoint/phase/log).
// Los prompts (resueltos 3 capas por el resolver) se interpolan del lado del
// host; el script queda declarativo. Contrato de artefactos: los agentes
// ESCRIBEN a disco con sus tools de archivo y devuelven JSON (outputSchema) —
// la cadena de custodia es el filesystem (mismo contrato que frida-tea/aidd).
//
// Estructura del script generado (fases estrictamente secuenciales):
//   bootstrap  — determinista: mkdir -p de docs/funcional/**, gate de sesión
//                viva (pin --session), fecha/epoch vía shell (Date undefined),
//                open + wait inicial. Sin agente LLM.
//   explore    — loop "script navega, agente decide" (D3): snapshot → dedup
//                por origin canónico (sin query/fragment) → screenshot de
//                pantalla NUEVA (IDs estables P01.., padStart) → cortes de
//                presupuesto (maxScreens/maxMinutes/límite absoluto de pasos)
//                ANTES de gastar LLM → 1 agent() por paso interpreta la
//                pantalla y decide nextAction (click/form/validate/goto/done)
//                → el script la ejecuta vía shell(agent-browser --session …)
//                → wait → re-snapshot. El veto de irreversibles vive en
//                WALKTHROUGH_PREAMBLE (no-stage, D8).
//   analyze    — fan-out de 4 escritores (parallel) sobre artefactos en
//                disco (nunca navegación viva) + gate `test -s` por documento
//                con reintento informado una vez (lessons d203630/619d9e7).
//   synthesize — determinista: README.md + index.html self-contained desde
//                el MISMO inventario serializado (una sola fuente de verdad;
//                writer único el script, D9/D10).
//   judge      — auditor detached PASS/CONCERNS/FAIL contra artefactos
//                reales + checkpoint final opcional (review manual).
//
// El inventario (docs/funcional/artifacts/inventory.json) es el registro
// auditable: pantallas P01.., actionLog (manifiesto de acciones ejercidas),
// presupuesto, stoppedBy/stoppedByTime — grep-verificable ex-post.

import type { ResolvedWalkthroughStage } from "./resolver";
import {
	DEFAULT_ARTIFACT_LANGUAGE,
	DEFAULT_SESSION_NAME,
	WALKTHROUGH_ARTIFACTS_DIR,
	WALKTHROUGH_PREAMBLE,
	type WalkthroughStage,
} from "./skills";

// ── Args ───────────────────────────────────────────────────────────────────

export interface AppWalkthroughArgs {
	/** URL base de la app (requerida). */
	url: string;
	/** Tope de pantallas únicas: 0 = "todo" (sin tope). Requerido (D4). */
	maxScreens: number;
	/** Backstop wall-clock en minutos: 0 = sin tope (D6). */
	maxMinutes: number;
	/** Nombre de la sesión pre-autenticada (pin --session). */
	session: string;
	/** Idioma (BCP-47) de los entregables. */
	language: string;
	review: "manual" | "auto";
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
 * Validación eager (análogo validateTeaAutomateArgs, frida-tea/workflow.ts:104).
 * maxScreens es requerido A PROPÓSITO (D4): la corrida es desatendida tras el
 * launch (checkpoint booleano; ask_user_question solo en sesión principal),
 * así que el presupuesto se pregunta ANTES y llega ya resuelto en args.
 */
export function validateAppWalkthroughArgs(args: unknown): AppWalkthroughArgs {
	const record = asRecord(args);
	if (typeof record.url !== "string" || !record.url.trim()) {
		throw new Error(
			'Patrón "app-walkthrough" requiere args.url como string no vacío (la URL de la app, p. ej. https://app.ejemplo.com).',
		);
	}
	if (record.maxScreens === undefined) {
		throw new Error(
			'Patrón "app-walkthrough": falta args.maxScreens (entero 0-200; 0 = "todo"). Pregunta el presupuesto al usuario con ask_user_question en la sesión principal ANTES de lanzar (opciones: "30 pantallas", "todo" (= 0), o un número propio) y relanza el workflow con el valor resuelto — tras el launch la corrida es desatendida y no puede preguntar.',
		);
	}
	if (
		typeof record.maxScreens !== "number" ||
		!Number.isInteger(record.maxScreens) ||
		record.maxScreens < 0 ||
		record.maxScreens > 200
	) {
		throw new Error(
			'Patrón "app-walkthrough": args.maxScreens debe ser entero 0-200 (0 = sin tope).',
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
			'Patrón "app-walkthrough": args.maxMinutes debe ser entero 1-240 (minutos) u omitirse.',
		);
	}
	return {
		url: record.url,
		maxScreens: record.maxScreens,
		maxMinutes: record.maxMinutes ?? 0,
		session: optionalString(record, "session") ?? DEFAULT_SESSION_NAME,
		language: optionalString(record, "language") ?? DEFAULT_ARTIFACT_LANGUAGE,
		review: parseReview(record, "app-walkthrough"),
	};
}

// ── Interpolación ──────────────────────────────────────────────────────────

/** Escape de backslash/backtick/${ para interpolar strings en template literal. */
function lit(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("`", "\\`")
		.replaceAll("${", "\\${");
}

/** Emite las constantes de prompt del script (preamble no-stage + 3 stages). */
function stageConsts(stages: ResolvedWalkthroughStage[]): string {
	const preamble = `\t// Preamble no-stage (D8): el veto de irreversibles vive AQUÍ, fuera del\n\t// mapa de stages — un override 3-capas REEMPLAZA el prompt completo del\n\t// stage y no puede tocar esto.\n\tconst PREAMBLE = \`${lit(WALKTHROUGH_PREAMBLE)}\`;`;
	const names: Record<string, WalkthroughStage> = {
		EXPLORE: "explore",
		ANALYZE: "analyze",
		JUDGE: "judge",
	};
	const lines = Object.entries(names).map(([constName, stage]) => {
		const found = stages.find((s) => s.stage === stage);
		if (!found) {
			throw new Error(
				`frida-app-walkthrough: falta el stage '${stage}' en el resolver.`,
			);
		}
		return `\t// ${stage} — fuente del prompt: ${found.source}\n\tconst ${constName} = \`${lit(found.prompt)}\`;`;
	});
	return [preamble, ...lines].join("\n");
}

/**
 * Escritores del fanout de análisis: clave → archivo (relativo a
 * docs/funcional/) + brief de contenido. Se interpola al sandbox como specs
 * planas; el script las mapea a rutas con ART.
 */
const ANALYZE_WRITERS: ReadonlyArray<{
	key: string;
	file: string;
	brief: string;
}> = [
	{
		key: "catalogo",
		file: "catalogo-pantallas.md",
		brief:
			"Catálogo 1:1 de las pantallas del inventario (P01..Pnn): por cada pantalla — id, título, origen, propósito funcional, roles de usuario, elementos interactivos clave y link a su screenshot (relativo). Tabla índice al inicio. Nada que no esté en el inventario o en los snapshots.",
	},
	{
		key: "journeys",
		file: "journeys.md",
		brief:
			"Flujos de usuario (J01..) reconstruidos desde el actionLog del inventario: cada journey es una secuencia screenId→acción→resultado que la corrida ejerció de verdad (cítala por paso). Si el actionLog es pobre, documenta los flujos evidentes del catálogo y dilo explícitamente.",
	},
	{
		key: "reglas",
		file: "reglas-negocio.md",
		brief:
			"Reglas de negocio y validaciones (R01..) con evidencia: cada regla referencia el snapshot post-error (docs/funcional/artifacts/steps/*-validation.json) o el snapshot de la pantalla que la sugiere. Sin evidencia en disco → 'sin evidencia suficiente', no inventes la regla.",
	},
	{
		key: "roles",
		file: "roles-permisos.md",
		brief:
			"Roles y permisos (A01..): roles detectados por pantalla (userRoles del inventario), qué ve/hace cada quien, pantallas exclusivas de un rol. Si no hay evidencia de roles diferenciados, decláralo explícitamente ('sin evidencia suficiente') y documenta el acceso como usuario autenticado único.",
	},
];

/**
 * Tope absoluto de pasos del loop explore: guard anti-loop-infinito (un agente
 * que insista en refs stale o pantallas ya agotadas no cuelga la corrida).
 * 3 pasos por pantalla presupuestada, piso 30, tope 200 (modo "todo").
 */
function stepLimitFor(maxScreens: number): number {
	if (maxScreens <= 0) return 200;
	return Math.min(Math.max(30, maxScreens * 3), 200);
}

/** Genera el script del workflow `app-walkthrough`. */
export function generateAppWalkthroughWorkflow(
	stages: ResolvedWalkthroughStage[],
	args: AppWalkthroughArgs,
): string {
	const stepLimit = stepLimitFor(args.maxScreens);
	return `// Patrón builtin: app-walkthrough (frida-app-walkthrough #133, M8 Pista M).
const review = (args && args.review) || ${JSON.stringify(args.review)}
const url = (args && args.url) || ${JSON.stringify(args.url)}
const maxScreens = (args && typeof args.maxScreens === "number") ? args.maxScreens : ${JSON.stringify(args.maxScreens)}
const maxMinutes = (args && typeof args.maxMinutes === "number") ? args.maxMinutes : ${JSON.stringify(args.maxMinutes)}
const session = (args && args.session) || ${JSON.stringify(args.session)}
const language = (args && args.language) || ${JSON.stringify(args.language)}
const ART = ${JSON.stringify(WALKTHROUGH_ARTIFACTS_DIR)}
const STEP_LIMIT = ${JSON.stringify(stepLimit)}
${stageConsts(stages)}
const EXPLORE_SCHEMA = { type: "object", properties: { purpose: { type: "string" }, userRoles: { type: "array", items: { type: "string" } }, mainElements: { type: "array", items: { type: "string" } }, nextAction: { type: "object", properties: { kind: { type: "string", enum: ["click", "form", "validate", "goto", "done"] }, ref: { type: "string" }, url: { type: "string" }, fields: { type: "array", items: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } }, required: ["selector", "value"] } }, description: { type: "string" } }, required: ["kind", "description"] }, vetoed: { type: "array", items: { type: "string" } } }, required: ["purpose", "userRoles", "mainElements", "nextAction"] }
const WRITER_SCHEMA = { type: "object", properties: { doc: { type: "string" }, sections: { type: "array", items: { type: "string" } }, summary: { type: "string" } }, required: ["doc", "summary"] }
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
// Writer determinista (D9): heredoc con fence-guard — molde writeText de
// frida-aidd/ship.ts:134. NADA más escribe README.md / index.html / inventory.json.
async function writeText(path, content) {
	let text = String(content)
	if (text.indexOf("WK_EOF") >= 0) throw new Error("writeText: contenido no puede contener WK_EOF: " + path)
	if (text.charAt(text.length - 1) !== "\\n") text = text + "\\n"
	await run("mkdir -p $(dirname " + path + ")")
	const r = await tryRun("cat > " + path + " << 'WK_EOF'\\n" + text + "WK_EOF")
	if (r.exitCode !== 0) throw new Error("writeText falló: " + path + " — " + String(r.stderr || "").slice(0, 500))
}

// Quoting shell POSIX para selectores, URLs, valores y nombres (todo
// argumento posicional que pueda contener metacaracteres va quoted).
function shq(value) {
	return "'" + String(value).replace(/'/g, "'\\\\''") + "'"
}

// Comandos agent-browser: pin --session explícito en TODOS (seam decidido en
// research: la sesión pre-autenticada vive por nombre, no por instancia) y
// --json SIEMPRE explícito (vía shell() nadie lo inyecta por nosotros).
function ab(cmd) {
	return "agent-browser --session " + shq(session) + " " + cmd + " --json"
}
async function abRun(cmd) {
	const r = await shell(ab(cmd))
	let env = null
	try { env = JSON.parse(r.stdout) } catch (e) { env = null }
	if (r.exitCode !== 0 || !env || env.success !== true) {
		const detail = String((env && env.error && (env.error.message || env.error)) || r.stderr || r.stdout || "").slice(0, 300)
		throw new Error("agent-browser falló (" + cmd + "): exit=" + r.exitCode + " " + detail)
	}
	return env
}

// Slug ASCII [a-z0-9-] máx 24 para screenshots (lesson d397401: filenames
// es-MX no-ASCII). Sin Intl en el sandbox — tabla manual de acentos.
function slug(title) {
	const ACC = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n" }
	let s = String(title || "").toLowerCase()
	let out = ""
	for (let i = 0; i < s.length; i++) { const c = ACC[s.charAt(i)]; out += (c || s.charAt(i)) }
	out = out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
	return out || "pantalla"
}

// Celda segura para tablas markdown.
function mdCell(value) {
	return String(value === null || value === undefined ? "" : value).replace(/\\|/g, "\\\\|")
}

// Origin canónico: URL sin fragment NI query (vistas con ?q=/filtros son la
// misma pantalla; rutas con :id sí son pantallas distintas).
function canonOrigin(u) {
	return String(u || "").split("#")[0].split("?")[0]
}

// ── Inventario: writer único el script (registro auditable) ────────────────
const inv = {
	run: { pattern: "app-walkthrough", url: url, session: session, language: language, maxScreens: maxScreens, maxMinutes: maxMinutes, startedAt: "", startedAtEpoch: 0, finishedAt: "" },
	screens: [],
	actionLog: [],
	stoppedBy: "",
	stoppedByTime: false,
}
function invSerialize() {
	return JSON.stringify(inv, null, 2) + "\\n"
}
async function invWrite() {
	await writeText(ART + "/artifacts/inventory.json", invSerialize())
}

log("app-walkthrough: " + url + " [maxScreens=" + (maxScreens === 0 ? "todo" : maxScreens) + (maxMinutes > 0 ? " maxMinutes=" + maxMinutes : "") + " session=" + session + "]")

// ── bootstrap (determinista) ───────────────────────────────────────────────
phase("bootstrap")
// mkdir -p de TODOS los directorios AL ARRANQUE (lesson bffd6f1: la
// redirección bash NO auto-crea directorios padre).
await run("mkdir -p " + ART + "/artifacts/steps " + ART + "/screenshots")

// Gate de sesión viva (D12): si el nombre pinneado no está activo, el error
// instruye cómo pre-autenticar desde la sesión principal.
try {
	await abRun("get url")
} catch (e) {
	throw new Error("app-walkthrough: la sesión de navegador '" + session + "' no está viva. Autentica primero desde la sesión principal con agent_browser({args: [\\"--session\\", \\"" + session + "\\", \\"open\\", \\"" + url + "\\"]}) (o el comando agent-browser equivalente) y RELANZA este workflow. Detalle: " + String(e.message).slice(0, 200))
}
inv.run.startedAt = (await run("date '+%Y-%m-%d %H:%M:%S %z'")).trim()
inv.run.startedAtEpoch = parseInt((await run("date +%s")).trim(), 10)
const deadline = maxMinutes > 0 ? inv.run.startedAtEpoch + maxMinutes * 60 : 0
await invWrite()

await abRun("open " + shq(url))
await tryRun(ab("wait --load domcontentloaded"))

// ── explore: script navega, agente decide (D3) ─────────────────────────────
phase("explore")
let steps = 0
let done = false
while (!done) {
	steps = steps + 1
	const stepTag = ("00" + steps).slice(-3)

	// 1. Snapshot de la pantalla actual → disco (cadena de custodia) + memoria.
	const snapPath = ART + "/artifacts/steps/" + stepTag + "-snapshot.json"
	const snapR = await shell(ab("snapshot -i") + " > " + snapPath)
	if (snapR.exitCode !== 0) throw new Error("app-walkthrough: snapshot falló en paso " + steps + " — " + String(snapR.stderr || "").slice(0, 300) + " (¿sigue viva la sesión '" + session + "'?)")
	const snapText = await run("head -c 24000 " + snapPath)
	// 1b. El prompt del intérprete recibe el data del envelope (cuerpo a11y +
	// tabla de refs, como su prompt describe), no el sobre completo; fallback
	// al crudo truncado si el parse falla.
	let snapForPrompt = snapText
	try {
		const snapFull = await run("cat " + snapPath)
		const sj = JSON.parse(snapFull)
		if (sj && sj.data) snapForPrompt = JSON.stringify(sj.data).slice(0, 24000)
	} catch (e2) { snapForPrompt = snapText }

	// 2. Identidad de la pantalla + dedup por origin canónico.
	const urlR = await abRun("get url")
	const titleR = await abRun("get title")
	const origin = String((urlR && urlR.data) || "")
	const title = String((titleR && titleR.data) || "")
	const canon = canonOrigin(origin)
	let screen = null
	for (let si = 0; si < inv.screens.length; si++) {
		if (inv.screens[si].canon === canon) { screen = inv.screens[si]; break }
	}
	const isNew = !screen

	// 3. Cortes de presupuesto ANTES de gastar LLM (D7): la pantalla que
	// rebasa el tope no se registra ni se interpreta.
	if (maxScreens > 0 && inv.screens.length >= maxScreens) { inv.stoppedBy = "budget"; break }
	if (deadline > 0) {
		const nowEpoch = parseInt((await run("date +%s")).trim(), 10)
		if (nowEpoch >= deadline) { inv.stoppedBy = "time"; inv.stoppedByTime = true; break }
	}
	if (steps >= STEP_LIMIT) { inv.stoppedBy = "stepLimit"; break }

	// 4. Registro de pantalla nueva: ID estable P01.. (padStart sin colisiones
	// en n≥100) + screenshot nombrado por ID (D10).
	if (isNew) {
		const id = "P" + String(inv.screens.length + 1).padStart(2, "0")
		const shot = ART + "/screenshots/" + id + "-" + slug(title) + ".png"
		const shotR = await tryRun(ab("screenshot " + shq(shot)))
		screen = { id: id, canon: canon, origin: origin, title: title, firstSeenStep: steps, snapshot: snapPath, screenshot: shotR.exitCode === 0 ? shot : "", purpose: "", userRoles: [], mainElements: [], validationEvidence: [] }
		inv.screens.push(screen)
		if (shotR.exitCode !== 0) log("app-walkthrough: screenshot falló para " + id + " — el juez lo reportará")
		await invWrite()
	}

	// 5. UN agente por paso: interpreta la pantalla y decide la siguiente
	// acción (contexto fresco; presupuesto visible).
	const interp = await agent(
		wkCtx(EXPLORE, [
			"## Paso\\n" + steps + " de " + STEP_LIMIT + (deadline > 0 ? " (deadline epoch " + deadline + ")" : ""),
			"## Presupuesto\\n" + (maxScreens === 0 ? "sin tope de pantallas (modo \\"todo\\")" : inv.screens.length + "/" + maxScreens + " pantallas únicas registradas"),
			"## Pantalla actual\\n" + (isNew ? "NUEVA — registrada como " + screen.id : "ya registrada (" + screen.id + ")") + "\\norigin: " + origin + "\\ntítulo: " + title,
			"## Inventario de pantallas registradas\\n" + (inv.screens.map(function (s2) { return s2.id + " · " + s2.title + " · " + s2.canon }).join("\\n") || "(ninguna)"),
			"## Snapshot actual (truncado a 24 KB; completo en " + snapPath + ")\\n" + snapForPrompt,
		]),
		{ label: "explore paso " + steps, outputSchema: EXPLORE_SCHEMA }
	)

	if (isNew || !screen.purpose) {
		screen.purpose = String(interp.purpose || "")
		screen.userRoles = interp.userRoles || []
		screen.mainElements = interp.mainElements || []
	}

	// 6. Ejecutar la acción decidida (script navega; veto vive en PREAMBLE).
	const act = (interp && interp.nextAction) || { kind: "done", description: "(sin acción)" }
	let outcome = "ok"
	if (act.kind === "done") {
		inv.stoppedBy = "done"
		done = true
	} else {
		try {
			if (act.kind === "click") {
				await abRun("click " + shq(act.ref))
			} else if (act.kind === "goto") {
				await abRun("open " + shq(act.url))
			} else if (act.kind === "form" || act.kind === "validate") {
				const fields = act.fields || []
				for (let fi = 0; fi < fields.length; fi++) {
					await abRun("fill " + shq(fields[fi].selector) + " " + shq(fields[fi].value))
				}
				await abRun("click " + shq(act.ref))
				await tryRun(ab("wait --load domcontentloaded"))
				if (act.kind === "validate") {
					// D11: snapshot post-error persistido como evidencia de las
					// reglas de validación — el escritor de reglas lo cita.
					const valPath = ART + "/artifacts/steps/" + stepTag + "-validation.json"
					const valR = await shell(ab("snapshot -i") + " > " + valPath)
					if (valR.exitCode === 0) screen.validationEvidence.push(valPath)
				}
			} else {
				outcome = "unknown-kind:" + act.kind
			}
		} catch (e) {
			outcome = "fail: " + String(e.message).slice(0, 200)
		}
	}
	inv.actionLog.push({ step: steps, screenId: screen.id, kind: act.kind, description: act.description || "", ref: act.ref || "", url: act.url || "", outcome: outcome })
	await invWrite()
	if (act.kind !== "done") await tryRun(ab("wait --load domcontentloaded"))
}
inv.run.finishedAt = (await run("date '+%Y-%m-%d %H:%M:%S %z'")).trim()
await invWrite()
log("app-walkthrough: explore terminó — " + inv.screens.length + " pantallas únicas en " + steps + " pasos; stoppedBy=" + JSON.stringify(inv.stoppedBy))
if (!inv.screens.length) throw new Error("app-walkthrough: la exploración no registró ninguna pantalla — revisa que la sesión '" + session + "' esté viva y que " + url + " cargue (evidencia: " + ART + "/artifacts/steps/001-snapshot.json)")

// ── analyze: fan-out de 4 escritores sobre artefactos en disco (R5) ───────
phase("analyze")
const WRITER_SPECS = ${JSON.stringify(ANALYZE_WRITERS)}
const WRITERS = WRITER_SPECS.map(function (w0) { return { key: w0.key, file: ART + "/" + w0.file, brief: w0.brief } })
const tasks = {}
WRITERS.forEach(function (w) {
	tasks[w.key] = function () {
		return agent(
			wkCtx(ANALYZE, [
				"## Tu documento\\nRuta EXACTA donde escribirlo: " + w.file,
				"## Especificación de contenido\\n" + w.brief,
				"## Idioma\\n" + language,
				"## Inventario (fuente de verdad — léelo también de disco)\\nRuta: " + ART + "/artifacts/inventory.json\\n\\n" + invSerialize(),
				"## Evidencia cruda\\nSnapshots por paso y validaciones post-error: " + ART + "/artifacts/steps/\\nScreenshots por pantalla: " + ART + "/screenshots/",
			]),
			{ label: "analyze " + w.key, outputSchema: WRITER_SCHEMA }
		)
	}
})
const writerResults = await parallel("writers", tasks)

// Gate de artefacto por escritor (lesson d203630) + reintento informado una
// vez (lesson 619d9e7) — molde spec-retry de frida-aidd.
const gateCmd = "for f in " + WRITERS.map(function (w) { return w.file }).join(" ") + "; do test -s \\"$f\\" || echo \\"missing:$f\\"; done"
let gate = await shell(gateCmd)
if ((gate.stdout || "").trim()) {
	const missing = gate.stdout.trim().split("\\n").map(function (l) { return l.replace(/^missing:/, "") })
	log("app-walkthrough: analyze sin escribir " + missing.join(", ") + " — reintento informado")
	const retryTasks = {}
	WRITERS.forEach(function (w) {
		if (missing.indexOf(w.file) === -1) return
		retryTasks[w.key] = function () {
			return agent(
				wkCtx(ANALYZE, [
					"## Tu documento\\nRuta EXACTA donde escribirlo: " + w.file,
					"## Especificación de contenido\\n" + w.brief,
					"## Idioma\\n" + language,
					"## Inventario (fuente de verdad — léelo también de disco)\\nRuta: " + ART + "/artifacts/inventory.json\\n\\n" + invSerialize(),
					"## Evidencia cruda\\nSnapshots por paso y validaciones post-error: " + ART + "/artifacts/steps/\\nScreenshots por pantalla: " + ART + "/screenshots/",
					"## FALLA ANTERIOR — última oportunidad\\nTu intento anterior NO escribió " + w.file + " (verificado con test -s). Tu summary fue: \\"" + String((writerResults[w.key] && writerResults[w.key].summary) || "").slice(0, 300) + "\\"\\nESCRÍBELO de verdad ahora con tus file tools — sin el archivo en disco el stage falla.",
				]),
				{ label: "analyze " + w.key + " (reintento)", outputSchema: WRITER_SCHEMA }
			)
		}
	})
	const retried = await parallel("writers-retry", retryTasks)
	Object.assign(writerResults, retried)
	gate = await shell(gateCmd)
	if ((gate.stdout || "").trim()) {
		const diag = await shell("ls -la " + ART)
		throw new Error("app-walkthrough: tras reintentos los escritores NO escribieron:\\n" + gate.stdout.trim() + "\\n$ ls -la " + ART + "\\n" + String(diag.stdout || diag.stderr || "(sin salida)"))
	}
}
log("app-walkthrough: 4 documentos escritos")

// ── synthesize: README + index.html deterministas (writer único, D9) ──────
phase("synthesize")
const appTitle = inv.screens.length ? (inv.screens[0].title || url) : url
const md = []
md.push("# Documentación funcional — " + appTitle)
md.push("")
md.push("> Generada por el patrón \`app-walkthrough\` (frida-app-walkthrough) — el agente usó la app como usuario y documentó lo observado. FUENTE DE VERDAD: \`artifacts/inventory.json\`.")
md.push("")
md.push("## Corrida")
md.push("")
md.push("- App: " + url)
md.push("- Sesión de navegador: \`" + session + "\` (pre-autenticada por el usuario)")
md.push("- Inicio: " + inv.run.startedAt + " · Fin: " + inv.run.finishedAt)
md.push("- Presupuesto: " + (maxScreens === 0 ? "sin tope (todo)" : maxScreens + " pantallas") + (maxMinutes > 0 ? " · " + maxMinutes + " min" : ""))
md.push("- Pantallas únicas: **" + inv.screens.length + "** en " + steps + " pasos")
md.push("- Corte: " + (inv.stoppedBy === "done" ? "el explorador decidió \`done\` (app cubierta)" : inv.stoppedBy === "budget" ? "tope de pantallas alcanzado" : inv.stoppedBy === "time" ? "límite de tiempo alcanzado (stoppedByTime)" : inv.stoppedBy === "stepLimit" ? "límite de pasos alcanzado" : "sin corte registrado"))
md.push("")
md.push("## Documentos")
md.push("")
md.push("| Documento | Contenido |")
md.push("| --- | --- |")
md.push("| [catalogo-pantallas.md](catalogo-pantallas.md) | Catálogo de pantallas (P01..) |")
md.push("| [journeys.md](journeys.md) | Flujos de usuario (J01..) |")
md.push("| [reglas-negocio.md](reglas-negocio.md) | Reglas y validaciones (R01..) |")
md.push("| [roles-permisos.md](roles-permisos.md) | Roles y permisos (A01..) |")
md.push("| [index.html](index.html) | Dashboard visual autónomo |")
md.push("")
md.push("## Pantallas")
md.push("")
md.push("| ID | Título | Origen | Screenshot |")
md.push("| --- | --- | --- | --- |")
inv.screens.forEach(function (s3) {
	md.push("| " + s3.id + " | " + mdCell(s3.title) + " | " + mdCell(s3.canon) + " | " + (s3.screenshot ? "[ver](" + s3.screenshot.slice(ART.length + 1) + ")" : "—") + " |")
})
md.push("")
md.push("## Cómo leer")
md.push("")
md.push("- IDs estables: pantallas \`P01..\`, journeys \`J01..\`, reglas \`R01..\`, roles \`A01..\`.")
md.push("- Cada afirmación de los documentos cita evidencia en \`artifacts/steps/\` (snapshots crudos por paso).")
md.push("- Dashboard: abre \`index.html\` en un navegador (autónomo, sin assets externos).")
md.push("")
await writeText(ART + "/README.md", md.join("\\n"))

// index.html self-contained: CSS inline + datos JSON embebidos + render
// vanilla con createElement (sin assets externos, sin strings HTML citados).
// "</" se escapa en el JSON embebido para no romper el <script> del HTML.
const escHtml = function (v) {
	return String(v === null || v === undefined ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
const dataJson = JSON.stringify({ run: inv.run, screens: inv.screens.map(function (s4) { return { id: s4.id, title: s4.title, canon: s4.canon, origin: s4.origin, purpose: s4.purpose, userRoles: s4.userRoles, screenshot: s4.screenshot ? s4.screenshot.slice(ART.length + 1) : "" } }), actionLog: inv.actionLog, stoppedBy: inv.stoppedBy, stoppedByTime: inv.stoppedByTime }).split("</").join("<\\\\/")
const html = []
html.push("<!DOCTYPE html>")
html.push("<html lang=\\"" + escHtml(language) + "\\"><head><meta charset=\\"utf-8\\">")
html.push("<title>" + escHtml(appTitle) + " — walkthrough</title>")
html.push("<style>")
html.push("body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#0f1117;color:#e6e8ee}")
html.push("header{padding:24px 32px;background:linear-gradient(135deg,#1b2340,#0f1117)}")
html.push("h1{margin:0 0 4px;font-size:22px}header p{margin:0;color:#9aa3b5;font-size:13px}")
html.push(".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:24px 32px}")
html.push(".card{background:#161a26;border:1px solid #232a3d;border-radius:10px;overflow:hidden}")
html.push(".card img{width:100%;height:140px;object-fit:cover;object-position:top;background:#0b0d13}")
html.push(".card .body{padding:12px 14px}.card h3{margin:0 0 4px;font-size:14px}.card .meta{color:#9aa3b5;font-size:11px;word-break:break-all}")
html.push("</style></head><body>")
html.push("<header><h1>" + escHtml(appTitle) + "</h1><p id=\\"meta\\"></p></header>")
html.push("<div class=\\"grid\\" id=\\"grid\\"></div>")
html.push("<script>var DATA = " + dataJson + ";")
html.push("document.getElementById('meta').textContent = DATA.run.url + ' · ' + DATA.screens.length + ' pantallas · ' + (DATA.stoppedBy === 'done' ? 'recorrido completo' : 'corte: ' + DATA.stoppedBy);")
html.push("var g = document.getElementById('grid');")
html.push("DATA.screens.forEach(function (s) {")
html.push("  var c = document.createElement('div'); c.className = 'card';")
html.push("  if (s.screenshot) { var img = document.createElement('img'); img.src = s.screenshot; img.loading = 'lazy'; img.alt = s.id; c.appendChild(img); }")
html.push("  var b = document.createElement('div'); b.className = 'body';")
html.push("  var h = document.createElement('h3'); h.textContent = s.id + ' · ' + s.title; b.appendChild(h);")
html.push("  var m = document.createElement('div'); m.className = 'meta'; m.textContent = s.canon; b.appendChild(m);")
html.push("  c.appendChild(b); g.appendChild(c);")
html.push("});")
html.push("</script></body></html>")
await writeText(ART + "/index.html", html.join("\\n"))
log("app-walkthrough: README.md + index.html sintetizados desde el inventario")

// ── judge: auditor detached contra artefactos reales (R7) ─────────────────
phase("judge")
const judge = await agent(
	wkCtx(JUDGE, [
		"## Entregables a auditar (lee los archivos REALES)\\n- " + ART + "/README.md\\n- " + ART + "/index.html\\n- " + ART + "/catalogo-pantallas.md\\n- " + ART + "/journeys.md\\n- " + ART + "/reglas-negocio.md\\n- " + ART + "/roles-permisos.md\\n- " + ART + "/artifacts/inventory.json (fuente de verdad)\\n- " + ART + "/screenshots/ y " + ART + "/artifacts/steps/ (evidencia cruda)",
		"## Inventario (claims base)\\n" + invSerialize(),
		"## Contexto de corte\\nstoppedBy=" + JSON.stringify(inv.stoppedBy) + " stoppedByTime=" + inv.stoppedByTime + " — un corte por presupuesto o tiempo (stoppedByTime del inventario) es un gap CONOCIDO: repórtalo como CONCERNS con lo faltante, no como FAIL.",
	]),
	{ label: "judge", outputSchema: JUDGE_SCHEMA }
)
log("app-walkthrough: judge=" + judge.decision + " findings=" + (judge.findings || []).length)

if (review === "manual") {
	const cp = await checkpoint({ name: "walkthrough-final", prompt: "Documentación funcional lista en " + ART + " (" + inv.screens.length + " pantallas, 4 documentos + README + dashboard). Juez: " + judge.decision + " con " + (judge.findings || []).length + " findings. ¿Apruebas para terminar?", context: { dir: ART, screens: inv.screens.length, judge: judge.decision, findings: (judge.findings || []).length } })
	if (cp !== "approved") throw new Error("app-walkthrough: checkpoint rechazado — workflow detenido")
}

return {
	url: url,
	session: session,
	language: language,
	screens: inv.screens.length,
	steps: steps,
	stoppedBy: inv.stoppedBy,
	stoppedByTime: inv.stoppedByTime,
	docs: { readme: ART + "/README.md", dashboard: ART + "/index.html", catalogo: ART + "/catalogo-pantallas.md", journeys: ART + "/journeys.md", reglas: ART + "/reglas-negocio.md", roles: ART + "/roles-permisos.md", inventory: ART + "/artifacts/inventory.json" },
	judge: judge,
}
`;
}
