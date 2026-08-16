// frida-subagents — registry durable de runs detached (issue #26, ADR-0037).
//
// El registro autoritativo de cada run es un `meta.json` en disco, así list /
// result / stop siguen funcionando entre turnos, /reload y hasta un reinicio
// completo de VS Code. El estado en memoria sólo retiene los exit handlers de
// los runs que ESTE proceso spawn (los demás se leen de disco).
//
// Patrón: pi-better-subagents/registry.ts (MIT, 1aboveio), simplificado al
// alcance del MVP (sin batch, sin callback recovery durable, sin pid
// start-time tokens — la reconciliación usa pid liveness + estado en meta).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { processExists } from "./detached-spawn";

/** Raíz de runs detached: ~/.frida/detached/<id>/{meta.json,log.jsonl,prompt.txt}.
 * Tests (y hosts alternativos) la sobreescriben via FRIDA_DETACHED_DIR. */
export function detachedRootDir(): string {
	return (
		process.env.FRIDA_DETACHED_DIR ?? join(homedir(), ".frida", "detached")
	);
}

export function runDir(id: string): string {
	return join(detachedRootDir(), id);
}

export function metaPathFor(id: string): string {
	return join(runDir(id), "meta.json");
}

export function logPathFor(id: string): string {
	return join(runDir(id), "log.jsonl");
}

/** Estado durable del run (en disco). */
export type DetachedRunStatus =
	| "running"
	| "completed"
	| "failed"
	| "killed"
	| "orphaned"
	| "lost";

/** ¿Puede un exit del child finalizar un run en este estado? (idempotencia). */
export function canExitFinalize(status: DetachedRunStatus): boolean {
	return status === "running" || status === "orphaned" || status === "lost";
}

export interface DetachedRunMeta {
	id: string;
	/** Nombre corto para listados. */
	name?: string;
	status: DetachedRunStatus;
	/** PID del child. */
	pid: number;
	/** PID del VS Code que lo lanzó (propiedad cross-restart). */
	spawnPid: number;
	/** Modelo (o el default del padre si no se especificó). */
	model?: string;
	thinking?: string;
	/** cwd del child. */
	cwd: string;
	/** Preview del prompt para listados. */
	promptPreview: string;
	startedAt: number;
	endedAt?: number;
	exitCode?: number | null;
	/** Resultado final (último texto del asistente). */
	result?: string;
	/** Motivo textual del fallo. */
	failureReason?: string;
	logPath: string;
	/** Tokens acumulados (#18) desde los message_end del log. */
	tokensIn?: number;
	tokensOut?: number;
	/** Tipo del agente (Explore, general-purpose, custom…). */
	agentType: string;
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

export function readMeta(id: string): DetachedRunMeta | undefined {
	const p = metaPathFor(id);
	if (!existsSync(p)) return undefined;
	try {
		return JSON.parse(readFileSync(p, "utf8")) as DetachedRunMeta;
	} catch {
		return undefined;
	}
}

export function writeMeta(meta: DetachedRunMeta): void {
	mkdirSync(runDir(meta.id), { recursive: true });
	writeFileSync(metaPathFor(meta.id), JSON.stringify(meta, null, "\t"), "utf8");
}

/** Lista todos los metas en disco, ordenados por fecha descendente. */
export function listMetas(): DetachedRunMeta[] {
	const root = detachedRootDir();
	if (!existsSync(root)) return [];
	const out: DetachedRunMeta[] = [];
	for (const id of readdirSync(root)) {
		const m = readMeta(id);
		if (m) out.push(m);
	}
	return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Borra el directorio del run (best-effort). */
export function removeRun(id: string): void {
	try {
		rmSync(runDir(id), { recursive: true, force: true });
	} catch {
		/* best-effort */
	}
}

// ---------------------------------------------------------------------------
// Generación de ids: det-1, det-2, … (siguiente índice libre en disco)
// ---------------------------------------------------------------------------

export function nextRunId(): string {
	const root = detachedRootDir();
	if (!existsSync(root)) return "det-1";
	const used = new Set(readdirSync(root));
	for (let i = 1; i < 10_000; i++) {
		const id = `det-${i}`;
		if (!used.has(id)) return id;
	}
	return `det-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Reconciliación (al arrancar / al abrir el panel): runs "running" en disco
// cuyo proceso ya no existe → orphaned/lost. Un run "running" cuyo spawnPid
// murió pero el child vive → orphaned (nadie notificará su completado).
// ---------------------------------------------------------------------------

export interface ReconcileResult {
	changed: DetachedRunMeta[];
}

export function reconcileRuns(now = Date.now()): ReconcileResult {
	const changed: DetachedRunMeta[] = [];
	for (const meta of listMetas()) {
		if (meta.status !== "running") continue;
		const childAlive = processExists(meta.pid);
		if (!childAlive) {
			// El child murió sin que nadie registrara el exit (crash del padre,
			// kill -9, reinicio). El resultado, si hay, está en el log.
			meta.status = "lost";
			meta.endedAt = now;
			meta.failureReason = "proceso hijo no encontrado al reconciliar";
			writeMeta(meta);
			changed.push(meta);
		} else if (!processExists(meta.spawnPid)) {
			// El VS Code que lo lanzó cerró; el child sigue. Nadie escribirá el
			// resultado al morir → orphaned (un nuevo VS Code puede adoptarlo
			// para vigilar su exit).
			meta.status = "orphaned";
			writeMeta(meta);
			changed.push(meta);
		}
	}
	return { changed };
}

/** Adopta un run orphaned (nuevo VS Code vigila su exit). Sin cambios de estado. */
export function adoptOrphaned(meta: DetachedRunMeta): void {
	if (meta.status !== "orphaned") return;
	// El adoptante pasa a ser el responsable de observar el exit; actualizamos
	// spawnPid al proceso actual para futuras reconciliaciones.
	meta.spawnPid = process.pid;
	writeMeta(meta);
}
