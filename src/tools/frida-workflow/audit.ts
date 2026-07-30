// frida-workflow — audit JSONL append-only (el registro del que se resucita).
//
// espejo del subsystem de rpiv: header + filas stage. Fase 1 = header + filas de
// etapa (éxito/fallo/abort). Las filas route/loop-cap llegan en Fases 2/6.
//
// Paths: el runner recibe `runsDir` (computado por el host como
// `<globalStorageUri>/workflows/<encoded-cwd>/runs`). Cada run = `<runId>.jsonl`.

import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { Output } from "./types";

/** Versión del schema del trail. Bump = refuse resume de trails viejos (Fase 3). */
export const STATE_SCHEMA_VERSION = 2;

/** Codifica un cwd a segmento de path seguro (espejo de SessionManager). */
export function encodeCwd(cwd: string): string {
	// Reemplaza separadores y caracteres problemáticos; Lowercase no (case-sensitive).
	return cwd.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "") || "root";
}

/** `YYYY-MM-DD_HH-MM-SS-<4hex>` — igual formato que rpiv. */
export function generateRunId(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const ts =
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
		`${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
	const hex = Math.floor(Math.random() * 0x10000)
		.toString(16)
		.padStart(4, "0");
	return `${ts}-${hex}`;
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export interface WorkflowHeader {
	type: "workflow";
	runId: string;
	workflow: string;
	input: string;
	ts: string;
	v: number;
}

export type StageStatus = "completed" | "failed" | "aborted";

export interface StageRow {
	type: "stage";
	runId: string;
	stage: string;
	skill?: string;
	status: StageStatus;
	ts: string;
	/** Sesión hija que respaldó la etapa (para reattach/inspect). */
	session?: { id: string; file?: string };
	/** Handle primario que la etapa dejó al downstream. */
	primaryHandle?: string;
	/** Output validado (data + artifacts) — para replay al resumir (Fase 3). */
	output?: Output;
	error?: string;
}

/** Fila de routing: un EdgeFn decidió ir de `from` a `to` (to puede ser "stop"). */
export interface RouteRow {
	type: "route";
	runId: string;
	from: string;
	to: string;
	ts: string;
}

// ---------------------------------------------------------------------------
// Escritores
// ---------------------------------------------------------------------------

function runFile(runsDir: string, runId: string): string {
	return join(runsDir, `${runId}.jsonl`);
}

/** Escribe el header; crea `runsDir`. Devuelve false si el FS falla (sin lanzar). */
export function writeHeader(runsDir: string, h: WorkflowHeader): boolean {
	try {
		mkdirSync(runsDir, { recursive: true });
		writeFileSync(runFile(runsDir, h.runId), `${JSON.stringify(h)}\n`, {
			flag: "wx",
		});
		return true;
	} catch {
		return false;
	}
}

/** Append de una fila stage. Sin lanzar (best-effort; el run sigue). */
export function appendStageRow(runsDir: string, row: StageRow): void {
	try {
		appendFileSync(runFile(runsDir, row.runId), `${JSON.stringify(row)}\n`);
	} catch {
		/* noop — el run continúa aunque el audit no persista una fila */
	}
}

/** Append de una fila route (un EdgeFn decidió). Sin lanzar. */
export function appendRouteRow(runsDir: string, row: RouteRow): void {
	try {
		appendFileSync(runFile(runsDir, row.runId), `${JSON.stringify(row)}\n`);
	} catch {
		/* noop */
	}
}

/** Lee y parsea todas las filas de un run (para tests/inspect). */
export function readRun(
	runsDir: string,
	runId: string,
): Array<Record<string, unknown>> {
	try {
		const raw = readFileSync(runFile(runsDir, runId), "utf8");
		return raw
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => JSON.parse(l) as Record<string, unknown>);
	} catch {
		return [];
	}
}

export type TrailRow = WorkflowHeader | StageRow | RouteRow;

export interface Trail {
	header: WorkflowHeader;
	rows: Array<StageRow | RouteRow>;
}

/** Trail tipado para resume: header + filas stage/route en orden. */
export function readTrail(runsDir: string, runId: string): Trail | undefined {
	try {
		const raw = readFileSync(runFile(runsDir, runId), "utf8");
		const lines = raw.split("\n").filter((l) => l.trim());
		if (lines.length === 0) return undefined;
		const parsed = lines.map((l) => JSON.parse(l) as TrailRow);
		const header = parsed.find(
			(r): r is WorkflowHeader => r.type === "workflow",
		);
		if (!header) return undefined;
		const rows = parsed.filter(
			(r): r is StageRow | RouteRow => r.type !== "workflow",
		);
		return { header, rows };
	} catch {
		return undefined;
	}
}

/** Sólo el header de un run. */
export function readHeader(
	runsDir: string,
	runId: string,
): WorkflowHeader | undefined {
	return readTrail(runsDir, runId)?.header;
}

// ---------------------------------------------------------------------------
// Índice de nombres (--name → runId) para /wf @<name>
// ---------------------------------------------------------------------------

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;

function namesFile(runsDir: string): string {
	return join(runsDir, "names.json");
}

function readNames(runsDir: string): Record<string, string> {
	try {
		return JSON.parse(readFileSync(namesFile(runsDir), "utf8")) as Record<
			string,
			string
		>;
	} catch {
		return {};
	}
}

export type ClaimResult =
	| { ok: true }
	| {
			ok: false;
			reason: "invalid" | "collision" | "write-failed";
			runId?: string;
	  };

/** Valida + revisa colisión + persiste el alias. Nada se escribe si falla. */
export function claimName(
	runsDir: string,
	slug: string,
	runId: string,
): ClaimResult {
	if (!NAME_RE.test(slug)) return { ok: false, reason: "invalid" };
	const names = readNames(runsDir);
	if (names[slug] && names[slug] !== runId)
		return { ok: false, reason: "collision", runId: names[slug] };
	names[slug] = runId;
	try {
		mkdirSync(runsDir, { recursive: true });
		writeFileSync(namesFile(runsDir), JSON.stringify(names, null, 2) + "\n");
		return { ok: true };
	} catch {
		return { ok: false, reason: "write-failed" };
	}
}

/** Libera un alias (al fallar la creación del run antes del header). */
export function releaseName(
	runsDir: string,
	slug: string,
	runId: string,
): void {
	const names = readNames(runsDir);
	if (names[slug] === runId) {
		delete names[slug];
		try {
			writeFileSync(namesFile(runsDir), JSON.stringify(names, null, 2) + "\n");
		} catch {
			/* noop */
		}
	}
}

/** Resuelve un alias a runId (para /wf @<name>). */
export function resolveName(runsDir: string, slug: string): string | undefined {
	return readNames(runsDir)[slug];
}

/** Resuelve un ref a runId: @<name> | path .jsonl | run-id directo. */
export function resolveRef(runsDir: string, ref: string): string | undefined {
	const trimmed = ref.trim();
	if (trimmed.startsWith("@"))
		return resolveName(runsDir, trimmed.slice(1).trim());
	if (trimmed.endsWith(".jsonl"))
		return basename(trimmed).slice(0, -".jsonl".length);
	return readTrail(runsDir, trimmed) ? trimmed : undefined;
}

export function nowIso(): string {
	return new Date().toISOString();
}
