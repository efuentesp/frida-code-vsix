// frida-extensible-workflows · workflow_gc (#69) — núcleo de clasificación y
// purga de runs huérfanos.
//
// Un run huérfano vive en disco (~/.frida/projects/<proj>/<session>/runs/)
// sin handle vivo: su sesión murió (F5, host reiniciado, sesión borrada) con
// el run running/awaiting. workflow_stop ya no lo alcanza (registry por
// sesión) y su checkpoint nunca se aprobará. Este módulo los detecta,
// clasifica y purga con candados:
//
//   - JAMÁS toca runs de sesiones vivas (lease owner.json con pid vivo).
//   - JAMÁS toca la sesión actual (excludeSessionIds — se gestiona aparte).
//   - purge respeta olderThanDays (anti-carrera contra sesión reiniciándose),
//     stuckOnly y runIds (🗑 por run del panel).
//   - Las rutas se construyen SOLO caminando el árbol ~/.frida/projects —
//     runIds se matchea contra lo escaneado, nunca se interpolan en paths.
//
// Al purgar un atascado se devuelve el tail del journal + checkpoint pendiente
// (última oportunidad de diagnóstico).

import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type OrphanKind = "stuck" | "terminal";

export interface OrphanRun {
	runId: string;
	sessionId: string;
	workflowName: string;
	/** Estado persistido del run (running/awaiting/failed/completed/…). */
	state: string;
	/** stuck = irrecuperable (sesión muerta + no terminal); terminal = historia. */
	kind: OrphanKind;
	/** Checkpoint pendiente cuando state === "awaiting". */
	checkpointName?: string;
	ageDays: number;
	runDir: string;
}

export interface ScanOptions {
	/** Home del usuario (default homedir()) — tests inyectan un árbol falso. */
	home?: string;
	/** Sesiones que NUNCA se listan (la actual del host). */
	excludeSessionIds?: string[];
}

export interface PurgeOptions extends ScanOptions {
	/** Margen anti-carrera: sólo purga huérfanos más viejos (default 2). */
	olderThanDays?: number;
	/** Sólo purgar los atascados (running/awaiting de sesión muerta). */
	stuckOnly?: boolean;
	/** Acotar a runIds concretos (🗑 por run del panel). */
	runIds?: string[];
}

export interface PurgedRun extends OrphanRun {
	/** Tail del journal (~15 líneas) — evidencia final del atascado. */
	journalTail: string;
}

export interface PurgeResult {
	purged: PurgedRun[];
	skipped: number;
}

/** Estados terminales: historia consumada (purgables como limpieza). */
const TERMINAL_STATES = new Set([
	"completed",
	"failed",
	"cancelled",
	"stopped",
]);

/** ¿El proceso del lease sigue vivo? kill(pid, 0): EPERM = existe; ESRCH = muerto. */
function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

interface SessionOwner {
	pid: number;
}

/** ¿La sesión tiene un lease válido (owner.json con pid vivo)? */
async function sessionAlive(sessionDir: string): Promise<boolean> {
	try {
		const raw = await readFile(join(sessionDir, "owner.json"), "utf8");
		const owner = JSON.parse(raw) as Partial<SessionOwner>;
		if (typeof owner.pid !== "number") return false;
		return pidAlive(owner.pid);
	} catch {
		// Sin owner.json o corrupto → sesión muerta.
		return false;
	}
}

interface PersistedSummary {
	runId?: unknown;
	sessionId?: unknown;
	workflowName?: unknown;
	state?: unknown;
	updatedAt?: unknown;
}

/** Escanea el árbol ~/.frida/projects (todas las sesiones de todos los
 * proyectos) y clasifica los runs huérfanos. */
