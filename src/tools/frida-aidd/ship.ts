// frida-aidd — generador del script del workflow aidd-ship (issue #38,
// ADR-0050 piezas 3-7, Lote 2: fase ship).
//
// Loop determinista por historia (motor de bmad-loop adaptado al sandbox de
// frida-extensible-workflows): dev desechable → lie-detector (diff vs commit
// baseline) → review acotado → verify determinista → commit del ORQUESTADOR.
// El LLM jamás decide el flujo ni escribe el estado: sprint-status.yaml tiene
// un único writer (este script) con transiciones never-regress, y el ledger
// deferred-work sólo lo toca el orquestador.
//
// Disciplina del script generado: sin backticks ni ${ literales (se interpola
// en un template del host); los prompts llegan como consts interpoladas.

import { SPRINT_STATUS_LIB } from "./sprint-status";

export interface AiddShipArgs {
	sprint?: string;
	review?: "manual" | "auto";
	/** Sweeps máximos sobre el ledger deferred (default 2). */
	maxSweeps?: number;
}

/** Escape de backslash/backtick/${ para interpolar en template literal. */
function lit(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("`", "\\`")
		.replaceAll("${", "\\${");
}

export function validateAiddShipArgs(args: unknown): AiddShipArgs {
	const record =
		args && typeof args === "object" && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: {};
	if (
		record.review !== undefined &&
		record.review !== "manual" &&
		record.review !== "auto"
	) {
		throw new Error(
			'Patrón "aidd-ship": args.review debe ser "manual" o "auto".',
		);
	}
	if (record.maxSweeps !== undefined) {
		const m = record.maxSweeps;
		if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m > 5) {
			throw new Error(
				'Patrón "aidd-ship": args.maxSweeps debe ser entero 0-5.',
			);
		}
	}
	return {
		...(typeof record.sprint === "string" && record.sprint.trim()
			? { sprint: record.sprint }
			: {}),
		...(record.review ? { review: record.review as "manual" | "auto" } : {}),
		...(typeof record.maxSweeps === "number"
			? { maxSweeps: record.maxSweeps }
			: {}),
	};
}

const DEV_PROMPT = `You are the DEV agent of an AiDD ship loop (BMAD adapted; you run headless in a disposable session). Implement the story spec below with your file tools, in the repository at the session cwd.

Rules:
- The SPEC is FROZEN: implement exactly what it says. Do NOT edit anything under docs/aidd/ (specs, planning, sprint-status, deferred-ledger) — the orchestrator owns those files and verifies their integrity.
- Keep changes minimal and consistent with the codebase conventions.
- If you hit a NON-BLOCKING impediment (pre-existing unrelated breakage, missing upstream piece), CONTINUE the story and report it under deferred — do not expand scope.
- If you truly cannot complete the story, set storyComplete=false and explain why in summary (with deferred entries if applicable).

Your claims are verified against git (lie-detector): filesTouched must list ONLY files you actually changed or created, relative to the repo root. Claiming files that show no diff fails the story.`;

const REWORK_PROMPT = `You previously reported files as changed that show NO diff against the baseline — the claim did not survive the lie-detector. Implement the work FOR REAL now, with your file tools. Every file you list in filesTouched must appear in the git diff. The SPEC is FROZEN (do not edit docs/aidd/).`;

const REVIEW_PROMPT = `You are a senior code reviewer in an AiDD ship loop. Review the diff below for the story against its frozen SPEC.

Verdict APPROVE only if the diff satisfies the spec's capabilities while respecting its constraints and non-goals. Otherwise CONCERNS with concrete, actionable notes (file:line). Scope creep beyond the spec and spec violations are CONCERNS. Be strict but do not invent requirements the spec does not make.`;

const REVIEW_FIX_PROMPT = `Address the reviewer's concerns for this story with minimal changes. The SPEC is FROZEN (do not edit anything under docs/aidd/). After fixing, report via the structured output as the dev agent.`;

const BOOTSTRAP_PROMPT = `Read the AiDD planning artifacts of this repository and return the story roster: for each story in the epics-and-stories artifact, its id (e.g. E1-S2), title (single line, WITHOUT ':' or '#' characters), spec (path to its spec file, relative to the repo root), and verifyCommands (the exact shell commands from the spec's Verify section that prove completion; empty array if the spec has none). List every story — the orchestrator, not you, decides what runs.`;

