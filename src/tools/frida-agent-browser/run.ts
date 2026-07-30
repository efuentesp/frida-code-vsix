/**
 * frida-agent-browser — ejecución del binario upstream + parseo (porte nativo).
 *
 * Réplica simplificada de la capa de ejecución del referencia
 * (lib/orchestration/browser-run/{process-output,final-result}.js):
 *  - spawn de `agent-browser <args> --json` con captura de stdout/stderr.
 *  - timeout + abort (signal) → SIGTERM.
 *  - ENOENT → resultado graceful "missing-binary" (no crashea; guía a instalar).
 *  - parse JSON → content + details (el binario ya devuelve @refs en snapshots).
 *  - outputPath → vuelca el resultado a archivo durable.
 *  - bash-guard: detecta `agent-browser` por bash para forzar el tool nativo.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { AGENT_BROWSER_BINARY } from "./constants";
import { MISSING_BINARY_MESSAGE } from "./prompt";
import { isEnvelope } from "./results/envelope";
import {
	parseFailureResult,
	presentAgentBrowserResult,
} from "./results/presentation";

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
	/** Presente si el binario no se pudo lanzar (p.ej. ENOENT: no está en PATH). */
	spawnError?: { code?: string; message: string };
}

export interface RunOptions {
	args: string[];
	stdin?: string;
	cwd: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

/** Seam de inyección para tests: una función spawn-like. Loose a propósito
 *  (los overloads de `typeof spawn` no aceptan un fake simple). */
export type SpawnFn = (
	command: string,
	args: string[],
	options: object,
) => unknown;

/** Lanza el binario upstream y captura stdout/stderr. Inyecta dependencia para tests. */
export async function runAgentBrowser(
	opts: RunOptions,
	dep?: { spawnFn?: SpawnFn },
): Promise<RunResult> {
	const doSpawn: SpawnFn =
		(dep?.spawnFn as SpawnFn | undefined) ?? (spawn as SpawnFn);
	return new Promise<RunResult>((resolve) => {
		const child = doSpawn(AGENT_BROWSER_BINARY, opts.args, {
			cwd: opts.cwd,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		}) as {
			stdout?: { on: (e: string, cb: (d: Buffer) => void) => void };
			stderr?: { on: (e: string, cb: (d: Buffer) => void) => void };
			stdin?: { end: (d?: string) => void };
			on: (e: string, cb: (...a: any[]) => void) => void;
			kill: (s?: string) => void;
		};

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const finish = (r: Partial<RunResult>) => {
			if (settled) return;
			settled = true;
			resolve({
				stdout,
				stderr,
				exitCode: r.exitCode ?? null,
				timedOut,
				spawnError: r.spawnError,
			});
		};

		child.stdout?.on("data", (d) => (stdout += d.toString()));
		child.stderr?.on("data", (d) => (stderr += d.toString()));

		child.on("error", (err: NodeJS.ErrnoException) => {
			finish({
				spawnError: { code: err.code, message: err.message },
				exitCode: null,
			});
		});
		child.on("close", (code) => finish({ exitCode: code ?? 0 }));

		if (opts.signal) {
			if (opts.signal.aborted) {
				try {
					child.kill("SIGTERM");
				} catch {
					/* noop */
				}
				finish({ exitCode: null });
			} else {
				opts.signal.addEventListener(
					"abort",
					() => {
						try {
							child.kill("SIGTERM");
						} catch {
							/* noop */
						}
					},
					{ once: true },
				);
			}
		}

		if (opts.timeoutMs && opts.timeoutMs > 0) {
			setTimeout(() => {
				timedOut = true;
				try {
					child.kill("SIGTERM");
				} catch {
					/* noop */
				}
			}, opts.timeoutMs);
		}

		try {
			if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
			else child.stdin?.end();
		} catch {
			/* noop */
		}
	});
}

// ───────────────────────── parseo del output ─────────────────────────

export interface BrowserToolResult {
	content: { type: "text"; text: string }[];
	/** Siempre presente (AgentToolResult<unknown> lo requiere). */
	details: unknown;
	isError?: boolean;
}

/** ¿El resultado indica binario ausente (ENOENT)? */
export function isMissingBinary(r: RunResult): boolean {
	return Boolean(
		r.spawnError &&
			(r.spawnError.code === "ENOENT" ||
				/not found|ENOENT/i.test(r.spawnError.message)),
	);
}

/** Resultado graceful cuando el binario upstream no está instalado. */
export function missingBinaryResult(): BrowserToolResult {
	return {
		content: [{ type: "text", text: MISSING_BINARY_MESSAGE }],
		details: {
			failureCategory: "missing-binary",
			binary: AGENT_BROWSER_BINARY,
		},
		isError: true,
	};
}

export interface ParseOpts {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	mode: string;
	/** argv (sin --json; puede incluir el prefijo --session) — para detectar comando. */
	args: string[];
	sessionName?: string;
	cwd: string;
}

/**
 * Parsea stdout JSON del binario → content + details via la capa de presentación
 * (Fase 1): snapshot compacto con @refs, categorías y nextActions. Si no es JSON,
 * volcado crudo + failureCategory parse-failure.
 */
export function parseAgentBrowserOutput(opts: ParseOpts): BrowserToolResult {
	const trimmed = opts.stdout.trim();
	const failed = opts.exitCode !== null && opts.exitCode !== 0;

	if (trimmed === "") {
		return {
			content: [
				{
					type: "text",
					text:
						opts.stderr.trim() ||
						`(agent-browser exited with code ${opts.exitCode ?? "?"} and no output.)`,
				},
			],
			details: {
				mode: opts.mode,
				command: undefined,
				session: opts.sessionName,
				stderr: opts.stderr,
				exitCode: opts.exitCode,
				resultCategory: failed ? "failure" : "success",
				failureCategory: failed ? "upstream-error" : undefined,
			},
			isError: failed,
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return parseFailureResult(opts);
	}
	if (!isEnvelope(parsed)) {
		return parseFailureResult(opts);
	}
	return presentAgentBrowserResult({ envelope: parsed, ...opts });
}

/** Vuelca el payload (parsed result) a outputPath; devuelve la ruta absoluta usada. */
export function applyOutputPath(
	cwd: string,
	outputPath: string,
	payload: unknown,
): string {
	const abs = path.isAbsolute(outputPath)
		? outputPath
		: path.resolve(cwd, outputPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	const body =
		typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
	fs.writeFileSync(abs, body, "utf8");
	return abs;
}

// ───────────────────────── bash-guard ─────────────────────────

const HARMLESS_INSPECTION = /^(agent-browser)\s+(-h|--help|-v|--version)\b/;

/** ¿El comando bash parece invocar directamente `agent-browser`? */
export function looksLikeAgentBrowserBash(command: string): boolean {
	return /\bagent-browser\b/.test(command);
}

/** ¿Es una inspección inofensiva (--help/--version) que sí permitimos por bash? */
export function isHarmlessAgentBrowserInspection(command: string): boolean {
	return HARMLESS_INSPECTION.test(command.trim());
}
