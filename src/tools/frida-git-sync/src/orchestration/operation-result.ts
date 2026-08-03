import type { PackageApproval } from "../system/packages";

export type ResultCode =
	| "ok"
	| "noop"
	| "blocked_conflict"
	| "blocked_validation"
	| "blocked_secret"
	| "approval_required"
	| "git_failed"
	| "partial_failure";

export type NotificationLevel = "info" | "warning" | "error";
type FailureResultCode = Exclude<ResultCode, "ok" | "noop">;

function assertNever(value: never): never {
	throw new Error(`Unexpected result code: ${value}`);
}

export type RunMode = "setup" | "sync" | "recovery";
export type SyncPhase = "preflight" | "pull" | "apply" | "push" | "complete";

export type ConflictChoice = "ask_agent" | "abort" | "use_local" | "use_remote";

export type AutomaticConflictChoice = "use_local" | "use_remote";

export interface SyncConflictPath {
	relativePath: string;
	changeType:
		| "both_modified"
		| "local_modified_remote_deleted"
		| "local_deleted_remote_modified"
		| "git_conflict";
}

export interface SyncConflictRequest {
	kind: "sync_conflict";
	sharedBranch: string;
	deviceBranch: string;
	sharedHead?: string;
	deviceHead: string;
	paths: SyncConflictPath[];
}

export function isSyncConflictRequest(
	value: unknown,
): value is SyncConflictRequest {
	if (!value || typeof value !== "object") return false;
	const conflict = value as Partial<SyncConflictRequest>;
	return (
		conflict.kind === "sync_conflict" &&
		typeof conflict.sharedBranch === "string" &&
		typeof conflict.deviceBranch === "string" &&
		typeof conflict.deviceHead === "string" &&
		Array.isArray(conflict.paths)
	);
}

export interface RunOptions {
	gitUrl?: string;
	packageApproval?: PackageApproval;
	/** Cancels nested subprocesses when the user aborts or a deadline fires. */
	signal?: AbortSignal;
	onProgress?: (phase: SyncPhase, message: string) => void;
	/** Starts a UI-level fail-safe independent of the child-process timeout. */
	onGitCommandStart?: (
		phase: SyncPhase,
		command: string,
		timeoutMs: number,
	) => void;
}

export interface RunResult extends CommandResult {
	mode: RunMode;
	phase: SyncPhase;
	details?: {
		needsGitUrl?: boolean;
		pull?: CommandResult;
		push?: CommandResult;
		approvalRequired?: string[];
		reason?: string;
		conflict?: SyncConflictRequest;
		[key: string]: unknown;
	};
}

export interface CommandResult {
	ok: boolean;
	code: ResultCode;
	message: string;
	reload: boolean;
	details?: unknown;
}

export function successResult(
	message: string,
	reload = false,
	details?: unknown,
): CommandResult {
	const result = { ok: true, code: "ok" as const, message, reload };
	return details === undefined ? result : { ...result, details };
}

export function noopResult(message: string, details?: unknown): CommandResult {
	const result = { ok: true, code: "noop" as const, message, reload: false };
	return details === undefined ? result : { ...result, details };
}

export function failureResult(
	code: FailureResultCode,
	message: string,
	details?: unknown,
): CommandResult {
	const result = { ok: false, code, message, reload: false };
	return details === undefined ? result : { ...result, details };
}

export function conflictResult(
	message: string,
	details?: unknown,
): CommandResult {
	return failureResult("blocked_conflict", message, details);
}

export function notificationLevelForResult(
	code: ResultCode,
): NotificationLevel {
	switch (code) {
		case "ok":
		case "noop":
			return "info";
		case "blocked_conflict":
		case "blocked_validation":
		case "blocked_secret":
		case "approval_required":
			return "warning";
		case "git_failed":
		case "partial_failure":
			return "error";
		default:
			return assertNever(code);
	}
}
