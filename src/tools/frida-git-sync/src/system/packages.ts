/**
 * Package declarations, trust and reconciliation.
 *
 * Remote settings are data, not permission to execute code. New or changed
 * sources require explicit approval before `pi install` or `pi remove` runs.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { PiSyncConfig } from "../sync/config";
import { getOperationSignal } from "./operation-context";
import { resolveRepoSyncRoot, resolveWithinRoot } from "./path-safety";
export { isPortablePackageSource } from "../sync/settings-portability";

const execFileAsync = promisify(execFileCb);

// ========== 类型 ==========

export interface PackageDeclaration {
	source: string;
	normalizedSource: string;
}

export interface PackageTrustStore {
	schemaVersion: 1;
	approved: Record<string, string>;
}

export interface PackagePlan {
	added: PackageDeclaration[];
	changed: Array<{ local: PackageDeclaration; remote: PackageDeclaration }>;
	unchanged: PackageDeclaration[];
	approvalRequired: string[];
}

export interface PackageApproval {
	approvedSources: string[];
	remember?: boolean;
}

export interface PackageDiff {
	added: string[];
	removed: string[];
	changed: string[];
	unchanged: string[];
}

export interface ReconcileResult {
	installed: string[];
	errors: string[];
	approvalRequired?: string[];
	/** Sources successfully restored or removed after a later install failed. */
	rolledBack?: string[];
	/** Rollback actions that could not be completed. */
	rollbackErrors?: string[];
}

// ========== 安全解析 ==========

function validatePackageSource(source: unknown): string {
	if (typeof source !== "string" || source.length === 0) {
		throw new Error("Package source must be a non-empty string");
	}
	if (/[\u0000-\u001f\u007f]/.test(source)) {
		throw new Error(
			`Package source contains control characters: ${JSON.stringify(source)}`,
		);
	}
	if (/^(?:file:|\.\.?[\\/]|[\\/]||~[\\/])/i.test(source)) {
		throw new Error(`Local package paths are not allowed: ${source}`);
	}
	if (!/^(?:npm:|git:|https?:\/\/|ssh:\/\/)/i.test(source)) {
		throw new Error(`Unsupported package source: ${source}`);
	}
	return source;
}

export function parsePackageDeclarations(
	settings: Record<string, unknown>,
	opts?: { skipInvalid?: boolean },
): PackageDeclaration[] {
	const raw = settings.packages;
	if (raw === undefined) return [];
	if (!Array.isArray(raw))
		throw new Error("settings.json packages must be an array");

	const results: PackageDeclaration[] = [];
	for (const entry of raw) {
		const source =
			typeof entry === "string"
				? entry
				: typeof entry === "object" &&
						entry !== null &&
						!Array.isArray(entry) &&
						"source" in entry
					? (entry as { source?: unknown }).source
					: undefined;
		try {
			const validated = validatePackageSource(source);
			results.push({
				source: validated,
				normalizedSource: normalizePackageName(validated),
			});
		} catch (err) {
			if (!opts?.skipInvalid) throw err;
			// When skipInvalid is set (used for local agent settings), silently skip
			// machine-specific local paths. The user may have `pi install`-ed a local
			// dev copy that should never be synced to other machines.
		}
	}
	return results;
}

