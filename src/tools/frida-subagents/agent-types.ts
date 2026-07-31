// frida-subagents — registry unificado de tipos de agente.
//
// Porte de pi-subagents/src/agent-types.ts (ADR-0022 Fase 2).
// Fusiona defaults embebidos + custom descubiertos de .frida/agents/ y
// ~/.frida/global/agents/. Proporciona resolución case-insensitive,
// display names, y tool resolution.

import { DEFAULT_AGENTS } from "./default-agents";
import { loadCustomAgents } from "./custom-agents";
import type { AgentConfig } from "./types";

/** Nombres de tools built-in de Pi (los 7 estándar). */
export const BUILTIN_TOOL_NAMES = [
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
] as const;

/**
 * Cache de agentes custom. Se invalida con `reloadCustomAgents()`.
 * La fábrica llama reload al registrar el tool y al ejecutar (para
 * detectar .md nuevos sin reiniciar).
 */
let customCache: Map<string, AgentConfig> | undefined;
let customCacheCwd: string | undefined;

/** Recarga los agentes custom desde disco. */
export function reloadCustomAgents(cwd: string): Map<string, AgentConfig> {
	customCache = loadCustomAgents(cwd);
	customCacheCwd = cwd;
	return customCache;
}

/** Obtiene los custom cacheados (o recarga si el cwd cambió). */
function getCustomAgents(cwd: string): Map<string, AgentConfig> {
	if (!customCache || customCacheCwd !== cwd) {
		reloadCustomAgents(cwd);
	}
	return customCache!;
}

/**
 * Resuelve un tipo de agente (case-insensitive) a su nombre canónico.
 * Devuelve undefined si no se encuentra.
 */
export function resolveType(rawType: string, cwd: string): string | undefined {
	const lower = rawType.toLowerCase();

	// Defaults.
	for (const d of DEFAULT_AGENTS) {
		if (d.name.toLowerCase() === lower && d.enabled !== false) {
			return d.name;
		}
	}

	// Custom.
	const customs = getCustomAgents(cwd);
	if (customs.has(rawType)) return rawType;
	for (const [name, config] of customs) {
		if (name.toLowerCase() === lower && config.enabled !== false) {
			return name;
		}
	}

	return undefined;
}

/**
 * Obtiene la configuración completa de un agente por tipo.
 * Busca en defaults + custom (case-insensitive).
 */
export function getAgentConfig(
	type: string,
	cwd: string,
): AgentConfig | undefined {
	const lower = type.toLowerCase();

	// Defaults primero.
	for (const d of DEFAULT_AGENTS) {
		if (d.name.toLowerCase() === lower && d.enabled !== false) {
			return d;
		}
	}

	// Custom.
	const customs = getCustomAgents(cwd);
	const exact = customs.get(type);
	if (exact && exact.enabled !== false) return exact;
	for (const [name, config] of customs) {
		if (name.toLowerCase() === lower && config.enabled !== false) {
			return config;
		}
	}

	return undefined;
}

/** Display name para un tipo de agente. */
export function getDisplayName(type: string, cwd: string): string {
	return getAgentConfig(type, cwd)?.displayName ?? type;
}

/** Lista todos los tipos disponibles (defaults + custom habilitados). */
export function getAvailableTypes(cwd: string): string[] {
	const types = new Set<string>();
	for (const d of DEFAULT_AGENTS) {
		if (d.enabled !== false) types.add(d.name);
	}
	for (const [name, config] of getCustomAgents(cwd)) {
		if (config.enabled !== false) types.add(name);
	}
	return [...types].sort();
}

/**
 * Resuelve los nombres de tools para un agente.
 * - undefined = todos los built-in (sin restricción).
 * - string[] = sólo esos tools.
 * - [] = ninguno.
 */
export function getToolNamesForType(config: AgentConfig): string[] | undefined {
	return config.builtinToolNames;
}

/** Sólo tests. */
export function _resetAgentTypes(): void {
	customCache = undefined;
	customCacheCwd = undefined;
}
