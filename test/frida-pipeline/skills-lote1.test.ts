// frida-pipeline — tests de skills del lote 1 (discover, research, code-review).
//
// Verifica el gate de Fase 6 (ADR-0021):
//   - Las 3 skills existen con SKILL.md válido.
//   - Cada frontmatter tiene name, description, contract.
//   - discover produce artifactKind: frd → .frida/artifacts/discover/
//   - research produce artifactKind: research → .frida/artifacts/research/
//   - code-review produce artifactKind: review → .frida/artifacts/reviews/
//   - Los scripts _shared/now.mjs y git-context.mjs ejecutan sin error.
//   - El conteo del banner reporta Skills: 3/27.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { computePipelineStatus } from "../../src/tools/frida-pipeline/setup-command";

const SKILLS_DIR = path.join(
	__dirname,
	"../../src/tools/frida-pipeline/skills",
);

describe("frida-pipeline / skills lote 1 / existencia", () => {
	it("las 3 skills del lote 1 existen", () => {
		for (const skill of ["discover", "research", "code-review"]) {
			const skillPath = path.join(SKILLS_DIR, skill, "SKILL.md");
			expect(fs.existsSync(skillPath), `${skill}/SKILL.md`).toBe(true);
		}
	});

	it("el conteo del banner reporta Skills >= 3/27", () => {
		const status = computePipelineStatus();
		expect(status.counts.skills.present).toBeGreaterThanOrEqual(3);
		expect(status.counts.skills.expected).toBe(27);
	});
});

describe("frida-pipeline / skills lote 1 / frontmatter", () => {
	it("discover tiene name, description, contract.produces.artifactKind: frd", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "discover", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("name: discover");
		expect(content).toContain("description:");
		expect(content).toContain("disable-model-invocation: true");
		expect(content).toContain("artifactKind: frd");
	});

	it("research tiene name, contract.produces.artifactKind: research, consumes frd", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "research", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("name: research");
		expect(content).toContain("artifactKind: research");
		expect(content).toContain("artifactKind: [frd]");
	});

	it("code-review tiene name, contract.produces.artifactKind: review", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "code-review", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("name: code-review");
		expect(content).toContain("artifactKind: review");
		expect(content).toContain("blockers_count");
	});

	it("code-review cita estándares de Frida (ADR-0001, ADR-0005, docs/adr/)", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "code-review", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("ADR-0001");
		expect(content).toContain("ADR-0005");
		expect(content).toContain("docs/adr/");
		expect(content).toContain("docs/tools/");
	});
});

describe("frida-pipeline / skills lote 1 / paths de artefactos", () => {
	it("discover escribe a .frida/artifacts/discover/", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "discover", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain(".frida/artifacts/discover/");
		// No debe usar el namespace rpiv.
		expect(content).not.toContain(".rpiv/artifacts/");
	});

	it("research escribe a .frida/artifacts/research/", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "research", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain(".frida/artifacts/research/");
	});

	it("code-review escribe a .frida/artifacts/reviews/", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "code-review", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain(".frida/artifacts/reviews/");
	});
});

describe("frida-pipeline / skills lote 1 / scripts _shared", () => {
	it("now.mjs ejecuta y devuelve timestamp + slug", () => {
		const scriptPath = path.join(SKILLS_DIR, "_shared", "now.mjs");
		expect(fs.existsSync(scriptPath)).toBe(true);
		const output = execFileSync("node", [scriptPath], {
			encoding: "utf-8",
			timeout: 5000,
		});
		expect(output).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\t\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
		);
	});

	it("git-context.mjs ejecuta y devuelve labels de git", () => {
		const scriptPath = path.join(SKILLS_DIR, "_shared", "git-context.mjs");
		expect(fs.existsSync(scriptPath)).toBe(true);
		const output = execFileSync("node", [scriptPath], {
			encoding: "utf-8",
			timeout: 5000,
		});
		expect(output).toContain("branch:");
		expect(output).toContain("commit:");
	});
});

describe("frida-pipeline / skills lote 1 / idioma", () => {
	it("discover está en español de México", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "discover", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("Pasos");
		expect(content).toContain("entrevista");
	});

	it("research está en español de México", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "research", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("investigación");
		expect(content).toContain("hallazgos");
	});

	it("code-review está en español de México", () => {
		const content = fs.readFileSync(
			path.join(SKILLS_DIR, "code-review", "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("revisión");
		expect(content).toContain("estándares");
	});
});
