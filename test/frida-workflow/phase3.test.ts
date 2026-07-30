// Tests Fase 3 — resume: replay sin re-correr, re-entrada en etapa fallida,
// seguir route al resumir, run-completado es no-op, mismatch de schema, --name/@name.

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import {
	defineWorkflow,
	produces,
	acts,
	transcriptPathCollector,
	jsonBodyParser,
	typeboxSchema,
	gate,
	eq,
	runWorkflow,
	resumeWorkflow,
	encodeCwd,
	type WorkflowHost,
} from "../../src/tools/frida-workflow";

/** Stub con conteo de llamadas por skill (para verificar replay = no re-correr). */
function makeStub(
	behaviors: Record<string, (call: number) => { json?: unknown } | "fatal">,
) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p3-"));
	const calls: Record<string, number> = {};
	const seen: { skill: string; arg: string }[] = [];
	const host: WorkflowHost = {
		cwd: tmp,
		notify: () => {},
		async spawnChild(opts) {
			const rest = opts.prompt.startsWith("/skill:")
				? opts.prompt.slice("/skill:".length)
				: opts.prompt;
			const sp = rest.indexOf(" ");
			const skill = sp < 0 ? rest : rest.slice(0, sp);
			const arg = sp < 0 ? "" : rest.slice(sp + 1);
			seen.push({ skill, arg });
			calls[skill] = (calls[skill] ?? 0) + 1;
			const prod = behaviors[skill]?.(calls[skill]);
			const msgs: Record<string, unknown>[] = [];
			if (prod !== "fatal" && prod && prod.json !== undefined) {
				const p = path.join(tmp, `${skill}-${calls[skill]}.json`);
				fs.writeFileSync(p, JSON.stringify(prod.json));
				msgs.push({ role: "assistant", content: `result ${p}` });
			}
			await opts.withSession({
				getMessages: () => msgs,
				getSessionId: () => `${skill}-${calls[skill]}`,
				getSessionFile: () => undefined,
			});
		},
	};
	return { host, calls, seen, tmp };
}

const findPath = transcriptPathCollector({ pattern: /result (\S+)/ });
let runsDirBase: string;
let cwd: string;
beforeEach(() => {
	runsDirBase = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p3base-"));
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p3cwd-"));
});

function runsDirFor(): string {
	return path.join(runsDirBase, encodeCwd(cwd), "runs");
}

// ===========================================================================

describe("resume — replay sin re-correr + re-entra en fallida", () => {
	it("una etapa falla; al resumir se replay-a la completa y se re-corre la fallida", async () => {
		const wf = defineWorkflow({
			name: "chain",
			start: "a",
			stages: {
				a: produces({ outcome: { collector: findPath } }),
				b: produces({ outcome: { collector: findPath } }),
			},
			edges: { a: "b", b: "stop" },
		});
		const { host, calls } = makeStub({
			a: () => ({ json: {} }),
			b: (n) => (n === 1 ? "fatal" : { json: {} }),
		});
		const runsDir = runsDirFor();

		// Run 1: a ok, b falla.
		const r1 = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r1.success).toBe(false);
		expect(r1.stagesCompleted).toBe(1);
		expect(calls.a).toBe(1);
		expect(calls.b).toBe(1);

		// Resume: NO se re-llama a 'a'; 'b' se re-corre (2ª vez) y ahora ok.
		const r2 = await resumeWorkflow({
			workflow: wf,
			runsDir,
			ref: r1.runId,
			host,
		});
		expect(r2.success).toBe(true);
		expect(r2.stagesCompleted).toBe(2);
		expect(calls.a).toBe(1); // replay, no re-correr
		expect(calls.b).toBe(2);
	});
});

describe("resume — sigue el route ya decidido", () => {
	it("el route row se respeta al resumir (no se re-rutea)", async () => {
		const schema = typeboxSchema(Type.Object({ blockers: Type.Integer() }));
		const wf = defineWorkflow({
			name: "routed",
			start: "review",
			stages: {
				review: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
				}),
				commit: produces({ outcome: { collector: findPath } }),
			},
			edges: {
				review: gate("blockers", { commit: eq(0) }, "commit"),
				commit: "stop",
			},
		});
		const { host, calls } = makeStub({
			review: () => ({ json: { blockers: 0 } }),
			commit: (n) => (n === 1 ? "fatal" : { json: {} }),
		});
		const runsDir = runsDirFor();

		const r1 = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r1.success).toBe(false); // commit falló 1ª vez
		expect(calls.review).toBe(1);

		const r2 = await resumeWorkflow({
			workflow: wf,
			runsDir,
			ref: r1.runId,
			host,
		});
		expect(r2.success).toBe(true);
		expect(calls.review).toBe(1); // replay, no re-rutea ni re-corre review
		expect(calls.commit).toBe(2);
	});
});

