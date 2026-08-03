import {
	ensureConfiguredBranch,
	getHeadCommit,
	gitCommit,
	gitDiff,
	gitFetch,
	gitStatus,
	listUnmergedPaths,
} from "../system/git";
import type { captureChanges } from "../sync/capture";
import type { PiSyncConfig } from "../sync/config";
import { validateFiles } from "../sync/validate";
import { preparePackagePlan } from "../system/packages";
import type { SyncState } from "../system/state";
import type {
	CommandResult,
	SyncConflictPath,
	SyncConflictRequest,
} from "./operation-result";
import {
	conflictResult,
	failureResult,
	noopResult,
} from "./operation-result";
import { integrateCommittedPush } from "./push-phase";
import {
	formatSecretsFindings,
	formatValidationErrors,
} from "../extension/ui";

export interface PushPreparation {
	kind: "ready" | "noop" | "blocked";
	capture: Awaited<ReturnType<typeof captureChanges>>;
	changedFiles: string[];
	diff: string;
	repoHead: string;
	worktreeFingerprint: string;
	repoPath: string;
	branch: string;
	message?: string;
	conflict?: SyncConflictRequest;
}

type CaptureResult = Awaited<ReturnType<typeof captureChanges>>;
type ConflictCoordinationResult =
	| { kind: "resolved"; message: string }
	| { kind: "needs_user"; conflict: SyncConflictRequest; message: string };

export interface PushFlowOptions {
	agentDir: string;
	repoPath: string;
	config: PiSyncConfig;
	state: SyncState;
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
	applyCurrent: (
		repoPath: string,
		config: PiSyncConfig,
		state: SyncState,
		reason: string,
	) => Promise<CommandResult>;
	normalizeChangedFiles: (
		changedFiles: string[],
		config: PiSyncConfig,
	) => string[];
	computeFingerprint: (
		repoPath: string,
		config: PiSyncConfig,
		state: SyncState,
	) => Promise<string>;
	scanForSecrets: (
		repoPath: string,
		config: PiSyncConfig,
	) => Promise<Parameters<typeof formatSecretsFindings>[0]>;
	loadState: () => Promise<SyncState>;
	preserveRebaseConflict: (
		repoPath: string,
		config: PiSyncConfig,
	) => Promise<string>;
	mergeDeviceBranchIntoShared: (
		repoPath: string,
		config: PiSyncConfig,
		deviceBranch: string,
	) => Promise<boolean>;
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
	formatMergedConflictMessage: (config: PiSyncConfig) => string;
	pushMainAndDeviceBranches: (
		repoPath: string,
		branch: string,
	) => Promise<unknown>;
}

function emptyCapture(): CaptureResult {
	return {
		captured: [],
		deleted: [],
		denied: [],
		errors: [],
		hasConflicts: false,
		conflicts: [],
	};
}

function preparation(
	repoPath: string,
	branch: string,
	kind: PushPreparation["kind"],
	message: string,
	details: Partial<
		Omit<PushPreparation, "kind" | "repoPath" | "branch" | "message">
	> = {},
): PushPreparation {
	return {
		kind,
		capture: emptyCapture(),
		changedFiles: [],
		diff: "",
		repoHead: "",
		worktreeFingerprint: "",
		repoPath,
		branch,
		message,
		...details,
	};
}

function conflictPathsFrom(relativePaths: string[]): SyncConflictPath[] {
	return relativePaths.map((relativePath) => ({
		relativePath,
		changeType: "git_conflict",
	}));
}

export function resultFromPreparation(
	preparation: PushPreparation,
): CommandResult {
	if (preparation.kind === "ready") {
		return failureResult(
			"partial_failure",
			preparation.message ?? "Push preparation is ready for confirmation.",
			preparation,
		);
	}
	const details = preparation.conflict
		? { ...preparation, conflict: preparation.conflict }
		: preparation;
	return preparation.kind === "noop"
		? noopResult(preparation.message ?? "No changes to push.", details)
		: conflictResult(preparation.message ?? "Push blocked.", details);
}

