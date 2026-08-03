/**
 * 同步状态文件管理（schema v3）
 *
 * 状态文件：<config-repo>/.pi-sync/state.json（Git ignored）
 * 首次使用时会把旧的 $PI_CODING_AGENT_DIR/.pi-sync 迁移过去，并保留
 * 一个兼容用目录链接。保存同步基线，用于三方比较（B = 基线, L = 本地 agent, R = repo）
 *
 * v3 变化（v0.2）：
 * - pendingOperation 改为结构化 PendingOperation | null
 * - 迁移时自动修复 local==repo 的 baseline 条目
 */
import {
	readFile,
	writeFile,
	mkdir,
	rename,
	rm,
	lstat,
	symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname, isAbsolute, normalize, relative, sep } from "node:path";

// ========== 类型定义 ==========

export interface BaselineEntry {
	sha256: string;
	mode: number;
}

export interface PendingOperation {
	type: "push-rebase-conflict" | "apply-failed";
	startedAt: string;
	/** 额外的上下文信息（如失败的 commit） */
	context?: Record<string, unknown>;
}

export interface StateMigrationConflict {
	relativePath: string;
	reason: "local_repo_mismatch" | "path_unavailable";
	baseline: BaselineEntry;
	local: BaselineEntry | null;
	remote: BaselineEntry | null;
}

export interface StateMigrationReport {
	fromSchema: number;
	migratedAt: string;
	reconciled: string[];
	removed: string[];
	conflicts: StateMigrationConflict[];
}

export interface SyncStateV3 {
	schemaVersion: 3;
	/** 配置仓库的本地绝对路径 */
	repoPath: string;
	/** 同步分支 */
	branch: string;
	/** 上次成功同步的 commit */
	lastSyncedCommit: string | null;
	/** 上次同步时间 */
	lastSyncedAt: string | null;
	/** 同步基线：相对路径 → SHA-256 + mode */
	files: Record<string, BaselineEntry>;
	/** 待处理的操作，null 表示无待处理操作 */
	pendingOperation: PendingOperation | null;
	/** 上次备份时间戳 */
	lastBackup: string | null;
	/** 此 agent 实例的持久化设备标识；只保存在本地 state，绝不参与同步 */
	deviceId?: string | null;
	/** v2 → v3 迁移中无法安全选边的路径报告 */
	migrationReport?: StateMigrationReport;
}

/** v0.2 统一使用的状态类型 */
export type SyncState = SyncStateV3;

const CURRENT_SCHEMA_VERSION = 3;

const DEFAULT_STATE: SyncStateV3 = {
	schemaVersion: CURRENT_SCHEMA_VERSION,
	repoPath: "",
	branch: "main",
	lastSyncedCommit: null,
	lastSyncedAt: null,
	files: {},
	pendingOperation: null,
	lastBackup: null,
};

// ========== 路径 ==========

export function getStatePath(agentDir: string): string {
	return join(agentDir, ".pi-sync", "state.json");
}

function getLocalStateDir(agentDir: string): string {
	return join(agentDir, ".pi-sync");
}

async function ensureGitExcludesLocalState(repoPath: string): Promise<void> {
	const excludePath = join(repoPath, ".git", "info", "exclude");
	try {
		const current = existsSync(excludePath)
			? await readFile(excludePath, "utf-8")
			: "";
		if (!current.split(/\r?\n/).includes(".pi-sync/")) {
			await mkdir(dirname(excludePath), { recursive: true });
			await writeFile(
				excludePath,
				`${current}${current && !current.endsWith("\n") ? "\n" : ""}.pi-sync/\n`,
				"utf-8",
			);
		}
	} catch {
		// A non-standard Git worktree can still use the tracked .gitignore entry
		// created by scaffoldConfigRepoV2. Never block state migration on exclude.
	}
}

/**
 * Move local runtime data into the config repository, then leave a directory
 * symlink at the old agent path so existing APIs and third-party extensions
 * continue to resolve the same location. The target is Git-ignored.
 */
