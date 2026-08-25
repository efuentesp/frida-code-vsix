// frida-extensible-workflows — tests del módulo de factories del moat (M1
// #134, design D1). Estrategia (D12, lección #91): la composición se aserta
// por NOMBRE para TODAS las factories (base 4 + moat según flags) — y como
// verde en suite ≠ correcto, se verifica el REGISTRO REAL corriendo las
// factories del moat contra un pi falso que captura registerTool: lens via
// entry .js real cargado con import() diferido; codebase-index en modo guía
// sin pin (isError detectable) y al pin con un entry upstream fake.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createFridaLensFactory,
	createMoatFactories,
	createWorkflowChildFactoriesWithMoat,
} from "../../src/tools/frida-extensible-workflows/moat-factories";
import {
	CODEBASE_INDEX_PACKAGE,
	CODEBASE_INDEX_PIN,
	upstreamEntryPath,
} from "../../src/tools/frida-codebase-index/constants";

/** agentDir desechable por test (fixtures de instalación aislando el entorno
 *  de dev — mismas rutas que sondean las factories). */
let agentDir: string;
let tmp: string;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "moat-factories-"));
	agentDir = path.join(tmp, ".frida");
});
afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

/** Pi falso que captura registerTool (registro real, lección #91). */
function fakePi() {
	const tools = new Map<string, any>();
	return {
		tools,
		registerTool: (t: any) => {
			tools.set(t.name, t);
			return t;
		},
		registerCommand: () => {},
		on: () => () => {},
	};
}

/** Fixture: entry de pi-lens presente (CJS .js — la factory diferida lo
 *  carga con import() real vía pathToFileURL). */
function fixtureLensEntry(): void {
	const entry = path.join(
		agentDir,
		"npm",
		"node_modules",
		"pi-lens",
		"dist",
		"index.js",
	);
	fs.mkdirSync(path.dirname(entry), { recursive: true });
	fs.writeFileSync(
		entry,
		"module.exports = function (pi) {\n" +
			'  pi.registerTool({ name: "lens_probe", async execute() { return { content: [{ type: "text", text: "ok" }] }; } });\n' +
			"};\n",
	);
}

/** Fixture: open-codebase-index instalado AL PIN (package.json con la
 *  versión + entry que registra las 6 tools upstream + call_graph_path —
 *  shape de la extensión Pi real del paquete). */
function fixtureCodebaseIndexAtPin(): void {
	const pkgDir = path.join(
		agentDir,
		"npm",
		"node_modules",
		CODEBASE_INDEX_PACKAGE,
	);
	fs.mkdirSync(pkgDir, { recursive: true });
	fs.writeFileSync(
		path.join(pkgDir, "package.json"),
		JSON.stringify({ name: CODEBASE_INDEX_PACKAGE, version: CODEBASE_INDEX_PIN }),
	);
	const entry = upstreamEntryPath(agentDir);
	fs.mkdirSync(path.dirname(entry), { recursive: true });
	fs.writeFileSync(
		entry,
		'const NAMES = ["codebase_context", "codebase_search", "call_graph", "call_graph_path", "implementation_lookup", "index_codebase", "index_status"];\n' +
			"module.exports = function (pi) {\n" +
			"  for (const name of NAMES) {\n" +
			"    pi.registerTool({\n" +
			"      name,\n" +
			'      async execute(_id, params) { return { content: [{ type: "text", text: name + ":" + JSON.stringify(params ?? {}) }] }; },\n' +
			"    });\n" +
			"  }\n" +
			"};\n",
	);
}

const SIX_FRIDA_TOOLS = [
	"call_graph",
	"implementation_lookup",
	"index_codebase",
	"index_status",
	"semantic_context",
	"semantic_search",
];

const BASE_NAMES = [
	"softtek-provider",
	"z-ai-provider",
	"frida-enterprise-provider",
	"frida-provider-audit",
];

describe("frida-extensible-workflows · createFridaLensFactory (D2)", () => {
	it("sin instalación → undefined (entry omitida; lens NO tiene modo guía)", () => {
		expect(createFridaLensFactory(agentDir)).toBeUndefined();
	});

	it("entry presente → registro real diferido contra el pi falso", async () => {
		fixtureLensEntry();
		const entry = createFridaLensFactory(agentDir);
		expect(entry?.name).toBe("frida-lens");
		const pi = fakePi();
		await entry!.factory(pi);
		expect([...pi.tools.keys()]).toEqual(["lens_probe"]);
	});

	it("import() que falla → warn sin tumbar (semántica del bloque original)", async () => {
		const entryFile = path.join(
			agentDir,
			"npm",
			"node_modules",
			"pi-lens",
			"dist",
			"index.js",
		);
		fs.mkdirSync(path.dirname(entryFile), { recursive: true });
		fs.writeFileSync(entryFile, "esto no es JS válido {{{");
		const entry = createFridaLensFactory(agentDir);
		expect(entry?.name).toBe("frida-lens");
		await expect(entry!.factory(fakePi())).resolves.toBeUndefined();
	});
});

