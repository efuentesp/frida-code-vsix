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
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("askUserQuestion.enabled", true);
}

/** ¿Está activo el tool `todo`? Default: true. */
export function isTodoEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("todo.enabled", true);
}

/** Snapshot de ambos toggles para publicar al webview. */
export function readToolToggles(): { askUserQuestion: boolean; todo: boolean } {
	return { askUserQuestion: isAskUserQuestionEnabled(), todo: isTodoEnabled() };
}

/** Lee la config del modelo DevEngine (ventana de contexto + maxTokens) ajustable
 *  desde settings (frida.devengine.*). Sin validación estricta: si el valor es
 *  inválido, cae al default. */
export function readDevengineConfig(): {
	contextWindow: number;
	maxTokens: number;
} {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const cw = Number(cfg.get<number>("devengine.contextWindow", 300000));
	const mt = Number(cfg.get<number>("devengine.maxTokens", 128000));
	return {
		contextWindow: Number.isFinite(cw) && cw > 0 ? cw : 300000,
		maxTokens: Number.isFinite(mt) && mt > 0 ? mt : 128000,
	};
}

/** Lee un array de strings de la config (default []) de forma defensiva. */
function readStringArray(key: string): string[] {
	const v = vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string[]>(key, []);
	return Array.isArray(v)
		? v.filter((s) => typeof s === "string" && s.length > 0)
		: [];
}

/**
 * Patrones configurables del gate de aprobación (Prioridad: gates configurables).
 * Se leen EN VIVO desde los settings de VS Code en cada `tool_call`, así los
 * cambios aplican al instante sin recargar (igual que el modo de aprobación).
 * Son capas que se SUMAN a los defaults hardcodeados de sensitive-paths.ts y
 * dangerous-commands.ts; el allow se comprueba antes que cualquier bloqueo.
 */
export interface GatePatterns {
	/** Extensiones adicionales a bloquear (sin punto, lowercased al comparar). */
	sensitiveExtensions: string[];
	/** Basenames exactos adicionales a bloquear. */
	sensitiveBasenames: string[];
	/** Basenames a PERMITIR (allowlist propia; anula bloqueos). */
	sensitiveAllowBasenames: string[];
	/** Substrings a bloquear en bash (sensibles a mayúsculas). */
	dangerousCommandSubstrings: string[];
}

/** Snapshot en vivo de los patrones de gates desde la config de VS Code. */
export function readGatePatterns(): GatePatterns {
	return {
		sensitiveExtensions: readStringArray("gates.sensitiveExtensions"),
		sensitiveBasenames: readStringArray("gates.sensitiveBasenames"),
		sensitiveAllowBasenames: readStringArray("gates.sensitiveAllowBasenames"),
		dangerousCommandSubstrings: readStringArray(
			"gates.dangerousCommandSubstrings",
		),
	};
}

/** Forma "vacía" de GatePatterns, para entornos sin VS Code (tests del gate). */
export const EMPTY_GATE_PATTERNS: GatePatterns = {
	sensitiveExtensions: [],
	sensitiveBasenames: [],
	sensitiveAllowBasenames: [],
	dangerousCommandSubstrings: [],
};

/** Persiste un toggle (global) y notifica al host que debe recargar. */
export async function writeToolToggle(
	key: "askUserQuestion" | "todo",
	enabled: boolean,
): Promise<void> {
	const settingKey =
		key === "askUserQuestion" ? "askUserQuestion.enabled" : "todo.enabled";
	await vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.update(settingKey, enabled, vscode.ConfigurationTarget.Global);
}
