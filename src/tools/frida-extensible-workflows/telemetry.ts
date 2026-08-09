// Telemetría de diagnóstico del panel de frida-extensible-workflows (issue #7).
//
// PROBLEMA: al lanzar un workflow en background, el panel de progreso del footer
// no aparece, aunque el workflow sí corre y Frida entrega resultados al terminar
// pasos (es decir, el monitoreo funciona por otro canal). Hipótesis principal:
// el tool `workflow` (handler en index.ts) corre en el proceso del runner/SDK y
// muta la instancia de `store.ts` de ESE proceso, mientras que el WorkflowPanel
// se monta en el proceso del HOST (extensión) y lee OTRA instancia del store
// (singleton de módulo → una por proceso). Como no comparten memoria, el panel
// nunca ve los runs.
//
// Esta telemetría escribe una línea JSON por evento a
// ~/.frida/logs/workflow-panel.log incluyendo SIEMPRE `pid`/`ppid`, de modo que
// comparando el PID del tag `launch`/`upsert` (handler) con el del `wire`/
// `render`/`subscribe` (panel) se confirma o descarta la hipótesis de procesos
// separados, y se localiza exactamente dónde se corta la cadena.
//
// Gate: OFF por defecto (ver isTelemetryEnabled). Se elimina por completo en el
// fix definitivo de #7. La telemetría jamás debe romper el flujo: todo va
// envuelto en try/catch.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOG_PATH =
	process.env.FRIDA_WF_PANEL_LOG ??
	join(homedir(), ".frida", "logs", "workflow-panel.log");

// Gate: la telemetría está OFF por defecto (no ensucia producción). Se activa con
// la env FRIDA_WF_PANEL_DEBUG=1 o creando el centinela ~/.frida/wf-panel-debug
// (detectable en runtime, sin reiniciar). Para diagnosticar el issue #7:
//   touch ~/.frida/wf-panel-debug   → reproducir → leer el log.
const SENTINEL = join(homedir(), ".frida", "wf-panel-debug");

function isTelemetryEnabled(): boolean {
	if (process.env.FRIDA_WF_PANEL_DEBUG === "1") return true;
	try {
		return existsSync(SENTINEL);
	} catch {
		return false;
	}
}

/**
 * Escribe una línea JSON de telemetría. No lanza: si el FS falla, se ignora.
 * @param tag   corto (wire/launch/upsert/progress/render/subscribe/...).
 * @param detail campos extra; `pid`/`ppid`/`ts` se añaden siempre.
 */
export function wfLog(tag: string, detail: Record<string, unknown> = {}): void {
	if (!isTelemetryEnabled()) return;
	try {
		const line = JSON.stringify({
			ts: new Date().toISOString(),
			pid: process.pid,
			ppid: process.ppid,
			tag,
			...detail,
		});
		mkdirSync(dirname(LOG_PATH), { recursive: true });
		appendFileSync(LOG_PATH, line + "\n");
	} catch {
		// La telemetría jamás debe romper el flujo.
	}
}
