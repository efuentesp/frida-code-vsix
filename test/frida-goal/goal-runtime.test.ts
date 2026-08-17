// frida-goal (#20) — flujo reactivo completo del runtime con mock pi.
//
// Simula el lifecycle que el SDK dispararía: before_agent_start → agent_end
// → agent_settled, y verifica los invariantes del porte: continuación
// single-flight sólo en settled+idle, guards (cap 25, no-progreso, budget),
// esterilización por input del usuario y tools con validación de goal_id.
import { describe, expect, it } from "vitest";
import { GoalRuntime } from "../../src/tools/frida-goal/runtime";
import { extractContinuationMarker, extractGoalPromptMarker } from "../../src/tools/frida-goal/prompts";
import type { GoalStateSnapshot } from "../../src/tools/frida-goal/state";

/** Mock mínimo de ExtensionAPI: captura sendUserMessage/appendEntry/on(). */
interface Recorded {
	sent: string[];
	entries: { type: string; data: unknown }[];
	notified: { level: string; text: string }[];
	states: (GoalStateSnapshot | undefined)[];
}

function makePi() {
	const recorded: Recorded = { sent: [], entries: [], notified: [], states: [] };
	const handlers = new Map<string, ((...a: unknown[]) => unknown)[]>();
	const pi = {
		sendUserMessage: (text: string) => {
			recorded.sent.push(text);
		},
		appendEntry: (type: string, data: unknown) => {
			recorded.entries.push({ type, data });
		},
		on: (event: string, handler: (...a: unknown[]) => unknown) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool: () => {},
		registerCommand: () => {},
	};
	const fire = (event: string, ...args: unknown[]): unknown => {
		for (const h of handlers.get(event) ?? []) {
			const result = h(...args);
			if (result !== undefined) return result;
		}
		return undefined;
	};
	const runtime = new GoalRuntime(pi as never, {
		onState: (snap) => recorded.states.push(snap),
		notify: (level, text) => recorded.notified.push({ level, text }),
	});
	runtime.register();
	return { runtime, recorded, fire };
}

function makeCtx(opts?: {
	idle?: boolean;
	pending?: boolean;
	tokens?: number;
}) {
	return {
		isIdle: () => opts?.idle ?? true,
		hasPendingMessages: () => opts?.pending ?? false,
		getContextUsage: () => ({
			tokens: opts?.tokens ?? 10_000,
			contextWindow: 200_000,
			percent: 5,
		}),
	} as never;
}

const OK_MESSAGES = [
	{
		role: "assistant",
		stopReason: "stop",
		content: [
			{ type: "text", text: "avancé un poco más" },
			{ type: "toolCall", name: "bash" },
		],
	},
];

