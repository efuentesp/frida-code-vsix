// frida-subagents — agentes default embebidos.
//
// Porte de pi-subagents/src/default-agents.ts (ADR-0022 Fase 1 / D6).
// Los 3 defaults se portan con adaptaciones mínimas: paths .frida/,
// descripciones en español. Fase 1 registra sólo general-purpose;
// Explore y Plan se añaden en Fase 3.

import type { AgentConfig } from "./types";

/** Los 3 nombres de agentes default. */
export const DEFAULT_AGENT_NAMES = [
	"general-purpose",
	"Explore",
	"Plan",
] as const;

/**
 * general-purpose: gemelo del padre. Hereda el system prompt del padre
 * (promptMode: "append") con todas las tools. No tiene systemPrompt propio —
 * la sesión hija construye su prompt desde los mismos recursos (AGENTS.md,
 * CLAUDE.md, etc.) que el padre.
 */
export const GENERAL_PURPOSE_AGENT: AgentConfig = {
	name: "general-purpose",
	displayName: "general-purpose",
	description:
		"Agente de propósito general. Hereda el system prompt del padre con todas las tools. Úsalo para tareas que no requieren especialización.",
	systemPrompt: "",
	promptMode: "append",
	isDefault: true,
	enabled: true,
	source: "default",
};

/**
 * Explore: exploración rápida read-only. Usa un modelo rápido (haiku/fallback)
 * con tools de sólo lectura. Su system prompt es standalone (replace).
 * Se registra en Fase 3.
 */
export const EXPLORE_AGENT: AgentConfig = {
	name: "Explore",
	displayName: "Explore",
	description:
		"Búsqueda rápida en el codebase (read-only). Úsalo cuando buscarías con grep, find o ls más de una vez.",
	builtinToolNames: ["read", "bash", "grep", "find", "ls"],
	systemPrompt:
		"Eres un especialista en encontrar DÓNDE vive el código en un codebase. Localiza archivos relevantes, organízalos por propósito, y devuelve resultados estructurados. NO analices qué hace el código — sólo localízalo.",
	promptMode: "replace",
	isDefault: true,
	enabled: true,
	source: "default",
};

/**
 * Plan: arquitecto de planificación read-only. Hereda el modelo del padre
 * con tools de sólo lectura. System prompt standalone.
 * Se registra en Fase 3.
 */
export const PLAN_AGENT: AgentConfig = {
	name: "Plan",
	displayName: "Plan",
	description:
		"Arquitecto de software para planificación de implementación (read-only). Úsalo para diseñar planes de implementación.",
	builtinToolNames: ["read", "bash", "grep", "find", "ls"],
	systemPrompt:
		"Eres un arquitecto de software. Diseña planes de implementación fase por fase con criterios de éxito observables. NO escribas código — sólo planifica.",
	promptMode: "replace",
	isDefault: true,
	enabled: true,
	source: "default",
};

/** Todos los defaults embebidos. */
export const DEFAULT_AGENTS: AgentConfig[] = [
	GENERAL_PURPOSE_AGENT,
	EXPLORE_AGENT,
	PLAN_AGENT,
];
