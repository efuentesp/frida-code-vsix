// frida-todo (#66) — nudge de conciliación: tareas stale (pendientes no
// tocadas en todo el turno) disparan un follow-up pidiendo al agente
// conciliar su lista contra la realidad. Máquina pura, sin deps de vscode:
// el wiring (agent_start/agent_end/sendMessage) vive en index.ts.

import { describe, it, expect } from "vitest";
import {
	staleTasks,
	createNudgeTracker,
	conciliationPrompt,
} from "../../src/tools/todo-web/nudge";
import type { TaskState } from "../../src/tools/todo/state-reducer";

const stateOf = (
	...tasks: Partial<TaskState["tasks"][number]>[]
): TaskState => ({
	tasks: tasks.map((t, i) => ({
		id: t.id ?? i + 1,
		subject: t.subject ?? `tarea ${t.id ?? i + 1}`,
		status: t.status ?? "pending",
	})),
	nextId: (tasks.length ?? 0) + 1,
});

describe("frida-todo · staleTasks (#66)", () => {
	it("pending/in_progress no tocadas en el turno son stale; completed/deleted nunca", () => {
		const state = stateOf(
			{ id: 1, status: "pending" },
			{ id: 2, status: "in_progress" },
			{ id: 3, status: "completed" },
			{ id: 4, status: "deleted" },
			{ id: 5, status: "pending" },
		);
		const stale = staleTasks(state, new Set([5]));
		expect(stale.map((t) => t.id)).toEqual([1, 2]);
	});
});

describe("frida-todo · tracker de nudge (#66)", () => {
	it("agent_end con stale no tocadas → decisión de nudge con prompt accionable", () => {
		const nudge = createNudgeTracker();
		nudge.onAgentStart();
		const d = nudge.onAgentEnd(
			stateOf({ id: 1, subject: "Investigar login", status: "pending" }),
			false,
		);
		expect(d?.send).toBe(true);
		expect(d?.prompt).toContain("Investigar login");
		expect(d?.prompt).toContain("completed");
	});

	it("tarea tocada en el turno (update/create) NO es stale → sin nudge", () => {
		const nudge = createNudgeTracker();
		nudge.onAgentStart();
		nudge.onMutation(1);
		const d = nudge.onAgentEnd(
			stateOf({ id: 1, subject: "trabajo en curso", status: "in_progress" }),
			false,
		);
		expect(d).toBeNull();
	});

	it("guard anti-loop: el turno disparado por el nudge NO vuelve a nudgear", () => {
		const nudge = createNudgeTracker();
		nudge.onAgentStart();
		const d1 = nudge.onAgentEnd(
			stateOf({ id: 1, status: "pending" }),
			false,
		);
		expect(d1?.send).toBe(true);
		nudge.onNudgeSent(); // el wiring envió el follow-up

		// El follow-up dispara un nuevo turno: agent_start marca thisTurnIsNudge.
		nudge.onAgentStart();
		// El modelo ignoró el nudge: mismas stale al cierre.
		const d2 = nudge.onAgentEnd(
			stateOf({ id: 1, status: "pending" }),
			false,
		);
		expect(d2).toBeNull();
	});

	it("tras el turno-nudge, un turno NORMAL con stale vuelve a poder nudgear", () => {
		const nudge = createNudgeTracker();
		nudge.onAgentStart();
		nudge.onAgentEnd(stateOf({ id: 1, status: "pending" }), false);
		nudge.onNudgeSent();
		nudge.onAgentStart(); // turno-nudge
		nudge.onAgentEnd(stateOf({ id: 1, status: "pending" }), false);

		nudge.onAgentStart(); // turno normal nuevo (usuario)
		const d3 = nudge.onAgentEnd(stateOf({ id: 1, status: "pending" }), false);
		expect(d3?.send).toBe(true);
	});

	it("willRetry=true (turno fallido que se reintenta) → sin nudge", () => {
		const nudge = createNudgeTracker();
		nudge.onAgentStart();
		const d = nudge.onAgentEnd(stateOf({ id: 1, status: "pending" }), true);
		expect(d).toBeNull();
	});

	it("sin stale → null (nada que conciliar)", () => {
		const nudge = createNudgeTracker();
		nudge.onAgentStart();
		expect(nudge.onAgentEnd(stateOf(), false)).toBeNull();
	});
});

describe("frida-todo · conciliationPrompt (#66)", () => {
	it("manual (botón) y auto (agent_end) se distinguen y piden auditar completed/delete/create", () => {
		const stale = [{ id: 3, subject: "Cerrar issue", status: "pending" as const }];
		const manual = conciliationPrompt(stale, "manual");
		const auto = conciliationPrompt(stale, "auto");
		expect(manual).not.toBe(auto);
		expect(manual).toContain("re-sincronizar");
		for (const p of [manual, auto]) {
			expect(p).toContain("Cerrar issue");
			expect(p).toContain("completed");
			expect(p).toContain("delete");
			expect(p).toContain("create");
		}
	});
});
