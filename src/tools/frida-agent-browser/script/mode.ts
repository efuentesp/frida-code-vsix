/**
 * frida-agent-browser — modo `script` (porte esencial del upstream 0.4.0).
 *
 * Ejecuta código del modelo dentro de un worker Node aislado (worker-source)
 * que expone `browser({ args, stdin?, timeoutMs? })` + `emit(value)`. El
 * padre serializa cada llamada por el ejecutor ordinario (runFn) contra una
 * sesión aislada `piab-script-<uuid>` (namespace vacío, restore deshabilitado
 * por unicidad) y devuelve UN valor JSON acotado.
 *
 * Límites del contrato (mirror del upstream):
 *  - código ≤ 64 KiB; timeout default 120 s / máx 300 s
 *  - ≤ 25 llamadas browser(); IPC 1 MiB/mensaje, 8 MiB acumulado
 *  - salida final ≤ 64 KiB; sandbox sin globals del host, sin codegen
 *
 * Simplificaciones documentadas (Fase 1): sin leases persistentes de cleanup,
 * sin restart-recovery ni spill rehydration (best-effort close en finally),
 * sin `--permission` del runtime (ver worker-source.ts).
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { LAUNCH_SCOPED_FLAGS } from "../constants";
import { isSessionlessCommand } from "../command-policy";
import { CLOSE_COMMANDS } from "../ref-guard";
import { commandOf } from "../results/presentation";
import { SANDBOX_WORKER_SOURCE } from "./worker-source";

export const SCRIPT_CODE_MAX_BYTES = 64 * 1_024;
export const SCRIPT_DEFAULT_TIMEOUT_MS = 120_000;
export const SCRIPT_MAX_TIMEOUT_MS = 300_000;
export const SCRIPT_MAX_CALLS = 25;
export const SCRIPT_FINAL_OUTPUT_MAX_BYTES = 64 * 1_024;
export const SCRIPT_IPC_MESSAGE_MAX_BYTES = 1 * 1_024 * 1_024;
export const SCRIPT_IPC_CUMULATIVE_MAX_BYTES = 8 * 1_024 * 1_024;
export const SCRIPT_NAMESPACE = "";

/** Comandos vetados dentro de browser(): lifecycle de sesión/identidad. */
const SCRIPT_FORBIDDEN_COMMANDS = new Set([
	"attach",
	"auth",
	"batch",
	"connect",
	"script",
	"session",
	"state",
]);

/** Único flag launch-scoped permitido (containment de red del propio script). */
const SCRIPT_ALLOWED_LAUNCH_FLAG = "--allowed-domains";

/** Flags vetados: launch-scoped (salvo allowed-domains) + identidad de sesión. */
const SCRIPT_FORBIDDEN_FLAGS = new Set<string>([
	...LAUNCH_SCOPED_FLAGS.filter((f) => f !== SCRIPT_ALLOWED_LAUNCH_FLAG),
	"--namespace",
	"--session",
]);

export interface ScriptBrowserParams {
	args: string[];
	stdin?: string;
	timeoutMs?: number;
}

export interface ScriptStepSummary {
	index: number;
	ok: boolean;
	resultCategory?: string;
	failureCategory?: string;
	summary?: string;
}

export type ScriptFailureCategory =
	| "script-error"
	| "validation-error"
	| "timeout"
	| "aborted"
	| "upstream-error"
	| "missing-binary";

export interface ScriptRunResult {
	ok: boolean;
	data?: unknown;
	error?: string;
	failureCategory?: ScriptFailureCategory;
	callCount: number;
	emitCount: number;
	rejectedCallCount: number;
	steps: ScriptStepSummary[];
	timedOut?: boolean;
	aborted?: boolean;
}

export interface ScriptEnvelope {
	ok: boolean;
	text: string;
	summary: string;
	resultCategory: "success" | "failure";
	failureCategory?: string;
	successCategory?: string;
	data?: unknown;
	error?: string;
}

export function compileAgentBrowserScript(
	code: unknown,
): { code: string } | { error: string } {
	if (typeof code !== "string" || code.trim().length === 0) {
		return { error: "script must be a non-empty string." };
	}
	if (Buffer.byteLength(code, "utf8") > SCRIPT_CODE_MAX_BYTES) {
		return {
			error: `script must be ${SCRIPT_CODE_MAX_BYTES} bytes or less.`,
		};
	}
	return { code };
}

export function createScriptSessionName(): string {
	return `piab-script-${randomUUID()}`;
}

