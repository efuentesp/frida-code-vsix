// frida-workflow — puente lifecycle → store → WorkflowPanel (Fase 5).
//
// EXTENSION-side (no va al bundle DSL dist/frida-workflow.js): importa React vía
// WorkflowPanel.tsx. El host (extension.ts) lo cablea una vez con la webBridge de
// la sesión: registra un lifecycle listener que muta el store reactivo, y monta
// el panel persistente en el footer. El runner dispara eventos (fire) → listener
// → store → el panel se re-renderiza solo (useSyncExternalStore).

import type { ReactElement } from "react";
import { registerLifecycle, type LifecycleListeners } from "./lifecycle";
import { createWorkflowPanelElement } from "./WorkflowPanel";
import { appendPhaseProgress, extractPhaseId } from "./plan-utils";
import {
	endRun,
	getWorkflowRuns,
	stageEnd,
	stageError,
	stageRetry,
	stageStart,
	startRun,
	unitEnd,
	unitStart,
} from "./store";

/** Slice del WebBridge que el panel necesita (structural — no importa el SDK). */
export interface WorkflowWebBridge {
	mountPersistent: (
		factory: () => ReactElement,
		placement?: "overlay" | "footer",
	) => { unmount: () => void };
}

/** Listener que traduce eventos de lifecycle a mutaciones del store. */
export function createWorkflowLifecycle(): LifecycleListeners {
	return {
		onWorkflowStart: (ctx) => startRun(ctx),
		onStageStart: (stage, ctx) => stageStart(stage, ctx),
		onStageEnd: (stage, output, ctx) => stageEnd(stage, output, ctx),
		onStageRetry: (stage, attempt, ctx) => stageRetry(stage, attempt, ctx),
		onStageError: (stage, error, ctx) => stageError(stage, error, ctx),
		onLoopStart: () => {},
		onUnitStart: (stage, unit, ctx) => unitStart(stage, unit, ctx),
		onUnitEnd: (stage, unit, output, ctx) => unitEnd(stage, unit, output, ctx),
		onLoopCap: () => {},
		// onRoute: el panel no muestra routes explícitamente (la próxima stageStart
		// refleja el avance); se deja vacío a propósito.
		onWorkflowEnd: (result, ctx) => {
			// #158 — Registrar progreso ANTES de endRun: la fase del run queda en el
			// archivo de progreso y el re-render de la tarjeta ya sugiere el primer
			// hueco real. Sólo runs con etapa commit completada cuentan como avance.
			if (result.success) {
				const run = getWorkflowRuns().runs.find((r) => r.runId === ctx.runId);
				const committed = run?.stages.some(
					(s) => s.name === "commit" && s.status === "completed",
				);
				if (run && committed && ctx.input) {
					const extracted = extractPhaseId(ctx.input);
					if (extracted?.phaseId) {
						try {
							appendPhaseProgress(
								ctx.cwd,
								extracted.planPathToken,
								extracted.phaseId,
								ctx.runId,
								new Date().toISOString(),
							);
						} catch {
							/* best-effort: sin archivo, la tarjeta degrada a fase siguiente */
						}
					}
				}
			}
			endRun(result, ctx);
		},
	};
}

let panelMounted: { unmount: () => void } | undefined;

/** Monta el panel persistente en el footer (idempotente). */
export function mountWorkflowPanel(webBridge: WorkflowWebBridge): {
	unmount: () => void;
} {
	if (panelMounted) return panelMounted;
	panelMounted = webBridge.mountPersistent(
		createWorkflowPanelElement,
		"footer",
	);
	return panelMounted;
}

/** Sólo tests. */
export function _resetWorkflowPanel(): void {
	panelMounted = undefined;
}

let wired = false;

/** Cableja todo una vez: registra el lifecycle listener + monta el panel. */
export function wireWorkflowPanel(webBridge: WorkflowWebBridge): void {
	if (wired) return;
	wired = true;
	registerLifecycle(createWorkflowLifecycle());
	mountWorkflowPanel(webBridge);
}
