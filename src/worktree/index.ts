/**
 * Command handler de `frida.worktree` (issue #13).
 *
 * Porte nativo de @narumitw/pi-worktree: gestiona git worktrees (add / abrir /
 * remove / prune / configure) y abre cada worktree en una **ventana VS Code
 * nueva** — una por requisito, cada una con su propio cwd + sesión de Frida, sin
 * choques. Frida fija el cwd de la sesión al workspace, así que el aislamiento
 * se logra a nivel ventana (no cambiando el cwd de la sesión actual).
 *
 * El cwd lo inyecta extension.ts desde el scope de activate() (workspaceCwd()).
 * La config del worktree root es global (~/.frida/worktree.json) vía settings.ts.
 *
 * Refs #13.
 */
import { createGitClient } from "./exec";
import { runWorktreeFlows } from "./command";
import { createWorktreeSettingsRuntime, settingsFilePath } from "./settings";

/** Contexto que extension.ts provee al handler (tomado del scope de activate). */
export interface WorktreeCommandContext {
	/** Directorio de trabajo del workspace (workspaceCwd()). */
	cwd: string;
}

/**
 * Ejecuta el comando: abre el menú de worktrees (add/abrir/remove/prune/configure).
 * Maneja errores fatales (no es repo git, git no instalado) con mensajes claros.
 */
export async function runWorktreeCommand(
	ctx: WorktreeCommandContext,
): Promise<void> {
	const git = createGitClient();
	const settings = createWorktreeSettingsRuntime({ path: settingsFilePath });
	// Carga el estado desde disco (best-effort: archivo roto → default + warning).
	await settings.reload();
	await runWorktreeFlows(git, settings, ctx.cwd);
}