export function createScriptCloseArgs(sessionName: string): string[] {
	return ["--namespace", SCRIPT_NAMESPACE, "--session", sessionName, "close"];
}

function flagNameOf(token: string): string {
	return token.split("=", 1)[0] ?? token;
}

/** Política de llamadas browser() dentro del script (mirror getScriptCallPolicyError). */
export function validateScriptBrowserParams(
	input: unknown,
): { params: ScriptBrowserParams } | { error: string; policyBlocked?: boolean } {
	if (
		typeof input !== "object" ||
		input === null ||
		Array.isArray(input)
	) {
		return { error: "script browser(params) requires an object." };
	}
	const record = input as Record<string, unknown>;
	const unsupported = Object.keys(record).find(
		(k) => !["args", "stdin", "timeoutMs"].includes(k),
	);
	if (unsupported) {
		return {
			error: `script browser(params) does not support ${unsupported}; use only args, stdin, and timeoutMs.`,
		};
	}
	const { args, stdin, timeoutMs } = record;
	if (
		!Array.isArray(args) ||
		args.length === 0 ||
		args.some((a) => typeof a !== "string")
	) {
		return {
			error: "script browser(params).args must be a non-empty string array.",
		};
	}
	if (stdin !== undefined && typeof stdin !== "string") {
		return {
			error: "script browser(params).stdin must be a string when provided.",
		};
	}
	if (
		timeoutMs !== undefined &&
		(typeof timeoutMs !== "number" ||
			!Number.isSafeInteger(timeoutMs) ||
			timeoutMs <= 0)
	) {
		return {
			error: "script browser(params).timeoutMs must be a positive integer when provided.",
		};
	}
	// Política: comando + flags.
	const command = commandOf(args as string[]);
	if (!command) {
		return {
			error: "script browser call args must contain an agent-browser command.",
			policyBlocked: true,
		};
	}
	if (CLOSE_COMMANDS.has(command)) {
		return {
			error: "script browser calls cannot close, quit, or exit their isolated session.",
			policyBlocked: true,
		};
	}
	if (SCRIPT_FORBIDDEN_COMMANDS.has(command)) {
		return {
			error: `script browser calls cannot use ${command}.`,
			policyBlocked: true,
		};
	}
	if (isSessionlessCommand(command, args as string[])) {
		return {
			error: `script browser calls cannot use sessionless/local command ${command}.`,
			policyBlocked: true,
		};
	}
	for (const token of args as string[]) {
		const flag = flagNameOf(token);
		if (SCRIPT_FORBIDDEN_FLAGS.has(flag)) {
			return {
				error: `script browser calls cannot use ${flag}; the parent owns the isolated session identity and launch policy.`,
				policyBlocked: true,
			};
		}
	}
	return {
		params: {
			args: args as string[],
			stdin: stdin as string | undefined,
			timeoutMs: timeoutMs as number | undefined,
		},
	};
}

function buildRejectedCallEnvelope(
	error: string,
	policyBlocked: boolean,
): ScriptEnvelope {
	return {
		ok: false,
		text: error,
		summary: error,
		resultCategory: "failure",
		failureCategory: policyBlocked ? "policy-blocked" : "validation-error",
		error,
	};
}

function describeScriptError(error: {
	name?: unknown;
	message?: unknown;
}): string {
	const name =
		typeof error?.name === "string" && error.name.length > 0
			? error.name.slice(0, 80)
			: "Error";
	const message =
		typeof error?.message === "string" && error.message.length > 0
			? error.message.replace(/[\r\n]+/g, " ").slice(0, 400)
			: "Script execution failed.";
	return `${name}: ${message}`;
}

function isChildMessage(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.type !== "string") return false;
	if (v.type === "ready") return true;
	if (v.type === "call")
		return (
			typeof v.id === "number" && Number.isSafeInteger(v.id) && v.id > 0
		);
	return v.type === "emit" || v.type === "complete";
}

/** Shape mínimo del child que consume el orquestador (seam para tests). */
export interface ScriptChildLike {
	stdin: { write: (s: string, cb: (e?: Error | null) => void) => void; destroy: () => void };
	stdout: { on: (e: string, cb: (d: Buffer) => void) => void };
	stderr: { on: (e: string, cb: (d: Buffer) => void) => void };
	on: (e: string, cb: (...a: unknown[]) => void) => void;
	once: (e: string, cb: (...a: unknown[]) => void) => void;
	kill: (s?: string) => void;
	exitCode: number | null;
	signalCode: string | null;
}

export type ScriptSpawnFn = (
	command: string,
	args: string[],
	options: SpawnOptionsLike,
) => ScriptChildLike;