async function relocateLocalStateDir(
	agentDir: string,
	repoPath: string,
): Promise<void> {
	if (!repoPath || !existsSync(join(repoPath, ".git"))) return;

	const source = getLocalStateDir(agentDir);
	const target = getLocalStateDir(repoPath);
	let sourceInfo = await lstat(source).catch(() => null);
	if (sourceInfo?.isSymbolicLink()) {
		// `init --force` can remove the old config repository and leave this
		// compatibility link dangling. Remove only the broken link, never its
		// target, then recreate the local state directory in the new repository.
		if (existsSync(source)) return;
		await rm(source, { force: true });
		sourceInfo = null;
	}

	await ensureGitExcludesLocalState(repoPath);
	const targetInfo = await lstat(target).catch(() => null);
	if (sourceInfo && targetInfo) {
		// Both locations contain data. Keep the legacy directory untouched rather
		// than guessing which local state is newer.
		throw new Error(
			`Cannot migrate local sync state: both ${source} and ${target} exist.`,
		);
	}
	if (sourceInfo) {
		await rename(source, target);
	} else if (!targetInfo) {
		await mkdir(target, { recursive: true });
	}

	await mkdir(dirname(source), { recursive: true });
	await symlink(
		target,
		source,
		process.platform === "win32" ? "junction" : "dir",
	);
}

async function relocateStateIfConfigured(agentDir: string): Promise<void> {
	const statePath = getStatePath(agentDir);
	const info = await lstat(getLocalStateDir(agentDir)).catch(() => null);
	if (info?.isSymbolicLink() || !existsSync(statePath)) return;

	try {
		const state = JSON.parse(await readFile(statePath, "utf-8")) as {
			repoPath?: unknown;
		};
		if (typeof state.repoPath === "string") {
			await relocateLocalStateDir(agentDir, state.repoPath);
		}
	} catch {
		// Preserve existing corrupt state behavior: loadState returns DEFAULT_STATE.
	}
}

// ========== 读取 ==========

export async function loadState(agentDir: string): Promise<SyncState> {
	await relocateStateIfConfigured(agentDir);
	const statePath = getStatePath(agentDir);

	if (!existsSync(statePath)) {
		return { ...DEFAULT_STATE };
	}

	try {
		const content = await readFile(statePath, "utf-8");
		const parsed = JSON.parse(content);
		const version = parsed.schemaVersion ?? 1;

		if (version >= CURRENT_SCHEMA_VERSION) {
			return {
				...DEFAULT_STATE,
				...parsed,
				schemaVersion: CURRENT_SCHEMA_VERSION,
			};
		}

		// 逐级迁移。迁移成功后立即持久化 v3，避免每次命令重复猜测基线。
		let migrated: Record<string, unknown> = parsed;
		if (version === 1) migrated = migrateV1ToV2(migrated);
		if ((migrated as { schemaVersion: number }).schemaVersion === 2) {
			migrated = await migrateV2ToV3(migrated, agentDir);
			const migratedState: SyncState = {
				...DEFAULT_STATE,
				...migrated,
				schemaVersion: CURRENT_SCHEMA_VERSION as 3,
			};
			await saveState(agentDir, migratedState);
			return migratedState;
		}

		return {
			...DEFAULT_STATE,
			...migrated,
			schemaVersion: CURRENT_SCHEMA_VERSION,
		};
	} catch {
		return { ...DEFAULT_STATE };
	}
}

// ========== 保存 ==========

/**
 * Return a stable identity for this local agent. Host names alone are not
 * unique: cloned machines and restored backups can share one. The id lives in
 * the local state file, which is deliberately excluded from sync.
 */
export async function ensureDeviceId(agentDir: string): Promise<string> {
	const state = await loadState(agentDir);
	if (
		state.deviceId &&
		/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(state.deviceId)
	) {
		return state.deviceId;
	}

	const deviceId = randomUUID();
	await saveState(agentDir, { ...state, deviceId });
	return deviceId;
}

