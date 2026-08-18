// frida-todo (#66) — nudge de conciliación contra la realidad.
//
// Problema: el modelo completa trabajo sin marcar las tareas `completed`; el
// panel acumula stale pendientes que nunca se cierran (heredado de rpiv-todo —
// el contrato era sólo textual). Este módulo es la pieza PURA de dos mitigadores:
//
//   1. Nudge automático (agent_end): si el turno cierra con tareas
//      pending/in_progress que NO fueron tocadas en TODO el turno, se pide al
//      agente (follow-up) conciliar su lista (completed/delete/create).
//   2. Botón "↻" del panel (manual): mismo prompt de conciliación + replay
//      desde la rama (red de seguridad store↔rama).
//
// Máquina anti-loop: el follow-up del nudge DISPARA un turno nuevo; ese turno
// no puede volver a nudgear (si el modelo lo ignoró, el próximo turno NORMAL
// sí). willRetry (turno fallido con auto-retry pendiente, ver #61) tampoco
// nudgea — el retry cierra el turno.

import type { TaskState } from "../todo/state-reducer";
import type { Task } from "../todo/types";

/** Tareas stale: pending/in_progress sin mutación en el turno actual. */
export function staleTasks(
	state: TaskState,
	touched: ReadonlySet<number>,
): Task[] {
	return state.tasks.filter(
		(t) =>
			(t.status === "pending" || t.status === "in_progress") &&
			!touched.has(t.id),
	);
}

/** Prompt de conciliación: `source` distingue botón manual vs nudge automático. */
export function conciliationPrompt(
	stale: readonly Task[],
	source: "auto" | "manual",
): string {
	const lista = stale.map((t) => `- #${t.id} [${t.status}] ${t.subject}`).join("\n");
	const origen =
		source === "manual"
			? "El usuario pidió re-sincronizar el panel de todos (botón ↻)."
			: "Este turno terminó con tareas que no fueron tocadas.";
	return (
		`${origen}\n` +
		`Audita tu lista de todos contra lo realmente hecho y concíliala AHORA con el tool \`todo\`:\n` +
		`- marca \`completed\` lo que ya terminaste (nunca dejes trabajo hecho como pendiente),\n` +
		`- \`delete\` (tombstone) lo obsoleto/irrelevante,\n` +
		`- \`create\` lo pendiente que falte,\n` +
		`- y deja exactamente UNA tarea \`in_progress\` si continúa trabajo.\n` +
		`Tareas al cierre del turno:\n${lista}\n` +
		`Responde sólo con las mutaciones hechas (sin resumen largo).`
	);
}

export interface NudgeDecision {
	send: boolean;
	prompt: string;
}

export interface NudgeTracker {
	/** Nuevo turno: resetea tocadas y resuelve el flag del turno-nudge. */
	onAgentStart(): void;
	/** El tool `todo` mutó la tarea `taskId` en este turno. */
	onMutation(taskId: number): void;
	/** Cierra de turno: decide si nudgear. null = no hay nada que pedir. */
	onAgentEnd(state: TaskState, willRetry: boolean): NudgeDecision | null;
	/** El wiring envió el follow-up (el próximo agent_start es el turno-nudge). */
	onNudgeSent(): void;
}

export function createNudgeTracker(): NudgeTracker {
	let nudgeInFlight = false;
	let thisTurnIsNudge = false;
	const touched = new Set<number>();
	return {
		onAgentStart() {
			thisTurnIsNudge = nudgeInFlight;
			nudgeInFlight = false;
			touched.clear();
		},
		onMutation(taskId: number) {
			touched.add(taskId);
		},
		onAgentEnd(state: TaskState, willRetry: boolean): NudgeDecision | null {
			// Anti-loop: el turno que dispara el propio nudge nunca re-nudgea.
			if (thisTurnIsNudge) return null;
			// Turno fallido con auto-retry pendiente: el retry cierra el turno.
			if (willRetry) return null;
			const stale = staleTasks(state, touched);
			if (stale.length === 0) return null;
			return { send: true, prompt: conciliationPrompt(stale, "auto") };
		},
		onNudgeSent() {
			nudgeInFlight = true;
		},
	};
}
