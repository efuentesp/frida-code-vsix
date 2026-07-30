// Tests Fase 2: routing (gate/match/defineRoute), schemas (retry/halt),
// validación de grafo, catálogo de outcomes (FS/git/tool/url/union), typeboxSchema.

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { Type } from "typebox";
import {
	defineWorkflow,
	produces,
	acts,
	transcriptPathCollector,
	jsonBodyParser,
	typeboxSchema,
	gate,
	match,
	defineRoute,
	gt,
	eq,
	urlCollector,
	directoryPathCollector,
	toolCallCollector,
	workspaceDiffCollector,
	gitCommitCollector,
	gitCommitOutcome,
	unionCollectors,
	captureSnapshot,
	runWorkflow,
	validateWorkflow,
	hasErrors,
	readRun,
	type WorkflowHost,
} from "../../src/tools/frida-workflow";

// ---------------------------------------------------------------------------
// Stub host: "produce" archivos JSON reales que jsonBodyParser pueda leer.
// ---------------------------------------------------------------------------

function stubHost(
	productions: Record<
		string,
		() => { json?: unknown; text?: string; files?: string[] }
	>,
) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p2-"));
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
			const prod = productions[skill]?.() ?? {};
			const msgs: Record<string, unknown>[] = [];
			if (prod.json !== undefined) {
				const p = path.join(tmp, `${skill}-${seen.length}.json`);
				fs.writeFileSync(p, JSON.stringify(prod.json));
				msgs.push({ role: "assistant", content: `result ${p}` });
			}
			if (prod.files)
				for (const f of prod.files)
					msgs.push({ role: "assistant", content: `result ${f}` });
			if (prod.text) msgs.push({ role: "assistant", content: prod.text });
			await opts.withSession({
				getMessages: () => msgs,
				getSessionId: () => `${skill}-${seen.length}`,
				getSessionFile: () => undefined,
			});
		},
	};
	return { host, seen, tmp };
}

const findPath = transcriptPathCollector({ pattern: /result (\S+)/ });
let runsDir: string;
beforeEach(() => {
	runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-p2runs-"));
});

// ===========================================================================
// Routing
// ===========================================================================

describe("routing — gate (numérico)", () => {
	const schema = typeboxSchema(
		Type.Object({ blockers: Type.Integer() }, { additionalProperties: true }),
	);

	it("blockers > 0 → revise; = 0 → commit", async () => {
		const wf = defineWorkflow({
			name: "gate-review",
			start: "review",
			stages: {
				review: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
				}),
				revise: acts(),
				commit: acts(),
			},
			edges: {
				review: gate("blockers", { revise: gt(0), commit: eq(0) }, "commit"),
				revise: "stop",
				commit: "stop",
			},
		});
		// Caso con blockers.
		const { host } = stubHost({ review: () => ({ json: { blockers: 3 } }) });
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(r.stagesCompleted).toBe(2); // review → revise
	});

	it("blockers = 0 → commit directo (sin revise)", async () => {
		const wf = defineWorkflow({
			name: "g2",
			start: "review",
			stages: {
				review: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
				}),
				revise: acts(),
				commit: acts(),
			},
			edges: {
				review: gate("blockers", { revise: gt(0), commit: eq(0) }, "commit"),
				revise: "stop",
				commit: "stop",
			},
		});
		const { host } = stubHost({ review: () => ({ json: { blockers: 0 } }) });
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(r.stagesCompleted).toBe(2); // review → commit (no revise)
	});

	it("append-ea una fila route al audit", async () => {
		const wf = defineWorkflow({
			name: "g3",
			start: "review",
			stages: {
				review: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
				}),
				commit: acts(),
			},
			edges: {
				review: gate("blockers", { commit: eq(0) }, "commit"),
				commit: "stop",
			},
		});
		const { host } = stubHost({ review: () => ({ json: { blockers: 0 } }) });
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		const rows = readRun(runsDir, r.runId);
		const routes = rows.filter((x) => x.type === "route");
		expect(routes.length).toBe(1);
		expect((routes[0] as { from: string; to: string }).from).toBe("review");
		expect((routes[0] as { from: string; to: string }).to).toBe("commit");
	});
});

describe("routing — match (enum)", () => {
	it("severity p0 → escalate; sin fallback → STOP", async () => {
		const schema = typeboxSchema(Type.Object({ severity: Type.String() }));
		const wf = defineWorkflow({
			name: "triage",
			start: "triage",
			stages: {
				triage: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
				}),
				escalate: acts(),
				backlog: acts(),
			},
			edges: {
				triage: match("severity", { escalate: "p0", backlog: "p2" }), // sin fallback
				escalate: "stop",
				backlog: "stop",
			},
		});
		const { host } = stubHost({ triage: () => ({ json: { severity: "p0" } }) });
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(r.stagesCompleted).toBe(2); // triage → escalate
	});

	it("valor sin match y sin fallback → STOP (termina)", async () => {
		const schema = typeboxSchema(Type.Object({ severity: Type.String() }));
		const wf = defineWorkflow({
			name: "t2",
			start: "triage",
			stages: {
				triage: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
				}),
				escalate: acts(),
			},
			edges: {
				triage: match("severity", { escalate: "p0" }),
				escalate: "stop",
			},
		});
		const { host } = stubHost({ triage: () => ({ json: { severity: "p9" } }) });
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(r.stagesCompleted).toBe(1); // triage → STOP (sin escalate)
	});
});

