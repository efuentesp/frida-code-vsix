// frida-subagents — contrato del panel /detached para el webview (issue #26).
//
// Patrón de frida-cc-plugins/panel.ts y frida-sandboxes/panel.ts: el panel es
// un snapshot serializable que la extensión emite al webview vía sink. El host
// (extension.ts) posee el refresh cíclico mientras el panel está abierto.

import { listMetas, type DetachedRunMeta } from "./detached-registry";
import { readProgress } from "./detached-log";
import { processExists } from "./detached-spawn";

/** Una fila del panel: meta durable + progreso en vivo (si corre). */
export interface DetachedRunView {
	id: string;
	name: string;
	agentType: string;
	model?: string;
	status: DetachedRunMeta["status"];
	startedAt: number;
	endedAt?: number;
	/** Progreso en vivo (sólo corriendo). */
	turnCount: number;
	toolUses: number;
	tokensIn: number;
	tokensOut: number;
	activity: string;
	/** Resultado (terminados) o último texto parcial (corriendo). */
	text: string;
	/** Prompt completo (auditoría). */
	promptPreview: string;
	failureReason?: string;
}

export interface DetachedPanelData {
	kind: "detached_panel";
	runs: DetachedRunView[];
}

/** Construye el snapshot del panel desde el registry + logs. */
export function buildDetachedPanel(): DetachedPanelData {
	const runs: DetachedRunView[] = [];
	for (const meta of listMetas()) {
		const running =
			meta.status === "running" || meta.status === "orphaned";
		let turnCount = 0;
		let toolUses = 0;
		let tokensIn = meta.tokensIn ?? 0;
		let tokensOut = meta.tokensOut ?? 0;
		let activity: string = meta.status;
		let text = meta.result ?? "";
		if (running && processExists(meta.pid)) {
			const p = readProgress(meta.logPath);
			turnCount = p.turnCount;
			toolUses = p.toolUses;
			tokensIn = p.tokensIn;
			tokensOut = p.tokensOut;
			activity = p.activity;
			text = p.lastText;
		}
		runs.push({
			id: meta.id,
			name: meta.name ?? meta.id,
			agentType: meta.agentType,
			model: meta.model,
			status: meta.status,
			startedAt: meta.startedAt,
			endedAt: meta.endedAt,
			turnCount,
			toolUses,
			tokensIn,
			tokensOut,
			activity,
			text,
			promptPreview: meta.promptPreview,
			failureReason: meta.failureReason,
		});
	}
	return { kind: "detached_panel", runs };
}

/** ¿Este run sigue vivo (muestra Detener)? */
export function runIsStoppable(run: DetachedRunView): boolean {
	return run.status === "running" || run.status === "orphaned";
}

// ---------------------------------------------------------------------------
// Feed del widget footer (#26): los runs detached (viven en el registry
// durable, NO en agent-manager) se reflejan en agentWidgetStore con badge 🛰,
// igual que los background in-process. Poll barato: lista metas + tail corto.
// ---------------------------------------------------------------------------

import { agentWidgetStore, type AgentWidgetStatus } from "./store";

/** Mapeo estado durable → estado del widget (sin ternarias anidadas). */
function terminalWidgetStatus(meta: DetachedRunMeta): AgentWidgetStatus {
	if (meta.status === "completed") return "completed";
	if (meta.status === "killed") return "stopped";
	return "error";
}

/** Sincroniza una pasada del registry → widget store (idempotente). */
export function syncDetachedToWidget(): void {
	for (const meta of listMetas()) {
		const alive =
			(meta.status === "running" || meta.status === "orphaned") &&
			processExists(meta.pid);
		if (alive) {
			const p = readProgress(meta.logPath);
			agentWidgetStore.agentStarted({
				id: meta.id,
				type: meta.agentType,
				description: `🛰 ${meta.name ?? meta.id}`,
				status: "running",
				startedAt: meta.startedAt,
			});
			agentWidgetStore.agentProgress(meta.id, {
				turnCount: p.turnCount,
				toolUses: p.toolUses,
				tokens: p.tokensIn + p.tokensOut,
				activity: p.activity,
			});
		} else if (meta.status !== "running" && meta.status !== "orphaned") {
			// Terminado: reflejar estado terminal una vez (pruneCompleted lo saca).
			const status = terminalWidgetStatus(meta);
			agentWidgetStore.agentStarted({
				id: meta.id,
				type: meta.agentType,
				description: `🛰 ${meta.name ?? meta.id}`,
				status,
				startedAt: meta.startedAt,
				completedAt: meta.endedAt,
			});
			agentWidgetStore.agentUpdated(meta.id, status);
		}
	}
}

let feedTimer: ReturnType<typeof setInterval> | undefined;

/** Arranca el feed cíclico del widget (idempotente). */
export function startDetachedWidgetFeed(): void {
	if (feedTimer) return;
	syncDetachedToWidget();
	feedTimer = setInterval(syncDetachedToWidget, 3_000);
	feedTimer.unref?.();
}

export function stopDetachedWidgetFeed(): void {
	if (feedTimer) {
		clearInterval(feedTimer);
		feedTimer = undefined;
	}
}

/** Sólo tests. */
export function _resetDetachedWidgetFeed(): void {
	stopDetachedWidgetFeed();
	agentWidgetStore._reset();
}
