/**
 * frida-cc-plugins — presenter de resultados (issue #49, UX post-e2e).
 *
 * El notify de la sesión es un TOAST efíreo: inadecuado para listas. Canales:
 *
 *  - Bloque en el chat (pi.sendMessage customType "frida.ccplugins"): el
 *    host lo publica al webview como bloque info — VISIBLE en la ventana de
 *    frida, persiste en el transcript.
 *  - Diálogo del WEBVIEW (ctx.ui.select → UiBridge → UiDialog): la lista
 *    interactiva vive DENTRO de frida, igual que los diálogos de las
 *    extensiones. NADA de showQuickPick: la paleta de VS Code queda fuera
 *    del webview, roba el foco y se cierra sola (reporte e2e #49).
 *  - OutputChannel "Frida — cc-plugins": log persistente y silencioso
 *    (append sin robar foco; se abre manualmente desde el panel Output).
 *  - Documento markdown: detalle completo en un doc temporal (info/Detalle).
 *
 * La INTERFAZ vive aquí (type-only para index.ts → los tests no cargan
 * vscode); la implementación `createVscodePresenter()` solo la importa
 * extension.ts (extension host).
 */
import * as vscode from "vscode";

/** Fila de lista para diálogo del webview/output/doc. */
export interface CcListRow {
	/** Etiqueta principal: "plugin@marketplace". */
	label: string;
	/** Descripción corta: versión/estado. */
	description?: string;
	/** Detalle: componentes/costo (segunda línea del pick). */
	detail?: string;
	/** ¿Ya instalado? (define las acciones ofrecidas). */
	installed: boolean;
	enabled?: boolean;
	/** Ref canónica para acciones: "plugin@marketplace". */
	ref: string;
}

/** Acciones que el presenter puede ejecutar sobre una fila (las pasa index). */
export interface CcListActions {
	install: (ref: string) => Promise<string>;
	uninstall: (name: string) => Promise<string>;
	toggle: (name: string, enable: boolean) => Promise<string>;
	/** Detalle en documento markdown. */
	detailDoc: (ref: string) => Promise<string>;
	/** Mensaje corto de confirmación (toast/info). */
	notify: (message: string, level?: "info" | "warning" | "error") => void;
}

/** Diálogo del webview de frida (slice de ExtensionUIContext → UiDialog). */
export interface CcWebDialog {
	select(title: string, options: string[]): Promise<string | undefined>;
}

export interface CcPluginsPresenter {
	/** Log persistente (output channel). Silencioso: nunca roba foco. */
	append(lines: string[]): void;
	/**
	 * Lista interactiva VÍA DIÁLOGO DEL WEBVIEW (CcWebDialog = ctx.ui del
	 * comando): elegir plugin → elegir acción → ejecutar. Sin diálogo
	 * (tests/TUI) no hace nada — el listado ya quedó en el bloque de chat.
	 */
	interactiveList(
		rows: CcListRow[],
		actions: CcListActions,
		title: string,
		ui?: CcWebDialog,
	): Promise<void>;
	/** Documento markdown temporal con el contenido. */
	document(title: string, markdown: string): Promise<void>;
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
		async interactiveList(rows, actions, title, ui) {
			if (!ui) return;
			// Paso 1: elegir plugin — DIÁLOGO DEL WEBVIEW (UiDialog).
			const labels = rows.map((r) =>
				[r.label, r.description].filter(Boolean).join("  "),
			);
			const chosen = await ui.select(`${title} — elige un plugin`, labels);
			const idx = chosen ? labels.indexOf(chosen) : -1;
			const row = idx >= 0 ? rows[idx] : undefined;
			if (!row) return;
			// Paso 2: menú de acciones según estado — mismo diálogo.
			const opciones: string[] = ["Detalle (documento)"];
			if (row.installed) {
				opciones.push(row.enabled === false ? "Habilitar" : "Deshabilitar");
				opciones.push("Desinstalar");
			} else {
				opciones.push("Instalar");
			}
			const accion = await ui.select(`${row.label} — ¿qué hacer?`, opciones);
			if (!accion) return;
			try {
				switch (accion) {
					case "Instalar":
						actions.notify(await actions.install(row.ref));
						break;
					case "Desinstalar":
						actions.notify(await actions.uninstall(row.ref.split("@")[0]!));
						break;
					case "Habilitar":
						actions.notify(await actions.toggle(row.ref.split("@")[0]!, true));
						break;
					case "Deshabilitar":
						actions.notify(await actions.toggle(row.ref.split("@")[0]!, false));
						break;
					case "Detalle (documento)":
						await actions.detailDoc(row.ref);
						break;
				}
			} catch (e: any) {
				actions.notify(`cc-plugins: ${e?.message ?? e}`, "error");
			}
		},
		async document(title, markdown) {
			const doc = await vscode.workspace.openTextDocument({
				content: markdown,
				language: "markdown",
			});
			await vscode.window.showTextDocument(doc, {
				preserveFocus: true,
				preview: true,
			});
		},
	};
}
