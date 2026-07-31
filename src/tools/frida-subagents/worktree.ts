// frida-subagents — git worktree isolation.
//
// Porte de pi-subagents/src/worktree.ts (ADR-0022 Fase 5 / D3).
// Crea un worktree aislado del repo para que el agente trabaje en una copia.
// Al completar: si hay cambios, los commitea a un branch `pi-agent-<id>`.
// Si no hay cambios, limpia el worktree.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface WorktreeInfo {
	/** Path del worktree donde el agente trabaja. */
	workPath: string;
	/** Nombre del branch creado. */
	branch: string;
	/** SHA del commit base (antes de que el agente empiece). */
	baseSha: string;
}

export interface WorktreeResult {
	/** Si el agente hizo cambios. */
	hasChanges: boolean;
	/** Branch con los cambios (si hay). */
	branch?: string;
	/** Mensaje de error (si falló). */
	error?: string;
}

/**
 * Crea un git worktree para un agente.
 *
 * @returns WorktreeInfo si tiene éxito, undefined si falla (no es repo, sin commits).
 */
export function createWorktree(
	cwd: string,
	agentId: string,
): WorktreeInfo | undefined {
	const branch = `pi-agent-${agentId.slice(-8)}`;
	const tmpBase = join(homedir(), ".frida", "worktrees");
	const workPath = join(tmpBase, agentId);

	// Verificar que es un repo git con commits.
	try {
		execSync("git rev-parse HEAD", {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		return undefined;
	}

	// Obtener SHA base (el primer check ya validó que git funciona).
	let baseSha: string;
	try {
		baseSha = execSync("git rev-parse HEAD", {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return undefined;
	}

	// Crear worktree con un nuevo branch.
	try {
		execSync(`git worktree add -b "${branch}" "${workPath}" HEAD`, {
			cwd,
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		return undefined;
	}

	return { workPath, branch, baseSha };
}

/**
 * Limpia un worktree tras la completación del agente.
 *
 * Si hay cambios sin commit, los commitea con `--no-verify`.
 * Luego registra el worktree para limpieza al cerrar la sesión.
 */
export function cleanupWorktree(info: WorktreeInfo): WorktreeResult {
	const { workPath, branch } = info;

	if (!existsSync(workPath)) {
		return { hasChanges: false };
	}

	try {
		// Verificar si hay cambios sin commit.
		const status = execSync("git status --porcelain", {
			cwd: workPath,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		if (status) {
			// Commitear cambios pendientes.
			try {
				execSync(
					'git add -A && git commit --no-verify -m "pi-agent: auto-commit"',
					{
						cwd: workPath,
						encoding: "utf-8",
						timeout: 10000,
						stdio: ["pipe", "pipe", "pipe"],
					},
				);
			} catch {
				// Si falla el commit, los cambios quedan en el worktree.
			}
		}

		// Verificar si el branch divergió del base.
		const diff = execSync(`git rev-list --count HEAD ^${info.baseSha}`, {
			cwd: workPath,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		const hasChanges = parseInt(diff, 10) > 0;

		return { hasChanges, branch: hasChanges ? branch : undefined };
	} catch (e) {
		return {
			hasChanges: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * Elimina el worktree y su branch (para limpieza al cerrar sesión).
 */
export function removeWorktree(workPath: string, branch?: string): void {
	try {
		execSync(`git worktree remove --force "${workPath}"`, {
			cwd: workPath,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		// El worktree ya pudo ser removido.
	}
	if (branch) {
		try {
			execSync(`git branch -D "${branch}"`, {
				cwd: workPath,
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch {
			// El branch ya pudo ser borrado.
		}
	}
}

/**
 * Limpia todos los worktrees registrados de un repo.
 * Útil al cerrar la sesión para no dejar worktrees huérfanos.
 */
export function pruneWorktrees(cwd: string): void {
	try {
		execSync("git worktree prune", {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		// Non-fatal.
	}
}
