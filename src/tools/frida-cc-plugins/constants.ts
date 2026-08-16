/**
 * frida-cc-plugins — constantes (issue #49, ADR-0057).
 *
 * Porte nativo para instalar plugins de Claude Code en frida: readers y
 * contrato de compatibilidad diseñados sobre @nklisch/pi-plugins (MIT) y
 * arquitectura runtime (resources_discover + root aislado + config
 * declarativa + staging atómico + colisiones MCP) sobre
 * pi-claude-marketplace (MIT, acolomba). Atribución completa en el ADR y en
 * docs/tools/frida-cc-plugins.md.
 *
 * Única fuente de verdad de layout, nombres y factory name.
 */
import * as path from "node:path";

/** Nombre de la factory embebida en extensionFactories (src/pi-session.ts). */
export const CC_PLUGINS_FACTORY_NAME = "frida-cc-plugins";

/** Comando slash de gestión (subcomandos estilo /claude:plugin de acolomba). */
export const CC_PLUGINS_COMMAND = "ccplugin";

/** Marketplace oficial de Anthropic (para /ccplugin bootstrap). */
export const OFFICIAL_MARKETPLACE = "anthropics/claude-plugins-official";

/**
 * Layout bajo <agentDir>/cc-plugins (ADR-0057 D2) — root aislado: cero
 * contaminación de dirs del usuario; enable/disable = resources_discover no
 * devuelve paths; uninstall = borrar el subdir del plugin.
 */
export function ccPluginsRoot(agentDir: string): string {
	return path.join(agentDir, "cc-plugins");
}

/** Registro declarativo (fuente de verdad; reconcile al cargar). */
export function registryPath(agentDir: string): string {
	return path.join(ccPluginsRoot(agentDir), "cc-plugins.json");
}

/** Clones de marketplaces: marketplaces/<name>@<rev>/. */
export function marketplacesDir(agentDir: string): string {
	return path.join(ccPluginsRoot(agentDir), "marketplaces");
}

/** Contenido instalado de plugins: installed/<plugin>@<rev>/ (copia inmutable). */
export function installedDir(agentDir: string): string {
	return path.join(ccPluginsRoot(agentDir), "installed");
}

/** Recursos convertidos expuestos vía resources_discover. */
export function resourcesDir(agentDir: string): string {
	return path.join(ccPluginsRoot(agentDir), "resources");
}

/** Skills convertidas: resources/skills/<plugin>/<skill>/. */
export function resourcesSkillsDir(agentDir: string): string {
	return path.join(resourcesDir(agentDir), "skills");
}

/** Prompts convertidos (planos, hyphen): resources/prompts/<plugin>-<cmd>.md. */
export function resourcesPromptsDir(agentDir: string): string {
	return path.join(resourcesDir(agentDir), "prompts");
}

/**
 * Slots de config MCP que lee pi-mcp-adapter (config.ts del paquete:
 * generic-global, pi-user-scope via getAgentDir(), project .mcp.json y
 * .pi/mcp.json). Se consultan para el chequeo de colisiones ANTES de
 * registrar servers de un plugin (ADR-0057 D5: nombres originales; colisión
 * = fallo con guía, nunca renombrar — rompería referencias por nombre).
 */
export function mcpCollisionSlots(
	agentDir: string,
	cwd: string,
	osHomedir: string,
): string[] {
	return [
		path.join(osHomedir, ".config", "mcp", "mcp.json"),
		path.join(agentDir, "mcp.json"),
		path.join(cwd, ".mcp.json"),
		path.join(cwd, ".pi", "mcp.json"),
	];
}

/** Archivo MCP global de frida (donde se registran servers de plugins). */
export function fridaMcpConfigPath(agentDir: string): string {
	return path.join(agentDir, "mcp.json");
}
