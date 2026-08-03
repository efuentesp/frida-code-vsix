import { createBackup, restoreBackup } from "../system/backup";
import type { PiSyncConfig } from "../sync/config";
import { executeMaterialize } from "../sync/materialize";
import type { MaterializePlan } from "../sync/materialize";
import type { CommandResult } from "./operation-result";
import { executePackagePlan } from "../system/packages";
import type {
	PackageApproval,
	PackagePlan,
	ReconcileResult,
} from "../system/packages";
import { updateState } from "../system/state";
import type { SyncState } from "../system/state";

type Backup = Awaited<ReturnType<typeof createBackup>>;

export interface ApplyTransactionOptions {
	agentDir: string;
	commit: string;
	config: PiSyncConfig;
	state: SyncState;
	reason: string;
	plan: MaterializePlan;
	packagePlan: PackagePlan;
	packageApproval?: PackageApproval;
}

function failedResult(message: string): CommandResult {
	return { ok: false, code: "partial_failure", message, reload: false };
}

async function convergeWithoutFileOperations(
	options: ApplyTransactionOptions,
): Promise<CommandResult | undefined> {
	const { agentDir, commit, config, state, plan } = options;
	const hasFileOperations = plan.toWrite.length > 0 || plan.toDelete.length > 0;
	if (hasFileOperations) return undefined;

	const baselineChanged =
		plan.nextBaseline !== null &&
		JSON.stringify(plan.nextBaseline) !== JSON.stringify(state.files);
	const commitChanged = state.lastSyncedCommit !== commit;
	const branchChanged = state.branch !== config.branch;
	if (!baselineChanged && !commitChanged && !branchChanged) {
		return {
			ok: true,
			code: "noop",
			message: "frida-git-sync: Already up to date.",
			reload: false,
		};
	}
	if (!plan.nextBaseline) return undefined;

	await updateState(agentDir, {
		lastSyncedCommit: commit,
		lastSyncedAt: new Date().toISOString(),
		branch: config.branch,
		files: plan.nextBaseline,
		pendingOperation: null,
	});
	return {
		ok: true,
		code: "ok",
		message: "Sync state updated (no file changes needed).",
		reload: false,
	};
}

async function restoreBackupWithMessage(
	agentDir: string,
	backup: Backup,
	lines: string[],
): Promise<void> {
	try {
		await restoreBackup(agentDir, backup);
		lines.push("Rolled back to pre-apply state.");
	} catch (error) {
		lines.push(
			`Rollback failed: ${error instanceof Error ? error.message : "Unknown"}. ` +
				`Manual restore from backup: ${backup.path}`,
		);
	}
}

async function executePackages(
	packagePlan: PackagePlan,
	agentDir: string,
	packageApproval?: PackageApproval,
): Promise<ReconcileResult> {
	try {
		return await executePackagePlan(packagePlan, agentDir, {
			approval: packageApproval,
		});
	} catch (error) {
		return {
			installed: [],
			errors: [
				`Unexpected package execution failure: ${error instanceof Error ? error.message : "Unknown"}`,
			],
		};
	}
}

async function recordFailedApply(
	options: ApplyTransactionOptions,
	backup: Backup,
	packageResult: ReconcileResult,
	lines: string[],
): Promise<void> {
	try {
		await updateState(options.agentDir, {
			pendingOperation: {
				type: "apply-failed",
				startedAt: new Date().toISOString(),
				context: {
					commit: options.commit,
					reason: options.reason,
					backupPath: backup.path,
					packageErrors: packageResult.errors,
				},
			},
		});
	} catch (error) {
		lines.push(
			`Could not record pending operation: ${error instanceof Error ? error.message : "Unknown"}`,
		);
	}
}

/**
 * Execute a conflict-free, already-approved materialize transaction.
 * State advances only after file writes and package reconciliation both succeed.
 */
export async function executeApplyTransaction(
	options: ApplyTransactionOptions,
): Promise<CommandResult> {
	const converged = await convergeWithoutFileOperations(options);
	if (converged) return converged;

	const { agentDir, commit, reason, plan, packagePlan, packageApproval } =
		options;
	const lines: string[] = [];
	let backup: Backup;
	try {
		backup = await createBackup(agentDir, commit, reason, plan);
	} catch (error) {
		return {
			...failedResult(
				`Backup failed; apply blocked: ${error instanceof Error ? error.message : "Unknown"}`,
			),
			details: { backupFailed: true },
		};
	}
	lines.push(`Backup created: ${backup.timestamp}`);

	const materialized = await executeMaterialize(agentDir, plan);
	if (materialized.failed.length > 0) {
		lines.push(`ERROR: ${materialized.failed.length} files failed to apply.`);
		await restoreBackupWithMessage(agentDir, backup, lines);
		lines.push(
			`Failed files: ${materialized.failed.map((file) => file.file).join(", ")}`,
		);
		return failedResult(lines.join("\n"));
	}
	if (materialized.written.length > 0) {
		lines.push(`Files written: ${materialized.written.length}`);
	}
	if (materialized.deleted.length > 0) {
		lines.push(`Files deleted: ${materialized.deleted.length}`);
	}

	const packageResult = await executePackages(
		packagePlan,
		agentDir,
		packageApproval,
	);
	if (
		packageResult.approvalRequired?.length ||
		packageResult.errors.length > 0
	) {
		lines.push(
			`ERROR: Package installation failed: ${
				packageResult.errors.join("; ") ||
				packageResult.approvalRequired?.join(", ") ||
				"Unknown"
			}`,
		);
		await restoreBackupWithMessage(agentDir, backup, lines);
		await recordFailedApply(options, backup, packageResult, lines);
		return failedResult(lines.join("\n"));
	}

	if (!plan.nextBaseline) {
		lines.push("ERROR: No baseline computed after successful apply.");
		return failedResult(lines.join("\n"));
	}
	await updateState(agentDir, {
		lastSyncedCommit: commit,
		lastSyncedAt: new Date().toISOString(),
		branch: options.config.branch,
		lastBackup: backup.timestamp,
		files: plan.nextBaseline,
		pendingOperation: null,
	});
	if (packageResult.installed.length > 0) {
		lines.push(`Packages installed: ${packageResult.installed.join(", ")}`);
	}
	return { ok: true, code: "ok", message: lines.join("\n"), reload: true };
}
