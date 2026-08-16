/**
 * frida-cc-plugins — panel nativo del webview (UX #49, rediseño e2e).
 *
 * Estructura tipo /plugins de Claude Code: tabs Discover | Instalados |
 * Marketplaces | Errores. El comando /ccplugin emite UN CcPanelRequest con
 * TODAS las vistas (el webview cambia de tab sin round-trip) + un ejecutor
 * de acciones host-side (funciones que NUNCA cruzan al webview).
 *
 * Señal de popularidad: NO hay downloads públicos (el marketplace.json no los
 * incluye; Claude Code usa su registry interno) → categoría + autor, que sí
 * vienen en el catálogo. "Last updated" por plugin se deriva con git log del
 * dir en el clon (bajo demanda, cacheado) vía actions.rowMeta.
 */

/** Fila serializable del panel (discover e instalados). */
export interface CcPanelRow {
	/** Ref canónica "plugin@marketplace" (para acciones). */
	ref: string;
	/** Nombre corto del plugin. */
	label: string;
	version?: string;
	/** Estado para pintar badge y decidir acciones. */
	status: "available" | "installed" | "disabled";
	/** Ficha de detalle (markdown) — panel derecho. */
	markdown: string;
	/** Categoría del catálogo (chip en la fila). */
	category?: string;
	/** Autor (señal de confianza sin downloads). */
	author?: string;
	/** Homepage (link en la ficha). */
	homepage?: string;
	/** Último commit del dir (async vía rowMeta — llega por patch). */
	lastUpdated?: string;
	/** Solo instalados: chips compactos de componentes (skill/cmd/mcp). */
	components?: string[];
	/** Costo de contexto estimado (tokens/turno), persistido al instalar. */
	tokens?: number;
	/** Dir real de instalación (~/.frida/cc-plugins/installs/<plugin>@<rev>). */
	path?: string;
	/** Descripción del catálogo (vista completa de instalado). */
	description?: string;
}

/** Recurso instalado (skill/command/MCP — unidad de la tab Instalados). */
export interface CcInstalledResource {
	/** Ref del plugin dueño "plugin@marketplace" (para acciones). */
	pluginRef: string;
	/** Nombre corto del plugin dueño. */
	plugin: string;
	/** Nombre convertido de invocación (<plugin>-<source>). */
	name: string;
	kind: "skill" | "cmd" | "mcp";
	/** Estado heredado del plugin (el registry habilita por plugin). */
	status: "installed" | "disabled";
	/** Costo del recurso (bytes/4; MCP no consume → undefined). */
	tokens?: number;
	/** Path real (SKILL.md / prompt .md / mcp.json). */
	path?: string;
	/** Descripción (frontmatter de la skill / primer párrafo del command). */
	description?: string;
}

/** Tarjeta de marketplace (tab Marketplaces). */
export interface CcMarketplaceInfo {
	/** Nombre registrado (slug del registro). */
	name: string;
	/** URL/source con que se agregó. */
	url: string;
	/** Plugins disponibles en el catálogo. */
	plugins: number;
	/** "hace 2 días" — relativo, formateado host-side en español. */
	refreshedAt?: string;
	/** Auto-update habilitado. */
	autoUpdate: boolean;
}

/** Entrada de error (tab Errores — runtime, no persiste). */
export interface CcPanelError {
	id: string;
	/** Relativo es: "hace 3 min". */
	when: string;
	/** Origen — define el retry. */
	source: "bootstrap" | "marketplace" | "install";
	message: string;
}

/** Petición de panel: id estable entre refreshes (el webview conserva tab/filtro). */
export interface CcPanelRequest {
	id: string;
	title: string;
	/** Tab Discover. */
	rows: CcPanelRow[];
	/** Tab Instalados. */
	installed: CcPanelRow[];
	/** Recursos instalados por tipo (lista de la tab Instalados). */
	resources: CcInstalledResource[];
	/** Tab Marketplaces. */
	marketplaces: CcMarketplaceInfo[];
	/** Tab Errores (vacía = tab oculto). */
	errors: CcPanelError[];
	actions: CcPanelActions;
}

/**
 * Ejecutores host-side. Devuelven mensaje de confirmación (toast corto);
 * el caller re-emite el panel tras ejecutar.
 */
export interface CcPanelActions {
	install(ref: string): Promise<string>;
	uninstall(ref: string): Promise<string>;
	toggle(ref: string, enable: boolean): Promise<string>;
	/** Agregar marketplace (owner/repo · URL git · npm · zip). */
	marketplaceAdd(spec: string): Promise<string>;
	/** Quitar marketplace (desinstala sus plugins). */
	marketplaceRemove(name: string): Promise<string>;
	/** Actualizar marketplace(s) (re-clone; name vacío = todos). */
	marketplaceUpdate(name?: string): Promise<string>;
	/** "Last updated" de un plugin (git log cacheado; undefined si no aplica). */
	rowMeta(ref: string): Promise<string | undefined>;
	/** Reintentar según el origen del error. */
	retry(source: CcPanelError["source"]): Promise<string>;
}

/** Callback que el host registra (extension.ts): abre/cierra el panel. */
export type CcPanelSink = (req: CcPanelRequest | null) => void;
