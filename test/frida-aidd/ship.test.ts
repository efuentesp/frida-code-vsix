// frida-aidd — tests del patrón aidd-ship (Lote 2): validación de args,
// registro, y e2e sobre el motor real con GIT REAL en tmpdir. El dev mock
// escribe archivos reales (pasa el lie-detector) o miente (queda blocked).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { validateAiddShipArgs } from "../../src/tools/frida-aidd/ship";
import {
	AIDD_SHIP_PATTERN as SHIP,
	createFridaAidd,
} from "../../src/tools/frida-aidd";
import {
	registerBuiltinPattern,
	clearRegisteredBuiltinPatterns,
	builtinPatternsCatalog,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import { instrumentWorkflow } from "../../src/tools/frida-extensible-workflows/core/validation";

const REAL_HOME = process.env.HOME;

let home: string;
let cwd: string;

function git(command: string): string {
	return execSync(`git ${command}`, { cwd, encoding: "utf8" }).trim();
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "ship-home-"));
	cwd = mkdtempSync(join(tmpdir(), "ship-cwd-"));
	process.env.HOME = home;
	execSync("git init -q -b main", { cwd });
	git('config user.email "aidd@test"');
	git('config user.name "aidd test"');
	git('config commit.gpgsign "false"');
	execSync('git commit --allow-empty -q -m "init"', { cwd });
	// Artefactos de plan (spec de la historia).
	mkdirSync(join(cwd, "docs/aidd/planning"), { recursive: true });
	writeFileSync(
		join(cwd, "docs/aidd/planning/spec-E1-S1.md"),
		"# SPEC E1-S1\n\nWhy: prueba.\nCapabilities: saludar.\n\n## Verify\n\ntrue\n",
		"utf8",
	);
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	clearRegisteredBuiltinPatterns();
});

/** Respuestas del agente por ancla única (orden: específico → general). */
function makeSpawn(responses: {
	dev?: () => {
		summary: string;
		filesTouched: string[];
		storyComplete: boolean;
	};
}): SpawnAgentFn {
	return (async (prompt: string) => {
		if (prompt.includes("sweep triage agent")) {
			return { stories: [], keep: [] };
		}
		if (prompt.includes("story roster")) {
			return {
				sprint: "1",
				stories: [
					{
						id: "E1-S1",
						title: "Saludar al usuario",
						spec: "docs/aidd/planning/spec-E1-S1.md",
						verifyCommands: ["true"],
					},
				],
			};
		}
		if (prompt.includes("senior code reviewer")) {
			return { verdict: "APPROVE", notes: "" };
		}
		if (prompt.includes("Address the reviewer's concerns")) {
			return { summary: "fix", filesTouched: [], storyComplete: true };
		}
		if (prompt.includes("You previously reported files")) {
			// Rework: igual que dev (el mock decide si escribe o miente).
			return responses.dev!();
		}
		if (prompt.includes("You are the DEV agent")) {
			return responses.dev!();
		}
		throw new Error(`mock sin rama para: ${prompt.slice(0, 80)}`);
	}) as unknown as SpawnAgentFn;
}

async function launch(spawnAgent: SpawnAgentFn) {
	const script = SHIP.resolve({ review: "auto", maxSweeps: 1 });
	return runWorkflowInStore({
		name: "aidd-ship",
		script,
		args: { review: "auto", maxSweeps: 1 },
		cwd,
		sessionId: "sess-ship",
		spawnAgent,
		home,
		runId: randomUUID(),
		foreground: false,
	});
}

describe("frida-aidd · validateAiddShipArgs (#38 Lote 2)", () => {
	it("rechaza review inválido y maxSweeps fuera de rango", () => {
		expect(() => validateAiddShipArgs({ review: "yolo" })).toThrow(/review/);
		expect(() => validateAiddShipArgs({ maxSweeps: 9 })).toThrow(/maxSweeps/);
		expect(() => validateAiddShipArgs({ maxSweeps: -1 })).toThrow(/maxSweeps/);
	});
	it("acepta args válidos y vacíos", () => {
		expect(validateAiddShipArgs({})).toEqual({});
		expect(
			validateAiddShipArgs({ sprint: "2", review: "manual", maxSweeps: 0 }),
		).toEqual({ sprint: "2", review: "manual", maxSweeps: 0 });
	});
	it("el patrón valida eager en resolve()", () => {
		expect(() => SHIP.resolve({ review: "x" })).toThrow(/review/);
		expect(typeof SHIP.resolve({})).toBe("string");
	});
});

describe("frida-aidd · registro del patrón aidd-ship (#38 Lote 2)", () => {
	it("la factory registra aidd-ship Y aidd-plan en el catálogo del motor", () => {
		// El wiring real: la factory (pi-session la invoca por sesión) registra
		// ambos patrones. _pi se ignora — el dummy basta.
		createFridaAidd()({} as never);
		const names = builtinPatternsCatalog().map((p) => p.name);
		expect(names).toContain("aidd-ship");
		expect(names).toContain("aidd-plan");
		expect(names).toContain("code-review"); // los 4 de #19 siguen
		expect(names).toHaveLength(6);
	});
});