async function readSettingsObject(
	path: string,
): Promise<Record<string, unknown>> {
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error("settings.json must contain a JSON object");
		}
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Cannot parse settings.json at ${path}: ${String(error)}`);
	}
}

// ========== Trust store ==========

export function getPackageTrustPath(agentDir: string): string {
	return join(agentDir, ".pi-sync", "package-trust.json");
}

export async function loadPackageTrust(
	agentDir: string,
): Promise<PackageTrustStore> {
	const path = getPackageTrustPath(agentDir);
	if (!existsSync(path)) return { schemaVersion: 1, approved: {} };
	try {
		const parsed = JSON.parse(
			await readFile(path, "utf-8"),
		) as Partial<PackageTrustStore>;
		if (
			parsed.schemaVersion !== 1 ||
			typeof parsed.approved !== "object" ||
			parsed.approved === null
		) {
			throw new Error("invalid trust store schema");
		}
		return { schemaVersion: 1, approved: { ...parsed.approved } };
	} catch (error) {
		throw new Error(`Cannot read package trust store: ${String(error)}`);
	}
}

export async function savePackageTrust(
	agentDir: string,
	store: PackageTrustStore,
): Promise<void> {
	const path = getPackageTrustPath(agentDir);
	const temp = join(dirname(path), `.package-trust-${randomUUID()}.tmp`);
	await mkdir(dirname(path), { recursive: true });
	try {
		await writeFile(temp, JSON.stringify(store, null, 2), "utf-8");
		await rename(temp, path);
	} finally {
		await import("node:fs/promises")
			.then(({ rm }) => rm(temp, { force: true }))
			.catch(() => undefined);
	}
}

// ========== 计划 ==========

export function planPackageChanges(
	localSettings: Record<string, unknown>,
	remoteSettings: Record<string, unknown>,
	trustStore: PackageTrustStore,
): PackagePlan {
	const local = parsePackageDeclarations(localSettings, { skipInvalid: true });
	const remote = parsePackageDeclarations(remoteSettings);
	const localMap = new Map(
		local.map((entry) => [entry.normalizedSource, entry]),
	);
	const added = remote.filter((entry) => !localMap.has(entry.normalizedSource));
	const changed: Array<{
		local: PackageDeclaration;
		remote: PackageDeclaration;
	}> = [];
	const unchanged: PackageDeclaration[] = [];

	for (const remoteEntry of remote) {
		const localEntry = localMap.get(remoteEntry.normalizedSource);
		if (localEntry) {
			if (localEntry.source === remoteEntry.source) {
				unchanged.push(remoteEntry);
			} else {
				changed.push({ local: localEntry, remote: remoteEntry });
			}
		}
	}

	const required = [
		...added.map((entry) => entry.source),
		...changed.map((entry) => entry.remote.source),
	]
		.filter((source) => !isBuiltInTrustedSource(source))
		.filter(
			(source) => trustStore.approved[normalizePackageName(source)] !== source,
		);
	return {
		added,
		changed,
		unchanged,
		approvalRequired: [...new Set(required)],
	};
}

export function approvePackagePlan(
	plan: PackagePlan,
	approval: PackageApproval,
): { approved: boolean; missing: string[] } {
	const approved = new Set(approval.approvedSources);
	const missing = plan.approvalRequired.filter(
		(source) => !approved.has(source),
	);
	return { approved: missing.length === 0, missing };
}

/**
 * Read the two settings files and build a package plan without invoking Pi.
 * Callers can use this before materializing settings so approval is always
 * obtained before a remote package declaration reaches the agent directory.
 */
export async function preparePackagePlan(
	repoPath: string,
	agentDir: string,
	config: PiSyncConfig,
): Promise<PackagePlan> {
	const safeRoot = await resolveRepoSyncRoot(repoPath, config.root, "read");
	const repoSettingsPath = await resolveWithinRoot(
		safeRoot,
		"settings.json",
		"read",
	);
	const localSettingsPath = await resolveWithinRoot(
		agentDir,
		"settings.json",
		"read",
	);
	const repoSettings = await readSettingsObject(repoSettingsPath);
	const localSettings = await readSettingsObject(localSettingsPath);
	const trust = await loadPackageTrust(agentDir);
	return planPackageChanges(localSettings, repoSettings, trust);
}

// ========== 差异计算 ==========

export async function getPackageDiff(
	repoPath: string,
	agentDir: string,
	config: PiSyncConfig,
): Promise<PackageDiff> {
	const safeRoot = await resolveRepoSyncRoot(repoPath, config.root, "read");
	const repoSettingsPath = await resolveWithinRoot(
		safeRoot,
		"settings.json",
		"read",
	);
	const localSettingsPath = await resolveWithinRoot(
		agentDir,
		"settings.json",
		"read",
	);
	const repoPackages = parsePackageDeclarations(
		await readSettingsObject(repoSettingsPath),
	);
	const localPackages = parsePackageDeclarations(
		await readSettingsObject(localSettingsPath),
		{ skipInvalid: true },
	);
	const repoSet = new Set(repoPackages.map((entry) => entry.normalizedSource));
	const localSet = new Set(
		localPackages.map((entry) => entry.normalizedSource),
	);

	const added = repoPackages
		.filter((entry) => !localSet.has(entry.normalizedSource))
		.map((entry) => entry.source);
	const removed = localPackages
		.filter((entry) => !repoSet.has(entry.normalizedSource))
		.map((entry) => entry.source);
	const unchanged = repoPackages
		.filter(
			(entry) =>
				localSet.has(entry.normalizedSource) &&
				localPackages.some((local) => local.source === entry.source),
		)
		.map((entry) => entry.source);
	const changed: string[] = [];
	for (const remote of repoPackages) {
		const local = localPackages.find(
			(entry) => entry.normalizedSource === remote.normalizedSource,
		);
		if (local && local.source !== remote.source) changed.push(remote.source);
	}
	return { added, removed, changed, unchanged };
}

// ========== 执行 ==========

export interface ReconcileOptions {
	approval?: PackageApproval;
	/** 非交互入口默认 true，禁止隐式安装。 */
	nonInteractive?: boolean;
	signal?: AbortSignal;
}

export interface PackageExecutionOptions {
	approval?: PackageApproval;
	signal?: AbortSignal;
}

interface PackageAction {
	source: string;
	previousSource?: string;
}

interface RollbackResult {
	rolledBack: string[];
	errors: string[];
}

async function rollbackPackageActions(
	actions: PackageAction[],
	agentDir: string,
): Promise<RollbackResult> {
	const rolledBack: string[] = [];
	const errors: string[] = [];
	const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };

	for (const action of [...actions].reverse()) {
		try {
			await execFileAsync(
				"pi",
				["remove", normalizePackageName(action.source)],
				{
					env,
					timeout: 60000,
				},
			);
			rolledBack.push(action.source);
		} catch (error) {
			errors.push(`remove ${action.source}: ${String(error)}`);
		}

		if (
			action.previousSource &&
			!isBuiltInTrustedSource(action.previousSource)
		) {
			try {
				await execFileAsync("pi", ["install", action.previousSource], {
					env,
					timeout: 120000,
				});
				rolledBack.push(action.previousSource);
			} catch (error) {
				errors.push(`restore ${action.previousSource}: ${String(error)}`);
			}
		}
	}

	return { rolledBack, errors };
}

/**
 * Execute a previously prepared package plan. This function deliberately
 * does not read or write settings.json: callers should materialize settings
 * first, then invoke this function, and only persist sync state after it
 * succeeds.
 */
export async function executePackagePlan(
	plan: PackagePlan,
	agentDir: string,
	options: PackageExecutionOptions = {},
): Promise<ReconcileResult> {
	const result: ReconcileResult = { installed: [], errors: [] };
	const signal = options.signal ?? getOperationSignal();

	if (plan.approvalRequired.length > 0) {
		const approval = options.approval;
		if (!approval || !approvePackagePlan(plan, approval)) {
			result.approvalRequired = plan.approvalRequired;
			result.errors.push(
				`Package approval required before installation: ${plan.approvalRequired.join(", ")}`,
			);
			return result;
		}
	}

	const toInstall = [
		...plan.added.map((entry) => entry.source),
		...plan.changed.map((entry) => entry.remote.source),
	].filter((source) => !isBuiltInTrustedSource(source));
	if (toInstall.length === 0) return result;

	if (!(await isPiCliAvailable(signal))) {
		result.errors.push(
			signal?.aborted
				? "Package installation cancelled."
				: `pi CLI not available. Run manually: ${toInstall.map((pkg) => `pi install ${pkg}`).join("; ")}`,
		);
		return result;
	}

	const actions: PackageAction[] = [];
	for (const source of toInstall) {
		if (signal?.aborted) {
			result.errors.push("Package installation cancelled.");
			break;
		}
		const changed = plan.changed.find(
			(entry) => entry.remote.source === source,
		);
		const action: PackageAction = {
			source,
			previousSource: changed?.local.source,
		};

		try {
			if (changed) {
				await execFileAsync("pi", ["remove", normalizePackageName(source)], {
					env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
					timeout: 60000,
					signal,
				}).catch((error: unknown) => {
					if (signal?.aborted) throw error;
				});
			}
			await execFileAsync("pi", ["install", source], {
				env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
				timeout: 120000,
				signal,
			});
			result.installed.push(source);
		} catch (error) {
			result.errors.push(
				signal?.aborted
					? `Package installation cancelled while processing ${source}.`
					: `Failed to install ${source}: ${String(error)}`,
			);
		}
		actions.push(action);
		if (signal?.aborted) break;
	}

	if (result.errors.length > 0 && !signal?.aborted) {
		const rollback = await rollbackPackageActions(actions, agentDir);
		if (rollback.rolledBack.length > 0) result.rolledBack = rollback.rolledBack;
		if (rollback.errors.length > 0) {
			result.rollbackErrors = rollback.errors;
			result.errors.push(
				...rollback.errors.map((message) => `Rollback failed: ${message}`),
			);
		}
	}

	// A remembered approval is committed only after every requested install has
	// completed. A failed install must not silently expand the trust store.
	if (
		result.errors.length === 0 &&
		options.approval?.remember &&
		plan.approvalRequired.length > 0
	) {
		const trust = await loadPackageTrust(agentDir);
		for (const source of plan.approvalRequired) {
			trust.approved[normalizePackageName(source)] = source;
		}
		await savePackageTrust(agentDir, trust);
	}

	return result;
}

/**
 * Backwards-compatible direct API. The command workflow uses the explicit
 * prepare → approve → materialize → execute sequence above.
 */
export async function reconcilePackages(
	repoPath: string,
	agentDir: string,
	config: PiSyncConfig,
	options: ReconcileOptions = {},
): Promise<ReconcileResult> {
	const plan = await preparePackagePlan(repoPath, agentDir, config);
	return executePackagePlan(plan, agentDir, {
		approval: options.approval,
		signal: options.signal,
	});
}

async function isPiCliAvailable(signal?: AbortSignal): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync("pi", ["--version"], {
			timeout: 10000,
			signal,
		});
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}

function isBuiltInTrustedSource(source: string): boolean {
	// The running extension is already installed before synchronization starts.
	return source === "npm:@jachy/pi-git-sync";
}

function normalizePackageName(pkg: string): string {
	const npmMatch = pkg.match(/^npm:(.+?)(?:@[\d.].*)?$/);
	if (npmMatch) return npmMatch[1]!;
	const gitMatch = pkg.match(/^(?:git:)?(.+?)(?:@.+)?$/);
	if (gitMatch) {
		let name = gitMatch[1]!;
		name = name.replace(/^https?:\/\//, "");
		name = name.replace(/^ssh:\/\//, "");
		return name;
	}
	return pkg;
}
