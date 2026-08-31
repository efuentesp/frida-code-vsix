// Tests del runner de frida-workflow (Fase 1) con un host STUB.
//
// No tocan el SDK: el stub simula sesiones hijas que "producen" artefactos
// predeterminados, para verificar la travesía del grafo, el handoff del
// primary-handle y el audit JSONL. (rpiv usa el mismo patrón: runner sin host real.)

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	defineWorkflow,
	defineRoute,
	produces,
	acts,
	terminal,
	transcriptPathCollector,
	runWorkflow,
	handleWfSlash,
	registerWorkflow,
	_resetRegistry,
	readRun,
	type WorkflowHost,
} from "../../src/tools/frida-workflow";

/** Host stub: map skill → () => paths[] (o "fatal"). Registra los prompts vistos. */
function stubHost(map: Record<string, () => string[] | "fatal">) {
	const seen: { skill: string; arg: string }[] = [];
	const host: WorkflowHost = {
		cwd: "/tmp/stub",
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
					? [{ role: "assistant", content: "no produjo nada" }]
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

/** Collector que extrae lo que el stub embebe como `result <path>`. */
const stubCollector = transcriptPathCollector({ pattern: /result (\S+)/ });

let runsDir: string;
beforeEach(() => {
	runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-runs-"));
	_resetRegistry();
});

describe("runWorkflow — grafo lineal (Fase 1)", () => {
	it("cadena de 3 etapas: handoff del primary-handle + acts pasa Through", async () => {
		const wf = defineWorkflow({
			name: "lin",
			start: "research",
			stages: {
				research: produces({ outcome: { collector: stubCollector } }),
				plan: produces({ outcome: { collector: stubCollector } }),
				commit: acts(),
			},
			edges: { research: "plan", plan: "commit", commit: "stop" },
		});
		const { host, seen } = stubHost({
			research: () => ["/tmp/research.md"],
			plan: () => ["/tmp/plan.md"],
		});

		const r = await runWorkflow({
			workflow: wf,
			input: "haz el feature X",
			runsDir,
			host,
		});

		expect(r.success).toBe(true);
		expect(r.stagesCompleted).toBe(3);
		// commit es acts → hereda el primary de plan.
		expect(r.lastArtifact).toBe("/tmp/plan.md");
		// Handoff: research recibe el input; plan recibe el path de research; commit el de plan.
		expect(seen.map((s) => s.skill)).toEqual(["research", "plan", "commit"]);
		expect(seen[0]!.arg).toBe("haz el feature X");
		expect(seen[1]!.arg).toBe("/tmp/research.md");
		expect(seen[2]!.arg).toBe("/tmp/plan.md");
	});

	it("terminal: recibe el brief original y limpia el slot (downstream sin handle)", async () => {
		const wf = defineWorkflow({
			name: "term",
			start: "build",
			stages: {
				build: produces({ outcome: { collector: stubCollector } }),
				notify: terminal(),
			},
			edges: { build: "notify", notify: "stop" },
		});
		const { host, seen } = stubHost({ build: () => ["/tmp/build.md"] });

		const r = await runWorkflow({
			workflow: wf,
			input: "brief",
			runsDir,
			host,
		});

		expect(r.success).toBe(true);
		// terminal recibe el brief, NO el path de build.
		expect(seen[1]!.skill).toBe("notify");
		expect(seen[1]!.arg).toBe("brief");
		// slot limpiado → lastArtifact undefined.
		expect(r.lastArtifact).toBeUndefined();
	});

	it("collector fatal en produces → la etapa falla y el run se detiene", async () => {
		const wf = defineWorkflow({
			name: "fail",
			start: "a",
			stages: {
				a: produces({ outcome: { collector: stubCollector } }),
				b: produces({ outcome: { collector: stubCollector } }),
			},
			edges: { a: "b", b: "stop" },
		});
		const { host, seen } = stubHost({
			a: () => "fatal",
			b: () => ["/tmp/b.md"],
		});

		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });

		expect(r.success).toBe(false);
		expect(r.stagesCompleted).toBe(0); // a falló antes de contar
		expect(r.termination.status).toBe("failed");
		expect(seen.map((s) => s.skill)).toEqual(["a"]); // b nunca corrió
	});

	it("produces sin outcome → error de validación en runtime", async () => {
		const wf = defineWorkflow({
			name: "nooutcome",
			start: "a",
			stages: { a: produces({ outcome: undefined as never }) },
			edges: { a: "stop" },
		});
		const { host } = stubHost({ a: () => ["/tmp/a.md"] });
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/requiere outcome/);
	});

	it("audit JSONL: header + una fila por etapa completada", async () => {
		const wf = defineWorkflow({
			name: "audit",
			start: "a",
			stages: { a: produces({ outcome: { collector: stubCollector } }) },
			edges: { a: "stop" },
		});
		const { host } = stubHost({ a: () => ["/tmp/a.md"] });
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);

		const rows = readRun(runsDir, r.runId);
		expect(rows.length).toBe(2); // header + 1 stage
		expect(rows[0]).toMatchObject({
			type: "workflow",
			workflow: "audit",
			input: "x",
			v: 2,
		});
		expect(rows[1]).toMatchObject({
			type: "stage",
			stage: "a",
			status: "completed",
			skill: "a",
		});
		expect((rows[1] as { primaryHandle?: string }).primaryHandle).toBe(
			"/tmp/a.md",
		);
	});

	it("start inválido → failure envelope sin runId", async () => {
		const wf = defineWorkflow({
			name: "bad",
			start: "missing",
			stages: { a: acts() },
			edges: { a: "stop" },
		});
		const { host } = stubHost({});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false);
		expect(r.runId).toBe("");
	});
});