/** Opciones mínimas de spawn que consume el orquestador (shape documentada). */
export interface SpawnOptionsLike {
	env?: NodeJS.ProcessEnv;
	stdio?: ("pipe" | "ignore" | "inherit")[] | string;
	windowsHide?: boolean;
	[key: string]: unknown;
}

export interface RunScriptOptions {
	code: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Ejecutor ordinario (se le pasa la señal de la call activa). */
	dispatch: (
		params: ScriptBrowserParams,
		signal: AbortSignal,
	) => Promise<ScriptEnvelope>;
	/** Cleanup best-effort al terminar (close de la sesión aislada). */
	cleanup?: () => Promise<void>;
	spawnFn?: ScriptSpawnFn;
}

function waitForChildExit(child: ScriptChildLike): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve();
	return new Promise((resolve) => {
		child.once("exit", () => resolve());
		child.once("error", () => resolve());
	});
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number) {
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([
		promise.catch(() => undefined),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
		}),
	]);
	if (timer) clearTimeout(timer);
}

function terminateChild(child: ScriptChildLike): NodeJS.Timeout {
	child.stdin.destroy();
	if (child.exitCode === null && child.signalCode === null)
		child.kill("SIGTERM");
	return setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	}, 250);
}

/** Fallo normalizado: siempre ok:false (mirror buildFailedRun del upstream). */
function failedRun(partial: Omit<ScriptRunResult, "ok">): ScriptRunResult {
	return { ok: false, ...partial };
}

/**
 * Orquestador del modo script. Mirror de runAgentBrowserScript del referencia:
 * spawn del worker → drain serializado de mensajes → resultado único acotado.
 * Nunca lanza; los fallos llegan como ScriptRunResult.
 */