export async function saveState(
	agentDir: string,
	state: SyncState,
): Promise<void> {
	await relocateLocalStateDir(agentDir, state.repoPath);
	const statePath = getStatePath(agentDir);
	const tempPath = join(dirname(statePath), `.state-${randomUUID()}.tmp`);
	await mkdir(dirname(statePath), { recursive: true });

	try {
		await writeFile(tempPath, JSON.stringify(state, null, 2), "utf-8");
		await rename(tempPath, statePath);
	} finally {
		await rm(tempPath, { force: true }).catch(() => undefined);
	}
}

// ========== 更新 ==========

export async function updateState(
	agentDir: string,
	updates: Partial<SyncState>,
): Promise<SyncState> {
	const current = await loadState(agentDir);
	const updated = { ...current, ...updates };
	await saveState(agentDir, updated);
	return updated;
}

// ========== 基线计算 ==========

/**
 * 从文件记录计算基线条目
 */
export function computeBaselineEntry(
	sha256: string,
	mode: number,
): BaselineEntry {
	return { sha256, mode };
}

/**
 * 从状态中查找某文件的基线记录
 */
export function getBaselineFile(
	state: SyncState,
	relativePath: string,
): BaselineEntry | null {
	return state.files[relativePath] ?? null;
}

// ========== 迁移 ==========

function migrateV1ToV2(v1: Record<string, unknown>): Record<string, unknown> {
	return {
		schemaVersion: 2,
		repoPath: (v1.repoPath as string) ?? "",
		branch: (v1.branch as string) ?? "main",
		lastSyncedCommit: (v1.lastAppliedCommit as string) ?? null,
		lastSyncedAt: (v1.lastAppliedAt as string) ?? null,
		files: {},
		pendingOperation: null,
		lastBackup: (v1.lastBackup as string) ?? null,
	};
}

/**
 * v2 → v3 迁移
 *
 * v2 的 baseline 可能来自一次未完成的 apply，因此不能直接相信旧 hash。
 * 只有 agent 与 repo 当前内容 hash 相同，或两边都不存在时，才自动收敛；
 * 其他情况保留旧 baseline，并把路径写入 migrationReport 供 status 处理。
 */
async function migrateV2ToV3(
	v2: Record<string, unknown>,
	agentDir: string,
): Promise<Record<string, unknown>> {
	await backupOldState(agentDir, v2, 2);

	const oldFiles = isBaselineMap(v2.files) ? v2.files : {};
	const files: Record<string, BaselineEntry> = { ...oldFiles };
	const report: StateMigrationReport = {
		fromSchema: 2,
		migratedAt: new Date().toISOString(),
		reconciled: [],
		removed: [],
		conflicts: [],
	};
	const repoRoot = await getMigrationRepoRoot(v2.repoPath);

	for (const [relativePath, baseline] of Object.entries(oldFiles)) {
		const local = await readMigrationFile(agentDir, relativePath);
		const remote = repoRoot
			? await readMigrationFile(repoRoot, relativePath)
			: { available: false, entry: null };

		if (!local.available || !remote.available) {
			report.conflicts.push({
				relativePath,
				reason: "path_unavailable",
				baseline,
				local: local.entry,
				remote: remote.entry,
			});
			continue;
		}

		if (!local.entry && !remote.entry) {
			delete files[relativePath];
			report.removed.push(relativePath);
			continue;
		}

		if (
			local.entry &&
			remote.entry &&
			local.entry.sha256 === remote.entry.sha256
		) {
			files[relativePath] = {
				sha256: local.entry.sha256,
				mode: remote.entry.mode,
			};
			report.reconciled.push(relativePath);
			continue;
		}

		report.conflicts.push({
			relativePath,
			reason: "local_repo_mismatch",
			baseline,
			local: local.entry,
			remote: remote.entry,
		});
	}

	let pendingOp: PendingOperation | null = null;
	if (isPendingOperationType(v2.pendingOperation)) {
		pendingOp = {
			type: v2.pendingOperation,
			startedAt: (v2.lastSyncedAt as string) ?? new Date().toISOString(),
		};
	}

	return {
		...v2,
		schemaVersion: 3,
		files,
		pendingOperation: pendingOp,
		...(report.reconciled.length > 0 ||
		report.removed.length > 0 ||
		report.conflicts.length > 0
			? { migrationReport: report }
			: {}),
	};
}

