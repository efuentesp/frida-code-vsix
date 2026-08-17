// frida-goal — persistencia thread-owned vía appendEntry del SDK.
//
// Igual que el upstream: el estado del goal vive como entrada custom al final
// de la rama de la sesión (`goal-state`), por lo que sobrevive reload,
// compaction (la entrada viaja en el árbol) y cambia con el árbol al navegar
// forks. No usamos archivo aparte: la fuente de verdad es la sesión.

import {
	normalizeLoadedGoal,
	type ActiveGoal,
} from "./state.js";

export const GOAL_STATE_ENTRY_TYPE = "frida-goal-state";

interface SessionEntry {
	type?: string;
	customType?: string;
	data?: unknown;
}

interface SessionContextLike {
	sessionManager?: {
		getBranch?: () => SessionEntry[];
		getEntries?: () => SessionEntry[];
	};
}

export interface GoalStateEntryData {
	goal: ActiveGoal | null;
}

export function serializeGoalState(goal: ActiveGoal | undefined): GoalStateEntryData {
	return { goal: goal ?? null };
}

/**
 * Carga el estado del goal desde la rama actual de la sesión (última entrada
 * `frida-goal-state`). Devuelve undefined si no hay goal, es inválido o es
 * `complete` (terminal: no se restaura).
 */
export function loadGoalFromSession(ctx: SessionContextLike): ActiveGoal | undefined {
	const entries =
		ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? [];
	const last = entries
		.filter(
			(entry) =>
				entry.type === "custom" && entry.customType === GOAL_STATE_ENTRY_TYPE,
		)
		.pop();
	if (!last || typeof last.data !== "object" || last.data === null) return undefined;
	const raw = (last.data as GoalStateEntryData).goal;
	return normalizeLoadedGoal(raw);
}
