import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import {
	compileAgentBrowserScript,
	createScriptCloseArgs,
	createScriptSessionName,
	runAgentBrowserScript,
	SCRIPT_CODE_MAX_BYTES,
	SCRIPT_MAX_CALLS,
	validateScriptBrowserParams,
	type ScriptChildLike,
	type ScriptSpawnFn,
} from "../../src/tools/frida-agent-browser/script/mode";
import { SANDBOX_WORKER_SOURCE } from "../../src/tools/frida-agent-browser/script/worker-source";

const OK_ENVELOPE = {
	ok: true,
	text: "ok",
	summary: "ok",
	resultCategory: "success" as const,
};

// ─────────────────── validación y política ───────────────────

describe("script — compileAgentBrowserScript", () => {
	it("rechaza no-string y vacío", () => {
		expect("error" in compileAgentBrowserScript(42)).toBe(true);
		expect("error" in compileAgentBrowserScript("   ")).toBe(true);
	});
	it("rechaza > 64 KiB", () => {
		expect(
			"error" in compileAgentBrowserScript("x".repeat(SCRIPT_CODE_MAX_BYTES + 1)),
		).toBe(true);
	});
	it("acepta código válido", () => {
		const r = compileAgentBrowserScript("emit(1)");
		expect("code" in r).toBe(true);
	});
});

describe("script — validateScriptBrowserParams", () => {
	it("acepta {args, stdin?, timeoutMs?}", () => {
		const r = validateScriptBrowserParams({
			args: ["get", "url"],
			stdin: "x",
			timeoutMs: 5000,
		});
		expect("params" in r).toBe(true);
	});
	it("rechaza campos no soportados", () => {
		const r = validateScriptBrowserParams({ args: ["get", "url"], cwd: "/x" });
		expect("error" in r && r.error).toContain("does not support cwd");
	});
	it("rechaza tipos inválidos de args/stdin/timeoutMs", () => {
		expect("error" in validateScriptBrowserParams({ args: "get url" })).toBe(
			true,
		);
		expect("error" in validateScriptBrowserParams({ args: [] })).toBe(true);
		expect(
			"error" in validateScriptBrowserParams({ args: ["open", "x"], stdin: 5 }),
		).toBe(true);
		expect(
			"error" in
				validateScriptBrowserParams({ args: ["open", "x"], timeoutMs: -1 }),
		).toBe(true);
	});

	it("policy: comandos vetados (close/session/auth/attach/state/batch/connect/script)", () => {
		for (const cmd of [
			"close",
			"quit",
			"session",
			"auth",
			"attach",
			"state",
			"batch",
			"connect",
			"script",
		]) {
			const r = validateScriptBrowserParams({ args: [cmd] });
			expect("error" in r && r.policyBlocked, cmd).toBe(true);
		}
	});
	it("policy: comando sessionless vetado (doctor)", () => {
		const r = validateScriptBrowserParams({ args: ["doctor"] });
		expect("error" in r && r.error).toContain("sessionless");
	});
	it("policy: flags de identidad/launch vetados; --allowed-domains permitido", () => {
		for (const flag of ["--session", "--namespace", "--profile", "--cdp"]) {
			const r = validateScriptBrowserParams({ args: ["open", "x", flag, "v"] });
			expect("error" in r && r.policyBlocked, flag).toBe(true);
		}
		const ok = validateScriptBrowserParams({
			args: ["--allowed-domains", "a.com", "open", "x"],
		});
		expect("params" in ok).toBe(true);
	});
});

describe("script — session naming", () => {
	it("piab-script-<uuid> y close args", () => {
		const name = createScriptSessionName();
		expect(name).toMatch(/^piab-script-[0-9a-f-]{36}$/);
		expect(createScriptCloseArgs(name)).toEqual([
			"--namespace",
			"",
			"--session",
			name,
			"close",
		]);
	});
});

// ─────────────────── orquestador (fake spawn) ───────────────────

