// frida-workflow — executeUnit: ejecución de UNA sesión hija (factoreada, Fase 6).
//
// Usada por el path simple de runStage (una unidad) y por el loop-driver (una
// por unidad de fanout/iterate). spawn → collect → parse → validate(outputSchema)
// → retry/halt. No dispara lifecycle (lo hace el caller: onStageEnd o onUnitEnd).

import type {
	CollectCtx,
	Output,
	StageDef,
	StageSnapshot,
	WorkflowHost,
} from "./types";
import { summarizeIssues, validateSchema } from "./schema";

export interface UnitExecResult {
	ok: boolean;
	error?: string;
	output?: Output;
	primaryHandle?: string;
	retries?: number;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

export async function executeUnit(
	host: WorkflowHost,
	prompt: string,
	stageName: string,
	stage: StageDef,
	cwd: string,
	sessionDir: string,
	signal: AbortSignal | undefined,
	preSnapshot: StageSnapshot | undefined,
): Promise<UnitExecResult> {
	const spec = stage.outcome;
	const skill = stage.skill ?? stageName;
	const maxRetries = clamp(stage.maxRetries ?? 1, 1, 3);
	const onInvalid = stage.onInvalid ?? "retry";

	let error: string | undefined;
	let primaryHandle: string | undefined;
	let output: Output | undefined;
	let retries = 0;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		error = undefined;
		primaryHandle = undefined;
		let retryNeeded = false;
		try {
			await host.spawnChild({
				prompt,
				signal,
				sessionDir,
				withSession: async (child) => {
					if (!spec) return;
					const ctx: CollectCtx = {
						messages: child.getMessages(),
						cwd,
						stage: stageName,
						skill,
						preSnapshot,
					};
					const res = spec.collector(ctx);
					if (res.kind === "fatal") {
						error = res.message;
						return;
					}
					const data = spec.parser
						? spec.parser(res.artifacts, ctx)
						: undefined;
					if (stage.outputSchema) {
						const v = await validateSchema(stage.outputSchema, data);
						if (!v.ok) {
							const msg = `outputSchema rechazado: ${summarizeIssues(v.issues)}`;
							if (onInvalid === "halt" || attempt >= maxRetries - 1)
								error = msg;
							else retryNeeded = true;
							return;
						}
					}
					const primary =
						res.artifacts.find((a) => a.role === "primary") ?? res.artifacts[0];
					if (primary?.handle.kind === "fs")
						primaryHandle = primary.handle.path;
					output = {
						kind: spec.name ?? stageName,
						data,
						artifacts: res.artifacts,
					};
				},
			});
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		if (error) break;
		if (!retryNeeded) break;
		retries++;
	}

	return { ok: !error, error, output, primaryHandle, retries };
}
