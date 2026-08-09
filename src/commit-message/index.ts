// Command handler de `frida.generateCommitMessage` (issue #9).
//
// Orquesta el flujo completo: repo git activo → diff (staged si hay; si no working tree) → config → LLM →
// inputBox.value. NUNCA commitea: sólo llena el textbox de commit para que el
// usuario revise y dé Commit manualmente (Ctrl+Enter), como GitHub Copilot.
//
// El contexto (modelo/modelRuntime/cwd/agentDir) lo inyecta extension.ts desde
// el scope de activate(); así este módulo no depende de los internals de Frida.

import * as vscode from "vscode";
import { loadCommitMessageConfig } from "./config";
import { generateCommitMessage } from "./generator";
import { getActiveRepository } from "./git";

/** Contexto que extension.ts provee al handler (tomado del scope de activate). */
export interface CommandContext {
	/** modelRuntime de la sesión activa de Frida (frida.modelRuntime). */
	modelRuntime: unknown;
	/** Modelo activo (frida.session.model). undefined = el SDK usa su default. */
	model: unknown;
	/** Directorio de trabajo del workspace (workspaceCwd()). */
	cwd: string;
	/** agentDir de Frida (defaultAgentDir()). */
	agentDir: string;
}

/**
 * Ejecuta el comando: genera el mensaje de commit del diff (staged si hay; si
 * no, working tree) y lo escribe en el textbox del SCM. Maneja los casos borde
 * (sin modelo, sin repo, sin cambios, fallo del LLM) con mensajes claros al
 * usuario. No commitea ni hace git add: sólo llena el textbox.
 */
export async function runGenerateCommitMessage(
	ctx: CommandContext,
): Promise<void> {
	const { modelRuntime, model, cwd, agentDir } = ctx;

	// 1. Modelo/modelRuntime activo (sesión lista para una llamada efímera).
	if (!modelRuntime) {
		await vscode.window.showWarningMessage(
			"Frida no tiene un modelo activo. Inicia sesión o elige un proveedor e inténtalo de nuevo.",
		);
		return;
	}

	// 2. Repositorio Git del workspace (vía API pública de vscode.git).
	const repo = getActiveRepository(cwd);
	if (!repo) {
		await vscode.window.showWarningMessage(
			"No hay un repositorio Git abierto. Abre una carpeta con un repo Git (y verifica que la extensión Git de VS Code esté habilitada).",
		);
		return;
	}

	// 3. Diff: staged si hay; si no, working tree (mirror de GitHub Copilot).
	//    Así el botón sirve aunque el usuario aún no haya hecho `git add`.
	let diff: string;
	let diffSource: "staged" | "working tree";
	try {
		const staged = await repo.diff(true);
		if (staged.trim()) {
			diff = staged;
			diffSource = "staged";
		} else {
			diff = await repo.diff(false);
			diffSource = "working tree";
		}
	} catch (e) {
		await vscode.window.showErrorMessage(
			`Frida no pudo leer el diff: ${e instanceof Error ? e.message : String(e)}`,
		);
		return;
	}
	if (!diff.trim()) {
		await vscode.window.showWarningMessage(
			"No hay cambios para generar un mensaje. Modifica archivos y vuelve a intentarlo.",
		);
		return;
	}

	// 4. Generación con indicador de progreso anclado al panel Source Control.
	const config = loadCommitMessageConfig(cwd);
	const message = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.SourceControl,
			title: "Frida: generando mensaje de commit…",
		},
		() =>
			generateCommitMessage(diff, config, {
				modelRuntime,
				model,
				cwd,
				agentDir,
			}),
	);
	if (!message) {
		await vscode.window.showWarningMessage(
			"Frida no pudo generar un mensaje de commit. Verifica que el modelo esté respondiendo e inténtalo de nuevo.",
		);
		return;
	}

	// 5. Escribir en el textbox. El commit SIEMPRE es manual (Ctrl+Enter).
	repo.inputBox.value = message;
	void vscode.window.showInformationMessage(
		`Frida: mensaje generado (basado en cambios ${diffSource}). Revísalo y dale Commit (Ctrl+Enter).`,
	);
}
