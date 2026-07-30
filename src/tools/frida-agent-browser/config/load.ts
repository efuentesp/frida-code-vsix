/**
 * frida-agent-browser — carga de config por capas (Fase 3).
 *
 * Porte de config.js#getAgentBrowserConfigPaths + loadAgentBrowserConfigStateSync,
 * adaptado a los paths de Frida (agentDir = ~/.frida):
 *   - global:    <agentDir>/config/frida-agent-browser/config.json   (~/.frida/…)
 *   - project:   <cwd>/.frida/config/frida-agent-browser/config.json
 *   - override:  $PI_AGENT_BROWSER_CONFIG (path absoluto a un config.json)
 *
 * Las capas se leen y fusionan en ese orden (override gana). La config es ADVISORY:
 * sólo produce guidance para el system prompt (browser defaults) y deja listos los
 * campos de webSearch para Fase 5 (resolución lazy de credenciales command/env).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	CONFIG_ENV,
	mergeConfig,
	validateConfig,
	type AgentBrowserConfig,
	type BrowserDefaultProfile,
} from "./policy";

export interface ConfigPaths {
	global: string;
	project: string;
	override?: string;
}

export interface ConfigLayer {
	scope: "global" | "project" | "override";
	path: string;
	config: AgentBrowserConfig;
}

export interface ConfigState {
	config: AgentBrowserConfig;
	errors: string[];
	warnings: string[];
	layers: ConfigLayer[];
	executablePath?: string;
	defaultProfile?: BrowserDefaultProfile;
	webSearchEnabled: boolean;
	/** scope de dónde proviene la guidance efectiva (para depuración). */
	executablePathScope?: ConfigLayer["scope"];
	defaultProfileScope?: ConfigLayer["scope"];
}

export function getConfigPaths(opts: {
	cwd: string;
	agentDir: string;
	env?: Record<string, string | undefined>;
}): ConfigPaths {
	const env = opts.env ?? process.env;
	const override = env[CONFIG_ENV]?.trim();
	return {
		global: path.join(
			opts.agentDir,
			"config",
			"frida-agent-browser",
			"config.json",
		),
		project: path.join(
			opts.cwd,
			".frida",
			"config",
			"frida-agent-browser",
			"config.json",
		),
		override: override && override.length > 0 ? override : undefined,
	};
}

interface ParsedLayer {
	scope: ConfigLayer["scope"];
	path: string;
	config: AgentBrowserConfig;
}

function readLayer(
	filePath: string,
	scope: ConfigLayer["scope"],
	errors: string[],
): ParsedLayer | undefined {
	// NOTA DE CONFIANZA: filePath proviene de getConfigPaths — agentDir (~/.frida,
	// host), cwd del workspace, u override $PI_AGENT_BROWSER_CONFIG (env del usuario).
	// Son ubicaciones TRUSTED/user-configured (no agent-controlled), igual que el
	// paquete referencia. La lectura es read-only y validada; sin riesgo de traversal
	// desde el agente. (ts-path-traversal sobre estas líneas = falso positivo.)
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch (e) {
		const err = e as NodeJS.ErrnoException;
		if (err?.code === "ENOENT") return undefined; // ausente = capa no aplica
		errors.push(
			`Could not read ${scope} config ${filePath}: ${err?.message ?? e}`,
		);
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		errors.push(
			`${scope} config ${filePath} must contain a JSON object: ${(e as Error).message}`,
		);
		return undefined;
	}
	const { config, errors: verrors } = validateConfig(parsed, `${scope} config`);
	errors.push(...verrors);
	return { scope, path: filePath, config };
}

/**
 * Carga y fusiona las capas de config (sync). `includeProjectConfig=false` omite la
 * capa de proyecto (p.ej. si el proyecto no es confiable — la resolución de
 * `!command` en webSearch project queda para Fase 5, donde se gating por trust).
 */
export function loadConfigSync(opts: {
	cwd: string;
	agentDir: string;
	env?: Record<string, string | undefined>;
	includeProjectConfig?: boolean;
}): ConfigState {
	const paths = getConfigPaths(opts);
	const includeProject = opts.includeProjectConfig !== false;
	const errors: string[] = [];
	const warnings: string[] = [];

	const candidates: Array<{ path: string; scope: ConfigLayer["scope"] }> = [
		{ path: paths.global, scope: "global" },
		...(includeProject
			? [{ path: paths.project, scope: "project" as const }]
			: []),
		...(paths.override
			? [{ path: paths.override, scope: "override" as const }]
			: []),
	];

	const layers: ConfigLayer[] = [];
	let merged: AgentBrowserConfig = {};
	for (const c of candidates) {
		const layer = readLayer(c.path, c.scope, errors);
		if (!layer) continue;
		layers.push(layer);
		merged = mergeConfig(merged, layer.config);
	}

	// Scope efectivo = la última capa que definió cada campo.
	let executablePathScope: ConfigLayer["scope"] | undefined;
	let defaultProfileScope: ConfigLayer["scope"] | undefined;
	for (const layer of layers) {
		if (layer.config.browser?.executablePath !== undefined)
			executablePathScope = layer.scope;
		if (layer.config.browser?.defaultProfile !== undefined)
			defaultProfileScope = layer.scope;
	}

	// webSearch.enabled default true salvo enabled:false explícito (paridad con el
	// referencia: "available when webSearch.enabled is not false"). Así credenciales
	// de sólo-env (sin config) siguen registrando el tool.
	const ws = merged.webSearch ?? {};
	const webSearchEnabled = ws.enabled !== false;

	return {
		config: merged,
		errors,
		warnings,
		layers,
		executablePath: merged.browser?.executablePath,
		defaultProfile: merged.browser?.defaultProfile,
		executablePathScope,
		defaultProfileScope,
		webSearchEnabled,
	};
}
