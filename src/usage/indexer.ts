// Indexer de uso de Frida: agrega sesiones JSONL en un snapshot por periodo.
//
// Modela src/session-stats.ts (caché por mtime + parseo defensivo), elevado de
// "sesión actual" a "todas las sesiones del periodo". Atribuye el usage al modelo
// activo (trackeando model_change), cuenta los toolCall (byTool, assistedKloc por
// lenguaje, flags de adopción) y bucketiza por día/hora/dow en zona horaria del host.

import * as fs from "node:fs";
import {
	emptyKpis,
	type ReportKpis,
	type ReportBehavior,
	type ReportAdoption,
	type ByModel,
	type ByProvider,
	type ByTool,
	type ByFileType,
	type ByArtifact,
	type ByDay,
} from "./report-schema";
import {
	classifyFileType,
	fileTypeFamily,
	classifyArtifactKind,
	countLines,
} from "./artifact-classifier";

export type Period = "today" | "7d" | "30d" | "all";

export interface SessionSummary {
	path: string;
	name?: string;
	firstMessage: string;
	cwd: string;
	firstTs: number;
	lastTs: number;
	tokensIn: number;
	tokensOut: number;
	cost: number;
	turns: number;
	assistedKloc: number;
}

export interface UsageSnapshot {
	kpis: ReportKpis;
	breakdowns: {
		byModel: ByModel[];
		byProvider: ByProvider[];
		byTool: ByTool[];
		byFileType: ByFileType[];
		byArtifact: ByArtifact[];
		byDay: ByDay[];
		byHour: number[];
		byDow: number[];
		bySdlcPhase: never[]; // F2 — [] en F1
	};
	behavior: ReportBehavior;
	adoption: ReportAdoption;
	sessions: SessionSummary[];
}

export interface IndexOptions {
	sessionsDir: string;
	period?: Period;
	/** IANA. Default: zona del host. */
	timezone?: string;
	/** Epoch ms; default Date.now(). Para tests deterministas. */
	now?: number;
	/** Si se define, sólo indexa las sesiones cuyo cwd coincide (modo "Este proyecto").
	 *  Undefined → todas (modo "Todas"). */
	projectCwd?: string;
}

export interface IndexResult {
	snapshot: UsageSnapshot;
	periodFrom: number;
	periodTo: number;
}

// --- Caché por (file, mtime) — modelo de session-stats.ts ---

interface Parsed {
	mtime: number;
	firstTs: number;
	lastTs: number;
	firstMessage?: string;
	rows: Row[];
}
interface Row {
	ts: number | null;
	kind: "session" | "model" | "compaction" | "assistant" | "other";
	cwd?: string;
	model?: string;
	provider?: string;
	usage?: any;
	tools?: { name: string; args: any }[];
}
const parseCache = new Map<string, Parsed>();

function toMs(ts: unknown): number | null {
	if (typeof ts === "number" && Number.isFinite(ts)) return ts;
	if (typeof ts === "string" && ts) {
		const ms = Date.parse(ts);
		return Number.isNaN(ms) ? null : ms;
	}
	return null;
}
function toCost(c: unknown): number {
	if (typeof c === "number" && Number.isFinite(c)) return c;
	if (c && typeof c === "object" && "total" in c) {
		const t = (c as { total: unknown }).total;
		return typeof t === "number" && Number.isFinite(t) ? t : 0;
	}
	return 0;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Bucket temporal local (zona horaria del host o la indicada). */
function localParts(ms: number, tz: string | undefined) {
	const d = new Date(ms);
	const zone = tz;
	const date = new Intl.DateTimeFormat("en-CA", {
		timeZone: zone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(d); // en-CA → YYYY-MM-DD
	let hour = Number(
		new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hour: "2-digit",
			hour12: false,
		}).format(d),
	);
	if (hour === 24) hour = 0; // algunos runtimes emiten "24"
	const dow = WEEKDAY.indexOf(
		new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			weekday: "short",
		}).format(d),
	);
	return {
		date,
		hour: Number.isFinite(hour) ? hour : 0,
		dow: dow >= 0 ? dow : 0,
	};
}

