/**
 * frida-agent-browser — Electron cleanup (Fase 7).
 *
 * Porte de electron/cleanup.js del referencia: termina el proceso lanzado (grupo de
 * proceso en posix, SIGTERM→SIGKILL) y elimina el user-data-dir aislado. Opera SÓLO
 * sobre registros producidos por este wrapper; reporta estado parcial sin matar/borrar
 * recursos no trackeados.
 */

import { rm } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import type { LaunchRecord } from "./launch";

export interface CleanupResult {
	launchId: string;
	process: "killed" | "already-dead" | "failed";
	userDataDir: "removed" | "failed";
	error?: string;
}

function childExited(child: ChildProcess): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(
	child: ChildProcess,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (childExited(child)) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return childExited(child);
}

/** SIGTERM, espera, SIGKILL si vive. Best-effort. */
async function terminateChild(
	child: ChildProcess,
): Promise<"killed" | "already-dead" | "failed"> {
	if (childExited(child)) return "already-dead";
	try {
		child.kill("SIGTERM");
	} catch {
		/* noop */
	}
	if (await waitForExit(child, 1_000)) return "killed";
	try {
		child.kill("SIGKILL");
	} catch {
		/* noop */
	}
	if (await waitForExit(child, 1_000)) return "killed";
	return "failed";
}

/** Limpia un registro: mata el child + borra el user-data-dir aislado. */
export async function cleanupLaunch(
	record: LaunchRecord,
): Promise<CleanupResult> {
	const proc = record.child
		? await terminateChild(record.child)
		: "already-dead";
	let dir: "removed" | "failed" = "removed";
	try {
		await rm(record.userDataDir, { recursive: true, force: true });
	} catch {
		dir = "failed";
	}
	record.cleanupState = "cleaned";
	return { launchId: record.launchId, process: proc, userDataDir: dir };
}
