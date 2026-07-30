/**
 * frida-agent-browser — Electron launch (Fase 7 — electron launch).
 *
 * Porte de electron/launch.js del referencia: lanza una app Electron con un perfil
 * AISLADO wrapper-owned (`--user-data-dir` temporal) y `--remote-debugging-port=0`
 * (el SO elige puerto → Electron lo escribe en `DevToolsActivePort`). Se espera al
 * puerto, se leen los endpoints CDP y se devuelve un registro trackeable. El attach
 * al navegador lo hace luego el host vía `agent-browser connect <port>`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { listElectronApps, type DiscoveredApp } from "./discovery";
import {
	readCdpEndpoints,
	type CdpTarget,
	type CdpVersion,
	type CdpFetchFn,
} from "./cdp";
import type { SpawnFn } from "../run";

export const ELECTRON_LAUNCH_RECORD_VERSION = 1;
const ELECTRON_DEFAULT_APP_ARGS = [
	"--no-default-browser-check",
	"--no-first-run",
];
const ELECTRON_DEVTOOLS_POLL_INTERVAL_MS = 200;
const ELECTRON_LAUNCH_DEFAULT_TIMEOUT_MS = 30_000;

export interface LaunchTarget {
	executablePath: string;
	name: string;
	appPath?: string;
	bundleId?: string;
	desktopId?: string;
	platform: "darwin" | "linux";
	packageSource?: string;
}

export type LaunchFailure =
	| "timeout"
	| "spawn-error"
	| "single-instance-conflict"
	| "no-cdp";

export interface LaunchRecord {
	launchId: string;
	appName: string;
	appPath?: string;
	bundleId?: string;
	executablePath: string;
	platform: string;
	pid?: number;
	processGroupId?: number;
	port?: number;
	userDataDir: string;
	targetType: string;
	version?: CdpVersion;
	targets: CdpTarget[];
	cleanupState: "active" | "cleaned";
	createdAtMs: number;
	child?: ChildProcess;
}

export interface LaunchResult {
	record?: LaunchRecord;
	failure?: LaunchFailure;
	spawnError?: string;
}

/** Resuelve el target de launch desde appPath/appName/bundleId/executablePath. */
export async function resolveLaunchTarget(opts: {
	appPath?: string;
	appName?: string;
	bundleId?: string;
	executablePath?: string;
}): Promise<LaunchTarget | undefined> {
	// Direct path/executable → usar tal cual (no requiere estar en el catálogo).
	if (opts.appPath || opts.executablePath) {
		const exe = opts.executablePath ?? opts.appPath!;
		const name = exe.split(/[/\\]/).pop() ?? exe;
		return {
			executablePath: exe,
			name,
			platform: process.platform === "darwin" ? "darwin" : "linux",
		};
	}
	// appName/bundleId → buscar en apps descubiertas.
	const apps = await listElectronApps({});
	const match = apps.find(
		(a) =>
			(opts.bundleId && a.bundleId === opts.bundleId) ||
			(opts.appName && a.name.toLowerCase() === opts.appName.toLowerCase()),
	);
	return match ? toTarget(match) : undefined;
}

function toTarget(app: DiscoveredApp): LaunchTarget {
	return {
		executablePath: app.executablePath,
		name: app.name,
		appPath: app.appPath,
		bundleId: app.bundleId,
		desktopId: app.desktopId,
		platform: app.platform,
		packageSource: app.packageSource,
	};
}

function buildLaunchArgs(userDataDir: string, appArgs: string[]): string[] {
	return [
		...appArgs,
		`--user-data-dir=${userDataDir}`,
		"--remote-debugging-port=0",
		...ELECTRON_DEFAULT_APP_ARGS,
	];
}

/** Lee el puerto del archivo DevToolsActivePort (Electron lo escribe con port=0). */
async function readDevToolsPort(
	userDataDir: string,
): Promise<number | undefined> {
	try {
		const content = await readFile(
			join(userDataDir, "DevToolsActivePort"),
			"utf8",
		);
		const port = parseInt(content.split(/\r?\n/)[0] ?? "", 10);
		return Number.isInteger(port) && port > 0 ? port : undefined;
	} catch {
		return undefined;
	}
}