/** Parsea el JSONL a rows planos (cacheado por mtime). La agregación va aparte. */
/** Extrae texto plano del content de un mensaje (string o array de bloques). */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b: any) => (typeof b?.text === "string" ? b.text : ""))
			.join("")
			.trim();
	}
	return "";
}

function parseRows(file: string): Parsed | null {
	try {
		const st = fs.statSync(file);
		if (!st.isFile()) return null;
		const hit = parseCache.get(file);
		if (hit && hit.mtime === st.mtimeMs) return hit;
		const raw = fs.readFileSync(file, "utf8");
		const rows: Row[] = [];
		let first = Infinity;
		let last = 0;
		let firstMessage: string | undefined;
		for (const line of raw.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			let e: any;
			try {
				e = JSON.parse(t);
			} catch {
				continue; // línea malformada: ignorar sin abortar
			}
			const ts = toMs(e?.timestamp);
			if (ts !== null) {
				if (ts < first) first = ts;
				if (ts > last) last = ts;
			}
			if (
				!firstMessage &&
				e?.type === "message" &&
				e?.message?.role === "user"
			) {
				firstMessage = extractText(e?.message?.content).slice(0, 120);
			}
			const row: Row = { ts, kind: "other" };
			if (e?.type === "session") {
				row.kind = "session";
				row.cwd = typeof e?.cwd === "string" ? e.cwd : undefined;
			} else if (e?.type === "model_change") {
				row.kind = "model";
				row.model = String(e?.modelId ?? "");
				row.provider = String(e?.provider ?? "");
			} else if (e?.type === "compaction") {
				row.kind = "compaction";
				row.usage = e?.usage;
			} else if (e?.type === "message" && e?.message?.role === "assistant") {
				row.kind = "assistant";
				row.usage = e?.message?.usage;
				const tools: Row["tools"] = [];
				const content = e?.message?.content;
				if (Array.isArray(content)) {
					for (const b of content) {
						if (b && b.type === "toolCall" && typeof b.name === "string") {
							tools.push({ name: b.name, args: b.arguments ?? {} });
						}
					}
				}
				row.tools = tools;
			}
			rows.push(row);
		}
		const parsed: Parsed = {
			mtime: st.mtimeMs,
			firstTs: first === Infinity ? 0 : first,
			lastTs: last,
			firstMessage,
			rows,
		};
		parseCache.set(file, parsed);
		return parsed;
	} catch {
		return null;
	}
}

// --- Fuente de verdad consolidada -----------------------------------------
// Un solo registro por turno (mensaje assistant) o compactación, con TODOS los
// componentes del usage y la metadata de tools pre-clasificada. Toda agregación
// (KPIs, breakdowns, sesiones) se deriva de este arreglo vía summarize() → una
// sola definición de "tokens" (tk), imposible que los totales descuadren.
// Diseño export-ready: sin contenido, sólo enteros + extensión + tool (D5/R4).

interface ToolCallRec {
	name: string;
	/** Sólo para write/edit: metadata precomputada una sola vez. */
	fileType?: string;
	family?: string;
	artifactKind?: string;
	lines?: number;
}

interface TurnRecord {
	sessionId: string;
	/** Epoch ms; 0 si el evento no traía timestamp (se excluye de buckets temporales). */
	ts: number;
	/** YYYY-MM-DD local; "" si no hay ts. */
	date: string;
	/** 0-23, o -1 si no hay ts. */
	hour: number;
	/** 0-6 (Dom..Sáb), o -1 si no hay ts. */
	dow: number;
	model: string;
	provider: string;
	// Componentes crudos del usage (única fuente; razonamiento va aparte de tk):
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	cost: number;
	/** true → evento de compaction: cuenta tokens/cost pero NO turno ni tools. */
	isCompaction: boolean;
	tools: ToolCallRec[];
}

interface SessionMeta {
	sessionId: string;
	path: string;
	cwd: string;
	firstTs: number;
	lastTs: number;
	firstMessage: string;
}

/** Normaliza el JSONL parseado en registros de turno (una sola pasada). El
 *  model/provider se trackea por model_change; la metadata de write/edit
 *  (fileType, family, artifactKind, líneas) se clasifica aquí una sola vez. */
