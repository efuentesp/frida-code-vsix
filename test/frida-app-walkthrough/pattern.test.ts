// frida-app-walkthrough — tests del patrón app-walkthrough: validación eager
// de args (D4), forma del script generado (fases/pin/veto/writers) y registro
// en runtime sobre el motor. Issue #133, M8 Pista M. Molde:
// test/frida-tea/pattern.test.ts + test/frida-aidd/pattern.test.ts:99-131
// (registro verificado con toContain, nunca conteo global del catálogo).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	APP_WALKTHROUGH_PATTERN,
	createFridaAppWalkthrough,
} from "../../src/tools/frida-app-walkthrough";
import {
	builtinPatternsCatalog,
	clearRegisteredBuiltinPatterns,
	findBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";

const REAL_HOME = process.env.HOME;
const cwd = process.cwd();

let home: string;

beforeEach(() => {
	// HOME aislado: resolve() lee overrides de usuario
	// (~/.frida/app-walkthrough/stages.json) en launch-time; sin esto un
	// stages.json del entorno de dev rompería los asserts de defaults.
	home = mkdtempSync(join(tmpdir(), "walkthrough-pat-home-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	clearRegisteredBuiltinPatterns();
});

const VALID = { url: "https://app.ejemplo.com", maxScreens: 5 };

describe("frida-app-walkthrough · validación eager de args (#133)", () => {
	it("requiere url no vacía", () => {
		expect(() => APP_WALKTHROUGH_PATTERN.resolve({}, { cwd })).toThrow(/url/);
		expect(() => APP_WALKTHROUGH_PATTERN.resolve({ url: "  " }, { cwd })).toThrow(
			/url/,
		);
		expect(() => APP_WALKTHROUGH_PATTERN.resolve(null, { cwd })).toThrow(/url/);
	});

	it("maxScreens faltante instruye preguntar pre-launch (D4)", () => {
		let err: Error | undefined;
		try {
			APP_WALKTHROUGH_PATTERN.resolve({ url: "https://a.b" }, { cwd });
		} catch (e) {
			err = e as Error;
		}
		expect(err).toBeInstanceOf(Error);
		expect(err?.message).toMatch(/maxScreens/);
		// El error es accionable: instruye la pregunta en la sesión principal.
		expect(err?.message).toContain("ask_user_question");
	});

	it("maxScreens fuera de rango o no entero se rechaza", () => {
		for (const bad of [-1, 201, 2.5, "30"]) {
			expect(() =>
				APP_WALKTHROUGH_PATTERN.resolve(
					{ url: "https://a.b", maxScreens: bad },
					{ cwd },
				),
			).toThrow(/maxScreens/);
		}
	});

	it("maxMinutes fuera de rango se rechaza (0-240, entero)", () => {
		for (const bad of [0, 241, 1.5]) {
			expect(() =>
				APP_WALKTHROUGH_PATTERN.resolve({ ...VALID, maxMinutes: bad }, { cwd }),
			).toThrow(/maxMinutes/);
		}
	});

	it("review inválido se rechaza", () => {
		expect(() =>
			APP_WALKTHROUGH_PATTERN.resolve({ ...VALID, review: "sometimes" }, { cwd }),
		).toThrow(/review/);
	});
});

describe("frida-app-walkthrough · forma del script generado (#133)", () => {
	it("el patrón está nombrado y documentado (catálogo)", () => {
		expect(APP_WALKTHROUGH_PATTERN.name).toBe("app-walkthrough");
		expect(APP_WALKTHROUGH_PATTERN.args.length).toBeGreaterThan(10);
		expect(APP_WALKTHROUGH_PATTERN.description.length).toBeGreaterThan(40);
	});

	it("las 5 fases en orden: bootstrap → explore → analyze → synthesize → judge", () => {
		const script = APP_WALKTHROUGH_PATTERN.resolve(VALID, { cwd });
		const idx = [
			script.indexOf('phase("bootstrap")'),
			script.indexOf('phase("explore")'),
			script.indexOf('phase("analyze")'),
			script.indexOf('phase("synthesize")'),
			script.indexOf('phase("judge")'),
		];
		for (const i of idx) expect(i).toBeGreaterThan(-1);
		for (let i = 1; i < idx.length; i++) {
			expect(idx[i]).toBeGreaterThan(idx[i - 1]);
		}
	});

	it("el pin de sesión y el veto viajan en el script (D3/D8/D12)", () => {
		const script = APP_WALKTHROUGH_PATTERN.resolve(VALID, { cwd });
		expect(script).toContain("agent-browser --session");
		expect(script).toContain("VETADO"); // preamble no-stage interpolado
		expect(script).toContain('|| "app-walkthrough"'); // default de session
	});

	it("el fan-out de analyze cubre los 4 documentos y el checkpoint final", () => {
		const script = APP_WALKTHROUGH_PATTERN.resolve(VALID, { cwd });
		for (const doc of [
			"catalogo-pantallas.md",
			"journeys.md",
			"reglas-negocio.md",
			"roles-permisos.md",
		]) {
			expect(script).toContain(doc);
		}
		expect(script).toContain('parallel("writers"');
		expect(script).toContain('checkpoint({ name: "walkthrough-final"');
	});

	it("defaults defensivos del motor (args validados como fallback)", () => {
		const script = APP_WALKTHROUGH_PATTERN.resolve(VALID, { cwd });
		expect(script).toContain("(args && args.url)");
		expect(script).toContain('(args && typeof args.maxScreens === "number")');
		expect(script).toContain("https://app.ejemplo.com");
	});

	it("la meta declara shell y postura autónoma (R9)", () => {
		expect(APP_WALKTHROUGH_PATTERN.meta?.requiredTools).toContain("shell");
		expect(APP_WALKTHROUGH_PATTERN.meta?.executionHints?.autonomous).toBe(true);
	});
});

describe("frida-app-walkthrough · registro en runtime sobre el motor (#133)", () => {
	// #140: el setup ahora también registra el comando /walkthrough — el
	// stub vacío (`as never`) ya no sirve (registerCommand incondicional).
	// Los tests del comando viven en command.test.ts.
	/** Stub mínimo de ExtensionAPI: solo registerCommand (no-op). */
	const setupPi = (): unknown => ({ registerCommand: () => {} });

	it("la factory registra el patrón (smoke de registro)", () => {
		expect(findBuiltinPattern("app-walkthrough")).toBeUndefined();
		createFridaAppWalkthrough()(setupPi() as never);
		const found = findBuiltinPattern("app-walkthrough");
		expect(found?.name).toBe("app-walkthrough");
		expect(found?.description).toContain("docs/funcional/");
	});

	it("el catálogo lista el patrón junto a los builtin (toContain, no conteo)", () => {
		createFridaAppWalkthrough()(setupPi() as never);
		const names = builtinPatternsCatalog().map((p) => p.name);
		expect(names).toContain("app-walkthrough");
		expect(names).toContain("code-review"); // los 4 de #19 siguen
	});

	it("la factory es idempotente por nombre (no duplica)", () => {
		const factory = createFridaAppWalkthrough();
		factory(setupPi() as never);
		factory(setupPi() as never);
		expect(
			builtinPatternsCatalog().filter((p) => p.name === "app-walkthrough"),
		).toHaveLength(1);
	});
});
