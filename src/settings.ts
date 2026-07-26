// Settings de Frida (contributes.configuration de VS Code). Llaves y defaults
// son la fuente única de verdad; el `package.json` las espeja en
// `contributes.configuration` para que aparezcan en la Settings UI nativa.
//
// Los toggles de herramientas (ask_user_question / todo) se leen en vivo por
// las factories de Pi vía getters; un cambio se aplica con session.reload()
// (re-ejecuta las factories, que re-leen estos settings) sin perder historial.

import * as vscode from "vscode";

export const CONFIG_SECTION = "frida";

/** ¿Está activo el tool `ask_user_question`? Default: true. */
export function isAskUserQuestionEnabled(): boolean {
	return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>("askUserQuestion.enabled", true);
}

/** ¿Está activo el tool `todo`? Default: true. */
export function isTodoEnabled(): boolean {
	return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>("todo.enabled", true);
}

/** Snapshot de ambos toggles para publicar al webview. */
export function readToolToggles(): { askUserQuestion: boolean; todo: boolean } {
	return { askUserQuestion: isAskUserQuestionEnabled(), todo: isTodoEnabled() };
}

/** Persiste un toggle (global) y notifica al host que debe recargar. */
export async function writeToolToggle(
	key: "askUserQuestion" | "todo",
	enabled: boolean,
): Promise<void> {
	const settingKey = key === "askUserQuestion" ? "askUserQuestion.enabled" : "todo.enabled";
	await vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.update(settingKey, enabled, vscode.ConfigurationTarget.Global);
}