const TRIAGE_PROMPT = `You are the sweep triage agent of an AiDD ship loop. Given the deferred-work ledger (entries dev agents deferred as non-blocking) and the sprint status, package the RESOLVABLE entries into new small stories: for each package return a title (no ':' or '#'), a complete spec in markdown (kernel: Why / Capabilities / Constraints / Non-goals / Success signal, plus a Verify section with commands), verifyCommands, and the entryIds it resolves. Entries that need a human decision or external action go to keep instead. Prefer few, focused packages.`;

/** Genera el script del workflow `aidd-ship`. */
export function generateAiddShipWorkflow(): string {
	return `// Patrón curado: aidd-ship (frida-aidd #38, Lote 2 — fase ship).
// Loop determinista por historia: dev → lie-detector → review acotado →
// verify determinista → commit del orquestador. sprint-status.yaml tiene un
// ÚNICO writer (este script) con transiciones never-regress; el deferred
// ledger sólo lo toca el orquestador; los agentes nunca editan docs/aidd/.
${SPRINT_STATUS_LIB}

var reviewMode = (args && args.review) || "manual"
var maxSweeps = (args && args.maxSweeps) || 2
var sprintArg = (args && args.sprint) || ""
var planningDir = "docs/aidd/planning"
var ledgerPath = "docs/aidd/deferred-ledger.json"
var verifyPath = "docs/aidd/verify-commands.json"
var verifyByStory = {}
var blockedDetails = {}
var doneList = []
var blockedList = []
var heldList = []

var DEV_PROMPT = ${JSON.stringify(DEV_PROMPT)}
var REWORK_PROMPT = ${JSON.stringify(REWORK_PROMPT)}
var REVIEW_PROMPT = ${JSON.stringify(REVIEW_PROMPT)}
var REVIEW_FIX_PROMPT = ${JSON.stringify(REVIEW_FIX_PROMPT)}
var BOOTSTRAP_PROMPT = ${JSON.stringify(BOOTSTRAP_PROMPT)}
var TRIAGE_PROMPT = ${JSON.stringify(TRIAGE_PROMPT)}

var DEV_SCHEMA = { type: "object", properties: { summary: { type: "string" }, filesTouched: { type: "array", items: { type: "string" } }, storyComplete: { type: "boolean" }, deferred: { type: "array", items: { type: "object", properties: { reason: { type: "string" }, summary: { type: "string" } }, required: ["reason", "summary"] } } }, required: ["summary", "filesTouched", "storyComplete"] }
var REVIEW_SCHEMA = { type: "object", properties: { verdict: { type: "string", enum: ["APPROVE", "CONCERNS"] }, notes: { type: "string" } }, required: ["verdict", "notes"] }
var BOOTSTRAP_SCHEMA = { type: "object", properties: { sprint: { type: "string" }, stories: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, spec: { type: "string" }, verifyCommands: { type: "array", items: { type: "string" } } }, required: ["id", "title", "spec"] } } }, required: ["stories"] }
var TRIAGE_SCHEMA = { type: "object", properties: { stories: { type: "array", items: { type: "object", properties: { title: { type: "string" }, spec: { type: "string" }, verifyCommands: { type: "array", items: { type: "string" } }, entryIds: { type: "array", items: { type: "string" } } }, required: ["title", "spec", "entryIds"] } }, keep: { type: "array", items: { type: "string" } } }, required: ["stories"] }

log("aidd-ship: review=" + reviewMode + " maxSweeps=" + maxSweeps + (sprintArg ? " sprint=" + sprintArg : ""))

async function tryRun(command) {
  var r = await shell(command)
  return r
}
async function run(command) {
  var r = await shell(command)
  if (r.exitCode !== 0) throw new Error("shell falló (" + r.exitCode + "): " + command + String(r.stderr || "").slice(0, 2000))
  return r.stdout
}
async function readText(path) {
  return await run("cat " + path)
}
async function writeText(path, content) {
  var text = String(content)
  if (text.indexOf("AIDD_EOF") >= 0) throw new Error("writeText: contenido no puede contener AIDD_EOF: " + path)
  if (text.charAt(text.length - 1) !== "\\n") text = text + "\\n"
  await run("mkdir -p $(dirname " + path + ")")
  var r = await tryRun("cat > " + path + " << 'AIDD_EOF'\\n" + text + "AIDD_EOF")
  if (r.exitCode !== 0) throw new Error("writeText falló: " + path + ": " + String(r.stderr || "").slice(0, 500))
}
async function readStatus() {
  return sprintParseStatus(await readText(SPRINT_STATUS_PATH))
}
async function writeStatus(st) {
  await writeText(SPRINT_STATUS_PATH, sprintSerializeStatus(st))
}
async function readLedger() {
  var r = await tryRun("cat " + ledgerPath)
  if (r.exitCode !== 0 || !String(r.stdout || "").trim()) return { entries: [] }
  var parsed = JSON.parse(r.stdout)
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error("ledger corrupto: falta entries[]")
  return parsed
}
async function writeLedger(ledger) {
  await writeText(ledgerPath, JSON.stringify(ledger))
}
async function persistVerify() {
  await writeText(verifyPath, JSON.stringify(verifyByStory))
}
function loadVerify(text) {
  if (!text || !text.trim()) return
  var parsed = JSON.parse(text)
  var keys = Object.keys(parsed)
  for (var i = 0; i < keys.length; i++) verifyByStory[keys[i]] = parsed[keys[i]]
}
function sanitizeTitle(title) {
  return String(title).replace(/["\`$\\\\]/g, "").replace(/[\\r\\n]+/g, " ").trim()
}
async function changedFiles(baseline) {
  var tracked = await run("git diff --name-only " + baseline)
  var untracked = await run("git ls-files --others --exclude-standard")
  var all = String(tracked + "\\n" + untracked).split("\\n")
  var set = {}
  for (var i = 0; i < all.length; i++) {
    var f = all[i].trim()
    if (f) set[f] = true
  }
  return set
}
function missingFromDiff(claimed, diffSet) {
  var miss = []
  for (var i = 0; i < claimed.length; i++) {
    var f = String(claimed[i]).trim()
    if (f && !diffSet[f]) miss.push(f)
  }
  return miss
}

// ── Ejecución de una historia ─────────────────────────────────────────────
async function blockStory(id, reason) {
  status = sprintApplyTransition(status, id, "blocked", reason)
  await writeStatus(status)
  blockedDetails[id] = reason
  blockedList.push(id)
  log("aidd-ship: " + id + " BLOCKED — " + reason)
  return "blocked"
}

var status = null

async function runStory(id) {
  var story = status.stories[id]
  phase("story " + id)
  status = sprintApplyTransition(status, id, "in_progress")
  await writeStatus(status)

  var specText
  try {
    specText = await readText(story.spec)
  } catch (e) {
    return await blockStory(id, "spec ilegible: " + story.spec + " (" + String(e && e.message || e).slice(0, 120) + ")")
  }
  var specSha = String(await run("git hash-object " + story.spec)).trim()
  var baseline = String(await run("git rev-parse HEAD")).trim()
  log("aidd-ship: " + id + " dev (baseline " + baseline.slice(0, 8) + ")")

  var devPrompt = DEV_PROMPT + "\\n\\n## Story\\n" + id + ": " + story.title + "\\n\\n## SPEC (FROZEN)\\n" + specText
  var dev = await agent(devPrompt, { label: "dev " + id, outputSchema: DEV_SCHEMA })

  // Pieza 3 — deferred-work: impedimentos no bloqueantes van al ledger.
  var def = (dev && dev.deferred) || []
  for (var d = 0; d < def.length; d++) {
    var ledger = await readLedger()
    ledger.entries.push({ id: "L" + (ledger.entries.length + 1), storyId: id, reason: def[d].reason, summary: def[d].summary, open: true })
    await writeLedger(ledger)
    log("aidd-ship: " + id + " deferred: " + def[d].reason)
  }
  if (!dev || !dev.storyComplete) {
    if (!def.length) return await blockStory(id, "dev reportó storyComplete=false sin deferred")
    log("aidd-ship: " + id + " incompleta pero con deferred — revisar sweep")
    return await blockStory(id, "dev reportó storyComplete=false (con deferred registrados)")
  }

  // Pieza 7 — lie-detector: claims vs diff real contra el baseline.
  var diffSet = await changedFiles(baseline)
  var claimed = (dev.filesTouched || []).slice()
  var miss = missingFromDiff(claimed, diffSet)
  var rounds = 0
  while (miss.length && rounds < 1) {
    rounds++
    log("aidd-ship: " + id + " lie-detector: sin diff para " + miss.join(", ") + " → rework")
    var rw = await agent(REWORK_PROMPT + "\\n\\n## Story\\n" + id + ": " + story.title + "\\n\\n## Files claimed but NOT in diff\\n" + miss.join("\\n") + "\\n\\n## SPEC (FROZEN)\\n" + specText, { label: "rework " + id, outputSchema: DEV_SCHEMA })
    diffSet = await changedFiles(baseline)
    miss = missingFromDiff((rw && rw.filesTouched) || claimed, diffSet)
  }
  if (miss.length) return await blockStory(id, "lie-detector: claims sin diff: " + miss.join(", "))

  // Pieza 6 — frozen-spec: el hash del spec no puede moverse durante la story.
  var sha2 = String(await run("git hash-object " + story.spec)).trim()
  if (sha2 !== specSha) return await blockStory(id, "frozen-spec: el spec cambió durante la implementación")

  // Review acotado (1 ronda de fix).
  status = sprintApplyTransition(status, id, "review")
  await writeStatus(status)
  var diff = String(await run("git diff " + baseline + " | head -c 100000"))
  var untracked = String(await run("git ls-files --others --exclude-standard"))
  var reviewCtx = "\\n\\n## Story\\n" + id + ": " + story.title + "\\n\\n## SPEC (FROZEN)\\n" + specText + "\\n\\n## DIFF vs baseline\\n" + diff + "\\n\\n## Untracked files\\n" + untracked
  var rv = await agent(REVIEW_PROMPT + reviewCtx, { label: "review " + id, outputSchema: REVIEW_SCHEMA })
  var rrounds = 0
  while (rv && rv.verdict !== "APPROVE" && rrounds < 1) {
    rrounds++
    log("aidd-ship: " + id + " review CONCERNS → fix: " + String(rv.notes || "").slice(0, 200))
    await agent(REVIEW_FIX_PROMPT + "\\n\\n## Reviewer notes\\n" + (rv.notes || "") + "\\n\\n## SPEC (FROZEN)\\n" + specText, { label: "review-fix " + id, outputSchema: DEV_SCHEMA })
    diff = String(await run("git diff " + baseline + " | head -c 100000"))
    untracked = String(await run("git ls-files --others --exclude-standard"))
    rv = await agent(REVIEW_PROMPT + "\\n\\n## Story\\n" + id + ": " + story.title + " (segunda revisión tras fix)\\n\\n## SPEC (FROZEN)\\n" + specText + "\\n\\n## DIFF vs baseline\\n" + diff + "\\n\\n## Untracked files\\n" + untracked, { label: "re-review " + id, outputSchema: REVIEW_SCHEMA })
  }
  if (!rv || rv.verdict !== "APPROVE") return await blockStory(id, "review: CONCERNS tras fix — " + String(rv && rv.notes || "").slice(0, 300))

  // Verify determinista: comandos del spec congelado (extraídos en bootstrap).
  var cmds = verifyByStory[id] || []
  for (var c = 0; c < cmds.length; c++) {
    var vr = await tryRun(cmds[c])
    if (vr.exitCode !== 0) return await blockStory(id, "verify falló: " + cmds[c] + String(vr.stderr || vr.stdout || "").slice(0, 300))
  }

  // Sin cambios reales = sospechoso (commit vacío rompería).
  diffSet = await changedFiles(baseline)
  var n = 0
  for (var k in diffSet) n++
  if (n === 0) return await blockStory(id, "sin cambios en el árbol — nada que commitear")

  // Commit del orquestador (checkpoint opcional).
  if (reviewMode === "manual") {
    var cp = await checkpoint({ name: "commit-" + id, prompt: "Story " + id + " (" + story.title + ") pasó dev + lie-detector + review + verify. ¿Commitear?", context: { story: id, title: story.title } })
    if (cp !== "approved") {
      status = sprintApplyTransition(status, id, "blocked", "checkpoint de commit rechazado")
      await writeStatus(status)
      blockedDetails[id] = "checkpoint de commit rechazado"
      heldList.push(id)
      log("aidd-ship: " + id + " HELD — checkpoint rechazado")
      return "held"
    }
  }
  await run("git add -A")
  await run("git commit -m \\"feat(aidd): " + id + " - " + sanitizeTitle(story.title) + " [aidd-ship]\\"")
  status = sprintApplyTransition(status, id, "done")
  await writeStatus(status)
  doneList.push(id)
  log("aidd-ship: " + id + " DONE")
  return "done"
}

// ── Bootstrap: sprint-status + verify-commands ────────────────────────────
phase("bootstrap")
var stExisting = await tryRun("cat " + SPRINT_STATUS_PATH)
var vExisting = await tryRun("cat " + verifyPath)
loadVerify(String(vExisting.stdout || ""))
if (stExisting.exitCode !== 0 || !String(stExisting.stdout || "").trim()) {
  var ext = await agent(BOOTSTRAP_PROMPT + "\\n\\n## Artifacts\\n- " + planningDir + "/epics-and-stories.md\\n- specs: " + planningDir + "/spec-*.md (y spec-*.md hermanos)", { label: "extract stories", outputSchema: BOOTSTRAP_SCHEMA })
  var roster = (ext && ext.stories) || []
  if (!roster.length) throw new Error("bootstrap: sin historias — corre aidd-plan primero")
  status = { sprint: String((ext && ext.sprint) || sprintArg || "1"), stories: {} }
  for (var i = 0; i < roster.length; i++) {
    var s = roster[i]
    if (!s.id || !s.title || !s.spec) throw new Error("bootstrap: historia incompleta (id/title/spec): " + JSON.stringify(s))
    status.stories[s.id] = { title: s.title, spec: s.spec, status: "pending" }
    verifyByStory[s.id] = s.verifyCommands || []
  }
  await writeStatus(status)
  await persistVerify()
  log("aidd-ship: bootstrap — " + roster.length + " historias, sprint " + status.sprint)
} else {
  status = sprintParseStatus(stExisting.stdout)
  log("aidd-ship: sprint-status existente — " + Object.keys(status.stories).length + " historias (sprint " + status.sprint + ")")
}

// ── Loop principal: historias pending ─────────────────────────────────────
phase("ship")
while (true) {
  var next = null
  var ids = Object.keys(status.stories)
  for (var j = 0; j < ids.length; j++) {
    if (status.stories[ids[j]].status === "pending") { next = ids[j]; break }
  }
  if (!next) break
  var outcome = await runStory(next)
  if (outcome === "held") break // checkpoint rechazado: el usuario retoma
}

// ── Pieza 4 — sweep del deferred ledger ──────────────────────────────────
var sweeps = 0
while (sweeps < maxSweeps) {
  var ledger = await readLedger()
  var open = []
  for (var e1 = 0; e1 < ledger.entries.length; e1++) if (ledger.entries[e1].open) open.push(ledger.entries[e1])
  if (!open.length) break
  sweeps++
  phase("sweep " + sweeps)
  log("aidd-ship: sweep " + sweeps + " — " + open.length + " entradas deferidas")
  var tri = await agent(TRIAGE_PROMPT + "\\n\\n## Deferred ledger\\n" + JSON.stringify(open, null, 2) + "\\n\\n## Sprint status\\n" + sprintSerializeStatus(status), { label: "sweep triage", outputSchema: TRIAGE_SCHEMA })
  var packs = (tri && tri.stories) || []
  if (!packs.length) {
    log("aidd-ship: sweep — nada empaquetable; " + open.length + " entradas quedan para decisión humana")
    break
  }
  for (var p = 0; p < packs.length; p++) {
    var pack = packs[p]
    var swId = "SW" + sweeps + "-" + (p + 1)
    var specPath = planningDir + "/sweep-" + swId + ".md"
    await writeText(specPath, pack.spec)
    status.stories[swId] = { title: pack.title, spec: specPath, status: "pending" }
    verifyByStory[swId] = pack.verifyCommands || []
    var ledger2 = await readLedger()
    for (var e2 = 0; e2 < ledger2.entries.length; e2++) {
      if (pack.entryIds.indexOf(ledger2.entries[e2].id) >= 0) {
        ledger2.entries[e2].open = false
        ledger2.entries[e2].packaged = swId
      }
    }
    await writeLedger(ledger2)
    await writeStatus(status)
    await persistVerify()
    var oc = await runStory(swId)
    if (oc === "done") {
      var ledger3 = await readLedger()
      for (var e3 = 0; e3 < ledger3.entries.length; e3++) {
        if (ledger3.entries[e3].packaged === swId) ledger3.entries[e3].resolved = true
      }
      await writeLedger(ledger3)
    } else if (oc === "blocked" || oc === "held") {
      var ledger4 = await readLedger()
      for (var e4 = 0; e4 < ledger4.entries.length; e4++) {
        if (ledger4.entries[e4].packaged === swId) { ledger4.entries[e4].open = true; delete ledger4.entries[e4].packaged }
      }
      await writeLedger(ledger4)
      if (oc === "held") break
    }
  }
}

await writeStatus(status)
var finalLedger = await readLedger()
var openCount = 0
for (var e5 = 0; e5 < finalLedger.entries.length; e5++) if (finalLedger.entries[e5].open) openCount++
log("aidd-ship: fin — done " + doneList.length + " · blocked " + blockedList.length + " · deferred abiertas " + openCount)
return {
  sprint: status.sprint,
  done: doneList,
  blocked: blockedList,
  blockedDetails: blockedDetails,
  held: heldList,
  deferredOpen: openCount,
  commits: doneList.length,
}
`;
}
