// Reader del JSONL de auditoría para el AuditPanel (ADR-0016, Fase 2).
//
// El logger (approval-logger.ts) escribe una línea JSONL por cada decisión terminal
// del gate (allow/block). Aquí lo leemos para el panel navegable: últimas N
// entradas, más reciente primero, parseo robusto (ignora líneas corruptas sin
// abortar todo el archivo).
//
// Best-effort: un log inexistente o ilegible → [] (el panel muestra "vacío", no
// rompe). Es lectura puntual al ejecutar /gates, no streaming.

import { existsSync, readFileSync, statSync } from "node:fs";
import type { ApprovalLogEntry } from "../../gates/approval-logger";

export type GateEntry = ApprovalLogEntry;

/**
 * Lee las últimas `limit` entradas del log JSONL, más reciente primero.
 *
 * @param logPath ruta del archivo (ej. globalStorageUri/.../approvals.jsonl).
 * @param limit máximo de entradas a devolver (default 200). El log puede crecer
 *   mucho entre sesiones; el panel muestra las más recientes.
 */
export function readAuditLog(logPath: string, limit = 200): GateEntry[] {
	try {
		if (!existsSync(logPath)) return [];
		// Vacío (sesión sin decisiones) → evita leer un archivo grande innecesario.
		if (statSync(logPath).size === 0) return [];

		const raw = readFileSync(logPath, "utf8");
		const entries: GateEntry[] = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;
			try {
				entries.push(JSON.parse(trimmed) as GateEntry);
			} catch {
				// Línea corrupta/truncada (crash a mitad de escritura) → ignorar.
			}
		}
		// El log es append (orden cronológico); devolvemos las últimas `limit`,
		// invertidas para mostrar la más reciente arriba.
		return entries.slice(-limit).reverse();
	} catch {
		return [];
	}
}

/** Cuenta allow/block de un conjunto de entradas (para los stats del panel). */
export function countDecisions(entries: GateEntry[]): {
	allow: number;
	block: number;
} {
	let allow = 0;
	let block = 0;
	for (const e of entries) {
		if (e.decision === "allow") allow++;
		else if (e.decision === "block") block++;
	}
	return { allow, block };
}
