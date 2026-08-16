/**
 * frida-cc-plugins — presenter de resultados (issue #49, UX post-e2e).
 *
 * El notify de la sesión es un TOAST efíreo: inadecuado para listas. Tras el
 * rediseño e2e (#49) la UI vive en el PANEL NATIVO del webview (panel.ts +
 * CcPluginsPanel.tsx): lista filtrable con teclado + ficha lado a lado. Este
 * presenter queda reducido al canal de CONSULTA:
 *
 *  - OutputChannel "Frida — cc-plugins": log persistente y silencioso
 *    (append sin robar foco; se abre manualmente desde el panel Output).
 *
 * La INTERFAZ vive aquí (type-only para index.ts → los tests no cargan
 * vscode); la implementación `createVscodePresenter()` solo la importa
 * extension.ts (extension host).
 */
import * as vscode from "vscode";

export interface CcPluginsPresenter {
	/** Log persistente (output channel). Silencioso: nunca roba foco. */
	append(lines: string[]): void;
}

/** Impl VS Code (solo extension host — no la importen los tests). */
export function createVscodePresenter(): CcPluginsPresenter {
	let channel: vscode.OutputChannel | undefined;
	const out = (): vscode.OutputChannel =>
		(channel ??= vscode.window.createOutputChannel("Frida — cc-plugins"));

	return {
		append(lines) {
			const c = out();
			for (const l of lines) c.appendLine(l);
			// Sin show(): el panel Output NO se revela solo ni roba foco —
			// todo lo visible vive en el webview; esto es log de consulta.
		},
	};
}
