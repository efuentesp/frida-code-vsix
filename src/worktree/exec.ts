/**
 * Executor de git para frida-worktree.
 *
 * Corre `git <args>` vía `spawn` con **argv** (sin shell → sin inyección de
 * input del usuario), con `cwd` / `signal` / `timeout`. Devuelve `ExecResult`
 * ({stdout, stderr, code, killed}) — la forma que espera `git.ts`. Si el
 * proceso no puede arrancar (p. ej. git no instalado → ENOENT), **rechaza**, y
 * `git.ts` (`runGitAllowFailure`) lo convierte en `GitWorktreeError`.
 *
 * Porte del seam `pi.exec` que usaba @narumitw/pi-worktree; espeja el patrón de
 * `frida-git-sync/src/system/git.ts` (argv spawn + override opcional).
 *
 * Issue #13. Refs #13.
 */
import { spawn } from "node:child_process";

/** Resultado de una ejecución de git (éxito o exit code no-cero). */
export interface ExecResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
	readonly killed: boolean;
}

export interface GitExecOptions {
	cwd?: string;
	signal?: AbortSignal;
	timeout?: number;
}

/**
 * Cliente git: el único seam que `git.ts` usa para ejecutar git. Equivale al
 * `Pick<ExtensionAPI, "exec">` del candidato original.
 */
export interface GitClient {
	exec(
		command: string,
		args: string[],
		options?: GitExecOptions,
	): Promise<ExecResult>;
}

/** Factory del cliente git (argv spawn, sin shell). */
export function createGitClient(): GitClient {
	return { exec: execGit };
}

function execGit(
	_command: string,
	args: string[],
	options: GitExecOptions = {},
): Promise<ExecResult> {
	const cwd = options.cwd ?? process.cwd();
	const timeout = options.timeout ?? 15_000;
	const signal = options.signal;
	if (signal?.aborted) {
		return Promise.resolve({ stdout: "", stderr: "", code: 1, killed: true });
	}
	return new Promise<ExecResult>((resolve, reject) => {
		const child = spawn("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		let killed = false;
		let settled = false;

		const finish = (result: ExecResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(handle);
			signal?.removeEventListener("abort", stop);
			resolve(result);
		};
		const stop = (): void => {
			killed = true;
			try {
				child.kill();
			} catch {
				/* noop */
			}
		};
		const handle = setTimeout(stop, timeout);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(handle);
			signal?.removeEventListener("abort", stop);
			// Rechaza (p. ej. ENOENT): runGitAllowFailure lo mapea a GitWorktreeError.
			reject(error);
		});
		child.once("close", (code, sig) => {
			finish({
				stdout,
				stderr,
				code: code ?? 1,
				killed: killed || sig !== null,
			});
		});
		signal?.addEventListener("abort", stop, { once: true });
	});
}
