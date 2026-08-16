/**
 * frida-cc-plugins — panel nativo del webview (UX #49, rediseño e2e).
 *
 * El usuario pidió: lista como la de archivos/skills (filtrable, teclado,
 * altura acotada) + ficha de detalle lado a lado. Este archivo define el
 * CONTRATO host↔webview: el host (comando /ccplugin) emite un CcPanelRequest
 * con filas serializables + un ejecutor de acciones (funciones host-side que
 * NUNCA cruzan al webview); el webview (CcPluginsPanel.tsx) renderiza y
 * responde acciones por id.
 *
 * Reemplaza al UiDialog gigante (203 filas sin filtro) y a los toasts con
 * listados (post info = InfoToast efímero — el "toast innecesario").
 */

/** Fila serializable del panel. */
export interface CcPanelRow {
	/** Ref canónica "plugin@marketplace" (para acciones). */
	ref: string;
	/** Nombre corto del plugin. */
	label: string;
	/** Versión, si se conoce. */
	version?: string;
	/** Estado para pintar badge y decidir acciones. */
	status: "available" | "installed" | "disabled";
	/** Ficha de detalle (markdown) — panel derecho. */
	markdown: string;
}

/** Ejecutores host-side (no se serializan). Devuelven mensaje de confirmación. */
export interface CcPanelActions {
	install(ref: string): Promise<string>;
	uninstall(ref: string): Promise<string>;
	toggle(ref: string, enable: boolean): Promise<string>;
}

/** Petición de panel: id estable entre refreshes (el webview conserva filtro). */
export interface CcPanelRequest {
	id: string;
	title: string;
	rows: CcPanelRow[];
	actions: CcPanelActions;
}

/** Callback que el host registra (extension.ts): abre/cierra el panel. */
export type CcPanelSink = (req: CcPanelRequest | null) => void;
