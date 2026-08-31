// #161 — Superficie frida.board.* del extensionApi.
//
// Nivel 3 de adopción multi-extensión: las extensiones del agente (cargadas
// vía jiti, p. ej. ~/.frida/extensions/*.ts) importan { frida } del SDK
// passthrough y operan el board programáticamente. Los skills bash siguen
// en el nivel 1 (FS como API: .frida/artifacts/board/<slug>.json).
//
// CONTRATO (multi-escritor):
// - Append-only: transition() AÑADE una transición; nunca edita ni borra
//   historia previa. El status de la unidad es derivado (última transición).
// - Versionado: el JSON lleva `v` (Board.v); escritores viejos que no lo
//   conocen lo ven como 1 (loadBoard lo normaliza).
// - `source` identifica al escritor (obligatorio por higiene; los runs del
//   workflow usan "frida-workflow" + runId propio).
// - Escritura atómica (tmp+rename, #159): lectores jamás ven archivos a
//   medias.
import { applyStageTransition, firstRealGap, loadBoard, saveBoard } from "./board";
import type { Board } from "./board";

export interface BoardTransitionInput {
	stage: string;
	/** Para validate: verdict del output. false = FAIL (zigzag); undefined =
	 * inicio de etapa (avanza temprano, #172). */
	passed?: boolean;
	/** Escritor (p. ej. "my-extension"). Se usa también como runId. */
	source?: string;
}

/** Handler host-side para montar el overlay /board (inyectado en activate). */
let showHandler: (() => void) | undefined;

export function setBoardShowHandler(fn: (() => void) | undefined): void {
	showHandler = fn;
}

/**
 * Abre el board de un plan. `planPath` es la ruta del plan relativa al cwd
 * del proyecto (token del slug del board). Devuelve null si no existe aún.
 */
function open(planPath: string, opts?: { cwd?: string }): Board | null {
	return loadBoard(opts?.cwd ?? process.cwd(), planPath);
}

/** Añade una transición a la unidad (append-only) y persiste atómicamente.
 *  Crea la unidad on-demand si no existe (id canónico de fase). */
function transition(
	planPath: string,
	unitId: string,
	input: BoardTransitionInput,
	opts?: { cwd?: string },
): boolean {
	const cwd = opts?.cwd ?? process.cwd();
	const board = loadBoard(cwd, planPath);
	if (!board) return false;
	applyStageTransition(board, unitId, {
		stage: input.stage,
		runId: input.source ?? "frida.board",
		ts: new Date().toISOString(),
		passed: input.passed,
		source: input.source,
	});
	saveBoard(cwd, planPath, board);
	return true;
}

/** Primer hueco real (gap) del board: la siguiente unidad ejecutable. */
function gap(planPath: string, opts?: { cwd?: string }): string | undefined {
	const board = loadBoard(opts?.cwd ?? process.cwd(), planPath);
	const g = board ? firstRealGap(board) : undefined;
	return g?.id;
}

/** Monta el overlay /board en el host (si hay sesión activa). */
function show(): void {
	showHandler?.();
}

export const frida = {
	board: { open, transition, show, gap },
};
export type { Board };
