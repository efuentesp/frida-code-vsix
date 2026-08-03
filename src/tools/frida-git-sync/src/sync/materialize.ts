/**
 * Materialize: repo → agent
 *
 * 将仓库 sync/ 目录中的文件应用到 Pi agent 目录。
 *
 * 功能：
 * - 原子单文件写入（临时文件 → fsync → rename）
 * - 支持创建、更新和删除（仅 tracked 文件）
 * - 完整备份与失败回滚
 * - 全部预校验后再执行
 *
 * v0.2: nextBaseline — 按最终预期状态构建完整基线，而非按实际写入列表增量合并
 */
import {
	readFile,
	writeFile,
	rename,
	mkdir,
	unlink,
	stat as fsStat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { isDenied } from "../system/security";
import {
	hasConflictMarkers,
	validateJson,
	validateSettingsPortability,
} from "./validate";
import type { PiSyncConfig } from "./config";
import type { SyncState, BaselineEntry } from "../system/state";
import {
	compareFiles,
	getApplicableFiles,
	sha256File,
	type FileComparison,
} from "./inventory";
import { resolveRepoSyncRoot, resolveWithinRoot } from "../system/path-safety";
import { mergeLocalPackagesIntoSettings } from "./settings-portability";

// ========== 类型定义 ==========

export interface MaterializeWrite {
	relativePath: string;
	content: Buffer;
	mode: number;
}

export interface MaterializePlan {
	/** 要创建/更新的文件 */
	toWrite: MaterializeWrite[];
	/** 要删除的文件 */
	toDelete: string[];
	/** 冲突文件 */
	conflicts: FileComparison[];
	/** 预校验错误 */
	validationErrors: Array<{
		file: string;
		message: string;
		severity: "error" | "warning";
	}>;
	/** 是否有阻断性错误（冲突或校验错误） */
	blocked: boolean;
	/** 成功应用后的完整基线（如果 blocked 则为 null） */
	nextBaseline: Record<string, BaselineEntry> | null;
	/** 是否有状态变更（包括纯基线收敛、无文件 I/O 的情况） */
	hasStateChanges: boolean;
}

export interface MaterializeOptions {
	/** Conflict paths explicitly selected from the shared remote during resolution. */
	useRemoteForConflicts?: ReadonlySet<string>;
}

export interface MaterializeResult {
	/** 成功写入的文件 */
	written: string[];
	/** 成功删除的文件 */
	deleted: string[];
	/** 跳过的文件 */
	skipped: string[];
	/** 失败的文件 */
	failed: Array<{ file: string; reason: string }>;
}

// ========== 原子写入 ==========

/**
 * 原子写入文件：
 * 1. 写入同目录临时文件
 * 2. 设置 mode
 * 3. rename 到目标路径
 */
export async function atomicWrite(
	targetPath: string,
	content: Buffer | string,
	mode?: number,
): Promise<void> {
	const targetDir = dirname(targetPath);
	await mkdir(targetDir, { recursive: true });

	const tmpName = `.${basename(targetPath)}.${randomBytes(4).toString("hex")}.tmp`;
	const tmpPath = join(targetDir, tmpName);

	const buffer =
		typeof content === "string" ? Buffer.from(content, "utf-8") : content;
	await writeFile(tmpPath, buffer, { mode: mode ?? 0o644 });

	try {
		await rename(tmpPath, targetPath);
	} catch {
		// rename 失败时清理临时文件
		try {
			await unlink(tmpPath);
		} catch {
			/* ignore */
		}
		throw new Error(`Failed to rename ${tmpName} → ${basename(targetPath)}`);
	}
}

// ========== 计划生成 ==========

/**
 * 生成 apply 计划：列出需要创建、更新、删除的文件，并构建完整 nextBaseline
 */
export async function planMaterialize(
	agentDir: string,
	repoPath: string,
	config: PiSyncConfig,
	state: SyncState,
	options: MaterializeOptions = {},
): Promise<MaterializePlan> {
	const safeRoot = await resolveRepoSyncRoot(repoPath, config.root, "read");
	const inventory = await compareFiles(agentDir, repoPath, config, state);

	const plan: MaterializePlan = {
		toWrite: [],
		toDelete: [],
		conflicts: [],
		validationErrors: [],
		blocked: false,
		nextBaseline: null,
		hasStateChanges: false,
	};

	// 收集冲突
	plan.conflicts = inventory.comparisons.filter(
		(c) =>
			(c.changeType === "both_modified" ||
				c.changeType === "local_modified_remote_deleted" ||
				c.changeType === "local_deleted_remote_modified") &&
			!options.useRemoteForConflicts?.has(c.relativePath),
	);

	if (plan.conflicts.length > 0) {
		plan.blocked = true;
		return plan;
	}

	// 获取需要 apply 的变更
	const applicable = inventory.comparisons.filter(
		(comp) =>
			getApplicableFiles([comp]).length > 0 ||
			options.useRemoteForConflicts?.has(comp.relativePath) === true,
	);

	for (const comp of applicable) {
		const relPath = comp.relativePath;

		// Hard deny 检查 —— 永不 apply
		if (isDenied(relPath)) {
			continue;
		}

		const useRemoteForConflict =
			options.useRemoteForConflicts?.has(relPath) === true;
		if (
			comp.changeType === "remote_created" ||
			comp.changeType === "remote_only" ||
			(useRemoteForConflict && comp.remote !== null)
		) {
			// repo 中有新文件或更新的文件 → 写回 agent
			const repoFilePath = await resolveWithinRoot(safeRoot, relPath, "read");
			if (existsSync(repoFilePath)) {
				try {
					let content: Buffer = await readFile(repoFilePath);
					const fileStat = await fsStat(repoFilePath);

					// 冲突标记检查
					const contentStr = content.toString("utf-8");
					if (hasConflictMarkers(contentStr)) {
						plan.validationErrors.push({
							file: relPath,
							message: "Contains Git conflict markers",
							severity: "error",
						});
					}

					// JSON 校验
					if (relPath.endsWith(".json")) {
						const jsonErrors = validateJson(relPath, contentStr);
						plan.validationErrors.push(...jsonErrors);
					}

					// settings.json 可移植性检查
					if (relPath === "settings.json") {
						plan.validationErrors.push(
							...validateSettingsPortability(contentStr),
						);
						const localFilePath = await resolveWithinRoot(
							agentDir,
							relPath,
							"read",
						);
						if (existsSync(localFilePath)) {
							content = mergeLocalPackagesIntoSettings(
								content,
								await readFile(localFilePath),
							);
						}
					}

					plan.toWrite.push({
						relativePath: relPath,
						content,
						mode: fileStat.mode & 0o777,
					});
				} catch (err) {
					plan.validationErrors.push({
						file: relPath,
						message: `Cannot read: ${err instanceof Error ? err.message : "Unknown"}`,
						severity: "error",
					});
				}
			}
		} else if (
			(comp.changeType === "remote_deleted" ||
				comp.changeType === "both_deleted" ||
				(useRemoteForConflict && comp.remote === null)) &&
			config.delete === "tracked" &&
			state.files[relPath]
		) {
			// repo 中删除了已管理的文件 → agent 中也删除
			plan.toDelete.push(relPath);
		}
		// converged / no_change: 不产生文件 I/O，但需要更新基线
	}

	// 判断是否被阻断
	const blockingErrors = plan.validationErrors.filter(
		(e) => e.severity === "error",
	);
	if (blockingErrors.length > 0) {
		plan.blocked = true;
		return plan;
	}

	// 构建完整 nextBaseline（按最终预期状态）
	plan.nextBaseline = await buildNextBaseline(
		inventory,
		state,
		options.useRemoteForConflicts,
	);
	plan.hasStateChanges = true;

	return plan;
}

// ========== nextBaseline 构建 ==========

/**
 * 构建成功 apply 后的完整基线。
 *
 * 规则：
 * - no_change、converged、remote_only、remote_created：
 *   以 repo 文件的 hash/mode 进入基线
 * - remote_deleted、both_deleted：从基线移除
 * - 冲突项：不生成 baseline（计划 blocked）
 * - hard deny 和不在 include 中的文件：永不进入 baseline
 */
export async function buildNextBaseline(
	inventory: { comparisons: FileComparison[] },
	state: SyncState,
	useRemoteForConflicts?: ReadonlySet<string>,
): Promise<Record<string, BaselineEntry>> {
	const baseline: Record<string, BaselineEntry> = {};

	for (const comp of inventory.comparisons) {
		const relPath = comp.relativePath;

		// A selected remote version is now the new baseline even though the
		// pre-apply inventory still describes a bilateral change.
		if (useRemoteForConflicts?.has(relPath)) {
			if (comp.remote) {
				baseline[relPath] = {
					sha256: comp.remote.sha256,
					mode: comp.remote.mode,
				};
			}
			continue;
		}

		// 跳过 hard deny 文件
		if (isDenied(relPath)) continue;

		switch (comp.changeType) {
			case "no_change":
			case "converged":
			case "remote_only":
			case "remote_created":
				// 以 repo 文件（最终期望状态）的 hash/mode 进入 baseline
				if (comp.remote) {
					baseline[relPath] = {
						sha256: comp.remote.sha256,
						mode: comp.remote.mode,
					};
				} else if (comp.local) {
					// remote 不存在但 local 存在且应该保持一致（converged）
					baseline[relPath] = {
						sha256: comp.local.sha256,
						mode: comp.local.mode,
					};
				} else if (state.files[relPath]) {
					// 两边都不存在但基线有记录 → 保持原基线（不应发生）
					baseline[relPath] = state.files[relPath]!;
				}
				break;

			case "remote_deleted":
			case "both_deleted":
				// 从基线中移除（不添加）
				break;

			case "local_only":
			case "local_created":
			case "local_deleted":
				// 这些是 capture 方向的操作，apply 中不应出现
				// 如果出现，保持现有基线
				if (state.files[relPath]) {
					baseline[relPath] = state.files[relPath]!;
				}
				break;

			case "both_modified":
			case "local_modified_remote_deleted":
			case "local_deleted_remote_modified":
				// 冲突情况，不应在成功计划中出现
				break;

			case "untracked_local":
				// 不在 include 中，不进入基线
				break;
		}
	}

	return baseline;
}

// ========== 执行 ==========

/**
 * 执行 materialize 计划
 *
 * @returns 执行结果
 */
export async function executeMaterialize(
	agentDir: string,
	plan: MaterializePlan,
): Promise<MaterializeResult> {
	const result: MaterializeResult = {
		written: [],
		deleted: [],
		skipped: [],
		failed: [],
	};

	// 1. 写入文件
	for (const item of plan.toWrite) {
		try {
			const targetPath = await getSafeAgentPath(agentDir, item.relativePath);
			await atomicWrite(targetPath, item.content, item.mode);
			result.written.push(item.relativePath);
		} catch (err) {
			result.failed.push({
				file: item.relativePath,
				reason: err instanceof Error ? err.message : "Unknown error",
			});
		}
	}

	// 2. 删除文件
	for (const relPath of plan.toDelete) {
		try {
			const targetPath = await getSafeAgentPath(agentDir, relPath);
			if (existsSync(targetPath)) {
				await unlink(targetPath);
				result.deleted.push(relPath);
			} else {
				result.skipped.push(relPath);
			}
		} catch (err) {
			result.failed.push({
				file: relPath,
				reason: err instanceof Error ? err.message : "Unknown error",
			});
		}
	}

	return result;
}

// ========== 辅助函数 ==========

async function getSafeAgentPath(
	agentDir: string,
	relativePath: string,
): Promise<string> {
	return resolveWithinRoot(agentDir, relativePath, "write");
}

/**
 * 从 agent 目录读取文件并计算基线 hash
 */
export async function readAgentFile(
	agentDir: string,
	relativePath: string,
): Promise<{ content: Buffer; sha256: string; mode: number } | null> {
	const fullPath = await getSafeAgentPath(agentDir, relativePath);
	if (!existsSync(fullPath)) return null;

	const content = await readFile(fullPath);
	const fileStat = await fsStat(fullPath);

	return {
		content,
		sha256: await sha256File(fullPath),
		mode: fileStat.mode & 0o777,
	};
}
