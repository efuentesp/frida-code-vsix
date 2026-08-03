// frida-workflow — runner (travesía del grafo) + resume (Fase 3).
//
// runWorkflow: escribe header (+claim --name), state fresco, walk desde start.
// resumeWorkflow: pliega el trail JSONL → state + posición, walk desde ahí SIN
// nuevo header (append a la misma historia). Las etapas completas se REPLAY-ean
// desde el output journalizado (no se re-corre el modelo); la etapa fallida se
// re-corre. Sin loops (Fase 6): el determinismo de collectors llega ahí.

import { join } from "node:path";
import {
	appendRouteRow,
	appendStageRow,
	claimName,
	generateRunId,
	nowIso,
	readTrail,
	releaseName,
	resolveRef,
	STATE_SCHEMA_VERSION,
	writeHeader,
	type StageRow,
	type StageStatus,
	type Trail,
	type ClaimResult,
} from "./audit";
import { captureSnapshot } from "./outcomes";
import { freshRunState } from "./state";
import { summarizeIssues, validateSchema } from "./schema";
import { fire, type LifecycleContext, type StageOutput } from "./lifecycle";
import { executeUnit } from "./unit";
import { runLoop } from "./loop-runner";
import { runAssess, runVerify } from "./judge-runner";
import { publishNamed, readArtifacts } from "./named";
import type {
	EdgeFn,
	Output,
	RunState,
	RunWorkflowOptions,
	RunWorkflowResult,
	StageDef,
	Workflow,
	WorkflowHost,
} from "./types";

const STOP = "stop";
/** Techo anti-ciclo (los loops verdaderos + su cap propio llegan en Fase 6). */
const MAX_STAGES = 64;

// ===========================================================================
// runWorkflow (run nuevo)
// ===========================================================================

export async function runWorkflow(
	opts: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
	const { workflow, input, runsDir, host, signal } = opts;

	if (!workflow.stages[workflow.start]) {
		return fail0(`start "${workflow.start}" no es una etapa declarada`);
	}

	const runId = generateRunId();

	// --name: valida + colisión + persiste ANTES del header (nada se escribe si falla).
	if (opts.name) {
		const claim = claimName(runsDir, opts.name, runId);
		if (!claim.ok) return fail0(nameClaimError(opts.name, claim));
	}

	if (
		!writeHeader(runsDir, {
			type: "workflow",
			runId,
			workflow: workflow.name,
			input,
			ts: nowIso(),
			v: STATE_SCHEMA_VERSION,
		})
	) {
		if (opts.name) releaseName(runsDir, opts.name, runId);
		return fail0(`no se pudo escribir el header del run en ${runsDir}`);
	}

	const state = freshRunState(runId, workflow.name, input);
	state.maxIterations = opts.maxIterations ?? 32;
	const sessionDir = join(runsDir, runId, "sessions");
	return walkChain({
		workflow,
		state,
		runsDir,
		sessionDir,
		host,
		signal,
		start: workflow.start,
	});
}

function nameClaimError(
	name: string,
	claim: Extract<ClaimResult, { ok: false }>,
): string {
	switch (claim.reason) {
		case "invalid":
			return `--name "${name}" inválido (usa [A-Za-z_][A-Za-z0-9_-]{0,63})`;
		case "collision":
			return `--name "${name}" ya lo usa el run ${claim.runId}`;
		case "write-failed":
			return `no se pudo persistir el alias --name "${name}"`;
		default:
			return `no se pudo asignar --name "${name}"`;
	}
}

// ===========================================================================
// resumeWorkflow (Fase 3)
// ===========================================================================

export interface ResumeOptions {
	workflow: Workflow;
	runsDir: string;
	/** run-id | @<name> | path a .jsonl */
	ref: string;
	host: WorkflowHost;
	signal?: AbortSignal;
	maxIterations?: number;
}