describe("routing — defineRoute (TS arbitrario)", () => {
	it("decide según output.data.verdict", async () => {
		const schema = typeboxSchema(Type.Object({ verdict: Type.String() }));
		const wf = defineWorkflow({
			name: "dr",
			start: "review",
			stages: {
				review: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
				}),
				commit: acts(),
				revise: acts(),
			},
			edges: {
				review: defineRoute(["commit", "revise"], (c) =>
					(c.output.data as { verdict: string }).verdict === "approve"
						? "commit"
						: "revise",
				),
				commit: "stop",
				revise: "stop",
			},
		});
		const { host } = stubHost({
			review: () => ({ json: { verdict: "approve" } }),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.stagesCompleted).toBe(2); // review → commit
	});
});

// ===========================================================================
// Schemas (retry / halt)
// ===========================================================================

describe("schemas — outputSchema", () => {
	it("retry: primer intento inválido, segundo válido → éxito", async () => {
		const schema = typeboxSchema(Type.Object({ blockers: Type.Integer() }));
		const wf = defineWorkflow({
			name: "retry",
			start: "review",
			stages: {
				review: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
					maxRetries: 3,
				}),
			},
			edges: { review: "stop" },
		});
		let call = 0;
		const { host } = stubHost({
			review: () => ({
				json: call++ === 0 ? { blockers: "no-num" } : { blockers: 1 },
			}),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(true);
		expect(r.stagesCompleted).toBe(1);
	});

	it("halt: onInvalid halt → falla al primer rechazo", async () => {
		const schema = typeboxSchema(Type.Object({ blockers: Type.Integer() }));
		const wf = defineWorkflow({
			name: "halt",
			start: "review",
			stages: {
				review: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
					onInvalid: "halt",
					maxRetries: 3,
				}),
			},
			edges: { review: "stop" },
		});
		const { host } = stubHost({
			review: () => ({ json: { blockers: "bad" } }),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/outputSchema rechazado/);
	});

	it("agota reintentos → falla", async () => {
		const schema = typeboxSchema(Type.Object({ blockers: Type.Integer() }));
		const wf = defineWorkflow({
			name: "exhaust",
			start: "review",
			stages: {
				review: produces({
					outcome: { collector: findPath, parser: jsonBodyParser },
					outputSchema: schema,
					maxRetries: 2,
				}),
			},
			edges: { review: "stop" },
		});
		const { host } = stubHost({
			review: () => ({ json: { blockers: "bad" } }),
		});
		const r = await runWorkflow({ workflow: wf, input: "x", runsDir, host });
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/outputSchema/);
	});
});

describe("typeboxSchema", () => {
	it("valida ok / rechaza con issues", async () => {
		const { validateSchema } = await import(
			"../../src/tools/frida-workflow/schema"
		);
		const s = typeboxSchema(Type.Object({ n: Type.Integer() }));
		const ok = await validateSchema(s, { n: 5 });
		expect(ok.ok).toBe(true);
		const bad = await validateSchema(s, { n: "x" });
		expect(bad.ok).toBe(false);
	});
});

// ===========================================================================
// Validación de grafo
// ===========================================================================

describe("validateWorkflow", () => {
	it("workflow sano → sin errores", () => {
		const wf = defineWorkflow({
			name: "ok",
			start: "a",
			stages: { a: produces({ outcome: { collector: findPath } }), b: acts() },
			edges: { a: "b", b: "stop" },
		});
		expect(hasErrors(validateWorkflow(wf))).toBe(false);
	});

	it("dangling edge → error", () => {
		const wf = defineWorkflow({
			name: "dangling",
			start: "a",
			stages: { a: acts() },
			edges: { a: "noexiste" },
		});
		expect(hasErrors(validateWorkflow(wf))).toBe(true);
	});

	it("produces sin outcome → error", () => {
		const wf = defineWorkflow({
			name: "noout",
			start: "a",
			stages: { a: produces({ outcome: undefined as never }) },
			edges: { a: "stop" },
		});
		const issues = validateWorkflow(wf);
		expect(issues.some((i) => /requiere outcome/.test(i.message))).toBe(true);
	});

	it("gate source sin outputSchema → error", () => {
		const wf = defineWorkflow({
			name: "gnoschema",
			start: "review",
			stages: {
				review: produces({ outcome: { collector: findPath } }), // sin outputSchema
				commit: acts(),
			},
			edges: { review: gate("n", { commit: gt(0) }, "commit"), commit: "stop" },
		});
		const issues = validateWorkflow(wf);
		expect(issues.some((i) => /outputSchema/.test(i.message))).toBe(true);
	});

	it("etapa inalcanzable → warning (no error)", () => {
		const wf = defineWorkflow({
			name: "unreach",
			start: "a",
			stages: { a: acts(), orphan: acts() },
			edges: { a: "stop" }, // orphan nunca referenciado
		});
		const issues = validateWorkflow(wf);
		expect(hasErrors(issues)).toBe(false);
		expect(
			issues.some((i) => i.severity === "warning" && /orphan/.test(i.message)),
		).toBe(true);
	});

	it("gate con branch key integer-like → lanza al construir", () => {
		expect(() => gate("n", { "2": gt(0) }, "commit")).toThrow(/integer-like/);
	});
});