function childExited(child: ChildProcess): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

export interface LaunchOptions {
	target: LaunchTarget;
	appArgs?: string[];
	targetType?: string;
	timeoutMs?: number;
	fetchFn?: CdpFetchFn;
	/** Seam de inyección para tests (default: child_process.spawn). */
	spawnFn?: SpawnFn;
}

/**
 * Lanza la app Electron con perfil aislado, espera el puerto CDP y devuelve el registro.
 * El llamador (host) hace luego `agent-browser connect <port>`.
 */
export async function launchElectronApp(
	opts: LaunchOptions,
): Promise<LaunchResult> {
	const doSpawn = (opts.spawnFn as SpawnFn | undefined) ?? (spawn as SpawnFn);
	const timeoutMs = opts.timeoutMs ?? ELECTRON_LAUNCH_DEFAULT_TIMEOUT_MS;
	const userDataDir = join(tmpdir(), `frida-electron-${randomUUID()}`);
	await mkdir(userDataDir, { recursive: true });

	const args = buildLaunchArgs(userDataDir, opts.appArgs ?? []);
	let child: ChildProcess;
	try {
		child = doSpawn(opts.target.executablePath, args, {
			detached: process.platform !== "win32",
			stdio: "ignore",
		}) as ChildProcess;
	} catch (e) {
		await rm(userDataDir, { recursive: true, force: true });
		return { failure: "spawn-error", spawnError: (e as Error).message };
	}

	let spawnError: string | undefined;
	child.on("error", (err) => {
		spawnError = err.message;
	});

	// Esperar DevToolsActivePort (o salida del child).
	const deadline = Date.now() + timeoutMs;
	let port: number | undefined;
	while (Date.now() <= deadline) {
		if (spawnError) {
			await rm(userDataDir, { recursive: true, force: true });
			return { failure: "spawn-error", spawnError };
		}
		if (childExited(child)) {
			await rm(userDataDir, { recursive: true, force: true });
			return {
				failure:
					child.exitCode === 0 ? "single-instance-conflict" : "spawn-error",
			};
		}
		port = await readDevToolsPort(userDataDir);
		if (port) break;
		await sleep(ELECTRON_DEVTOOLS_POLL_INTERVAL_MS);
	}

	if (!port) {
		try {
			child.kill("SIGKILL");
		} catch {
			/* noop */
		}
		await rm(userDataDir, { recursive: true, force: true });
		return { failure: "timeout" };
	}

	const { version, targets } = await readCdpEndpoints(port, opts.fetchFn);
	if (!version) {
		try {
			child.kill("SIGKILL");
		} catch {
			/* noop */
		}
		await rm(userDataDir, { recursive: true, force: true });
		return { failure: "no-cdp" };
	}

	const record: LaunchRecord = {
		launchId: `electron-${randomUUID()}`,
		appName: opts.target.name,
		appPath: opts.target.appPath,
		bundleId: opts.target.bundleId,
		executablePath: opts.target.executablePath,
		platform: opts.target.platform,
		pid: child.pid,
		processGroupId: process.platform === "win32" ? undefined : child.pid,
		port,
		userDataDir,
		targetType: opts.targetType ?? "page",
		version,
		targets,
		cleanupState: "active",
		createdAtMs: Date.now(),
		child,
	};
	return { record };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mensaje agent-friendly para cada fallo de launch. */
export function describeLaunchFailure(
	target: string,
	failure: LaunchFailure,
	spawnError?: string,
): string {
	switch (failure) {
		case "spawn-error":
			return `Could not launch Electron app "${target}": ${spawnError ?? "spawn failed"}. Verify the executable path and that the app can start.`;
		case "single-instance-conflict":
			return `Electron app "${target}" exited immediately (single-instance lock?). Close any running instance and retry.`;
		case "no-cdp":
			return `Electron app "${target}" launched but /json/version never returned a valid CDP payload.`;
		case "timeout":
			return `Electron app "${target}" did not expose a debugging port within the timeout.`;
	}
}