/** Fake del child sandbox: reacciona al start emitiendo líneas por stdout. */
function fakeScriptSpawn(
	onStart: (send: (obj: unknown) => void, code: string) => void,
	onParentMessage?: (msg: unknown) => void,
): { spawnFn: ScriptSpawnFn; child: () => ScriptChildLike } {
	let current: ScriptChildLike | undefined;
	const spawnFn = ((_cmd: string, _args: string[], _opts: unknown) => {
		const child = new EventEmitter() as EventEmitter & {
			stdin: {
				write: (s: string, cb: (e?: Error | null) => void) => void;
				destroy: () => void;
			};
			stdout: EventEmitter;
			stderr: EventEmitter;
			kill: (s?: string) => void;
			exitCode: number | null;
			signalCode: string | null;
		};
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.stdin = {
			write: (line: string, cb?: (e?: Error | null) => void) => {
				const msg = JSON.parse(line) as { type: string; code?: string };
				if (msg.type === "start") {
					queueMicrotask(() =>
						onStart(
							(obj) =>
								child.stdout.emit("data", Buffer.from(`${JSON.stringify(obj)}\n`)),
							msg.code ?? "",
						),
					);
				} else {
					onParentMessage?.(msg);
				}
				if (cb) queueMicrotask(() => cb(null));
				return true;
			},
			destroy: () => undefined,
		};
		child.kill = () => {
			queueMicrotask(() => child.emit("exit", null, "SIGTERM"));
		};
		child.exitCode = null;
		child.signalCode = null;
		current = child as unknown as ScriptChildLike;
		// Handshake inicial: el worker real emite ready al arrancar (última línea
		// de script-worker). Sin esto el padre espera indefinidamente.
		queueMicrotask(() =>
			child.stdout.emit("data", Buffer.from('{"type":"ready"}\n')),
		);
		return current;
	}) as unknown as ScriptSpawnFn;
	return { spawnFn, child: () => current as ScriptChildLike };
}

