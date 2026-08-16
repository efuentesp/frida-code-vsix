// frida-subagents — spawn de subagentes detached (issue #26, ADR-0037).
//
// Cada detached es un PROCESO separado que corre el CLI de pi embebido en el
// VSIX (`pi -p --mode json`): stdout+stderr van directo a un log file (cero JS
// en el data path), detached+unref → sobrevive al padre (cierre de VS Code,
// /reload, crash). Progreso y resultado se leen después tail-eando el log.
//
// Patrón: pi-better-subagents/spawn.ts (MIT, 1aboveio) con el swap
// "binario pi del PATH" → "pi embebido del VSIX via ELECTRON_RUN_AS_NODE".

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DetachedSpawnResult {
	pid: number;
	/** Resuelve con el exit code del child (null en signal). Nunca rechaza. */
	exit: Promise<number | null>;
}

/**
 * Resuelve la ruta del CLI de pi EMPAQUETADO en el VSIX.
 *
 * El paquete restringe `exports` a '.'/'./rpc-entry'/'./client', así que
 * resolvemos el entry principal y navegamos al dist/cli.js del mismo paquete
 * (require.resolve de subpaths no exportados fallaría).
 */
export function resolveEmbeddedPiCli(): string | undefined {
	try {
		// En el bundle del VSIX el paquete es external (node_modules reales).
		const entry = require.resolve("@earendil-works/pi-coding-agent");
		// entry = <pkg>/dist/index.js → cli.js vive al lado.
		for (const base of [dirname(entry), join(dirname(entry), "..", "dist")]) {
			const cli = join(base, "cli.js");
			if (existsSync(cli)) return cli;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Spawn detached de `node cli.js …` con stdout+stderr al log file.
 *
 * En el extension host, `process.execPath` es el binario de Electron/Code;
 * con ELECTRON_RUN_AS_NODE=1 corre como Node puro y puede cargar el CLI
 * (patrón estándar de extensiones VS Code para spawnear node).
 */
export function spawnDetached(args: {
	fileArgs: string[];
	cwd: string;
	logPath: string;
	env?: Record<string, string>;
}): DetachedSpawnResult {
	mkdirSync(dirname(args.logPath), { recursive: true });
	const outFd = openSync(args.logPath, "w");

	let proc;
	try {
		proc = spawn(process.execPath, args.fileArgs, {
			stdio: ["ignore", outFd, outFd],
			cwd: args.cwd,
			detached: true,
			env: { ...process.env, ...args.env },
		});
	} finally {
		closeSync(outFd);
	}

	// Exit promise con listener 'error' ANTES de cualquier throw: un fallo
	// async de spawn (ENOENT/EMFILE) jamás puede tumbar el foreground.
	const exit = new Promise<number | null>((resolve) => {
		proc.on("close", (code) => resolve(code));
		proc.on("error", () => resolve(1));
	});

	if (!proc.pid) {
		try {
			require("node:fs").unlinkSync(args.logPath);
		} catch {
			/* best-effort */
		}
		throw new Error("No se pudo spawn el proceso detached");
	}
	const pid = proc.pid;
	proc.unref();
	return { pid, exit };
}

/** Mata todo el grupo de procesos (negative-PID); fallback al PID directo. */
export function killProcessTree(
	pid: number | undefined,
	signal: NodeJS.Signals = "SIGTERM",
): void {
	if (typeof pid !== "number" || pid <= 0) return;
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			/* ya murió */
		}
	}
}

/** Probe barato de liveness via signal 0. EPERM = existe (no es nuestro). */
export function processExists(pid: number | undefined): boolean {
	if (typeof pid !== "number" || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}
