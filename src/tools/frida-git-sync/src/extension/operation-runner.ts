import type { RunOptions, RunResult, SyncPhase } from "../orchestration/operation-result";

export interface OperationRunnerHost {
	formatProgress: (elapsedMs: number, message: string) => string;
	publishProgress: (message: string) => void;
	onCancel?: (cancel: () => void) => () => void;
	onStopping?: () => void;
	onCancelled?: () => void;
}

export interface OperationRunnerOptions {
	execute: (options: RunOptions) => Promise<RunResult>;
	host: OperationRunnerHost;
	runOptions?: RunOptions;
	runTimeoutMs: number;
	commandSettleGraceMs: number;
	elapsedRefreshMs: number;
	cancellationNoticeDelayMs: number;
}

/**
 * Run one sync operation with progress publication, cancellation, and watchdogs.
 * The host owns all UI behavior; this runner knows only operation callbacks and
 * generic result metadata, not Git, state, packages, or conflict handling.
 */
export async function runOperation(
	options: OperationRunnerOptions,
): Promise<RunResult | null> {
	const {
		execute,
		host,
		runOptions = {},
		runTimeoutMs,
		commandSettleGraceMs,
		elapsedRefreshMs,
		cancellationNoticeDelayMs,
	} = options;
	const startedAt = Date.now();
	let currentMessage = "Checking sync state...";
	const controller = new AbortController();
	let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
	let runDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
	let elapsedTimer: ReturnType<typeof setInterval> | undefined;
	let removeCancelListener: (() => void) | undefined;
	let watchdogResolve: ((result: RunResult) => void) | undefined;
	let cancellationResolve: ((result: RunResult) => void) | undefined;
	let cancellationNotification: Promise<void> | undefined;
	let lastPublishedProgress: string | undefined;
	let watchdogFired = false;
	let cancelled = false;
	let currentPhase: SyncPhase = "preflight";
	let commandExecution: Promise<RunResult> | undefined;
	let execution: Promise<RunResult> | undefined;
	const watchdog = new Promise<RunResult>((resolve) => {
		watchdogResolve = resolve;
	});
	const cancellation = new Promise<RunResult>((resolve) => {
		cancellationResolve = resolve;
	});
	const publishProgress = () => {
		if (controller.signal.aborted) return;
		const progress = host.formatProgress(
			Date.now() - startedAt,
			currentMessage,
		);
		if (progress === lastPublishedProgress) return;
		lastPublishedProgress = progress;
		host.publishProgress(progress);
	};
	const clearDeadline = () => {
		if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
		deadlineTimer = undefined;
	};
	const stopForTimeout = (result: RunResult) => {
		if (watchdogFired) return;
		watchdogFired = true;
		watchdogResolve?.(result);
		controller.abort();
	};
	const cancel = () => {
		if (controller.signal.aborted) return;
		cancelled = true;
		host.onStopping?.();
		cancellationNotification = new Promise<void>((resolve) =>
			setTimeout(resolve, cancellationNoticeDelayMs),
		).then(() => {
			host.onCancelled?.();
		});
		cancellationResolve?.({
			ok: false,
			code: "partial_failure",
			message: "pi-sync cancelled.",
			reload: false,
			mode: "sync",
			phase: currentPhase,
		});
		controller.abort();
	};
	const startExecution = () => {
		if (execution) return execution;
		runDeadlineTimer = setTimeout(() => {
			stopForTimeout({
				ok: false,
				code: "partial_failure",
				message: `pi-sync exceeded ${runTimeoutMs / 1000} seconds and was stopped during ${currentPhase}.`,
				reload: false,
				mode: "sync",
				phase: currentPhase,
			});
		}, runTimeoutMs);
		commandExecution = execute({
			...runOptions,
			signal: controller.signal,
			onProgress: (phase, message) => {
				if (controller.signal.aborted) return;
				clearDeadline();
				currentPhase = phase;
				currentMessage = message;
				publishProgress();
			},
			onGitCommandStart: (phase, command, timeoutMs) => {
				if (controller.signal.aborted) return;
				clearDeadline();
				currentPhase = phase;
				currentMessage = `Running: ${command} (timeout: ${Math.ceil(timeoutMs / 1000)}s)...`;
				publishProgress();
				deadlineTimer = setTimeout(() => {
					stopForTimeout({
						ok: false,
						code: "git_failed",
						message: `${command} timed out after ${timeoutMs} ms. Sync stopped.`,
						reload: false,
						mode: "sync",
						phase,
					});
				}, timeoutMs + commandSettleGraceMs);
			},
		});
		execution = Promise.race([commandExecution, watchdog, cancellation]);
		return execution;
	};
	const settleAbortedCommand = async () => {
		if (!commandExecution) return;
		await Promise.race([
			commandExecution.then(
				() => undefined,
				() => undefined,
			),
			new Promise<void>((resolve) => setTimeout(resolve, commandSettleGraceMs)),
		]);
	};

	publishProgress();
	elapsedTimer = setInterval(publishProgress, elapsedRefreshMs);
	removeCancelListener = host.onCancel?.(cancel);
	try {
		const result = await startExecution();
		if ((watchdogFired || cancelled) && commandExecution) {
			await settleAbortedCommand();
		}
		if (!controller.signal.aborted || watchdogFired) return result;

		await settleAbortedCommand();
		await cancellationNotification;
		return null;
	} catch (error) {
		if (!controller.signal.aborted) throw error;
		await cancellationNotification;
		return null;
	} finally {
		clearDeadline();
		if (runDeadlineTimer !== undefined) clearTimeout(runDeadlineTimer);
		if (elapsedTimer !== undefined) clearInterval(elapsedTimer);
		removeCancelListener?.();
		controller.abort();
	}
}
