// frida-pipeline — workflows built-in: build, vet, polish.
//
// Porte de los 3 workflows pre-construidos de rpiv-pi (ADR-0021 Fase 10 / D4).
// Cada uno es un objeto Workflow del DSL de frida-workflow, con stages que
// despachan skills y edges lineales. Se registran via registerWorkflows() al
// inicializar frida-pipeline.
//
// build  — pipeline completo: discover → research → design → plan → implement → validate → commit
// vet    — revisión enfocada: code-review → validate
// polish — pulido estructural: architecture-review → plan → implement → validate
//
// Todos los stages son kind:"side-effect" (no requieren collector de artefactos
// para el flujo lineal). Las skills escriben sus artefactos a .frida/artifacts/
// por su cuenta; el workflow sólo orquesta el orden y pasa el handle primario.

import type { Workflow } from "../../frida-workflow/types";

// ---------------------------------------------------------------------------
// build — pipeline completo de discover a commit
// ---------------------------------------------------------------------------

export const buildWorkflow: Workflow = {
	name: "build",
	description:
		"Pipeline completo: descubre intención, investiga, diseña, planifica, implementa, valida y commitea.",
	start: "discover",
	stages: {
		discover: {
			kind: "side-effect",
			skill: "discover",
		},
		research: {
			kind: "side-effect",
			skill: "research",
		},
		design: {
			kind: "side-effect",
			skill: "design",
		},
		plan: {
			kind: "side-effect",
			skill: "plan",
		},
		implement: {
			kind: "side-effect",
			skill: "implement",
		},
		validate: {
			kind: "side-effect",
			skill: "validate",
		},
		commit: {
			kind: "side-effect",
			skill: "commit",
		},
	},
	edges: {
		discover: "research",
		research: "design",
		design: "plan",
		plan: "implement",
		implement: "validate",
		validate: "commit",
		commit: "stop",
	},
};

// ---------------------------------------------------------------------------
// vet — revisión enfocada
// ---------------------------------------------------------------------------

export const vetWorkflow: Workflow = {
	name: "vet",
	description:
		"Revisión enfocada: code-review contra estándares, luego validate.",
	start: "code-review",
	stages: {
		"code-review": {
			kind: "side-effect",
			skill: "code-review",
		},
		validate: {
			kind: "side-effect",
			skill: "validate",
		},
	},
	edges: {
		"code-review": "validate",
		validate: "stop",
	},
};

// ---------------------------------------------------------------------------
// polish — pulido estructural
// ---------------------------------------------------------------------------

export const polishWorkflow: Workflow = {
	name: "polish",
	description:
		"Pulido estructural: architecture-review, plan de mejoras, implement, validate.",
	start: "architecture-review",
	stages: {
		"architecture-review": {
			kind: "side-effect",
			skill: "architecture-review",
		},
		plan: {
			kind: "side-effect",
			skill: "plan",
		},
		implement: {
			kind: "side-effect",
			skill: "implement",
		},
		validate: {
			kind: "side-effect",
			skill: "validate",
		},
	},
	edges: {
		"architecture-review": "plan",
		plan: "implement",
		implement: "validate",
		validate: "stop",
	},
};

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/** Los 3 workflows built-in de frida-pipeline. */
export const PIPELINE_WORKFLOWS: Workflow[] = [
	buildWorkflow,
	vetWorkflow,
	polishWorkflow,
];
