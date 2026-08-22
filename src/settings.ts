// Settings de Frida (contributes.configuration de VS Code). Llaves y defaults
// son la fuente única de verdad; el `package.json` las espeja en
// `contributes.configuration` para que aparezcan en la Settings UI nativa.
//
// Los toggles de herramientas (ask_user_question / todo) se leen en vivo por
// las factories de Pi vía getters; un cambio se aplica con session.reload()
// (re-ejecuta las factories, que re-leen estos settings) sin perder historial.

import * as vscode from "vscode";
import { TOOL_TOGGLE_BY_KEY, TOOL_TOGGLES } from "./tool-toggles";
import type { UserRole } from "./usage/report-schema";
import type { EmbeddingsProviderSetting } from "./tools/frida-codebase-index/host-setup";

export const CONFIG_SECTION = "frida";

/** ¿Está activo el tool `ask_user_question`? Default: true. */
export function isAskUserQuestionEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("askUserQuestion.enabled", true);
}

/** ¿Está activo el tool `todo`? Default: true. */
export function isTodoEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("todo.enabled", true);
}

/** ¿Está activo el tool `context` (snapshot de presión, frida-context)?
 *  Default: true. Configurable vía frida.context.enabled. */
export function isContextEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("context.enabled", true);
}

/** Snapshot de todos los toggles conmutables (#53), leído desde el registro
 *  central (tool-toggles.ts) — fuente única de verdad. */
export function readToolToggles(): Record<string, boolean> {
	const out: Record<string, boolean> = {};
	for (const t of TOOL_TOGGLES) {
		out[t.key] = vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.get<boolean>(t.setting, true);
	}
	return out;
}

/** Lee la config de DevEngine. `contextWindow`/`maxTokens` son **null si el usuario
 *  no los puso explícitamente** (override) → el caller los resuelve por prioridad
 *  (gateway > catálogo > default). ADR-0019. */
export function readDevengineConfig(): {
	contextWindow: number | null;
	maxTokens: number | null;
} {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const cwRaw = cfg.get<number | null>("devengine.contextWindow", null);
	const mtRaw = cfg.get<number | null>("devengine.maxTokens", null);
	const cw = cwRaw == null ? null : Number(cwRaw);
	const mt = mtRaw == null ? null : Number(mtRaw);
	return {
		contextWindow: cw != null && Number.isFinite(cw) && cw > 0 ? cw : null,
		maxTokens: mt != null && Number.isFinite(mt) && mt > 0 ? mt : null,
	};
}

/** Lee la config del proveedor Z.ai (baseUrl + ventana de contexto + maxTokens)
 *  ajustable desde settings (frida.zai.*). ADR-0017. */
export function readZaiConfig(): {
	baseUrl: string;
	contextWindow: number;
	maxTokens: number;
} {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const baseUrl = String(
		cfg.get<string>("zai.baseUrl", "https://api.z.ai/api/coding/paas/v4"),
	);
	const cw = Number(cfg.get<number>("zai.contextWindow", 200000));
	const mt = Number(cfg.get<number>("zai.maxTokens", 16000));
	return {
		baseUrl,
		contextWindow: Number.isFinite(cw) && cw > 0 ? cw : 200000,
		maxTokens: Number.isFinite(mt) && mt > 0 ? mt : 16000,
	};
}

/** Lee un array de strings de la config (default []) de forma defensiva. */
function readStringArray(key: string): string[] {
	const v = vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string[]>(key, []);
	return Array.isArray(v)
		? v.filter((s) => typeof s === "string" && s.length > 0)
		: [];
}

/**
 * Patrones configurables del gate de aprobación (Prioridad: gates configurables).
 * Se leen EN VIVO desde los settings de VS Code en cada `tool_call`, así los
 * cambios aplican al instante sin recargar (igual que el modo de aprobación).
 * Son capas que se SUMAN a los defaults hardcodeados de sensitive-paths.ts y
 * dangerous-commands.ts; el allow se comprueba antes que cualquier bloqueo.
 */
export interface GatePatterns {
	/** Extensiones adicionales a bloquear (sin punto, lowercased al comparar). */
	sensitiveExtensions: string[];
	/** Basenames exactos adicionales a bloquear. */
	sensitiveBasenames: string[];
	/** Basenames a PERMITIR (allowlist propia; anula bloqueos). */
	sensitiveAllowBasenames: string[];
	/** Substrings a bloquear en bash (sensibles a mayúsculas). */
	dangerousCommandSubstrings: string[];
}

