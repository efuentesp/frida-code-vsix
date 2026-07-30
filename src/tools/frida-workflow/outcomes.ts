// frida-workflow — catálogo de outcomes (collectors + parsers) para Fase 2.
//
// Modelos de descubrimiento: texto del transcript, dif de FS (git), tool-calls,
// git commit. Más composición (unionCollectors) y composites (gitCommitOutcome,
// sideEffectOutcome). El runner captura `preSnapshot` (git) antes de cada etapa
// con outcome y lo pasa en CollectCtx.

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { extractAssistantText, fs, opaque, url } from "./dsl";
import type {
	Artifact,
	CollectCtx,
	CollectResult,
	Collector,
	Handle,
	OutputSpec,
	Parser,
	StageSnapshot,
} from "./types";

// ---------------------------------------------------------------------------
// Snapshot del FS (lo captura el runner antes de la etapa)
// ---------------------------------------------------------------------------

/** Captura `git status --porcelain` + HEAD sha. Best-effort (no lanza). */
export function captureSnapshot(cwd: string): StageSnapshot {
	const run = (args: string[]): string => {
		try {
			return execSync("git " + args.join(" "), {
				cwd,
				encoding: "utf8",
				timeout: 4000,
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			return "";
		}
	};
	const gitStatus = run(["status", "--porcelain"]);
	let headSha: string | undefined;
	const head = run(["rev-parse", "HEAD"]);
	if (head) headSha = head.trim() || undefined;
	return { gitStatus, headSha };
}

// ---------------------------------------------------------------------------
// Collectors — escanean el transcript
// ---------------------------------------------------------------------------

/** Escanea URLs en el texto del assistant. Emite `url` handles. */
export function urlCollector(opts: { pattern?: RegExp } = {}): Collector {
	const re = opts.pattern ?? /https?:\/\/[^\s)"'<>]+/g;
	const global = re.global ? re : new RegExp(re.source, re.flags + "g");
	return (ctx) => {
		const seen = new Set<string>();
		const artifacts: Artifact[] = [];
		for (const m of ctx.messages) {
			const text = extractAssistantText(m);
			if (!text) continue;
			for (const match of text.matchAll(global)) {
				const href = (match[1] ?? match[0]) as string;
				if (href && !seen.has(href)) {
					seen.add(href);
					artifacts.push({
						handle: url(href),
						role: artifacts.length === 0 ? "primary" : "secondary",
					});
				}
			}
		}
		return artifacts.length
			? { kind: "ok", artifacts }
			: { kind: "fatal", message: "urlCollector: sin URLs" };
	};
}

/**
 * Escanea el FS: archivos nuevos en `<cwd>/<dir>` con extensión `ext` (el más
 * nuevo = primary). Útil cuando la skill escribe a una ruta predecible.
 */
export function directoryPathCollector(opts: {
	dir: string;
	ext?: string;
}): Collector {
	return (ctx) => {
		const absDir = isAbsolute(opts.dir) ? opts.dir : join(ctx.cwd, opts.dir);
		let entries: string[];
		try {
			entries = readdirSync(absDir);
		} catch {
			return {
				kind: "fatal",
				message: `directoryPathCollector: no se pudo leer ${absDir}`,
			};
		}
		const ext = opts.ext ? "." + opts.ext.replace(/^\./, "") : null;
		const files = entries
			.filter((f) => !ext || f.endsWith(ext))
			.map((f) => ({ f, abs: join(absDir, f) }))
			.filter((x) => {
				try {
					return statSync(x.abs).isFile();
				} catch {
					return false;
				}
			})
			.sort((a, b) => mtime(b.abs) - mtime(a.abs));
		if (files.length === 0) {
			return {
				kind: "fatal",
				message: `directoryPathCollector: sin archivos en ${absDir}`,
			};
		}
		const artifacts: Artifact[] = files.map((x, i) => ({
			handle: fs(x.abs),
			role: i === 0 ? "primary" : "secondary",
		}));
		return { kind: "ok", artifacts };
	};
}

// ---------------------------------------------------------------------------
// Collectors — observan tool calls
// ---------------------------------------------------------------------------

export interface ToolCallLike {
	name?: string;
	input?: unknown;
	[key: string]: unknown;
}

/** Walks `tool_use` parts; el autor decide cuáles mantener y cómo mapearlos. */
export function toolCallCollector(opts: {
	match: (tc: ToolCallLike) => boolean;
	toArtifact: (tc: ToolCallLike) => Artifact;
}): Collector {
	return (ctx) => {
		const artifacts: Artifact[] = [];
		for (const m of ctx.messages) {
			for (const tc of iterToolCalls(m)) {
				if (opts.match(tc)) artifacts.push(opts.toArtifact(tc));
			}
		}
		return artifacts.length
			? { kind: "ok", artifacts }
			: {
					kind: "fatal",
					message: "toolCallCollector: sin tool calls matching",
				};
	};
}

// ---------------------------------------------------------------------------
// Collectors — dif de FS (git)
// ---------------------------------------------------------------------------

/** Un artefacto fs por archivo tocado DURANTE la etapa (pre vs post `git status`). */
export function workspaceDiffCollector(
	opts: { filter?: (path: string) => boolean } = {},
): Collector {
	return (ctx) => {
		const pre = parseStatus(ctx.preSnapshot?.gitStatus ?? "");
		const post = parseStatus(captureSnapshot(ctx.cwd).gitStatus);
		const touched: string[] = [];
		for (const [file, code] of post) {
			if (pre.get(file) !== code) touched.push(file); // nueva o cambió de status
		}
		for (const [file, code] of pre) {
			if (!post.has(file)) touched.push(file); // limpiada durante la etapa
		}
		const filtered = opts.filter ? touched.filter(opts.filter) : touched;
		if (filtered.length === 0) {
			return {
				kind: "fatal",
				message: "workspaceDiffCollector: sin archivos tocados",
			};
		}
		const artifacts: Artifact[] = filtered.map((p, i) => ({
			handle: fs(p),
			role: i === 0 ? "primary" : "secondary",
		}));
		return { kind: "ok", artifacts };
	};
}

/** Detecta un nuevo commit HEAD vs el snapshot pre-stage. Emite `opaque(sha)`. */
export const gitCommitCollector: Collector = (ctx) => {
	const pre = ctx.preSnapshot?.headSha;
	const post = captureSnapshot(ctx.cwd).headSha;
	if (!post || post === pre) {
		return { kind: "fatal", message: "gitCommitCollector: sin nuevo commit" };
	}
	return { kind: "ok", artifacts: [{ handle: opaque(post), role: "primary" }] };
};

// ---------------------------------------------------------------------------
// Composición
// ---------------------------------------------------------------------------

/** Corre N collectors, concatena artefactos. Fatal sólo si TODOS fallaron. */
export function unionCollectors(...cs: Collector[]): Collector {
	return (ctx) => {
		const artifacts: Artifact[] = [];
		let fatalCount = 0;
		let lastMsg = "";
		for (const c of cs) {
			const r = c(ctx);
			if (r.kind === "ok") artifacts.push(...r.artifacts);
			else {
				fatalCount++;
				lastMsg = r.message;
			}
		}
		if (artifacts.length === 0) {
			return cs.length > 0 && fatalCount === cs.length
				? {
						kind: "fatal",
						message: `unionCollectors: todos fallaron (último: ${lastMsg})`,
					}
				: { kind: "ok", artifacts: [] };
		}
		return { kind: "ok", artifacts };
	};
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** `JSON.parse` del cuerpo del artefacto fs primario. */
export const jsonBodyParser: Parser = (artifacts, ctx) => {
	const primary = artifacts.find((a) => a.role === "primary") ?? artifacts[0];
	if (primary?.handle.kind !== "fs") return undefined;
	const abs = isAbsolute(primary.handle.path)
		? primary.handle.path
		: join(ctx.cwd, primary.handle.path);
	try {
		return JSON.parse(readFileSync(abs, "utf8"));
	} catch {
		return undefined;
	}
};

export interface GitCommitData {
	sha: string;
	prevSha: string | undefined;
}

/** Parser del opaque(sha) de gitCommitCollector → `{sha, prevSha}`. */
export const gitCommitParser: Parser<GitCommitData> = (artifacts, ctx) => {
	const primary = artifacts.find((a) => a.role === "primary") ?? artifacts[0];
	if (primary?.handle.kind !== "opaque") return undefined;
	return { sha: primary.handle.id, prevSha: ctx.preSnapshot?.headSha };
};

// ---------------------------------------------------------------------------
// Composites (collector + parser listos)
// ---------------------------------------------------------------------------

export const gitCommitOutcome: OutputSpec = {
	collector: gitCommitCollector,
	parser: gitCommitParser,
};

// noopCollector vive en dsl.ts; re-exportamos el composite side-effect.
export { noopCollector } from "./dsl";

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function mtime(abs: string): number {
	try {
		return statSync(abs).mtimeMs;
	} catch {
		return 0;
	}
}

/** `git status --porcelain` → Map<path, statusCode> (code = 2 chars XY). */
function parseStatus(porcelain: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of porcelain.split("\n")) {
		if (!line.trim()) continue;
		// "XY path" o "XY orig -> path"
		const code = line.slice(0, 2);
		const rest = line.slice(3);
		const path = rest.includes(" -> ") ? rest.split(" -> ")[1]! : rest;
		const clean = path.trim().replace(/^"|"$/g, "");
		if (clean) map.set(clean, code);
	}
	return map;
}

/** Itera tool calls de un mensaje (shape del SDK — defensivo). */
function* iterToolCalls(message: unknown): Generator<ToolCallLike> {
	const m = message as Record<string, unknown> | null;
	if (!m) return;
	const content = m.content;
	if (!Array.isArray(content)) {
		// Algunos formatos exponen tool_calls a nivel mensaje.
		const tcs = m.tool_calls;
		if (Array.isArray(tcs)) for (const tc of tcs) yield tc as ToolCallLike;
		return;
	}
	for (const part of content) {
		const p = part as Record<string, unknown> | null;
		if (!p) continue;
		if (
			p.type === "tool_use" ||
			p.type === "tool_call" ||
			typeof p.name === "string"
		) {
			yield p as ToolCallLike;
		}
	}
}

export type { Collector, Parser, Handle, CollectResult };
