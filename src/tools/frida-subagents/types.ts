// frida-subagents — tipos centrales.
//
// Porte simplificado de pi-subagents/src/types.ts (ADR-0022 Fase 1).
// Tipos mínimos para soportar el tool Agent con general-purpose.

import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";

/** Tipo de subagente: cualquier string (defaults o custom). */
export type SubagentType = string;

/** Modo de prompt: replace (standalone) o append (gemelo del padre). */
export type PromptMode = "replace" | "append";

/** Scope de memoria persistente. */
export type MemoryScope = "user" | "project" | "local";

/** Modo de aislamiento para la ejecución del agente. */
export type IsolationMode = "worktree";

/** Configuración unificada del agente — usada para defaults y custom. */
export interface AgentConfig {
	name: string;
	displayName?: string;
	description: string;
	/** Nombres de tools built-in permitidos. undefined = todos. */
	builtinToolNames?: string[];
	/** Tools denylist. */
	disallowedTools?: string[];
	/** Modelo: "provider/modelId" o fuzzy name. undefined = hereda padre. */
	model?: string;
	/** Nivel de thinking. undefined = hereda. */
	thinking?: string;
	/** Máximo de turnos. undefined = ilimitado. */
	maxTurns?: number;
	/** System prompt completo (body del .md). */
	systemPrompt: string;
	/** replace: el body ES el system prompt. append: se añade al del padre. */
	promptMode: PromptMode;
	/** Scope de memoria persistente: project | local | user. */
	memory?: MemoryScope;
	/** Skills a precargar: true (todas), string[] (nombres), false (ninguna). */
	skills?: boolean | string[] | string;
	/** ¿Fork la conversación del padre? */
	inheritContext?: boolean;
	/** ¿Correr en background por defecto? */
	runInBackground?: boolean;
	/** ¿Sin tools de extensión? */
	isolated?: boolean;
	/** ¿Aislamiento en git worktree? */
	isolation?: IsolationMode;
	/** ¿Agente default embebido? */
	isDefault?: boolean;
	/** ¿Habilitado? */
	enabled?: boolean;
	/** Origen de carga. */
	source?: "default" | "project" | "global";
}

/** Estado del agente. */
export type AgentStatus =
	| "queued"
	| "running"
	| "completed"
	| "steered"
	| "aborted"
	| "stopped"
	| "error";

/** Registro de un agente en ejecución o completado. */
export interface AgentRecord {
	id: string;
	type: SubagentType;
	description: string;
	status: AgentStatus;
	result?: string;
	error?: string;
	toolUses: number;
	startedAt: number;
	completedAt?: number;
	/** La sesión de Pi subyacente. */
	session?: unknown;
	/** AbortController para detener el agente. */
	abortController?: AbortController;
	/** Promise del resultado (para background). */
	promise?: Promise<string>;
	/** Si el resultado ya fue consumido via get_subagent_result. */
	resultConsumed?: boolean;
}

/** Opciones de spawn pasadas al runner. */
export interface SpawnOptions {
	prompt: string;
	description: string;
	model?: string;
	thinking?: string;
	maxTurns?: number;
	runInBackground?: boolean;
	resume?: string;
	isolated?: boolean;
	isolation?: IsolationMode;
	inheritContext?: boolean;
	/** Callback cuando el agente completa (para notificaciones). */
	onComplete?: (result: string, record: AgentRecord) => void;
	/** Callback de actividad (turnos, tools). */
	onTurnEnd?: (turnCount: number) => void;
	/** Reenvía texto/tools del sub-agente en vivo al webview como "partial" del
	 *  tool padre (agent foreground o get_subagent_result wait). Así se ve que el
	 *  sub-agente genera contenido mientras corre, no que está trabado. */
	onUpdate?: AgentToolUpdateCallback;
	/** Señal de abort del tool padre (agent). Si se dispara (el usuario pulsó
	 *  Detener), abortamos la sesión hija para que pare de inmediato. Sólo
	 *  foreground: los background viven su propio ciclo. */
	signal?: AbortSignal;
}
