// frida-subagents — git worktree isolation.
//
// Porte de pi-subagents/src/worktree.ts (ADR-0022 Fase 5 / D3).
// Crea un worktree aislado del repo para que el agente trabaje en una copia.
//
// Ciclo de vida (alineado con pi-subagents para NO acumular worktrees):
//   - Al completar el agente, si hubo cambios: los commitea, crea un branch
//     (con sufijo anti-colisión) y elimina el worktree (el branch persiste).
//   - Si no hubo cambios: elimina el worktree por completo.
//   - En error: best-effort remove.
// El branch solo se crea si hubo cambios, así nunca quedan branches colgando.

import { execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";

export interface WorktreeInfo {
	/** Path absoluto del worktree (raíz de la copia del repo). */
	path: string;
	/** Branch creado para este worktree (si hubo cambios al terminar). */
	branch: string;
	/** Commit SHA base del que se creó el worktree (antes de que el agente empiece). */
	baseSha: string;
	/**
	 * Dónde debe trabajar el agente dentro del worktree: el equivalente al cwd
	 * desde el que se creó. Es `path` cuando ese cwd era la raíz del repo;
	 * apunta al subdirectorio copiado cuando era más profundo (ej. un package
	 * de monorepo), para que el scoping pedido sobreviva al aislamiento.
	 */
	workPath: string;
}

export interface WorktreeResult {
	/** Si el agente hizo cambios. */
	hasChanges: boolean;
	/** Branch con los cambios (si hay). */
	branch?: string;
	/** Path del worktree si se conservó (solo cuando hay cambios). */
	path?: string;
	/** Mensaje de error (si falló). */
	error?: string;
}

/**
 * Crea un git worktree (detached) para un agente.
 *
 * El branch NO se crea aquí: se crea en `cleanupWorktree` sólo si hubo cambios,
 * para no dejar branches colgando cuando el agente no modifica nada.
 *
 * @returns WorktreeInfo si tiene éxito, undefined si falla (no es repo, sin commits).
 */
export function createWorktree(
	cwd: string, // pi-lens-ignore: duplicate-function-arg (falso positivo del tree-sitter runner con tipos interfaz; params únicos cwd y agentId)
	agentId: string,
): WorktreeInfo | undefined {
	// Verificar que es un repo git con commits + resolver base + subdir.
	let baseSha: string;
	let subdir: string;
	try {
		execSync("git rev-parse HEAD", {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		baseSha = execSync("git rev-parse HEAD", {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		// Dónde está cwd dentro del repo ("" en la raíz): el agente debe trabajar
		// en el mismo subdirectorio dentro de la copia, o un cwd profundo en un
		// monorepo se ensancharía silenciosamente a todo el repo. realpath en
		// ambos lados — git emite paths resueltos mientras cwd puede llegar vía
		// symlink (macOS /tmp).
		const topLevel = execSync("git rev-parse --show-toplevel", {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		subdir = relative(realpathSync(topLevel), realpathSync(cwd));
	} catch {
		return undefined;
	}

	const branch = `pi-agent-${agentId.slice(-8)}`;
	const tmpBase = join(homedir(), ".frida", "worktrees");
	const path = join(tmpBase, agentId);

	// Crear worktree detached en HEAD (sin branch inicial).
	try {
		execSync(`git worktree add --detach "${path}" HEAD`, {
			cwd,
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		return undefined;
	}

	return {
		path,
		branch,
		baseSha,
		workPath: subdir ? join(path, subdir) : path,
	};
}

/**
 * Limpia un worktree tras la completación del agente.
 *
 * - Sin cambios (HEAD === baseSha): elimina el worktree por completo.
 * - Con cambios: commitea, crea un branch (con sufijo anti-colisión), elimina el
 *   worktree (el branch persiste en el repo principal) y devuelve branch + path.
 * - En error: best-effort remove.
 *
 * @param cwd Repo base (donde se creó el worktree) — debe coincidir con el
 *   `cwd` que se pasó a `createWorktree`.
 * @param worktree Info devuelta por `createWorktree`.
 * @param agentDescription Descripción del agente (para el mensaje de commit).
 */
export function cleanupWorktree(
	cwd: string, // pi-lens-ignore: duplicate-function-arg (falso positivo del tree-sitter runner con tipos interfaz; params únicos cwd y worktree y agentDescription)
	worktree: WorktreeInfo,
	agentDescription: string,
): WorktreeResult {
	if (!existsSync(worktree.path)) {
		return { hasChanges: false };
	}

	try {
		// Verificar si hay cambios sin commit.
		const status = execSync("git status --porcelain", {
			cwd: worktree.path,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		if (status) {
			// Hay cambios — stagear y commitear.
			execSync("git add -A", {
				cwd: worktree.path,
				encoding: "utf-8",
				timeout: 10000,
				stdio: ["pipe", "pipe", "pipe"],
			});
			// Truncar descripción para el mensaje de commit.
			const safeDesc = agentDescription.slice(0, 200);
			execSync(`git commit --no-verify -m "pi-agent: ${safeDesc}"`, {
				cwd: worktree.path,
				encoding: "utf-8",
				timeout: 10000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} else {
			const currentSha = execSync("git rev-parse HEAD", {
				cwd: worktree.path,
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();

			if (currentSha === worktree.baseSha) {
				// Sin cambios — eliminar worktree.
				removeWorktree(cwd, worktree.path);
				return { hasChanges: false };
			}
		}

		// Crear un branch apuntando al HEAD del worktree.
		// Si el branch ya existe, añadir un sufijo para no sobreescribir trabajo previo.
		let branchName = worktree.branch;
		try {
			execSync(`git branch "${branchName}"`, {
				cwd: worktree.path,
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch {
			// El branch ya existe — usar un sufijo único.
			branchName = `${worktree.branch}-${Date.now()}`;
			execSync(`git branch "${branchName}"`, {
				cwd: worktree.path,
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		}
		// Actualizar el nombre del branch en la info para el caller.
		worktree.branch = branchName;

		// Eliminar el worktree (el branch persiste en el repo principal).
		removeWorktree(cwd, worktree.path);

		return { hasChanges: true, branch: worktree.branch, path: worktree.path };
	} catch (e) {
		// Best-effort cleanup en error.
		try {
			removeWorktree(cwd, worktree.path);
		} catch {
			/* ignore */
		}
		return {
			hasChanges: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * Force-remueve un worktree. Si falla `git worktree remove`, intenta prune
 * como fallback (el directorio pudo quedar ya sin registro).
 *
 * Nota: NO borra el branch — si hubo cambios, el branch debe persistir para
 * que el usuario lo revise/mergee.
 *
 * @param cwd Repo base donde se registró el worktree.
 * @param path Path del worktree a remover.
 */
export function removeWorktree(cwd: string, path: string): void {
	// pi-lens-ignore: duplicate-function-arg (falso positivo del tree-sitter runner; params únicos cwd y path)
	try {
		execSync(`git worktree remove --force "${path}"`, {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		// Si remove falla, intentar prune.
		try {
			execSync("git worktree prune", {
				cwd,
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch {
			/* El worktree ya pudo ser removido. */
		}
	}
}

/**
 * Prunea worktrees huérfanos (crash recovery).
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
		/* Non-fatal. */
	}
}