/** Snapshot en vivo de los patrones de gates desde la config de VS Code. */
export function readGatePatterns(): GatePatterns {
	return {
		sensitiveExtensions: readStringArray("gates.sensitiveExtensions"),
		sensitiveBasenames: readStringArray("gates.sensitiveBasenames"),
		sensitiveAllowBasenames: readStringArray("gates.sensitiveAllowBasenames"),
		dangerousCommandSubstrings: readStringArray(
			"gates.dangerousCommandSubstrings",
		),
	};
}

/** Forma "vacía" de GatePatterns, para entornos sin VS Code (tests del gate). */
export const EMPTY_GATE_PATTERNS: GatePatterns = {
	sensitiveExtensions: [],
	sensitiveBasenames: [],
	sensitiveAllowBasenames: [],
	dangerousCommandSubstrings: [],
};

/** Persiste un toggle (global, recuerda entre sesiones) del registro central.
 *  Aplica al recargar la sesión (las factories re-leen el getter). */
export async function writeToolToggle(
	key: string,
	enabled: boolean,
): Promise<void> {
	const def = TOOL_TOGGLE_BY_KEY.get(key);
	if (!def) throw new Error(`Toggle desconocido: ${key}`);
	await vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.update(def.setting, enabled, vscode.ConfigurationTarget.Global);
}

// === Toggles Fase 2 (issue #53): gates nuevos de módulos conmutables ===

/** ¿Está activo frida-subagents? Default: true. */
export function isSubagentsEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("subagents.enabled", true);
}

/** ¿Está activo frida-agent-browser? Default: true. */
export function isAgentBrowserEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("agentBrowser.enabled", true);
}

/** ¿Está activo frida-supi-web? Default: true. */
export function isSupiWebEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("supiWeb.enabled", true);
}

/** ¿Está activo frida-mcp-adapter? Default: true. */
export function isMcpAdapterEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("mcpAdapter.enabled", true);
}

/** ¿Está activo frida-extensible-workflows? Default: true. */
export function isExtensibleWorkflowsEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("extensibleWorkflows.enabled", true);
}

/** ¿Está activo frida-git-sync? Default: true. */
export function isGitSyncEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("gitSync.enabled", true);
}

/** ¿Está activo frida-worktree? Default: true. */
export function isWorktreeEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("worktree.enabled", true);
}

// === Reporte de uso (frida-usage-report/v1) ===

/** Email del usuario para el reporte de uso (en claro; solo se incluye con opt-in).
 *  Default ""; si está vacío, identity.ts hace fallback a `git config user.email`. */
export function getUserEmail(): string {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string>("user.email", "");
}

/** Organización/empresa para el reporte de uso. Default "". */
export function getOrg(): string {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string>("org", "");
}

/** Rol declarado del usuario. Default "other". */
export function getUserRole(): UserRole {
	const r = vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string>("user.role", "other");
	return (
		["dev", "qa", "architect", "lead", "devops", "other"].includes(r)
			? r
			: "other"
	) as UserRole;
}

/** ¿El usuario optó a incluir su identidad al exportar el reporte de uso? */
export function isTelemetryOptIn(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("telemetry.optIn", false);
}

/** Persiste el opt-in de telemetría (global). */
export async function setTelemetryOptIn(on: boolean): Promise<void> {
	await vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.update("telemetry.optIn", on, vscode.ConfigurationTarget.Global);
}

// === Codebase index (frida-codebase-index, ADR-0036 / issue #25) ===

/** Config de frida.codebaseIndex.*. */
export interface CodebaseIndexConfig {
	enabled: boolean;
	/** Conservar los natives de otras plataformas tras instalar (debug/multi-target). */
	keepOtherPlatforms: boolean;
	/** Provider de embeddings (#116): auto (Ollama→Copilot→…) | frida-enterprise
	 *  | ollama | openai | custom. */
	provider: EmbeddingsProviderSetting;
	/** Modelo de Frida Enterprise (default azure-embeddings-default). */
	fridaEnterpriseModel: string;
	/** Modelo local de Ollama (default nomic-embed-text). */
	ollamaModel: string;
	/** Modelo de OpenAI (default text-embedding-3-small). */
	openaiModel: string;
	/** Endpoint custom OpenAI-compatible (vacío = no configurado). */
	customBaseUrl: string;
	/** Modelo del endpoint custom (vacío = default del upstream). */
	customModel: string;
	/** Dimensions del endpoint custom (0 = sin verificar; el Ping las deduce). */
	customDimensions: number;
}

