// Tests Fase 8 — script stages (produces.script/acts.script/terminal.script),
// prompt stages (produces.prompt/acts.prompt), skill-contracts (canCompose),
// y validación de exclusiones script/prompt.

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	defineWorkflow,
	produces,
	acts,
	terminal,
	transcriptPathCollector,
	runWorkflow,
	validateWorkflow,
	hasErrors,
	registerSkillContracts,
	_resetSkillContracts,
	canCompose,
	fs as fsHandle,
	type WorkflowHost,
} from "../../src/tools/frida-workflow";

/** Stub que registra los prompts vistos por spawnChild (para distinguir script vs prompt). */
function recStub() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p8-"));
	const prompts: string[] = [];
	const host: WorkflowHost = {
		cwd: tmp,
		notify: () => {},
		async spawnChild(opts) {
			prompts.push(opts.prompt);
			const p = path.join(tmp, `u${prompts.length}.md`);
			await opts.withSession({
				getMessages: () => [{ role: "assistant", content: `result ${p}` }],
				getSessionId: () => "x",
				getSessionFile: () => undefined,
			});
		},
	};
	return { host, prompts, count: () => prompts.length, tmp };
}

const findPath = transcriptPathCollector({ pattern: /result (\S+)/ });
let runsDir: string;
beforeEach(() => {
	runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p8runs-"));
	_resetSkillContracts();
});

describe("script stages (sin modelo)", () => {
	it("produces.script: run() provee artefactos; spawnChild NO se llama", async () => {
		const wf = defineWorkflow({
			name: "scr",
			start: "merge",
			stages: {
				merge: produces.script({
					run: async (ctx) => {
						const p = path.join(ctx.cwd, "out.md");
						fs.writeFileSync(p, "merged");
						return {
							kind: "plan",
							artifacts: [{ handle: fsHandle(p), role: "primary" as const }],
							data: { n: 1 },
						};
					},
				}),
			},
			edges: { merge: "stop" },
		});
		const { host, count } = recStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(count()).toBe(0); // sin sesión hija (no modelo)
		expect(r.lastArtifact?.endsWith("out.md")).toBe(true);
	});

	it("acts.script: side-effect void; el primary-handle pasa Through", async () => {
		let effect = 0;
		const wf = defineWorkflow({
			name: "se",
			start: "a",
			stages: {
				a: produces({ outcome: { collector: findPath } }),
				bump: acts.script({
					run: async () => {
						effect++;
					},
				}),
			},
			edges: { a: "bump", bump: "stop" },
		});
		const { host } = recStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(effect).toBe(1);
	});

	it("terminal.script: limpia el slot (downstream recibe el brief)", async () => {
		const seen: string[] = [];
		const wf = defineWorkflow({
			name: "term",
			start: "a",
			stages: {
				a: produces({ outcome: { collector: findPath } }),
				notify: terminal.script({ run: async () => {} }),
				next: produces({ outcome: { collector: findPath } }),
			},
			edges: { a: "notify", notify: "next", next: "stop" },
		});
		const host: WorkflowHost = {
			cwd: "/tmp",
			notify: () => {},
			async spawnChild(opts) {
				seen.push(opts.prompt);
				const p = `/tmp/u${seen.length}.md`;
				await opts.withSession({
					getMessages: () => [{ role: "assistant", content: `result ${p}` }],
					getSessionId: () => "x",
					getSessionFile: () => undefined,
				});
			},
		};
		await runWorkflow({ workflow: wf, input: "BRIEF", runsDir, host });
		// 'next' es terminal-después → recibe el brief original, no el path de 'a'.
		const nextArg = seen[1]!.split(/\s+/).slice(1).join(" ");
		expect(nextArg).toBe("BRIEF");
	});
});

describe("prompt stages (texto crudo, sin /skill:)", () => {
	it("produces.prompt: envía el texto crudo y el collector extrae", async () => {
		const wf = defineWorkflow({
			name: "pp",
			start: "ask",
			stages: {
				ask: produces.prompt({
					prompt: "escribe un resumen en un .md",
					outcome: { collector: findPath },
				}),
			},
			edges: { ask: "stop" },
		});
		const { host, prompts } = recStub();
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(prompts[0]).toBe("escribe un resumen en un .md"); // sin /skill:
	});

	it("acts.prompt: chat turn puro", async () => {
		const wf = defineWorkflow({
			name: "ap",
			start: "turn",
			stages: {
				turn: acts.prompt({
					prompt: ({ input }) => `refina ${input?.data ?? "x"}`,
				}),
			},
			edges: { turn: "stop" },
		});
		const { host, prompts } = recStub();
		await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(prompts[0]).toBe("refina x"); // PromptFn dinámica
	});
});

describe("skill-contracts", () => {
	it("canCompose: detecta canales faltantes", () => {
		registerSkillContracts([{ skill: "plan", produces: ["spec"] }]);
		const ok = canCompose(["spec"], ["spec", "drafts"]);
		expect(ok.ok).toBe(true);
		const bad = canCompose(["spec", "reviews"], ["spec"]);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.missing).toEqual(["reviews"]);
	});
});

describe("validate — exclusiones script/prompt", () => {
	it("script × loop → error", () => {
		const wf = defineWorkflow({
			name: "x",
			start: "a",
			stages: {
				a: produces.script({ run: async () => ({ kind: "k", artifacts: [] }) }),
			},
			edges: { a: "stop" },
		});
		// forzar loop + run (inválido): editamos directo
		(wf.stages.a as { loop?: unknown }).loop = {
			kind: "fanout",
			units: () => [],
		};
		expect(hasErrors(validateWorkflow(wf))).toBe(true);
	});

	it("prompt × skill → error", () => {
		const wf = defineWorkflow({
			name: "y",
			start: "a",
			stages: { a: acts.prompt({ prompt: "hi" }) },
			edges: { a: "stop" },
		});
		(wf.stages.a as { skill?: string }).skill = "conflict";
		expect(hasErrors(validateWorkflow(wf))).toBe(true);
	});

	it("produces.script sano → sin errores", () => {
		const wf = defineWorkflow({
			name: "z",
			start: "a",
			stages: {
				a: produces.script({ run: async () => ({ kind: "k", artifacts: [] }) }),
			},
			edges: { a: "stop" },
		});
		expect(hasErrors(validateWorkflow(wf))).toBe(false);
	});
});
