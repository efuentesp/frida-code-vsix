// Issue #18 — contabilización de tokens/cost/duración de los sub-agentes en el
// `usage` del workflow, y budget hard de tokens operante.
//
// Cubre los criterios de aceptación:
//  1. usage.tokens refleja la suma de tokens de todos los sub-agentes.
//  2. budget.tokens.hard detiene el workflow cuando se cruza.
//  3. costUsd y durationMs se acumulan.
//  4. workflow_resume re-hidrata el usage con tokens y continúa acumulando.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SessionStats } from "@earendil-works/pi-coding-agent";
import {
	runWorkflowInStore,
	resumeWorkflow,
} from "../../src/tools/frida-extensible-workflows/frida-host";
import { RunStore } from "../../src/tools/frida-extensible-workflows/core/persistence";
import {
	spawnResult,
	unpackSpawnResult,
	isSpawnResult,
	sessionStatsToAccounting,
	type SpawnAgentFn,
} from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import type { AgentAccounting } from "../../src/tools/frida-extensible-workflows/core/types";

const CWD = "/tmp/proj-acct";
const SESSION = "sess-acct";
let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "frida-wf-acct-"));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

// Accounting fijo que aporta cada sub-agente del mock (input+output = 1400 tokens).
const ACCT: AgentAccounting = {
	input: 1000,
	output: 400,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0.02,
};

describe("frida-extensible-workflows · spawnResult / unpackSpawnResult (#18)", () => {
	it("spawnResult envuelve value + accounting + durationMs y se reconoce", () => {
		const r = spawnResult("ok", { accounting: ACCT, durationMs: 50 });
		expect(isSpawnResult(r)).toBe(true);
		expect(unpackSpawnResult(r)).toEqual({
			value: "ok",
			accounting: ACCT,
			durationMs: 50,
		});
	});

	it("un JsonValue plano (mock) se envuelve como { value } sin contabilización", () => {
		expect(isSpawnResult("plain")).toBe(false);
		expect(isSpawnResult(42)).toBe(false);
		expect(isSpawnResult([1, 2])).toBe(false);
		// Un objeto arbitrario SIN la marca NO es spawnResult → se trata como value.
		expect(isSpawnResult({ foo: 1 })).toBe(false);
		expect(unpackSpawnResult("plain")).toEqual({ value: "plain" });
		expect(unpackSpawnResult({ foo: 1 })).toEqual({ value: { foo: 1 } });
	});

	it("spawnResult sin extras sólo lleva value", () => {
		const r = spawnResult(7);
		expect(isSpawnResult(r)).toBe(true);
		expect(unpackSpawnResult(r)).toEqual({ value: 7 });
	});
});

describe("frida-extensible-workflows · sessionStatsToAccounting (#18)", () => {
	it("mapea tokens.{input,output,cacheRead,cacheWrite} + cost", () => {
		const stats: SessionStats = {
			sessionFile: undefined,
			sessionId: "s",
			userMessages: 1,
			assistantMessages: 1,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 2,
			tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 },
			cost: 0.03,
		};
		expect(sessionStatsToAccounting(stats)).toEqual({
			input: 10,
			output: 5,
			cacheRead: 2,
			cacheWrite: 1,
			cost: 0.03,
		});
	});

	it("undefined → undefined (sesión sin stats)", () => {
		expect(sessionStatsToAccounting(undefined)).toBeUndefined();
	});

	it("campos faltantes → defaults 0", () => {
		const partial = { tokens: {}, cost: 0 } as unknown as SessionStats;
		expect(sessionStatsToAccounting(partial)).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
		});
	});
});

