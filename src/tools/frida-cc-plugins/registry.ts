/**
 * frida-cc-plugins — registro declarativo (issue #49, ADR-0057 D2).
 *
 * cc-plugins.json es la FUENTE DE VERDAD de marketplaces y plugins
 * instalados (patrón claude-plugins.json de pi-claude-marketplace): la
 * factory aplica un reconcile al cargar (resources_discover) re-materializando
 * lo faltante — instalaciones automáticas y repetibles tras borrar resources/
 * o migrar de máquina.
 *
 * Escrituras atómicas (staging + rename, patrón acolomba).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { registryPath } from "./constants";

export interface MarketplaceRecord {
	/** URL git clonada (https/ssh) — o path absoluto si local. */
	url: string;
	/** HEAD short sha del clone (identidad del marketplace). */
	rev: string;
	/** Marketplace local del filesystem: sin clone, contenido del usuario. */
	local?: boolean;
	/** `#ref` con el que se clonó (branch/tag) — se reusa en updates. */
	ref?: string;
	/** Último refresh del catálogo (throttle de 30s del refresh-before-lookup). */
	refreshedAt?: string;
	/** Auto-update background on/off (#50). Default off; el oficial on. */
	autoUpdate?: boolean;
	addedAt: string;
}

export interface SkippedRecord {
	kind: string;
	path: string;
	reason: string;
}

export interface PluginRecord {
	marketplace: string;
	/** Source del catálogo, serializado para reinstalación. */
	source: { kind: string; [k: string]: unknown };
	version?: string;
	rev: string;
	enabled: boolean;
	installedAt: string;
	/** Descripción del catálogo (para la vista de detalle instalado). */
	description?: string;
	/** Costo de contexto estimado al instalar (tokens/turno). */
	estimatedTokens?: number;
	/** Nombres de invocación convertidos (para listar/auditar). */
	skills: string[];
	commands: string[];
	/** Llaves MCP registradas en ~/.frida/mcp.json (para uninstall limpio). */
	mcpServers: string[];
	skipped: SkippedRecord[];
}

export interface CcPluginsRegistry {
	schemaVersion: 1;
	/** Bootstrap auto del oficial ya intentado (paridad Claude, una sola vez). */
	bootstrapped?: boolean;
	marketplaces: Record<string, MarketplaceRecord>;
	plugins: Record<string, PluginRecord>;
}

export function emptyRegistry(): CcPluginsRegistry {
	return { schemaVersion: 1, marketplaces: {}, plugins: {} };
}

/** Carga un registro de un archivo; inexistente/corrupto → vacío (self-healing). */
export function loadRegistryAt(file: string): CcPluginsRegistry {
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		if (raw && typeof raw === "object" && raw.schemaVersion === 1) {
			return {
				schemaVersion: 1,
				bootstrapped: raw.bootstrapped === true,
				marketplaces: raw.marketplaces ?? {},
				plugins: raw.plugins ?? {},
			};
		}
	} catch {
		/* inexistente o inválido */
	}
	return emptyRegistry();
}

/** Carga el registro USER (~/.frida/cc-plugins/cc-plugins.json). */
export function loadRegistry(agentDir: string): CcPluginsRegistry {
	return loadRegistryAt(registryPath(agentDir));
}

/** Guarda en un archivo con escritura atómica (tmp + rename, mismo FS). */
export function saveRegistryAt(file: string, reg: CcPluginsRegistry): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(reg, null, "\t") + "\n");
	fs.renameSync(tmp, dest_safe(file));
}
function dest_safe(file: string): string {
	return file; // rename atómico tras escribir tmp en el mismo dir
}

/** Guarda el registro USER. */
export function saveRegistry(agentDir: string, reg: CcPluginsRegistry): void {
	saveRegistryAt(registryPath(agentDir), reg);
}

// ─── Scopes (fase 2 #50): user / project / local ─────────────────────────

export type PluginScope = "user" | "project" | "local";

/** Registro del PROJECT: <cwd>/.frida/cc-plugins.json (commit-eable). */
export function projectRegistryPath(cwd: string): string {
	return path.join(cwd, ".frida", "cc-plugins.json");
}

/** Registro LOCAL: <cwd>/.frida/cc-plugins.local.json (no versionar). */
export function localRegistryPath(cwd: string): string {
	return path.join(cwd, ".frida", "cc-plugins.local.json");
}

export interface ScopeLayers {
	user: CcPluginsRegistry;
	project: CcPluginsRegistry;
	local: CcPluginsRegistry;
}

/** Carga los tres scopes (user hereda siempre; project/local si existen). */
export function loadLayers(
	agentDir: string,
	cwd: string,
): ScopeLayers {
	return {
		user: loadRegistry(agentDir),
		project: loadRegistryAt(projectRegistryPath(cwd)),
		local: loadRegistryAt(localRegistryPath(cwd)),
	};
}

/** Archivo del scope. */
export function scopeRegistryPath(
	agentDir: string,
	cwd: string,
	scope: PluginScope,
): string {
	if (scope === "user") return registryPath(agentDir);
	if (scope === "project") return projectRegistryPath(cwd);
	return localRegistryPath(cwd);
}

/** Plugin resuelto en un scope (para listar/operar con precedencia). */
export interface ScopedPlugin {
	name: string;
	rec: PluginRecord;
	scope: PluginScope;
}

/** Merge de lectura con precedencia local > project > user (paridad Claude). */
export function mergeLayers(layers: ScopeLayers): {
	marketplaces: Record<string, MarketplaceRecord & { scope: PluginScope }>;
	plugins: ScopedPlugin[];
} {
	const marketplaces: Record<string, MarketplaceRecord & { scope: PluginScope }> = {};
	// user base, luego project, luego local (último gana).
	for (const scope of ["user", "project", "local"] as const) {
		for (const [name, m] of Object.entries(layers[scope].marketplaces)) {
			marketplaces[name] = { ...m, scope };
		}
	}
	const byName = new Map<string, ScopedPlugin>();
	for (const scope of ["user", "project", "local"] as const) {
		for (const [name, rec] of Object.entries(layers[scope].plugins)) {
			byName.set(name, { name, rec, scope }); // scopes altos pisan
		}
	}
	return { marketplaces, plugins: [...byName.values()] };
}
