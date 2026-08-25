// frida-understand-app — tests del patrón understand-app: validación eager
// de args (D13), sonda de capacidades host-side (D5/D6), forma del script
// generado (6 fases/veto/cortes/moat) y registro en runtime sobre el motor.
// Issue #134, M1 Pista M. Molde: test/frida-app-walkthrough/pattern.test.ts
// (#133) + test/frida-aidd/pattern.test.ts:99-131 (registro verificado con
// toContain, nunca conteo global del catálogo).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	UNDERSTAND_APP_PATTERN,
	createFridaUnderstandApp,
	detectUnderstandAppCapabilities,
} from "../../src/tools/frida-understand-app";
import {
	builtinPatternsCatalog,
	clearRegisteredBuiltinPatterns,
	findBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import {
	CODEBASE_INDEX_PACKAGE,
	CODEBASE_INDEX_PIN,
	upstreamEntryPath,
} from "../../src/tools/frida-codebase-index/constants";

const REAL_HOME = process.env.HOME;
const cwd = process.cwd();

let home: string;

beforeEach(() => {
	// HOME aislado: resolve() lee overrides de usuario
	// (~/.frida/understand-app/stages.json) Y sonda capacidades del moat en
	// ~/.frida/npm (D6) — sin esto, las instalaciones del entorno de dev
	// harían no-deterministas los asserts de CAPABILITIES.
	home = mkdtempSync(join(tmpdir(), "understand-pat-home-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	clearRegisteredBuiltinPatterns();
});

const VALID = { maxHotspots: 5 };

/** Fixture: entry de pi-lens presente en el agentDir (presencia, no carga). */
function fixtureLensEntry(agentDir: string): void {
	const entry = join(
		agentDir,
		"npm",
		"node_modules",
		"pi-lens",
		"dist",
		"index.js",
	);
	mkdirSync(dirname(entry), { recursive: true });
	writeFileSync(entry, "// stub entry\n");
}

/** Fixture: open-codebase-index instalado al pin (package.json + entry). */
function fixtureCodebaseIndexAtPin(agentDir: string): void {
	const pkgDir = join(agentDir, "npm", "node_modules", CODEBASE_INDEX_PACKAGE);
	mkdirSync(pkgDir, { recursive: true });
	writeFileSync(
		join(pkgDir, "package.json"),
		JSON.stringify({ version: CODEBASE_INDEX_PIN }),
	);
	const entry = upstreamEntryPath(agentDir);
	mkdirSync(dirname(entry), { recursive: true });
	writeFileSync(entry, "// stub entry\n");
}

describe("frida-understand-app · validación eager de args (#134)", () => {
	it("maxHotspots faltante instruye preguntar pre-launch (D13)", () => {
		let err: Error | undefined;
		try {
			UNDERSTAND_APP_PATTERN.resolve({}, { cwd });
		} catch (e) {
			err = e as Error;
		}
		expect(err).toBeInstanceOf(Error);
		expect(err?.message).toMatch(/maxHotspots/);
		// El error es accionable: instruye la pregunta en la sesión principal.
		expect(err?.message).toContain("ask_user_question");
		expect(() => UNDERSTAND_APP_PATTERN.resolve(null, { cwd })).toThrow(
			/maxHotspots/,
		);
	});

	it("maxHotspots fuera de rango o no entero se rechaza", () => {
		for (const bad of [-1, 101, 2.5, "12"]) {
			expect(() =>
				UNDERSTAND_APP_PATTERN.resolve({ maxHotspots: bad }, { cwd }),
			).toThrow(/maxHotspots/);
		}
	});

	it("maxMinutes fuera de rango se rechaza (1-240, entero)", () => {
		for (const bad of [0, 241, 1.5]) {
			expect(() =>
				UNDERSTAND_APP_PATTERN.resolve({ ...VALID, maxMinutes: bad }, { cwd }),
			).toThrow(/maxMinutes/);
		}
	});

	it("review inválido se rechaza", () => {
		expect(() =>
			UNDERSTAND_APP_PATTERN.resolve({ ...VALID, review: "sometimes" }, { cwd }),
		).toThrow(/review/);
	});
});

describe("frida-understand-app · sonda de capacidades host-side (D5/D6)", () => {
	it("sin instalaciones → ambas false", () => {
		expect(detectUnderstandAppCapabilities(join(home, ".frida"))).toEqual({
			lens: false,
			codebaseIndex: false,
		});
	});

	it("entry de pi-lens presente → lens true (codebaseIndex igual false)", () => {
		const agentDir = join(home, ".frida");
		fixtureLensEntry(agentDir);
		expect(detectUnderstandAppCapabilities(agentDir)).toEqual({
			lens: true,
			codebaseIndex: false,
		});
	});

	it("codebase-index al pin → codebaseIndex true", () => {
		const agentDir = join(home, ".frida");
		fixtureCodebaseIndexAtPin(agentDir);
		expect(detectUnderstandAppCapabilities(agentDir)).toEqual({
			lens: false,
			codebaseIndex: true,
		});
	});

	it("el toggle apagado vence a la instalación (D5)", () => {
		const agentDir = join(home, ".frida");
		fixtureLensEntry(agentDir);
		fixtureCodebaseIndexAtPin(agentDir);
		expect(detectUnderstandAppCapabilities(agentDir, false)).toEqual({
			lens: true,
			codebaseIndex: false,
		});
	});
});

describe("frida-understand-app · forma del script generado (#134)", () => {
	it("el patrón está nombrado y documentado (catálogo)", () => {
		expect(UNDERSTAND_APP_PATTERN.name).toBe("understand-app");
		expect(UNDERSTAND_APP_PATTERN.args.length).toBeGreaterThan(10);
		expect(UNDERSTAND_APP_PATTERN.description.length).toBeGreaterThan(40);
	});

	it("la meta declara shell, postura autónoma y el moat (R9/D3)", () => {
		expect(UNDERSTAND_APP_PATTERN.meta?.requiredTools).toContain("shell");
		expect(UNDERSTAND_APP_PATTERN.meta?.executionHints?.autonomous).toBe(true);
		expect(UNDERSTAND_APP_PATTERN.meta?.moat).toEqual({
			lens: true,
			codebaseIndex: true,
		});
	});

	it("las 6 fases en orden: bootstrap → overview → hotspots → analyze → synthesize → judge", () => {
		const script = UNDERSTAND_APP_PATTERN.resolve(VALID, { cwd });
		const idx = [
			script.indexOf('phase("bootstrap")'),
			script.indexOf('phase("overview")'),
			script.indexOf('phase("hotspots")'),
			script.indexOf('phase("analyze")'),
			script.indexOf('phase("synthesize")'),
			script.indexOf('phase("judge")'),
		];
		for (const i of idx) expect(i).toBeGreaterThan(-1);
		for (let i = 1; i < idx.length; i++) {
			expect(idx[i]).toBeGreaterThan(idx[i - 1]);
		}
	});

	it("el veto de solo-lectura y las 7 preguntas viajan en el script (D8)", () => {
		const script = UNDERSTAND_APP_PATTERN.resolve(VALID, { cwd });
		expect(script).toContain("VETADO"); // preamble no-stage interpolado
		expect(script).toContain("¿Dónde se autentican los usuarios?"); // Q1 verbatim
	});

	it("CAPABILITIES interpolada host-side (D6) — false bajo HOME aislado", () => {
		const script = UNDERSTAND_APP_PATTERN.resolve(VALID, { cwd });
		expect(script).toContain(
			'const CAPABILITIES = {"lens":false,"codebaseIndex":false}',
		);
	});

	it("el fan-out cubre scouts + 3 escritores + entregables deterministas", () => {
		const script = UNDERSTAND_APP_PATTERN.resolve(VALID, { cwd });
		expect(script).toContain('parallel("hotspots"');
		expect(script).toContain('parallel("writers"');
		for (const file of [
			"entendimiento.md",
			"mapa-riesgos.md",
			"likec4/modelo.c4",
			"README.md",
			"m4-m5-veredicto.md",
			"inventory.json",
		]) {
			expect(script).toContain(file);
		}
		expect(script).toContain('checkpoint({ name: "understand-app-final"');
	});

	it("cortes pre-LLM y registro de corte (D9/D10)", () => {
		const script = UNDERSTAND_APP_PATTERN.resolve(VALID, { cwd });
		expect(script).toContain("prioritized.slice(0, maxHotspots)");
		expect(script).toContain("stoppedBy");
	});

	it("defaults defensivos del motor (args validados como fallback)", () => {
		const script = UNDERSTAND_APP_PATTERN.resolve(VALID, { cwd });
		// Needle sin paréntesis de cierre: el script del Slice 2 continúa la
		// condición con `&& args.maxHotspots >= 0 && …` (lección del verificador).
		expect(script).toContain('(args && typeof args.maxHotspots === "number"');
	});

	it("resolve honra ctx.cwd: el override de equipo llega al script (D7)", () => {
		const projectRoot = mkdtempSync(join(tmpdir(), "understand-proj-"));
		try {
			const teamDir = join(projectRoot, ".frida", "understand-app");
			mkdirSync(teamDir, { recursive: true });
			writeFileSync(
				join(teamDir, "stages.json"),
				JSON.stringify({ stages: { judge: "Rúbrica custom del equipo." } }),
			);
			const script = UNDERSTAND_APP_PATTERN.resolve(VALID, {
				cwd: projectRoot,
			});
			expect(script).toContain("Rúbrica custom del equipo.");
			expect(script).toContain("fuente del prompt: team");
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});

describe("frida-understand-app · registro en runtime sobre el motor (#134)", () => {
	it("la factory registra el patrón (smoke de registro)", () => {
		expect(findBuiltinPattern("understand-app")).toBeUndefined();
		createFridaUnderstandApp()({} as never);
		const found = findBuiltinPattern("understand-app");
		expect(found?.name).toBe("understand-app");
		expect(found?.description).toContain("docs/entendimiento/");
	});

	it("el catálogo lista el patrón junto a los builtin (toContain, no conteo)", () => {
		createFridaUnderstandApp()({} as never);
		const names = builtinPatternsCatalog().map((p) => p.name);
		expect(names).toContain("understand-app");
		expect(names).toContain("code-review"); // los 4 de #19 siguen
	});

	it("la factory es idempotente por nombre (no duplica)", () => {
		const factory = createFridaUnderstandApp();
		factory({} as never);
		factory({} as never);
		expect(
			builtinPatternsCatalog().filter((p) => p.name === "understand-app"),
		).toHaveLength(1);
	});

	it("la factory con agentDir propio interpola capacidades exactas (D6)", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "understand-agentdir-"));
		try {
			fixtureLensEntry(agentDir);
			createFridaUnderstandApp({ agentDir })({} as never);
			const script = findBuiltinPattern("understand-app")?.resolve(VALID, {
				cwd,
			});
			expect(script).toContain('"lens":true');
			expect(script).toContain('"codebaseIndex":false');
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("el getter codebaseIndexEnabled apagado degrada CAPABILITIES (D5)", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "understand-agentdir-"));
		try {
			fixtureLensEntry(agentDir);
			fixtureCodebaseIndexAtPin(agentDir);
			createFridaUnderstandApp({
				agentDir,
				codebaseIndexEnabled: () => false,
			})({} as never);
			const script = findBuiltinPattern("understand-app")?.resolve(VALID, {
				cwd,
			});
			expect(script).toContain(
				'const CAPABILITIES = {"lens":true,"codebaseIndex":false}',
			);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
