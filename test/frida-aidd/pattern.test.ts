// frida-aidd — tests del patrón aidd-plan: validación de args, generación del
// script y registro en runtime sobre el motor (registerBuiltinPattern /
// findBuiltinPattern / builtinPatternsCatalog). Issue #38 Lote 1.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	AIDD_PLAN_PATTERN,
	validateAiddPlanArgs,
} from "../../src/tools/frida-aidd";
import {
	clearRegisteredBuiltinPatterns,
	findBuiltinPattern,
	builtinPatternsCatalog,
	registerBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import { resolveStagePrompts } from "../../src/tools/frida-aidd/resolver";

const REAL_HOME = process.env.HOME;

beforeEach(() => {
	process.env.HOME = mkdtempSync(join(tmpdir(), "aidd-pat-home-"));
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	clearRegisteredBuiltinPatterns();
});

describe("frida-aidd · validateAiddPlanArgs (#38)", () => {
	it("requiere idea no vacía", () => {
		expect(() => validateAiddPlanArgs({})).toThrow(/args\.idea/);
		expect(() => validateAiddPlanArgs({ idea: "  " })).toThrow(/args\.idea/);
	});

	it("rechaza review inválido y acepta los válidos", () => {
		expect(() => validateAiddPlanArgs({ idea: "x", review: "yolo" })).toThrow(
			/review/,
		);
		expect(validateAiddPlanArgs({ idea: "x" }).review).toBeUndefined();
		expect(validateAiddPlanArgs({ idea: "x", review: "auto" }).review).toBe(
			"auto",
		);
		expect(validateAiddPlanArgs({ idea: "x", review: "manual" }).review).toBe(
			"manual",
		);
	});

	it("args no-objeto falla con idea", () => {
		expect(() => validateAiddPlanArgs(null)).toThrow(/args\.idea/);
		expect(() => validateAiddPlanArgs(["a"])).toThrow(/args\.idea/);
	});
});

describe("frida-aidd · generación del script aidd-plan (#38)", () => {
	it("resolve() produce script con la cadena y el fan-out de specs", () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "módulo de reportes", project: "frida" },
			{ cwd: process.cwd() },
		);
		// Cadena secuencial de 4 stages + spec fan-out.
		for (const stage of [
			"product-brief",
			"prd",
			"architecture",
			"epics-and-stories",
		]) {
			expect(script).toContain(`phase("${stage}")`);
		}
		expect(script).toContain('phase("spec (fan-out por historia)")');
		// Checkpoints entre stages (review manual por defecto) + pre-fan-out (#68).
		expect(script.match(/await checkpoint\(/g)?.length).toBe(4);
		expect(script).toContain('checkpoint({ name: "spec-fanout"');
		// Specs paralelas por historia con outputSchema en el extractor.
		expect(script).toContain("outputSchema");
		expect(script).toContain("parallel(\"specs\"");
		// La idea viaja vía args en runtime (patrón del motor), no interpolada.
		expect(script).toContain("(args && args.idea)");
	});

	it("los prompts de todos los stages llegan interpolados", () => {
		const stages = resolveStagePrompts(process.cwd());
		const script = AIDD_PLAN_PATTERN.resolve({ idea: "x" }, { cwd: process.cwd() });
		for (const s of stages) {
			// Un fragmento distintivo del prompt default de cada stage.
			const probe = s.prompt.slice(0, 24).replace(/[\\`$]/g, "");
			if (probe) expect(script).toContain(probe.slice(0, 12));
		}
	});

	it("stages sin ctx usa process.cwd() (no explota)", () => {
		expect(typeof AIDD_PLAN_PATTERN.resolve({ idea: "x" })).toBe("string");
	});
});

describe("frida-aidd · registro en runtime sobre el motor (#38)", () => {
	it("registerBuiltinPattern expone aidd-plan al findBuiltinPattern", () => {
		expect(findBuiltinPattern("aidd-plan")).toBeUndefined();
		registerBuiltinPattern(AIDD_PLAN_PATTERN);
		const found = findBuiltinPattern("aidd-plan");
		expect(found?.name).toBe("aidd-plan");
		expect(found?.description).toContain("AiDD");
	});

	it("el catálogo lista el patrón registrado junto a los builtin", () => {
		registerBuiltinPattern(AIDD_PLAN_PATTERN);
		const names = builtinPatternsCatalog().map((p) => p.name);
		expect(names).toContain("aidd-plan");
		expect(names).toContain("code-review"); // los 4 de #19 siguen
		expect(names).toHaveLength(5);
	});

	it("registro es idempotente por nombre (no duplica)", () => {
		registerBuiltinPattern(AIDD_PLAN_PATTERN);
		registerBuiltinPattern(AIDD_PLAN_PATTERN);
		expect(
			builtinPatternsCatalog().filter((p) => p.name === "aidd-plan"),
		).toHaveLength(1);
	});

	it("un patrón runtime puede pisar el nombre de uno estático (gana el último)", () => {
		registerBuiltinPattern({
			...AIDD_PLAN_PATTERN,
			name: "code-review",
			resolve: () => "// override",
		});
		expect(findBuiltinPattern("code-review")?.resolve({ diff: "d" })).toBe(
			"// override",
		);
	});
});

const STAGE_CHAIN = [
	"product-brief",
	"prd",
	"architecture",
	"epics-and-stories",
] as const;
const PLANNING_DIR = "docs/aidd/planning";
const ARTIFACTS: Record<string, string> = {
	"product-brief": "product-brief.md",
	prd: "prd.md",
	architecture: "architecture.md",
	"epics-and-stories": "epics-and-stories.md",
};

function resolveBuiltInPatternScriptForTest(): string {
	return AIDD_PLAN_PATTERN.resolve(
		{ idea: "módulo de reportes", project: "frida" },
		{ cwd: process.cwd() },
	);
}

describe("frida-aidd · gate de artefacto por stage (#65)", () => {
	it("cada stage de la cadena verifica test -s <artifact> ANTES de concatenar y del checkpoint", () => {
		const script = resolveBuiltInPatternScriptForTest();
		for (const [i, stage] of STAGE_CHAIN.entries()) {
			const artifact = `${PLANNING_DIR}/${ARTIFACTS[stage]}`;
			const gate = `await shell("test -s ${artifact}"`;
			expect(script).toContain(gate);
			// El gate DEBE estar antes del checkpoint de su stage (si tiene).
			const gateIdx = script.indexOf(gate);
			const cpIdx = script.indexOf(`checkpoint({ name: "stage-${stage}"`);
			if (cpIdx >= 0) expect(gateIdx).toBeLessThan(cpIdx);
			expect(gateIdx).toBeGreaterThan(0);
			// …y antes de que el siguiente stage reciba la ruta como upstream.
			if (i + 1 < STAGE_CHAIN.length) {
				const nextGate = script.indexOf(
					`await shell("test -s ${PLANNING_DIR}/${ARTIFACTS[STAGE_CHAIN[i + 1]]}"`,
				);
				expect(gateIdx).toBeLessThan(nextGate);
			}
		}
	});

	it("el error del gate es accionable: menciona el stage, la ruta y qué hacer", () => {
		const script = resolveBuiltInPatternScriptForTest();
		expect(script).toContain("NO escribió");
		expect(script).toContain("revisa el summary");
	});
});

describe("frida-aidd · reintento informado del gate de artefacto (#67)", () => {
	it("gate A y gate B desenrollados por stage, con agente de reintento entre ambos", () => {
		const script = resolveBuiltInPatternScriptForTest();
		for (const [i, stage] of STAGE_CHAIN.entries()) {
			const artifact = `${PLANNING_DIR}/${ARTIFACTS[stage]}`;
			const gateA = `const gate${i}a = await shell("test -s ${artifact}"`;
			const retryLabel = `stage ${stage} (reintento)`;
			const gateB = `const gate${i}b = await shell("test -s ${artifact}"`;
			expect(script).toContain(gateA);
			expect(script).toContain(retryLabel);
			expect(script).toContain(gateB);
			// Orden dentro del stage: gate A → reintento → gate B → checkpoint.
			const a = script.indexOf(gateA);
			const r = script.indexOf(retryLabel, a);
			const b = script.indexOf(gateB, r);
			expect(a).toBeGreaterThan(-1);
			expect(r).toBeGreaterThan(a);
			expect(b).toBeGreaterThan(r);
			const cpIdx = script.indexOf(`checkpoint({ name: "stage-${stage}"`);
			if (cpIdx >= 0) expect(b).toBeLessThan(cpIdx);
			// Los dos gates son callsites DISTINTOS (journaling #65: nada de loops).
			expect(script.match(/while \(|for \(/g)?.length ?? 0).toBe(0);
		}
	});

	it("el reintento es informado: evidencia del gate + summary del intento 1, reusando el prompt del stage", () => {
		const script = resolveBuiltInPatternScriptForTest();
		expect(script).toContain("Tu intento anterior NO escribió");
		// El summary del intento 1 viaja truncado (no blob)…
		expect(script).toContain("slice(0, 400)");
		// …y el reintento reutiliza ctxFor con el MISMO prompt del stage.
		expect(script).toContain("ctxFor(STAGES[1], P1, prevPaths) +");
	});

	it("segunda falla rechaza con expediente: ambos intentos + ls real del directorio", () => {
		const script = resolveBuiltInPatternScriptForTest();
		expect(script).toContain("tras 2 intentos");
		expect(script).toContain("Intento 1:");
		expect(script).toContain("Intento 2:");
		expect(script).toContain(`await shell("ls -la ${PLANNING_DIR}"`);
	});
});

describe("frida-aidd · hardening v2 (#68)", () => {
	it("contrato de salida primero: OUTPUT CONTRACT — READ FIRST con ruta absoluta, antes del prompt del skill", () => {
		const script = resolveBuiltInPatternScriptForTest();
		expect(script).toContain("## OUTPUT CONTRACT — READ FIRST");
		// El contrato vive en ctxFor — antes de que se concatene el prompt del skill.
		const contractIdx = script.indexOf("## OUTPUT CONTRACT — READ FIRST");
		const ctxBodyIdx = script.indexOf("prompt +");
		expect(contractIdx).toBeGreaterThan(-1);
		expect(contractIdx).toBeLessThan(ctxBodyIdx);
		// Ruta absoluta interpolada host-side (cwd de resolve) + prohibición de inline.
		expect(script).toContain(
			`const absDir = ${JSON.stringify(`${process.cwd()}/${PLANNING_DIR}`)}`,
		);
		expect(script).toContain("NEVER paste the artifact content inline");
		// Recordatorio al cierre (primacy + recency).
		expect(script).toContain("## Reminder");
		// El mapa stage→artefacto existe para el contrato (incluye spec).
		expect(script).toContain('ART["spec"]');
	});

	it("resume idempotente: pre-check por stage — si el artefacto existe se preserva y el agente se salta", () => {
		const script = resolveBuiltInPatternScriptForTest();
		for (const [i, stage] of STAGE_CHAIN.entries()) {
			const pre = `const pre${i} = await shell("test -s ${PLANNING_DIR}/${ARTIFACTS[stage]}"`;
			const agentCall = `summaries["${stage}"] = await agent(ctxFor(STAGES[${i}]`;
			expect(script).toContain(pre);
			expect(script).toContain(agentCall);
			// El pre-check va ANTES del agente del stage (skip temprano, cero gasto).
			expect(script.indexOf(pre)).toBeLessThan(script.indexOf(agentCall));
		}
		expect(script).toContain("preservado — ya existía");
		// Upstream absolutos para el agente (sin ambigüedad de cwd).
		expect(script).toContain('prevPaths.concat([absDir + "/" + A0');
	});

	it("fan-out de specs con gate por lote, reintento informado y expediente (#68)", () => {
		const script = resolveBuiltInPatternScriptForTest();
		expect(script).toContain("const specPre = await shell(");
		expect(script).toContain("const specGate = await shell(");
		expect(script).toContain("const specRetryGate = await shell(");
		expect(script).toContain("const specDiag = await shell(");
		expect(script).toContain("specs fantasma");
		// El expediente de specs incluye stderr del ls (no sólo stdout).
		expect(script).toContain("specDiag.stdout || specDiag.stderr");
	});

	it("checkpoint pre-fan-out gated por review=manual, después del extractor y antes del parallel", () => {
		const script = resolveBuiltInPatternScriptForTest();
		const cpIdx = script.indexOf('checkpoint({ name: "spec-fanout"');
		expect(cpIdx).toBeGreaterThan(-1);
		expect(cpIdx).toBeGreaterThan(script.indexOf("return ONLY a JSON object"));
		expect(cpIdx).toBeLessThan(script.indexOf('parallel("specs"'));
		// Está dentro del if (review === "manual") más cercano antes de él.
		const manualIf = script.lastIndexOf('if (review === "manual")', cpIdx);
		expect(manualIf).toBeGreaterThan(-1);
	});

	it("expediente de cadena (#67) incluye stderr del ls", () => {
		const script = resolveBuiltInPatternScriptForTest();
		expect(script).toContain("diag0.stdout || diag0.stderr");
	});
});