/** Prepare the lock-free capture, validation, and confirmation boundary for push. */
export async function preparePushFlow(
	options: PushFlowOptions,
): Promise<PushPreparation> {
	const {
		agentDir,
		repoPath,
		config,
		state,
		captureLocalChanges,
		shouldRefreshLocalCapture,
		coordinateConflict,
		applyCurrent,
		normalizeChangedFiles,
		computeFingerprint,
		scanForSecrets,
	} = options;
	let statusBefore = await gitStatus(repoPath);
	if (
		statusBefore.branch !== config.branch &&
		!statusBefore.isRebasing &&
		!statusBefore.isMerging &&
		!statusBefore.hasUncommittedChanges
	) {
		try {
			await gitFetch(repoPath);
		} catch {
			// ensureConfiguredBranch below reports the actionable branch error.
		}
	}
	try {
		await ensureConfiguredBranch(repoPath, config.branch);
		statusBefore = await gitStatus(repoPath);
	} catch (error) {
		return preparation(
			repoPath,
			config.branch,
			"blocked",
			error instanceof Error
				? error.message
				: "Configured branch check failed.",
			{ repoHead: statusBefore.commit },
		);
	}
	if (
		statusBefore.isRebasing ||
		statusBefore.isMerging ||
		statusBefore.hasConflicts
	) {
		return preparation(
			repoPath,
			config.branch,
			"blocked",
			"Repository is in conflict/resolution state. Resolve it before preparing push.",
			{ repoHead: statusBefore.commit },
		);
	}

	const capture = await captureLocalChanges(
		repoPath,
		config,
		state,
		shouldRefreshLocalCapture(statusBefore, state),
	);
	if (capture.hasConflicts) {
		try {
			const coordination = await coordinateConflict(repoPath, config, state);
			if (coordination.kind === "resolved") {
				const applyResult = await applyCurrent(repoPath, config, state, "push");
				return preparation(
					repoPath,
					config.branch,
					applyResult.ok ? "noop" : "blocked",
					`${coordination.message}\n${applyResult.message}`,
					{ capture, repoHead: await getHeadCommit(repoPath) },
				);
			}
			return preparation(
				repoPath,
				config.branch,
				"blocked",
				coordination.message,
				{
					capture,
					repoHead: statusBefore.commit,
					conflict: coordination.conflict,
				},
			);
		} catch (error) {
			return preparation(
				repoPath,
				config.branch,
				"blocked",
				`Could not create a current-device conflict branch: ${error instanceof Error ? error.message : "Unknown error"}`,
				{ capture, repoHead: statusBefore.commit },
			);
		}
	}
	if (capture.errors.length > 0) {
		return preparation(
			repoPath,
			config.branch,
			"blocked",
			`Push blocked while capturing files.\n${capture.errors.map((error) => `${error.file}: ${error.message}`).join("\n")}`,
			{ capture, repoHead: statusBefore.commit },
		);
	}

	const status = await gitStatus(repoPath);
	const changedFiles = normalizeChangedFiles(status.changedFiles, config);
	const fingerprint = () => computeFingerprint(repoPath, config, state);
	if (!status.hasUncommittedChanges) {
		return preparation(repoPath, config.branch, "noop", "No changes to push.", {
			capture,
			repoHead: await getHeadCommit(repoPath),
			worktreeFingerprint: await fingerprint(),
		});
	}
	const validation = await validateFiles(repoPath, config, changedFiles);
	if (validation.blocked) {
		return preparation(
			repoPath,
			config.branch,
			"blocked",
			`Push blocked: validation errors.\n${formatValidationErrors(validation.errors)}`,
			{
				capture,
				changedFiles,
				diff: await gitDiff(repoPath),
				repoHead: status.commit,
				worktreeFingerprint: await fingerprint(),
			},
		);
	}
	if (config.security.scanSecretsBeforePush) {
		const findings = await scanForSecrets(repoPath, config);
		if (findings.length > 0) {
			return preparation(
				repoPath,
				config.branch,
				"blocked",
				`Push blocked: potential secrets detected.\n${formatSecretsFindings(findings)}`,
				{
					capture,
					changedFiles,
					diff: await gitDiff(repoPath),
					repoHead: status.commit,
					worktreeFingerprint: await fingerprint(),
				},
			);
		}
	}
	try {
		const packagePlan = await preparePackagePlan(repoPath, agentDir, config);
		if (packagePlan.approvalRequired.length > 0) {
			return preparation(
				repoPath,
				config.branch,
				"blocked",
				`Package approval required before push: ${packagePlan.approvalRequired.join(", ")}`,
				{
					capture,
					changedFiles,
					diff: await gitDiff(repoPath),
					repoHead: status.commit,
					worktreeFingerprint: await fingerprint(),
				},
			);
		}
	} catch (error) {
		return preparation(
			repoPath,
			config.branch,
			"blocked",
			`Package validation failed: ${error instanceof Error ? error.message : "Unknown"}`,
			{
				capture,
				changedFiles,
				diff: await gitDiff(repoPath),
				repoHead: status.commit,
				worktreeFingerprint: await fingerprint(),
			},
		);
	}
	return preparation(
		repoPath,
		config.branch,
		"ready",
		`Push ready: ${changedFiles.length} changed file(s).`,
		{
			capture,
			changedFiles,
			diff: await gitDiff(repoPath),
			repoHead: status.commit,
			worktreeFingerprint: await fingerprint(),
		},
	);
}

