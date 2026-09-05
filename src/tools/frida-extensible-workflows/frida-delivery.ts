// frida-extensible-workflows — entrega y progreso (Fase 4).
//
// Reemplaza la capa TUI/herdr del original (ADR-0028 D4) por los mecanismos del
// extension host de VS Code:
//   - deliverFollowUp: entrega un resultado diferido como mensaje follow-up que
//     re-dispara el turno del agente (pi.sendMessage, mismo mecanismo que el
//     original y que frida-pipeline/frida-git-sync usan en Frida).
//   - emitWorkflowEvent: emite progreso al bus pi.events (lo consume el webview
//     en Fase 7; por ahora queda disponible para depuración/observabilidad).
//   - Registro de runs background (por factory/sesión) para que workflow_stop
//     pueda cancelarlas por runId.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "./core/types";
import { getWorkflowRuns, upsertWorkflowRun } from "./store";

export const WORKFLOW_MSG_TYPE = "workflow";

/** Forma defensiva del bus de eventos de Pi (opcional en algunos runtimes). */
type EventBus = { emit?: (name: string, payload: unknown) => unknown };

/**
 * Entrega `content` como mensaje follow-up que re-dispara el turno del agente.
 * Usado por las runs en background al completar: el agente padre recibe el
 * resultado y puede continuar. No-op si el runtime no expone sendMessage.
 */
export function deliverFollowUp(pi: ExtensionAPI, content: string): void {
	// SAFETY: el SDK no tipa sendMessage en ExtensionAPI (existe en runtime);
	// el cast estructural sólo declara la firma conocida y se valida con typeof.
	const send = (
		pi as unknown as {
			sendMessage?: (
				message: { customType: string; content: string; display: boolean },
				options: { deliverAs: "followUp"; triggerTurn: boolean },
			) => void;
		}
	).sendMessage;
	if (typeof send !== "function") return;
	try {
		send(
			{ customType: WORKFLOW_MSG_TYPE, content, display: true },
			{ deliverAs: "followUp", triggerTurn: true },
		);
	} catch {
		/* Best-effort: si la sesión que lanzó la run ya no existe (newSession/
		 * switchSession/reload), el follow-up no tiene destino. La run YA
		 * completó — no debe marcarse failed por una entrega imposible. El
		 * resultado persiste en el RunStore y el panel/store lo refleja. */
	}
}

/**
 * Emite un evento de progreso al bus de Pi. Los nombres siguen a pi-extensible-
 * workflows (workflow:run-started, workflow:agent-state-changed, etc.) para que
 * el panel webview (Fase 7) pueda suscribirse con la misma convención.
 */
export function emitWorkflowEvent(
	pi: ExtensionAPI,
	name: string,
	payload: JsonValue,
): void {
	try {
		// SAFETY: el bus de eventos es opcional según el runtime (algunos hosts
		// no lo exponen); el cast declara la forma defensiva y todo va con ?.
		const events = (pi as unknown as { events?: EventBus }).events;
		events?.emit?.(name, payload);
	} catch {
		/* el bus es opcional; un evento no debe romper la run */
	}
}

// --- Registro de runs background (para workflow_stop) ---------------------

export interface BackgroundRun {
	controller: AbortController;
	workflowName: string;
	sessionId: string;
	cwd: string;
}

const backgroundRuns = new Map<string, BackgroundRun>();

export function registerBackgroundRun(runId: string, run: BackgroundRun): void {
	backgroundRuns.set(runId, run);
}

export function getBackgroundRun(runId: string): BackgroundRun | undefined {
	return backgroundRuns.get(runId);
}

export function unregisterBackgroundRun(runId: string): void {
	backgroundRuns.delete(runId);
}

export function listBackgroundRunIds(): string[] {
	return [...backgroundRuns.keys()];
}

/** Cancela una run en background activa por su runId desde la UI (#85). */
export function stopWorkflowRun(runId: string): boolean {
	const run = getBackgroundRun(runId);
	if (!run) return false;
	run.controller.abort();
	return true;
}

/** Sólo tests. */
export function _resetBackgroundRuns(): void {
	backgroundRuns.clear();
}

// --- Checkpoints pendientes (live runs) para workflow_respond (Fase 5) ---

interface PendingCheckpoint {
	resolve: (approved: boolean) => void;
	reject: (error: unknown) => void;
}
const pendingCheckpoints = new Map<string, PendingCheckpoint>();

function checkpointKey(runId: string, name: string): string {
	return `${runId}\0${name}`;
}

export function registerCheckpoint(
	runId: string,
	name: string,
	pc: PendingCheckpoint,
): void {
	pendingCheckpoints.set(checkpointKey(runId, name), pc);
}

export function unregisterCheckpoint(runId: string, name: string): void {
	pendingCheckpoints.delete(checkpointKey(runId, name));
}

/** Resuelve un checkpoint en vivo. Devuelve true si había uno pendiente. */
export function resolveCheckpoint(
	runId: string,
	name: string,
	approved: boolean,
): boolean {
	const pc = pendingCheckpoints.get(checkpointKey(runId, name));
	if (!pc) return false;
	pendingCheckpoints.delete(checkpointKey(runId, name));
	pc.resolve(approved);
	return true;
}

/** ¿Hay un checkpoint pendiente para esta run+name? (para la descripción del tool) */
export function hasPendingCheckpoint(runId: string, name: string): boolean {
	return pendingCheckpoints.has(checkpointKey(runId, name));
}

/**
 * Resuelve un checkpoint desde la UI (botones del panel #64) o desde el chat
 * (workflow_respond): resuelve el checkpoint en vivo y, si había run
 * registrada en el panel, la transiciona awaiting → running (upsert
 * optimista — el workflow reanuda su ejecución). false = no había pendiente
 * (no toca el store). Unifica ambos caminos para que el panel nunca quede
 * clavado en "awaiting" tras decidir por chat.
 */
export function resolveCheckpointFromUi(
	runId: string,
	name: string,
	approved: boolean,
): boolean {
	const resolved = resolveCheckpoint(runId, name, approved);
	if (!resolved) return false;
	const run = getWorkflowRuns().find((r) => r.runId === runId);
	if (run) {
		upsertWorkflowRun({
			runId,
			workflowName: run.workflowName,
			state: "running",
			checkpointName: undefined,
		});
	}
	return true;
}

/** Sólo tests. */
export function _resetPendingCheckpoints(): void {
	pendingCheckpoints.clear();
}
