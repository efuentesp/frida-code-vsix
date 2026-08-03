import {
	gitCommit,
	gitFastForward,
	gitFetch,
	gitRebase,
	gitStatus,
} from "../system/git";
import type { GitStatus } from "../system/git";

export interface PullIntegrationPhaseOptions {
	repoPath: string;
	branch: string;
	timeoutMs: number;
	capturedLocalChanges: boolean;
	signal?: AbortSignal;
	onProgress?: (message: string) => void;
	onGitCommandStart?: (command: string, timeoutMs: number) => void;
}

export type PullIntegrationPhaseResult =
	| { kind: "rebased" }
	| { kind: "fast_forwarded"; pulled: boolean }
	| { kind: "rebase_conflict" }
	| { kind: "failed"; message: string };

export type PullWorktreePhaseResult =
	| { kind: "ready"; status: GitStatus; committedRepositoryChanges: boolean }
	| { kind: "blocked"; message: string }
	| { kind: "failed"; message: string };

export type PullCaptureCommitPhaseResult =
	| { kind: "committed" }
	| { kind: "failed"; message: string };

/** Inspect and preserve a dirty configured worktree without acquiring a sync lock. */
export async function preparePullWorktree(
	repoPath: string,
	status: GitStatus,
	onProgress?: (message: string) => void,
): Promise<PullWorktreePhaseResult> {
	if (status.isRebasing || status.isMerging) {
		return {
			kind: "blocked",
			message: "Repository is in rebase/merge state. Resolve conflicts first.",
		};
	}
	if (!status.hasUncommittedChanges) {
		return { kind: "ready", status, committedRepositoryChanges: false };
	}
	try {
		onProgress?.(
			"Running: git commit -m pi-sync: preserve repository changes before pull...",
		);
		await gitCommit(
			repoPath,
			"pi-sync: preserve repository changes before pull",
		);
		return {
			kind: "ready",
			status: await gitStatus(repoPath),
			committedRepositoryChanges: true,
		};
	} catch (error) {
		return {
			kind: "failed",
			message: `Could not commit repository changes before pull: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/** Commit already-captured local changes without acquiring a sync lock. */
export async function commitCapturedChangesBeforePull(
	repoPath: string,
	onProgress?: (message: string) => void,
): Promise<PullCaptureCommitPhaseResult> {
	try {
		onProgress?.(
			"Running: git commit -m pi-sync: capture local changes before pull...",
		);
		await gitCommit(repoPath, "pi-sync: capture local changes before pull");
		return { kind: "committed" };
	} catch (error) {
		return {
			kind: "failed",
			message: `Could not commit local changes before pull: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/** Fetch and integrate the configured branch without acquiring a sync lock. */
export async function integratePulledHead(
	options: PullIntegrationPhaseOptions,
): Promise<PullIntegrationPhaseResult> {
	const { repoPath, branch, timeoutMs, capturedLocalChanges, signal } = options;
	const timeoutSeconds = timeoutMs / 1000;
	const gitOptions = { timeout: timeoutMs, signal };
	const reportCommand = (command: string) => {
		options.onProgress?.(
			`Running: ${command} (timeout: ${timeoutSeconds}s)...`,
		);
		options.onGitCommandStart?.(command, timeoutMs);
	};

	try {
		const command = "git fetch origin";
		reportCommand(command);
		await gitFetch(repoPath, gitOptions);
	} catch (error) {
		return {
			kind: "failed",
			message: `git fetch failed: ${error instanceof Error ? error.message : "Unknown"}`,
		};
	}

	if (capturedLocalChanges) {
		try {
			const command = `git rebase origin/${branch}`;
			reportCommand(command);
			const rebase = await gitRebase(repoPath, branch, gitOptions);
			return rebase.conflict
				? { kind: "rebase_conflict" }
				: { kind: "rebased" };
		} catch (error) {
			return {
				kind: "failed",
				message: `Rebase failed after committing local changes: ${error instanceof Error ? error.message : "Unknown error"}`,
			};
		}
	}

	try {
		const command = `git merge --ff-only origin/${branch}`;
		reportCommand(command);
		const { pulled } = await gitFastForward(repoPath, branch, gitOptions);
		return { kind: "fast_forwarded", pulled };
	} catch (error) {
		return {
			kind: "failed",
			message: `git fast-forward failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}