/** ¿Está activo frida-codebase-index? Default: true (degrada con guía si falta el paquete). */
export function isCodebaseIndexEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("codebaseIndex.enabled", true);
}

// === Hermes memory (frida-hermes-memory, ADR-0032 / issue #21) ===

/**
 * ¿Está activo frida-hermes-memory? Default: true. El learning loop consume
 * tokens del modelo (background learning + review): este gate permite
 * apagarlo sin desinstalar el paquete.
 */
export function isHermesMemoryEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("hermesMemory.enabled", true);
}

// === Knowledge base (frida-knowledge-base, ADR-0040 / issue #29) ===

/**
 * ¿Está activa frida-knowledge-base? Default: true. La KB OKF del proyecto
 * (wrapper de @zosmaai/pi-llm-wiki): el gate permite apagarla sin
 * desinstalar el paquete (p. ej. proyectos sin vault ni ingest).
 */
export function isKnowledgeBaseEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("knowledgeBase.enabled", true);
}

// === Claude Code plugins (frida-cc-plugins, ADR-0057 / issue #49) ===

/**
 * ¿Está activo frida-cc-plugins? Default: true — la extensión nunca instala
 * nada sola (todo install requiere /ccplugin add explícito); el gate sólo
 * apaga la superficie (comando + resources_discover) si el usuario lo pide.
 */
export function isCcPluginsEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("ccPlugins.enabled", true);
}

/** Team marketplaces (paridad extraKnownMarketplaces): refs a auto-instalar. */
export function readCcPluginsExtraMarketplaces(): string[] {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string[]>("ccPlugins.extraMarketplaces", []);
}

// === Sandboxes (frida-sandboxes, ADR-0047 / issue #35) ===

/** ¿Está activa frida-sandboxes (#35)? Default: true (Docker se probea). */
export function isSandboxesEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("sandboxes.enabled", true);
}

/** Imagen Docker default de nuevos sandboxes (frida.sandboxes.defaultImage). */
export function readSandboxesDefaultImage(): string {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string>("sandboxes.defaultImage", "node:22");
}

/** Allowlist de dominios de red in-container (vacía = sin restricción). */
export function readSandboxesAllowDomains(): string[] {
	return (
		vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.get<string[]>("sandboxes.allowDomains", []) ?? []
	);
}

/** enabledPlugins del equipo: "plugin@marketplace" → true. */
export function readCcPluginsEnabledPlugins(): Record<string, boolean> {
	const raw = vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<Record<string, boolean>>("ccPlugins.enabledPlugins", {});
	return raw ?? {};
}

/** Snapshot de la config del índice de código. */
export function readCodebaseIndexConfig(): CodebaseIndexConfig {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const rawProvider = cfg.get<string>(
		"codebaseIndex.embeddings.provider",
		"auto",
	);
	const provider: EmbeddingsProviderSetting = (
		[
			"auto",
			"frida-enterprise",
			"ollama",
			"openai",
			"custom",
		] as const
	).includes(rawProvider as EmbeddingsProviderSetting)
		? (rawProvider as EmbeddingsProviderSetting)
		: "auto";
	return {
		enabled: isCodebaseIndexEnabled(),
		keepOtherPlatforms: cfg.get<boolean>(
			"codebaseIndex.keepOtherPlatforms",
			false,
		),
		provider,
		fridaEnterpriseModel: cfg.get<string>(
			"codebaseIndex.embeddings.fridaEnterprise.model",
			"azure-embeddings-default",
		),
		ollamaModel: cfg.get<string>(
			"codebaseIndex.embeddings.ollama.model",
			"nomic-embed-text",
		),
		openaiModel: cfg.get<string>(
			"codebaseIndex.embeddings.openai.model",
			"text-embedding-3-small",
		),
		customBaseUrl: String(
			cfg.get<string>("codebaseIndex.embeddings.custom.baseUrl", ""),
		).trim(),
		customModel: String(
			cfg.get<string>("codebaseIndex.embeddings.custom.model", ""),
		).trim(),
		customDimensions: Number(
			cfg.get<number>("codebaseIndex.embeddings.custom.dimensions", 0),
		),
	};
}
