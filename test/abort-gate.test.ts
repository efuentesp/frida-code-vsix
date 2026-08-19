// #90: gate de re-abort — el abort del SDK cae en el GAP entre runs
// (agent_end del turno N → agent_start del turno N+1) donde no rastrea nada:
// abort() resuelve como no-op y el siguiente run del ciclo tool→LLM arranca
// libre (captura abort.log 2026-08-19 19:35: 4 aborts → 4 no-ops, el ciclo
// siguió 18s más). Contrato del estado PURO aquí; el host lo wiring.

import { describe, expect, it } from "vitest";
import {
	createAbortGate,
	ABORT_GATE_TTL_MS,
} from "../src/abort-gate";

describe("createAbortGate (#90: re-abort del run escapado)", () => {
	it("sin request: agent_start NO re-aborta", () => {
		const g = createAbortGate(() => 1_000);
		expect(g.onAgentStart({ isIdle: false })).toBe(false);
	});

	it("con request: el PRÓXIMO agent_start re-aborta (el run que arrancó tras el abort no-op)", () => {
		const g = createAbortGate(() => 1_000);
		g.requestAbort();
		expect(g.onAgentStart({ isIdle: false })).toBe(true);
	});

	it("re-aborta CADA agent_start mientras no llegue el settle real (cadena tool→LLM)", () => {
		const g = createAbortGate(() => 1_000);
		g.requestAbort();
		expect(g.onAgentStart({ isIdle: false })).toBe(true);
		expect(g.onAgentStart({ isIdle: false })).toBe(true);
	});

	it("agent_settled con isIdle=true LIMPIA el gate (el ciclo de verdad paró)", () => {
		const g = createAbortGate(() => 1_000);
		g.requestAbort();
		expect(g.onAgentStart({ isIdle: false })).toBe(true);
		g.onAgentSettled({ isIdle: true });
		expect(g.onAgentStart({ isIdle: false })).toBe(false);
	});

	it("agent_settled con isIdle=false (retry en curso) NO limpia el gate", () => {
		const g = createAbortGate(() => 1_000);
		g.requestAbort();
		g.onAgentSettled({ isIdle: false });
		expect(g.onAgentStart({ isIdle: false })).toBe(true);
	});

	it("TTL: request viejo (>{TTL}ms) expira — agent_start ya NO re-aborta", () => {
		let now = 1_000;
		const g = createAbortGate(() => now);
		g.requestAbort();
		now += ABORT_GATE_TTL_MS + 1;
		expect(g.onAgentStart({ isIdle: false })).toBe(false);
	});

	it("prompt del usuario LIMPIA el gate (trabajo nuevo intencional)", () => {
		const g = createAbortGate(() => 1_000);
		g.requestAbort();
		g.onUserPrompt();
		expect(g.onAgentStart({ isIdle: false })).toBe(false);
	});

	it("isPending refleja el estado (para diagnóstico/forense)", () => {
		const g = createAbortGate(() => 1_000);
		expect(g.isPending()).toBe(false);
		g.requestAbort();
		expect(g.isPending()).toBe(true);
		g.onAgentSettled({ isIdle: true });
		expect(g.isPending()).toBe(false);
	});
});