describe("resume — casos de borde", () => {
	it("run ya completado → no-op (éxito, sin re-correr)", async () => {
		const wf = defineWorkflow({
			name: "done",
			start: "a",
			stages: { a: produces({ outcome: { collector: findPath } }) },
			edges: { a: "stop" },
		});
		const { host, calls } = makeStub({ a: () => ({ json: {} }) });
		const runsDir = runsDirFor();
		const r1 = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r1.success).toBe(true);

		const r2 = await resumeWorkflow({
			workflow: wf,
			runsDir,
			ref: r1.runId,
			host,
		});
		expect(r2.success).toBe(true);
		expect(calls.a).toBe(1); // no se re-llamó
	});

	it("schema version distinto → rehúsa", async () => {
		const wf = defineWorkflow({
			name: "v",
			start: "a",
			stages: { a: produces({ outcome: { collector: findPath } }) },
			edges: { a: "stop" },
		});
		const { host } = makeStub({ a: () => ({ json: {} }) });
		const runsDir = runsDirFor();
		const r1 = await runWorkflow({ workflow: wf, input: "x", runsDir, host });

		// Reescribe el header con v=99.
		const file = path.join(runsDir, `${r1.runId}.jsonl`);
		const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
		const header = JSON.parse(lines[0]!) as { v: number };
		header.v = 99;
		fs.writeFileSync(
			file,
			`${JSON.stringify(header)}\n${lines.slice(1).join("\n")}\n`,
		);

		const r2 = await resumeWorkflow({
			workflow: wf,
			runsDir,
			ref: r1.runId,
			host,
		});
		expect(r2.success).toBe(false);
		expect(r2.error).toMatch(/schema|v99/i);
	});

	it("workflow equivocado → rehúsa", async () => {
		const wfA = defineWorkflow({
			name: "alpha",
			start: "a",
			stages: { a: produces({ outcome: { collector: findPath } }) },
			edges: { a: "stop" },
		});
		const wfB = defineWorkflow({
			name: "beta",
			start: "a",
			stages: { a: produces({ outcome: { collector: findPath } }) },
			edges: { a: "stop" },
		});
		const { host } = makeStub({ a: () => ({ json: {} }) });
		const runsDir = runsDirFor();
		const r1 = await runWorkflow({ workflow: wfA, input: "x", runsDir, host });
		expect(r1.success).toBe(true);

		const r2 = await resumeWorkflow({
			workflow: wfB,
			runsDir,
			ref: r1.runId,
			host,
		});
		expect(r2.success).toBe(false);
		expect(r2.error).toMatch(/alpha.*beta|beta.*alpha/);
	});

	it("ref inexistente → failure sin runId", async () => {
		const wf = defineWorkflow({
			name: "x",
			start: "a",
			stages: { a: acts() },
			edges: { a: "stop" },
		});
		const { host } = makeStub({});
		const runsDir = runsDirFor();
		const r = await resumeWorkflow({
			workflow: wf,
			runsDir,
			ref: "no-existe",
			host,
		});
		expect(r.success).toBe(false);
		expect(r.runId).toBe("");
	});
});

describe("--name + @name", () => {
	it("run con --name y resume por @name", async () => {
		const wf = defineWorkflow({
			name: "named",
			start: "a",
			stages: {
				a: produces({ outcome: { collector: findPath } }),
				b: produces({ outcome: { collector: findPath } }),
			},
			edges: { a: "b", b: "stop" },
		});
		const { host, calls } = makeStub({
			a: () => ({ json: {} }),
			b: (n) => (n === 1 ? "fatal" : { json: {} }),
		});
		const runsDir = runsDirFor();

		const r1 = await runWorkflow({
			workflow: wf,
			input: "x",
			runsDir,
			host,
			name: "mi-run",
		});
		expect(r1.success).toBe(false);

		const r2 = await resumeWorkflow({
			workflow: wf,
			runsDir,
			ref: "@mi-run",
			host,
		});
		expect(r2.success).toBe(true);
		expect(r2.runId).toBe(r1.runId);
		expect(calls.b).toBe(2);
	});
});