describe("frida-goal · runtime reactivo (#20)", () => {
	it("start inyecta prompt con goal marker y arranca el loop", () => {
		const { runtime, recorded } = makePi();
		runtime.start("migrar los tests", undefined, makeCtx());
		expect(recorded.sent).toHaveLength(1);
		const goalId = extractGoalPromptMarker(recorded.sent[0]!);
		expect(goalId).toBeTruthy();
		expect(recorded.entries.at(-1)?.type).toBe("frida-goal-state");
		expect(recorded.states.at(-1)?.status).toBe("active");
	});

	it("agent_end → agent_settled inyecta UNA continuación con marker", () => {
		const { runtime, recorded, fire } = makePi();
		runtime.start("hacer X", undefined, makeCtx());
		const sent0 = recorded.sent.length;

		// before_agent_start clasifica el run como del goal (marker prompt).
		fire("before_agent_start", { prompt: recorded.sent[0] }, makeCtx());
		fire("agent_end", { messages: OK_MESSAGES }, makeCtx());
		fire("agent_settled", {}, makeCtx());

		expect(recorded.sent.length).toBe(sent0 + 1);
		const continuation = recorded.sent.at(-1)!;
		const marker = extractContinuationMarker(continuation);
		expect(marker).toMatch(/#\d+$/);
		// La continuación menciona el objetivo.
		expect(continuation).toContain("hacer X");
		// settled adicional NO re-inyecta (single-flight: pending consumido).
		fire("agent_settled", {}, makeCtx());
		expect(recorded.sent.length).toBe(sent0 + 1);
	});

	it("settled con el host ocupado no inyecta; el siguiente reintenta", () => {
		const { runtime, recorded, fire } = makePi();
		runtime.start("hacer Y", undefined, makeCtx());
		fire("before_agent_start", { prompt: recorded.sent[0] }, makeCtx());
		fire("agent_end", { messages: OK_MESSAGES }, makeCtx());
		// Ocupado (streaming/pendientes): no inyectar.
		fire("agent_settled", {}, makeCtx({ idle: false }));
		expect(recorded.sent).toHaveLength(1);
		// Libre: la continuación retenida sale.
		fire("agent_settled", {}, makeCtx());
		expect(recorded.sent).toHaveLength(2);
	});

	it("input del usuario esteriliza la continuación pendiente", () => {
		const { runtime, recorded, fire } = makePi();
		runtime.start("hacer Z", undefined, makeCtx());
		fire("before_agent_start", { prompt: recorded.sent[0] }, makeCtx());
		fire("agent_end", { messages: OK_MESSAGES }, makeCtx());
		// El usuario escribe a mitad (antes del settled).
		fire("input", { text: "espera, cambia esto", source: "user" }, makeCtx());
		fire("agent_settled", {}, makeCtx());
		expect(recorded.sent).toHaveLength(1); // sin continuación
	});

	it("goal_complete válida termina el loop; goal_id stale se rechaza", () => {
		const { runtime, recorded, fire } = makePi();
		runtime.start("hacer W", undefined, makeCtx());
		const goalId = extractGoalPromptMarker(recorded.sent[0]!)!;

		const stale = runtime.onGoalComplete("goal-falso-123", "resumen");
		expect(stale).toBeTruthy(); // rechazado

		const ok = runtime.onGoalComplete(goalId, "todo listo, suite verde");
		expect(ok).toBeUndefined();
		expect(recorded.notified.at(-1)?.text).toContain("Goal completo");
		// Sin goal activo: la siguiente continuación no sale.
		fire("agent_end", { messages: OK_MESSAGES }, makeCtx());
		fire("agent_settled", {}, makeCtx());
		expect(recorded.sent).toHaveLength(1);
	});

	it("goal_blocked exige 3 intentos con la misma razón + evidencia", () => {
		const { runtime, recorded } = makePi();
		runtime.start("hacer V", undefined, makeCtx());
		const goalId = extractGoalPromptMarker(recorded.sent[0]!)!;

		const r1 = runtime.onGoalBlocked(goalId, "falta credencial", "error 401");
		const r2 = runtime.onGoalBlocked(goalId, "falta credencial", "error 401");
		expect(r1).toMatch(/1\/3/);
		expect(r2).toMatch(/2\/3/);
		// Razón distinta reinicia el contador.
		const r3 = runtime.onGoalBlocked(goalId, "otro problema", "x");
		expect(r3).toMatch(/1\/3/);
		const r4 = runtime.onGoalBlocked(goalId, "falta credencial", "error 401");
		const r5 = runtime.onGoalBlocked(goalId, "falta credencial", "error 401");
		const r6 = runtime.onGoalBlocked(goalId, "falta credencial", "error 401");
		expect(r4).toMatch(/1\/3/);
		expect(r5).toMatch(/2\/3/);
		expect(r6).toBeUndefined(); // aceptado a la 3ª repetición
		expect(runtime.activeGoal?.status).toBe("blocked");
		// Sin evidencia con razón nueva → sigue rechazado por conteo.
	});

	it("guard de 25 continuaciones automáticas pausa el goal", () => {
		const { runtime, recorded, fire } = makePi();
		runtime.start("tarea larga", undefined, makeCtx());
		fire("before_agent_start", { prompt: recorded.sent[0] }, makeCtx());
		// 24 continuaciones automáticas consumen el margen (el run inicial es
		// manual; el cap cuenta sólo las automáticas).
		for (let i = 0; i < 25; i++) {
			fire("agent_end", { messages: OK_MESSAGES }, makeCtx());
			fire("agent_settled", {}, makeCtx());
			const cont = recorded.sent.at(-1)!;
			fire("before_agent_start", { prompt: cont }, makeCtx());
		}
		expect(runtime.activeGoal?.status).toBe("active");
		// El run 25 cruza el cap en su agent_end.
		fire("agent_end", { messages: OK_MESSAGES }, makeCtx());
		expect(runtime.activeGoal?.status).toBe("paused");
		expect(runtime.activeGoal?.pausedReason).toContain("25");
		fire("agent_settled", {}, makeCtx());
		expect(recorded.notified.at(-1)?.text).toContain("25 continuaciones");
	});

	it("guard de budget pausa cuando tokensUsed cruza el presupuesto", () => {
		const { runtime, recorded, fire } = makePi();
		runtime.start("tarea con budget", 50_000, makeCtx({ tokens: 10_000 }));
		fire("before_agent_start", { prompt: recorded.sent[0] }, makeCtx());
		fire("agent_end", { messages: OK_MESSAGES }, makeCtx());
		expect(runtime.activeGoal?.status).toBe("active");
		// El contexto creció más allá del presupuesto.
		fire("agent_end", { messages: OK_MESSAGES }, makeCtx({ tokens: 80_000 }));
		expect(runtime.activeGoal?.status).toBe("paused");
		expect(runtime.activeGoal?.pausedReason).toContain("Budget");
	});

	it("error de provider no reintentable bloquea; abort pausa", () => {
		const { runtime, recorded, fire } = makePi();
		runtime.start("tarea A", undefined, makeCtx());
		fire("before_agent_start", { prompt: recorded.sent[0] }, makeCtx());
		fire("agent_end", { messages: OK_MESSAGES }, makeCtx());
		fire("agent_settled", {}, makeCtx());
		const cont = recorded.sent.at(-1)!;
		fire("before_agent_start", { prompt: cont }, makeCtx());
		fire(
			"agent_end",
			{
				messages: [
					{ role: "assistant", stopReason: "error", errorMessage: "Invalid API key" },
				],
			},
			makeCtx(),
		);
		expect(runtime.activeGoal?.status).toBe("blocked");

		const r2 = makePi();
		r2.runtime.start("tarea B", undefined, makeCtx());
		r2.fire("before_agent_start", { prompt: r2.recorded.sent[0] }, makeCtx());
		r2.fire(
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "aborted" }] },
			makeCtx(),
		);
		expect(r2.runtime.activeGoal?.status).toBe("paused");
	});

	it("resume reactiva con epoch limpio y dispara prompt de reanudación", () => {
		const { runtime, recorded } = makePi();
		runtime.start("tarea C", undefined, makeCtx());
		runtime.pause("manual", makeCtx());
		expect(runtime.activeGoal?.status).toBe("paused");
		runtime.resume(makeCtx());
		expect(runtime.activeGoal?.status).toBe("active");
		expect(runtime.activeGoal?.automaticModelTurns).toBe(0);
		expect(recorded.sent.at(-1)).toContain("explicitly resumed");
	});

	it("session_start restaura goal persistido pausado", () => {
		const { runtime, recorded } = makePi();
		runtime.start("tarea D", undefined, makeCtx());
		runtime.pause("porque sí", makeCtx());
		const persisted = recorded.entries
			.filter((e) => e.type === "frida-goal-state")
			.at(-1)?.data as { goal: { id: string } | null };

		// Nueva "sesión": el mismo sessionManager expone la entrada persistida.
		const ctxRestore = {
			isIdle: () => true,
			hasPendingMessages: () => false,
			getContextUsage: () => ({
				tokens: 10_000,
				contextWindow: 200_000,
				percent: 5,
			}),
			sessionManager: {
				getBranch: () => [
					{ type: "custom", customType: "frida-goal-state", data: persisted },
				],
			},
		} as never;
		const second = makePi();
		second.fire("session_start", {}, ctxRestore);
		expect(second.runtime.activeGoal?.status).toBe("paused");
		expect(second.runtime.activeGoal?.text).toBe("tarea D");
	});
});
