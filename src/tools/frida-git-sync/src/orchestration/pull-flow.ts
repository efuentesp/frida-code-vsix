import {
	ensureConfiguredBranch,
	gitFetch,
	gitProbe,
	gitStatus,
	listUnmergedPaths,
} from "../system/git";
import { compareFiles, hasLocalChanges } from "../sync/inventory";
import type { PackageApproval } from "../system/packages";
import type { PiSyncConfig } from "../sync/config";
import type { SyncState } from "../system/state";
import type {
	CommandResult,
	RunOptions,
	SyncConflictPath,
	SyncConflictRequest,
} from "./operation-result";
import {
	commitCapturedChangesBeforePull,
	integratePulledHead,
	preparePullWorktree,
} from "./pull-phase";

type ConflictCoordinationResult =
	| { kind: "resolved"; message: string }
	| {
			kind: "needs_user";
			conflict: SyncConflictRequest;
			message: string;
	  };

type CaptureResult = {
	hasConflicts: boolean;
	errors: Array<{ file: string; message: string }>;
	denied: string[];
};

export interface PullFlowOptions {
	agentDir: string;
	repoPath: string;
	config: PiSyncConfig;
	state: SyncState;
	packageApproval?: PackageApproval;
	signal?: AbortSignal;
	onProgress?: RunOptions["onProgress"];
	onGitCommandStart?: RunOptions["onGitCommandStart"];
	captureLocalChanges: (
		repoPath: string,
		config: PiSyncConfig,
		state: SyncState,
		preferLocalOnConflicts: boolean,
	) => Promise<CaptureResult>;
	shouldRefreshLocalCapture: (
		status: Awaited<ReturnType<typeof gitStatus>>,
		state: SyncState,
	) => boolean;
	coordinateConflict: (
		repoPath: string,
		config: PiSyncConfig,
		state: SyncState,
	) => Promise<ConflictCoordinationResult>;
	preserveRebaseConflict: (
		repoPath: string,
		config: PiSyncConfig,
	) => Promise<string>;
	createConflictRequest: (
		repoPath: string,
		config: PiSyncConfig,
		deviceBranch: string,
		paths: SyncConflictPath[],
	) => Promise<SyncConflictRequest>;
	formatManualMergeMessage: (
		repoPath: string,
		config: PiSyncConfig,
		deviceBranch: string,
	) => string;
	normalizeChangedFiles: (
		changedFiles: string[],
		config: PiSyncConfig,
	) => string[];
	applyCurrent: (
		repoPath: string,
		config: PiSyncConfig,
		state: SyncState,
		reason: string,
		packageApproval?: PackageApproval,
	) => Promise<CommandResult>;
	loadState: () => Promise<SyncState>;
	saveState: (state: SyncState) => Promise<void>;
}

function conflictPathsFrom(relativePaths: string[], config: PiSyncConfig, normalize: PullFlowOptions["normalizeChangedFiles"]): SyncConflictPath[] {
	return relativePaths.map((relativePath) => ({
		relativePath: normalize([relativePath], config)[0] ?? relativePath,
		changeType: "git_conflict",
	}));
}

/**
 * Execute the complete lock-free pull flow. The caller owns lock acquisition,
 * lifecycle decisions, and Pi-specific state access.
 */
