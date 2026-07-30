/**
 * frida-agent-browser — Registro de lanzamientos Electron wrapper-owned (Fase 7).
 *
 * Mantiene el registro de launches (launchId → LaunchRecord) para status/cleanup/probe.
 * Porte enfocado de orchestration/electron-host + electron/cleanup del referencia.
 */

import { cleanupLaunch, type CleanupResult } from "./cleanup";
import {
	readCdpEndpoints,
	type CdpFetchFn,
	type CdpTarget,
	type CdpVersion,
} from "./cdp";
import type { LaunchRecord } from "./launch";

export interface LaunchStatus {
	launchId: string;
	appName: string;
	appPath?: string;
	bundleId?: string;
	executablePath: string;
	pid?: number;
	port?: number;
	targetType: string;
	cleanupState: "active" | "cleaned";
	createdAtMs: number;
}

export interface ProbeResult {
	launchId: string;
	port?: number;
	version?: CdpVersion;
	targets: CdpTarget[];
}

export class ElectronLaunchRegistry {
	private readonly records = new Map<string, LaunchRecord>();

	register(record: LaunchRecord): LaunchRecord {
		this.records.set(record.launchId, record);
		return record;
	}

	get(launchId: string): LaunchRecord | undefined {
		return this.records.get(launchId);
	}

	list(): LaunchRecord[] {
		return [...this.records.values()];
	}

	active(): LaunchRecord[] {
		return this.list().filter((r) => r.cleanupState === "active");
	}

	/** El único registro activo (para electron.status sin launchId ni all). */
	soleActive(): LaunchRecord | undefined {
		const act = this.active();
		return act.length === 1 ? act[0] : undefined;
	}

	remove(launchId: string): boolean {
		return this.records.delete(launchId);
	}

	private summarize(record: LaunchRecord): LaunchStatus {
		return {
			launchId: record.launchId,
			appName: record.appName,
			appPath: record.appPath,
			bundleId: record.bundleId,
			executablePath: record.executablePath,
			pid: record.pid,
			port: record.port,
			targetType: record.targetType,
			cleanupState: record.cleanupState,
			createdAtMs: record.createdAtMs,
		};
	}

	statusOne(launchId: string): LaunchStatus | undefined {
		const r = this.get(launchId);
		return r ? this.summarize(r) : undefined;
	}

	statusAll(): LaunchStatus[] {
		return this.list().map(this.summarize);
	}

	statusActive(): LaunchStatus | undefined {
		const r = this.soleActive();
		return r ? this.summarize(r) : undefined;
	}

	async cleanupOne(launchId: string): Promise<CleanupResult | undefined> {
		const r = this.get(launchId);
		if (!r) return undefined;
		const result = await cleanupLaunch(r);
		this.remove(launchId);
		return result;
	}

	async cleanupAll(): Promise<CleanupResult[]> {
		const ids = this.list().map((r) => r.launchId);
		const results: CleanupResult[] = [];
		for (const id of ids) {
			const r = await this.cleanupOne(id);
			if (r) results.push(r);
		}
		return results;
	}

	async probe(
		launchId: string | undefined,
		fetchFn?: CdpFetchFn,
	): Promise<ProbeResult | undefined> {
		const r = launchId ? this.get(launchId) : this.soleActive();
		if (!r || !r.port) return undefined;
		const { version, targets } = await readCdpEndpoints(r.port, fetchFn);
		return { launchId: r.launchId, port: r.port, version, targets };
	}
}