describe("frida-aidd · aidd-ship e2e con git real (#38 Lote 2)", () => {
	it("el script generado parsea limpio en el parser del motor", () => {
		const script = SHIP.resolve({});
		try {
			instrumentWorkflow(script);
		} catch (error) {
			// Debug: imprimir la línea culpable (±2) para diagnóstico.
			const m = /(\d+):(\d+)/.exec(String(error));
			if (m) {
				const ln = Number(m[1]);
				const lines = script.split("\n");
				for (let i = ln - 3; i <= ln + 1; i++) {
					console.error(
						`L${i + 1}:`,
						JSON.stringify(lines[i] ?? null),
					);
				}
			}
			throw error;
		}
	});

	it("happy path: dev honesto → lie-detector ok → review → verify → commit del orquestador", async () => {
		const spawn = makeSpawn({
			dev: () => {
				// El dev mock ESCRIBE un archivo real (como haría un agente con
				// tools de archivo) y reclama exactamente ese path.
				mkdirSync(join(cwd, "src"), { recursive: true });
				writeFileSync(
					join(cwd, "src", "greet.ts"),
					'export function greet(): string {\n\treturn "hola";\n}\n',
					"utf8",
				);
				return {
					summary: "implementado",
					filesTouched: ["src/greet.ts"],
					storyComplete: true,
				};
			},
		});

		const { result } = await launch(spawn);
		const r = result as {
			done: string[];
			blocked: string[];
			held: string[];
			deferredOpen: number;
		};
		expect(r.done).toEqual(["E1-S1"]);
		expect(r.blocked).toEqual([]);
		expect(r.deferredOpen).toBe(0);

		// El commit del orquestador existe con el formato aidd.
		const log = git("log --oneline");
		expect(log).toMatch(/feat\(aidd\): E1-S1 - Saludar al usuario/);

		// sprint-status.yaml quedó con done y el archivo es legible por la lib.
		const statusText = execSync(
			`cat ${join(cwd, "docs/aidd/sprint-status.yaml")}`,
			{ encoding: "utf8" },
		);
		expect(statusText).toContain("status: done");

		// El commit incluyó el archivo del dev.
		const committed = git("show --name-only --format=");
		expect(committed).toContain("src/greet.ts");
	}, 30000);

	it("lie-detector: dev que reclama archivos sin diff queda blocked (sin commit)", async () => {
		const before = git("rev-parse HEAD");
		const spawn = makeSpawn({
			dev: () => ({
				summary: "supuestamente implementado",
				filesTouched: ["src/never-made.ts"],
				storyComplete: true,
			}),
		});

		const { result } = await launch(spawn);
		const r = result as { done: string[]; blocked: string[] };
		expect(r.done).toEqual([]);
		expect(r.blocked).toEqual(["E1-S1"]);

		// Sin commit del orquestador: HEAD no se movió.
		expect(git("rev-parse HEAD")).toBe(before);

		// sprint-status.yaml quedó blocked con la razón del lie-detector.
		const statusText = execSync(
			`cat ${join(cwd, "docs/aidd/sprint-status.yaml")}`,
			{ encoding: "utf8" },
		);
		expect(statusText).toContain("status: blocked");
		expect(statusText).toMatch(/blockedReason: .*lie-detector/);
	}, 30000);

	it("bootstrap persiste sprint-status idempotente: segunda corrida no re-bootstrapea", async () => {
		const spawn = makeSpawn({
			dev: () => {
				writeFileSync(join(cwd, "other.txt"), "x", "utf8");
				return {
					summary: "ok",
					filesTouched: ["other.txt"],
					storyComplete: true,
				};
			},
		});
		await launch(spawn);
		const first = execSync(`cat ${join(cwd, "docs/aidd/sprint-status.yaml")}`, {
			encoding: "utf8",
		});
		// Segunda corrida: sin historias pending → no hace nada, archivo igual
		// (la rama de bootstrap no se toma: sprint-status ya existe).
		let bootstrapCalls = 0;
		const spawn2: SpawnAgentFn = (async (prompt: string) => {
			if (prompt.includes("story roster")) bootstrapCalls++;
			throw new Error(`no debió llamar agentes: ${prompt.slice(0, 60)}`);
		}) as unknown as SpawnAgentFn;
		const { result } = await launch(spawn2);
		const r = result as { done: string[]; blocked: string[] };
		expect(r.done).toEqual([]);
		expect(r.blocked).toEqual([]);
		expect(bootstrapCalls).toBe(0);
		const second = execSync(
			`cat ${join(cwd, "docs/aidd/sprint-status.yaml")}`,
			{ encoding: "utf8" },
		);
		// Round-trip estable: el rewrite del loop vacío no altera el contenido
		// normalizado (misma serialización determinista).
		expect(second).toBe(first);
	}, 30000);
});
