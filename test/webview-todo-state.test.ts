import { describe, expect, it } from "vitest";
import { todoSnapshot } from "../webview/todo-state";
import type { Segment, Turn } from "../webview/types";

function toolEntry(p: {
	tool?: string;
	args: unknown;
	result?: string;
	state?: "running" | "ok" | "error";
}): Segment {
	return {
		kind: "tool",
		tool: p.tool ?? "todo",
		args: p.args,
		state: p.state ?? "ok",
		startedAt: 0,
		endedAt: 1,
		result: p.result,
	};
}

function turn(segments: Segment[], status: "thinking" | "executing" | null = null): Turn {
	return { id: "t1", role: "assistant", segments, status, startedAt: 0 } as unknown as Turn;
}

describe("webview/todo-state — widget persistente de tareas (F5 P2)", () => {
	it("sin tools todo → null (sin widget)", () => {
		expect(todoSnapshot([turn([toolEntry({ tool: "read", args: { path: "x" } })])])).toBeNull();
	});

	it("create + update reconstruye tareas (id parseado del result)", () => {
		const turns = [
			turn([
				toolEntry({ args: { action: "create", subject: "Investigar" }, result: "Created #1: Investigar (pending)" }),
				toolEntry({
					args: { action: "update", id: 1, status: "in_progress" },
					result: "Updated #1 (pending → in_progress)",
				}),
				toolEntry({ args: { action: "create", subject: "Probar" }, result: "Created #2: Probar (pending)" }),
			]),
		];
		const snap = todoSnapshot(turns);
		expect(snap?.tasks).toHaveLength(2);
		expect(snap?.tasks[0]).toMatchObject({ id: 1, subject: "Investigar", status: "in_progress" });
		expect(snap?.done).toBe(0);
		expect(snap?.total).toBe(2);
		expect(snap?.current).toBe("Investigar");
		expect(snap?.anyRunning).toBe(false);
	});

	it("list repone el estado completo (snapshot de confianza)", () => {
		const turns = [
			turn([
				toolEntry({
					args: { action: "list" },
					result: "[in_progress] #1 Escribir tests (escribiendo tests)\n[completed] #2 Diseñar\n[pending] #3 Validar",
				}),
			]),
		];
		const snap = todoSnapshot(turns);
		expect(snap?.total).toBe(3);
		expect(snap?.done).toBe(1);
		// current de una tarea in_progress = activeForm (label «haciendo qué»)
		expect(snap?.current).toBe("escribiendo tests");
		expect(snap?.tasks[1]?.status).toBe("completed");
	});

	it("completed cuenta done; current = primer in_progress", () => {
		const turns = [
			turn([
				toolEntry({
					args: { action: "list" },
					result: "[completed] #1 A\n[in_progress] #2 B\n[in_progress] #3 C",
				}),
			]),
		];
		const snap = todoSnapshot(turns);
		expect(snap?.done).toBe(1);
		expect(snap?.current).toBe("B");
	});

	it("todo call corriendo (sin result) → anyRunning true y no rompe el fold", () => {
		const turns = [
			turn([
				toolEntry({ args: { action: "create", subject: "X" }, result: "Created #1: X (pending)" }),
				toolEntry({ args: { action: "update", id: 1, status: "in_progress" }, state: "running" }),
			]),
		];
		const snap = todoSnapshot(turns);
		expect(snap?.anyRunning).toBe(true);
		// la mutación en vuelo NO se aplicó aún (sólo es "running")
		expect(snap?.tasks[0]?.status).toBe("pending");
	});

	it("delete y clear aplican", () => {
		const turns = [
			turn([
				toolEntry({
					args: { action: "list" },
					result: "[pending] #1 A\n[pending] #2 B",
				}),
				toolEntry({ args: { action: "delete", id: 1 }, result: "Deleted #1: A" }),
				toolEntry({ args: { action: "clear" }, result: "Cleared 1 tasks" }),
			]),
		];
		expect(todoSnapshot(turns)).toBeNull(); // todo limpiado → sin widget
	});

	it("todo en error no muta el estado", () => {
		const turns = [
			turn([
				toolEntry({ args: { action: "create", subject: "X" }, result: "Created #1: X (pending)" }),
				toolEntry({ args: { action: "update", id: 99, status: "completed" }, state: "error", result: "Error" }),
			]),
		];
		const snap = todoSnapshot(turns);
		expect(snap?.tasks).toHaveLength(1);
		expect(snap?.tasks[0]?.status).toBe("pending");
	});

	it("activeForm viaja en el snapshot (para el label colapsado)", () => {
		const turns = [
			turn([
				toolEntry({
					args: { action: "list" },
					result: "[in_progress] #1 Tarea (escribiendo la tarea)",
				}),
			]),
		];
		expect(todoSnapshot(turns)?.current).toBe("escribiendo la tarea");
	});

	it("todas completadas → done == total, current = última completada", () => {
		const turns = [
			turn([
				toolEntry({
					args: { action: "list" },
					result: "[completed] #1 A\n[completed] #2 B",
				}),
			]),
		];
		const snap = todoSnapshot(turns);
		expect(snap?.done).toBe(2);
		expect(snap?.total).toBe(2);
		expect(snap?.current).toBe("B");
	});
});
