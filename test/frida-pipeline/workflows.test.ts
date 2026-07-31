// frida-pipeline — tests de workflows built-in (build, vet, polish).
//
// Verifica el gate de Fase 10 (ADR-0021):
//   - Los 3 workflows existen con la estructura Workflow válida.
//   - build tiene 7 stages: discover → research → design → plan → implement → validate → commit.
//   - vet tiene 2 stages: code-review → validate.
//   - polish tiene 4 stages: architecture-review → plan → implement → validate.
//   - Todas las stages despachan skills existentes.
//   - Los edges son lineales y terminan en "stop".
//   - El conteo del banner reporta Workflows: 3/3.
//   - registerWorkflows los añade al registry de frida-workflow.

import { describe, it, expect, beforeEach } from "vitest";
import {
	buildWorkflow,
	vetWorkflow,
	polishWorkflow,
	PIPELINE_WORKFLOWS,
} from "../../src/tools/frida-pipeline/workflows";
import {
	registerWorkflows,
	listWorkflows,
	_resetRegistry,
} from "../../src/tools/frida-workflow/command";
import { computePipelineStatus } from "../../src/tools/frida-pipeline/setup-command";
import type { Workflow } from "../../src/tools/frida-workflow/types";

beforeEach(() => {
	_resetRegistry();
});

describe("frida-pipeline / workflows / PIPELINE_WORKFLOWS", () => {
	it("tiene exactamente 3 workflows", () => {
		expect(PIPELINE_WORKFLOWS).toHaveLength(3);
		expect(PIPELINE_WORKFLOWS.map((w) => w.name)).toEqual([
			"build",
			"vet",
			"polish",
		]);
	});

	it("el conteo del banner reporta Workflows: 3/3", () => {
		const status = computePipelineStatus();
		expect(status.counts.workflows.present).toBe(3);
		expect(status.counts.workflows.expected).toBe(3);
	});
});

describe("frida-pipeline / workflows / build", () => {
	const wf = buildWorkflow;

	it("tiene name, start, stages y edges", () => {
		expect(wf.name).toBe("build");
		expect(wf.start).toBe("discover");
		expect(Object.keys(wf.stages).length).toBe(7);
		expect(Object.keys(wf.edges).length).toBe(7);
	});

	it("los 7 stages despachan skills en orden del pipeline", () => {
		const stages = Object.keys(wf.stages);
		expect(stages).toEqual([
			"discover",
			"research",
			"design",
			"plan",
			"implement",
			"validate",
			"commit",
		]);
		for (const stage of Object.values(wf.stages)) {
			expect(stage.kind).toBe("side-effect");
			expect(stage.skill).toBeTruthy();
		}
	});

	it("los edges son lineales y terminan en stop", () => {
		expect(wf.edges.discover).toBe("research");
		expect(wf.edges.research).toBe("design");
		expect(wf.edges.design).toBe("plan");
		expect(wf.edges.plan).toBe("implement");
		expect(wf.edges.implement).toBe("validate");
		expect(wf.edges.validate).toBe("commit");
		expect(wf.edges.commit).toBe("stop");
	});
});

describe("frida-pipeline / workflows / vet", () => {
	const wf = vetWorkflow;

	it("tiene 2 stages: code-review → validate", () => {
		expect(wf.name).toBe("vet");
		expect(wf.start).toBe("code-review");
		expect(Object.keys(wf.stages)).toEqual(["code-review", "validate"]);
		expect(wf.edges["code-review"]).toBe("validate");
		expect(wf.edges.validate).toBe("stop");
	});
});

describe("frida-pipeline / workflows / polish", () => {
	const wf = polishWorkflow;

	it("tiene 4 stages: architecture-review → plan → implement → validate", () => {
		expect(wf.name).toBe("polish");
		expect(wf.start).toBe("architecture-review");
		expect(Object.keys(wf.stages)).toEqual([
			"architecture-review",
			"plan",
			"implement",
			"validate",
		]);
		expect(wf.edges["architecture-review"]).toBe("plan");
		expect(wf.edges.plan).toBe("implement");
		expect(wf.edges.implement).toBe("validate");
		expect(wf.edges.validate).toBe("stop");
	});
});

describe("frida-pipeline / workflows / validación estructural", () => {
	it("todas las stages despachan skills que existen en el set de 27", () => {
		const allSkills = new Set([
			"discover",
			"research",
			"code-review",
			"design",
			"design-slice",
			"design-review",
			"synthesize",
			"plan",
			"blueprint",
			"elaborate",
			"revise",
			"implement",
			"validate",
			"slice",
			"explore",
			"grade",
			"amend",
			"commit",
			"pr-triage",
			"create-handoff",
			"resume-handoff",
			"annotate-guidance",
			"annotate-inline",
			"migrate-to-guidance",
			"changelog",
			"architecture-review",
			"frontend-design",
		]);

		for (const wf of PIPELINE_WORKFLOWS) {
			for (const [stageName, stage] of Object.entries(wf.stages)) {
				const skill = stage.skill ?? stageName;
				expect(
					allSkills.has(skill),
					`workflow "${wf.name}" stage "${stageName}" despacha skill desconocido "${skill}"`,
				).toBe(true);
			}
		}
	});

	it("todos los edges apuntan a stages existentes o 'stop'", () => {
		for (const wf of PIPELINE_WORKFLOWS) {
			const stageNames = new Set([...Object.keys(wf.stages), "stop"]);
			for (const [from, to] of Object.entries(wf.edges)) {
				expect(
					typeof to === "string" && stageNames.has(to),
					`workflow "${wf.name}" edge "${from}" → "${to}" apunta a stage inexistente`,
				).toBe(true);
			}
		}
	});

	it("todas las skills despachadas tienen kind: side-effect", () => {
		for (const wf of PIPELINE_WORKFLOWS) {
			for (const [name, stage] of Object.entries(wf.stages)) {
				expect(
					stage.kind,
					`workflow "${wf.name}" stage "${name}" debe ser side-effect`,
				).toBe("side-effect");
			}
		}
	});
});

describe("frida-pipeline / workflows / registro en frida-workflow", () => {
	it("registerWorkflows añade los 3 al registry", () => {
		registerWorkflows(PIPELINE_WORKFLOWS);
		const registered = listWorkflows();
		expect(registered).toHaveLength(3);
		expect(registered.map((w) => w.name)).toContain("build");
		expect(registered.map((w) => w.name)).toContain("vet");
		expect(registered.map((w) => w.name)).toContain("polish");
	});

	it("listWorkflows devuelve los workflows por nombre", () => {
		registerWorkflows(PIPELINE_WORKFLOWS);
		const build = listWorkflows().find((w) => w.name === "build");
		expect(build).toBeDefined();
		expect(build!.start).toBe("discover");
	});
});
