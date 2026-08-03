/**
 * TUI 展示和格式化（schema v2）
 *
 * 为各种命令生成格式化的展示输出
 */
import type { GitStatus } from "../system/git";
import type { PackageDiff } from "../system/packages";
import type { PiSyncConfig } from "../sync/config";
import type { SyncState } from "../system/state";
import type { FileComparison, InventoryResult } from "../sync/inventory";
import type { CaptureResult } from "../sync/capture";
import type { ValidationError } from "../sync/validate";

// ========== ANSI 颜色 ==========

const RED = "\x1b[31m";
const BOLD_RED = "\x1b[1;31m";
const BOLD_YELLOW = "\x1b[1;33m";
const RESET = "\x1b[0m";

function red(text: string): string {
	return `${RED}${text}${RESET}`;
}

function boldRed(text: string): string {
	return `${BOLD_RED}${text}${RESET}`;
}

function boldYellow(text: string): string {
	return `${BOLD_YELLOW}${text}${RESET}`;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

// ========== Git Status 格式化 ==========

export function formatGitStatus(status: GitStatus): string {
	const lines: string[] = [
		`Branch:          ${status.branch}`,
		`Commit:          ${status.commitShort} (${status.commit})`,
		`Remote:          ${status.remoteExists ? "origin" : "none"}`,
	];

	if (status.remoteExists) {
		const arrows: string[] = [];
		if (status.ahead > 0) arrows.push(`↑${status.ahead}`);
		if (status.behind > 0) arrows.push(`↓${status.behind}`);
		if (arrows.length === 0) arrows.push("up to date");
		lines.push(`Sync:            ${arrows.join(" ")}`);
	}

	lines.push(`Uncommitted:     ${status.hasUncommittedChanges ? "YES" : "no"}`);

	if (status.isRebasing) lines.push(`Rebasing:        YES`);
	if (status.isMerging) lines.push(`Merging:         YES`);
	if (status.hasConflicts)
		lines.push(`Conflicts:       YES (${status.conflictedFiles.length} files)`);

	if (status.changedFiles.length > 0) {
		lines.push(`Changed files (${status.changedFiles.length}):`);
		for (const f of status.changedFiles.slice(0, 20)) {
			lines.push(`  ${f}`);
		}
		if (status.changedFiles.length > 20) {
			lines.push(`  ... and ${status.changedFiles.length - 20} more`);
		}
	}

	return lines.join("\n");
}

// ========== 同步状态 v2 ==========

export interface SyncStatusV2Input {
	repoPath: string;
	agentDir: string;
	gitStatus: GitStatus;
	config: PiSyncConfig;
	inventory: InventoryResult;
	state: SyncState;
	pkgDiff?: PackageDiff;
}

export function formatSyncStatusV2(input: SyncStatusV2Input): string {
	const { repoPath, gitStatus: gs, config, inventory, state, pkgDiff } = input;

	const lines: string[] = ["=== pi-git-sync Status ===", ""];

	// Git 摘要
	lines.push(`  repo       ${repoPath}`);
	lines.push(
		`  git        ${gs.branch} @ ${gs.commitShort}` +
			(gs.remoteExists
				? `  ${gs.ahead > 0 ? `↑${gs.ahead}` : "↑0"} ${gs.behind > 0 ? `↓${gs.behind}` : "↓0"}`
				: "  (no remote)") +
			(gs.hasUncommittedChanges
				? `  dirty(${gs.changedFiles.length})`
				: "  clean") +
			(gs.hasConflicts ? boldRed("  CONFLICTS") : ""),
	);

	// 上次同步
	if (state.lastSyncedAt) {
		const when = formatTimestamp(state.lastSyncedAt);
		const short = state.lastSyncedCommit?.substring(0, 7) ?? "?";
		lines.push(`  synced     ${when} (${short})`);
	} else {
		lines.push(`  synced     never`);
	}

	// 冲突详情：仅显示冲突文件与 Git 处理步骤，不暴露两端的文件路径。
	const conflictComps = inventory.comparisons.filter(
		(c) => c.changeType === "both_modified",
	);
	const conflictFiles = [
		...new Set([
			...gs.conflictedFiles,
			...conflictComps.map((c) => `${config.root}/${c.relativePath}`),
		]),
	];
	if (gs.hasConflicts || conflictComps.length > 0) {
		lines.push("");
		lines.push(
			boldRed(`⚠ ${conflictFiles.length} CONFLICT(S) require resolution:`),
		);
		lines.push("  Conflicted files:");
		for (const file of conflictFiles) {
			lines.push(red(`    ${file}`));
		}
		lines.push("");
		lines.push(boldYellow("  Resolve them in the config repository:"));
		lines.push(`    cd ${shellQuote(repoPath)}`);
		if (!gs.isMerging && !gs.isRebasing) {
			lines.push(`    git merge origin/${config.branch}`);
		}
		lines.push("    # Edit the files above and remove any conflict markers");
		lines.push("    git add .");
		lines.push(
			gs.isRebasing
				? "    git rebase --continue"
				: '    git commit -m "resolve conflicts"',
		);
		lines.push("  Then run /pisync again to finish syncing.");
	}

	// Managed (synced)
	lines.push("Managed (synced)");
	lines.push(`  root       ${config.root}/`);
	lines.push(`  include    ${config.include.length} patterns`);
	lines.push(`  exclude    ${config.exclude.length} patterns`);
	lines.push(`  delete     ${config.delete}`);
	if (pkgDiff) {
		lines.push(`  packages   ${pkgDiff.unchanged.length} synced`);
	}
	lines.push("");

	// Pending 变更摘要
	const pending = formatInventorySummary(inventory);
	if (pending) {
		lines.push("Pending");
		lines.push(pending);
	} else {
		lines.push("Up to date — no pending changes.");
	}

	// 详细变更列表
	const detail = formatInventoryDetail(inventory);
	if (detail) {
		lines.push("");
		lines.push(detail);
	}

	return lines.join("\n").replace(/\n+$/, "");
}

// ========== 文件比较 diff ==========

export function formatComparisonDiff(comparisons: FileComparison[]): string {
	if (comparisons.length === 0) return "No files to compare.";

	const lines: string[] = [];
	let hasContent = false;

	for (const comp of comparisons) {
		const icon = changeTypeIcon(comp.changeType);
		const label = changeTypeLabel(comp.changeType);
		const isConflict =
			comp.changeType === "both_modified" ||
			comp.changeType === "local_modified_remote_deleted" ||
			comp.changeType === "local_deleted_remote_modified";

		if (comp.changeType === "no_change") continue;
		hasContent = true;

		const line = `  ${icon} ${comp.relativePath}  [${label}]`;
		lines.push(isConflict ? boldRed(line) : line);

		if (
			comp.changeType === "local_only" ||
			comp.changeType === "remote_only" ||
			comp.changeType === "both_modified"
		) {
			if (comp.local && comp.remote) {
				lines.push(`    local:  ${comp.local.sha256.substring(0, 12)}...`);
				lines.push(`    remote: ${comp.remote.sha256.substring(0, 12)}...`);
			}
		}
	}

	if (!hasContent) return "No changes detected.";
	return lines.join("\n");
}

// ========== Inventory 摘要 ==========

function formatInventorySummary(inventory: InventoryResult): string {
	const s = inventory.summary;
	const parts: string[] = [];

	if (s.localOnly > 0 || s.localCreated > 0 || s.localDeleted > 0) {
		parts.push(
			`agent changes: ${s.localOnly} modified, ${s.localCreated} new, ${s.localDeleted} deleted`,
		);
	}
	if (s.remoteOnly > 0 || s.remoteCreated > 0 || s.remoteDeleted > 0) {
		parts.push(
			`repo changes: ${s.remoteOnly} modified, ${s.remoteCreated} new, ${s.remoteDeleted} deleted`,
		);
	}
	if (s.bothModified > 0) {
		parts.push(
			boldRed(`CONFLICTS: ${s.bothModified} files modified on both sides`),
		);
	}
	if (s.converged > 0) {
		parts.push(`${s.converged} converged`);
	}

	return parts.length > 0 ? "  " + parts.join("\n  ") : "";
}

// ========== Inventory 详情 ==========

function formatInventoryDetail(inventory: InventoryResult): string {
	const interesting = inventory.comparisons.filter(
		(c) => c.changeType !== "no_change",
	);

	if (interesting.length === 0) return "";

	const lines: string[] = ["Changes:"];
	for (const comp of interesting) {
		const icon = changeTypeIcon(comp.changeType);
		const label = changeTypeLabel(comp.changeType);
		const isConflict =
			comp.changeType === "both_modified" ||
			comp.changeType === "local_modified_remote_deleted" ||
			comp.changeType === "local_deleted_remote_modified";
		const line = `  ${icon} ${comp.relativePath}  (${label})`;
		lines.push(isConflict ? boldRed(line) : line);
	}

	return lines.join("\n");
}

// ========== 变更类型图标和标签 ==========

function changeTypeIcon(type: string): string {
	switch (type) {
		case "no_change":
			return " ";
		case "local_only":
			return "L";
		case "remote_only":
			return "R";
		case "converged":
			return "=";
		case "both_modified":
			return "!";
		case "local_created":
			return "+";
		case "remote_created":
			return "+";
		case "local_deleted":
			return "-";
		case "remote_deleted":
			return "-";
		case "both_deleted":
			return "~";
		case "local_modified_remote_deleted":
			return "!";
		case "local_deleted_remote_modified":
			return "!";
		case "untracked_local":
			return "?";
		default:
			return "?";
	}
}

function changeTypeLabel(type: string): string {
	switch (type) {
		case "no_change":
			return "unchanged";
		case "local_only":
			return "agent modified";
		case "remote_only":
			return "repo modified";
		case "converged":
			return "converged";
		case "both_modified":
			return "BOTH MODIFIED";
		case "local_created":
			return "agent new";
		case "remote_created":
			return "repo new";
		case "local_deleted":
			return "agent deleted";
		case "remote_deleted":
			return "repo deleted";
		case "both_deleted":
			return "both deleted";
		case "local_modified_remote_deleted":
			return "CONFLICT: agent mod / repo del";
		case "local_deleted_remote_modified":
			return "CONFLICT: agent del / repo mod";
		case "untracked_local":
			return "untracked";
		default:
			return type;
	}
}

// ========== Settings 变更 ==========

export function formatSettingsChanges(
	changes: Record<string, { before: unknown; after: unknown }>,
): string {
	if (Object.keys(changes).length === 0) return "No settings changes.";

	const lines: string[] = ["Settings changes:"];
	for (const [key, change] of Object.entries(changes)) {
		const beforeStr =
			change.before === undefined ? "(not set)" : JSON.stringify(change.before);
		const afterStr = JSON.stringify(change.after);
		const truncateLen = 80;
		const b =
			beforeStr.length > truncateLen
				? beforeStr.slice(0, truncateLen) + "..."
				: beforeStr;
		const a =
			afterStr.length > truncateLen
				? afterStr.slice(0, truncateLen) + "..."
				: afterStr;
		lines.push(`  ${key}:`);
		lines.push(`    - ${b}`);
		lines.push(`    + ${a}`);
	}
	return lines.join("\n");
}

// ========== 秘密扫描 ==========

export function formatSecretsFindings(
	findings: Array<{ type: string; file: string; line?: number }>,
): string {
	if (findings.length === 0) return "No secrets detected.";

	const lines: string[] = [
		`⚠ WARNING: ${findings.length} potential secret(s) found:`,
		"",
	];
	for (const finding of findings) {
		const lineInfo = finding.line ? `:${finding.line}` : "";
		lines.push(`  [${finding.type}] ${finding.file}${lineInfo}`);
	}
	return lines.join("\n");
}

// ========== Package diff ==========

export function formatPackageDiff(diff: PackageDiff): string {
	if (
		diff.added.length === 0 &&
		diff.removed.length === 0 &&
		diff.changed.length === 0
	) {
		return "No package changes.";
	}

	const lines: string[] = [];
	if (diff.added.length > 0) {
		lines.push(`  Packages to install (${diff.added.length}):`);
		for (const pkg of diff.added) lines.push(`    + ${pkg}`);
	}
	if (diff.removed.length > 0) {
		lines.push(
			`  Local-only packages (not auto-removed) (${diff.removed.length}):`,
		);
		for (const pkg of diff.removed) lines.push(`    - ${pkg}`);
	}
	if (diff.changed.length > 0) {
		lines.push(`  Packages to update (${diff.changed.length}):`);
		for (const pkg of diff.changed) lines.push(`    ~ ${pkg}`);
	}
	if (diff.unchanged.length > 0) {
		lines.push(`  Packages unchanged: ${diff.unchanged.length}`);
	}
	return lines.join("\n");
}

// ========== 校验错误 ==========

export function formatValidationErrors(errors: ValidationError[]): string {
	if (errors.length === 0) return "No validation errors.";

	const lines: string[] = ["Validation errors:"];
	for (const err of errors) {
		const prefix = err.severity === "error" ? "ERROR" : "WARN";
		lines.push(`  [${prefix}] ${err.file}: ${err.message}`);
	}
	return lines.join("\n");
}

// ========== Capture 结果 ==========

export function formatCaptureResult(result: CaptureResult): string {
	const lines: string[] = [];

	if (result.hasConflicts) {
		lines.push(boldRed("Capture blocked: bilateral modifications detected."));
		lines.push("");
		lines.push(
			"Both your local agent copy and the remote repo copy have changed since the last sync.",
		);
		lines.push("");
		lines.push("To resolve:");
		lines.push(
			"  - Keep remote version: copy the file from the repo to your agent, then run /pisync",
		);
		lines.push(
			"  - Keep local version:  copy the file from your agent to the repo, then run /pisync",
		);
		lines.push("  - Or manually merge the two versions, then run /pisync");
		lines.push("");
		lines.push(boldRed("Conflicts:"));
		for (const c of result.conflicts) {
			lines.push(red(`  ${c.relativePath}`));
		}
		return lines.join("\n");
	}

	lines.push("Capture complete:");

	if (result.captured.length > 0) {
		lines.push(`  Captured (${result.captured.length}):`);
		for (const f of result.captured) lines.push(`    + ${f}`);
	}

	if (result.deleted.length > 0) {
		lines.push(`  Deleted from repo (${result.deleted.length}):`);
		for (const f of result.deleted) lines.push(`    - ${f}`);
	}

	if (result.denied.length > 0) {
		lines.push(`  Denied (${result.denied.length}):`);
		for (const f of result.denied) lines.push(`    ! ${f}`);
	}

	if (result.errors.length > 0) {
		lines.push(`  Errors (${result.errors.length}):`);
		for (const e of result.errors) lines.push(`    x ${e.file}: ${e.message}`);
	}

	if (
		result.captured.length === 0 &&
		result.deleted.length === 0 &&
		result.errors.length === 0
	) {
		lines.push("  No changes to capture.");
	}

	return lines.join("\n");
}

// ========== 辅助 ==========

function formatTimestamp(iso: string): string {
	const m = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.exec(iso);
	return m ? m[0]!.replace("T", " ") : iso;
}