// ===========================================================================
// Collectors (catálogo)
// ===========================================================================

describe("collectors", () => {
	it("urlCollector extrae URLs", () => {
		const c = urlCollector();
		const res = c({
			messages: [
				{ role: "assistant", content: "see https://a.com/x and http://b.io" },
			],
			cwd: "/tmp",
			stage: "s",
		});
		expect(res.kind).toBe("ok");
		if (res.kind === "ok") expect(res.artifacts.length).toBe(2);
	});

	it("directoryPathCollector lee el dir y marca el más nuevo como primary", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-dir-"));
		const older = path.join(dir, "a.md");
		const newer = path.join(dir, "b.md");
		fs.writeFileSync(older, "x");
		fs.writeFileSync(newer, "y", { flag: "w" });
		// forzar mtime newer > older
		const past = new Date(Date.now() - 10000);
		fs.utimesSync(older, past, past);
		const c = directoryPathCollector({ dir, ext: "md" });
		const res = c({ messages: [], cwd: dir, stage: "s" });
		expect(res.kind).toBe("ok");
		if (res.kind === "ok") {
			expect(res.artifacts[0]!.role).toBe("primary");
			expect((res.artifacts[0]!.handle as { path: string }).path).toBe(newer);
		}
	});

	it("toolCallCollector filtra y mapea tool_use", () => {
		const c = toolCallCollector({
			match: (tc) => tc.name === "write",
			toArtifact: (tc) => ({
				handle: {
					kind: "fs",
					path: String((tc.input as { path?: string }).path ?? ""),
				},
				role: "primary" as const,
			}),
		});
		const res = c({
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "tool_use", name: "write", input: { path: "/a" } },
						{ type: "tool_use", name: "read", input: {} },
					],
				},
			],
			cwd: "/tmp",
			stage: "s",
		});
		expect(res.kind).toBe("ok");
		if (res.kind === "ok") expect(res.artifacts.length).toBe(1);
	});

	it("unionCollectors concatena; fatal sólo si todos fallan", () => {
		const good = () => ({
			kind: "ok" as const,
			artifacts: [
				{
					handle: { kind: "fs" as const, path: "/a" },
					role: "primary" as const,
				},
			],
		});
		const bad = () => ({ kind: "fatal" as const, message: "x" });
		const u = unionCollectors(good, bad);
		const res = u({ messages: [], cwd: "/tmp", stage: "s" });
		expect(res.kind).toBe("ok");
		const allBad = unionCollectors(bad, bad);
		expect(allBad({ messages: [], cwd: "/tmp", stage: "s" }).kind).toBe(
			"fatal",
		);
	});

	describe("FS/git (repo temporal)", () => {
		function gitRepo(): string {
			const d = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-git-"));
			execSync("git init -q", { cwd: d });
			execSync("git config user.email t@t.tt && git config user.name t", {
				cwd: d,
			});
			fs.writeFileSync(path.join(d, "README.md"), "init");
			execSync("git add -A && git commit -qm init", { cwd: d });
			return d;
		}

		it("workspaceDiffCollector detecta archivos tocados durante la etapa", () => {
			const d = gitRepo();
			const pre = captureSnapshot(d);
			// simula que la etapa escribió un archivo nuevo
			fs.writeFileSync(path.join(d, "out.ts"), "export const x = 1;");
			const res = workspaceDiffCollector()({
				messages: [],
				cwd: d,
				stage: "s",
				preSnapshot: pre,
			});
			expect(res.kind).toBe("ok");
			if (res.kind === "ok") {
				expect(
					res.artifacts.some((a) =>
						(a.handle as { path: string }).path.endsWith("out.ts"),
					),
				).toBe(true);
			}
		});

		it("gitCommitCollector + gitCommitOutcome detectan nuevo commit", () => {
			const d = gitRepo();
			const pre = captureSnapshot(d);
			fs.writeFileSync(path.join(d, "c.txt"), "c");
			execSync("git add -A && git commit -qm second", { cwd: d });
			const ctx = { messages: [], cwd: d, stage: "s", preSnapshot: pre };
			const res = gitCommitCollector(ctx);
			expect(res.kind).toBe("ok");
			// parser del composite → {sha, prevSha}
			const data = gitCommitOutcome.parser!(
				res.kind === "ok" ? res.artifacts : [],
				ctx,
			);
			expect(
				(data as { sha: string; prevSha: string } | undefined)?.sha,
			).toBeTruthy();
		});
	});
});
