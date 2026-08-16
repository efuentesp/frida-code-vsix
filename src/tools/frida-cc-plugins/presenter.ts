/**
 * frida-cc-plugins — presenter de resultados (issue #49, UX post-e2e).
 *
 * El notify de la sesión es un TOAST efíreo: inadecuado para listas. Este
 * presenter da tres canales VS Code persistentes/interactivos:
 *
 *  - OutputChannel "Frida — cc-plugins": log persistente de cada comando
 *    (append + show). Siempre activo cuando hay presenter.
 *  - QuickPick interactivo: lista seleccionable con búsqueda; Enter abre el
 *    menú de acciones (Instalar/Detalle/Deshabilitar/Desinstalar) — el
 *    patrón VS Code clásico para elegir de un catálogo.
 *  - Documento markdown: detalle completo en un doc temporal (tablas,
 *    copiable).
 *
 * La INTERFAZ vive aquí (type-only para index.ts → los tests no cargan
 * vscode); la implementación `createVscodePresenter()` solo la importa
 * extension.ts (extension host).
 */
import * as vscode from "vscode";

/** Fila de lista para QuickPick/output/doc. */
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

export interface CcPluginsPresenter {
	/** Log persistente (output channel). `show` lo enfoca. */
	append(lines: string[], opts?: { show?: boolean }): void;
	/** Lista interactiva con acciones (QuickPick). */
	interactiveList(
		rows: CcListRow[],
		actions: CcListActions,
		title: string,
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
		append(lines, opts) {
			const c = out();
			for (const l of lines) c.appendLine(l);
			c.show(!opts?.show); // preserveFocus por defecto (no roba foco)
		},
		async interactiveList(rows, actions, title) {
			interface PickItem extends vscode.QuickPickItem {
				row: CcListRow;
			}
			const items: PickItem[] = rows.map((r) => ({
				label: r.label,
				description: r.description,
				detail: r.detail,
				row: r,
			}));
			const picked = (await vscode.window.showQuickPick(items, {
				placeHolder: `${title} — selecciona un plugin (Esc para cerrar)`,
				matchOnDescription: true,
				matchOnDetail: true,
			})) as PickItem | undefined;
			if (!picked) return;
			const row = picked.row;
			// Menú de acciones según estado.
			const opciones: string[] = ["Detalle (documento)"];
			if (row.installed) {
				opciones.push(row.enabled === false ? "Habilitar" : "Deshabilitar");
				opciones.push("Desinstalar");
			} else {
				opciones.push("Instalar");
			}
			const accion = await vscode.window.showQuickPick(opciones, {
				placeHolder: `${row.label} — ¿qué hacer?`,
			});
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
