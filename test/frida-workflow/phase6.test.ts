// Tests Fase 6 — loops: fanout (collecting/side-effect, deps→waves, cap),
// iterate (pull acumulativo), fanin/reads (multi-input), lifecycle de unidad,
// y cap run-wide (maxIterations).

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	defineWorkflow,
	produces,
	acts,
	transcriptPathCollector,
	fanout,
	iterate,
	fanin,
	runWorkflow,
	registerLifecycle,
	_resetLifecycle,
	type WorkflowHost,
	type Unit,
} from "../../src/tools/frida-workflow";

/** Stub: cada spawnChild "produce" un path único (transcriptPathCollector lo halla).
 *  Captura los prompts (para verificar fanin/reads y orden de waves). */
function loopStub() {
	let n = 0;
	const prompts: string[] = [];
	const host: WorkflowHost = {
		cwd: "/tmp",
		notify: () => {},
		async spawnChild(opts) {
			prompts.push(opts.prompt);
			const p = `/tmp/u${++n}.md`;
			await opts.withSession({
				getMessages: () => [{ role: "assistant", content: `result ${p}` }],
				getSessionId: () => `u${n}`,
				getSessionFile: () => undefined,
			});
		},
	};
	return { host, prompts, count: () => n };
}

const findPath = transcriptPathCollector({ pattern: /result (\S+)/ });
const u = (label: string, prompt?: string, deps?: string[]): Unit => ({
	prompt: prompt ?? `phase ${label}`,
	label,
	id: label,
	deps,
});

let runsDir: string;
beforeEach(() => {
	runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p6-"));
	_resetLifecycle();
});

describe("fanout (push)", () => {
	it("collecting: publica N outputs en el canal; entry = primera; fanin lee todas", async () => {
		const wf = defineWorkflow({
			name: "fan",
			start: "gen",
			stages: {
				gen: produces({
					outcome: { name: "drafts", collector: findPath },
					loop: fanout({ units: () => [u("a"), u("b"), u("c")] }),
				}),
				syn: produces({
					outcome: { collector: findPath },
					reads: [fanin("drafts")],
				}),
			},
			edges: { gen: "syn", syn: "stop" },
		});
		const { host, prompts, count } = loopStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(count()).toBe(4); // 3 unidades + synthesize
		// gen (entry) → /tmp/u1.md; syn lee los 3 drafts por fanin.
		expect(r.lastArtifact).toBe("/tmp/u4.md");
		const synPrompt = prompts.find((p) => p.startsWith("/skill:syn"));
		expect(synPrompt).toBeDefined();
		expect(synPrompt).toContain("--drafts /tmp/u1.md");
		expect(synPrompt).toContain("--drafts /tmp/u2.md");
		expect(synPrompt).toContain("--drafts /tmp/u3.md");
	});

	it("side-effect: acts con fanout (sin outcome.name) corre N unidades", async () => {
		const wf = defineWorkflow({
			name: "fan-se",
			start: "gen",
			stages: {
				gen: acts({ loop: fanout({ units: () => [u("a"), u("b")] }) }),
			},
			edges: { gen: "stop" },
		});
		const { host, count } = loopStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(count()).toBe(2);
	});

	it("deps → waves: una unidad corre sólo tras sus deps (serial)", async () => {
		const wf = defineWorkflow({
			name: "waves",
			start: "gen",
			stages: {
				gen: produces({
					outcome: { name: "d", collector: findPath },
					loop: fanout({
						concurrency: 1,
						units: () => [
							u("a"),
							u("b", "phase b", ["a"]),
							u("c", "phase c", ["b"]),
						],
					}),
				}),
			},
			edges: { gen: "stop" },
		});
		const { host, prompts } = loopStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		// Orden respetado: a antes que b antes que c.
		const ia = prompts.indexOf("phase a");
		const ib = prompts.indexOf("phase b");
		const ic = prompts.indexOf("phase c");
		expect(ia).toBeGreaterThanOrEqual(0);
		expect(ia).toBeLessThan(ib);
		expect(ib).toBeLessThan(ic);
	});

	it("cap halt: unidades > max → falla", async () => {
		const wf = defineWorkflow({
			name: "caphalt",
			start: "gen",
			stages: {
				gen: produces({
					outcome: { name: "d", collector: findPath },
					loop: fanout({
						max: 2,
						onCap: "halt",
						units: () => [u("a"), u("b"), u("c")],
					}),
				}),
			},
			edges: { gen: "stop" },
		});
		const { host } = loopStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/cap/);
	});

	it("cap advance: recorta a max y sigue", async () => {
		const wf = defineWorkflow({
			name: "capadv",
			start: "gen",
			stages: {
				gen: produces({
					outcome: { name: "d", collector: findPath },
					loop: fanout({
						max: 2,
						onCap: "advance",
						units: () => [u("a"), u("b"), u("c")],
					}),
				}),
			},
			edges: { gen: "stop" },
		});
		const { host, count } = loopStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(count()).toBe(2); // recortado a 2
	});
});

describe("iterate (pull acumulativo)", () => {
	it("next() hasta null; result default = last", async () => {
		const wf = defineWorkflow({
			name: "it",
			start: "gen",
			stages: {
				gen: produces({
					outcome: { name: "steps", collector: findPath },
					loop: iterate({
						next: (ctx) => (ctx.index < 3 ? u(`s${ctx.index}`) : null),
					}),
				}),
			},
			edges: { gen: "stop" },
		});
		const { host, count } = loopStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(count()).toBe(3);
		expect(r.lastArtifact).toBe("/tmp/u3.md"); // iterate default result = last
	});
});

describe("lifecycle de unidad", () => {
	it("onUnitStart dispara una vez por unidad de fanout", async () => {
		const seen: string[] = [];
		registerLifecycle({
			onUnitStart: (_stage, unit) => {
				seen.push(unit.label);
			},
		});
		const wf = defineWorkflow({
			name: "lc",
			start: "gen",
			stages: {
				gen: produces({
					outcome: { name: "d", collector: findPath },
					loop: fanout({ units: () => [u("a"), u("b"), u("c")] }),
				}),
			},
			edges: { gen: "stop" },
		});
		const { host } = loopStub();
		await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(seen.sort()).toEqual(["a", "b", "c"]);
	});
});

describe("cap run-wide (maxIterations)", () => {
	it("iterate sin terminar se topa con maxIterations y avanza (default onCap halt → falla)", async () => {
		const wf = defineWorkflow({
			name: "caprun",
			start: "gen",
			stages: {
				gen: produces({
					outcome: { name: "d", collector: findPath },
					loop: iterate({ next: (ctx) => u(`s${ctx.index}`) }), // nunca null
				}),
			},
			edges: { gen: "stop" },
		});
		const { host, count } = loopStub();
		const r = await runWorkflow({
			workflow: wf,
			input: "x",
			runsDir,
			host,
			maxIterations: 3,
		});
		expect(r.success).toBe(false); // iterate onCap default halt
		expect(r.error).toMatch(/cap/);
		expect(count()).toBe(3);
	});
});
