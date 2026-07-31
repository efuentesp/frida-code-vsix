// frida-pipeline — tests de skills del lote 4 (pr-triage, handoffs, annotate, etc).
//
// Verifica el gate de Fase 9 (ADR-0021):
//   - Las 9 skills del lote 4 existen con SKILL.md válido.
//   - Frontmatter con name, contract, artifactKind correctos.
//   - pr-triage produce artifactKind: triage.
//   - create-handoff produce artifactKind: handoff.
//   - resume-handoff consume handoff (side-effect).
//   - annotate-guidance referencia .frida/guidance/.
//   - changelog produce side-effect: changelog-edit.
//   - architecture-review produce artifactKind: architecture-review.
//   - El conteo del banner reporta Skills: 27/27.

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

const LOTE4 = [
	"pr-triage",
	"create-handoff",
	"resume-handoff",
	"annotate-guidance",
	"annotate-inline",
	"migrate-to-guidance",
	"changelog",
	"architecture-review",
	"frontend-design",
] as const;

describe("frida-pipeline / skills lote 4 / existencia", () => {
	it("las 9 skills del lote 4 existen", () => {
		for (const skill of LOTE4) {
			expect(fs.existsSync(path.join(SKILLS_DIR, skill, "SKILL.md"))).toBe(
				true,
			);
		}
	});

	it("el conteo del banner reporta Skills: 27/27 (COMPLETO)", () => {
		const status = computePipelineStatus();
		expect(status.counts.skills.present).toBe(27);
		expect(status.counts.skills.expected).toBe(27);
	});
});

describe("frida-pipeline / skills lote 4 / kind y artifactKind", () => {
	it("pr-triage produce artifactKind: triage con security_flag + blockers_count", () => {
		const c = readSkill("pr-triage");
		expect(c).toContain("artifactKind: triage");
		expect(c).toContain("security_flag");
		expect(c).toContain("blockers_count");
	});

	it("create-handoff produce artifactKind: handoff con topic + status", () => {
		const c = readSkill("create-handoff");
		expect(c).toContain("artifactKind: handoff");
		expect(c).toContain("topic");
		expect(c).toContain("status");
	});

	it("resume-handoff es side-effect: work-continuation", () => {
		const c = readSkill("resume-handoff");
		expect(c).toContain("kind: side-effect");
		expect(c).toContain("effect: work-continuation");
	});

	it("annotate-guidance es side-effect: guidance-generation", () => {
		expect(readSkill("annotate-guidance")).toContain(
			"effect: guidance-generation",
		);
	});

	it("annotate-inline es side-effect: inline-annotation", () => {
		expect(readSkill("annotate-inline")).toContain("effect: inline-annotation");
	});

	it("migrate-to-guidance es side-effect: guidance-migration", () => {
		expect(readSkill("migrate-to-guidance")).toContain(
			"effect: guidance-migration",
		);
	});

	it("changelog es side-effect: changelog-edit", () => {
		expect(readSkill("changelog")).toContain("effect: changelog-edit");
	});

	it("architecture-review produce artifactKind: architecture-review", () => {
		const c = readSkill("architecture-review");
		expect(c).toContain("artifactKind: architecture-review");
		expect(c).toContain("required: [phases, layer_count]");
	});

	it("frontend-design es side-effect: design-guidelines-injection", () => {
		expect(readSkill("frontend-design")).toContain(
			"effect: design-guidelines-injection",
		);
	});
});

describe("frida-pipeline / skills lote 4 / contracts consumes", () => {
	it("resume-handoff consume handoff", () => {
		expect(readSkill("resume-handoff")).toContain("artifactKind: handoff");
	});

	it("annotate-guidance consume source-tree", () => {
		expect(readSkill("annotate-guidance")).toContain("world: source-tree");
	});

	it("changelog consume git-history", () => {
		expect(readSkill("changelog")).toContain("world: git-history");
	});

	it("migrate-to-guidance consume claude-md-tree", () => {
		expect(readSkill("migrate-to-guidance")).toContain("world: claude-md-tree");
	});
});

describe("frida-pipeline / skills lote 4 / paths y namespace", () => {
	it("pr-triage escribe a .frida/artifacts/triage/", () => {
		expect(readSkill("pr-triage")).toContain(".frida/artifacts/triage/");
	});

	it("create-handoff escribe a .frida/artifacts/handoffs/", () => {
		expect(readSkill("create-handoff")).toContain(".frida/artifacts/handoffs/");
	});

	it("architecture-review escribe a .frida/artifacts/architecture-reviews/", () => {
		expect(readSkill("architecture-review")).toContain(
			".frida/artifacts/architecture-reviews/",
		);
	});

	it("annotate-guidance referencia .frida/guidance/", () => {
		expect(readSkill("annotate-guidance")).toContain(".frida/guidance/");
	});

	it("migrate-to-guidance migra a .frida/guidance/", () => {
		expect(readSkill("migrate-to-guidance")).toContain(".frida/guidance/");
	});

	it("ninguna skill usa .rpiv/", () => {
		for (const skill of LOTE4) {
			expect(readSkill(skill)).not.toContain(".rpiv/");
		}
	});
});

describe("frida-pipeline / skills / set COMPLETO (27/27)", () => {
	it("todas las 27 skills existen", () => {
		const allSkills = [
			// Lote 1
			"discover",
			"research",
			"code-review",
			// Lote 2
			"design",
			"design-slice",
			"design-review",
			"synthesize",
			"plan",
			"blueprint",
			"elaborate",
			"revise",
			// Lote 3
			"implement",
			"validate",
			"slice",
			"explore",
			"grade",
			"amend",
			"commit",
			// Lote 4
			...LOTE4,
		];
		expect(allSkills).toHaveLength(27);
		for (const skill of allSkills) {
			expect(
				fs.existsSync(path.join(SKILLS_DIR, skill, "SKILL.md")),
				`${skill}`,
			).toBe(true);
		}
	});

	it("todas las skills tienen name: en el frontmatter", () => {
		const dirs = fs
			.readdirSync(SKILLS_DIR, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name !== "_shared")
			.map((e) => e.name);
		expect(dirs).toHaveLength(27);
		for (const dir of dirs) {
			const content = readSkill(dir);
			expect(content, `${dir} debe tener name:`).toContain(`name: ${dir}`);
		}
	});
});
