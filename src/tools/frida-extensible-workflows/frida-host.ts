// frida-extensible-workflows — host de orquestación: persistencia + journal +
// checkpoints + budget + retry/resume (Fase 3/5/6).
//
// Piezas:
//   - createJournaledBridge: WorkflowBridge con replay (store.replay / replaySources)
//     + journal (store.complete) + checkpoints (awaitCheckpoint/answerCheckpoint)
//     + budget (agentLaunches hard). Determinismo: operaciones completadas devuelven
//     su valor almacenado sin re-ejecutarse.
//   - runWithStore: corre runWorkflow sobre un RunStore existente, persiste estado
//     terminal (completed/failed/stopped/budget_exhausted) + usage.
//   - runWorkflowInStore: crea RunStore + snapshot + runWithStore.
//   - retryWorkflow: run HIJA que replays los paths completados del SOURCE.
//   - resumeWorkflow: continúa una run budget_exhausted (replay propio + budget patch).

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	agentIdentityPath,
	executeShellCommand,
	readShellResult,
	runWorkflow,
	shellIdentityPath,
	type WorkflowProgressEvent,
} from "./core/execution";
import {
	RunStore,
	structuralPath,
	type PersistedRun,
} from "./core/persistence";
import {
	budgetUsage,
	exhaustedBudgetDimensions,
	mergeBudget,
	validateBudgetPatch,
} from "./core/budget";
import type {
	AgentIdentity,
	JsonValue,
	LaunchSnapshot,
	ShellIdentity,
	ShellOptions,
	ShellResult,
	WorkflowBudget,
	WorkflowBudgetPatch,
	WorkflowBudgetUsage,
	WorkflowBridge,
	WorkflowMetadata,
} from "./core/types";
import { WorkflowError } from "./core/types";
import { fridaHome } from "./frida-paths";
import { registerCheckpoint, unregisterCheckpoint } from "./frida-delivery";
import { unpackSpawnResult, type SpawnAgentFn } from "./frida-agent-execution";
import type { MoatFlags } from "./moat-factories";

export type CheckpointNotifier = (checkpoint: {
	runId: string;
	name: string;
	prompt: string;
	context: JsonValue;
}) => void;

export interface JournaledBridgeOptions {
	store: RunStore;
	spawnAgent: SpawnAgentFn;
	cwd: string;
	foreground?: boolean;
	budget?: WorkflowBudget;
	onCheckpoint?: CheckpointNotifier;
	/** Usage acumulado (mutable). Resume lo re-hidrata; run nueva empieza en 0. */
	usage?: WorkflowBudgetUsage;
	/** Stores adicionales para replay (antes que store). Retry pasa [sourceStore]. */
	replaySources?: readonly RunStore[];
	/** Fase 6: factory de spawners por cwd (para que los agentes de un withWorktree
	 *  corran en el path del worktree). Si se omite, withWorktree crea el worktree
	 *  pero los agentes heredan el cwd principal. */
	createSpawnerForCwd?: (cwd: string) => SpawnAgentFn;
}