describe("frida-extensible-workflows · contabilización en el usage (#18)", () => {
	it("usage acumula tokens/costUsd/agentLaunches/durationMs de N sub-agentes", async () => {
		let calls = 0;
		const spawn: SpawnAgentFn = async () => {
			calls += 1;
			// 1400 tokens, $0.02, 50ms por agente.
			return spawnResult(`r${calls}`, { accounting: ACCT, durationMs: 50 });
		};
		const script =
			"const a = await agent('a'); const b = await agent('b'); return [a, b];";
		const runId = randomUUID();

		const { result } = await runWorkflowInStore({
			name: "acct",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			home,
		});
		expect(result).toEqual(["r1", "r2"]);
		expect(calls).toBe(2);

		const status = await new RunStore(CWD, SESSION, runId, home).loadStatus();
		expect(status.state).toBe("completed");
		const usage = status.usage!;
		expect(usage).toBeDefined();
		expect(usage.agentLaunches).toBe(2);
		// 2 agentes × (input 1000 + output 400) = 2800 tokens.
		expect(usage.tokens).toBe(2800);
		// 2 × $0.02 = $0.04.
		expect(usage.costUsd).toBeCloseTo(0.04, 6);
		// 2 × 50ms = 100ms (al menos; el wall-clock del bridge es adicional sólo si
		// el spawner no aporta durationMs, que aquí sí aporta).
		expect(usage.durationMs).toBeGreaterThanOrEqual(100);
	}, 15000);

	it("un mock que devuelve JsonValue plano NO contabiliza (backward-compat)", async () => {
		const spawn: SpawnAgentFn = async (p) => `R:${p}`;
		const script = "return await agent('a');";
		const runId = randomUUID();
		await runWorkflowInStore({
			name: "plain",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			home,
		});
		const status = await new RunStore(CWD, SESSION, runId, home).loadStatus();
		expect(status.usage?.agentLaunches).toBe(1);
		expect(status.usage?.tokens).toBe(0);
		expect(status.usage?.costUsd).toBe(0);
	}, 15000);
});

describe("frida-extensible-workflows · budget hard de tokens (#18)", () => {
	it("exceder tokens.hard lanza BUDGET_EXHAUSTED → estado budget_exhausted", async () => {
		// Cada agente aporta input+output = 2000 tokens. hard=1500 → tras el 1er
		// agente (2000) el pre-check del 2º agente detecta el cruce y bloquea.
		const heavy: AgentAccounting = { ...ACCT, input: 1600, output: 400 };
		const calls: string[] = [];
		const spawn: SpawnAgentFn = async (p) => {
			calls.push(p);
			return spawnResult(`R:${p}`, { accounting: heavy });
		};
		const script =
			"const a = await agent('A'); const b = await agent('B'); return [a, b];";
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "tokbg",
			script,
			args: null,
			cwd: CWD,
			sessionId: SESSION,
			runId,
			spawnAgent: spawn,
			home,
			budget: { tokens: { hard: 1500 } } as never,
		});
		await expect(promise).rejects.toThrow(/budget|BUDGET/i);
		const status = await new RunStore(CWD, SESSION, runId, home).loadStatus();
		expect(status.state).toBe("budget_exhausted");
		expect(calls).toEqual(["A"]); // B nunca se llamó: el pre-check la bloqueó.
		// El agente A sí contabilizó sus tokens antes de que B se bloqueara.
		expect(status.usage?.tokens).toBe(2000);
	}, 15000);
});

describe("frida-extensible-workflows · resume re-hidrata usage con tokens (#18)", () => {
	it("resume conserva los tokens acumulados y continúa sumando los nuevos", async () => {
		// Cada agente aporta 2000 tokens; hard=1500 → A corre (2000), B se bloquea.
		const heavy: AgentAccounting = { ...ACCT, input: 1600, output: 400 };
		const calls: string[] = [];
		const spawn: SpawnAgentFn = async (p) => {
			calls.push(p);
			return spawnResult(`R:${p}`, { accounting: heavy });
		};
		const script =
			"const a = await agent('A'); const b = await agent('B'); const c = await agent('C'); return [a, b, c];";
		const runId = randomUUID();

		// 1ª run: A corre (2000), B → BUDGET_EXHAUSTED.
		await expect(
			runWorkflowInStore({
				name: "res",
				script,
				args: null,
				cwd: CWD,
				sessionId: SESSION,
				runId,
				spawnAgent: spawn,
				home,
				budget: { tokens: { hard: 1500 } } as never,
			}),
		).rejects.toThrow(/budget|BUDGET/i);

		const before = await new RunStore(CWD, SESSION, runId, home).loadStatus();
		expect(before.state).toBe("budget_exhausted");
		expect(before.usage?.tokens).toBe(2000); // sólo A
		expect(calls).toEqual(["A"]);

		// resume: relaja hard a 6000. A replay (no suma), B y C corren (+4000).
		const { result } = await resumeWorkflow(runId, {
			cwd: CWD,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
			budgetPatch: { tokens: { hard: 6000 } },
		});
		expect(result).toEqual(["R:A", "R:B", "R:C"]);
		expect(calls).toEqual(["A", "B", "C"]); // A NO se re-ejecutó (replay)

		const after = await new RunStore(CWD, SESSION, runId, home).loadStatus();
		expect(after.state).toBe("completed");
		// Re-hidrató 2000 (A) + sumó 4000 (B+C) = 6000.
		expect(after.usage?.tokens).toBe(6000);
		expect(after.usage?.agentLaunches).toBe(3);
	}, 20000);
});