export async function scanOrphans(
	options: ScanOptions = {},
): Promise<OrphanRun[]> {
	const home = options.home ?? homedir();
	const excluded = new Set(options.excludeSessionIds ?? []);
	const orphans: OrphanRun[] = [];

	let projects: string[] = [];
	try {
		projects = (await readdir(join(home, ".frida", "workflows", "projects"), {
			withFileTypes: true,
		}))
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return []; // Sin árbol de proyectos → nada que hacer.
	}

	for (const project of projects) {
		const sessionsDir = join(
			home,
			".frida",
			"workflows",
			"projects",
			project,
			"sessions",
		);
		let sessions: string[] = [];
		try {
			sessions = (await readdir(sessionsDir, { withFileTypes: true }))
				.filter((e) => e.isDirectory() && !e.name.startsWith("."))
				.map((e) => e.name);
		} catch {
			continue;
		}
		for (const session of sessions) {
			if (excluded.has(session)) continue; // Sesión actual: intocable.
			const sessionDir = join(sessionsDir, session);
			if (await sessionAlive(sessionDir)) continue; // Viva: intocable.
			const runsDir = join(sessionDir, "runs");
			let runs: string[] = [];
			try {
				runs = (await readdir(runsDir, { withFileTypes: true }))
					.filter((e) => e.isDirectory() && !e.name.startsWith("."))
					.map((e) => e.name);
			} catch {
				continue;
			}
			for (const runId of runs) {
				const runDir = join(runsDir, runId);
				const orphan = await readOrphanRun(runDir, runId, session);
				if (orphan) orphans.push(orphan);
			}
		}
	}
	return orphans;
}

/** Vista de un run vivo para rehidratar el panel (#84). */
export interface LiveRunSnapshot {
	runId: string;
	workflowName: string;
	state: "running" | "awaiting";
	checkpointName?: string;
}

/** Runs running/awaiting de sesiones VIVAS (lease con pid activo) bajo la
 * raíz REAL (~/.frida/workflows/projects — misma que runsDirectory). Si el
 * host se reinició y el hijo murió, el lease caduca → quedan para scanOrphans
 * como huérfanos, NO aquí: jamás rehidratamos zombies (#84). */
export async function readLiveRuns(
	options: ScanOptions = {},
): Promise<LiveRunSnapshot[]> {
	const home = options.home ?? homedir();
	const out: LiveRunSnapshot[] = [];
	let projects: string[] = [];
	try {
		projects = (
			await readdir(join(home, ".frida", "workflows", "projects"), {
				withFileTypes: true,
			})
		).map((e) => e.name);
	} catch {
		return out;
	}
	for (const project of projects) {
		const sessionsDir = join(
			home,
			".frida",
			"workflows",
			"projects",
			project,
			"sessions",
		);
		let sessions: string[] = [];
		try {
			sessions = (await readdir(sessionsDir, { withFileTypes: true }))
				.filter((e) => e.isDirectory() && !e.name.startsWith("."))
				.map((e) => e.name);
		} catch {
			continue;
		}
		for (const session of sessions) {
			const sessionDir = join(sessionsDir, session);
			if (!(await sessionAlive(sessionDir))) continue; // muerta → orphans
			let runIds: string[] = [];
			try {
				runIds = (await readdir(join(sessionDir, "runs"), { withFileTypes: true }))
					.filter((e) => e.isDirectory() && !e.name.startsWith("."))
					.map((e) => e.name);
			} catch {
				continue;
			}
			for (const runId of runIds) {
				const runDir = join(sessionDir, "runs", runId);
				try {
					const st = JSON.parse(
						await readFile(join(runDir, "state.json"), "utf8"),
					) as {
						id?: unknown;
						workflowName?: unknown;
						state?: unknown;
					};
					const state =
						typeof st.state === "string" ? st.state : "";
					if (state !== "running" && state !== "awaiting") continue;
					let checkpointName: string | undefined;
					if (state === "awaiting") {
						try {
							const journal = JSON.parse(
								await readFile(join(runDir, "journal.json"), "utf8"),
							) as { awaiting?: Record<string, unknown> };
							const key = Object.keys(journal.awaiting ?? {})[0] ?? "";
							const m = key.match(/^checkpoint\/(.+)$/);
							if (m) checkpointName = m[1];
						} catch {
							/* journal opcional */
						}
					}
					out.push({
						runId: typeof st.id === "string" ? st.id : runId,
						workflowName:
							typeof st.workflowName === "string"
								? st.workflowName
								: runId,
						state,
						...(checkpointName ? { checkpointName } : {}),
					});
				} catch {
				}
			}
		}
	}
	return out;
}