export async function resumeWorkflow(
	opts: ResumeOptions,
): Promise<RunWorkflowResult> {
	const { workflow, runsDir, host, signal } = opts;
	const runId = resolveRef(runsDir, opts.ref);
	if (!runId) return fail0(`no se resolvió el ref "${opts.ref}"`);

	const trail = readTrail(runsDir, runId);
	if (!trail) return fail0(`run "${runId}" no encontrado o sin header`);
	if (trail.header.v !== STATE_SCHEMA_VERSION) {
		return fail0(
			`schema del trail v${trail.header.v} ≠ v${STATE_SCHEMA_VERSION} (sin migración in-place)`,
		);
	}
	if (trail.header.workflow !== workflow.name) {
		return fail0(
			`el run "${runId}" es del workflow "${trail.header.workflow}", no de "${workflow.name}"`,
		);
	}

	const recon = reconstructState(workflow, trail, host.cwd);
	if (!recon.ok) return fail0(recon.error);
	recon.state.maxIterations = opts.maxIterations ?? 32;

	// Run ya completado: nada que resumir.
	if (recon.current === STOP) {
		return {
			runId,
			stagesCompleted: recon.state.stagesCompleted,
			success: true,
			lastArtifact: recon.state.primaryHandle,
			termination: { status: "completed" },
		};
	}

	const sessionDir = join(runsDir, runId, "sessions");
	return walkChain({
		workflow,
		state: recon.state,
		runsDir,
		sessionDir,
		host,
		signal,
		start: recon.current,
	});
}

interface Recon {
	ok: true;
	state: RunState;
	current: string; // etapa a re-entrar, o STOP si ya completó
}
interface ReconErr {
	ok: false;
	error: string;
}

/** Pliega el trail: replay-ea etapas completas, re-entra en la fallida. */
function reconstructState(
	workflow: Workflow,
	trail: Trail,
	cwd: string,
): Recon | ReconErr {
	const state = freshRunState(
		trail.header.runId,
		trail.header.workflow,
		trail.header.input,
	);
	const rows = trail.rows;
	let current: string = workflow.start;
	let i = 0;
	while (i < rows.length) {
		const row = rows[i]!;
		if (row.type === "route") {
			current = row.to; // la decisión ya se tomó
			i++;
			continue;
		}
		// stage row
		if (row.status === "completed") {
			state.visited.add(row.stage);
			state.stagesCompleted++;
			if (row.primaryHandle !== undefined)
				state.primaryHandle = row.primaryHandle;
			if (row.output) state.lastOutput = row.output;
			// reconstruye el canal nombrado (para reads/fanin al resumir).
			const sd = workflow.stages[row.stage];
			if (row.output && sd?.outcome?.name)
				publishNamed(state, sd.outcome.name, row.output);
			// avanza pasado esta etapa según su edge.
			const edge = workflow.edges[row.stage];
			if (edge === undefined || edge === STOP) {
				current = STOP;
			} else if (typeof edge === "string") {
				current = edge;
			} else {
				// EdgeFn: ¿hubo fila route justo después?
				const next = rows[i + 1];
				if (next && next.type === "route" && next.from === row.stage) {
					current = next.to;
					i++;
				} else if (row.output) {
					// crash entre stage completo y route row → re-rutear con output journalizado.
					current = (edge as EdgeFn)({ output: row.output, state, cwd });
				} else {
					return {
						ok: false,
						error: `no se puede re-rutear desde "${row.stage}" (sin output journalizado)`,
					};
				}
			}
		} else {
			// failed/aborted: re-corre esta etapa.
			current = row.stage;
			i++;
			break;
		}
		i++;
	}
	return { ok: true, state, current };
}

// ===========================================================================
// walkChain — loop compartido por run y resume
// ===========================================================================

interface WalkOpts {
	workflow: Workflow;
	state: RunState;
	runsDir: string;
	sessionDir: string;
	host: WorkflowHost;
	signal: AbortSignal | undefined;
	start: string;
}

