// frida-subagents — store reactivo para el widget de agentes.
//
// Patrón de frida-pipeline/banner.tsx: store simple con subscribe/getSnapshot
// para useSyncExternalStore. El agent-manager llama a las funciones de update
// cuando los agentes cambian de estado.

export type AgentWidgetStatus =
	| "running"
	| "queued"
	| "completed"
	| "error"
	| "stopped"
	| "steered"
	| "aborted";

export interface AgentDisplay {
	id: string;
	type: string;
	description: string;
	status: AgentWidgetStatus;
	startedAt: number;
	completedAt?: number;
	/** Progreso en vivo (D1+D2): desde el activity-tracker de la sesión hija. */
	toolUses?: number;
	tokens?: number;
	turnCount?: number;
	maxTurns?: number;
	/** Resumen de una línea: "reading 3 files…", "thinking…". */
	activity?: string;
}

/** Patch de progreso en vivo para `agentWidgetStore.agentProgress`. */
export interface AgentProgressPatch {
	toolUses?: number;
	tokens?: number;
	turnCount?: number;
	maxTurns?: number;
	activity?: string;
}

let agents: AgentDisplay[] = [];
const listeners = new Set<() => void>();
/** Listener del host: replica el snapshot al webview (conteo de subagentes en
 *  background para el indicador "N en curso"). El host lo registra al iniciar la
 *  sesión. */
let onUpdate: ((snapshot: AgentDisplay[]) => void) | undefined;

/** Registra el callback que el host usa para postear el conteo al webview. */
export function setAgentWidgetListener(
	cb: ((snapshot: AgentDisplay[]) => void) | undefined,
): void {
	onUpdate = cb;
}

function emit(): void {
	for (const l of listeners) l();
	onUpdate?.(agents);
}

export const agentWidgetStore = {
	subscribe(l: () => void): () => void {
		listeners.add(l);
		return () => listeners.delete(l);
	},
	getSnapshot(): AgentDisplay[] {
		return agents;
	},

	/** Un agente empezó a correr. */
	agentStarted(display: AgentDisplay): void {
		agents = [...agents, display];
		emit();
	},

	/** Un agente cambió de estado. */
	agentUpdated(id: string, status: AgentWidgetStatus): void {
		agents = agents.map((a) =>
			a.id === id
				? {
						...a,
						status,
						completedAt:
							status === "completed" ||
							status === "error" ||
							status === "stopped" ||
							status === "aborted"
								? Date.now()
								: a.completedAt,
					}
				: a,
		);
		emit();
	},

	/** Progreso en vivo de un agente (activity/stats desde el activity-tracker). */
	agentProgress(id: string, patch: AgentProgressPatch): void {
		agents = agents.map((a) => (a.id === id ? { ...a, ...patch } : a));
		emit();
	},

	/** Elimina agentes completados hace más de `maxAgeMs`. */
	pruneCompleted(maxAgeMs = 10_000): void {
		const now = Date.now();
		const before = agents.length;
		agents = agents.filter((a) => {
			if (!a.completedAt) return true; // todavía corriendo
			return now - a.completedAt < maxAgeMs;
		});
		if (agents.length !== before) emit();
	},

	/** Sólo tests. */
	_reset(): void {
		agents = [];
		listeners.clear();
	},
};

/** Auto-prune cada 5 segundos (para limpiar agentes completados). */
let pruneTimer: ReturnType<typeof setInterval> | undefined;

export function startAutoPrune(): void {
	if (pruneTimer) return;
	pruneTimer = setInterval(() => agentWidgetStore.pruneCompleted(), 5_000);
}

export function stopAutoPrune(): void {
	if (pruneTimer) {
		clearInterval(pruneTimer);
		pruneTimer = undefined;
	}
}
