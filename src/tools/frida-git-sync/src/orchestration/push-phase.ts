import { gitFetch, gitRebase, gitRemoteRefExists } from "../system/git";

export interface PushIntegrationPhaseOptions {
	repoPath: string;
	branch: string;
}

export type PushIntegrationPhaseResult =
	| { kind: "ready_to_push" }
	| { kind: "rebase_conflict" }
	| { kind: "failed"; message: string };

/** Fetch and rebase a committed push without acquiring a sync lock. */
export async function integrateCommittedPush(
	options: PushIntegrationPhaseOptions,
): Promise<PushIntegrationPhaseResult> {
	const { repoPath, branch } = options;
	try {
		await gitFetch(repoPath);
	} catch (error) {
		return {
			kind: "failed",
			message: `git fetch failed after local commit: ${error instanceof Error ? error.message : "Unknown"}. Local commit is preserved.`,
		};
	}

	if (!(await gitRemoteRefExists(repoPath, branch))) {
		return { kind: "ready_to_push" };
	}
	try {
		const rebase = await gitRebase(repoPath, branch);
		return rebase.conflict
			? { kind: "rebase_conflict" }
			: { kind: "ready_to_push" };
	} catch (error) {
		return {
			kind: "failed",
			message: `Rebase failed: ${error instanceof Error ? error.message : "Unknown"}`,
		};
	}
}
