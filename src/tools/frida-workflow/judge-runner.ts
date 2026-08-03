// frida-workflow — driver de judges (Fase 7): runJudge (Judge directo o Panel de
// N miembros → fold), runVerify (post-condición por etapa), runAssess (loop
// juzgado hasta done). Cada judge corre su propia sesión hija vía executeUnit
// (con el artefacto del productor auto-inyectado); ≥1 artefacto o fatal.

import { fire, type LifecycleContext } from "./lifecycle";
import { isSugarFold } from "./judges";
import { publishNamed } from "./named";
import { executeUnit } from "./unit";
import type {
	AssessDef,
	FoldFn,
	Judge,
	Output,
	PanelDef,
	PanelVerdict,
	RunState,
	StageDef,
	StageSnapshot,
	VerifyDef,
	WorkflowHost,
} from "./types";
import type { StageOutcome } from "./runner";

class JudgeFailed extends Error {}

function primaryHandleOf(o: Output | undefined): string | undefined {
	const primary =
		o?.artifacts.find((a) => a.role === "primary") ?? o?.artifacts[0];
	return primary?.handle.kind === "fs" ? primary.handle.path : undefined;
}

function isPanel(slot: Judge | PanelDef): slot is PanelDef {
	return Array.isArray((slot as PanelDef).members);
}

// ---------------------------------------------------------------------------
// runJudge — Judge directo o Panel
// ---------------------------------------------------------------------------

export async function runJudge(
	host: WorkflowHost,
	judgeSlot: Judge | PanelDef,
	producerOutput: Output,
	stageName: string,
	state: RunState,
	sessionDir: string,
	signal: AbortSignal | undefined,
	preSnapshot: StageSnapshot | undefined,
	ctx: LifecycleContext,
): Promise<Output> {
	if (isPanel(judgeSlot)) {
		return runPanel(
			host,
			judgeSlot,
			producerOutput,
			stageName,
			state,
			sessionDir,
			signal,
			preSnapshot,
			ctx,
		);
	}
	return runOneJudge(
		host,
		judgeSlot,
		producerOutput,
		stageName,
		sessionDir,
		signal,
		preSnapshot,
	);
}

async function runOneJudge(
	host: WorkflowHost,
	j: Judge,
	producerOutput: Output,
	stageName: string,
	sessionDir: string,
	signal: AbortSignal | undefined,
	preSnapshot: StageSnapshot | undefined,
): Promise<Output> {
	const pseudo = { outcome: j.outcome } as StageDef;
	const handle = primaryHandleOf(producerOutput);
	const prompt = j.skill
		? handle
			? `/skill:${j.skill} ${handle}`
			: `/skill:${j.skill}`
		: j.prompt!({ output: producerOutput });
	const res = await executeUnit(
		host,
		prompt,
		`${stageName}-judge`,
		pseudo,
		host.cwd,
		sessionDir,
		signal,
		preSnapshot,
	);
	if (!res.ok || !res.output)
		throw new JudgeFailed(res?.error ?? `judge de "${stageName}" falló`);
	if (res.output.artifacts.length === 0) {
		throw new JudgeFailed(`judge de "${stageName}" sin artefactos (fatal)`);
	}
	return res.output;
}

async function runPanel(
	host: WorkflowHost,
	panel: PanelDef,
	producerOutput: Output,
	stageName: string,
	state: RunState,
	sessionDir: string,
	signal: AbortSignal | undefined,
	preSnapshot: StageSnapshot | undefined,
	ctx: LifecycleContext,
): Promise<Output> {
	void ctx;
	const verdicts: Output[] = [];
	for (const m of panel.members) {
		verdicts.push(
			await runOneJudge(
				host,
				m,
				producerOutput,
				stageName,
				sessionDir,
				signal,
				preSnapshot,
			),
		);
	}
	// publica cada veredicto de miembro a su propio canal.
	for (let i = 0; i < panel.members.length; i++) {
		const mn = panel.members[i]!.outcome.name;
		if (mn) publishNamed(state, mn, verdicts[i]!);
	}
	const data = applyFold(panel.fold, verdicts, panel.members);
	const foldName = panel.outcome?.name ?? `${stageName}-panel`;
	if (panel.outcome?.name) {
		// fold crudo: publica al canal del outcome.
		publishNamed(state, foldName, { kind: foldName, data, artifacts: [] });
	}
	return { kind: "panel", data, artifacts: [] };
}

function applyFold(
	fold: PanelDef["fold"],
	verdicts: Output[],
	members: Judge[],
): unknown {
	if (isSugarFold(fold)) {
		const passes = verdicts.filter(fold.pred).length;
		const fails = verdicts.length - passes;
		const pass =
			fold.rule === "majority"
				? passes * 2 > verdicts.length
				: fold.rule === "all"
					? fails === 0
					: passes > 0;
		const agreement = verdicts.length
			? Math.max(passes, fails) / verdicts.length
			: 0;
		const pv: PanelVerdict = {
			pass,
			votes: { pass: passes, fail: fails },
			agreement,
			tie: passes === fails,
		};
		return pv;
	}
	return (fold as FoldFn)(verdicts, members);
}

