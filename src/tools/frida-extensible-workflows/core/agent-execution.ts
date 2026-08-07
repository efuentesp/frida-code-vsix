// frida-extensible-workflows — shim de tipos para el agent-executor (Fase 1).
//
// El núcleo vendorizado (execution.ts, persistence.ts) importa de
// "./agent-execution" SÓLO tipos (import type), que esbuild/vite borran en
// runtime/bundle. Este shim satisface el type-check (tsc) sin arrastrar la
// maquinaria real del WorkflowAgentExecutor/FairAgentScheduler, que se adapta
// y reemplaza este archivo en la Fase 2 (frida-agent-execution.ts).
//
// Las definiciones provienen de pi-extensible-workflows/src/agent-execution.ts
// (interfaces AgentAttempt, OwnershipRecord, ScheduledAgentOptions) y son
// estructuralmente compatibles con lo que el core consume.

import type {
	AgentAccounting,
	AgentIdentity,
	AgentSetupSummary,
	AgentState,
	JsonSchema,
	JsonValue,
	LiveSessionHandoff,
	ModelSpec,
	PreparedAgentSession,
	RoleOverride,
	WorkflowAgentSession,
	WorkflowAgentSessionReference,
} from "./types";

/** Nivel de thinking (espejo de ModelSpec["thinking"] en types.ts). */
export type ThinkingLevel = NonNullable<ModelSpec["thinking"]>;

/** Opciones de un agente agendado. Forma fiel al original (agent-execution.ts). */
export interface ScheduledAgentOptions {
	label: string;
	requestedLabel?: string;
	parentBreadcrumb?: string;
	cwd: string;
	tools: readonly string[];
	worktreeOwner?: string;
	model?: string;
	thinking?: ThinkingLevel;
	role?: string | RoleOverride;
	schema?: JsonSchema;
	retries?: number;
	timeoutMs?: number | null;
	agentOptions?: Readonly<Record<string, JsonValue>>;
	agentIdentity?: AgentIdentity;
}

/**
 * Resultado de un intento de agente. execution.ts lo importa (import type) para
 * tipar las respuestas RPC del hijo. Definición fiel al original.
 */
export interface AgentAttempt {
	attempt: number;
	transport: string;
	session?: WorkflowAgentSessionReference;
	liveSession?: WorkflowAgentSession;
	prepared?: Readonly<PreparedAgentSession>;
	handoff?: LiveSessionHandoff;
	result?: JsonValue;
	error?: { code: string; message: string };
	accounting: AgentAccounting;
	setup: AgentSetupSummary;
}

/**
 * Registro de ownership de un nodo agendado. persistence.ts lo persiste como
 * `ownership.json` (alias PersistedOwnershipNode). `state` es el AgentState del
 * scheduler; `options` se serializa tal cual (persistence no lo introspecta).
 */
export type OwnershipRecord = {
	id: string;
	parentId?: string;
	prompt?: string;
	label: string;
	state: AgentState;
	options: Readonly<ScheduledAgentOptions>;
};
