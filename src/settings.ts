// Settings de Frida (contributes.configuration de VS Code). Llaves y defaults
// son la fuente única de verdad; el `package.json` las espeja en
// `contributes.configuration` para que aparezcan en la Settings UI nativa.
//
// Los toggles de herramientas (ask_user_question / todo) se leen en vivo por
// las factories de Pi vía getters; un cambio se aplica con session.reload()
// (re-ejecuta las factories, que re-leen estos settings) sin perder historial.

import * as vscode from "vscode";
import type { UserRole } from "./usage/report-schema";

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

/** Snapshot de ambos toggles para publicar al webview. */
export function readToolToggles(): { askUserQuestion: boolean; todo: boolean } {
	return { askUserQuestion: isAskUserQuestionEnabled(), todo: isTodoEnabled() };
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

/** Persiste un toggle (global) y notifica al host que debe recargar. */
export async function writeToolToggle(
	key: "askUserQuestion" | "todo",
	enabled: boolean,
): Promise<void> {
	const settingKey =
		key === "askUserQuestion" ? "askUserQuestion.enabled" : "todo.enabled";
	await vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.update(settingKey, enabled, vscode.ConfigurationTarget.Global);
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
	/** Provider de embeddings: auto (Ollama→OpenAI→Google) | ollama | custom. */
	provider: "auto" | "ollama" | "custom";
	/** Endpoint custom OpenAI-compatible (vacío = no configurado). */
	customBaseUrl: string;
	/** Modelo del endpoint custom (vacío = default del upstream). */
	customModel: string;
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

/** Snapshot de la config del índice de código. */
export function readCodebaseIndexConfig(): CodebaseIndexConfig {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const provider = cfg.get<string>("codebaseIndex.embeddings.provider", "auto");
	return {
		enabled: isCodebaseIndexEnabled(),
		keepOtherPlatforms: cfg.get<boolean>(
			"codebaseIndex.keepOtherPlatforms",
			false,
		),
		provider: provider === "ollama" || provider === "custom" ? provider : "auto",
		customBaseUrl: String(
			cfg.get<string>("codebaseIndex.embeddings.custom.baseUrl", ""),
		).trim(),
		customModel: String(
			cfg.get<string>("codebaseIndex.embeddings.custom.model", ""),
		).trim(),
	};
}
