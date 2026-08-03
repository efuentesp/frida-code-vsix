// frida-workflow — driver de loops (Fase 6): fanout (push, waves Kahn por deps +
// concurrency) e iterate (pull acumulativo). Cada unidad corre vía executeUnit;
// los outputs se acumulan en state.named[outcome.name]. Caps: min(loop.max,
// state.maxIterations); onCap halt/advance; result entry|last.

import { fire, type LifecycleContext, type UnitEvent } from "./lifecycle";
import { publishNamed } from "./named";
import { executeUnit } from "./unit";
import type {
	Artifact,
	FanoutDef,
	IterateDef,
	LoopOnCap,
	Output,
	RunState,
	StageDef,
	StageSnapshot,
	Unit,
	WorkflowHost,
} from "./types";
import type { StageOutcome } from "./runner";

class UnitFailed extends Error {}

/** Artefacto primario rolling (para FanoutContext/IterateContext). */
function currentArtifact(state: RunState): Artifact | undefined {
	return state.primaryHandle
		? { handle: { kind: "fs", path: state.primaryHandle }, role: "primary" }
		: undefined;
}

function primaryHandleOf(o: Output | undefined): string | undefined {
	const primary =
		o?.artifacts.find((a) => a.role === "primary") ?? o?.artifacts[0];
	return primary?.handle.kind === "fs" ? primary.handle.path : undefined;
}

export async function runLoop(
	host: WorkflowHost,
	stageName: string,
	stage: StageDef,
	state: RunState,
	sessionDir: string,
	signal: AbortSignal | undefined,
	preSnapshot: StageSnapshot | undefined,
	ctx: LifecycleContext,
): Promise<StageOutcome> {
	const loop = stage.loop!;
	const name = stage.outcome?.name; // sólo los loops collecting publican
	const skill = stage.skill ?? stageName;
	const stageRef = { name: stageName, skill };
	const cap = Math.min(loop.max ?? state.maxIterations, state.maxIterations);
	const onCap: LoopOnCap = loop.onCap ?? "halt";

	await fire(
		"onLoopStart",
		stageRef,
		{ kind: loop.kind as "fanout" | "iterate" },
		ctx,
	);

	const outputs: Output[] = [];
	let errored: string | undefined;
	let nextIndex = 0;

	const runOne = async (u: Unit): Promise<Output | undefined> => {
		const ue: UnitEvent = { index: nextIndex++, label: u.label, id: u.id };
		await fire("onUnitStart", stageRef, ue, ctx);
		const res = await executeUnit(
			host,
			u.prompt,
			stageName,
			stage,
			host.cwd,
			sessionDir,
			signal,
			preSnapshot,
			{ runId: ctx.runId, stage: stageName },
		);
		await fire(
			"onUnitEnd",
			stageRef,
			ue,
			res.ok
				? { primaryHandle: res.primaryHandle, data: res.output?.data }
				: undefined,
			ctx,
		);
		if (!res.ok) throw new UnitFailed(res.error ?? "unidad falló");
		return res.output;
	};

	try {
		if (loop.kind === "fanout") {
			await execFanout(
				loop,
				state,
				host,
				stageRef,
				cap,
				onCap,
				ctx,
				runOne,
				outputs,
			);
		} else if (loop.kind === "iterate") {
			errored = await execIterate(
				loop,
				state,
				host,
				cap,
				onCap,
				stageRef,
				ctx,
				runOne,
				outputs,
			);
		}
		// assess se despacha en runStage (runAssess); no llega aquí.
	} catch (e) {
		if (errored === undefined)
			errored = e instanceof Error ? e.message : String(e);
	}

	for (const o of outputs) if (name) publishNamed(state, name, o);

	const result = loop.result ?? (loop.kind === "fanout" ? "entry" : "last");
	const pick = outputs.length
		? result === "entry"
			? outputs[0]
			: outputs[outputs.length - 1]
		: undefined;

	return {
		ok: !errored,
		error: errored,
		skill,
		primaryHandle: primaryHandleOf(pick),
		output: pick,
		retries: 0,
		aborted: !!signal?.aborted,
	};
}

// ---------------------------------------------------------------------------
// fanout
// ---------------------------------------------------------------------------

