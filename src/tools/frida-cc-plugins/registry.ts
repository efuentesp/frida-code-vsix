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

/** Carga el registro; inexistente/corrupto → vacío (self-healing). */
export function loadRegistry(agentDir: string): CcPluginsRegistry {
	try {
		const raw = JSON.parse(fs.readFileSync(registryPath(agentDir), "utf-8"));
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

/** Guarda el registro con escritura atómica (tmp + rename, mismo FS). */
export function saveRegistry(agentDir: string, reg: CcPluginsRegistry): void {
	const dest = registryPath(agentDir);
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	const tmp = `${dest}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(reg, null, "\t") + "\n");
	fs.renameSync(tmp, dest);
}
