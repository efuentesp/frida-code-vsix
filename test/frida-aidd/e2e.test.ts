// frida-aidd — integración end-to-end del workflow aidd-plan sobre el motor
// real (runWorkflowInStore + RunStore). Issue #38 Lote 1.
//
// El spawner es un mock: registra los prompts que recibe y responde por
// matching de contenido — cada stage de la cadena devuelve su resumen; el
// extractor de historias devuelve el JSON parseado (outputSchema) con 2
// historias; cada spec devuelve su resumen. Así se valida el flujo real del
// script (cadena + checkpoints + fan-out) sin LLM.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
	runWorkflowInStore,
} from "../../src/tools/frida-extensible-workflows/frida-host";
import {
	resolveCheckpoint,
} from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { AIDD_PLAN_PATTERN } from "../../src/tools/frida-aidd";

const REAL_HOME = process.env.HOME;

let home: string;
let cwd: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "aidd-e2e-home-"));
	cwd = mkdtempSync(join(tmpdir(), "aidd-e2e-cwd-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

/**
 * Mock del spawner con matching por anclas ÚNICAS (encabezados verbatim de
 * cada skill). El orden importa y va de lo más específico a lo más general:
 * el prompt de architecture menciona "PRD" y el de epics menciona
 * "Architect" — mismos colisiones que los bridges del lote2 (#19).
 */
const makeSpawn = (seen: string[]) =>
	(async (prompt: string) => {
		seen.push(prompt);
		// Extractor de historias: outputSchema → objeto parseado.
		if (prompt.includes("return ONLY a JSON object")) {
			return {
				stories: [
					{ id: "E1-S1", title: "Exportar CSV" },
					{ id: "E1-S2", title: "Filtro por fecha" },
				],
			};
		}
		// Specs del fan-out.
		if (prompt.includes("## Story to spec")) {
			const id = prompt.match(/## Story to spec\n(E\d+-S\d+)/)?.[1] ?? "?";
			return `spec ${id} escrita en ${id}.spec.md`;
		}
		// Stages de la cadena — anclas únicas por encabezado del skill.
		if (prompt.includes("Business Analyst (Mary)")) return "brief.md listo";
		if (prompt.includes("Architect (Winston)")) return "architecture.md listo";
		if (prompt.includes("Product Manager (John)")) return "prd.md listo";
		if (prompt.includes("PM + Architect pairing"))
			return "epics-and-stories.md listo";
		return `echo: ${prompt.slice(0, 40)}`;
	}) as unknown as SpawnAgentFn;

describe("frida-aidd · workflow aidd-plan end-to-end sobre el motor (#38)", () => {
	it("corre la cadena completa con checkpoints y fan-out de specs", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "módulo de reportes exportables", project: "frida", review: "manual" },
			{ cwd },
		);
		const seen: string[] = [];
		const checkpoints: Array<{ name: string; prompt: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: {
				idea: "módulo de reportes exportables",
				project: "frida",
				review: "manual",
			},
			cwd,
			sessionId: "sess-1",
			spawnAgent: makeSpawn(seen),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name, prompt: cp.prompt }),
		});

		// Los 3 checkpoints de la cadena (tras brief, prd, architecture).
		await vi0(() => checkpoints.length >= 1);
		await resolveCheckpoint0(runId, "stage-product-brief", true);
		await vi0(() => checkpoints.length >= 2);
		await resolveCheckpoint0(runId, "stage-prd", true);
		await vi0(() => checkpoints.length >= 3);
		await resolveCheckpoint0(runId, "stage-architecture", true);

		const { result } = await promise;
		const r = result as {
			stories: string[];
			summaries: Record<string, string>;
			specs: Record<string, string>;
		};
		// Cadena completa corrida.
		expect(r.summaries["product-brief"]).toBe("brief.md listo");
		expect(r.summaries.prd).toBe("prd.md listo");
		expect(r.summaries.architecture).toBe("architecture.md listo");
		expect(r.summaries["epics-and-stories"]).toBe("epics-and-stories.md listo");
		// Fan-out: una spec por historia.
		expect(r.stories).toEqual(["E1-S1", "E1-S2"]);
		expect(Object.keys(r.specs)).toEqual(["E1-S1", "E1-S2"]);
		// Cada stage recibió los artefactos previos como upstream.
		const prdPrompt = seen.find((p) => p.includes("PRD"))!;
		expect(prdPrompt).toContain("product-brief.md");
		const archPrompt = seen.find((p) => p.includes("ARCHITECTURE SPINE"))!;
		expect(archPrompt).toContain("prd.md");
	}, 30000);

	it("checkpoint rechazado detiene la cadena (falla ruidosamente)", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "x", review: "manual" },
			{ cwd },
		);
		const checkpoints: Array<{ name: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "x", review: "manual" },
			cwd,
			sessionId: "sess-2",
			spawnAgent: makeSpawn([]),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		await vi0(() => checkpoints.length >= 1);
		await resolveCheckpoint0(runId, "stage-product-brief", false);
		await expect(promise).rejects.toThrow(/checkpoint rechazado/);
	}, 15000);

	it("review=auto corre sin checkpoints hasta el fan-out", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "y", review: "auto" },
			{ cwd },
		);
		const checkpoints: Array<{ name: string }> = [];
		const seen: string[] = [];

		const { result } = await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "y", review: "auto" },
			cwd,
			sessionId: "sess-3",
			spawnAgent: makeSpawn(seen),
			home,
			runId: randomUUID(),
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		expect(checkpoints).toHaveLength(0);
		const r = result as { stories: string[]; specs: Record<string, string> };
		expect(r.stories).toEqual(["E1-S1", "E1-S2"]);
		expect(Object.keys(r.specs)).toHaveLength(2);
	}, 30000);
});

/** waitUntil mínimo sin importar el helper del suite de workflows. */
async function vi0(cond: () => boolean, ms = 10000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error("timeout esperando condición");
		await new Promise((r) => setTimeout(r, 20));
	}
}

async function resolveCheckpoint0(runId: string, name: string, ok: boolean) {
	resolveCheckpoint(runId, name, ok);
}
void resolveCheckpoint0;