async function execFanout(
	loop: FanoutDef,
	state: RunState,
	host: WorkflowHost,
	stageRef: { name: string; skill: string },
	cap: number,
	onCap: LoopOnCap,
	ctx: LifecycleContext,
	runOne: (u: Unit) => Promise<Output | undefined>,
	outputs: Output[],
): Promise<void> {
	let units = loop.units({
		cwd: host.cwd,
		artifact: currentArtifact(state),
		state,
	});
	if (units.length > cap) {
		await fire(
			"onLoopCap",
			stageRef,
			{ kind: "fanout", count: units.length, max: cap, policy: onCap },
			ctx,
		);
		if (onCap === "halt")
			throw new UnitFailed(`fanout cap: ${units.length} unidades > ${cap}`);
		units = units.slice(0, cap);
	}
	const { waves, cycle } = scheduleWaves(units);
	if (cycle)
		throw new UnitFailed("fanout: ciclo en deps (no se puede ordenar)");
	for (const wave of waves) {
		const got = await runWithConcurrency(
			wave,
			loop.concurrency ?? 1,
			loop.failFast === true,
			runOne,
		);
		for (const o of got) if (o) outputs.push(o);
	}
}

/** Waves por deps (Kahn). deps invalid → throw; ciclo → cycle:true. */
function scheduleWaves(units: Unit[]): { waves: Unit[][]; cycle: boolean } {
	const idOf = (u: Unit) => u.id ?? u.label;
	const ids = new Set(units.map(idOf));
	for (const u of units) {
		for (const d of u.deps ?? []) {
			if (!ids.has(d)) throw new UnitFailed(`fanout: dep "${d}" no existe`);
		}
	}
	const dependents = new Map<string, Unit[]>();
	for (const u of units) {
		for (const d of u.deps ?? []) {
			if (!ids.has(d)) continue;
			const arr = dependents.get(d) ?? [];
			arr.push(u);
			dependents.set(d, arr);
		}
	}
	const indeg = new Map<string, number>();
	for (const u of units)
		indeg.set(idOf(u), (u.deps ?? []).filter((d) => ids.has(d)).length);

	const waves: Unit[][] = [];
	let ready = units.filter((u) => (indeg.get(idOf(u)) ?? 0) === 0);
	let processed = 0;
	while (ready.length) {
		waves.push(ready);
		processed += ready.length;
		const next: Unit[] = [];
		for (const done of ready) {
			for (const dep of dependents.get(idOf(done)) ?? []) {
				const d = (indeg.get(idOf(dep)) ?? 0) - 1;
				indeg.set(idOf(dep), d);
				if (d === 0) next.push(dep);
			}
		}
		ready = next;
	}
	return { waves, cycle: processed < units.length };
}

/** Corre `units` con techo `concurrency`. failFast: la 1ª falla lanza (cancela). */
async function runWithConcurrency(
	units: Unit[],
	concurrency: number,
	failFast: boolean,
	runOne: (u: Unit) => Promise<Output | undefined>,
): Promise<(Output | undefined)[]> {
	const results: (Output | undefined)[] = new Array(units.length);
	let cursor = 0;
	let cancelled = false;
	const worker = async (): Promise<void> => {
		while (true) {
			if (cancelled) return;
			const idx = cursor++;
			if (idx >= units.length) return;
			try {
				results[idx] = await runOne(units[idx]!);
			} catch (e) {
				if (failFast) {
					cancelled = true;
					throw e;
				}
				results[idx] = undefined; // collect-all: la unidad halt, el run sobrevive
			}
		}
	};
	const n = Math.max(1, Math.min(concurrency, units.length));
	const workers = Array.from({ length: n }, () => worker());
	try {
		await Promise.all(workers);
	} catch {
		// failFast: la 1ª UnitFailed ya está propagada al caller vía throw.
	}
	return results;
}

// ---------------------------------------------------------------------------
// iterate
// ---------------------------------------------------------------------------

async function execIterate(
	loop: IterateDef,
	state: RunState,
	host: WorkflowHost,
	cap: number,
	onCap: LoopOnCap,
	stageRef: { name: string; skill: string },
	ctx: LifecycleContext,
	runOne: (u: Unit) => Promise<Output | undefined>,
	outputs: Output[],
): Promise<string | undefined> {
	const accumulated: Output[] = [];
	while (accumulated.length < cap) {
		const u = loop.next({
			cwd: host.cwd,
			artifact: currentArtifact(state),
			state,
			accumulated,
			index: accumulated.length,
		});
		if (!u) break;
		try {
			const o = await runOne(u);
			if (o) {
				outputs.push(o);
				accumulated.push(o);
			}
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
	}
	if (accumulated.length >= cap) {
		await fire(
			"onLoopCap",
			stageRef,
			{ kind: "iterate", count: accumulated.length, max: cap, policy: onCap },
			ctx,
		);
		if (onCap === "halt") return `iterate cap: alcanzó ${cap}`;
	}
	return undefined;
}
