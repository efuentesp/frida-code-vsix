// Wrapper tipado del API exportada por el built-in `vscode.git`.
//
// El Git extension de VS Code expone `exports.getAPI(1)` con acceso a los
// repositorios abiertos: cada `Repository` trae `inputBox.value` (el campo de
// commit) y `diff(true)` (el diff staged). Usamos esto para (1) leer el diff y
// alimentar al LLM y (2) escribir el mensaje generado en el textbox sin
// commitear. Fuente: extensions/git/src/api/git.d.ts del repo microsoft/vscode.
//
// No re-declaramos toda la API: sólo el subset que necesitamos (minimal types).
// Si el Git extension está deshabilitado o no hay repos abiertos, todas las
// funciones devuelven undefined y el handler muestra un mensaje al usuario.

import * as vscode from "vscode";

/** Subset del API exportada por vscode.git que usamos. */
export interface GitInputBox {
	value: string;
}

export interface GitChange {
	readonly uri: vscode.Uri;
	readonly originalUri: vscode.Uri;
	readonly renameUri: vscode.Uri | undefined;
	readonly status: number;
}

export interface GitRepositoryState {
	readonly indexChanges: GitChange[];
	readonly workingTreeChanges: GitChange[];
}

export interface GitRepository {
	readonly rootUri: vscode.Uri;
	readonly inputBox: GitInputBox;
	readonly state: GitRepositoryState;
	/** Diff del working tree (cached=false) o del index/staged (cached=true). */
	diff(cached?: boolean): Promise<string>;
}

export interface GitAPI {
	readonly repositories: GitRepository[];
	readonly state: "uninitialized" | "initialized";
}

export interface GitExtensionExports {
	readonly enabled: boolean;
	getAPI(version: 1): GitAPI;
}

/** Obtiene el API del built-in Git extension. undefined si no está instalado. */
export function getGitAPI(): GitAPI | undefined {
	const ext = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
	if (!ext?.exports?.enabled) return undefined;
	return ext.exports.getAPI(1);
}

/**
 * Devuelve el repositorio activo. Prioriza el que coincide con el cwd del
 * workspace; si no hay match exacto, usa el primero disponible. undefined si no
 * hay repos abiertos o el API aún no inicializó.
 */
export function getActiveRepository(
	cwd?: string,
): GitRepository | undefined {
	const api = getGitAPI();
	if (!api) return undefined;
	if (api.state === "uninitialized") return undefined;
	if (api.repositories.length === 0) return undefined;
	if (cwd) {
		const normalized = cwd.replace(/\/+$/, "");
		const match = api.repositories.find(
			(r) => r.rootUri.fsPath.replace(/\/+$/, "") === normalized,
		);
		if (match) return match;
	}
	return api.repositories[0];
}
