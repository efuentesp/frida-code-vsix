// frida-workflow — puente lifecycle → store → WorkflowPanel (Fase 5).
//
// EXTENSION-side (no va al bundle DSL dist/frida-workflow.js): importa React vía
// WorkflowPanel.tsx. El host (extension.ts) lo cablea una vez con la webBridge de
// la sesión: registra un lifecycle listener que muta el store reactivo, y monta
// el panel persistente en el footer. El runner dispara eventos (fire) → listener
// → store → el panel se re-renderiza solo (useSyncExternalStore).

import type { ReactElement } from "react";
import { existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
	registerLifecycle,
	type LifecycleListeners,
	type StageOutput,
	type StageRef,
} from "./lifecycle";
import { createWorkflowPanelElement } from "./WorkflowPanel";
import { extractPhaseId, normalizePhaseId } from "./plan-utils";
import {
	applyStageTransition,
	openBoard,
	resolveBoardSpec,
	resolveStageKind,
	saveBoard,
	type BoardArtifactLink,
} from "./board";
import { appendPhaseProgress } from "./plan-utils";
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

/** #159/#160 — Transición de board en runtime: cada stage completado mueve la
 *  fase del run a su columna (validate sólo con passed). El spec llega por
 *  setBoardSpecResolver (config declarativa) y el artifactKind por contrato. */
/** #163 — Vínculo de elaboración: acts() no reporta primaryHandle; el archivo
 *  vive en .frida/artifacts/elaborations/ con la fase en el nombre. */
function findElaborationArtifact(
	cwd: string,
	phaseId: string,
): BoardArtifactLink[] {
	try {
		const dir = join(cwd, ".frida", "artifacts", "elaborations");
		if (!existsSync(dir)) return [];
		const key = normalizePhaseId(phaseId);
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".md") && normalizePhaseId(f).includes(key))
			.map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
			.sort((a, b) => b.m - a.m);
		return files[0] ? [{ kind: "elaboration", path: join(dir, files[0].f) }] : [];
	} catch {
		return [];
	}
}

/** #163 — Sha corto del HEAD (link del commit en la tarjeta). */
function gitShortSha(cwd: string): string | undefined {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd,
			encoding: "utf8",
		}).trim();
	} catch {
		return undefined;
	}
}

function applyRuntimeBoardTransition(
	stage: StageRef,
	output: StageOutput | undefined,
	ctx: { runId: string; workflow: string; input: string; cwd: string },
): void {
	const extracted = extractPhaseId(ctx.input);
	if (!extracted?.phaseId) return;
	try {
		// #164 — SIN planContent en runtime: re-sincronizar el plan en cada etapa
		// colaba unidades duplicadas cuando el "plan" tiene headers agrupados
		// (p. ej. el roadmap maestro: ## F0..## F6–F8 vs filas F01–F17). El sync de
		// unidades (y splits) ocurre en /board y en el bootstrap, no aquí.
		const spec = resolveBoardSpec(ctx.workflow);
		const board = openBoard(ctx.cwd, extracted.planPathToken, undefined, spec);
		board.workflow = ctx.workflow; // #163 — la UI arma /wf <workflow> desde el tablero
		let artifacts: BoardArtifactLink[] = [];
		if (output?.primaryHandle) {
			artifacts = [
				{
					kind: resolveStageKind(stage.name, spec) ?? stage.name,
					path: output.primaryHandle,
				},
			];
		} else if (stage.name === "elaborate") {
			artifacts = findElaborationArtifact(ctx.cwd, extracted.phaseId);
		}
		if (stage.name === "commit") {
			const sha = gitShortSha(ctx.cwd);
			if (sha) artifacts.push({ kind: "git-commit", path: "", label: sha });
		}
		applyStageTransition(board, extracted.phaseId, {
			stage: stage.name,
			runId: ctx.runId,
			ts: new Date().toISOString(),
			artifacts: artifacts.length ? artifacts : undefined,
			passed: (output?.data as { passed?: boolean } | undefined)?.passed,
			spec,
			source: ctx.workflow, // #161 — trazabilidad multi-escritor
		});
		saveBoard(ctx.cwd, extracted.planPathToken, board);
	} catch {
		/* best-effort: sin board, la tarjeta degrada a la escalera de plan-utils */
	}
}

/** Listener que traduce eventos de lifecycle a mutaciones del store. */
export function createWorkflowLifecycle(): LifecycleListeners {
	return {
		onWorkflowStart: (ctx) => startRun(ctx),
		onStageStart: (stage, ctx) => stageStart(stage, ctx),
		onStageEnd: (stage, output, ctx) => {
			stageEnd(stage, output, ctx); // store primero: la UI viva no espera al board
			applyRuntimeBoardTransition(stage, output, ctx);
		},
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
	panelMounted = webBridge.mountPersistent(createWorkflowPanelElement, "footer");
	return panelMounted;
}

/** #165 — La webview se (re)montó: el mount del footer se PIERDE cuando VS Code
 *  recrea/deshidrata la webview del chat. Re-montar el panel sin re-registrar
 *  el lifecycle (el store conserva los runs; el panel simplemente reaparece). */
export function remountWorkflowPanel(webBridge: WorkflowWebBridge): void {
	panelMounted?.unmount();
	panelMounted = undefined;
	mountWorkflowPanel(webBridge);
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
