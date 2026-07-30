// Tests Fase 5 — lifecycle → store reactivo (alimentación del WorkflowPanel).
// Registra createWorkflowLifecycle, corre un workflow con stub host, y verifica
// que el store evoluciona (run creado, etapas running→completed, status final).

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	defineWorkflow,
	produces,
	acts,
	transcriptPathCollector,
	runWorkflow,
	registerLifecycle,
	_resetLifecycle,
	getWorkflowRuns,
	_resetWorkflowRuns,
	_resetRegistry,
	type WorkflowHost,
} from "../../src/tools/frida-workflow";
import { createWorkflowLifecycle } from "../../src/tools/frida-workflow/panel";

/** Stub: cada skill "produce" un path en el transcript (transcriptPathCollector lo halla). */
function stubHost(map: Record<string, () => string[] | "fatal">) {
	const seen: { skill: string; arg: string }[] = [];
	const host: WorkflowHost = {
		cwd: "/tmp",
		notify: () => {},
		async spawnChild(opts) {
			const rest = opts.prompt.startsWith("/skill:")
				? opts.prompt.slice("/skill:".length)
				: opts.prompt;
			const sp = rest.indexOf(" ");
			const skill = sp < 0 ? rest : rest.slice(0, sp);
			const arg = sp < 0 ? "" : rest.slice(sp + 1);
			seen.push({ skill, arg });
			const out = map[skill]?.() ?? [];
			const msgs =
				out === "fatal"
					? []
					: out.map((p) => ({ role: "assistant", content: `result ${p}` }));
			await opts.withSession({
				getMessages: () => msgs,
				getSessionId: () => `${skill}-1`,
				getSessionFile: () => undefined,
			});
		},
	};
	return { host, seen };
}

const findPath = transcriptPathCollector({ pattern: /result (\S+)/ });
let runsDir: string;
beforeEach(() => {
	runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p5-"));
	_resetRegistry();
	_resetWorkflowRuns();
	_resetLifecycle();
	registerLifecycle(createWorkflowLifecycle());
});

describe("lifecycle → store", () => {
	it("un run de 2 etapas pobla el store: 2 etapas completed + status completed", async () => {
		const wf = defineWorkflow({
			name: "lin",
			start: "a",
			stages: { a: produces({ outcome: { collector: findPath } }), b: acts() },
			edges: { a: "b", b: "stop" },
		});
		const { host } = stubHost({ a: () => ["/tmp/a.md"] });

		expect(getWorkflowRuns().runs).toHaveLength(0); // auto-hide base
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);

		const runs = getWorkflowRuns().runs;
		expect(runs).toHaveLength(1);
		const run = runs[0]!;
		expect(run.workflow).toBe("lin");
		expect(run.status).toBe("completed");
		expect(run.stages.map((s) => s.name)).toEqual(["a", "b"]);
		expect(run.stages.every((s) => s.status === "completed")).toBe(true);
		expect(run.stages[0]!.primaryHandle).toBe("/tmp/a.md");
	});

	it("una etapa que falla → status failed + la etapa fallida marcada", async () => {
		const wf = defineWorkflow({
			name: "fail",
			start: "a",
			stages: {
				a: produces({ outcome: { collector: findPath } }),
				b: produces({ outcome: { collector: findPath } }),
			},
			edges: { a: "b", b: "stop" },
		});
		const { host } = stubHost({ a: () => "fatal", b: () => ["/tmp/b.md"] });
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false);

		const run = getWorkflowRuns().runs[0]!;
		expect(run.status).toBe("failed");
		expect(run.stages[0]!.status).toBe("failed");
		expect(run.stages[0]!.error).toBeTruthy();
		expect(run.stages).toHaveLength(1); // b nunca arrancó
	});

	it("el evento dispara DESPUÉS del JSONL: la fila stage ya está en disco al onStageEnd", async () => {
		// Verificación indirecta: al terminar el run, el audit tiene las filas Y el
		// store tiene las etapas (ambos poblados por el mismo flujo).
		const wf = defineWorkflow({
			name: "ord",
			start: "a",
			stages: { a: produces({ outcome: { collector: findPath } }) },
			edges: { a: "stop" },
		});
		const { host } = stubHost({ a: () => ["/tmp/a.md"] });
		await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		const { readRun } = await import("../../src/tools/frida-workflow");
		const rows = readRun(runsDir, getWorkflowRuns().runs[0]!.runId);
		expect(rows.some((row) => row.type === "stage")).toBe(true);
		expect(getWorkflowRuns().runs[0]!.stages).toHaveLength(1);
	});
});