function toTurns(
	parsed: Parsed,
	file: string,
	tz: string | undefined,
): { turns: TurnRecord[]; meta: SessionMeta } {
	let model = "";
	let provider = "";
	let cwd = "";
	const turns: TurnRecord[] = [];
	for (const r of parsed.rows) {
		if (r.kind === "session" && r.cwd) cwd = r.cwd;
		else if (r.kind === "model") {
			if (r.model) model = r.model;
			if (r.provider) provider = r.provider;
		} else if (r.kind === "assistant" || r.kind === "compaction") {
			const u = r.usage ?? {};
			const input = Number(u.input ?? 0) || 0;
			const output = Number(u.output ?? 0) || 0;
			const cacheRead = Number(u.cacheRead ?? 0) || 0;
			const cacheWrite = Number(u.cacheWrite ?? 0) || 0;
			const reasoning = Number(u.reasoning ?? 0) || 0;
			const cost = toCost(u.cost);
			const isCompaction = r.kind === "compaction";
			let date = "";
			let hour = -1;
			let dow = -1;
			if (r.ts !== null) {
				const p = localParts(r.ts, tz);
				date = p.date;
				hour = p.hour;
				dow = p.dow;
			}
			const tools: ToolCallRec[] = [];
			if (!isCompaction) {
				for (const tool of r.tools ?? []) {
					const name = tool.name;
					const tc: ToolCallRec = { name };
					const a = tool.args ?? {};
					if (name === "write" || name === "edit") {
						const fp = String(a.path ?? a.file_path ?? a.filePath ?? "");
						if (fp) {
							tc.fileType = classifyFileType(fp);
							tc.family = fileTypeFamily(fp);
							tc.artifactKind = classifyArtifactKind(fp);
						}
						let lines = 0;
						if (name === "write") lines = countLines(a.content);
						else if (Array.isArray(a.edits))
							for (const ed of a.edits) lines += countLines(ed?.newText);
						tc.lines = lines;
					}
					tools.push(tc);
				}
			}
			turns.push({
				sessionId: file,
				ts: r.ts ?? 0,
				date,
				hour,
				dow,
				model,
				provider,
				input,
				output,
				cacheRead,
				cacheWrite,
				reasoning,
				cost,
				isCompaction,
				tools,
			});
		}
	}
	return {
		turns,
		meta: {
			sessionId: file,
			path: file,
			cwd,
			firstTs: parsed.firstTs,
			lastTs: parsed.lastTs,
			firstMessage: parsed.firstMessage ?? "",
		},
	};
}

/** Agrega el arreglo de turnos en el snapshot. UNA sola fórmula de tokens:
 *  tk = input + output + cacheRead + cacheWrite (incluye caché).
 *  tokensIn = lado de entrada (input + cacheRead + cacheWrite); tokensOut = output.
 *  Por construcción ΣbyDay === KPI === Σsesiones (todas leen el mismo tk). */
