/**
 * abortRun (#96): el abort debe ejecutarse sobre el AgentSession real.
 *
 * Regresión: doble desestructurado (`const s = session.session` con `session`
 * YA siendo el AgentSession extraído de FridaSession) → s = undefined →
 * clearQueue/abortBash/abort todos no-op. Firma forense: isIdle=? en
 * ~/.frida/logs/abort.log (98/98 pre-aborts históricos con ?).
 *
 * Este test reproduce el incidente de la sesión Personal-8bf7 (2026-08-22:
 * 7 clics en Detener sin efecto) con un AgentSession simulado: si el abort
 * no llega a la sesión real, falla aquí.
 */
import { describe, expect, it, vi } from "vitest";
import { abortRun, type AbortRunDeps } from "../src/abort-run";

/** AgentSession simulado con los miembros que abortRun toca. */
function fakeAgentSession(over: Partial<Record<string, unknown>> = {}) {
	return {
		isStreaming: true,
		isBashRunning: false,
		isIdle: false,
		isRetrying: false,
		retryAttempt: 0,
		agent: { signal: { aborted: false } },
		getSteeringMessages: () => [],
		getFollowUpMessages: () => [],
		clearQueue: vi.fn(),
		abort: vi.fn(async () => {}),
		abortBash: vi.fn(async () => {}),
		abortRetry: vi.fn(async () => {}),
		...over,
	};
}

function makeDeps(agentSession: any, over: Partial<AbortRunDeps> = {}) {
	const logs: string[] = [];
	const posted: any[] = [];
	const deps: AbortRunDeps = {
		ensureSession: async () => ({ session: agentSession }),
		abortDiag: (msg: string) => logs.push(msg),
		queueStore: { snapshot: () => [], restoreAll: () => [] },
		resetQueue: () => {},
		post: (msg: any) => posted.push(msg),
		isInRetry: () => false,
		abortGate: { requestAbort: vi.fn() },
		...over,
	};
	return { deps, logs, posted };
}

describe("abortRun (#96): abort sobre la sesión real del SDK", () => {
	it("invoca AgentSession.abort() — el botón Detener detiene el ciclo", async () => {
		const agent = fakeAgentSession();
		const { deps } = makeDeps(agent);
		await abortRun(deps);
		expect(agent.abort).toHaveBeenCalledTimes(1);
	});

	it("vacia la cola del SDK (clearQueue) antes de abortar", async () => {
		const agent = fakeAgentSession({
			getSteeringMessages: () => [{ role: "user", content: "x" }],
		});
		const { deps } = makeDeps(agent);
		await abortRun(deps);
		expect(agent.clearQueue).toHaveBeenCalledTimes(1);
	});

	it("el diagnóstico refleja la sesión viva: isIdle nunca es '?'", async () => {
		const agent = fakeAgentSession();
		const { deps, logs } = makeDeps(agent);
		await abortRun(deps);
		const pre = logs.find((l) => l.startsWith("pre-abort"));
		expect(pre).toBeDefined();
		// Firma forense de la regresión: isIdle=? significa s=undefined.
		expect(pre).toContain("isIdle=false");
		expect(pre).not.toContain("isIdle=?");
	});

	it("mata el bash en vuelo (abortBash) cuando isBashRunning", async () => {
		const agent = fakeAgentSession({ isBashRunning: true });
		const { deps } = makeDeps(agent);
		await abortRun(deps);
		expect(agent.abortBash).toHaveBeenCalledTimes(1);
	});

	it("marca el abortGate (re-abort #90 del run escapado)", async () => {
		const agent = fakeAgentSession();
		const gate = { requestAbort: vi.fn() };
		const { deps } = makeDeps(agent, { abortGate: gate });
		await abortRun(deps);
		expect(gate.requestAbort).toHaveBeenCalledTimes(1);
	});
});
