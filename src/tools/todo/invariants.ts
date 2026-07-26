// Transiciones de estado permitidas. Porte (MIT) de rpiv-todo `state/invariants.ts`.
//
// `completed` es unidireccional a `deleted` (nunca vuelve a `in_progress`);
// `deleted` es terminal. La transición idéntica (mismo→mismo) se trata como
// válida y se comprueba aparte para que la tabla solo enumere transiciones reales.

import type { TaskStatus } from "./types";

export const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
	pending: new Set(["in_progress", "completed", "deleted"]),
	in_progress: new Set(["pending", "completed", "deleted"]),
	completed: new Set(["deleted"]),
	deleted: new Set(),
};

export function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean {
	if (from === to) return true;
	return VALID_TRANSITIONS[from].has(to);
}
