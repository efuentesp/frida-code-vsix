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

import { readFile } from "node:fs/promises";
import * as path from "node:path";
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
	/** Repo que contiene el uri (archivo/carpeta). null si ninguno. */
	getRepository(uri: vscode.Uri): GitRepository | null;
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

	// 1. Editor activo → repo que lo contiene (identifica la sesión activa real,
	//    incluso con varias carpetas/worktrees abiertos). Issue #9.
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	if (activeUri) {
		const byEditor = api.getRepository(activeUri);
		if (byEditor) return byEditor;
	}

	// 2. Coincidencia exacta por cwd (workspaceCwd o cwd explícito).
	if (cwd) {
		const normalized = cwd.replace(/\/+$/, "");
		const match = api.repositories.find(
			(r) => r.rootUri.fsPath.replace(/\/+$/, "") === normalized,
		);
		if (match) return match;
	}

	// 3. Único repo: usarlo (caso común single-repo sin editor activo).
	if (api.repositories.length === 1) return api.repositories[0];

	// 4. Multi-repo sin editor activo ni cwd match: último recurso, el primero.
	return api.repositories[0];
}

/**
 * Diff para el commit message: staged si hay; si no, working tree INCLUYENDO
 * untracked. `repo.diff()` replica `git diff`, que EXCLUYE archivos sin trackear
 * (VS Code los muestra como "U", pero git diff los ignora). El footer de Frida
 * usa `git status --porcelain` que SÍ los cuenta → sin este ajuste el botón
 * reportaba "no hay cambios" aunque el footer mostrara N. Issue #9.
 */
export async function getCommitDiff(repo: GitRepository): Promise<{
	diff: string;
	source: "staged" | "working tree";
}> {
	const staged = await repo.diff(true);
	if (staged.trim()) return { diff: staged, source: "staged" };

	const trackedRaw = await repo.diff(false);
	const tracked = trackedRaw.trim();
	// vscode.git enum Status.UNTRACKED = 7 (estable desde hace años). Se obtiene
	// del API en runtime si está expuesto, con fallback a 7.
	const api = getGitAPI();
	const UNTRACKED =
		(api as { Status?: { UNTRACKED?: number } } | undefined)?.Status
			?.UNTRACKED ?? 7;
	const untracked = repo.state.workingTreeChanges.filter(
		(c) => c.status === UNTRACKED,
	);
	const untrackedDiffs = await Promise.all(
		untracked.map((c) => buildUntrackedDiff(repo, c.uri)),
	);
	const untrackedParts = untrackedDiffs.filter((s) => s.length > 0);
	const combined = [tracked, ...untrackedParts].join("\n\n").trim();
	return { diff: combined, source: "working tree" };
}

/**
 * Construye un diff de adición para un archivo sin trackear, replicando el
 * formato de `git diff` (new file mode 100644). Maneja binarios (vía nul byte),
 * archivos vacíos y truncado para archivos grandes. No modifica el index.
 */
async function buildUntrackedDiff(
	repo: GitRepository,
	uri: vscode.Uri,
): Promise<string> {
	const root = repo.rootUri.fsPath;
	const rel = (path.relative(root, uri.fsPath) || uri.fsPath)
		.split(path.sep)
		.join("/");
	const MAX = 50_000;
	let bytes: Buffer;
	try {
		bytes = await readFile(uri.fsPath);
	} catch {
		return ""; // no se pudo leer (permisos, borrado, etc.)
	}
	if (bytes.length === 0) {
		return `diff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n`;
	}
	if (bytes.subarray(0, 8192).includes(0)) {
		return `diff --git a/${rel} b/${rel}\nnew file mode 100644\nBinary files differ\n`;
	}
	let text = bytes.toString("utf8");
	if (text.length > MAX) {
		text = `${text.slice(0, MAX)}\n... (truncado: archivo de ${bytes.length} bytes)\n`;
	}
	const lines = text.split("\n");
	const body = lines.map((l) => `+${l}`).join("\n");
	return `diff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
}
