// frida-subagents — group join manager.
//
// Porte simplificado de pi-subagents/src/group-join.ts (ADR-0022 Fase 3).
// Cuando 2+ agentes background se spawn en el mismo turno, consolida sus
// notificaciones de completación en una sola notificación agrupada.
//
// Modos:
//   smart (default): 2+ en el mismo turno → group; 1 solo → individual.
//   async: cada agente notifica individualmente.
//   group: forzar agrupado incluso con 1 solo.
//
// Timeout: tras el primer agente en completar, espera 30s a los demás.
// Si no todos completan, envía notificación parcial.

export type JoinMode = "smart" | "async" | "group";

interface PendingGroup {
	/** IDs de agentes en el grupo. */
	agentIds: Set<string>;
	/** Notificaciones de agentes que ya completaron. */
	completed: GroupedNotification[];
	/** Timer del timeout. */
	timer?: ReturnType<typeof setTimeout>;
	/** Callback para entregar la notificación (individual o agrupada). */
	deliver: (notifications: GroupedNotification[]) => void;
}

export interface GroupedNotification {
	agentId: string;
	type: string;
	description: string;
	status: string;
	result?: string;
	error?: string;
	durationMs: number;
}

const GROUP_TIMEOUT_MS = 30_000;

/** Callbacks de entrega per-agente (para async mode y fallback). */
const agentCallbacks = new Map<string, (n: GroupedNotification[]) => void>();

/** Grupos activos, indexados por turnId. */
const groups = new Map<string, PendingGroup>();

/** ID del turno actual (para agrupar spawns del mismo turno). */
let currentTurnId: string | undefined;

/**
 * Inicia un nuevo turno de agrupación. Llamado cuando el modelo
 * hace un nuevo tool call (o continúa después de una respuesta).
 */
export function startTurn(): string {
	currentTurnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	return currentTurnId;
}

/**
 * Registra un agente background en el grupo de su turno.
 * Si joinMode es "async", no agrupa (notifica individualmente).
 */
export function registerBackgroundAgent(
	agentId: string,
	joinMode: JoinMode,
	deliver: (notifications: GroupedNotification[]) => void,
): void {
	// Siempre guardar el callback per-agente (para async o fallback).
	agentCallbacks.set(agentId, deliver);

	if (joinMode === "async") return; // cada uno notifica solo

	const turnId = currentTurnId ?? startTurn();

	let group = groups.get(turnId);
	if (!group) {
		group = {
			agentIds: new Set(),
			completed: [],
			deliver,
		};
		groups.set(turnId, group);
	}
	group.agentIds.add(agentId);
}

/**
 * Notifica que un agente completó. Si está en un grupo, añade al lote.
 * Si no está en ningún grupo (async u orphan), entrega individualmente.
 */
export function agentCompleted(notification: GroupedNotification): void {
	// Buscar el grupo del agente.
	for (const [turnId, group] of groups) {
		if (!group.agentIds.has(notification.agentId)) continue;

		group.completed.push(notification);

		// Si es el primero en completar y hay más de 1, arrancar timer.
		if (!group.timer && group.agentIds.size > 1) {
			group.timer = setTimeout(() => {
				deliverGroup(turnId);
			}, GROUP_TIMEOUT_MS);
		}

		// Si todos completaron, entregar inmediatamente.
		if (group.completed.length >= group.agentIds.size) {
			if (group.timer) clearTimeout(group.timer);
			deliverGroup(turnId);
		}
		return;
	}

	// No está en ningún grupo → entregar individualmente (async u orphan).
	const cb = agentCallbacks.get(notification.agentId);
	if (cb) {
		cb([notification]);
		agentCallbacks.delete(notification.agentId);
	}
}

/** Entrega la notificación agrupada y limpia el grupo. */
function deliverGroup(turnId: string): void {
	const group = groups.get(turnId);
	if (!group) return;
	groups.delete(turnId);
	group.deliver(group.completed);
}

/**
 * Obtiene el join mode desde settings (default: smart).
 */
export function getDefaultJoinMode(): JoinMode {
	return "smart";
}

/** Sólo tests: limpia todos los grupos. */
export function _resetGroupJoin(): void {
	for (const [, group] of groups) {
		if (group.timer) clearTimeout(group.timer);
	}
	groups.clear();
	agentCallbacks.clear();
	currentTurnId = undefined;
}
