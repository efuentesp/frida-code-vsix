// Tests Fase 7 — judges: verify (gate/retry/fail), assess (rondas hasta done),
// judge fatal (≥1 artefacto), panel (majority/all/tie → PANEL_VERDICT).
//
// El stub escribe un JSON por spawnChild según el skill (producer o judge) y
// lleva conteo de llamadas (para variar veredictos entre reintentos).

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	defineWorkflow,
	produces,
	transcriptPathCollector,
	jsonBodyParser,
	judge,
	verify,
	assess,
	panel,
	majority,
	all,
	runWorkflow,
	type WorkflowHost,
} from "../../src/tools/frida-workflow";

function judgeStub(
	map: Record<string, (n: number) => { json?: unknown } | "fatal">,
) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p7-"));
	const calls: Record<string, number> = {};
	const host: WorkflowHost = {
		cwd: tmp,
		notify: () => {},
		async spawnChild(opts) {
			const rest = opts.prompt.startsWith("/skill:")
				? opts.prompt.slice("/skill:".length)
				: opts.prompt;
			const sp = rest.indexOf(" ");
			const skill = sp < 0 ? rest : rest.slice(0, sp);
			(calls[skill] ??= 0), calls[skill]++;
			const prod = map[skill]?.(calls[skill]);
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
	return { host, calls };
}

const findPath = transcriptPathCollector({ pattern: /result (\S+)/ });
const gradeOutcome = { collector: findPath, parser: jsonBodyParser };

let runsDir: string;
beforeEach(() => {
	runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p7runs-"));
});

describe("verify — post-condición por etapa", () => {
	it("done true → avanza (1 intento)", async () => {
		const wf = defineWorkflow({
			name: "vg",
			start: "build",
			stages: {
				build: produces({
					outcome: { collector: findPath },
					verify: verify({
						judge: judge({ skill: "grade", outcome: gradeOutcome }),
						done: (v) => (v.data as { ok?: boolean }).ok === true,
					}),
				}),
			},
			edges: { build: "stop" },
		});
		const { host } = judgeStub({
			build: () => ({ json: {} }),
			grade: () => ({ json: { ok: true } }),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
	});

	it("retry: 1er veredicto false, 2º true → avanza tras reintento", async () => {
		const wf = defineWorkflow({
			name: "vr",
			start: "build",
			stages: {
				build: produces({
					outcome: { collector: findPath },
					verify: verify({
						max: 3,
						judge: judge({ skill: "grade", outcome: gradeOutcome }),
						done: (v) => (v.data as { ok?: boolean }).ok === true,
						feedForward: () => "arregla lo señalado",
					}),
				}),
			},
			edges: { build: "stop" },
		});
		const { host, calls } = judgeStub({
			build: () => ({ json: {} }),
			grade: (n) =>
				n === 1 ? { json: { ok: false } } : { json: { ok: true } },
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(calls.grade).toBe(2);
		expect(calls.build).toBe(2); // reintentó el producer
	});

	it("done false con max 1 → verification failed", async () => {
		const wf = defineWorkflow({
			name: "vf",
			start: "build",
			stages: {
				build: produces({
					outcome: { collector: findPath },
					verify: verify({
						judge: judge({ skill: "grade", outcome: gradeOutcome }),
						done: (v) => (v.data as { ok?: boolean }).ok === true,
					}),
				}),
			},
			edges: { build: "stop" },
		});
		const { host } = judgeStub({
			build: () => ({ json: {} }),
			grade: () => ({ json: { ok: false } }),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/verification failed/);
	});

	it("judge sin artefactos → fatal (falla la etapa)", async () => {
		const wf = defineWorkflow({
			name: "vfa",
			start: "build",
			stages: {
				build: produces({
					outcome: { collector: findPath },
					verify: verify({
						judge: judge({ skill: "grade", outcome: gradeOutcome }),
						done: () => true,
					}),
				}),
			},
			edges: { build: "stop" },
		});
		// grade produce 0 artefactos (sin json → collector fatal).
		const { host } = judgeStub({
			build: () => ({ json: {} }),
			grade: () => "fatal",
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/judge|fatal|transcript/i);
	});
});

describe("assess — loop juzgado hasta done", () => {
	it("rondas productor→judge hasta done; publica cada ronda; result last", async () => {
		const wf = defineWorkflow({
			name: "as",
			start: "refine",
			stages: {
				refine: produces({
					outcome: { name: "drafts", collector: findPath },
					loop: assess({
						judge: judge({ skill: "grade", outcome: gradeOutcome }),
						done: (v) => (v.data as { done?: boolean }).done === true,
						max: 5,
					}),
				}),
			},
			edges: { refine: "stop" },
		});
		const { host, calls } = judgeStub({
			refine: () => ({ json: {} }),
			grade: (n) => ({ json: n >= 2 ? { done: true } : { done: false } }),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(calls.refine).toBe(2); // 2 rondas hasta done
		expect(calls.grade).toBe(2);
	});
});

describe("panel — N escépticos + fold", () => {
	const member = (skill: string) =>
		judge({
			skill,
			outcome: {
				collector: findPath,
				parser: jsonBodyParser,
				name: `v-${skill}`,
			},
		});
	const passOf = (v: { data: unknown }) =>
		(v.data as { ok?: boolean }).ok === true;

	it("majority: 2 de 3 pasan → pass=true, votes{2,1}, tie=false", async () => {
		const wf = defineWorkflow({
			name: "pmaj",
			start: "build",
			stages: {
				build: produces({
					outcome: { collector: findPath },
					verify: verify({
						judge: panel({
							members: [member("m1"), member("m2"), member("m3")],
							fold: majority(passOf),
						}),
						done: (v) => (v.data as { pass?: boolean }).pass === true,
					}),
				}),
			},
			edges: { build: "stop" },
		});
		const { host, calls } = judgeStub({
			build: () => ({ json: {} }),
			m1: () => ({ json: { ok: true } }),
			m2: () => ({ json: { ok: true } }),
			m3: () => ({ json: { ok: false } }),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(calls.m1 && calls.m2 && calls.m3).toBe(1);
	});

	it("all: un miembro falla → pass=false → verify falla", async () => {
		const wf = defineWorkflow({
			name: "pall",
			start: "build",
			stages: {
				build: produces({
					outcome: { collector: findPath },
					verify: verify({
						judge: panel({
							members: [member("m1"), member("m2")],
							fold: all(passOf),
						}),
						done: (v) => (v.data as { pass?: boolean }).pass === true,
					}),
				}),
			},
			edges: { build: "stop" },
		});
		const { host } = judgeStub({
			build: () => ({ json: {} }),
			m1: () => ({ json: { ok: true } }),
			m2: () => ({ json: { ok: false } }),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false); // all exige unanimidad
	});
});
