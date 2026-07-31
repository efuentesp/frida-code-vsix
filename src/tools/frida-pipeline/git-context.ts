// frida-pipeline — git context cacheado (branch + commit + user).
//
// Porte de `rpiv-core/git-context.ts` (ADR-0021 Fase 2). Se inyecta una vez en
// session_start, se reinyecta en session_compact (transcript limpiado) y
// cuando el valor cacheado cambia (ej. tras un comando git mutante). Dos
// llamadas paralelas a `git rev-parse` — una sola no puede combinar
// `--abbrev-ref` y `--short` limpiamente porque el modo `--abbrev-ref`
// persiste en los revs subsecuentes. git mismo resuelve la redirección del
// gitdir del worktree, así que cualquiera de las dos formas es worktree-safe.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GIT_EXEC_TIMEOUT_MS } from "./constants";

export interface GitContext {
	branch: string;
	commit: string;
	user: string;
}

// Firma (branch+commit+user) del último mensaje metido al transcript.
// null = el transcript no tiene nada actual y necesita reinyección.
let lastInjectedSig: string | null = null;

// undefined = no cargado aún, null = no es repo git / falló, object = válido
let cache: GitContext | null | undefined;

/**
 * Devuelve el contexto de git cacheado, o lo carga si es la primera vez.
 * El cache vive por proceso; session_compact lo invalida vía
 * `clearGitContextCache`.
 */
export async function getGitContext(
	pi: ExtensionAPI,
): Promise<GitContext | null> {
	if (cache !== undefined) return cache;
	cache = await loadGitContext(pi);
	return cache;
}

/** Invalida el cache (para que el próximo getGitContext recargue). */
export function clearGitContextCache(): void {
	cache = undefined;
}

// Detached HEAD emite literal "HEAD" para --abbrev-ref; remapear para que el
// frontmatter sea significativo.
async function loadGitContext(pi: ExtensionAPI): Promise<GitContext | null> {
	try {
		const [branchRes, commitRes] = await Promise.all([
			pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
				timeout: GIT_EXEC_TIMEOUT_MS,
			}),
			pi.exec("git", ["rev-parse", "--short", "HEAD"], {
				timeout: GIT_EXEC_TIMEOUT_MS,
			}),
		]);
		const rawBranch = branchRes.stdout.trim();
		const commit = commitRes.stdout.trim();
		if (!rawBranch && !commit) return null;
		const branch = rawBranch === "HEAD" ? "detached" : rawBranch;
		let user = "";
		try {
			const r2 = await pi.exec("git", ["config", "user.name"], {
				timeout: GIT_EXEC_TIMEOUT_MS,
			});
			user = r2.stdout.trim();
		} catch {
			// caer al fallback de env
		}
		if (!user) user = process.env.USER || "unknown";
		return {
			branch: branch || "sin-branch",
			commit: commit || "sin-commit",
			user,
		};
	} catch {
		return null;
	}
}

/** Reinicia el marcador de "última firma inyectada" (session_compact/shutdown). */
export function resetInjectedMarker(): void {
	lastInjectedSig = null;
}

/**
 * Devuelve el contenido del mensaje a inyectar, o null si el transcript ya
 * está al día o no estamos en un repo git. Actualiza el marcador cuando
 * devuelve non-null.
 */
export async function takeGitContextIfChanged(
	pi: ExtensionAPI,
): Promise<string | null> {
	const g = await getGitContext(pi);
	if (!g) return null;
	const sig = `${g.branch}\n${g.commit}\n${g.user}`;
	if (sig === lastInjectedSig) return null;
	lastInjectedSig = sig;
	return `## Git Context\n- Branch: ${g.branch}\n- Commit: ${g.commit}\n- User: ${g.user}`;
}

/**
 * ¿El comando bash muta el estado de git? (checkout, commit, merge, etc.)
 * Si sí, el hook tool_call invalida el cache para que el próximo
 * before_agent_start vea el branch/commit nuevos.
 */
export function isGitMutatingCommand(cmd: string): boolean {
	return /\bgit\s+(checkout|switch|commit|merge|rebase|pull|reset|revert|cherry-pick|worktree|am|stash)\b/.test(
		cmd,
	);
}
