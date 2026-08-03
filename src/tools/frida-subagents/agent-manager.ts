// frida-subagents — gestor de lifecycle de agentes.
//
// Porte de pi-subagents/src/agent-manager.ts (ADR-0022 Fases 1+3).
// Mantiene un registro de agentes activos/completados + cola de concurrencia
// para background agents (máx 4 simultáneos, exceso en cola automática).

import { randomUUID } from "node:crypto";
import type { AgentRecord, AgentStatus } from "./types";
import { agentWidgetStore } from "./store";
import { pruneWorktrees } from "./worktree";

/** Registro de agentes por ID. */
const agents = new Map<string, AgentRecord>();

// ---------------------------------------------------------------------------
// Concurrency queue (Fase 3)
// ---------------------------------------------------------------------------

/** Máximo de agentes background simultáneos. */
let maxConcurrent = 4;

/** Agentes background actualmente corriendo. */
let runningCount = 0;

/** Cola de agentes esperando un slot. */
const queue: Array<() => Promise<void>> = [];

/** Callback cuando un slot se libera (para tests/observabilidad). */
let onSlotFreed: (() => void) | undefined;

/**
 * Intenta adquirir un slot de concurrencia. Si hay slots disponibles,
 * ejecuta inmediatamente. Si no, encola.
 *
 * @returns true si ejecutó inmediatamente, false si encoló.
 */
export async function acquireSlot(fn: () => Promise<void>): Promise<boolean> {
	if (runningCount < maxConcurrent) {
		runningCount++;
		await fn();
		return true;
	}
	queue.push(fn);
	return false;
}

/** Libera un slot y arranca el siguiente de la cola si hay. */
export function releaseSlot(): void {
	runningCount = Math.max(0, runningCount - 1);
	const next = queue.shift();
	if (next) {
		runningCount++;
		void next().then(() => releaseSlot());
	} else {
		onSlotFreed?.();
	}
}

/** Configura el máximo de concurrencia. */
export function setMaxConcurrent(max: number): void {
	maxConcurrent = Math.max(1, max);
}

/** Obtiene el máximo de concurrencia actual. */
export function getMaxConcurrent(): number {
	return maxConcurrent;
}

/** Número de agentes en cola esperando. */
export function queuedCount(): number {
	return queue.length;
}

/** Número de agentes corriendo. */
export function runningCountValue(): number {
	return runningCount;
}

/** Callback para cuando un slot se libera (tests). */
export function onSlotFreed_(cb: (() => void) | undefined): void {
	onSlotFreed = cb;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Genera un ID único para un agente. */
export function generateAgentId(): string {
	return `agent-${randomUUID().slice(0, 8)}`;
}

/** Registra un agente en el manager + widget store. */
export function registerAgent(record: AgentRecord): void {
	agents.set(record.id, record);
	agentWidgetStore.agentStarted({
		id: record.id,
		type: record.type,
		description: record.description,
		status: record.status as "running" | "queued",
		startedAt: record.startedAt,
	});
}

/** Obtiene un agente por ID. */
export function getAgent(id: string): AgentRecord | undefined {
	return agents.get(id);
}

/** Actualiza el estado de un agente + widget store. */
export function updateAgentStatus(
	id: string,
	status: AgentStatus,
	result?: string,
	error?: string,
): void {
	const agent = agents.get(id);
	if (!agent) return;
	agent.status = status;
	if (result !== undefined) agent.result = result;
	if (error !== undefined) agent.error = error;
	if (status === "completed" || status === "error" || status === "aborted") {
		agent.completedAt = Date.now();
	}
	agentWidgetStore.agentUpdated(id, status);
}

/** Lista todos los agentes (para /agents y UI). */
export function listAgents(): AgentRecord[] {
	return [...agents.values()];
}

/** Limpia agentes completados (para no crecer indefinidamente). */
export function cleanupCompleted(): void {
	for (const [id, agent] of agents) {
		if (
			(agent.status === "completed" || agent.status === "error") &&
			agent.resultConsumed &&
			agent.completedAt &&
			Date.now() - agent.completedAt > 5 * 60 * 1000 // 5 min
		) {
			agents.delete(id);
		}
	}
}

// ---------------------------------------------------------------------------
// Worktree lifecycle / crash recovery
// ---------------------------------------------------------------------------

/**
 * Repos base donde se crearon worktrees durante esta sesión.
 * Se trackean para poder prunear worktrees huérfanos al cerrar la sesión
 * (crash recovery), igual que `worktreeRepos` en pi-subagents.
 */
const worktreeRepos = new Set<string>();

/**
 * Registra un repo base donde se creó un worktree, para limpieza posterior.
 * Debe llamarse al crear un worktree (en `agent-runner.ts`).
 */
export function registerWorktreeRepo(cwd: string): void {
	if (cwd) worktreeRepos.add(cwd);
}

/**
 * Prunea worktrees huérfanos de todos los repos donde se crearon worktrees
 * durante la sesión (crash recovery), más el cwd actual.
 *
 * Llamarlo al cerrar/reiniciar la sesión para no dejar worktrees huérfanos
 * en `~/.frida/worktrees/` cuando un agente worktree se interrumpió antes de
 * su `cleanupWorktree`.
 */
export function pruneAllWorktrees(): void {
	// El cwd actual primero (caso normal: worktree del repo abierto).
	try {
		pruneWorktrees(process.cwd());
	} catch {
		/* non-fatal */
	}
	// Cada repo trackeado (puede diferir del cwd si un agente usó cwd custom).
	for (const repo of worktreeRepos) {
		try {
			pruneWorktrees(repo);
		} catch {
			/* non-fatal */
		}
	}
	worktreeRepos.clear();
}

/** Sólo tests: limpia todo el registry + cola + repos trackeados. */
export function _resetAgentManager(): void {
	agents.clear();
	queue.length = 0;
	runningCount = 0;
	maxConcurrent = 4;
	onSlotFreed = undefined;
	worktreeRepos.clear();
}