// ---------------------------------------------------------------------------
// runVerify — post-condición por etapa
// ---------------------------------------------------------------------------

export async function runVerify(
	host: WorkflowHost,
	stageName: string,
	stage: StageDef,
	state: RunState,
	sessionDir: string,
	signal: AbortSignal | undefined,
	preSnapshot: StageSnapshot | undefined,
	ctx: LifecycleContext,
	basePrompt: string,
): Promise<StageOutcome> {
	const v = stage.verify as VerifyDef;
	const max = Math.max(1, v.max ?? 1);
	const skill = stage.skill ?? stageName;
	const fail = (error: string): StageOutcome => ({
		ok: false,
		error,
		skill,
		aborted: !!signal?.aborted,
	});
	void ctx;

	let prompt = basePrompt;
	for (let attempt = 0; attempt < max; attempt++) {
		const res = await executeUnit(
			host,
			prompt,
			stageName,
			stage,
			host.cwd,
			sessionDir,
			signal,
			preSnapshot,
			{ runId: ctx.runId, stage: stageName },
		);
		if (!res.ok) return fail(res.error ?? "etapa falló");
		let verdict: Output;
		try {
			verdict = await runJudge(
				host,
				v.judge,
				res.output!,
				stageName,
				state,
				sessionDir,
				signal,
				preSnapshot,
				ctx,
			);
		} catch (e) {
			return fail(e instanceof Error ? e.message : String(e));
		}
		if (v.done(verdict)) {
			if (stage.outcome?.name && res.output)
				publishNamed(state, stage.outcome.name, res.output);
			return {
				ok: true,
				skill,
				primaryHandle: res.primaryHandle,
				output: res.output,
			};
		}
		// reintento: feedForward añade feedback al prompt del productor.
		if (attempt < max - 1 && v.feedForward) {
			prompt = `${basePrompt}\n${v.feedForward({ cwd: host.cwd, output: res.output!, verdict, round: attempt, state })}`;
		}
	}
	return fail(`verification failed tras ${max} intento(s)`);
}

// ---------------------------------------------------------------------------
// runAssess — loop juzgado hasta done
// ---------------------------------------------------------------------------

export async function runAssess(
	host: WorkflowHost,
	stageName: string,
	stage: StageDef,
	state: RunState,
	sessionDir: string,
	signal: AbortSignal | undefined,
	preSnapshot: StageSnapshot | undefined,
	ctx: LifecycleContext,
	basePrompt: string,
): Promise<StageOutcome> {
	const loop = stage.loop as AssessDef;
	const max = Math.min(loop.max ?? 8, state.maxIterations);
	const name = (stage.outcome as { name?: string } | undefined)?.name;
	const skill = stage.skill ?? stageName;
	const stageRef = { name: stageName, skill };
	const onCap = loop.onCap ?? "advance";

	await fire("onLoopStart", stageRef, { kind: "assess" }, ctx);

	let prompt = basePrompt;
	const outputs: Output[] = [];
	let errored: string | undefined;

	for (let round = 0; round < max; round++) {
		const res = await executeUnit(
			host,
			prompt,
			stageName,
			stage,
			host.cwd,
			sessionDir,
			signal,
			preSnapshot,
			{ runId: ctx.runId, stage: stageName },
		);
		if (!res.ok) {
			errored = res.error;
			break;
		}
		if (name && res.output) publishNamed(state, name, res.output);
		outputs.push(res.output!);

		let verdict: Output;
		try {
			verdict = await runJudge(
				host,
				loop.judge,
				res.output!,
				stageName,
				state,
				sessionDir,
				signal,
				preSnapshot,
				ctx,
			);
		} catch (e) {
			errored = e instanceof Error ? e.message : String(e);
			break;
		}
		if (loop.done(verdict)) {
			const pick =
				loop.result === "entry" ? outputs[0] : outputs[outputs.length - 1];
			return {
				ok: true,
				skill,
				primaryHandle: primaryHandleOf(pick),
				output: pick,
			};
		}
		if (loop.feedForward) {
			prompt = `${basePrompt}\n${loop.feedForward({ cwd: host.cwd, output: res.output!, verdict, round, state })}`;
		}
	}

	if (!errored) {
		await fire(
			"onLoopCap",
			stageRef,
			{ kind: "assess", count: outputs.length, max, policy: onCap },
			ctx,
		);
		if (onCap === "halt") errored = `assess cap: ${max} rondas sin done`;
	}

	const pick = outputs.length
		? loop.result === "entry"
			? outputs[0]
			: outputs[outputs.length - 1]
		: undefined;
	return {
		ok: !errored,
		error: errored,
		skill,
		primaryHandle: primaryHandleOf(pick),
		output: pick,
		aborted: !!signal?.aborted,
	};
}
