/**
 * frida-agent-browser — verificación de artefactos (Fase 4).
 *
 * Porte de results/artifact-manifest.js + presentation/artifacts.js del referencia:
 * tras un comando que produce archivos (screenshot/pdf/download/record/trace/…),
 * verifica en disco que el archivo realmente se guardó y expone
 * `details.artifactVerification` con entradas por archivo {absolutePath, exists,
 * sizeBytes, kind, path, requestedPath, state, status} + conteos (verifiedCount,
 * missingCount, …) y un booleano `verified`. Así el agente puede declarar PASS/FAIL
 * confiable en flujos de evidencia sin asumir que "success:true" implica archivo.
 *
 * El path guardado lo reporta el binario en `data.path` (contrato verificado vs 0.33.1);
 * los requestedPaths (del argv) son fallback. Pre-spawn se crean los dirs padre.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentBrowserData } from "./envelope";

const KIND_BY_COMMAND: Record<string, string> = {
	screenshot: "image",
	pdf: "pdf",
	download: "download",
	record: "video",
	trace: "trace",
	profiler: "profile",
};

/** command (+subcommand en args) → kind, o undefined si no produce artefactos. */
export function getArtifactKind(
	command: string | undefined,
	args: string[],
): string | undefined {
	if (!command) return undefined;
	if (KIND_BY_COMMAND[command]) return KIND_BY_COMMAND[command];
	if (command === "wait" && args.includes("--download")) return "download";
	if (command === "network" && args.includes("har")) return "har";
	if (command === "state" && args.includes("save")) return "file";
	if (command === "diff" && args.includes("screenshot")) return "image";
	return undefined;
}

export function isArtifactCommand(
	command: string | undefined,
	args: string[],
): boolean {
	return getArtifactKind(command, args) !== undefined;
}

const VALUE_FLAGS = new Set(["--session", "--namespace", "--session-name"]);
const NON_FILE_SCHEMES = /^(?:data|blob|https?|javascript|mailto|file):/i;

function looksLikeFilePath(token: string): boolean {
	const t = token.trim();
	if (t === "" || NON_FILE_SCHEMES.test(t)) return false;
	if (path.isAbsolute(t)) return true;
	if (t.startsWith("./") || t.startsWith("../")) return true;
	if (t.includes("/") || t.includes(path.sep)) return true;
	const ext = path.extname(t).toLowerCase();
	return ext !== "" && ext.length <= 6; // tiene extensión de archivo
}

/** Tokens path-like en argv (positionals) + valor tras --download, como fallback. */
export function extractRequestedPaths(args: string[]): string[] {
	const out: string[] = [];
	let i = 0;
	let afterCommand = false;
	while (i < args.length) {
		const a = args[i];
		if (VALUE_FLAGS.has(a)) {
			i += 2;
			continue;
		}
		if (a === "--download") {
			const v = args[i + 1];
			if (v && looksLikeFilePath(v)) out.push(v);
			i += 2;
			continue;
		}
		if (a.startsWith("-")) {
			i++;
			continue;
		}
		if (afterCommand && looksLikeFilePath(a)) out.push(a);
		else afterCommand = true; // primer positional = comando
		i++;
	}
	return [...new Set(out)];
}

/** Path guardado reportado por el binario (data.path y variantes comunes). */
export function getSavedPath(
	data: AgentBrowserData | null | undefined,
): string | undefined {
	if (!data) return undefined;
	for (const key of ["path", "file", "savedPath", "savedFile", "download"]) {
		const v = data[key];
		if (typeof v === "string" && v.trim() !== "" && !NON_FILE_SCHEMES.test(v))
			return v.trim();
	}
	// screenshot puede anidar { screenshot: { path } } o { data: { path } }.
	const nested = data.screenshot ?? data.download;
	if (
		nested &&
		typeof nested === "object" &&
		typeof (nested as { path?: unknown }).path === "string"
	) {
		return (nested as { path: string }).path;
	}
	return undefined;
}

export interface ArtifactEntry {
	path: string;
	absolutePath: string;
	requestedPath?: string;
	exists: boolean;
	sizeBytes?: number;
	kind: string;
	/** "verified" | "missing" | "unverified" | "pending". */
	state: "verified" | "missing" | "unverified" | "pending";
	status: "saved" | "missing" | "pending";
}

export interface ArtifactVerifyOptions {
	cwd: string;
	savedPath?: string;
	requestedPaths?: string[];
	kind: string;
}

/** Verifica en disco cada path (savedPath + requestedPaths, dedupe).
 *
 *  NOTA DE CONFIANZA: savedPath proviene del binario (trusted); requestedPaths del
 *  argv del agente. El agente ya tiene capacidad equivalente de escritura vía sus
 *  tools write/edit/bash, y estas ops son mayormente read-only (stat) + mkdir para
 *  un screenshot que el propio agente solicitó — sin escalada de privilegios (el
 *  binario corre con los permisos del usuario). (ts-path-traversal = falso positivo.) */
export function verifyArtifactFiles(
	opts: ArtifactVerifyOptions,
): ArtifactEntry[] {
	const candidates: { path: string; requested?: string }[] = [];
	if (opts.savedPath) candidates.push({ path: opts.savedPath });
	for (const rp of opts.requestedPaths ?? [])
		candidates.push({ path: rp, requested: rp });

	const seen = new Set<string>();
	const entries: ArtifactEntry[] = [];
	for (const c of candidates) {
		const absolutePath = path.isAbsolute(c.path)
			? c.path
			: path.resolve(opts.cwd, c.path);
		if (seen.has(absolutePath)) continue;
		seen.add(absolutePath);
		let exists = false;
		let sizeBytes: number | undefined;
		try {
			const st = fs.statSync(absolutePath);
			exists = st.isFile();
			if (exists) sizeBytes = st.size;
		} catch {
			exists = false;
		}
		entries.push({
			path: c.path,
			absolutePath,
			requestedPath: c.requested,
			exists,
			sizeBytes,
			kind: opts.kind,
			state: exists ? "verified" : "missing",
			status: exists ? "saved" : "missing",
		});
	}
	return entries;
}

export interface ArtifactVerification {
	artifacts: ArtifactEntry[];
	verifiedCount: number;
	missingCount: number;
	pendingCount: number;
	unverifiedCount: number;
	verified: boolean;
}

/** Resume las entradas a counts + booleano `verified` (todas verificadas). */
export function buildArtifactVerificationSummary(
	entries: ArtifactEntry[],
): ArtifactVerification | undefined {
	if (entries.length === 0) return undefined;
	const count = (s: ArtifactEntry["state"]) =>
		entries.filter((e) => e.state === s).length;
	const verifiedCount = count("verified");
	const missingCount = count("missing");
	const pendingCount = count("pending");
	const unverifiedCount = count("unverified");
	return {
		artifacts: entries,
		verifiedCount,
		missingCount,
		pendingCount,
		unverifiedCount,
		verified: entries.length > 0 && verifiedCount === entries.length,
	};
}

/** Pre-spawn: crea los directorios padre de los paths de artefacto solicitados. */
export function ensureArtifactParentDirs(
	cwd: string,
	paths: string[],
): string[] {
	const created: string[] = [];
	for (const p of paths) {
		if (!looksLikeFilePath(p) || NON_FILE_SCHEMES.test(p)) continue;
		const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
		const dir = path.dirname(abs);
		try {
			fs.mkdirSync(dir, { recursive: true });
			created.push(dir);
		} catch {
			/* noop — el binario puede crearlo o fallar con contexto */
		}
	}
	return created;
}