/** Crea un git worktree aislado para un scope withWorktree. */
export function createWorkflowWorktree(
	cwd: string,
	owner: string,
	home?: string,
): { path: string; branch: string } {
	const base = home
		? join(home, ".frida-worktrees")
		: join(tmpdir(), "frida-wf-worktrees");
	mkdirSync(base, { recursive: true });
	const branch = `wf-${owner}-${randomUUID().slice(0, 8)}`;
	const path = join(base, branch);
	try {
		execSync(
			`git -C ${JSON.stringify(cwd)} worktree add -b ${branch} ${JSON.stringify(path)}`,
			{
				stdio: "pipe",
			},
		);
	} catch (error) {
		throw new WorkflowError(
			"WORKTREE_FAILED",
			`No se pudo crear el worktree '${owner}': ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return { path, branch };
}

export function createJournaledBridge(
	opts: JournaledBridgeOptions,
): WorkflowBridge {
	const usage = opts.usage ?? budgetUsage({ agentLaunches: 0 });
	const worktreeSpawners = new Map<string, SpawnAgentFn>();
	return {
		agent: async (prompt, options, signal, identity: AgentIdentity) => {
			const path = agentIdentityPath(identity);
			for (const source of opts.replaySources ?? []) {
				const fromSource = await source.replay(path);
				if (fromSource) return fromSource.value;
			}
			const replayed = await opts.store.replay(path);
			if (replayed) return replayed.value;
			if (opts.budget) {
				const exhausted = exhaustedBudgetDimensions(opts.budget, usage);
				if (exhausted.length) {
					throw new WorkflowError(
						"BUDGET_EXHAUSTED",
						`Budget agotado (hard): ${exhausted.join(", ")}`,
					);
				}
			}
			const scopedSpawner =
				(identity.worktreeOwner
					? worktreeSpawners.get(identity.worktreeOwner)
					: undefined) ?? opts.spawnAgent;
			// Issue #18: el spawner devuelve value + accounting (+ durationMs).
			// Acumulamos tokens/costUsd/durationMs en `usage` para que el reporte y
			// el budget hard de tokens reflejen el consumo real de los sub-agentes.
			const startedAt = Date.now();
			const raw = await scopedSpawner(prompt, options, signal, identity);
			const { value, accounting, durationMs } = unpackSpawnResult(raw);
			usage.agentLaunches += 1;
			if (accounting) {
				usage.tokens += accounting.input + accounting.output;
				usage.costUsd += accounting.cost;
			}
			usage.durationMs += durationMs ?? Date.now() - startedAt;
			await opts.store.complete(path, value);
			return value;
		},
		shell: async (
			command: string,
			options: ShellOptions,
			signal: AbortSignal,
			identity: ShellIdentity,
		): Promise<ShellResult> => {
			const path = shellIdentityPath(identity);
			for (const source of opts.replaySources ?? []) {
				const fromSource = await source.replay(path);
				if (fromSource) return readShellResult(fromSource.value);
			}
			const replayed = await opts.store.replay(path);
			if (replayed) return readShellResult(replayed.value);
			const result = await executeShellCommand(command, options, signal, opts.cwd);
			// SAFETY: ShellResult es un plain object JSON-serializable (strings y
			// enteros); el journal JsonValue lo acepta sin pérdida y readShellResult
			// lo reconstruye idéntico en replay.
			await opts.store.complete(path, result as unknown as JsonValue);
			return result;
		},
		checkpoint: async (input, signal) => {
			if (opts.foreground) {
				throw new WorkflowError(
					"RESUME_INCOMPATIBLE",
					"Los checkpoints en foreground requieren la UI del webview (Fase 7); usa un workflow en background para checkpoint().",
				);
			}
			const name = typeof input.name === "string" ? input.name : "";
			const prompt = typeof input.prompt === "string" ? input.prompt : "";
			const context = (input.context ?? null) as JsonValue;
			const path = structuralPath("checkpoint", name);
			const replayed = await opts.store.awaitCheckpoint({
				name,
				prompt,
				context,
				path,
			});
			if (replayed !== undefined) return replayed;
			const runId = opts.store.runId;
			opts.onCheckpoint?.({ runId, name, prompt, context });
			const decision = await new Promise<boolean>((resolve, reject) => {
				registerCheckpoint(runId, name, { resolve, reject });
				const onAbort = () => {
					unregisterCheckpoint(runId, name);
					reject(new WorkflowError("CANCELLED", "Workflow cancelled"));
				};
				if (signal.aborted) {
					onAbort();
					return;
				}
				signal.addEventListener("abort", onAbort, { once: true });
			});
			await opts.store.answerCheckpoint(name, decision);
			return decision;
		},
		worktree: async (owner, _signal) => {
			const wt = createWorkflowWorktree(opts.cwd, owner, opts.store.home);
			if (opts.createSpawnerForCwd) {
				worktreeSpawners.set(owner, opts.createSpawnerForCwd(wt.path));
			}
			return wt;
		},
	};
}

// ---------------------------------------------------------------------------
// Ejecución sobre un RunStore existente
// ---------------------------------------------------------------------------

interface RunWithStoreOptions {
	script: string;
	args: JsonValue;
	spawnAgent: SpawnAgentFn;
	signal?: AbortSignal;
	foreground?: boolean;
	budget?: WorkflowBudget;
	onCheckpoint?: CheckpointNotifier;
	usage?: WorkflowBudgetUsage;
	replaySources?: readonly RunStore[];
	createSpawnerForCwd?: (cwd: string) => SpawnAgentFn;
	/** Progreso en vivo (issue #7): agent_start/end, group_start/end, phase. */
	onProgress?: (event: WorkflowProgressEvent) => void;
}

async function runWithStore(
	store: RunStore,
	run: PersistedRun,
	opts: RunWithStoreOptions,
): Promise<{ runId: string; result: JsonValue }> {
	const usage = budgetUsage(opts.usage ?? {});
	const bridge = createJournaledBridge({
		store,
		spawnAgent: opts.spawnAgent,
		cwd: store.cwd,
		usage,
		...(opts.foreground === undefined ? {} : { foreground: opts.foreground }),
		...(opts.budget ? { budget: opts.budget } : {}),
		...(opts.onCheckpoint ? { onCheckpoint: opts.onCheckpoint } : {}),
		...(opts.replaySources ? { replaySources: opts.replaySources } : {}),
		...(opts.createSpawnerForCwd
			? { createSpawnerForCwd: opts.createSpawnerForCwd }
			: {}),
	});
	const exec = runWorkflow(
		opts.script,
		opts.args,
		bridge,
		opts.signal,
		opts.onProgress,
	);
	try {
		const result = await exec.result;
		await store.saveState({ ...run, state: "completed", usage });
		return { runId: store.runId, result };
	} catch (error) {
		const code = (error as { code?: unknown })?.code;
		const message = error instanceof Error ? error.message : String(error);
		const cancelled = code === "CANCELLED" || /CANCEL/i.test(message);
		const budgetExhausted = code === "BUDGET_EXHAUSTED";
		await store.saveState({
			...run,
			state: cancelled
				? "stopped"
				: budgetExhausted
					? "budget_exhausted"
					: "failed",
			usage,
			...(cancelled || budgetExhausted
				? {}
				: {
						error: { code: "AGENT_FAILED", message },
						failedAt: new Date().toISOString(),
					}),
		} as PersistedRun);
		throw error;
	}
}

// ---------------------------------------------------------------------------
// Lanzamiento, retry y resume
// ---------------------------------------------------------------------------

export interface RunWorkflowInStoreOptions {
	name: string;
	description?: string;
	script: string;
	args: JsonValue;
	cwd: string;
	sessionId: string;
	spawnAgent: SpawnAgentFn;
	signal?: AbortSignal;
	home?: string;
	runId?: string;
	foreground?: boolean;
	budget?: WorkflowBudget;
	onCheckpoint?: CheckpointNotifier;
	/** Progreso en vivo (issue #7). */
	onProgress?: (event: WorkflowProgressEvent) => void;
	/** Stores adicionales para replay (retry pasa [sourceStore]). */
	replaySources?: readonly RunStore[];
	createSpawnerForCwd?: (cwd: string) => SpawnAgentFn;
	/** M1 #134 (D4): meta del patrón builtin que lanzó esta run (incluye las
	 *  flags `moat` — shallow copy de builtin.meta hecha por launch). Se
	 *  persiste en snapshot.metadata.patternMeta para que retry/resume
	 *  reconstruyan las factories del moat de las hijas. Opcional. */
	patternMeta?: JsonValue;
}

export interface RunWorkflowInStoreResult {
	runId: string;
	result: JsonValue;
}

export async function runWorkflowInStore(
	opts: RunWorkflowInStoreOptions,
): Promise<RunWorkflowInStoreResult> {
	const home = opts.home ?? fridaHome();
	const runId = opts.runId ?? randomUUID();
	const store = new RunStore(opts.cwd, opts.sessionId, runId, home);
	const metadata: WorkflowMetadata = {
		name: opts.name,
		...(opts.description ? { description: opts.description } : {}),
		// M1 #134 (D4): el patternMeta viaja en el snapshot — retry/resume lo
		// leen para reconstruir el moat (loadPatternMeta).
		...(opts.patternMeta === undefined ? {} : { patternMeta: opts.patternMeta }),
	};
	// SAFETY: el snapshot literal cumple la shape de LaunchSnapshot (script/args/
	// metadata JSON-safe; settings mínimo válido con concurrency 1); el cast
	// sólo acomoda los arrays vacíos tipados del core sin poblarlos en launch.
	const snapshot = {
		script: opts.script,
		args: opts.args,
		metadata,
		settings: { concurrency: 1 },
		models: [],
		tools: [],
		agentTypes: [],
		schemas: [],
		launchMode: opts.foreground ? "foreground" : "background",
	} as unknown as LaunchSnapshot;
	const run: PersistedRun = {
		id: runId,
		workflowName: opts.name,
		cwd: opts.cwd,
		sessionId: opts.sessionId,
		state: "running",
		agentSessions: [],
		agents: [],
		...(opts.budget ? { budget: opts.budget, budgetVersion: 1 } : {}),
	} as PersistedRun;
	await store.create(run, snapshot);
	const { result } = await runWithStore(store, run, {
		script: opts.script,
		args: opts.args,
		spawnAgent: opts.spawnAgent,
		...(opts.signal ? { signal: opts.signal } : {}),
		...(opts.foreground === undefined ? {} : { foreground: opts.foreground }),
		...(opts.budget ? { budget: opts.budget } : {}),
		...(opts.onCheckpoint ? { onCheckpoint: opts.onCheckpoint } : {}),
		...(opts.replaySources ? { replaySources: opts.replaySources } : {}),
		...(opts.createSpawnerForCwd
			? { createSpawnerForCwd: opts.createSpawnerForCwd }
			: {}),
		...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
	});
	return { runId, result };
}

/**
 * M1 #134 (D4): extrae el `moat` del patternMeta persistido en el snapshot
 * (lo que launch escribió desde builtin.meta). Runs lanzadas sin el campo o
 * con forma inesperada → undefined / flags filtradas: el caller compone la
 * lista BASE de factories — degradación backwards-compatible, nunca throw.
 */
export function loadPatternMeta(
	snapshot: Readonly<LaunchSnapshot>,
): Readonly<{ moat?: MoatFlags }> | undefined {
	const meta = snapshot.metadata?.patternMeta;
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
	const raw = (meta as { moat?: unknown }).moat;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { moat: {} };
	const lens = (raw as { lens?: unknown }).lens;
	const codebaseIndex = (raw as { codebaseIndex?: unknown }).codebaseIndex;
	return {
		moat: {
			...(typeof lens === "boolean" ? { lens } : {}),
			...(typeof codebaseIndex === "boolean" ? { codebaseIndex } : {}),
		},
	};
}

export interface RecoveryOptions {
	cwd: string;
	sessionId: string;
	spawnAgent: SpawnAgentFn;
	signal?: AbortSignal;
	home?: string;
	onCheckpoint?: CheckpointNotifier;
	/** Progreso en vivo (issue #7): agent_start/end, group_start/end, phase. */
	onProgress?: (event: WorkflowProgressEvent) => void;
}

/**
 * Retry: crea una run HIJA que replays los paths completados del SOURCE
 * (replaySources=[sourceStore]) y ejecuta los incompletos. El SOURCE debe ser
 * terminal fallida (failed/stopped).
 */
export async function retryWorkflow(
	sourceRunId: string,
	opts: RecoveryOptions,
): Promise<RunWorkflowInStoreResult> {
	const home = opts.home ?? fridaHome();
	const sourceStore = new RunStore(opts.cwd, opts.sessionId, sourceRunId, home);
	const source = await sourceStore.load();
	const state = source.run.state;
	if (!["failed", "stopped"].includes(state)) {
		throw new WorkflowError(
			"RESUME_INCOMPATIBLE",
			`workflow_retry requiere una run terminal fallida (state=${state}); las runs budget_exhausted usan workflow_resume.`,
		);
	}
	return runWorkflowInStore({
		name: source.run.workflowName,
		script: source.snapshot.script,
		args: source.snapshot.args,
		cwd: opts.cwd,
		sessionId: opts.sessionId,
		spawnAgent: opts.spawnAgent,
		...(opts.signal ? { signal: opts.signal } : {}),
		home,
		foreground: false,
		replaySources: [sourceStore],
		...(source.run.budget ? { budget: source.run.budget } : {}),
		...(opts.onCheckpoint ? { onCheckpoint: opts.onCheckpoint } : {}),
		...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
		// M1 #134 (D4): la run HIJA hereda el patternMeta del source — un
		// retry-de-retry reconstruye el mismo moat (cadena conservada).
		...(source.snapshot.metadata.patternMeta === undefined
			? {}
			: { patternMeta: source.snapshot.metadata.patternMeta }),
	});
}

/**
 * Resume: continúa una run budget_exhausted. Re-hidrata usage + (opcional) aplica
 * un budget patch, marca running, y re-corre con replay del propio journal (las
 * ops completadas replayan; las incompletas se ejecutan). Sin patch y con el mismo
 * tope, la op que agotó volvería a fallar → el caller debe relajar el budget.
 */
export async function resumeWorkflow(
	runId: string,
	opts: RecoveryOptions & { budgetPatch?: unknown },
): Promise<RunWorkflowInStoreResult> {
	const home = opts.home ?? fridaHome();
	const store = new RunStore(opts.cwd, opts.sessionId, runId, home);
	const loaded = await store.load();
	const state = loaded.run.state;
	if (state !== "budget_exhausted") {
		throw new WorkflowError(
			"RESUME_INCOMPATIBLE",
			`workflow_resume es para runs budget_exhausted (state=${state}); las failed usan workflow_retry.`,
		);
	}
	let budget = loaded.run.budget;
	if (opts.budgetPatch !== undefined) {
		budget = mergeBudget(budget, validateBudgetPatch(opts.budgetPatch));
	}
	const usage = loaded.run.usage ?? budgetUsage();
	// Limpia error/failedAt previos al reanudar.
	const { error: _omitError, failedAt: _omitFailedAt, ...runRest } = loaded.run;
	const run: PersistedRun = {
		...runRest,
		state: "running",
		...(budget ? { budget } : {}),
	} as PersistedRun;
	// runWithStore NO recrea el store → el journal existente se preserva (replay).
	// M1 #134 (D4): el snapshot tampoco se reescribe — el patternMeta persistido
	// por launch sigue disponible para futuros retry/resume de esta misma run.
	const { result } = await runWithStore(store, run, {
		script: loaded.snapshot.script,
		args: loaded.snapshot.args,
		spawnAgent: opts.spawnAgent,
		...(opts.signal ? { signal: opts.signal } : {}),
		foreground: false,
		usage,
		...(budget ? { budget } : {}),
		...(opts.onCheckpoint ? { onCheckpoint: opts.onCheckpoint } : {}),
		...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
	});
	return { runId, result };
}
