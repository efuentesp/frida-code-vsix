import type {
	AutomaticConflictChoice,
	SyncConflictRequest,
} from "../orchestration/operation-result";
import {
	getGitOperationState,
	getHeadCommit,
	gitCommit,
	gitExec,
	gitFetch,
	gitProbe,
	gitPush,
	gitStatus,
	listUnmergedEntries,
} from "./git";

export interface ConflictValidationFailure {
	code: "blocked_validation" | "blocked_secret" | "approval_required";
	message: string;
	packages?: string[];
}

export type ConflictResolutionResult =
	| { kind: "resolved"; committed: boolean }
	| { kind: "stale"; message: string }
	| {
			kind: "blocked";
			message: string;
			code?: ConflictValidationFailure["code"];
			packages?: string[];
	  }
	| { kind: "failed"; message: string; pushFailed?: boolean };

export interface ConflictResolutionOptions {
	repoPath: string;
	request: SyncConflictRequest;
	choice: AutomaticConflictChoice;
	beforeCommit: () => Promise<ConflictValidationFailure | undefined>;
}

async function refOid(
	repoPath: string,
	ref: string,
): Promise<string | undefined> {
	const result = await gitProbe(repoPath, [
		"show-ref",
		"--hash",
		"--verify",
		ref,
	]);
	return result.ok && result.stdout.trim() ? result.stdout.trim() : undefined;
}

async function abortMergeIfActive(repoPath: string): Promise<void> {
	const operation = await getGitOperationState(repoPath);
	if (operation.isMerging) {
		await gitExec(repoPath, ["merge", "--abort"]).catch(() => undefined);
	}
}

/**
 * Resolve an already-published device branch into the shared branch. Product
 * terms stay above this module; stage selection is the only Git-specific part.
 */
export async function resolveAutomaticConflict(
	options: ConflictResolutionOptions,
): Promise<ConflictResolutionResult> {
	const { repoPath, request, choice, beforeCommit } = options;
	let committed = false;
	try {
		let status = await gitStatus(repoPath);
		if (
			status.branch !== request.sharedBranch ||
			status.hasUncommittedChanges ||
			status.isMerging ||
			status.isRebasing ||
			status.hasConflicts
		) {
			return {
				kind: "blocked",
				message:
					"Repository changed while the conflict choice was open. Keep it clean on the shared branch, then run /pisync again.",
			};
		}

		await gitFetch(repoPath);
		const [sharedHead, deviceHead] = await Promise.all([
			refOid(repoPath, `refs/remotes/origin/${request.sharedBranch}`),
			refOid(repoPath, `refs/remotes/origin/${request.deviceBranch}`),
		]);
		if (!sharedHead || !deviceHead) {
			return {
				kind: "stale",
				message:
					"The shared or current-device branch no longer exists on origin.",
			};
		}
		if (
			(sharedHead !== request.sharedHead && request.sharedHead !== undefined) ||
			deviceHead !== request.deviceHead
		) {
			return {
				kind: "stale",
				message:
					"The shared or current-device branch changed while the conflict choice was open. Review the new conflict before choosing again.",
			};
		}

		status = await gitStatus(repoPath);
		if (status.commit !== sharedHead || status.hasUncommittedChanges) {
			return {
				kind: "blocked",
				message:
					"The local shared branch is no longer exactly at origin. Run /pisync again before resolving this conflict.",
			};
		}

		try {
			await gitExec(repoPath, [
				"merge",
				"--no-commit",
				"--no-ff",
				`origin/${request.deviceBranch}`,
			]);
		} catch {
			const entries = await listUnmergedEntries(repoPath);
			if (entries.length === 0)
				throw new Error("Git merge failed before creating a conflict.");
		}

		const selectedStage = choice === "use_remote" ? 2 : 3;
		const entries = await listUnmergedEntries(repoPath);
		for (const entry of entries) {
			if (entry.stages.includes(selectedStage)) {
				const checkoutSide = choice === "use_remote" ? "--ours" : "--theirs";
				await gitExec(repoPath, [
					"checkout",
					checkoutSide,
					"--",
					entry.relativePath,
				]);
			} else {
				await gitExec(repoPath, [
					"rm",
					"--ignore-unmatch",
					"--",
					entry.relativePath,
				]);
			}
		}
		await gitExec(repoPath, ["add", "-A"]);
		if ((await listUnmergedEntries(repoPath)).length > 0) {
			throw new Error(
				"Git still reports unresolved paths after conflict selection.",
			);
		}

		const validationError = await beforeCommit();
		if (validationError) {
			await abortMergeIfActive(repoPath);
			return {
				kind: "blocked",
				code: validationError.code,
				message: validationError.message,
				packages: validationError.packages,
			};
		}

		const before = await getHeadCommit(repoPath);
		await gitCommit(repoPath, "pi-sync: resolve conflict using selected paths");
		committed = (await getHeadCommit(repoPath)) !== before;
		try {
			await gitPush(repoPath, request.sharedBranch);
			return { kind: "resolved", committed };
		} catch (error) {
			// A normal push rejection means a newer shared branch appeared after the
			// choice. Restore only our clean merge with --merge; unlike --hard this
			// refuses to discard any concurrent worktree changes.
			await gitFetch(repoPath).catch(() => undefined);
			try {
				await gitExec(repoPath, [
					"reset",
					"--merge",
					`origin/${request.sharedBranch}`,
				]);
				return {
					kind: "stale",
					message:
						"The shared branch changed before the resolved merge could be pushed. The local merge was reverted safely; review the refreshed conflict.",
				};
			} catch {
				return {
					kind: "failed",
					pushFailed: true,
					message: `Push was rejected and the local merge could not be reverted safely: ${error instanceof Error ? error.message : "Unknown error"}`,
				};
			}
		}
	} catch (error) {
		if (!committed) await abortMergeIfActive(repoPath);
		return {
			kind: "failed",
			pushFailed: committed,
			message:
				error instanceof Error
					? error.message
					: "Unexpected Git conflict resolution failure.",
		};
	}
}
