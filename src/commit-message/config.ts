// Lectura de la configuración `frida.commitMessage.*` + resolución del template.
//
// Las settings se declaran en `package.json` (contributes.configuration).
// El template markdown es opcional: si existe (vía setting `templatePath` o el
// default `~/.frida/commit-message-prompt.md`), su contenido REEMPLAZA el system
// prompt default de Conventional Commits — útil para reglas de equipo (ticket
// JIRA obligatorio, scope fijo, sin emoji, etc.). Los placeholders
// `{language}`, `{maxSubjectLength}` y `{types}` se interpolan en generator.ts.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { CommitMessageConfig } from "./generator";

/** Sección de configuración declarada en package.json. */
const CONFIG_SECTION = "frida.commitMessage";

/** Template default si el usuario no indica uno y quiere personalizar. */
const DEFAULT_TEMPLATE_PATH = path.join(
	os.homedir(),
	".frida",
	"commit-message-prompt.md",
);

/**
 * Lee la configuración desde VS Code y resuelve el `templatePath` efectivo:
 * prioridad = setting explícito → `~/.frida/commit-message-prompt.md` si existe
 * → "" (sin template, se usa el prompt default del generator).
 */
export function loadCommitMessageConfig(cwd: string): CommitMessageConfig {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const templatePathSetting = cfg.get<string>("templatePath") ?? "";

	const templatePath = resolveTemplatePath(templatePathSetting, cwd);

	return {
		format: cfg.get<"conventional" | "free">("format") ?? "conventional",
		language: cfg.get<"es" | "en">("language") ?? "es",
		includeBody: cfg.get<boolean>("includeBody") ?? true,
		maxSubjectLength: cfg.get<number>("maxSubjectLength") ?? 50,
		templatePath,
	};
}

/**
 * Resuelve el templatePath efectivo. Un setting vacío cae al default
 * `~/.frida/commit-message-prompt.md` SÓLO si existe; si no hay nada, devuelve
 * "" (el generator aplicará su prompt default). Un path relativo se resuelve
 * contra el cwd del workspace; uno absoluto se usa tal cual.
 */
function resolveTemplatePath(setting: string, cwd: string): string {
	if (setting.trim()) {
		return path.isAbsolute(setting) ? setting : path.resolve(cwd, setting);
	}
	// Sin setting: usar el default del home si ya existe (no lo creamos aquí).
	try {
		if (fs.existsSync(DEFAULT_TEMPLATE_PATH)) return DEFAULT_TEMPLATE_PATH;
	} catch {
		// Best-effort: si no podemos stat el home, seguimos sin template.
	}
	return "";
}