export async function runPullFlow(
	options: PullFlowOptions,
): Promise<CommandResult> {
	const {
		agentDir,
		repoPath,
		config,
		state,
		packageApproval,
		signal,
		onProgress,
		onGitCommandStart,
		captureLocalChanges,
		shouldRefreshLocalCapture,
		coordinateConflict,
		preserveRebaseConflict,
		createConflictRequest,
		formatManualMergeMessage,
		normalizeChangedFiles,
		applyCurrent,
		loadState,
		saveState,
	} = options;
	const reportProgress = (message: string) => onProgress?.("pull", message);
	const reportGitStart = (command: string) =>
		onGitCommandStart?.("pull", command, config.pullTimeoutMs);
	const gitOptions = { timeout: config.pullTimeoutMs, signal };
	const pullTimeoutSeconds = config.pullTimeoutMs / 1000;

	reportProgress("Inspecting repository state...");
	let status = await gitStatus(repoPath);
	let switchedBranch = false;
	if (status.branch !== config.branch) {
		try {
			const localBranch = await gitProbe(repoPath, [
				"show-ref",
				"--verify",
				`refs/heads/${config.branch}`,
			]);
			if (!localBranch.ok) {
				const command = "git fetch origin";
				reportProgress(
					`Running: ${command} (timeout: ${pullTimeoutSeconds}s)...`,
				);
				reportGitStart(command);
				await gitFetch(repoPath, gitOptions);
			}
			reportProgress(`Switching to branch ${config.branch}...`);
			switchedBranch = await ensureConfiguredBranch(repoPath, config.branch);
			status = await gitStatus(repoPath);
		} catch (error) {
			return {
				ok: false,
				code: "blocked_conflict",
				message:
					error instanceof Error
						? error.message
						: "Configured branch check failed.",
				reload: false,
			};
		}
	}

	const worktree = await preparePullWorktree(repoPath, status, reportProgress);
	if (worktree.kind === "blocked") {
		return {
			ok: false,
			code: "blocked_conflict",
			message: worktree.message,
			reload: false,
		};
	}
	if (worktree.kind === "failed") {
		return {
			ok: false,
			code: "git_failed",
			message: worktree.message,
			reload: false,
		};
	}
	status = worktree.status;
	const committedRepositoryChanges = worktree.committedRepositoryChanges;

	reportProgress("Comparing local and remote changes...");
	const inventory = await compareFiles(agentDir, repoPath, config, state);
	let convergedBaselineChanged = false;
	for (const comparison of inventory.comparisons) {
		if (
			comparison.local &&
			comparison.remote &&
			comparison.local.sha256 === comparison.remote.sha256 &&
			state.files[comparison.relativePath]?.sha256 !== comparison.remote.sha256
		) {
			state.files[comparison.relativePath] = {
				sha256: comparison.remote.sha256,
				mode: comparison.remote.mode,
			};
			convergedBaselineChanged = true;
		}
	}
	if (convergedBaselineChanged) await saveState(state);
	const hasRemoteChanges = inventory.comparisons.some((comparison) =>
		[
			"remote_only",
			"remote_created",
			"remote_deleted",
			"local_deleted_remote_modified",
			"converged",
		].includes(comparison.changeType),
	);
	let capturedLocalChanges = committedRepositoryChanges;
	if (hasLocalChanges(inventory.comparisons)) {
		reportProgress("Capturing local changes before pull...");
		const capture = await captureLocalChanges(
			repoPath,
			config,
			state,
			shouldRefreshLocalCapture(status, state),
		);
		if (capture.hasConflicts) {
			try {
				const coordination = await coordinateConflict(repoPath, config, state);
				if (coordination.kind === "resolved") {
					const applyResult = await applyCurrent(
						repoPath,
						config,
						state,
						"pull",
						packageApproval,
					);
					return {
						...applyResult,
						message: `${coordination.message}\n${applyResult.message}`,
					};
				}
				return {
					ok: false,
					code: "blocked_conflict",
					message: coordination.message,
					reload: false,
					details: { conflict: coordination.conflict },
				};
			} catch (error) {
				return {
					ok: false,
					code: "git_failed",
					message: `Could not preserve current-device conflict changes: ${error instanceof Error ? error.message : "Unknown error"}`,
					reload: false,
				};
			}
		}
		if (capture.errors.length > 0 || capture.denied.length > 0) {
			return {
				ok: false,
				code: "blocked_conflict",
				message: `Pull blocked while capturing local changes.\n${[
					...capture.errors.map((error) => `${error.file}: ${error.message}`),
					...capture.denied.map((file) => `${file}: denied by sync policy`),
				].join("\n")}`,
				reload: false,
			};
		}
		const captureCommit = await commitCapturedChangesBeforePull(
			repoPath,
			reportProgress,
		);
		if (captureCommit.kind === "failed") {
			return {
				ok: false,
				code: "git_failed",
				message: captureCommit.message,
				reload: false,
			};
		}
		capturedLocalChanges = true;
	}

	const integration = await integratePulledHead({
		repoPath,
		branch: config.branch,
		timeoutMs: config.pullTimeoutMs,
		capturedLocalChanges,
		signal,
		onProgress: reportProgress,
		onGitCommandStart: reportGitStart,
	});
	if (integration.kind === "failed") {
		return {
			ok: false,
			code: "git_failed",
			message: integration.message,
			reload: false,
		};
	}
	if (integration.kind === "rebase_conflict") {
		try {
			const paths = conflictPathsFrom(
				await listUnmergedPaths(repoPath),
				config,
				normalizeChangedFiles,
			);
			const branch = await preserveRebaseConflict(repoPath, config);
			const conflict = await createConflictRequest(
				repoPath,
				config,
				branch,
				paths,
			);
			return {
				ok: false,
				code: "blocked_conflict",
				message: formatManualMergeMessage(repoPath, config, branch),
				reload: false,
				details: { conflict },
			};
		} catch (error) {
			return {
				ok: false,
				code: "git_failed",
				message: `Rebase failed after committing local changes: ${error instanceof Error ? error.message : "Unknown error"}`,
				reload: false,
			};
		}
	}
	if (integration.kind === "rebased") {
		reportProgress("Applying pulled changes...");
		return applyCurrent(
			repoPath,
			config,
			await loadState(),
			"pull",
			packageApproval,
		);
	}

	const { pulled } = integration;
	const newState = await loadState();
	if (!pulled) {
		if (packageApproval || switchedBranch || hasRemoteChanges) {
			return applyCurrent(repoPath, config, newState, "pull", packageApproval);
		}
		return {
			ok: true,
			code: "noop",
			message: "frida-git-sync: Already up to date.",
			reload: false,
		};
	}

	reportProgress("Applying pulled changes...");
	return applyCurrent(repoPath, config, newState, "pull", packageApproval);
}
