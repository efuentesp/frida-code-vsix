// frida-pipeline — tests de skills del lote 2 (design, plan, synthesize, etc).
//
// Verifica el gate de Fase 7 (ADR-0021):
//   - Las 8 skills del lote 2 existen con SKILL.md válido.
//   - Frontmatter con name, contract, artifactKind correctos.
//   - design produce artifactKind: design → .frida/artifacts/designs/
//   - synthesize/plan/blueprint producen artifactKind: plan → .frida/artifacts/plans/
//   - elaborate produce artifactKind: elaboration → .frida/artifacts/elaborations/
//   - revise consume plans + reviews.
//   - El conteo del banner reporta Skills: 11/27.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { computePipelineStatus } from "../../src/tools/frida-pipeline/setup-command";

const SKILLS_DIR = path.join(
	__dirname,
	"../../src/tools/frida-pipeline/skills",
);

function readSkill(name: string): string {
	const p = path.join(SKILLS_DIR, name, "SKILL.md");
	expect(fs.existsSync(p), `${name}/SKILL.md debe existir`).toBe(true);
	return fs.readFileSync(p, "utf-8");
}

const LOTE2 = [
	"design",
	"design-slice",
	"design-review",
	"synthesize",
	"plan",
	"blueprint",
	"elaborate",
	"revise",
] as const;

describe("frida-pipeline / skills lote 2 / existencia", () => {
	it("las 8 skills del lote 2 existen", () => {
		for (const skill of LOTE2) {
			expect(fs.existsSync(path.join(SKILLS_DIR, skill, "SKILL.md"))).toBe(
				true,
			);
		}
	});

	it("el conteo del banner reporta Skills >= 11/27", () => {
		const status = computePipelineStatus();
		expect(status.counts.skills.present).toBeGreaterThanOrEqual(11);
		expect(status.counts.skills.expected).toBe(27);
	});
});

describe("frida-pipeline / skills lote 2 / frontmatter y artifactKind", () => {
	it("design produce artifactKind: design", () => {
		expect(readSkill("design")).toContain("artifactKind: design");
	});

	it("design-slice produce artifactKind: design", () => {
		expect(readSkill("design-slice")).toContain("artifactKind: design");
	});

	it("synthesize produce artifactKind: plan", () => {
		expect(readSkill("synthesize")).toContain("artifactKind: plan");
	});

	it("plan produce artifactKind: plan", () => {
		expect(readSkill("plan")).toContain("artifactKind: plan");
	});

	it("blueprint produce artifactKind: plan", () => {
		expect(readSkill("blueprint")).toContain("artifactKind: plan");
	});

	it("elaborate produce artifactKind: elaboration", () => {
		expect(readSkill("elaborate")).toContain("artifactKind: elaboration");
	});

	it("revise produce artifactKind: plan", () => {
		expect(readSkill("revise")).toContain("artifactKind: plan");
	});
});

describe("frida-pipeline / skills lote 2 / contracts consumes", () => {
	it("design consume research o solutions", () => {
		expect(readSkill("design")).toContain(
			"artifactKind: [research, solutions]",
		);
	});

	it("design-slice consume slices o design", () => {
		expect(readSkill("design-slice")).toContain(
			"artifactKind: [slices, design]",
		);
	});

	it("elaborate consume plan", () => {
		expect(readSkill("elaborate")).toContain("artifactKind: [plan]");
	});

	it("revise consume plans y reviews", () => {
		const content = readSkill("revise");
		expect(content).toContain("plans:");
		expect(content).toContain("reviews:");
	});
});

describe("frida-pipeline / skills lote 2 / paths de artefactos", () => {
	it("design escribe a .frida/artifacts/designs/", () => {
		expect(readSkill("design")).toContain(".frida/artifacts/designs/");
	});

	it("synthesize escribe a .frida/artifacts/plans/", () => {
		expect(readSkill("synthesize")).toContain(".frida/artifacts/plans/");
	});

	it("plan escribe a .frida/artifacts/plans/", () => {
		expect(readSkill("plan")).toContain(".frida/artifacts/plans/");
	});

	it("elaborate escribe a .frida/artifacts/elaborations/", () => {
		expect(readSkill("elaborate")).toContain(".frida/artifacts/elaborations/");
	});

	it("ninguna skill usa .rpiv/", () => {
		for (const skill of LOTE2) {
			expect(readSkill(skill)).not.toContain(".rpiv/");
		}
	});
});

describe("frida-pipeline / skills lote 2 / required fields", () => {
	it("synthesize tiene required: [phases, phase_count]", () => {
		expect(readSkill("synthesize")).toContain(
			"required: [phases, phase_count]",
		);
	});

	it("plan tiene required: [phases, phase_count]", () => {
		expect(readSkill("plan")).toContain("required: [phases, phase_count]");
	});

	it("blueprint tiene required: [phases, phase_count]", () => {
		expect(readSkill("blueprint")).toContain("required: [phases, phase_count]");
	});
});

describe("frida-pipeline / skills lote 2 / disable-model-invocation", () => {
	it("las 7 pipeline skills tienen disable-model-invocation: true", () => {
		// Todas menos design-review (que produce sin artifactKind meta).
		for (const skill of LOTE2) {
			if (skill === "design-review") continue;
			expect(readSkill(skill)).toContain("disable-model-invocation: true");
		}
	});
});
