// frida-subagents — tests de Fase 6 (widget store + panel).
//
// Verifica el gate de Fase 6 (ADR-0022):
//   - agentWidgetStore: subscribe/getSnapshot, agentStarted, agentUpdated,
//     pruneCompleted.
//   - createAgentWidgetElement factory existe.
//   - wireAgentWidget monta el panel.

import { describe, it, expect, beforeEach } from "vitest";
import {
	agentWidgetStore,
	startAutoPrune,
	stopAutoPrune,
} from "../../src/tools/frida-subagents/store";
import { createAgentWidgetElement } from "../../src/tools/frida-subagents/AgentWidget";
import {
	wireAgentWidget,
	unmountAgentWidget,
	_resetAgentWidget,
	type AgentWidgetWebBridge,
} from "../../src/tools/frida-subagents/panel";

beforeEach(() => {
	agentWidgetStore._reset();
	_resetAgentWidget();
});

describe("frida-subagents / store / subscribe + getSnapshot", () => {
	it("getSnapshot inicial es array vacío", () => {
		expect(agentWidgetStore.getSnapshot()).toEqual([]);
	});

	it("subscribe recibe notificación al cambiar", () => {
		let calls = 0;
		const unsub = agentWidgetStore.subscribe(() => calls++);

		agentWidgetStore.agentStarted({
			id: "a1",
			type: "Explore",
			description: "test",
			status: "running",
			startedAt: Date.now(),
		});

		expect(calls).toBe(1);
		unsub();
	});

	it("unsubscribe deja de recibir notificaciones", () => {
		let calls = 0;
		const unsub = agentWidgetStore.subscribe(() => calls++);

		agentWidgetStore.agentStarted({
			id: "a1",
			type: "Explore",
			description: "test",
			status: "running",
			startedAt: Date.now(),
		});
		expect(calls).toBe(1);

		unsub();

		agentWidgetStore.agentStarted({
			id: "a2",
			type: "Plan",
			description: "test2",
			status: "running",
			startedAt: Date.now(),
		});
		expect(calls).toBe(1); // no más llamadas
	});
});

describe("frida-subagents / store / agentStarted", () => {
	it("añade un agente al snapshot", () => {
		agentWidgetStore.agentStarted({
			id: "a1",
			type: "Explore",
			description: "find files",
			status: "running",
			startedAt: 1000,
		});

		const snapshot = agentWidgetStore.getSnapshot();
		expect(snapshot).toHaveLength(1);
		expect(snapshot[0]!.id).toBe("a1");
		expect(snapshot[0]!.type).toBe("Explore");
	});

	it("añade múltiples agentes", () => {
		agentWidgetStore.agentStarted({
			id: "a1",
			type: "Explore",
			description: "t1",
			status: "running",
			startedAt: 1000,
		});
		agentWidgetStore.agentStarted({
			id: "a2",
			type: "Plan",
			description: "t2",
			status: "running",
			startedAt: 2000,
		});

		expect(agentWidgetStore.getSnapshot()).toHaveLength(2);
	});
});

describe("frida-subagents / store / agentUpdated", () => {
	it("cambia el estado de un agente", () => {
		agentWidgetStore.agentStarted({
			id: "a1",
			type: "Explore",
			description: "test",
			status: "running",
			startedAt: Date.now(),
		});

		agentWidgetStore.agentUpdated("a1", "completed");

		const snapshot = agentWidgetStore.getSnapshot();
		expect(snapshot[0]!.status).toBe("completed");
		expect(snapshot[0]!.completedAt).toBeDefined();
	});

	it("no afecta a otros agentes", () => {
		agentWidgetStore.agentStarted({
			id: "a1",
			type: "Explore",
			description: "t1",
			status: "running",
			startedAt: 1000,
		});
		agentWidgetStore.agentStarted({
			id: "a2",
			type: "Plan",
			description: "t2",
			status: "running",
			startedAt: 2000,
		});

		agentWidgetStore.agentUpdated("a1", "completed");

		const snapshot = agentWidgetStore.getSnapshot();
		expect(snapshot[0]!.status).toBe("completed");
		expect(snapshot[1]!.status).toBe("running");
	});
});

describe("frida-subagents / store / pruneCompleted", () => {
	it("elimina agentes completados hace más de maxAgeMs", () => {
		const now = Date.now();
		agentWidgetStore.agentStarted({
			id: "old",
			type: "Explore",
			description: "old",
			status: "completed",
			startedAt: now - 20_000,
			completedAt: now - 15_000,
		});
		agentWidgetStore.agentStarted({
			id: "running",
			type: "Plan",
			description: "still going",
			status: "running",
			startedAt: now,
		});

		// Prune con maxAge muy grande → no elimina nada.
		agentWidgetStore.pruneCompleted(999_999);
		expect(agentWidgetStore.getSnapshot()).toHaveLength(2);

		// Prune con maxAge 0 → elimina el completado.
		agentWidgetStore.pruneCompleted(0);
		expect(agentWidgetStore.getSnapshot()).toHaveLength(1);
		expect(agentWidgetStore.getSnapshot()[0]!.id).toBe("running");
	});
});

describe("frida-subagents / store / autoPrune", () => {
	it("startAutoPrune + stopAutoPrune no crashean", () => {
		expect(() => startAutoPrune()).not.toThrow();
		expect(() => stopAutoPrune()).not.toThrow();
	});
});

describe("frida-subagents / AgentWidget / factory", () => {
	it("createAgentWidgetElement devuelve un ReactElement", () => {
		const element = createAgentWidgetElement();
		expect(element).toBeDefined();
	});
});

describe("frida-subagents / panel / wireAgentWidget", () => {
	it("monta el widget via webBridge.mountPersistent", () => {
		let mounted = false;
		const mockBridge: AgentWidgetWebBridge = {
			mountPersistent: () => {
				mounted = true;
				return { unmount: () => {} };
			},
		};

		wireAgentWidget(mockBridge);
		expect(mounted).toBe(true);
	});

	it("idempotente: segunda llamada no monta de nuevo", () => {
		let mountCount = 0;
		const mockBridge: AgentWidgetWebBridge = {
			mountPersistent: () => {
				mountCount++;
				return { unmount: () => {} };
			},
		};

		wireAgentWidget(mockBridge);
		wireAgentWidget(mockBridge);
		expect(mountCount).toBe(1);
	});

	it("unmountAgentWidget limpia el estado", () => {
		let unmounted = false;
		const mockBridge: AgentWidgetWebBridge = {
			mountPersistent: () => ({
				unmount: () => {
					unmounted = true;
				},
			}),
		};

		wireAgentWidget(mockBridge);
		unmountAgentWidget();
		expect(unmounted).toBe(true);

		// Después de unmount, wire de nuevo debe funcionar.
		wireAgentWidget(mockBridge);
	});
});
