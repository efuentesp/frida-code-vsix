// frida-todo R1 (#66) — verify gate determinista ("Done when", inspirado en
// el verify-work de @mjasnikovs/pi-task): una tarea con `verify` (comando
// shell) NO puede marcarse completed si su comando falla. El modelo recibe la
// salida cruda y debe arreglar el problema; force:true es el escape hatch.

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isGatedCompletion,
	verifyFailText,
	runVerifyCommand,
} from "../../src/tools/todo/verify-gate";
import { applyTaskMutation, EMPTY_STATE } from "../../src/tools/todo/state-reducer";
import type { Task } from "../../src/tools/todo/types";

const task = (over: Partial<Task>): Task => ({
	id: 1,
	subject: "Corregir test flaky de login",
	status: "in_progress",
	...over,
});
const cmd = "npm test -- login";

describe("frida-todo · isGatedCompletion (R1 #66)", () => {
	it("update→completed con verify y sin force → gated", () => {
		expect(
			isGatedCompletion("update", { id: 1, status: "completed" }, task({ verify: cmd })),
		).toBe(true);
	});
	it("sin verify no es gated (comportamiento clásico intacto)", () => {
		expect(
			isGatedCompletion("update", { id: 1, status: "completed" }, task({})),
		).toBe(false);
	});
	it("force:true abre el candado (override explícito)", () => {
		expect(
			isGatedCompletion(
				"update",
				{ id: 1, status: "completed", force: true },
				task({ verify: cmd }),
			),
		).toBe(false);
	});
	it("status distinto de completed nunca es gated (verify no corre en updates menores)", () => {
		expect(
			isGatedCompletion("update", { id: 1, status: "in_progress" }, task({ verify: cmd })),
		).toBe(false);
	});
	it("create/list/get/delete/clear nunca son gated", () => {
		for (const a of ["create", "list", "get", "delete", "clear"] as const) {
			expect(isGatedCompletion(a, { subject: "x" }, task({ verify: cmd }))).toBe(false);
		}
	});
});

describe("frida-todo · verifyFailText (R1 #66)", () => {
	it("mensaje accionable: comando, exit code, salida cruda y las dos salidas", () => {
		const text = verifyFailText(task({ verify: cmd }), {
			exitCode: 1,
			stdout: "",
			stderr: "FAIL src/login.test.ts\n  ● login › renders",
			timedOut: false,
		});
		expect(text).toContain("#1");
		expect(text).toContain(cmd);
		expect(text).toContain("exit 1");
		expect(text).toContain("FAIL src/login.test.ts");
		expect(text).toContain("force");
	});
	it("timeout se reporta como tal (no como exit code)", () => {
		const text = verifyFailText(task({ verify: cmd }), {
			exitCode: null,
			stdout: "",
			stderr: "",
			timedOut: true,
		});
		expect(text).toContain("timeout");
	});
	it("salidas largas se truncan (tail, no整 blob)", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
		const text = verifyFailText(task({ verify: cmd }), {
			exitCode: 1,
			stdout: lines.join("\n"),
			stderr: "",
			timedOut: false,
		});
		expect(text).toContain("line 100");
		expect(text).not.toContain("line 5\n");
	});
});

describe("frida-todo · runVerifyCommand (R1 #66)", () => {
	const cwd = mkdtempSync(join(tmpdir(), "todo-verify-"));

	it("PASS determinista: exit 0 y stdout", async () => {
		const r = await runVerifyCommand("echo hi", cwd);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toBe("hi");
		expect(r.timedOut).toBe(false);
	}, 15_000);

	it("FAIL determinista: exit code distinto de cero preservado", async () => {
		const r = await runVerifyCommand("exit 3", cwd);
		expect(r.exitCode).toBe(3);
		expect(r.timedOut).toBe(false);
	}, 15_000);

	it("timeout mata el comando y reporta timedOut", async () => {
		const r = await runVerifyCommand("sleep 5", cwd, { timeoutMs: 100 });
		expect(r.timedOut).toBe(true);
	}, 15_000);
});

describe("frida-todo · reducer persiste verify (R1 #66)", () => {
	it("create con verify guarda el contrato Done-when en la tarea", () => {
		const r = applyTaskMutation(EMPTY_STATE, "create", {
			subject: "s",
			verify: cmd,
		});
		expect(r.op.kind).toBe("create");
		const t = r.state.tasks.find((x) => x.id === (r.op as { taskId: number }).taskId);
		expect(t?.verify).toBe(cmd);
	});
	it("create sin verify queda igual (sin campo)", () => {
		const r = applyTaskMutation(EMPTY_STATE, "create", { subject: "s" });
		expect(r.state.tasks[0]?.verify).toBeUndefined();
	});
});
