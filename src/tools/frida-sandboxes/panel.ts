/**
 * frida-sandboxes — panel nativo del webview (issue #35).
 *
 * Patrón CcPanel (frida-cc-plugins/panel.ts): el comando /sandbox emite UN
 * SandboxPanelRequest con la lista completa + ejecutor de acciones host-side
 * (funciones que NUNCA cruzan al webview). El webview sólo pinta y dispara
 * acciones por nombre; el estado real siempre vive en el host.
 */

/** Fila serializable del panel. */
export interface SandboxInfo {
	name: string;
	image: string;
	state: "active" | "paused";
	createdAt: string;
	projectDir: string;
	createdBy: string;
	/** Último estado observado del container docker (refresh). */
	lastSeen?: string;
	/** Cambios sin mergear (se piden async vía rowMeta — dockers status es lento). */
	changes?: number;
}

/** Capability de Docker (gating honesto del panel). */
export interface DockerInfo {
	available: boolean;
	reason?: string;
}

/** Acciones host-side por id de panel (nunca cruzan al webview). */
export interface SandboxPanelActions {
	/** Refresca la lista (re-emite el panel con el mismo id). */
	refresh(): Promise<void>;
	/** `docker pause` del sandbox. */
	pause(name: string): Promise<string>;
	/** `docker unpause`. */
	resume(name: string): Promise<string>;
	/** `docker rm -f` — el confirm vive en el webview (doble ⏎). */
	destroy(name: string): Promise<string>;
	/** git status in-container → lista de archivos modificados. */
	changes(name: string): Promise<string[]>;
	/** docker cp de archivos de vuelta al proyecto. */
	mergeFiles(name: string, files: string[]): Promise<string>;
	/** Terminal interactiva (`docker exec -it`) en terminal de VS Code. */
	terminal?(name: string): Promise<void>;
	/** Re-probea Docker (botón "Reintentar detección"). */
	reprobe(): Promise<void>;
}

/** Request completo del panel — todo lo que el webview necesita pintar. */
export interface SandboxPanelRequest {
	id: string;
	title: string;
	sandboxes: SandboxInfo[];
	docker: DockerInfo;
	actions: SandboxPanelActions;
}

/** Sink: cómo el host entrega el request al webview (extensión VS Code). */
export type SandboxPanelSink = (req: SandboxPanelRequest) => void;