describe("handleWfSlash — registry + preview/lista (Fase 1)", () => {
	it("/wf sin workflows registrados → avisa", async () => {
		const notes: string[] = [];
		const host: WorkflowHost = {
			cwd: "/tmp",
			notify: (m) => notes.push(m),
			async spawnChild() {},
		};
		await handleWfSlash("", {
			host,
			runsDirBase: runsDir,
			cwd: "/tmp",
			agentDir: "/tmp",
		});
		expect(notes[0]).toMatch(/No hay workflows/);
	});

	it("/wf <name> sin input → preview del grafo", async () => {
		registerWorkflow(
			defineWorkflow({
				name: "ship",
				start: "research",
				stages: {
					research: produces({ outcome: { collector: stubCollector } }),
					commit: acts(),
				},
				edges: { research: "commit", commit: "stop" },
			}),
		);
		const notes: string[] = [];
		const host: WorkflowHost = {
			cwd: "/tmp",
			notify: (m) => notes.push(m),
			async spawnChild() {},
		};
		await handleWfSlash("ship", {
			host,
			runsDirBase: runsDir,
			cwd: "/tmp",
			agentDir: "/tmp",
		});
		expect(notes[0]).toMatch(/research → commit/);
	});

	it("/wf <name-desconocido> → sugiere disponibles", async () => {
		registerWorkflow(
			defineWorkflow({
				name: "only",
				start: "a",
				stages: { a: acts() },
				edges: { a: "stop" },
			}),
		);
		const notes: string[] = [];
		const host: WorkflowHost = {
			cwd: "/tmp",
			notify: (m) => notes.push(m),
			async spawnChild() {},
		};
		await handleWfSlash("nope", {
			host,
			runsDirBase: runsDir,
			cwd: "/tmp",
			agentDir: "/tmp",
		});
		// (c) default removido: un token desconocido NO corre el default — error
		// explícito "no encontrado" (no quema tokens con otro workflow).
		expect(notes.some((n) => /no encontrado/.test(n))).toBe(true);
		expect(notes.some((n) => /only iniciado/.test(n))).toBe(false);
	});

	it("/wf <name> <input> → corre detached y notifica al completar", async () => {
		registerWorkflow(
			defineWorkflow({
				name: "go",
				start: "a",
				stages: { a: produces({ outcome: { collector: stubCollector } }) },
				edges: { a: "stop" },
			}),
		);
		const notes: string[] = [];
		const { host } = stubHost({ a: () => ["/tmp/a.md"] });
		host.notify = (m) => notes.push(m);
		await handleWfSlash("go haz algo", {
			host,
			runsDirBase: runsDir,
			cwd: "/tmp",
			agentDir: "/tmp",
		});
		// detached: la promesa de runWorkflow resolving — esperar microtasks.
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));
		expect(notes.some((n) => n.includes("iniciado"))).toBe(true);
		expect(notes.some((n) => n.includes("completado"))).toBe(true);
	});
});

// ── #152 — semántica del circuit breaker de sdd-ship (elaborate + 3 ciclos) ──

/** Workflow con la forma real de sdd-ship: elaborate → (implement → validate)ⁿ → commit.
 * `validate` siempre produce verdict FAIL; el umbral del breaker es parametrizable. */
function sddShipLike(breakerAt: number) {
	const artifacts = [
		{
			handle: { kind: "fs" as const, path: "/tmp/validation.md" },
			role: "primary" as const,
		},
	];
	return defineWorkflow({
		name: `sdd-ship-like-${breakerAt}`,
		start: "elaborate",
		stages: {
			elaborate: acts(),
			implement: acts(),
			validate: produces({
				outcome: {
					collector: () => ({ kind: "ok", artifacts }),
					parser: () => ({ passed: false }),
				},
			}),
			commit: acts(),
		},
		edges: {
			elaborate: "implement",
			implement: "validate",
			validate: defineRoute(["commit", "implement", "stop"], (ctx) => {
				const passed = (ctx.output.data as { passed?: boolean })?.passed === true;
				if (passed) return "commit";
				if (ctx.state.stagesCompleted >= breakerAt) return "stop";
				return "implement";
			}),
			commit: "stop",
		},
	});
}

describe("circuit breaker de sdd-ship (umbral vs ciclos)", () => {
	it("umbral 7 corta tras exactamente 3 ciclos implement→validate (7 etapas)", async () => {
		const { host } = stubHost({});
		const r = await runWorkflow({
			workflow: sddShipLike(7),
			input: "plan.md Phase F1",
			runsDir,
			host,
		});
		expect(r.stagesCompleted).toBe(7); // 1 elaborate + 3×(implement+validate)
		expect(r.success).toBe(true); // stop → completed (pausa controlada, no error)
		const rows = readRun(runsDir, r.runId);
		const stageRows = rows.filter((x: { type: string }) => x.type === "stage");
		expect(stageRows).toHaveLength(7);
		expect(stageRows[6]!.stage).toBe("validate"); // última etapa: validate FAIL
	});

	it("umbral 8 (regresión del #152) permite un 4º ciclo → 9 etapas", async () => {
		const { host } = stubHost({});
		const r = await runWorkflow({
			workflow: sddShipLike(8),
			input: "plan.md Phase F1",
			runsDir,
			host,
		});
		// 3er FAIL llega con stagesCompleted=7 < 8 → 4º ciclo; su FAIL (9) corta.
		expect(r.stagesCompleted).toBe(9);
	});
});
