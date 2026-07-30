/**
 * frida-agent-browser — Electron host / dispatch (Fase 7).
 *
 * Orquesta la acción `electron` compilada contra el registry + discovery + launch:
 * list / launch / status / cleanup / probe → BrowserToolResult. El attach al
 * navegador (connect) lo hace `connectFn` tras un launch exitoso (best-effort).
 */

import type { BrowserToolResult } from "../run";
import { listElectronApps, type DiscoveredApp } from "./discovery";
import {
	describeLaunchFailure,
	launchElectronApp,
	resolveLaunchTarget,
} from "./launch";
import type { ElectronLaunchRegistry, LaunchStatus } from "./registry";
import type { CompiledElectron } from "./compile";
import type { CdpFetchFn } from "./cdp";
import type { SpawnFn } from "../run";

export interface ElectronHostDeps {
	registry: ElectronLaunchRegistry;
	cwd: string;
	fetchFn?: CdpFetchFn;
	spawnFn?: SpawnFn;
	/** Override de discovery (tests). Default: listElectronApps. */
	listFn?: (opts: {
		query?: string;
		maxResults?: number;
	}) => Promise<DiscoveredApp[]>;
	/** Attach tras launch exitoso (best-effort; errores se ignoran). */
	connectFn?: (port: number, targetType: string) => Promise<void>;
}

function ok(text: string, details?: unknown): BrowserToolResult {
	return {
		content: [{ type: "text", text }],
		details: details ?? {},
		isError: false,
	};
}
function fail(text: string, details?: unknown): BrowserToolResult {
	return {
		content: [{ type: "text", text }],
		details: details ?? {},
		isError: true,
	};
}

function formatList(
	apps: {
		name: string;
		bundleId?: string;
		appPath?: string;
		executablePath: string;
	}[],
): string {
	if (apps.length === 0) return "No Electron apps found.";
	const lines = apps.map((a, i) => {
		const id = a.bundleId ? ` [${a.bundleId}]` : "";
		const where = a.appPath ?? a.executablePath;
		return `${i + 1}. ${a.name}${id}\n   ${where}`;
	});
	return `${apps.length} Electron app${apps.length === 1 ? "" : "s"} found:\n${lines.join("\n")}`;
}

function formatStatus(
	status: LaunchStatus | LaunchStatus[] | undefined,
): string {
	if (!status) return "No Electron launches tracked.";
	const arr = Array.isArray(status) ? status : [status];
	if (arr.length === 0) return "No Electron launches tracked.";
	const lines = arr.map(
		(s) =>
			`${s.launchId}: ${s.appName} (port ${s.port ?? "?"}, pid ${s.pid ?? "?"}, ${s.cleanupState})`,
	);
	return lines.join("\n");
}

/** Ejecuta la acción electron compilada. */
export async function runElectronAction(
	compiled: CompiledElectron,
	deps: ElectronHostDeps,
): Promise<BrowserToolResult> {
	switch (compiled.action) {
		case "list": {
			const listFn =
				deps.listFn ??
				((o: { query?: string; maxResults?: number }) => listElectronApps(o));
			const apps = await listFn({
				query: compiled.query,
				maxResults: compiled.maxResults,
			});
			return ok(formatList(apps), { action: "list", count: apps.length, apps });
		}

		case "launch": {
			const target = await resolveLaunchTarget(compiled);
			if (!target) {
				return fail(
					`Could not resolve an Electron app for the provided target (appPath/appName/bundleId/executablePath). Run electron list to discover installed apps.`,
					{ action: "launch", failure: "target-not-found" },
				);
			}
			const result = await launchElectronApp({
				target,
				appArgs: compiled.appArgs,
				targetType: compiled.targetType,
				timeoutMs: compiled.timeoutMs,
				fetchFn: deps.fetchFn,
				spawnFn: deps.spawnFn,
			});
			if (result.failure || !result.record) {
				return fail(
					describeLaunchFailure(
						target.name,
						result.failure!,
						result.spawnError,
					),
					{
						action: "launch",
						failure: result.failure,
						target: target.executablePath,
					},
				);
			}
			deps.registry.register(result.record);
			// Attach best-effort (connect). Errores no invalidan el launch.
			let connected = false;
			if (deps.connectFn && result.record.port) {
				try {
					await deps.connectFn(result.record.port, result.record.targetType);
					connected = true;
				} catch {
					connected = false;
				}
			}
			return ok(
				`Launched ${result.record.appName} (launchId ${result.record.launchId}, port ${result.record.port}, pid ${result.record.pid ?? "?"}).${connected ? "" : ` Connect with agent_browser: { args: ["connect", "${result.record.port}"] }.`}`,
				{
					action: "launch",
					launch: {
						launchId: result.record.launchId,
						appName: result.record.appName,
						port: result.record.port,
						pid: result.record.pid,
						targetType: result.record.targetType,
						connected,
					},
				},
			);
		}

		case "status": {
			if (compiled.all)
				return ok(formatStatus(deps.registry.statusAll()), {
					action: "status",
					all: true,
				});
			const found = compiled.launchId
				? deps.registry.statusOne(compiled.launchId)
				: undefined;
			if (compiled.launchId) {
				return found
					? ok(formatStatus(found), {
							action: "status",
							launchId: compiled.launchId,
						})
					: fail(
							`No Electron launch tracked for launchId ${compiled.launchId}.`,
							{ action: "status", launchId: compiled.launchId },
						);
			}
			return ok(formatStatus(deps.registry.statusActive()), {
				action: "status",
			});
		}

		case "cleanup": {
			const results = compiled.all
				? await deps.registry.cleanupAll()
				: compiled.launchId
					? ((await deps.registry.cleanupOne(compiled.launchId)) ?? [])
					: [];
			const arr = Array.isArray(results) ? results : [results];
			if (arr.length === 0)
				return ok("No Electron launches to clean up.", { action: "cleanup" });
			const lines = arr.map(
				(r) =>
					`${r.launchId}: process=${r.process}, userDataDir=${r.userDataDir}`,
			);
			return ok(
				`Cleaned up ${arr.length} launch${arr.length === 1 ? "" : "es"}:\n${lines.join("\n")}`,
				{ action: "cleanup", results: arr },
			);
		}

		case "probe": {
			const probe = await deps.registry.probe(compiled.launchId, deps.fetchFn);
			if (!probe)
				return fail(
					"No active Electron launch to probe (or unknown launchId).",
					{ action: "probe", launchId: compiled.launchId },
				);
			const tcount = probe.targets.length;
			return ok(
				`Probe ${probe.launchId}: port ${probe.port}, ${tcount} target${tcount === 1 ? "" : "s"}.`,
				{ action: "probe", probe },
			);
		}
	}
}
