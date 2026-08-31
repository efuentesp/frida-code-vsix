import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	dslAliasTarget,
	loadWorkflows,
} from "../../src/tools/frida-workflow/load";

/** Bundle SDK real — reproduce el path del bug #189: la jiti embebida del
 *  bundle es la que tropieza con `node:` imports al re-evaluar el bundle.
 *  Se carga con require NATIVO: `await import()` en vitest pasa por vite-node
 *  y descarabela la jiti embebida (falsea el repro). */
const DIST = resolve(__dirname, "../../dist/frida-workflow.js");
const distReady = existsSync(DIST);
const req = createRequire(import.meta.url);
function loadDist(): typeof import("../../src/tools/frida-workflow/load") {
	return req(DIST) as typeof import("../../src/tools/frida-workflow/load");
}

const dirs: string[] = [];
afterAll(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function newDir(): string {
	const d = mkdtempSync(join(tmpdir(), "frida-load-"));
	dirs.push(d);
	return d;
}

/** agentDir con workflows/config.ts del contenido dado (capa user). */
function agentWithConfig(content: string): string {
	const agent = newDir();
	mkdirSync(join(agent, "workflows"), { recursive: true });
	writeFileSync(join(agent, "workflows", "config.ts"), content, "utf8");
	return agent;
}

/** cwd con .frida/workflows/config.ts del contenido dado (capa project). */
function projectWithConfig(content: string): string {
	const proj = newDir();
	mkdirSync(join(proj, ".frida", "workflows"), { recursive: true });
	writeFileSync(join(proj, ".frida", "workflows", "config.ts"), content, "utf8");
	return proj;
}

/** El mismo config que usa SELE-DEV: helpers con node:fs + DSL completa. */
const CONFIG_CON_DSL = `import { readdirSync } from "node:fs";
import { defineWorkflow, acts } from "frida-workflow";
const _probe = readdirSync ? 1 : 0;
export const workflows = [
	defineWorkflow({
		name: "probe-wf",
		start: "a",
		stages: { a: acts({ skill: "implement" }) },
		edges: { a: "stop" },
	}),
];
export default "probe-wf";
`;

describe("loadWorkflows — cascada por capas", () => {
	// skip si no hay build (los tests del dist requieren npm run build previo)
	(distReady ? it : it.skip)(
		"carga user config que importa node:fs y la DSL (#189)",
		() => {
			const wf = loadDist();
			const agent = agentWithConfig(CONFIG_CON_DSL);
			const loaded = wf.loadWorkflows({
				cwd: newDir(),
				agentDir: agent,
				dslBundlePath: DIST,
			});
			expect(loaded.issues).toEqual([]);
			expect(loaded.workflows.get("probe-wf")).toBeDefined();
			expect(loaded.origins.get("probe-wf")).toBe("user");
			expect(loaded.default).toBe("probe-wf");
		},
	);

	(distReady ? it : it.skip)(
		"project config gana por nombre sobre user config",
		() => {
			const wf = loadDist();
			const agent = agentWithConfig(`export const workflows = [
	{ name: "dup", start: "a", stages: { a: {} }, edges: { a: "stop" } },
];`);
			const proj = projectWithConfig(`export const workflows = [
	{ name: "dup", start: "b", stages: { b: {} }, edges: { b: "stop" } },
];`);
			const loaded = wf.loadWorkflows({
				cwd: proj,
				agentDir: agent,
				dslBundlePath: DIST,
			});
			expect(loaded.issues).toEqual([]);
			expect(loaded.origins.get("dup")).toBe("project");
			expect(loaded.workflows.get("dup")?.start).toBe("b");
		},
	);

	(distReady ? it : it.skip)(
		"cablea el alias typebox prometido (#151)",
		() => {
			const wf = loadDist();
			const agent = agentWithConfig(`import { Type } from "typebox";
import { Value } from "typebox/value";
import { defineWorkflow, acts, typeboxSchema } from "frida-workflow";
const _v = Value ? 1 : 0;
export const workflows = [
	defineWorkflow({
		name: "tb-wf",
		start: "a",
		stages: {
			a: acts({
				skill: "implement",
				outputSchema: typeboxSchema(Type.Object({ ok: Type.Boolean() })),
			}),
		},
		edges: { a: "stop" },
	}),
];
`);
			const loaded = wf.loadWorkflows({
			cwd: newDir(),
			agentDir: agent,
			dslBundlePath: DIST,
			});
			expect(loaded.issues).toEqual([]);
			expect(loaded.workflows.get("tb-wf")).toBeDefined();
			expect(loaded.origins.get("tb-wf")).toBe("user");
		},
	);

	it("sin dslBundlePath, los configs plain-data siguen cargando", () => {
		const agent = agentWithConfig(`export const workflows = [
	{ name: "plain", start: "a", stages: { a: {} }, edges: { a: "stop" } },
];`);
		const loaded = loadWorkflows({ cwd: newDir(), agentDir: agent });
		expect(loaded.workflows.get("plain")).toBeTruthy();
		expect(loaded.origins.get("plain")).toBe("user");
	});
});

describe("dslAliasTarget — wrapper CJS (#189)", () => {
	it("es idempotente y no reescribe contenido estable", () => {
		const a = dslAliasTarget(DIST);
		const b = dslAliasTarget(DIST);
		expect(a).toBe(b);
		expect(a.endsWith(".cjs")).toBe(true);
		expect(a).not.toBe(DIST);
		const content = readFileSync(a, "utf8");
		expect(content).toContain("module.exports = require(");
		dslAliasTarget(DIST);
		expect(readFileSync(a, "utf8")).toBe(content);
	});

	it("versiona por bundle: paths distintos → wrappers distintos", () => {
		const a = dslAliasTarget(DIST);
		const c = dslAliasTarget(join(tmpdir(), "otro-bundle-ficticio.js"));
		expect(c).not.toBe(a);
	});
});