function summarize(
	turns: TurnRecord[],
	metas: Map<string, SessionMeta>,
): UsageSnapshot {
	const kpis = emptyKpis();
	const byModel = new Map<string, ByModel>();
	const byProvider = new Map<string, ByProvider>();
	const byTool = new Map<string, { count: number; tokens: number }>();
	const byFileType = new Map<string, ByFileType>();
	const byArtifact = new Map<string, number>();
	const byDay = new Map<string, ByDay>();
	const byHour = new Array(24).fill(0);
	const byDow = new Array(7).fill(0);
	const sess = new Map<
		string,
		{
			tokensIn: number;
			tokensOut: number;
			cost: number;
			turns: number;
			assistedKloc: number;
		}
	>();
	// Toda sesión (con o sin turnos) arranca en cero → kpis.sessions == metas.size.
	for (const id of metas.keys())
		sess.set(id, {
			tokensIn: 0,
			tokensOut: 0,
			cost: 0,
			turns: 0,
			assistedKloc: 0,
		});

	let compactations = 0,
		subagentsLaunched = 0,
		questionsAsked = 0;
	let browserUsed = false,
		subagentsUsed = false,
		contextToolUsed = false;

	for (const t of turns) {
		const tk = t.input + t.output + t.cacheRead + t.cacheWrite;
		const inSide = t.input + t.cacheRead + t.cacheWrite;
		const isTurn = !t.isCompaction;
		// --- KPIs ---
		kpis.tokensIn += inSide;
		kpis.tokensOut += t.output;
		kpis.cacheRead += t.cacheRead;
		kpis.cacheWrite += t.cacheWrite;
		kpis.cost += t.cost;
		if (isTurn) kpis.turns += 1;
		if (t.isCompaction) compactations += 1;
		// --- byModel ---
		if (t.model || t.provider) {
			const mk = t.model || "(unknown)";
			const m = byModel.get(mk) ?? {
				model: mk,
				provider: t.provider,
				tokens: 0,
				cost: 0,
				turns: 0,
			};
			m.tokens += tk;
			m.cost += t.cost;
			if (isTurn) m.turns += 1;
			if (t.provider) m.provider = t.provider;
			byModel.set(mk, m);
		}
		// --- byProvider ---
		if (t.provider) {
			const p = byProvider.get(t.provider) ?? {
				provider: t.provider,
				tokens: 0,
				cost: 0,
			};
			p.tokens += tk;
			p.cost += t.cost;
			byProvider.set(t.provider, p);
		}
		// --- byDay (incluye compaction si trae date → cuadre exacto con el KPI) ---
		if (t.date) {
			const d = byDay.get(t.date) ?? {
				date: t.date,
				tokens: 0,
				cost: 0,
				turns: 0,
			};
			d.tokens += tk;
			d.cost += t.cost;
			if (isTurn) d.turns += 1;
			byDay.set(t.date, d);
		}
		// --- byHour / byDow: actividad (sólo assistant) ---
		if (isTurn && t.hour >= 0) byHour[t.hour] += 1;
		if (isTurn && t.dow >= 0) byDow[t.dow] += 1;
		// --- tools + byTool + byFileType + byArtifact + adopción + por sesión ---
		const nTools = t.tools.length;
		const s = sess.get(t.sessionId)!;
		for (const tool of t.tools) {
			const name = tool.name;
			const tcur = byTool.get(name) ?? { count: 0, tokens: 0 };
			tcur.count += 1;
			tcur.tokens += nTools > 0 ? tk / nTools : 0;
			byTool.set(name, tcur);
			if (name === "write" || name === "edit") {
				const lines = tool.lines ?? 0;
				if (tool.fileType) {
					const F = byFileType.get(tool.fileType) ?? {
						fileType: tool.fileType,
						family: tool.family ?? "",
						files: 0,
						edits: 0,
						assistedKloc: 0,
						tokens: 0,
					};
					if (name === "write") F.files += 1;
					else F.edits += 1;
					F.assistedKloc += lines / 1000;
					F.tokens += nTools > 0 ? tk / nTools : 0;
					byFileType.set(tool.fileType, F);
				}
				if (tool.artifactKind)
					byArtifact.set(
						tool.artifactKind,
						(byArtifact.get(tool.artifactKind) ?? 0) + 1,
					);
				s.assistedKloc += lines / 1000;
			}
			if (name === "ask_user_question") questionsAsked += 1;
			if (name === "Agent") {
				subagentsLaunched += 1;
				subagentsUsed = true;
			}
			if (name === "get_subagent_result") subagentsUsed = true;
			if (
				name === "agent_browser" ||
				name === "web_search" ||
				name === "web_fetch"
			)
				browserUsed = true;
			if (name === "context" || name === "project_report")
				contextToolUsed = true;
		}
		s.tokensIn += inSide;
		s.tokensOut += t.output;
		s.cost += t.cost;
		if (isTurn) s.turns += 1;
	}

	kpis.sessions = metas.size;
	for (const meta of metas.values())
		kpis.activeMs +=
			meta.firstTs && meta.lastTs ? meta.lastTs - meta.firstTs : 0;
	kpis.avgTurnTokens =
		kpis.turns > 0
			? Math.round((kpis.tokensIn + kpis.tokensOut) / kpis.turns)
			: 0;
	// cacheHitPct agregado: lecturas de caché sobre el contexto de entrada total.
	const ctxIn = turns.reduce(
		(a, t) => a + t.input + t.cacheRead + t.cacheWrite,
		0,
	);
	kpis.cacheHitPct = ctxIn > 0 ? Math.round((kpis.cacheRead / ctxIn) * 100) : 0;

	const sessions: SessionSummary[] = [];
	for (const [id, sa] of sess) {
		const meta = metas.get(id);
		if (!meta) continue;
		sessions.push({
			path: meta.path,
			firstMessage: meta.firstMessage,
			cwd: meta.cwd,
			firstTs: meta.firstTs,
			lastTs: meta.lastTs,
			tokensIn: sa.tokensIn,
			tokensOut: sa.tokensOut,
			cost: sa.cost,
			turns: sa.turns,
			assistedKloc: sa.assistedKloc,
		});
	}
	sessions.sort(
		(a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut),
	);

	return {
		kpis,
		breakdowns: {
			byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
			byProvider: [...byProvider.values()].sort((a, b) => b.tokens - a.tokens),
			byTool: [...byTool.entries()]
				.map(([tool, v]) => ({
					tool,
					count: v.count,
					tokens: Math.round(v.tokens),
				}))
				.sort((a, b) => b.tokens - a.tokens),
			byFileType: [...byFileType.values()].sort(
				(a, b) => b.assistedKloc - a.assistedKloc,
			),
			byArtifact: [...byArtifact.entries()]
				.map(([kind, count]) => ({ kind, count }))
				.sort((a, b) => b.count - a.count),
			byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
			byHour,
			byDow,
			bySdlcPhase: [],
		},
		behavior: {
			compactations,
			aborts: 0,
			approvals: { allow: 0, block: 0 },
			subagentsLaunched,
			skillsInvoked: 0,
			questionsAsked,
			bugFixSignals: 0,
			rework: 0,
		},
		adoption: {
			skillsUsed: [],
			browserUsed,
			mcpUsed: false,
			subagentsUsed,
			contextToolUsed,
			autoApprovalUsed: false,
		},
		sessions: sessions.slice(0, 20),
	};
}