async function walkChain(o: WalkOpts): Promise<RunWorkflowResult> {
	const { workflow, state, runsDir, sessionDir, host, signal } = o;
	const runId = state.runId;
	let current: string = o.start;
	const ctx: LifecycleContext = {
		runId,
		workflow: state.workflow,
		input: state.originalInput,
		cwd: host.cwd,
	};
	await fire("onWorkflowStart", ctx);

	while (true) {
		if (signal?.aborted) {
			state.termination = { status: "aborted", error: "abortado por señal" };
			break;
		}
		if (state.visited.size >= MAX_STAGES) {
			state.termination = {
				status: "failed",
				error: `tope de ${MAX_STAGES} etapas`,
			};
			break;
		}
		state.visited.add(current);

		const stage = workflow.stages[current];
		if (!stage) {
			state.termination = {
				status: "failed",
				error: `etapa "${current}" no declarada`,
			};
			break;
		}

		const stageRef = { name: current, skill: stage.skill ?? current };
		await fire("onStageStart", stageRef, ctx);
		const outcome = await runStage(
			host,
			current,
			stage,
			state,
			sessionDir,
			signal,
			ctx,
		);
		writeStageRow(runsDir, runId, current, outcome);
		if (outcome.retries && outcome.retries > 0) {
			await fire("onStageRetry", stageRef, outcome.retries, ctx);
		}
		if (outcome.ok) {
			const out: StageOutput = {
				primaryHandle: outcome.primaryHandle,
				data: outcome.output?.data,
			};
			await fire("onStageEnd", stageRef, out, ctx);
		} else {
			await fire("onStageError", stageRef, outcome.error ?? "etapa falló", ctx);
		}

		if (!outcome.ok) {
			state.termination = {
				status: signal?.aborted ? "aborted" : "failed",
				error: outcome.error ?? "etapa falló",
			};
			break;
		}
		if (outcome.primaryHandle !== undefined)
			state.primaryHandle = outcome.primaryHandle;
		if (stage.inheritsArtifacts === false) state.primaryHandle = undefined; // terminal
		if (outcome.output) state.lastOutput = outcome.output;
		state.stagesCompleted++;

		// Avance: string (lineal) o EdgeFn (routing).
		const edge = workflow.edges[current];
		let next: string;
		if (edge === undefined || edge === STOP) {
			state.termination = { status: "completed" };
			break;
		} else if (typeof edge === "string") {
			next = edge;
		} else {
			const out = outcome.output;
			if (!out) {
				state.termination = {
					status: "failed",
					error: `edge de "${current}" es un route pero la etapa no produjo output`,
				};
				break;
			}
			next = (edge as EdgeFn)({ output: out, state, cwd: host.cwd });
			appendRouteRow(runsDir, {
				type: "route",
				runId,
				from: current,
				to: next,
				ts: nowIso(),
			});
			await fire("onRoute", current, next, ctx);
		}

		if (next !== STOP && !workflow.stages[next]) {
			state.termination = {
				status: "failed",
				error: `route llevó a "${next}", que no es etapa declarada`,
			};
			break;
		}
		if (next === STOP) {
			state.termination = { status: "completed" };
			break;
		}
		current = next;
	}

	const completed = state.termination.status === "completed";
	const result: RunWorkflowResult = {
		runId,
		stagesCompleted: state.stagesCompleted,
		success: completed,
		lastArtifact: state.primaryHandle,
		error: completed
			? undefined
			: (state.termination as { error: string }).error,
		termination: state.termination,
	};
	await fire("onWorkflowEnd", result, ctx);
	return result;
}

function fail0(error: string): RunWorkflowResult {
	return {
		runId: "",
		stagesCompleted: 0,
		success: false,
		error,
		termination: { status: "failed", error },
	};
}

// ===========================================================================
// runStage (collect → parse → validate → retry)
// ===========================================================================

