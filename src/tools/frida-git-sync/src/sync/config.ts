/**
 * pi-sync.json schema v2 读取、校验和类型定义
 *
 * 与 v1 的关键差异：
 * - root + include/exclude glob 白名单取代 files[] 逐文件映射
 * - settings.json 作为完整共享文件，不再做 managed-key merge
 * - 配置仓库不再作为 Pi Package 安装
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ========== Schema v2 类型 ==========

export interface PiSyncConfig {
	schemaVersion: 2;
	/** Git 分支名，默认 "main" */
	branch: string;
	/** 仓库内的同步根目录，相对路径，默认 "sync" */
	root: string;
	/** Glob 白名单，相对于 root */
	include: string[];
	/** Glob 排除列表，优先级高于 include（但低于内置 hard deny） */
	exclude: string[];
	/** 删除语义："tracked" 表示只删除上次同步基线中已管理的文件 */
	delete: "tracked" | "none";
	/** pull/fetch Git 操作超时时间（毫秒） */
	pullTimeoutMs: number;
	/** 安全配置 */
	security: PiSyncSecurity;
}

export interface PiSyncSecurity {
	scanSecretsBeforePush: boolean;
}

// ========== 默认配置 ==========

export const DEFAULT_CONFIG: PiSyncConfig = {
	schemaVersion: 2,
	branch: "main",
	root: "sync",
	include: [
		"settings.json",
		"AGENTS.md",
		"SYSTEM.md",
		"APPEND_SYSTEM.md",
		"keybindings.json",
		"extensions/**",
		"skills/**",
		"prompts/**",
		"themes/**",
	],
	exclude: ["**/.DS_Store", "**/*.tmp", "**/*.log"],
	delete: "tracked",
	pullTimeoutMs: 10000,
	security: {
		scanSecretsBeforePush: true,
	},
};

// ========== 加载与校验 ==========

/**
 * 加载并校验 pi-sync.json（仅支持 schema v2）
 */
export async function loadPiSyncConfig(
	repoPath: string,
): Promise<PiSyncConfig> {
	const configPath = join(repoPath, "pi-sync.json");
	let raw: Record<string, unknown>;

	try {
		const content = await readFile(configPath, "utf-8");
		raw = JSON.parse(content);
	} catch {
		throw new Error(`Cannot read or parse pi-sync.json at ${configPath}`);
	}

	return validateConfig(raw);
}

/**
 * 校验配置对象（schema v2）
 */
export function validateConfig(raw: Record<string, unknown>): PiSyncConfig {
	const version = raw.schemaVersion;
	if (version !== 2) {
		throw new Error(
			`Unsupported schemaVersion: ${version}. This version of pi-git-sync requires schemaVersion 2. ` +
				`If you have a v1 config, please migrate to the new format.`,
		);
	}

	const isUnsafeRelativePath = (value: string): boolean =>
		value.includes("\0") ||
		value.startsWith("/") ||
		value.startsWith("\\") ||
		/^[A-Za-z]:/.test(value) ||
		value.split(/[\\/]/).includes("..");

	// branch
	const branch = raw.branch ?? "main";
	if (
		typeof branch !== "string" ||
		branch.trim() === "" ||
		branch !== branch.trim() ||
		branch.startsWith("-") ||
		/[\0-\x1f\x7f]/.test(branch)
	) {
		throw new Error(
			"pi-sync.json: branch must be a valid, non-empty Git branch name.",
		);
	}

	// root
	const root = raw.root ?? "sync";
	if (typeof root !== "string" || root === "" || isUnsafeRelativePath(root)) {
		throw new Error(
			"pi-sync.json: root must be a relative path and must not contain '..'.",
		);
	}

	const validatePattern = (
		pattern: unknown,
		field: "include" | "exclude",
	): string => {
		if (
			typeof pattern !== "string" ||
			pattern === "" ||
			isUnsafeRelativePath(pattern)
		) {
			throw new Error(
				`pi-sync.json: invalid ${field} pattern "${String(pattern)}". Patterns must be relative and must not contain "..".`,
			);
		}
		return pattern;
	};

	// include
	const include = raw.include;
	if (!Array.isArray(include) || include.length === 0) {
		throw new Error(
			"pi-sync.json: include must be a non-empty array of glob patterns.",
		);
	}
	const validatedInclude = include.map((pattern) =>
		validatePattern(pattern, "include"),
	);

	// exclude
	const exclude = raw.exclude;
	if (exclude !== undefined && !Array.isArray(exclude)) {
		throw new Error("pi-sync.json: exclude must be an array of glob patterns.");
	}
	const validatedExclude = (exclude ?? []).map((pattern) =>
		validatePattern(pattern, "exclude"),
	);

	// delete
	const del = raw.delete;
	if (del !== undefined && del !== "tracked" && del !== "none") {
		throw new Error('pi-sync.json: delete must be "tracked" or "none".');
	}

	// pull timeout
	const pullTimeoutMs =
		raw.pullTimeoutMs === undefined ? 10000 : raw.pullTimeoutMs;
	if (
		typeof pullTimeoutMs !== "number" ||
		!Number.isInteger(pullTimeoutMs) ||
		pullTimeoutMs <= 0
	) {
		throw new Error("pi-sync.json: pullTimeoutMs must be a positive integer.");
	}

	// security
	const security = raw.security;
	if (
		security !== undefined &&
		(typeof security !== "object" ||
			security === null ||
			Array.isArray(security))
	) {
		throw new Error("pi-sync.json: security must be an object.");
	}
	const scanSecretsBeforePush = (
		security as Record<string, unknown> | undefined
	)?.scanSecretsBeforePush;
	if (
		scanSecretsBeforePush !== undefined &&
		typeof scanSecretsBeforePush !== "boolean"
	) {
		throw new Error(
			"pi-sync.json: security.scanSecretsBeforePush must be a boolean.",
		);
	}

	return {
		schemaVersion: 2,
		branch,
		root,
		include: validatedInclude,
		exclude: validatedExclude,
		delete: (del as "tracked" | "none" | undefined) ?? "tracked",
		pullTimeoutMs,
		security: {
			scanSecretsBeforePush: scanSecretsBeforePush ?? true,
		},
	};
}
