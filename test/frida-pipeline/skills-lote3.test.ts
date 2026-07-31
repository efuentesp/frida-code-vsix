// frida-pipeline — tests de skills del lote 3 (implement, validate, slice, etc).
//
// Verifica el gate de Fase 8 (ADR-0021):
//   - Las 7 skills del lote 3 existen con SKILL.md válido.
//   - Frontmatter con name, contract, artifactKind correctos.
//   - implement produce side-effect: code-mutation.
//   - validate produce artifactKind: validation con verdict pass|fail.
//   - slice produce artifactKind: slices con required [slices, slice_count].
//   - explore produce artifactKind: solutions.
//   - grade produce artifactKind: verdict con required [dimension, pass, severity].
//   - commit produce side-effect: git-commit.
//   - git-changes.mjs ejecuta sin error.
//   - El conteo del banner reporta Skills: 18/27.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
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

const LOTE3 = [
	"implement",
	"validate",
	"slice",
	"explore",
	"grade",
	"amend",
	"commit",
] as const;

describe("frida-pipeline / skills lote 3 / existencia", () => {
	it("las 7 skills del lote 3 existen", () => {
		for (const skill of LOTE3) {
			expect(fs.existsSync(path.join(SKILLS_DIR, skill, "SKILL.md"))).toBe(
				true,
			);
		}
	});

	it("el conteo del banner reporta Skills: 18/27", () => {
		const status = computePipelineStatus();
		expect(status.counts.skills.present).toBeGreaterThanOrEqual(18);
		expect(status.counts.skills.expected).toBe(27);
	});
});

describe("frida-pipeline / skills lote 3 / kind y artifactKind", () => {
	it("implement es side-effect: code-mutation", () => {
		const c = readSkill("implement");
		expect(c).toContain("kind: side-effect");
		expect(c).toContain("effect: code-mutation");
	});

	it("validate produce artifactKind: validation con verdict", () => {
		const c = readSkill("validate");
		expect(c).toContain("artifactKind: validation");
		expect(c).toContain("verdict:");
		expect(c).toContain("enum: [pass, fail]");
	});

	it("slice produce artifactKind: slices", () => {
		const c = readSkill("slice");
		expect(c).toContain("artifactKind: slices");
		expect(c).toContain("required: [slices, slice_count]");
	});

	it("explore produce artifactKind: solutions", () => {
		expect(readSkill("explore")).toContain("artifactKind: solutions");
	});

	it("grade produce artifactKind: verdict", () => {
		const c = readSkill("grade");
		expect(c).toContain("artifactKind: verdict");
		expect(c).toContain("required: [dimension, pass, severity]");
	});

	it("commit es side-effect: git-commit", () => {
		const c = readSkill("commit");
		expect(c).toContain("kind: side-effect");
		expect(c).toContain("effect: git-commit");
	});
});

describe("frida-pipeline / skills lote 3 / contracts consumes", () => {
	it("implement consume plans", () => {
		expect(readSkill("implement")).toContain("artifactKind: plan");
	});

	it("validate consume plans con world: working-tree", () => {
		const c = readSkill("validate");
		expect(c).toContain("plans:");
		expect(c).toContain("world: working-tree");
	});

	it("explore consume research", () => {
		expect(readSkill("explore")).toContain("artifactKind: [research]");
	});

	it("commit consume dirty-tree", () => {
		expect(readSkill("commit")).toContain("world: dirty-tree");
	});
});

describe("frida-pipeline / skills lote 3 / paths de artefactos", () => {
	it("validate escribe a .frida/artifacts/validation/", () => {
		expect(readSkill("validate")).toContain(".frida/artifacts/validation/");
	});

	it("slice escribe a .frida/artifacts/slices/", () => {
		expect(readSkill("slice")).toContain(".frida/artifacts/slices/");
	});

	it("explore escribe a .frida/artifacts/solutions/", () => {
		expect(readSkill("explore")).toContain(".frida/artifacts/solutions/");
	});

	it("grade escribe a .frida/artifacts/verdicts/", () => {
		expect(readSkill("grade")).toContain(".frida/artifacts/verdicts/");
	});

	it("ninguna skill usa .rpiv/", () => {
		for (const skill of LOTE3) {
			expect(readSkill(skill)).not.toContain(".rpiv/");
		}
	});
});

describe("frida-pipeline / skills lote 3 / script git-changes", () => {
	it("git-changes.mjs ejecuta y devuelve labels de cambios", () => {
		const scriptPath = path.join(SKILLS_DIR, "_shared", "git-changes.mjs");
		expect(fs.existsSync(scriptPath)).toBe(true);
		const output = execFileSync("node", [scriptPath], {
			encoding: "utf-8",
			timeout: 5000,
		});
		expect(output).toContain("in_repo:");
	});
});

describe("frida-pipeline / skills lote 3 / loop grade→amend", () => {
	it("grade emite pass/severity/findings (estructura para loop)", () => {
		const c = readSkill("grade");
		expect(c).toContain("pass");
		expect(c).toContain("severity");
		expect(c).toContain("findings");
	});

	it("amend consume veredictos y aplica arreglos (loop partner)", () => {
		const c = readSkill("amend");
		expect(c).toContain("veredictos");
		expect(c).toContain("arregl");
	});
});