export interface StageOutcome {
	ok: boolean;
	error?: string;
	skill: string;
	session?: { id: string; file?: string };
	primaryHandle?: string;
	/** Output validado (data + artifacts) — lo lee el EdgeFn y se journaliza. */
	output?: Output;
	/** Cuántas reintentos de schema ocurrieron (para onStageRetry). */
	retries?: number;
	aborted?: boolean;
}

/** Construye el prompt: flags `--name path` si `reads` (multi-input/fan-in),
 *  si no arg posicional (primary-handle o brief). */
function buildPrompt(
	skill: string,
	stage: StageDef,
	state: RunState,
): { prompt: string } | { error: string } {
	if (stage.reads && stage.reads.length > 0) {
		const flags: string[] = [];
		for (const r of stage.reads) {
			const name = typeof r === "string" ? r : r.name;
			const arts = readArtifacts(state, r);
			if (arts.length === 0)
				return {
					error: `reads "${name}" vacío (el productor no disparó en este camino)`,
				};
			for (const a of arts)
				if (a.handle.kind === "fs") flags.push(`--${name} ${a.handle.path}`);
		}
		return {
			prompt: flags.length
				? `/skill:${skill} ${flags.join(" ")}`
				: `/skill:${skill}`,
		};
	}
	const arg =
		stage.inheritsArtifacts === false
			? state.originalInput
			: (state.primaryHandle ?? state.originalInput);
	return {
		prompt: arg && arg.trim() ? `/skill:${skill} ${arg}` : `/skill:${skill}`,
	};
}

async function runStage(
	host: WorkflowHost,
	stageName: string,
	stage: StageDef,
	state: RunState,
	sessionDir: string,
	signal: AbortSignal | undefined,
	ctx: LifecycleContext,
): Promise<StageOutcome> {
	const skill = stage.skill ?? stageName;
	const fail = (error: string): StageOutcome => ({
		ok: false,
		error,
		skill,
		aborted: !!signal?.aborted,
	});

	// inputSchema: valida el output.data heredado. Rechazo ⇒ halt.
	if (stage.inputSchema && state.lastOutput) {
		const v = await validateSchema(stage.inputSchema, state.lastOutput.data);
		if (!v.ok)
			return fail(
				`inputSchema de "${stageName}" rechazado: ${summarizeIssues(v.issues)}`,
			);
	}

	const spec = stage.outcome;
	// script/prompt no requieren outcome (el run lo prove / el collector del prompt sí si se declara).
	if (
		stage.kind === "produces" &&
		!spec &&
		!stage.run &&
		stage.prompt === undefined
	) {
		return fail(`produces stage "${stageName}" requiere outcome`);
	}

	const preSnapshot = spec ? captureSnapshot(host.cwd) : undefined;

	// Despacho script (Fase 8): función TS pura, sin modelo. Excluyente con loop/verify/prompt.
	if (stage.run) return runScript(host, stageName, stage, state, signal);

	// Despacho prompt (Fase 8): texto crudo al modelo (sin /skill:).
	if (stage.prompt !== undefined) {
		const promptText =
			typeof stage.prompt === "function"
				? stage.prompt({ input: state.lastOutput })
				: stage.prompt;
		const res = await executeUnit(
			host,
			promptText,
			stageName,
			stage,
			host.cwd,
			sessionDir,
			signal,
			preSnapshot,
			{ runId: ctx.runId, stage: stageName },
		);
		if (res.ok && res.output && spec?.name)
			publishNamed(state, spec.name, res.output);
		return {
			ok: res.ok,
			error: res.error,
			skill,
			primaryHandle: res.primaryHandle,
			output: res.output,
			retries: res.retries,
			aborted: !!signal?.aborted,
		};
	}

	// Despacho skill (default): prompt /skill:<name> <arg> o flags de reads.
	const p = buildPrompt(skill, stage, state);
	if ("error" in p) return fail(p.error);
	const basePrompt = p.prompt;

	// Loop juzgado (Fase 7): rondas productor→judge hasta done.
	if (stage.loop?.kind === "assess") {
		return runAssess(
			host,
			stageName,
			stage,
			state,
			sessionDir,
			signal,
			preSnapshot,
			ctx,
			basePrompt,
		);
	}

	// Loop (Fase 6): expande la etapa en una sesión hija por unidad.
	if (stage.loop) {
		return runLoop(
			host,
			stageName,
			stage,
			state,
			sessionDir,
			signal,
			preSnapshot,
			ctx,
		);
	}

	// Post-condición juzgada (Fase 7): produce→judge→done gate, retry hasta max.
	if (stage.verify) {
		return runVerify(
			host,
			stageName,
			stage,
			state,
			sessionDir,
			signal,
			preSnapshot,
			ctx,
			basePrompt,
		);
	}

	// Simple: una unidad.
	const res = await executeUnit(
		host,
		basePrompt,
		stageName,
		stage,
		host.cwd,
		sessionDir,
		signal,
		preSnapshot,
		{ runId: ctx.runId, stage: stageName },
	);
	if (res.ok && res.output && spec?.name)
		publishNamed(state, spec.name, res.output);
	return {
		ok: res.ok,
		error: res.error,
		skill,
		primaryHandle: res.primaryHandle,
		output: res.output,
		retries: res.retries,
		aborted: !!signal?.aborted,
	};
}

