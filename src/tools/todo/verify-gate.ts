// frida-todo R1 (#66) — verify gate determinista ("Done when").
//
// Inspirado en el verify-work gate de @mjasnikovs/pi-task: una tarea con
// `verify` (comando shell que codifica su contrato de terminación) NO puede
// marcarse completed si el comando falla. Ataca las "completadas mentirosas":
// la verificación es determinista (child_process), sin juicio del modelo.
// FAIL → la tarea queda abierta y el tool devuelve la salida cruda para que
// el modelo arregle el problema real; force:true es el escape hatch explícito
// (paridad con el "Accept" de pi-task) para un verify mal escrito.

import { exec } from "node:child_process";
import type { Task, TaskAction, TaskMutationParams } from "./types";

export interface VerifyResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

/**
 * ¿Esta mutación es un completamiento gated? Sólo `update` → status completed
 * sobre una tarea con `verify`, sin `force`. Todo lo demás corre normal.
 */
export function isGatedCompletion(
	action: TaskAction,
	params: TaskMutationParams,
	task: Task | undefined,
): boolean {
	if (action !== "update") return false;
	if (params.status !== "completed") return false;
	if (!task?.verify) return false;
	if (params.force === true) return false;
	return true;
}

/** Tail de la salida combinada: últimas `maxLines` líneas con indicador. */
function tail(text: string, maxLines: number): string {
	const trimmed = text.trimEnd();
	const lines = trimmed.split("\n");
	if (lines.length <= maxLines) return trimmed;
	return `[…${lines.length - maxLines} líneas antes]\n${lines.slice(-maxLines).join("\n")}`;
}

/** Mensaje accionable del FAIL: comando, razón, salida cruda y dos salidas. */
export function verifyFailText(task: Task, result: VerifyResult): string {
	const reason = result.timedOut
		? `timeout (el comando no terminó)`
		: `exit ${result.exitCode}`;
	const combined = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	const salida = combined ? tail(combined, 30) : "(sin salida)";
	return [
		`No se puede completar #${task.id} «${task.subject}»: su contrato verify falló (${reason}).`,
		`$ ${task.verify}`,
		`--- salida ---`,
		salida,
		`--------------`,
		`Arregla el problema que muestra la salida y vuelve a intentar completarla.`,
		`Si el comando verify está mal escrito o no aplica en este entorno, ciérrala con update { id, status: "completed", force: true }.`,
	].join("\n");
}

/**
 * Ejecuta el contrato verify de forma determinista (sin LLM). timeout mata el
 * proceso (SIGTERM de exec) y se reporta como timedOut, no como exit code.
 */
export async function runVerifyCommand(
	command: string,
	cwd: string,
	opts?: { timeoutMs?: number },
): Promise<VerifyResult> {
	const timeoutMs = opts?.timeoutMs ?? 120_000;
	return new Promise<VerifyResult>((resolve) => {
			exec(
				command,
				{ cwd, timeout: timeoutMs, maxBuffer: 1 << 20 },
				(error, stdout, stderr) => {
					const err = error as
						| (NodeJS.ErrnoException & {
								killed?: boolean;
							code?: string | number;
					  })
						| undefined;
					const timedOut = err?.killed === true;
					let exitCode: number | null = null;
					if (typeof err?.code === "number") exitCode = err.code;
					else if (!err) exitCode = 0;
					resolve({ exitCode, stdout, stderr, timedOut });
				},
			);
	});
}