export async function runAgentBrowserScript(
	options: RunScriptOptions,
): Promise<ScriptRunResult> {
	const compiled = compileAgentBrowserScript(options.code);
	if ("error" in compiled) {
		return {
			ok: false,
			error: compiled.error,
			failureCategory: "validation-error",
			callCount: 0,
			emitCount: 0,
			rejectedCallCount: 0,
			steps: [],
		};
	}
	const timeoutMs = options.timeoutMs ?? SCRIPT_DEFAULT_TIMEOUT_MS;
	if (
		!Number.isSafeInteger(timeoutMs) ||
		timeoutMs <= 0 ||
		timeoutMs > SCRIPT_MAX_TIMEOUT_MS
	) {
		return {
			ok: false,
			error: `script timeoutMs must be between 1 and ${SCRIPT_MAX_TIMEOUT_MS}.`,
			failureCategory: "validation-error",
			callCount: 0,
			emitCount: 0,
			rejectedCallCount: 0,
			steps: [],
		};
	}
	if (options.signal?.aborted) {
		return {
			ok: false,
			aborted: true,
			error: "Script execution was aborted.",
			failureCategory: "aborted",
			callCount: 0,
			emitCount: 0,
			rejectedCallCount: 0,
			steps: [],
		};
	}

	const isElectron = Boolean(process.versions.electron);
	// SAFETY: node:child_process.spawn cumple la firma (cmd, args, opts) → ChildProcess
	// con stdin/stdout/stderr/kill/exitCode/signalCode; el doble cast solo reconcilia
	// los overloads tipados de Node con ScriptChildLike (mismo patrón que SpawnFn en run.ts).
	const doSpawn: ScriptSpawnFn =
		options.spawnFn ?? (spawn as unknown as ScriptSpawnFn);
	const child = doSpawn(
		process.execPath,
		[
			"--max-old-space-size=64",
			"-e",
			SANDBOX_WORKER_SOURCE,
			String(SCRIPT_IPC_MESSAGE_MAX_BYTES),
			String(SCRIPT_IPC_CUMULATIVE_MAX_BYTES),
		],
		{
			env: isElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		},
	);

	let stdoutBuffer = Buffer.alloc(0);
	let stderrBytes = 0;
	let cumulativeBytes = 0;
	let callCount = 0;
	let rejectedCallCount = 0;
	let ready = false;
	let stopping = false;
	let activeCallController: AbortController | undefined;
	const emissions: unknown[] = [];
	const steps: ScriptStepSummary[] = [];
	const messages: Record<string, unknown>[] = [];
	let draining = false;
	let drainPromise: Promise<void> = Promise.resolve();
	let resolveResult!: (r: ScriptRunResult) => void;
	const resultPromise = new Promise<ScriptRunResult>((resolve) => {
		resolveResult = resolve;
	});
	const childExit = waitForChildExit(child);
	let timeout: NodeJS.Timeout | undefined;
	let killTimer: NodeJS.Timeout | undefined;

	const sendParentMessage = async (message: unknown) => {
		const line = `${JSON.stringify(message)}\n`;
		const bytes = Buffer.byteLength(line, "utf8");
		if (
			bytes > SCRIPT_IPC_MESSAGE_MAX_BYTES ||
			cumulativeBytes + bytes > SCRIPT_IPC_CUMULATIVE_MAX_BYTES
		) {
			throw new Error("Script IPC limit exceeded.");
		}
		cumulativeBytes += bytes;
		await new Promise<void>((resolve, reject) => {
			child.stdin.write(line, (error) =>
				error ? reject(error) : resolve(),
			);
		});
	};

	const finish = async (
		result: ScriptRunResult,
		waitForDrain = false,
	) => {
		if (stopping) return;
		stopping = true;
		if (timeout) clearTimeout(timeout);
		options.signal?.removeEventListener("abort", abortListener);
		activeCallController?.abort();
		killTimer = terminateChild(child);
		if (waitForDrain) await settleWithin(drainPromise, 5_000);
		await settleWithin(childExit, 1_000);
		if (killTimer) clearTimeout(killTimer);
		try {
			await options.cleanup?.();
		} catch {
			/* best-effort */
		}
		resolveResult(result);
	};

	const fail = (
		error: string,
		failureCategory: ScriptFailureCategory,
		flags: { timedOut?: boolean; aborted?: boolean } = {},
		waitForDrain = false,
	) =>
		void finish(
			failedRun({
				...flags,
				callCount,
				emitCount: emissions.length,
				error,
				failureCategory,
				rejectedCallCount,
				steps,
			}),
			waitForDrain,
		);

	const abortListener = () => {
		fail("Script execution was aborted.", "aborted", { aborted: true }, true);
	};
	options.signal?.addEventListener("abort", abortListener, { once: true });
	timeout = setTimeout(() => {
		fail(
			`Script execution timed out after ${timeoutMs}ms.`,
			"timeout",
			{ timedOut: true },
			true,
		);
	}, timeoutMs);

	const drainMessages = async () => {
		if (draining) return;
		draining = true;
		try {
			while (!stopping && messages.length > 0) {
				const message = messages.shift()!;
				if (message.type === "ready") {
					if (ready) {
						await finish(
							failedRun({
								callCount,
								emitCount: emissions.length,
								error: "Sandbox sent a duplicate ready message.",
								failureCategory: "upstream-error",
								rejectedCallCount,
								steps,
							}),
						);
						return;
					}
					ready = true;
					try {
						await sendParentMessage({ code: options.code, type: "start" });
					} catch {
						await finish(
							failedRun({
								callCount,
								emitCount: emissions.length,
								error: "Unable to start the script sandbox.",
								failureCategory: "upstream-error",
								rejectedCallCount,
								steps,
							}),
						);
						return;
					}
					continue;
				}
				if (!ready) {
					await finish(
						failedRun({
							callCount,
							emitCount: emissions.length,
							error: "Sandbox sent a message before it was ready.",
							failureCategory: "upstream-error",
							rejectedCallCount,
							steps,
						}),
					);
					return;
				}
				if (message.type === "emit") {
				if (!Object.hasOwn(message, "value")) {
					await finish(
						failedRun({
							callCount,
							emitCount: emissions.length,
							error:
								"emit(value) requires a JSON-serializable value; undefined and functions are not supported.",
								failureCategory: "validation-error",
								rejectedCallCount,
								steps,
							}),
					);
						return;
				}
					emissions.push(message.value);
					continue;
				}
				if (message.type === "complete") {
					const err = message.error as
						| { name?: unknown; message?: unknown }
						| undefined;
					if (err) {
						await finish(
							failedRun({
								callCount,
								emitCount: emissions.length,
								error: describeScriptError(err),
								failureCategory: "script-error",
								rejectedCallCount,
								steps,
							}),
						);
						return;
					}
					const hasValue = message.hasValue === true;
					const finalData =
						emissions.length === 0
							? hasValue
								? message.value
								: undefined
							: emissions.length === 1
								? emissions[0]
								: emissions;
					let serialized: string | undefined;
					try {
						serialized =
							finalData === undefined
								? undefined
								: JSON.stringify(finalData);
					} catch {
						await finish(
							failedRun({
								callCount,
								emitCount: emissions.length,
								error: "Final script output must be JSON-serializable.",
								failureCategory: "validation-error",
								rejectedCallCount,
								steps,
							}),
						);
						return;
					}
					if (
						serialized !== undefined &&
						Buffer.byteLength(serialized, "utf8") >
							SCRIPT_FINAL_OUTPUT_MAX_BYTES
				) {
					await finish(
						failedRun({
							callCount,
								emitCount: emissions.length,
								error: `Final script output exceeds ${SCRIPT_FINAL_OUTPUT_MAX_BYTES} bytes.`,
								failureCategory: "validation-error",
								rejectedCallCount,
								steps,
							}),
					);
						return;
				}
					await finish({
						ok: true,
						callCount,
						data: finalData,
						emitCount: emissions.length,
						rejectedCallCount,
						steps,
					});
					return;
				}
				// type === "call"
				callCount += 1;
				if (callCount > SCRIPT_MAX_CALLS) {
					await finish(
						failedRun({
							callCount: callCount - 1,
								emitCount: emissions.length,
								error: `Script browser call limit exceeded (${SCRIPT_MAX_CALLS}).`,
								failureCategory: "validation-error",
								rejectedCallCount,
								steps,
							}),
					);
						return;
				}
				const validated = validateScriptBrowserParams(message.params);
				let envelope: ScriptEnvelope;
				if (("params" in validated)) {
					activeCallController = new AbortController();
					try {
						envelope = await options.dispatch(
							validated.params,
							activeCallController.signal,
						);
					} catch {
						envelope = buildRejectedCallEnvelope(
							"The ordinary agent_browser executor failed while dispatching this call.",
							false,
						);
					} finally {
						activeCallController = undefined;
					}
					if (stopping) return;
				} else {
					rejectedCallCount += 1;
					envelope = buildRejectedCallEnvelope(
						validated.error ?? "Invalid script browser call.",
						validated.policyBlocked === true,
					);
				}
				steps.push({
					index: callCount - 1,
					ok: envelope.ok,
					resultCategory: envelope.resultCategory,
					failureCategory: envelope.failureCategory,
					summary: envelope.summary,
				});
				try {
					await sendParentMessage({
						envelope,
						id: message.id,
						type: "response",
					});
				} catch {
					await finish(
						failedRun({
							callCount,
								emitCount: emissions.length,
								error: "Unable to return a browser result to the script sandbox.",
								failureCategory: "upstream-error",
								rejectedCallCount,
								steps,
							}),
					);
						return;
				}
			}
		} finally {
			draining = false;
			if (!stopping && messages.length > 0) scheduleDrain();
		}
	};
	function scheduleDrain() {
		if (draining || stopping) return;
		drainPromise = drainMessages();
	}

	child.stdout.on("data", (chunk) => {
		if (stopping) return;
		stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
		if (stdoutBuffer.length > SCRIPT_IPC_MESSAGE_MAX_BYTES) {
			fail("Script IPC message limit exceeded.", "validation-error", {}, true);
			return;
		}
		for (;;) {
			const newline = stdoutBuffer.indexOf(10);
			if (newline < 0) break;
			const lineBuffer = stdoutBuffer.subarray(0, newline);
			stdoutBuffer = stdoutBuffer.subarray(newline + 1);
			const bytes = lineBuffer.length + 1;
			if (
				bytes > SCRIPT_IPC_MESSAGE_MAX_BYTES ||
				cumulativeBytes + bytes > SCRIPT_IPC_CUMULATIVE_MAX_BYTES
			) {
				fail("Script IPC limit exceeded.", "validation-error", {}, true);
				return;
			}
			cumulativeBytes += bytes;
			try {
				const parsed = JSON.parse(lineBuffer.toString("utf8"));
				if (!isChildMessage(parsed)) throw new Error("invalid message");
				messages.push(parsed as Record<string, unknown>);
			} catch {
				fail(
					"Sandbox returned an invalid IPC message.",
					"upstream-error",
					{},
					true,
				);
				return;
			}
		}
		scheduleDrain();
	});
	child.stderr.on("data", (chunk) => {
		stderrBytes += chunk.length;
		if (stderrBytes > SCRIPT_IPC_MESSAGE_MAX_BYTES && !stopping) {
			fail("Script stderr limit exceeded.", "upstream-error", {}, true);
		}
	});
	child.once("error", () => {
		if (!stopping)
			fail("Unable to start the script sandbox.", "upstream-error", {}, true);
	});
	child.once("exit", () => {
		if (!stopping)
			fail(
				"Script sandbox exited before completion.",
				"upstream-error",
				{},
				true,
			);
	});

	return await resultPromise;
}
