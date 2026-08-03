import { resolveAutomaticConflict } from "../system/conflict-resolution";
import type { PiSyncConfig } from "../sync/config";
import { validateFiles } from "../sync/validate";
import { approvePackagePlan, preparePackagePlan } from "../system/packages";
import type { PackageApproval } from "../system/packages";
import type { SyncState } from "../system/state";
import type {
	AutomaticConflictChoice,
	CommandResult,
	SyncConflictRequest,
} from "./operation-result";
import type { SyncConflictPath } from "./operation-result";
import {
	formatSecretsFindings,
	formatValidationErrors,
} from "../extension/ui";

export interface ResolveConflictFlowOptions {
	agentDir: string;
	repoPath: string;
	config: PiSyncConfig;
	state: SyncState;
	request: SyncConflictRequest;
	choice: AutomaticConflictChoice;
	packageApproval?: PackageApproval;
	reportProgress: (phase: "pull" | "apply", message: string) => void;
	getRepoSyncFiles: (
		repoPath: string,
		config: PiSyncConfig,
	) => Promise<string[]>;
	scanForSecrets: (
		repoPath: string,
		config: PiSyncConfig,
	) => Promise<Parameters<typeof formatSecretsFindings>[0]>;
	createConflictRequest: (
		repoPath: string,
		config: PiSyncConfig,
		deviceBranch: string,
		paths: SyncConflictPath[],
	) => Promise<SyncConflictRequest>;
	applyCurrent: (
		repoPath: string,
		config: PiSyncConfig,
		state: SyncState,
		reason: string,
		packageApproval?: PackageApproval,
		automaticConflictResolutionAttempted?: boolean,
		useRemoteForConflicts?: ReadonlySet<string>,
	) => Promise<CommandResult>;
}

/** Resolve a confirmed conflict choice after the command façade validates lifecycle and lock ownership. */
export async function resolveConflictFlow(
	options: ResolveConflictFlowOptions,
): Promise<CommandResult> {
	const {
		agentDir,
		repoPath,
		config,
		state,
		request,
		choice,
		packageApproval,
		reportProgress,
		getRepoSyncFiles,
		scanForSecrets,
		createConflictRequest,
		applyCurrent,
	} = options;

	reportProgress("pull", "Resolving selected conflict paths...");
	const resolution = await resolveAutomaticConflict({
		repoPath,
		request,
		choice,
		beforeCommit: async () => {
			const files = await getRepoSyncFiles(repoPath, config);
			const validation = await validateFiles(repoPath, config, files);
			if (validation.blocked) {
				return {
					code: "blocked_validation" as const,
					message: formatValidationErrors(validation.errors),
				};
			}
			try {
				const packagePlan = await preparePackagePlan(
					repoPath,
					agentDir,
					config,
				);
				if (
					packagePlan.approvalRequired.length > 0 &&
					(!packageApproval ||
						!approvePackagePlan(packagePlan, packageApproval).approved)
				) {
					return {
						code: "approval_required" as const,
						message: `Package approval required before resolving settings: ${packagePlan.approvalRequired.join(", ")}`,
						packages: packagePlan.approvalRequired,
					};
				}
			} catch (error) {
				return {
					code: "blocked_validation" as const,
					message: `Package validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
				};
			}
			if (config.security.scanSecretsBeforePush) {
				const findings = await scanForSecrets(repoPath, config);
				if (findings.length > 0) {
					return {
						code: "blocked_secret" as const,
						message: `Potential secrets detected.\n${formatSecretsFindings(findings)}`,
					};
				}
			}
			return undefined;
		},
	});

	if (resolution.kind !== "resolved") {
		const refreshed =
			resolution.kind === "stale"
				? await createConflictRequest(
						repoPath,
						config,
						request.deviceBranch,
						request.paths,
					).catch(() => request)
				: request;
		return {
			ok: false,
			code:
				resolution.kind === "blocked"
					? (resolution.code ?? "blocked_validation")
					: "blocked_conflict",
			message: resolution.message,
			reload: false,
			details: {
				conflict: refreshed,
				packages:
					resolution.kind === "blocked" ? resolution.packages : undefined,
			},
		};
	}

	reportProgress("apply", "Applying resolved configuration...");
	const remoteConflictPaths =
		choice === "use_remote"
			? new Set(request.paths.map((path) => path.relativePath))
			: undefined;
	const apply = await applyCurrent(
		repoPath,
		config,
		state,
		"conflict-resolution",
		packageApproval,
		true,
		remoteConflictPaths,
	);
	return {
		...apply,
		message: `Conflict resolved using ${choice === "use_local" ? "current-device" : "shared remote"} content.\n${apply.message}`,
	};
}
