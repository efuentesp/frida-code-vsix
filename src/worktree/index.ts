/**
 * frida-worktree — dos entradas para la misma lógica (issue #13):
 *
 *  1. Comando VS Code `frida.worktree` (botón SCM + Palette) → pickers nativos
 *     de VS Code (createVscodeWorktreeUI).
 *  2. Slash command `/worktree` (chat) → ctx.ui del webview (fiel al original
 *     @narumitw/pi-worktree, que era interactivo en el chat).
 *
 * Ambas comparten `runWorktreeFlows` (capa de seguridad porteada del original).
 * Frida fija el cwd de la sesión al workspace, así que "abrir" un worktree abre
 * una ventana VS Code nueva (cwd + sesión propios).
 *
 * Refs #13.
 */
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { createGitClient } from "./exec";
import {
	createVscodeWorktreeUI,
	runWorktreeFlows,
	type WorktreeUI,
} from "./command";
import { stripTerminalControls } from "./git";
import { createWorktreeSettingsRuntime, settingsFilePath } from "./settings";

/** Contexto que extension.ts provee al comando VS Code (scope de activate). */
export interface WorktreeCommandContext {
	/** Directorio de trabajo del workspace (workspaceCwd()). */
	cwd: string;
}

/** Crea el git client + settings compartidos por ambas entradas. */
async function prepare(): Promise<{
	git: ReturnType<typeof createGitClient>;
	settings: ReturnType<typeof createWorktreeSettingsRuntime>;
}> {
	const git = createGitClient();
	const settings = createWorktreeSettingsRuntime({ path: settingsFilePath });
	await settings.reload();
	return { git, settings };
}

/** Comando VS Code `frida.worktree` — pickers nativos de VS Code. */
export async function runWorktreeCommand(
	ctx: WorktreeCommandContext,
): Promise<void> {
	const { git, settings } = await prepare();
	await runWorktreeFlows(git, settings, ctx.cwd, createVscodeWorktreeUI());
}

/**
 * Factory de la extensión pi: registra el slash command `/worktree` (fiel al
 * original) con UI vía ctx.ui del webview/chat. Patrón canónico frida
 * `createFridaXxx(): (pi) => void` (ADR-0022, ADR-0025).
 */
export function createFridaWorktree(): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI): void => {
		pi.registerCommand("worktree", {
			description: "Gestiona git worktrees (add/abrir/remove/prune/configure)",
			async handler(_args, ctx: ExtensionCommandContext) {
				const { git, settings } = await prepare();
				await runWorktreeFlows(git, settings, ctx.cwd, ctxWorktreeUI(ctx));
			},
		});
	};
}

/** Adapter de UI basado en ctx.ui del webview/chat (slash command /worktree). */
function ctxWorktreeUI(ctx: ExtensionCommandContext): WorktreeUI {
	return {
		input: (prompt, value) => ctx.ui.input(prompt, value),
		confirm: (title, message) => ctx.ui.confirm(title, message),
		notify: (message, level) =>
			ctx.ui.notify(stripTerminalControls(message), level),
		select: (title, labels) => ctx.ui.select(title, labels),
	};
}