/** ¿La sesión pertenece al proyecto indicado? Coincidencia de cwd normalizada
 *  (sin trailing slash), mismo criterio que SessionManager.list del SDK. */
function sameCwd(sessionCwd: string, projectCwd: string): boolean {
	const norm = (p: string) => p.replace(/[\\/\\]+$/, "");
	return !!sessionCwd && norm(sessionCwd) === norm(projectCwd);
}

/** Rango [from,to] (epoch ms) para un periodo relativo a `now`. */
function periodRange(
	period: Period,
	now: number,
): { from: number; to: number } {
	const to = now;
	const day = 86_400_000;
	if (period === "today") {
		const d = new Date(now);
		return {
			from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
			to,
		};
	}
	if (period === "7d") return { from: now - 7 * day, to };
	if (period === "30d") return { from: now - 30 * day, to };
	return { from: 0, to };
}

/** Indexa todas las sesiones del dir en el periodo. */
export function indexUsage(opts: IndexOptions): IndexResult {
	const period: Period = opts.period ?? "all";
	const now = opts.now ?? Date.now();
	const tz = opts.timezone;
	const projectCwd = opts.projectCwd;
	const { from, to } = periodRange(period, now);

	let files: string[] = [];
	try {
		files = fs
			.readdirSync(opts.sessionsDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => opts.sessionsDir + "/" + f);
	} catch {
		files = [];
	}

	// Una sola fuente de verdad: todos los turnos de las sesiones del periodo/proyecto.
	const allTurns: TurnRecord[] = [];
	const metas = new Map<string, SessionMeta>();
	for (const file of files) {
		const parsed = parseRows(file);
		if (!parsed || !parsed.firstTs) continue;
		if (parsed.firstTs < from || parsed.firstTs > to) continue; // fuera de periodo
		const { turns, meta } = toTurns(parsed, file, tz);
		if (projectCwd && !sameCwd(meta.cwd, projectCwd)) continue; // fuera de proyecto
		allTurns.push(...turns);
		metas.set(file, meta);
	}

	return {
		snapshot: summarize(allTurns, metas),
		periodFrom: from,
		periodTo: to,
	};
}