describe("script — runAgentBrowserScript (fake sandbox)", () => {
	it("happy path: 1 call + 1 emit + complete → ok con steps", async () => {
		const { spawnFn } = fakeScriptSpawn((send) => {
			send({ type: "call", id: 1, params: { args: ["get", "url"] } });
			send({ type: "emit", value: { done: true } });
			send({ type: "complete", hasValue: false });
		});
		let cleaned = 0;
		const r = await runAgentBrowserScript({
			code: "emit({done:true})",
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
			cleanup: async () => {
				cleaned++;
			},
		});
		expect(r.ok).toBe(true);
		expect(r.callCount).toBe(1);
		expect(r.emitCount).toBe(1);
		expect(r.data).toEqual({ done: true });
		expect(r.steps[0]).toMatchObject({ index: 0, ok: true });
		expect(cleaned).toBe(1);
	});

	it("múltiples emits → array", async () => {
		const { spawnFn } = fakeScriptSpawn((send) => {
			send({ type: "emit", value: 1 });
			send({ type: "emit", value: 2 });
			send({ type: "complete", hasValue: false });
		});
		const r = await runAgentBrowserScript({
			code: "emit(1); emit(2)",
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(true);
		expect(r.data).toEqual([1, 2]);
	});

	it("sin emits + return value → usa el valor de retorno", async () => {
		const { spawnFn } = fakeScriptSpawn((send) => {
			send({ type: "complete", hasValue: true, value: 42 });
		});
		const r = await runAgentBrowserScript({
			code: "return 42",
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.data).toBe(42);
	});

	it("complete con error → script-error", async () => {
		const { spawnFn } = fakeScriptSpawn((send) => {
			send({
				type: "complete",
				error: { name: "TypeError", message: "boom" },
			});
		});
		const r = await runAgentBrowserScript({
			code: "throw new TypeError('boom')",
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(false);
		expect(r.failureCategory).toBe("script-error");
		expect(r.error).toContain("TypeError: boom");
	});

	it("call con política vetada → rejected + step failure, run ok", async () => {
		const { spawnFn } = fakeScriptSpawn((send) => {
			send({ type: "call", id: 1, params: { args: ["close"] } });
			send({ type: "complete", hasValue: false });
		});
		const r = await runAgentBrowserScript({
			code: "await browser({args:['close']})",
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(true);
		expect(r.rejectedCallCount).toBe(1);
		expect(r.steps[0].ok).toBe(false);
		expect(r.steps[0].failureCategory).toBe("policy-blocked");
	});

	it(`call cap: > ${SCRIPT_MAX_CALLS} llamadas → validation-error`, async () => {
		const { spawnFn } = fakeScriptSpawn((send) => {
			for (let i = 1; i <= SCRIPT_MAX_CALLS + 1; i++) {
				send({ type: "call", id: i, params: { args: ["get", "url"] } });
			}
			send({ type: "complete", hasValue: false });
		});
		const r = await runAgentBrowserScript({
			code: "loop",
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(false);
		expect(r.failureCategory).toBe("validation-error");
		expect(r.error).toContain("call limit exceeded");
	});

	it("sandbox colgado → timeout", async () => {
		const { spawnFn } = fakeScriptSpawn(() => {
			/* nunca completa */
		});
		const r = await runAgentBrowserScript({
			code: "while(true){}",
			timeoutMs: 50,
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(false);
		expect(r.failureCategory).toBe("timeout");
		expect(r.timedOut).toBe(true);
	});

	it("spawn roto (error) → upstream-error", async () => {
		const spawnFn = (() => {
			const child = new EventEmitter() as never as ScriptChildLike & EventEmitter;
			(child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
			(child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
			(
				child as unknown as {
					stdin: {
						write: (s: string, cb: (e?: Error | null) => void) => void;
						destroy: () => void;
					};
				}
			).stdin = {
				write: (_s, cb) => {
					queueMicrotask(() => cb?.(null));
					return true;
				},
				destroy: () => undefined,
			};
			(child as unknown as { kill: () => void }).kill = () => undefined;
			child.exitCode = null;
			child.signalCode = null;
			queueMicrotask(() => child.emit("error", new Error("ENOENT")));
			return child;
		}) as unknown as ScriptSpawnFn;
		const r = await runAgentBrowserScript({
			code: "emit(1)",
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(false);
		expect(r.failureCategory).toBe("upstream-error");
	});

	it("código > 64 KiB → validation-error SIN spawn", async () => {
		let spawns = 0;
		const spawnFn = (() => {
			spawns++;
			throw new Error("no debe llamarse");
		}) as unknown as ScriptSpawnFn;
		const r = await runAgentBrowserScript({
			code: "x".repeat(SCRIPT_CODE_MAX_BYTES + 1),
			spawnFn,
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(false);
		expect(r.failureCategory).toBe("validation-error");
		expect(spawns).toBe(0);
	});
});

// ─────────────────── sandbox REAL (VM, sin binario) ───────────────────

describe("script — sandbox real (worker VM)", () => {
	it("browser() + emit() vía IPC real", async () => {
		const r = await runAgentBrowserScript({
			code:
				"const r = await browser({ args: ['get', 'url'] }); emit({ ok: r.ok, summary: r.summary });",
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(true);
		expect(r.data).toEqual({ ok: true, summary: "ok" });
		expect(r.callCount).toBe(1);
	}, 15_000);

	it("globals del host vetados en el sandbox", async () => {
		const r = await runAgentBrowserScript({
			code: "emit(typeof require + '/' + typeof process + '/' + typeof Buffer);",
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(true);
		expect(r.data).toBe("undefined/undefined/undefined");
	}, 15_000);

	it("code generation desde strings vetado (VM)", async () => {
		const r = await runAgentBrowserScript({
			code:
				"try { new Function('return 1'); emit('unexpected'); } catch (e) { emit(e && e.constructor && e.constructor.name); }",
			dispatch: async () => OK_ENVELOPE,
		});
		expect(r.ok).toBe(true);
		expect(r.data).toBe("EvalError");
	}, 15_000);
});

// El worker source debe ser CommonJS ejecutable con -e (sanity barato).
describe("script — worker source", () => {
	it("es no-vacío y define el protocolo esperado", () => {
		expect(SANDBOX_WORKER_SOURCE.length).toBeGreaterThan(1000);
		expect(SANDBOX_WORKER_SOURCE).toContain('"ready"');
		expect(SANDBOX_WORKER_SOURCE).toContain('"start"');
		expect(SANDBOX_WORKER_SOURCE).toContain('"response"');
		expect(SANDBOX_WORKER_SOURCE).toContain("codeGeneration");
	});
});
