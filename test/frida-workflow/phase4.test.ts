// Tests Fase 4 — loadWorkflows: capas/merge, envelope vs pack, skillAliases,
// default cascade, e integración jiti (config .ts que importa el DSL del bundle).

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	loadWorkflows,
	registerWorkflow,
	_resetRegistry,
	type Workflow,
} from "../../src/tools/frida-workflow";

/** Crea un agentDir + cwd temporales; helper para escribir config.ts/packs. */
function setup(): {
	agentDir: string;
	cwd: string;
	write: (rel: string, content: string) => string;
} {
	const agentDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "frida-wf-load-agent-"),
	);
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-load-cwd-"));
	const write = (rel: string, content: string) => {
		const abs = path.join(cwd, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content);
		return abs;
	};
	return { agentDir, cwd, write };
}

const DSL_BUNDLE = path.resolve(process.cwd(), "dist", "frida-workflow.js");
const bundleExists = fs.existsSync(DSL_BUNDLE);

beforeEach(() => _resetRegistry());

describe("loadWorkflows — capas y merge", () => {
	it("built-ins + config plain-data del proyecto", () => {
		registerWorkflow({
			name: "a",
			start: "x",
			stages: { x: { kind: "side-effect" } },
			edges: { x: "stop" },
		});
		const { agentDir, cwd, write } = setup();
		write(
			".frida/workflows/config.ts",
			`export default { name: "b", start: "x", stages: { x: { kind: "side-effect" } }, edges: { x: "stop" } };`,
		);

		const loaded = loadWorkflows({ cwd, agentDir, builtIns: [] });
		// builtIns se pasan por parámetro aquí; 'a' no se pasó → sólo 'b'.
		expect([...loaded.workflows.keys()]).toEqual(["b"]);
		expect(loaded.issues.filter((i) => i.severity === "error")).toHaveLength(0);
	});

	it("project config pisa user config por nombre", () => {
		const { agentDir, cwd, write } = setup();
		// user config
		fs.mkdirSync(path.join(agentDir, "workflows"), { recursive: true });
		fs.writeFileSync(
			path.join(agentDir, "workflows", "config.ts"),
			`export default { name: "w", start: "u", stages: { u: { kind: "side-effect" } }, edges: { u: "stop" } };`,
		);
		// project config (mismo nombre, distinto start)
		write(
			".frida/workflows/config.ts",
			`export default { name: "w", start: "p", stages: { p: { kind: "side-effect" } }, edges: { p: "stop" } };`,
		);

		const loaded = loadWorkflows({ cwd, agentDir });
		const w = loaded.workflows.get("w")!;
		expect(w.start).toBe("p"); // project gana
	});

	it("packs se cargan (Workflow[])", () => {
		const { agentDir, cwd, write } = setup();
		write(
			".frida/workflows/packs/extra.ts",
			`export default { name: "extra", start: "x", stages: { x: { kind: "side-effect" } }, edges: { x: "stop" } };`,
		);
		const loaded = loadWorkflows({ cwd, agentDir });
		expect(loaded.workflows.has("extra")).toBe(true);
	});
});

describe("loadWorkflows — envelope y packs", () => {
	it("envelope con default + skillAliases (sólo config)", () => {
		const { agentDir, cwd, write } = setup();
		write(
			".frida/workflows/config.ts",
			`export default {
			workflows: [{ name: "ship", start: "c", stages: { c: { kind: "side-effect" } }, edges: { c: "stop" } }],
			default: "ship",
			skillAliases: { commit: "attributed-commit" },
		};`,
		);
		const loaded = loadWorkflows({ cwd, agentDir });
		expect(loaded.default).toBe("ship");
		expect(loaded.workflows.get("ship")).toBeTruthy();
	});

	it("pack con envelope → error (no permitido)", () => {
		const { agentDir, cwd, write } = setup();
		write(
			".frida/workflows/packs/bad.ts",
			`export default { workflows: [], default: "x" };`,
		);
		const loaded = loadWorkflows({ cwd, agentDir });
		expect(
			loaded.issues.some(
				(i) => i.severity === "error" && /pack.*envelope/.test(i.message),
			),
		).toBe(true);
	});

	it("default cascade: project config > user config", () => {
		const { agentDir, cwd, write } = setup();
		fs.mkdirSync(path.join(agentDir, "workflows"), { recursive: true });
		fs.writeFileSync(
			path.join(agentDir, "workflows", "config.ts"),
			`export default { workflows: [{ name: "u", start: "x", stages: { x: { kind: "side-effect" } }, edges: { x: "stop" } }], default: "u" };`,
		);
		write(
			".frida/workflows/config.ts",
			`export default { workflows: [{ name: "p", start: "x", stages: { x: { kind: "side-effect" } }, edges: { x: "stop" } }], default: "p" };`,
		);
		const loaded = loadWorkflows({ cwd, agentDir });
		expect(loaded.default).toBe("p"); // project gana
	});

	it("sin default explícito → primer workflow registrado", () => {
		const { agentDir, cwd } = setup();
		const loaded = loadWorkflows({
			cwd,
			agentDir,
			builtIns: [
				{
					name: "z",
					start: "x",
					stages: { x: { kind: "side-effect" } },
					edges: { x: "stop" },
				},
			],
		});
		expect(loaded.default).toBe("z");
	});
});