/** Lee summary.json de un run y lo clasifica; null si no es legible. */
async function readOrphanRun(
	runDir: string,
	runId: string,
	sessionId: string,
): Promise<OrphanRun | null> {
	try {
		const raw = await readFile(join(runDir, "summary.json"), "utf8");
		const summary = JSON.parse(raw) as PersistedSummary;
		const state =
			typeof summary.state === "string" ? summary.state : "unknown";
		const updatedAt =
			typeof summary.updatedAt === "string" ? summary.updatedAt : null;
		if (!updatedAt) return null;
		const ageDays = (Date.now() - Date.parse(updatedAt)) / 86_400_000;
		if (Number.isNaN(ageDays)) return null;
		const checkpointName =
			state === "awaiting" &&
			typeof (summary as { checkpointName?: unknown }).checkpointName ===
				"string"
				? (summary as { checkpointName: string }).checkpointName
				: undefined;
		return {
			runId:
				typeof summary.runId === "string" ? summary.runId : runId,
			sessionId:
				typeof summary.sessionId === "string"
					? summary.sessionId
					: sessionId,
			workflowName:
				typeof summary.workflowName === "string"
					? summary.workflowName
					: "(desconocido)",
			state,
			kind: TERMINAL_STATES.has(state) ? "terminal" : "stuck",
			...(checkpointName ? { checkpointName } : {}),
			ageDays,
			runDir,
		};
	} catch {
		return null; // Run sin summary legible → fuera de alcance del GC.
	}
}

/** Tail del journal (~15 líneas) como evidencia final. */
async function journalTail(runDir: string): Promise<string> {
	try {
		const raw = await readFile(join(runDir, "journal.jsonl"), "utf8");
		const lines = raw.trimEnd().split("\n");
		return lines.slice(-15).join("\n");
	} catch {
		return "(sin journal)";
	}
}

/** Tail del journal SIN purgar — botón [Ver journal] del panel (#69). */
export async function readOrphanJournal(runDir: string): Promise<string> {
	return journalTail(runDir);
}

/** Formato de salida del modo list (tool de chat, #69). */
export function formatOrphansList(orphans: readonly OrphanRun[]): string {
	if (!orphans.length) {
		return "No hay runs huérfanos (todo lo persistido pertenece a sesiones vivas).";
	}
	const stuck = orphans.filter((o) => o.kind === "stuck");
	const lines = orphans.map((o) => {
		const flag = o.kind === "stuck" ? "⚠" : "·";
		const cp = o.checkpointName ? ` checkpoint ${o.checkpointName} sin resolver` : "";
		return `${flag} ${o.runId.slice(0, 8)} · ${o.workflowName} · ${o.state}${cp} · ${Math.floor(o.ageDays)}d`;
	});
	return [
		`${orphans.length} run(s) huérfano(s) de sesiones muertas (${stuck.length} atorado(s) ⚠, ${orphans.length - stuck.length} terminal(es)):`,
		...lines,
	].join("\n");
}

/** Purga huérfanos con candados. Devuelve lo purgado (con evidencia) y el conteo omitido. */
export async function purgeOrphans(
	options: PurgeOptions = {},
): Promise<PurgeResult> {
	const olderThanDays = options.olderThanDays ?? 2;
	const orphans = await scanOrphans(options);
	const wanted = new Set(options.runIds);

	let skipped = 0;
	const purged: PurgedRun[] = [];
	for (const orphan of orphans) {
		if (wanted.size && !wanted.has(orphan.runId)) {
			skipped++;
			continue;
		}
		if (orphan.ageDays < olderThanDays) {
			skipped++;
			continue;
		}
		if (options.stuckOnly && orphan.kind !== "stuck") {
			skipped++;
			continue;
		}
		const tail = await journalTail(orphan.runDir);
		// rm del directorio del run (rutas construidas por el walk, nunca input).
		await rm(orphan.runDir, { recursive: true, force: true });
		purged.push({ ...orphan, journalTail: tail });
	}
	return { purged, skipped };
}