/** Commit and integrate a confirmed push after the façade has acquired its lock. */
export async function executePushFlow(
	options: PushFlowOptions,
	preparation: PushPreparation,
	message?: string,
): Promise<CommandResult> {
	const {
		repoPath,
		config,
		state,
		computeFingerprint,
		loadState,
		preserveRebaseConflict,
		mergeDeviceBranchIntoShared,
		createConflictRequest,
		formatManualMergeMessage,
		formatMergedConflictMessage,
		pushMainAndDeviceBranches,
		applyCurrent,
		normalizeChangedFiles,
	} = options;
	try {
		await ensureConfiguredBranch(repoPath, config.branch);
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
	if (
		(await getHeadCommit(repoPath)) !== preparation.repoHead ||
		(await computeFingerprint(repoPath, config, state)) !==
			preparation.worktreeFingerprint
	) {
		return {
			ok: false,
			code: "blocked_conflict",
			message:
				"Push preparation is stale: the repository or agent changed after confirmation. Prepare push again.",
			reload: false,
		};
	}
	await gitCommit(repoPath, message ?? "pi-sync: update configuration");
	const integration = await integrateCommittedPush({
		repoPath,
		branch: preparation.branch,
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
				normalizeChangedFiles(await listUnmergedPaths(repoPath), config),
			);
			const branch = await preserveRebaseConflict(repoPath, config);
			if (!(await mergeDeviceBranchIntoShared(repoPath, config, branch))) {
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
			}
			const applyResult = await applyCurrent(
				repoPath,
				config,
				await loadState(),
				"push",
			);
			if (!applyResult.ok) {
				return {
					ok: false,
					code: applyResult.code,
					message: `Push completed, but applying the synced configuration failed.\n${formatMergedConflictMessage(config)}\n${applyResult.message}`,
					reload: false,
				};
			}
			return {
				ok: true,
				code: "ok",
				message: `Pushed successfully.\n${formatMergedConflictMessage(config)}\n${applyResult.message}`,
				reload: applyResult.reload,
			};
		} catch (error) {
			return {
				ok: false,
				code: "git_failed",
				message: `Could not create or merge a current-device conflict branch: ${error instanceof Error ? error.message : "Unknown error"}`,
				reload: false,
			};
		}
	}
	try {
		await pushMainAndDeviceBranches(repoPath, preparation.branch);
	} catch (error) {
		return {
			ok: false,
			code: "git_failed",
			message: `Push failed: ${error instanceof Error ? error.message : "Unknown"}\nLocal commits are preserved.`,
			reload: false,
		};
	}
	const applyResult = await applyCurrent(
		repoPath,
		config,
		await loadState(),
		"push",
	);
	if (!applyResult.ok) {
		return {
			ok: false,
			code: applyResult.code,
			message: `Push completed, but applying the synced configuration failed.\n${applyResult.message}`,
			reload: false,
		};
	}
	return {
		ok: true,
		code: "ok",
		message: `Pushed successfully.\n${applyResult.message}`,
		reload: applyResult.reload,
	};
}
