// frida-aidd — ciclo COMPLETO del aidd-plan con agente contrato-obediente (#70).
//
// Simulación fiel de un LLM real: el spawn LEE el OUTPUT CONTRACT del prompt
// (ruta absoluta del artefacto), ESCRIBE el archivo con contenido válido y
// responde un summary corto — exactamente lo que el contrato (#68) exige.
// Si el contrato fuera ambiguo o insuficiente, el golden path se rompe: este
// test ES la revisión ejecutable del workflow completo.
//
// Después, los modos de fallo reales del Dev Host (run 8fb037a7 y anteriores):
//   A. spawn que MUERE con error de API (¿el error original llega al usuario?)
//   B. fantasma persistente en el PASO 1 (caso 8fb037a7: expediente legible)
//
// Regla del issue: nada se arregla sin que un test rojo lo demuestre primero.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	readFileSync,
	existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import { resolveCheckpoint } from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { AIDD_PLAN_PATTERN } from "../../src/tools/frida-aidd";

const REAL_HOME = process.env.HOME;

let home: string;
let cwd: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "aidd-cycle-home-"));
	cwd = mkdtempSync(join(tmpdir(), "aidd-cycle-cwd-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

/**
 * Núcleo del agente CONTRATO-OBEDIENTE — función plana para reuso interno
 * de otros spawners (el cast a SpawnAgentFn es sólo donde lo consume el host).
 */
async function runObedient(prompt: string): Promise<unknown> {
	if (prompt.includes("return ONLY a JSON object")) {
		return {
			stories: [
				{ id: "E1-S1", title: "Exportar CSV" },
				{ id: "E1-S2", title: "Filtro por fecha" },
			],
		};
	}
	// La ruta del artefacto vive en la línea indentada del contrato:
	//   "  <absDir>/<artifact>"
	const match = prompt.match(/^ {2}(\S+\/\S+\.md)$/m);
	if (!match) {
		throw new Error(`CONTRATO ILEIBLE — el agente no encontró la ruta: ${prompt.slice(0, 120)}`);
	}
	const artifactPath = match[1];
	const name = artifactPath.split("/").pop() ?? "artifact.md";
	writeFileSync(artifactPath, `# ${name}\n\nArtefacto del agente contrato-obediente (#70).\n`);
	return `${name} escrito — decisiones: ok; supuestos: ninguno`;
}

const obedientSpawn: SpawnAgentFn = (async (prompt: string) =>
	runObedient(prompt)) as unknown as SpawnAgentFn;

/** waitUntil mínimo. */
async function until(cond: () => boolean, ms = 10000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error("timeout esperando condición");
		await new Promise((r) => setTimeout(r, 20));
	}
}

describe("frida-aidd · ciclo completo golden path (#70)", () => {
	it("agente contrato-obediente recorre brief→prd→architecture→epics→specs con checkpoints", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "módulo de reportes exportables", project: "frida", review: "manual" },
			{ cwd },
		);
		const checkpoints: Array<{ name: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "módulo de reportes exportables", project: "frida", review: "manual" },
			cwd,
			sessionId: "sess-cycle",
			spawnAgent: obedientSpawn,
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		// Los 4 checkpoints en orden: brief, prd, architecture, spec-fanout.
		const expected = ["stage-product-brief", "stage-prd", "stage-architecture", "spec-fanout"];
		for (const name of expected) {
			await until(() => checkpoints.some((c) => c.name === name));
			resolveCheckpoint(runId, name, true);
		}

		const { result } = await promise;
		const r = result as {
			summaries: Record<string, string>;
			stories: string[];
			specs: Record<string, string>;
		};

		// Artefactos REALES en disco (la cadena de custodia es filesystem).
		const dir = join(cwd, "docs/aidd/planning");
		for (const f of [
			"product-brief.md",
			"prd.md",
			"architecture.md",
			"epics-and-stories.md",
			"spec-E1-S1.md",
			"spec-E1-S2.md",
		]) {
			const p = join(dir, f);
			expect(existsSync(p), `${f} debe existir en disco`).toBe(true);
			expect(readFileSync(p, "utf8").length, `${f} no vacío`).toBeGreaterThan(0);
		}
		expect(r.stories).toEqual(["E1-S1", "E1-S2"]);
		expect(Object.keys(r.specs)).toEqual(["E1-S1", "E1-S2"]);
		expect(r.summaries.prd).toContain("prd.md escrito");
	}, 30000);

	it("relanzar tras el ciclo completo NO re-agentea ni pisa artefactos (resume)", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "módulo de reportes exportables", project: "frida", review: "auto" },
			{ cwd },
		);
		// 1ª corrida completa.
		await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "módulo de reportes exportables", project: "frida", review: "auto" },
			cwd,
			sessionId: "sess-cycle-2a",
			spawnAgent: obedientSpawn,
			home,
			runId: randomUUID(),
			foreground: false,
		});
		// El usuario edita el PRD a mano — debe sobrevivir.
		const prdPath = join(cwd, "docs/aidd/planning/prd.md");
		writeFileSync(prdPath, "# PRD editado a mano (sentinel #70)\n");

		// 2ª corrida: contamos spawns.
		const seen: string[] = [];
		const countingSpawn: SpawnAgentFn = (async (prompt: string) => {
			seen.push(prompt);
			return runObedient(prompt);
		}) as unknown as SpawnAgentFn;
		await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "módulo de reportes exportables", project: "frida", review: "auto" },
			cwd,
			sessionId: "sess-cycle-2b",
			spawnAgent: countingSpawn,
			home,
			runId: randomUUID(),
			foreground: false,
		});

		// Sólo el extractor de historias corrió (ni stages ni specs).
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain("return ONLY a JSON object");
		// El trabajo manual sobrevive.
		expect(readFileSync(prdPath, "utf8")).toContain("sentinel #70");
	}, 30000);
});

