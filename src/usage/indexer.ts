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
	type ByLanguage,
	type ByArtifact,
	type ByDay,
} from "./report-schema";
import {
	classifyLanguage,
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
		byLanguage: ByLanguage[];
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

interface SessionAgg {
	summary: SessionSummary;
	byModel: Map<string, ByModel>;
	byProvider: Map<string, ByProvider>;
	byTool: Map<string, number>;
	byLanguage: Map<string, ByLanguage>;
	byArtifact: Map<string, number>;
	byDay: Map<string, ByDay>;
	byHour: number[];
	byDow: number[];
	compactations: number;
	subagentsLaunched: number;
	questionsAsked: number;
	browserUsed: boolean;
	subagentsUsed: boolean;
	contextToolUsed: boolean;
}

function aggregate(
	parsed: Parsed,
	file: string,
	tz: string | undefined,
): SessionAgg {
	const agg: SessionAgg = {
		summary: {
			path: file,
			firstMessage: parsed.firstMessage ?? "",
			cwd: "",
			firstTs: parsed.firstTs,
			lastTs: parsed.lastTs,
			tokensIn: 0,
			tokensOut: 0,
			cost: 0,
			turns: 0,
			assistedKloc: 0,
		},
		byModel: new Map(),
		byProvider: new Map(),
		byTool: new Map(),
		byLanguage: new Map(),
		byArtifact: new Map(),
		byDay: new Map(),
		byHour: new Array(24).fill(0),
		byDow: new Array(7).fill(0),
		compactations: 0,
		subagentsLaunched: 0,
		questionsAsked: 0,
		browserUsed: false,
		subagentsUsed: false,
		contextToolUsed: false,
	};
	let model = "";
	let provider = "";
	const addUsage = (u: any, isTurn: boolean) => {
		if (!u) return;
		const input = Number(u.input ?? 0) || 0;
		const output = Number(u.output ?? 0) || 0;
		const cacheRead = Number(u.cacheRead ?? 0) || 0;
		const cacheWrite = Number(u.cacheWrite ?? 0) || 0;
		const cost = toCost(u.cost);
		const tk = input + output + cacheRead + cacheWrite;
		agg.summary.tokensIn += input;
		agg.summary.tokensOut += output;
		agg.summary.cost += cost;
		if (isTurn) agg.summary.turns += 1;
		if (model || provider) {
			const mk = model || "(unknown)";
			const m = agg.byModel.get(mk) ?? {
				model: mk,
				provider,
				tokens: 0,
				cost: 0,
				turns: 0,
			};
			m.tokens += tk;
			m.cost += cost;
			if (isTurn) m.turns += 1;
			if (provider) m.provider = provider;
			agg.byModel.set(mk, m);
		}
		if (provider) {
			const p = agg.byProvider.get(provider) ?? {
				provider,
				tokens: 0,
				cost: 0,
			};
			p.tokens += tk;
			p.cost += cost;
			agg.byProvider.set(provider, p);
		}
	};
	for (const r of parsed.rows) {
		if (r.kind === "session" && r.cwd) agg.summary.cwd = r.cwd;
		else if (r.kind === "model") {
			if (r.model) model = r.model;
			if (r.provider) provider = r.provider;
		} else if (r.kind === "compaction") {
			agg.compactations += 1;
			addUsage(r.usage, false);
		} else if (r.kind === "assistant") {
			addUsage(r.usage, true);
			if (r.ts !== null) {
				const { date, hour, dow } = localParts(r.ts, tz);
				agg.byHour[hour] += 1;
				agg.byDow[dow] += 1;
				const u = r.usage ?? {};
				const tk =
					(Number(u.input ?? 0) || 0) +
					(Number(u.output ?? 0) || 0) +
					(Number(u.cacheRead ?? 0) || 0) +
					(Number(u.cacheWrite ?? 0) || 0);
				const cost = toCost(u.cost);
				const day = agg.byDay.get(date) ?? {
					date,
					tokens: 0,
					cost: 0,
					turns: 0,
				};
				day.tokens += tk;
				day.cost += cost;
				day.turns += 1;
				agg.byDay.set(date, day);
			}
			for (const tool of r.tools ?? []) {
				const name = tool.name;
				agg.byTool.set(name, (agg.byTool.get(name) ?? 0) + 1);
				const a = tool.args ?? {};
				if (name === "write" || name === "edit") {
					const fp = String(a.path ?? a.file_path ?? a.filePath ?? "");
					let lines = 0;
					if (name === "write") lines = countLines(a.content);
					else if (Array.isArray(a.edits))
						for (const ed of a.edits) lines += countLines(ed?.newText);
					if (fp) {
						const lang = classifyLanguage(fp);
						const kind = classifyArtifactKind(fp);
						const L = agg.byLanguage.get(lang) ?? {
							language: lang,
							files: 0,
							edits: 0,
							assistedKloc: 0,
						};
						if (name === "write") L.files += 1;
						else L.edits += 1;
						L.assistedKloc += lines / 1000;
						agg.byLanguage.set(lang, L);
						agg.byArtifact.set(kind, (agg.byArtifact.get(kind) ?? 0) + 1);
					}
					agg.summary.assistedKloc += lines / 1000;
				}
				if (name === "ask_user_question") agg.questionsAsked += 1;
				if (name === "Agent") {
					agg.subagentsLaunched += 1;
					agg.subagentsUsed = true;
				}
				if (name === "get_subagent_result") agg.subagentsUsed = true;
				if (
					name === "agent_browser" ||
					name === "web_search" ||
					name === "web_fetch"
				)
					agg.browserUsed = true;
				if (name === "context" || name === "project_report")
					agg.contextToolUsed = true;
			}
		}
	}
	return agg;
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

	const kpis = emptyKpis();
	const byModel = new Map<string, ByModel>();
	const byProvider = new Map<string, ByProvider>();
	const byTool = new Map<string, number>();
	const byLanguage = new Map<string, ByLanguage>();
	const byArtifact = new Map<string, number>();
	const byDay = new Map<string, ByDay>();
	const byHour = new Array(24).fill(0);
	const byDow = new Array(7).fill(0);
	const sessions: SessionSummary[] = [];
	let compactations = 0,
		subagentsLaunched = 0,
		questionsAsked = 0;
	let browserUsed = false,
		subagentsUsed = false,
		contextToolUsed = false;

	let files: string[] = [];
	try {
		files = fs
			.readdirSync(opts.sessionsDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => opts.sessionsDir + "/" + f);
	} catch {
		files = [];
	}

	for (const file of files) {
		const parsed = parseRows(file);
		if (!parsed || !parsed.firstTs) continue;
		if (parsed.firstTs < from || parsed.firstTs > to) continue; // fuera de periodo
		const agg = aggregate(parsed, file, tz);
		if (projectCwd && !sameCwd(agg.summary.cwd, projectCwd)) continue; // fuera de proyecto
		kpis.tokensIn += agg.summary.tokensIn;
		kpis.tokensOut += agg.summary.tokensOut;
		kpis.cost += agg.summary.cost;
		kpis.turns += agg.summary.turns;
		kpis.sessions += 1;
		kpis.activeMs +=
			agg.summary.firstTs && agg.summary.lastTs
				? agg.summary.lastTs - agg.summary.firstTs
				: 0;
		sessions.push(agg.summary);
		compactations += agg.compactations;
		subagentsLaunched += agg.subagentsLaunched;
		questionsAsked += agg.questionsAsked;
		browserUsed = browserUsed || agg.browserUsed;
		subagentsUsed = subagentsUsed || agg.subagentsUsed;
		contextToolUsed = contextToolUsed || agg.contextToolUsed;
		for (const [k, v] of agg.byModel) {
			const cur = byModel.get(k);
			byModel.set(
				k,
				cur
					? {
							...cur,
							tokens: cur.tokens + v.tokens,
							cost: cur.cost + v.cost,
							turns: cur.turns + v.turns,
						}
					: v,
			);
		}
		for (const [k, v] of agg.byProvider) {
			const cur = byProvider.get(k);
			byProvider.set(
				k,
				cur
					? { ...cur, tokens: cur.tokens + v.tokens, cost: cur.cost + v.cost }
					: v,
			);
		}
		for (const [k, v] of agg.byTool) byTool.set(k, (byTool.get(k) ?? 0) + v);
		for (const [k, v] of agg.byLanguage) {
			const cur = byLanguage.get(k);
			byLanguage.set(
				k,
				cur
					? {
							...cur,
							files: cur.files + v.files,
							edits: cur.edits + v.edits,
							assistedKloc: cur.assistedKloc + v.assistedKloc,
						}
					: v,
			);
		}
		for (const [k, v] of agg.byArtifact)
			byArtifact.set(k, (byArtifact.get(k) ?? 0) + v);
		for (const [k, v] of agg.byDay) {
			const cur = byDay.get(k);
			byDay.set(
				k,
				cur
					? {
							...cur,
							tokens: cur.tokens + v.tokens,
							cost: cur.cost + v.cost,
							turns: cur.turns + v.turns,
						}
					: v,
			);
		}
		for (let i = 0; i < 24; i++) byHour[i] += agg.byHour[i];
		for (let i = 0; i < 7; i++) byDow[i] += agg.byDow[i];
	}

	kpis.avgTurnTokens =
		kpis.turns > 0
			? Math.round((kpis.tokensIn + kpis.tokensOut) / kpis.turns)
			: 0;
	// cacheHitPct agregado: F1 lo deja en 0 (no hay desglose cacheRead/Write por
	// sesión consolidado; byModel.tokens lo aproxima). Se refina en F2 si hace falta.

	const byToolArr: ByTool[] = [...byTool.entries()]
		.map(([tool, count]) => ({ tool, count }))
		.sort((a, b) => b.count - a.count);
	const byArtifactArr: ByArtifact[] = [...byArtifact.entries()]
		.map(([kind, count]) => ({ kind, count }))
		.sort((a, b) => b.count - a.count);
	const topSessions = [...sessions]
		.sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut))
		.slice(0, 20);

	return {
		snapshot: {
			kpis,
			breakdowns: {
				byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
				byProvider: [...byProvider.values()].sort(
					(a, b) => b.tokens - a.tokens,
				),
				byTool: byToolArr,
				byLanguage: [...byLanguage.values()].sort(
					(a, b) => b.assistedKloc - a.assistedKloc,
				),
				byArtifact: byArtifactArr,
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
			sessions: topSessions,
		},
		periodFrom: from,
		periodTo: to,
	};
}
