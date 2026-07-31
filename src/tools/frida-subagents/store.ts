// frida-subagents — store reactivo para el widget de agentes.
//
// Patrón de frida-pipeline/banner.tsx: store simple con subscribe/getSnapshot
// para useSyncExternalStore. El agent-manager llama a las funciones de update
// cuando los agentes cambian de estado.

export interface AgentDisplay {
	id: string;
	type: string;
	description: string;
	status:
		| "running"
		| "queued"
		| "completed"
		| "error"
		| "stopped"
		| "steered"
		| "aborted";
	startedAt: number;
	completedAt?: number;
}

let agents: AgentDisplay[] = [];
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of listeners) l();
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
	agentUpdated(id: string, status: AgentDisplay["status"]): void {
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