describe("frida-aidd · modos de fallo reales del Dev Host (#70)", () => {
	it("A: spawn muere con error de API → el error ORIGINAL viaja al run failed (no se traga)", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const failingSpawn: SpawnAgentFn = (async (prompt: string) => {
			if (prompt.includes("Business Analyst (Mary)")) {
				throw new Error("API Error: 429 rate limit exceeded (provider)");
			}
			return runObedient(prompt);
		}) as unknown as SpawnAgentFn;

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-cycle-err",
			spawnAgent: failingSpawn,
			home,
			runId: randomUUID(),
			foreground: false,
		});

		// El mensaje del run failed debe conservar el error original del
		// proveedor — el usuario distingue "no pude correr" de "corrió y mintió".
		await expect(promise).rejects.toThrow(/429 rate limit/);
	}, 30000);

	it("B: fantasma persistente en el PASO 1 (caso 8fb037a7) → expediente legible con ambos intentos", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const seen: string[] = [];
		// El agente SIEMPRE dice "listo" sin escribir el brief.
		const ghostSpawn: SpawnAgentFn = (async (prompt: string) => {
			seen.push(prompt);
			if (prompt.includes("return ONLY a JSON object")) {
				return { stories: [] };
			}
			if (prompt.includes("Business Analyst (Mary)")) {
				return "brief.md listo"; // mentira
			}
			return runObedient(prompt);
		}) as unknown as SpawnAgentFn;

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-cycle-ghost",
			spawnAgent: ghostSpawn,
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const err = await promise.then(() => "").catch((e: Error) => e.message);
		expect(err).toMatch(/stage product-brief: tras 2 intentos/);
		expect(err).toContain("Intento 1:");
		expect(err).toContain("Intento 2:");
		expect(err).toContain("$ ls -la");
		// Cap: exactamente 2 intentos del stage brief.
		expect(
			seen.filter((p) => p.includes("Business Analyst (Mary)")),
		).toHaveLength(2);
	}, 30000);
});