function isPendingOperationType(
	value: unknown,
): value is PendingOperation["type"] {
	return value === "push-rebase-conflict" || value === "apply-failed";
}

function isBaselineMap(value: unknown): value is Record<string, BaselineEntry> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.entries(value).every(
		([path, entry]) =>
			isSafeMigrationPath(path) &&
			Boolean(entry) &&
			typeof entry === "object" &&
			typeof (entry as { sha256?: unknown }).sha256 === "string" &&
			typeof (entry as { mode?: unknown }).mode === "number",
	);
}

function isSafeMigrationPath(relativePath: string): boolean {
	if (!relativePath || relativePath.includes("\\0") || isAbsolute(relativePath))
		return false;
	const normalized = normalize(relativePath);
	return normalized !== ".." && !normalized.startsWith(`..${sep}`);
}

interface MigrationFileResult {
	available: boolean;
	entry: BaselineEntry | null;
}

async function readMigrationFile(
	baseDir: string,
	relativePath: string,
): Promise<MigrationFileResult> {
	if (!isSafeMigrationPath(relativePath))
		return { available: false, entry: null };

	const targetPath = join(baseDir, relativePath);
	const relativeTarget = relative(baseDir, targetPath);
	if (relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
		return { available: false, entry: null };
	}

	const components = relativeTarget.split(sep).filter(Boolean);
	let currentPath = baseDir;
	for (const [index, component] of components.entries()) {
		currentPath = join(currentPath, component);
		let info;
		try {
			info = await lstat(currentPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { available: true, entry: null };
			}
			return { available: false, entry: null };
		}
		if (info.isSymbolicLink()) return { available: false, entry: null };
		if (index < components.length - 1 && !info.isDirectory()) {
			return { available: true, entry: null };
		}
		if (index === components.length - 1 && !info.isFile()) {
			return { available: true, entry: null };
		}
	}

	try {
		const content = await readFile(targetPath);
		const info = await lstat(targetPath);
		return {
			available: true,
			entry: {
				sha256: createHash("sha256").update(content).digest("hex"),
				mode: info.mode & 0o777,
			},
		};
	} catch {
		return { available: false, entry: null };
	}
}

async function getMigrationRepoRoot(repoPath: unknown): Promise<string | null> {
	if (typeof repoPath !== "string" || !repoPath || !isAbsolute(repoPath))
		return null;

	try {
		const repoInfo = await lstat(repoPath);
		if (!repoInfo.isDirectory() || repoInfo.isSymbolicLink()) return null;
		const manifestPath = join(repoPath, "pi-sync.json");
		const manifestInfo = await lstat(manifestPath);
		if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) return null;
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
			root?: unknown;
		};
		const root = typeof manifest.root === "string" ? manifest.root : "sync";
		if (!isSafeMigrationPath(root)) return null;
		const rootPath = join(repoPath, root);
		try {
			const rootInfo = await lstat(rootPath);
			if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return null;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
			// A missing sync root is an empty remote side, not an unavailable repo.
		}
		return rootPath;
	} catch {
		return null;
	}
}

/**
 * 备份旧 schema 的 state 文件
 */
async function backupOldState(
	agentDir: string,
	state: Record<string, unknown>,
	version: number,
): Promise<void> {
	const stateDir = dirname(getStatePath(agentDir));
	const backupPath = join(
		stateDir,
		`state.v${version}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
	);
	await mkdir(stateDir, { recursive: true });
	await writeFile(backupPath, JSON.stringify(state, null, 2), "utf-8");
}