describe("loadWorkflows — skillAliases", () => {
	it("remap one-hop sin mutar el built-in fuente", () => {
		const builtIn: Workflow = {
			name: "ship",
			start: "commit",
			stages: { commit: { kind: "side-effect" } },
			edges: { commit: "stop" },
		};
		registerWorkflow(builtIn);
		const { agentDir, cwd, write } = setup();
		write(
			".frida/workflows/config.ts",
			`export default { skillAliases: { commit: "attributed-commit" } };`,
		);

		const loaded = loadWorkflows({ cwd, agentDir, builtIns: [builtIn] });
		const stage = loaded.workflows.get("ship")!.stages.commit!;
		expect(stage.skill).toBe("attributed-commit"); // remapeado
		expect(builtIn.stages.commit!.skill).toBeUndefined(); // la fuente NO se mutó
	});

	it("alias que no matchea ningún skill → warning", () => {
		const { agentDir, cwd, write } = setup();
		write(
			".frida/workflows/config.ts",
			`export default { workflows: [{ name: "w", start: "x", stages: { x: { kind: "side-effect" } }, edges: { x: "stop" } }], skillAliases: { ghost: "nope" } };`,
		);
		const loaded = loadWorkflows({ cwd, agentDir });
		expect(
			loaded.issues.some(
				(i) => i.severity === "warning" && /ghost/.test(i.message),
			),
		).toBe(true);
	});
});

describe("loadWorkflows — jiti + DSL bundle (integración)", () => {
	it.skipIf(!bundleExists)(
		"config .ts importa el DSL del bundle → Workflow con collectors reales",
		() => {
			const { agentDir, cwd, write } = setup();
			write(
				".frida/workflows/config.ts",
				`
import { defineWorkflow, produces, acts, transcriptPathCollector, jsonBodyParser, typeboxSchema, gate, eq, Type } from "frida-workflow";
export default defineWorkflow({
	name: "ship",
	start: "review",
	stages: {
		review: produces({ outcome: { collector: transcriptPathCollector({ pattern: /\\.md$/ }), parser: jsonBodyParser }, outputSchema: typeboxSchema(Type.Object({ blockers: Type.Integer() })) }),
		commit: acts(),
	},
	edges: { review: gate("blockers", { commit: eq(0) }, "commit"), commit: "stop" },
});
`,
			);
			const loaded = loadWorkflows({
				cwd,
				agentDir,
				dslBundlePath: DSL_BUNDLE,
			});
			expect(loaded.issues.filter((i) => i.severity === "error")).toHaveLength(
				0,
			);
			const wf = loaded.workflows.get("ship")!;
			expect(wf).toBeTruthy();
			expect(typeof wf.stages.review.outcome!.collector).toBe("function");
			expect(typeof wf.edges.review).toBe("function");
			expect(
				(wf.edges.review as unknown as { targets: readonly string[] }).targets,
			).toEqual(["commit", "commit"]);
		},
	);

	it("config con error de sintaxis → issue de error, no crashea", () => {
		const { agentDir, cwd, write } = setup();
		write(
			".frida/workflows/config.ts",
			`export default { name: "broken" ;;;; });`,
		);
		const loaded = loadWorkflows({ cwd, agentDir });
		expect(loaded.issues.some((i) => i.severity === "error")).toBe(true);
		expect(loaded.workflows.size).toBe(0);
	});
});
