// monitor-server.ts — servidor HTTP+SSE loopback del monitor del pipeline (FR#7/FR#8).
//
// Espejo de la plantilla node_modules/pi-mcp-adapter/ui-server.ts: token
// randomUUID por proceso, SSE Set + replay Last-Event-ID, heartbeat .unref()
// y listen en puerto efímero de 127.0.0.1. Tres deltas deliberados:
// - GET/SSE SIN token (el monitor es un espejo de sólo lectura en loopback);
//   POST exige token y responde 401 sin él (el FRD manda 401; la plantilla
//   responde 403 — delta consciente, ver Verification Notes).
// - Vida larga (D3): activo desde activate() como Disposable en
//   context.subscriptions (patrón status bar extension.ts:6874-6901), no
//   efímero por tool-call como la plantilla.
// - Watcher propio (D2): fs.watch recursivo sobre .frida/artifacts/ con
//   funnel debounce 250ms (una reconciliación + broadcast por ráfaga) y
//   tolerancia tmp+rename (eventos *.tmp se ignoran; el rename del archivo
//   final dispara el re-escaneo). .rpiv/ NO se vigila (seed sólo-lectura).
//   Fallback a watchers planos si recursive no está soportado (Linux
//   pre-Node-20) y re-arme por request si .frida aún no existe.
//
// Páginas / y /sdd (FR#7/FR#16): servidas por monitor-html.ts — hub de
// métodos (D7) en / y N1+N2 juntos con detalle por feature en /sdd. El token
// se EMBEBE en /sdd para los POST autenticados (FR#8); GET/SSE siguen
// abiertos. El contrato servidor↔HTML es el snapshot (MonitorSnapshot) + los
// POST /api/*.

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	isUnitDone,
	subscribeBoardChanges,
	validateFails,
	type Board,
	type BoardUnit,
} from "./board";
import {
	advanceFeature,
	computeFeatureReconcile,
	loadFeatures,
	reconcileFeatures,
	setFeaturePaused,
	shipBadge,
	shipFeature,
	subscribeFeaturesChanges,
	type PipelineFeature,
	type ShipBadge,
} from "./features";
import { listPanelSpecs, type PanelSpec } from "./panel-spec";
import { renderMonitorHubPage, renderSddPage } from "./monitor-html";

// ── Constantes ──────────────────────────────────────────────────────────────

/** Debounce del funnel (D2/Performance: un solo re-escaneo por ráfaga). */
export const MONITOR_DEBOUNCE_MS = 250;

/** Heartbeat SSE (plantilla ui-server.ts:513-522): limpia conexiones muertas. */
const HEARTBEAT_MS = 30_000;

/** Replay Last-Event-ID: cada evento es un snapshot COMPLETO ⇒ 20 sobran. */
const MAX_EVENT_LOG = 20;

/** Cuerpos JSON chicos (ids/comandos); protege contra bodies basura. */
const MAX_BODY_BYTES = 64 * 1024;

/** Raíz vigilada por el watcher (`.rpiv/` NO se vigila — D2). */
const ARTIFACTS_REL = ".frida/artifacts";

// ── Snapshot (contrato servidor↔HTML; FR#7/FR#12/FR#16) ────────────────────

/** Unidad N2 vista por el monitor (jerarquía de splits vía parentId). */
export interface MonitorUnitView {
	id: string;
	title?: string;
	parentId?: string;
	status: string;
	/** done resuelto con isUnitDone (columna done o todas las hojas done). */
	done: boolean;
	/** Zigzags de validate (badge del tablero; board.ts validateFails). */
	validateFails: number;
	/** Nº de transiciones (densidad de trabajo de la fase). */
	transitions: number;
}

/** Board N2 espejo (uno por `.frida/artifacts/board/<slug>.json`). */
export interface MonitorBoardView {
	/** planPath del board (token del board N2; feature.planPath apunta aquí). */
	path: string;
	columns: string[];
	doneColumn: string;
	units: MonitorUnitView[];
}