describe("frida-extensible-workflows · createMoatFactories (D3/D5)", () => {
	it("sin flags → lista vacía (inerte para patrones hermanos)", () => {
		expect(createMoatFactories({ agentDir, moat: {} })).toEqual([]);
	});

	it("lens=true sin instalación → se omite (presencia ≠ registro)", () => {
		expect(createMoatFactories({ agentDir, moat: { lens: true } })).toEqual([]);
	});

	it("lens=true instalado → entry frida-lens", () => {
		fixtureLensEntry();
		expect(
			createMoatFactories({ agentDir, moat: { lens: true } }).map((e) => e.name),
		).toEqual(["frida-lens"]);
	});

	it("codebaseIndex=true → entry siempre (modo guía si falta el pin)", () => {
		expect(
			createMoatFactories({
				agentDir,
				moat: { codebaseIndex: true },
			}).map((e) => e.name),
		).toEqual(["frida-codebase-index"]);
	});

	it("codebaseIndexEnabled apagado vence al flag (D5)", () => {
		expect(
			createMoatFactories({
				agentDir,
				moat: { codebaseIndex: true },
				codebaseIndexEnabled: () => false,
			}),
		).toEqual([]);
	});

	it("ambas flags → lens antes que codebase-index (orden estable)", () => {
		fixtureLensEntry();
		expect(
			createMoatFactories({
				agentDir,
				moat: { lens: true, codebaseIndex: true },
			}).map((e) => e.name),
		).toEqual(["frida-lens", "frida-codebase-index"]);
	});
});

describe("frida-extensible-workflows · createWorkflowChildFactoriesWithMoat (D1)", () => {
	it("sin moat → exactamente la base 4 (no-leakage; TODAS por nombre)", () => {
		expect(
			createWorkflowChildFactoriesWithMoat({ cwd: tmp, agentDir }).map(
				(e) => e.name,
			),
		).toEqual(BASE_NAMES);
	});

	it("moat vacío → base 4 intacta", () => {
		expect(
			createWorkflowChildFactoriesWithMoat({ cwd: tmp, agentDir, moat: {} }).map(
				(e) => e.name,
			),
		).toEqual(BASE_NAMES);
	});

	it("moat completo + instalaciones → base 4 + lens + codebase-index", () => {
		fixtureLensEntry();
		fixtureCodebaseIndexAtPin();
		expect(
			createWorkflowChildFactoriesWithMoat({
				cwd: tmp,
				agentDir,
				moat: { lens: true, codebaseIndex: true },
			}).map((e) => e.name),
		).toEqual([...BASE_NAMES, "frida-lens", "frida-codebase-index"]);
	});

	it("lens ausente en disco → base 4 + codebase-index (lens se omite sin guía)", () => {
		expect(
			createWorkflowChildFactoriesWithMoat({
				cwd: tmp,
				agentDir,
				moat: { lens: true, codebaseIndex: true },
			}).map((e) => e.name),
		).toEqual([...BASE_NAMES, "frida-codebase-index"]);
	});

	it("codebaseIndexEnabled apagado → base 4 + lens como máximo", () => {
		fixtureLensEntry();
		expect(
			createWorkflowChildFactoriesWithMoat({
				cwd: tmp,
				agentDir,
				moat: { lens: true, codebaseIndex: true },
				codebaseIndexEnabled: () => false,
			}).map((e) => e.name),
		).toEqual([...BASE_NAMES, "frida-lens"]);
	});

	it("providerAudit inyectable no altera la composición (fluye a la base)", () => {
		expect(
			createWorkflowChildFactoriesWithMoat({
				cwd: tmp,
				agentDir,
				providerAudit: { append: () => {}, tag: () => "custom" },
			}).map((e) => e.name),
		).toEqual(BASE_NAMES);
	});
});

describe("frida-extensible-workflows · registro real del moat (pi falso, #91)", () => {
	it("codebase-index SIN pin: 6 tools en modo guía (isError detectable)", async () => {
		const [entry] = createMoatFactories({
			agentDir,
			moat: { codebaseIndex: true },
		});
		const pi = fakePi();
		await entry.factory(pi); // factory async: el loader la awaita
		expect([...pi.tools.keys()].sort()).toEqual(SIX_FRIDA_TOOLS);
		const res = await pi.tools
			.get("index_status")!
			.execute("id-1", {}, undefined, undefined, {});
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("no está instalado");
		expect(res.details.failureCategory).toBe("codebase-index-guide");
	});

	it("codebase-index AL PIN: passthrough de las 6 tools (sin isError)", async () => {
		fixtureCodebaseIndexAtPin();
		const [entry] = createMoatFactories({
			agentDir,
			moat: { codebaseIndex: true },
		});
		const pi = fakePi();
		await entry.factory(pi);
		expect([...pi.tools.keys()].sort()).toEqual(SIX_FRIDA_TOOLS);
		const res = await pi.tools
			.get("semantic_search")!
			.execute("id-2", { query: "auth" }, undefined, undefined, {});
		expect(res.isError).toBeUndefined();
		expect(res.content[0].text).toBe('codebase_search:{"query":"auth"}');
	});
});