// ---------------------------------------------------------------------------
// runScript (Fase 8): despacho script, sin modelo
// ---------------------------------------------------------------------------

function scriptPrimaryHandle(o: Output | undefined): string | undefined {
	const primary =
		o?.artifacts.find((a) => a.role === "primary") ?? o?.artifacts[0];
	return primary?.handle.kind === "fs" ? primary.handle.path : undefined;
}

async function runScript(
	host: WorkflowHost,
	stageName: string,
	stage: StageDef,
	state: RunState,
	signal: AbortSignal | undefined,
): Promise<StageOutcome> {
	const skill = stage.skill ?? "<script>";
	const fail = (error: string): StageOutcome => ({
		ok: false,
		error,
		skill,
		aborted: !!signal?.aborted,
	});
	if (signal?.aborted) return fail("abortado por señal");

	let sres;
	try {
		sres = await stage.run!({ cwd: host.cwd, input: state.lastOutput, state });
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e));
	}

	if (stage.kind === "produces") {
		if (!sres)
			return fail(`produces.script "${stageName}" debe retornar un resultado`);
		const output: Output = {
			kind: sres.kind ?? stageName,
			data: sres.data,
			artifacts: sres.artifacts,
		};
		if (stage.outputSchema) {
			const v = await validateSchema(stage.outputSchema, output.data);
			if (!v.ok) return fail(`outputSchema: ${summarizeIssues(v.issues)}`);
		}
		if (stage.outcome?.name) publishNamed(state, stage.outcome.name, output);
		return {
			ok: true,
			skill,
			primaryHandle: scriptPrimaryHandle(output),
			output,
			aborted: false,
		};
	}

	// acts/terminal script: void (side-effect). terminal limpia el slot.
	const primaryHandle =
		stage.inheritsArtifacts === false ? undefined : state.primaryHandle;
	return { ok: true, skill, primaryHandle, aborted: false };
}

function writeStageRow(
	runsDir: string,
	runId: string,
	stageName: string,
	o: StageOutcome,
): void {
	const status: StageStatus = !o.ok
		? o.aborted
			? "aborted"
			: "failed"
		: "completed";
	const row: StageRow = {
		type: "stage",
		runId,
		stage: stageName,
		skill: o.skill,
		status,
		ts: nowIso(),
		session: o.session,
		primaryHandle: o.ok ? o.primaryHandle : undefined,
		output: o.ok ? o.output : undefined,
		error: o.error,
	};
	appendStageRow(runsDir, row);
}
