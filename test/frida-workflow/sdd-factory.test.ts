import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defineSddWorkflow } from "../../src/tools/frida-workflow/sdd-factory";
import type {
	CollectCtx,
	RouteCtx,
} from "../../src/tools/frida-workflow/types";

const dirs: string[] = [];
afterAll(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Proyecto fixture con .frida/artifacts/validation/ y N informes .md. */
function projectWithValidations(
	...reports: Array<{ name: string; verdict: string; mtime: Date }>
): string {
	const proj = mkdtempSync(join(tmpdir(), "sdd-factory-"));
	dirs.push(proj);
	const dir = join(proj, ".frida", "artifacts", "validation");
	mkdirSync(dir, { recursive: true });
	for (const r of reports) {
		const f = join(dir, r.name);
		writeFileSync(f, `---\nverdict: ${r.verdict}\n---\n\ninforme de ${r.name}\n`);
		utimesSync(f, r.mtime, r.mtime);
	}
	return proj;
}

/** RouteCtx mínimo para invocar el EdgeFn directamente. */
function ctx(
	cwd: string,
	overrides?: { passed?: boolean; stagesCompleted?: number },
): RouteCtx {
	return {
		output: { data: { passed: overrides?.passed }, artifacts: [] },
		state: { stagesCompleted: overrides?.stagesCompleted ?? 1 },
		cwd,
	} as unknown as RouteCtx;
}

const t = (min: number, sec = 0) => new Date(2026, 7, 31, 12, min, sec);

describe("defineSddWorkflow — shape (#188)", () => {
	it("sdd-ship: elaborate → implement → validate → commit con defaults", () => {
		const wf = defineSddWorkflow({ name: "sdd-ship", start: "elaborate" });
		expect(wf.start).toBe("elaborate");
		expect(Object.keys(wf.stages)).toEqual([
			"elaborate",
			"implement",
			"validate",
			"commit",
		]);
		expect(wf.stages.elaborate?.skill).toBe("elaborate");
		expect(wf.edges.elaborate).toBe("implement");
		expect(wf.edges.implement).toBe("validate");
		expect(wf.edges.commit).toBe("stop");
	});

	it("sdd-full: sin elaborate, start implement, commit itera fases", () => {
		const wf = defineSddWorkflow({
			name: "sdd-full",
			nextPhaseAfterCommit: true,
		});
		expect(wf.start).toBe("implement");
		expect(wf.stages.elaborate).toBeUndefined();
		expect(wf.edges.commit).toBe("implement");
	});

	it("skills y breakerCycles parametrizables", () => {
		const wf = defineSddWorkflow({
			name: "x",
			skills: { implement: "imp2", validate: "val2" },
			breakerCycles: 5,
		});
		expect(wf.stages.implement?.skill).toBe("imp2");
		expect(wf.stages.validate?.skill).toBe("val2");
	});
});

describe("defineSddWorkflow — route por verdict", () => {
	it("informe fresco pass → commit (aunque el output diga fail — #174)", () => {
		const proj = projectWithValidations(
			{
				name: "viejo.md",
				verdict: "fail",
				mtime: t(0),
			},
			{
				name: "nuevo.md",
				verdict: "pass",
				mtime: t(5),
			},
		);
		const wf = defineSddWorkflow({ name: "s", start: "elaborate" });
		const route = wf.edges.validate as (c: RouteCtx) => string;
		expect(route(ctx(proj, { passed: false }))).toBe("commit");
	});

	it("informe fresco fail → implement (aunque el output diga pass)", () => {
		const proj = projectWithValidations({
			name: "nuevo.md",
			verdict: "fail",
			mtime: t(5),
		});
		const wf = defineSddWorkflow({ name: "s", start: "elaborate" });
		const route = wf.edges.validate as (c: RouteCtx) => string;
		expect(route(ctx(proj, { passed: true }))).toBe("implement");
	});

	it("sin informes: cae al output del collector (fallback)", () => {
		const proj = mkdtempSync(join(tmpdir(), "sdd-factory-"));
		dirs.push(proj);
		const wf = defineSddWorkflow({ name: "s" });
		const route = wf.edges.validate as (c: RouteCtx) => string;
		expect(route(ctx(proj, { passed: true }))).toBe("commit");
	});

	it("breaker: al 3er FAIL (stagesCompleted 7 con elaborate) → stop", () => {
		const proj = projectWithValidations({
			name: "nuevo.md",
			verdict: "fail",
			mtime: t(5),
		});
		const wf = defineSddWorkflow({ name: "s", start: "elaborate" });
		const route = wf.edges.validate as (c: RouteCtx) => string;
		expect(route(ctx(proj, { stagesCompleted: 6 }))).toBe("implement");
		expect(route(ctx(proj, { stagesCompleted: 7 }))).toBe("stop");
	});

	it("breaker sdd-full (sin elaborate): umbral 6", () => {
		const proj = projectWithValidations({
			name: "nuevo.md",
			verdict: "fail",
			mtime: t(5),
		});
		const wf = defineSddWorkflow({ name: "s" });
		const route = wf.edges.validate as (c: RouteCtx) => string;
		expect(route(ctx(proj, { stagesCompleted: 6 }))).toBe("stop");
	});
});

describe("defineSddWorkflow — collector", () => {
	it("entrega el informe .md más reciente del validationDir", () => {
		const proj = projectWithValidations(
			{
				name: "a-viejo.md",
				verdict: "fail",
				mtime: t(0),
			},
			{
				name: "z-reciente.md",
				verdict: "pass",
				mtime: t(9),
			},
			{
				name: "m-medio.md",
				verdict: "fail",
				mtime: t(3),
			},
		);
		const wf = defineSddWorkflow({ name: "s" });
		const collector = wf.stages.validate?.outcome?.collector!;
		const res = collector({
			cwd: proj,
			messages: [],
			stage: "validate",
		} as unknown as CollectCtx);
		expect(res.kind).toBe("ok");
		if (res.kind !== "ok") return;
		const path = res.artifacts[0]?.handle as { kind: string; path?: string };
		expect(path.kind).toBe("fs");
		expect(path.path).toContain("z-reciente.md");
	});

	it("verdictKey parametrizable", () => {
		const proj = mkdtempSync(join(tmpdir(), "sdd-factory-"));
		dirs.push(proj);
		const dir = join(proj, ".frida", "artifacts", "validation");
		mkdirSync(dir, { recursive: true });
		const f = join(dir, "custom.md");
		writeFileSync(f, "---\nresultado: pass\n---\n");
		const wf = defineSddWorkflow({ name: "s", verdictKey: "resultado" });
		const route = wf.edges.validate as (c: RouteCtx) => string;
		expect(route(ctx(proj, { passed: false }))).toBe("commit");
	});
});

describe("defineSddWorkflow — parser resuelve contra ctx.cwd (#192)", () => {
	it("handle relativo legible aunque process.cwd() ≠ workspace", () => {
		const proj = projectWithValidations({
			name: "informe.md",
			verdict: "fail",
			mtime: t(5),
		});
		const wf = defineSddWorkflow({ name: "s" });
		const res = wf.stages.validate?.outcome?.collector!({
			cwd: proj,
			messages: [],
			stage: "validate",
		} as unknown as CollectCtx);
		if (res.kind !== "ok") throw new Error("collector fatal");
		// El handle llega RELATIVO y el proceso de vitest corre con cwd = repo
		// frida-code (≠ proj) — igual que el extension host con cwd ≠ workspace.
		// Antes del fix: readFileSync relativo → ENOENT → undefined →
		// "outputSchema rechazado: : must be object".
		const parser = wf.stages.validate?.outcome?.parser!;
		const data = parser(res.artifacts, {
			cwd: proj,
			messages: [],
			stage: "validate",
		} as unknown as CollectCtx);
		expect(data).toEqual({ passed: false });
	});

	it('tolera verdict con comillas — verdict: "fail"', () => {
		const proj = mkdtempSync(join(tmpdir(), "sdd-factory-"));
		dirs.push(proj);
		const dir = join(proj, ".frida", "artifacts", "validation");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "n.md"),
			'---\nstatus: ready\nverdict: "fail"\n---\n',
		);
		const wf = defineSddWorkflow({ name: "s" });
		const res = wf.stages.validate?.outcome?.collector!({
			cwd: proj,
			messages: [],
			stage: "validate",
		} as unknown as CollectCtx);
		if (res.kind !== "ok") throw new Error("collector fatal");
		const parser = wf.stages.validate?.outcome?.parser!;
		const data = parser(res.artifacts, {
			cwd: proj,
			messages: [],
			stage: "validate",
		} as unknown as CollectCtx);
		expect(data).toEqual({ passed: false });
	});
});
