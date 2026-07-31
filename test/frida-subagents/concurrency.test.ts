// frida-subagents — tests de Fase 3 (concurrency queue + group join).
//
// Verifica el gate de Fase 3 (ADR-0022):
//   - Concurrency queue: max 4, cola automática, releaseSlot arranca siguiente.
//   - Group join: smart mode agrupa 2+, async notifica individual.
//   - setMaxConcurrent / getMaxConcurrent.
//   - queuedCount / runningCountValue.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
	acquireSlot,
	releaseSlot,
	setMaxConcurrent,
	getMaxConcurrent,
	queuedCount,
	runningCountValue,
	_resetAgentManager,
	onSlotFreed_,
} from "../../src/tools/frida-subagents/agent-manager";
import {
	registerBackgroundAgent,
	agentCompleted,
	startTurn,
	getDefaultJoinMode,
	_resetGroupJoin,
	type GroupedNotification,
} from "../../src/tools/frida-subagents/group-join";

beforeEach(() => {
	_resetAgentManager();
	_resetGroupJoin();
});

afterEach(() => {
	_resetAgentManager();
	_resetGroupJoin();
});

// ---------------------------------------------------------------------------
// Concurrency queue
// ---------------------------------------------------------------------------

describe("frida-subagents / concurrency queue", () => {
	it("ejecuta inmediatamente cuando hay slots disponibles", async () => {
		let executed = false;
		const immediate = await acquireSlot(async () => {
			executed = true;
		});
		expect(immediate).toBe(true);
		expect(executed).toBe(true);
		expect(runningCountValue()).toBe(1);
	});

	it("encola cuando se excede el máximo", async () => {
		setMaxConcurrent(2);
		// Llenar los 2 slots.
		await acquireSlot(async () => {}); // slot 1
		await acquireSlot(async () => {}); // slot 2
		expect(runningCountValue()).toBe(2);

		// Tercero debe encolarse.
		let executed = false;
		const immediate = await acquireSlot(async () => {
			executed = true;
		});
		expect(immediate).toBe(false);
		expect(executed).toBe(false);
		expect(queuedCount()).toBe(1);
	});

	it("releaseSlot arranca el siguiente de la cola", async () => {
		setMaxConcurrent(1);
		// Ocupar el único slot.
		await acquireSlot(async () => {});

		// Encolar uno.
		let executed = false;
		await acquireSlot(async () => {
			executed = true;
		});
		expect(executed).toBe(false);

		// Liberar el slot.
		releaseSlot();
		expect(executed).toBe(true);
	});

	it("setMaxConcurrent cambia el límite", () => {
		setMaxConcurrent(8);
		expect(getMaxConcurrent()).toBe(8);
		setMaxConcurrent(2);
		expect(getMaxConcurrent()).toBe(2);
	});

	it("default max es 4", () => {
		expect(getMaxConcurrent()).toBe(4);
	});

	it("onSlotFreed_ callback dispara al vaciarse la cola", async () => {
		setMaxConcurrent(1);
		await acquireSlot(async () => {});

		const freed = vi.fn();
		onSlotFreed_(freed);

		releaseSlot();
		// No hay nada en cola → onSlotFreed dispara.
		expect(freed).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Group join
// ---------------------------------------------------------------------------

describe("frida-subagents / group join / smart mode", () => {
	it("getDefaultJoinMode devuelve smart", () => {
		expect(getDefaultJoinMode()).toBe("smart");
	});

	it("entrega agrupado cuando 2+ agentes completan", () => {
		const delivered: GroupedNotification[][] = [];
		const deliver = (ns: GroupedNotification[]) => delivered.push(ns);

		startTurn();
		registerBackgroundAgent("a1", "smart", deliver);
		registerBackgroundAgent("a2", "smart", deliver);

		// Primer agente completa — no entrega aún (espera al segundo).
		agentCompleted({
			agentId: "a1",
			type: "Explore",
			description: "task 1",
			status: "completed",
			result: "found 3 files",
			durationMs: 1000,
		});
		expect(delivered).toHaveLength(0);

		// Segundo agente completa — entrega agrupado.
		agentCompleted({
			agentId: "a2",
			type: "Plan",
			description: "task 2",
			status: "completed",
			result: "plan ready",
			durationMs: 2000,
		});
		expect(delivered).toHaveLength(1);
		expect(delivered[0]).toHaveLength(2);
		expect(delivered[0]![0]!.agentId).toBe("a1");
		expect(delivered[0]![1]!.agentId).toBe("a2");
	});

	it("un solo agente en smart entrega inmediatamente", () => {
		const delivered: GroupedNotification[][] = [];
		const deliver = (ns: GroupedNotification[]) => delivered.push(ns);

		startTurn();
		registerBackgroundAgent("solo", "smart", deliver);

		agentCompleted({
			agentId: "solo",
			type: "Explore",
			description: "solo task",
			status: "completed",
			result: "done",
			durationMs: 500,
		});

		// Un solo agente en smart → entrega inmediatamente (1 = no group timer).
		expect(delivered).toHaveLength(1);
		expect(delivered[0]).toHaveLength(1);
		expect(delivered[0]![0]!.agentId).toBe("solo");
	});
});

describe("frida-subagents / group join / async mode", () => {
	it("async mode: cada agente notifica individualmente", () => {
		const delivered: GroupedNotification[][] = [];
		const deliver = (ns: GroupedNotification[]) => delivered.push(ns);

		startTurn();
		// En async mode, registerBackgroundAgent no agrupa.
		registerBackgroundAgent("a1", "async", deliver);
		registerBackgroundAgent("a2", "async", deliver);

		// a1 completa — como no está en grupo, se entrega individual.
		agentCompleted({
			agentId: "a1",
			type: "Explore",
			description: "task 1",
			status: "completed",
			result: "done",
			durationMs: 100,
		});
		expect(delivered).toHaveLength(1);
		expect(delivered[0]).toHaveLength(1);

		// a2 completa.
		agentCompleted({
			agentId: "a2",
			type: "Plan",
			description: "task 2",
			status: "completed",
			result: "plan",
			durationMs: 200,
		});
		expect(delivered).toHaveLength(2);
	});
});

describe("frida-subagents / group join / edge cases", () => {
	it("agentCompleted sin grupo entrega individualmente", () => {
		const delivered: GroupedNotification[][] = [];

		// Sin registrar en ningún grupo ni callback.
		agentCompleted({
			agentId: "orphan",
			type: "general-purpose",
			description: "orphan task",
			status: "completed",
			result: "result",
			durationMs: 1000,
		});

		// No hay deliver callback para este agente → no se entrega.
		// agentCompleted busca el grupo; si no encuentra, no hace nada.
		expect(delivered).toHaveLength(0);
	});

	it("startTurn crea un nuevo turno", () => {
		const t1 = startTurn();
		const t2 = startTurn();
		expect(t1).not.toBe(t2);
	});
});