/** Feature N1 con derivados frescos (los mismos que el host del overlay). */
export interface MonitorFeatureView extends PipelineFeature {
	title: string;
	/** FR#12 — el FS va más adelante que la tarjeta. */
	desync: boolean;
	/** FR#6 — badge «n/m fases» post-ship. */
	badge?: ShipBadge;
}

/** Estado completo del ecosistema servido por /api/state y cada evento SSE. */
export interface MonitorSnapshot {
	generatedAt: string;
	/** FR#9/FR#7 — catálogo de métodos del motor (hub del monitor). */
	specs: PanelSpec[];
	features: MonitorFeatureView[];
	boards: MonitorBoardView[];
}

// ── Derivados ───────────────────────────────────────────────────────────────

/** Mismo derivado que featureTitle (features-ui.tsx). Duplicado AQUÍ a
 *  propósito: el servidor vive en el bundle del DSL (dist/frida-workflow.js)
 *  y no debe importar módulos de UI (features-ui arrastra React al bundle). */
function featureTitleOf(f: { id: string; title?: string }): string {
	if (f.title) return f.title;
	const base = f.id.split("/").pop() ?? f.id;
	return (
		base
			.replace(/\.md$/, "")
			.replace(/^\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?_/, "") || base
	);
}

/** Boards N2: readdir + parse defensivo (corrupto/a-medias ⇒ skip, no rompe). */
function readBoardsSnapshot(cwd: string): MonitorBoardView[] {
	const dir = join(cwd, ".frida", "artifacts", "board");
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	} catch {
		return [];
	}
	const out: MonitorBoardView[] = [];
	for (const f of files) {
		try {
			const board = JSON.parse(readFileSync(join(dir, f), "utf8")) as Board;
			if (!Array.isArray(board.units) || !Array.isArray(board.columns)) continue;
			out.push({
				path: board.planPath ?? f,
				columns: [...board.columns],
				doneColumn: board.doneColumn,
				units: board.units.map((u: BoardUnit) => ({
					id: u.id,
					title: u.title,
					parentId: u.parentId,
					status: u.status,
					done: isUnitDone(board, u),
					validateFails: validateFails(u),
					transitions: Array.isArray(u.transitions) ? u.transitions.length : 0,
				})),
			});
		} catch {}
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Snapshot fresco del ecosistema (una sola fuente para GET/SSE/Slice 7). */
export function buildMonitorSnapshot(cwd: string): MonitorSnapshot {
	const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
	const desyncById = new Map(
		computeFeatureReconcile(cwd).map((r) => [r.id, r.desync] as const),
	);
	return {
		generatedAt: new Date().toISOString(),
		specs: [...listPanelSpecs()],
		features: state.features.map((f) => ({
			...f,
			title: featureTitleOf(f),
			desync: desyncById.get(f.id) ?? false,
			badge: shipBadge(cwd, f),
		})),
		boards: readBoardsSnapshot(cwd),
	};
}

// ── Helpers HTTP (plantilla ui-server.ts, adaptados) ────────────────────────

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
	res.writeHead(200, {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(html);
}

/** POST auth: header propio o Bearer (FR#8). 401 lo decide el caller. */
function authorized(req: IncomingMessage, token: string): boolean {
	const h = req.headers["x-frida-monitor-token"];
	if (typeof h === "string") return h === token;
	return req.headers.authorization === `Bearer ${token}`;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				req.destroy();
				reject(new Error("cuerpo demasiado grande"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

/** Cierre total aunque queden keep-alives (molde oauth.ts closeServerGracefully). */
function closeServerGracefully(server: http.Server): void {
	const s = server as http.Server & { closeAllConnections?: () => void };
	if (typeof s.closeAllConnections === "function") s.closeAllConnections();
	server.close();
}

// ── Servidor ────────────────────────────────────────────────────────────────

export interface PipelineMonitorOptions {
	cwd: string;
	/** FR#4 por POST (Desired End State): el host inyecta el comando al chat
	 *  por el MISMO canal que el overlay (focus + runCustomCommand). */
	onCommand?: (command: string) => void;
}

export interface PipelineMonitorHandle {
	/** `http://127.0.0.1:<puerto-efímero>/` (Slice 8 la envía al webview). */
	url: string;
	port: number;
	/** Token por proceso: POST lo exige; el HTML lo recibe embebido (Slice 7). */
	token: string;
	dispose(): void;
}

export async function startPipelineMonitor(
	options: PipelineMonitorOptions,
): Promise<PipelineMonitorHandle> {
	const cwd = options.cwd;
	const token = randomUUID();
	let disposed = false;

	// ── SSE: clientes, log con replay y broadcast (plantilla ui-server) ──────
	const sseClients = new Set<ServerResponse>();
	const eventLog: Array<{ id: number; data: string }> = [];
	let eventSeq = 0;

	const sseFrame = (id: number, data: string): string =>
		`id: ${id}\nevent: snapshot\ndata: ${data}\n\n`;

	const dropClient = (res: ServerResponse): void => {
		sseClients.delete(res);
		try {
			res.end();
		} catch {
			/* ya muerta */
		}
	};

	/** Registra el evento en el log (replay) y lo devuelve sin fanout. */
	const pushEvent = (data: string): { id: number; data: string } => {
		const id = ++eventSeq;
		eventLog.push({ id, data });
		if (eventLog.length > MAX_EVENT_LOG)
			eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
		return { id, data };
	};

	const broadcastSnapshot = (): void => {
		if (disposed) return;
		const ev = pushEvent(JSON.stringify(buildMonitorSnapshot(cwd)));
		const chunk = sseFrame(ev.id, ev.data);
		for (const c of sseClients) {
			try {
				c.write(chunk);
			} catch {
				dropClient(c);
			}
		}
	};

	// ── Funnel debounce: TODAS las señales (emit in-process + watcher)
	//    convergen aquí — un solo reconcile+broadcast por ráfaga. El guard
	//    `flushing` evita que el emit SÍNCRONO de reconcileFeatures (dentro de
	//    saveFeatures) re-agende el flush que ya está corriendo. ───────────────
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let flushing = false;

	const flush = (): void => {
		if (disposed) return;
		flushing = true;
		try {
			// D4 — adopción/relink idempotente ante escritores EXTERNOS (.md nuevos,
			// features.json tocado por bash); su propio emit no re-agenda (guard).
			reconcileFeatures(cwd);
		} finally {
			flushing = false;
		}
		if (watchMode === "flat") syncFlatWatchers(); // buckets nuevos (fallback)
		broadcastSnapshot();
	};

	const scheduleFlush = (): void => {
		if (disposed || flushTimer || flushing) return;
		flushTimer = setTimeout(() => {
			flushTimer = null;
			flush();
		}, MONITOR_DEBOUNCE_MS);
		flushTimer.unref?.();
	};

	// ── Watcher (D2) ─────────────────────────────────────────────────────────
	const watchers: FSWatcher[] = [];
	let watchMode: "none" | "recursive" | "flat" = "none";

	const closeWatchers = (): void => {
		for (const w of watchers) {
			try {
				w.close();
			} catch {
				/* ya cerrado */
			}
		}
		watchers.length = 0;
	};

	/** Evento bajo la raíz vigilada: filtra tmp y fuera de .frida/artifacts. */
	const onFsEvent = (
		rootRel: string,
		filename: string | Buffer | null,
	): void => {
		if (disposed) return;
		if (typeof filename !== "string") {
			scheduleFlush(); // sin nombre: conservador
			return;
		}
		let rel = filename.replace(/\\/g, "/");
		if (rootRel !== ARTIFACTS_REL) {
			// vigilando .frida: sólo importa lo que vive bajo artifacts/
			if (!rel.startsWith("artifacts/") && rel !== "artifacts") return;
			rel = `${rootRel}/${rel}`;
		}
		if (rel.endsWith(".tmp")) return; // tmp+rename: el rename dispara el re-escaneo
		scheduleFlush();
	};

	/** Evento de un watcher PLANO (fallback): filename es basename. */
	const onFlatEvent = (filename: string | Buffer | null): void => {
		if (typeof filename === "string" && filename.endsWith(".tmp")) return;
		scheduleFlush();
	};

	/** Re-arma los watchers planos (artifacts + cada bucket existente). */
	const syncFlatWatchers = (): void => {
		closeWatchers();
		const artifactsDir = join(cwd, ARTIFACTS_REL);
		try {
			watchers.push(watch(artifactsDir, (_e, f) => onFlatEvent(f)));
			for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				watchers.push(
					watch(join(artifactsDir, entry.name), (_e, f) => onFlatEvent(f)),
				);
			}
		} catch {
			/* sin watchers esta ronda: el GET /api/state sigue reconciliando */
		}
	};

	/** Idempotente; barato; el handler lo llama por request para re-armar
	 *  cuando .frida aparece tarde (workspace limpio). */
	const armWatcher = (): void => {
		if (disposed || watchMode !== "none") return;
		const artifactsDir = join(cwd, ARTIFACTS_REL);
		try {
			if (existsSync(artifactsDir)) {
				watchers.push(
					watch(artifactsDir, { recursive: true }, (_e, f) =>
						onFsEvent(ARTIFACTS_REL, f),
					),
				);
				watchMode = "recursive";
				return;
			}
			const fridaDir = join(cwd, ".frida");
			if (existsSync(fridaDir)) {
				// artifacts aún no existe: vigilar el padre para capturar su creación.
				watchers.push(
					watch(fridaDir, { recursive: true }, (_e, f) => onFsEvent(".frida", f)),
				);
				watchMode = "recursive";
				return;
			}
			return; // ni .frida: se rearma en el próximo request
		} catch {
			// recursive no soportado (Linux pre-Node-20): fallback plano por bucket
		}
		try {
			if (!existsSync(artifactsDir)) return;
			syncFlatWatchers();
			watchMode = "flat";
		} catch {
			/* sin watcher: el snapshot por GET sigue vivo */
		}
	};

	// ── Suscripciones in-process (overlay ▶, runs del board N2, POST) ────────
	const offFeatures = subscribeFeaturesChanges(scheduleFlush);
	const offBoard = subscribeBoardChanges(scheduleFlush);

	// ── Heartbeat (plantilla ui-server.ts:513-522, unref) ────────────────────
	const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
		for (const c of sseClients) {
			try {
				c.write(": hb\n\n");
			} catch {
				dropClient(c);
			}
		}
	}, HEARTBEAT_MS);
	heartbeat.unref?.();

	// ── Rutas ────────────────────────────────────────────────────────────────
	const handleRequest = async (
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> => {
		armWatcher(); // idempotente; rearma cuando .frida aparece
		const method = req.method ?? "GET";
		const url = new URL(req.url ?? "/", "http://127.0.0.1");

		// GET abiertos (D8): páginas del monitor (Slice 6: página mínima; Slice 7:
		// monitor-html), snapshot y SSE — sin token. El token viaja EMBEBIDO en
		// /sdd para los POST (FR#8) cuando llega la página real (Slice 7).
		if (method === "GET" && url.pathname === "/") {
			sendHtml(res, renderMonitorHubPage());
			return;
		}

		if (method === "GET" && url.pathname === "/sdd") {
			sendHtml(res, renderSddPage(token));
			return;
		}

		if (method === "GET" && url.pathname === "/api/state") {
			// FR#3 también por GET: adopción visible al refrescar aunque el watcher
			// no pudiera armarse (idempotente: sin cambios no escribe).
			reconcileFeatures(cwd);
			sendJson(res, 200, buildMonitorSnapshot(cwd));
			return;
		}

		if (method === "GET" && url.pathname === "/events") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			res.write(": connected\n\n");
			sseClients.add(res);
			// Replay Last-Event-ID (plantilla replayEvents): cada evento es un
			// snapshot completo ⇒ re-entregar lo perdido alcanza. Sin header (o log
			// podado / servidor reiniciado con id mayor) se envía el snapshot actual
			// SOLO a este cliente como primer evento.
			const header = req.headers["last-event-id"];
			const parsed = header ? Number(header) : Number.NaN;
			const missed = Number.isFinite(parsed)
				? eventLog.filter((e) => e.id > parsed)
				: [];
			if (missed.length > 0) {
				for (const e of missed) {
					try {
						res.write(sseFrame(e.id, e.data));
					} catch {
						dropClient(res);
						break;
					}
				}
			} else {
				const ev = pushEvent(JSON.stringify(buildMonitorSnapshot(cwd)));
				try {
					res.write(sseFrame(ev.id, ev.data));
				} catch {
					dropClient(res);
				}
			}
			req.on("close", () => {
				sseClients.delete(res);
			});
			return;
		}

		if (method !== "POST") {
			sendJson(res, 404, { error: "no encontrado" });
			return;
		}

		// POST: token SIEMPRE primero (FR#8 — 401; delta consciente vs 403).
		if (!authorized(req, token)) {
			sendJson(res, 401, {
				error: "token requerido (x-frida-monitor-token o Authorization Bearer)",
			});
			return;
		}

		let body: unknown;
		try {
			body = await readJsonBody(req);
		} catch {
			sendJson(res, 400, { error: "cuerpo JSON inválido" });
			return;
		}
		const id = (body as { id?: unknown }).id;
		if (typeof id !== "string" || !id.trim()) {
			sendJson(res, 400, { error: "id requerido (ruta relativa del FRD)" });
			return;
		}

		if (url.pathname === "/api/advance") {
			const r = advanceFeature(cwd, id, "monitor");
			if (r.moved && r.command) options.onCommand?.(r.command);
			sendJson(res, 200, {
				moved: r.moved,
				prerequisitesMet: r.prerequisitesMet,
				to: r.to,
				command: r.command,
				warning:
					r.moved && !r.prerequisitesMet
						? `«${featureTitleOf(r.feature ?? { id })}» → ${r.to}: el artefacto previo no está en el FS — la skill podría no encontrarlo.`
						: undefined,
			});
			return;
		}

		if (url.pathname === "/api/pause") {
			const paused = (body as { paused?: unknown }).paused;
			if (typeof paused !== "boolean") {
				sendJson(res, 400, { error: "paused requiere boolean" });
				return;
			}
			const f = setFeaturePaused(cwd, id, paused, "monitor");
			sendJson(
				res,
				200,
				f ? { ok: true, paused: f.paused } : { ok: false, error: "missing" },
			);
			return;
		}

		if (url.pathname === "/api/ship") {
			const r = shipFeature(cwd, id, "monitor");
			sendJson(res, 200, {
				moved: r.moved,
				failure: r.failure,
				phaseCount: r.phaseCount,
				planPath: r.planPath,
				warning:
					r.failure === "no-plan"
						? `«${featureTitleOf(r.feature ?? { id })}» no tiene plan enlazado — completa /skill:plan antes de shipear.`
						: undefined,
			});
			return;
		}

		sendJson(res, 404, { error: "no encontrado" });
	};

	const server = http.createServer((req, res) => {
		handleRequest(req, res).catch((e: unknown) => {
			try {
				sendJson(res, 500, {
					error: e instanceof Error ? e.message : String(e),
				});
			} catch {
				/* respuesta ya volada */
			}
		});
	});

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		clearInterval(heartbeat);
		offFeatures();
		offBoard();
		closeWatchers();
		for (const c of sseClients) {
			try {
				c.end();
			} catch {
				/* ya muerta */
			}
		}
		sseClients.clear();
		closeServerGracefully(server);
	};

	armWatcher(); // primer intento (workspace ya con .frida)
	return await new Promise<PipelineMonitorHandle>((resolve, reject) => {
		server.once("error", (e: Error) => {
			dispose();
			reject(e);
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				dispose();
				reject(new Error("dirección del monitor inválida"));
				return;
			}
			resolve({
				url: `http://127.0.0.1:${address.port}/`,
				port: address.port,
				token,
				dispose,
			});
		});
	});
}
