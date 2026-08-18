// frida-aidd — integración end-to-end del workflow aidd-plan sobre el motor
// real (runWorkflowInStore + RunStore). Issue #38 Lote 1.
//
// El spawner es un mock: registra los prompts que recibe y responde por
// matching de contenido — cada stage de la cadena devuelve su resumen; el
// extractor de historias devuelve el JSON parseado (outputSchema) con 2
// historias; cada spec devuelve su resumen. Así se valida el flujo real del
// script (cadena + checkpoints + fan-out) sin LLM.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as fs from "node:fs";
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
/** Escribe el artefacto de un stage a disco — el gate #65 exige que exista
 * (contrato headless real: el agente escribe con sus file tools). */
const writeArtifact = (cwd: string, file: string) => {
	const dir = join(cwd, "docs/aidd/planning");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, file),
		`# ${file}\n\nArtefacto de prueba del e2e (gate #65).\n`,
	);
};

const makeSpawn = (seen: string[], cwd: string) =>
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
		// Specs del fan-out — ESCRIBEN su archivo (gate #68 exige spec-<id>.md).
		if (prompt.includes("## Story to spec")) {
			const id = prompt.match(/## Story to spec\n(E\d+-S\d+)/)?.[1] ?? "?";
			writeArtifact(cwd, `spec-${id}.md`);
			return `spec ${id} escrita en ${id}.spec.md`;
		}
		// Stages de la cadena — anclas únicas por encabezado del skill. Cada uno
		// ESCRIBE su artefacto (el gate #65 hace test -s antes del checkpoint).
		if (prompt.includes("Business Analyst (Mary)")) {
			writeArtifact(cwd, "product-brief.md");
			return "brief.md listo";
		}
		if (prompt.includes("Architect (Winston)")) {
			writeArtifact(cwd, "architecture.md");
			return "architecture.md listo";
		}
		if (prompt.includes("Product Manager (John)")) {
			writeArtifact(cwd, "prd.md");
			return "prd.md listo";
		}
		if (prompt.includes("PM + Architect pairing")) {
			writeArtifact(cwd, "epics-and-stories.md");
			return "epics-and-stories.md listo";
		}
		return `echo: ${prompt.slice(0, 40)}`;
	}) as unknown as SpawnAgentFn;

describe("frida-aidd · workflow aidd-plan end-to-end sobre el motor (#38)", () => {
	it("corre la cadena completa con checkpoints y fan-out de specs", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{
				idea: "módulo de reportes exportables",
				project: "frida",
				review: "manual",
			},
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
			spawnAgent: makeSpawn(seen, cwd),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name, prompt: cp.prompt }),
		});

		// Los 3 checkpoints de la cadena + el pre-fan-out (#68).
		await vi0(() => checkpoints.length >= 1);
		await resolveCheckpoint0(runId, "stage-product-brief", true);
		await vi0(() => checkpoints.length >= 2);
		await resolveCheckpoint0(runId, "stage-prd", true);
		await vi0(() => checkpoints.length >= 3);
		await resolveCheckpoint0(runId, "stage-architecture", true);
		await vi0(() => checkpoints.length >= 4);
		await resolveCheckpoint0(runId, "spec-fanout", true);

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
			spawnAgent: makeSpawn([], cwd),
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
			spawnAgent: makeSpawn(seen, cwd),
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

/**
 * Spawner del caso #67: el stage prd MIENTE (dice "prd.md listo" sin
 * escribir). `prdLies` controla cuántas veces: 1 = el reintento informado
 * sí escribe y la cadena continúa; Infinity = persiste y el expediente
 * detiene el run. Todos los demás stages se portan bien.
 */
const makeLyingPrdSpawn = (seen: string[], cwd: string, prdLies: number) =>
	(async (prompt: string) => {
		seen.push(prompt);
		if (prompt.includes("return ONLY a JSON object")) {
			return { stories: [{ id: "E1-S1", title: "Exportar CSV" }] };
		}
		if (prompt.includes("## Story to spec")) {
			const id = prompt.match(/## Story to spec\n(E\d+-S\d+)/)?.[1] ?? "?";
			writeArtifact(cwd, `spec-${id}.md`);
			return `spec ${id} escrita`;
		}
		if (prompt.includes("Business Analyst (Mary)")) {
			writeArtifact(cwd, "product-brief.md");
			return "brief.md listo";
		}
		if (prompt.includes("Product Manager (John)")) {
			const esReintento = prompt.includes("Tu intento anterior NO escribió");
			const intento = seen.filter(
				(p) =>
					p.includes("Product Manager (John)") &&
					p.includes("Tu intento anterior NO escribió") === esReintento,
			).length;
			if (esReintento && intento <= prdLies) {
				writeArtifact(cwd, "prd.md");
				return "prd.md listo (reintento honesto)";
			}
			return "prd.md listo"; // mentira: no escribe
		}
		if (prompt.includes("Architect (Winston)")) {
			writeArtifact(cwd, "architecture.md");
			return "architecture.md listo";
		}
		if (prompt.includes("PM + Architect pairing")) {
			writeArtifact(cwd, "epics-and-stories.md");
			return "epics-and-stories.md listo";
		}
		return `echo: ${prompt.slice(0, 40)}`;
	}) as unknown as SpawnAgentFn;

describe("frida-aidd · reintento del gate de artefacto (#67)", () => {
	it("prd fantasma 1 vez: el reintento informado escribe y la cadena continúa", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const seen: string[] = [];

		const { result } = await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r67a",
			spawnAgent: makeLyingPrdSpawn(seen, cwd, 1),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		// El summary del stage es el del reintento (el válido).
		const r = result as { summaries: Record<string, string> };
		expect(r.summaries.prd).toBe("prd.md listo (reintento honesto)");
		// El reintento recibió el summary del intento 1 como evidencia.
		const retryPrompt = seen.find((p) =>
			p.includes("Tu intento anterior NO escribió"),
		)!;
		expect(retryPrompt).toContain("prd.md");
		expect(retryPrompt).toContain("prd.md listo");
		// La cadena llegó al fan-out con el artefacto real.
		expect(seen.some((p) => p.includes("## Story to spec"))).toBe(true);
	}, 30000);

	it("prd fantasma persistente: falla con expediente (ambos intentos + directorio)", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const seen: string[] = [];

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r67b",
			spawnAgent: makeLyingPrdSpawn(seen, cwd, 0),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		await expect(promise).rejects.toThrow(
			/tras 2 intentos[\s\S]*Intento 1:[\s\S]*Intento 2:/,
		);
		// Dos intentos del stage prd, ni uno más (cap de 1 reintento).
		const prdPrompts = seen.filter((p) => p.includes("Product Manager (John)"));
		expect(prdPrompts).toHaveLength(2);
		// El expediente incluye el estado real del directorio (brief SÍ escrito).
		const err = await promise.catch((e: Error) => e.message);
		expect(err).toContain("ls");
		expect(err).toContain("product-brief.md");
	}, 30000);
});

/**
 * Spawner del caso #68 (specs mentirosas): la cadena se porta bien; los
 * agentes de spec dicen "lista" SIN escribir. specLies controla si el
 * reintento informado escribe (1) o sigue mintiendo (0).
 */
const makeLyingSpecsSpawn = (seen: string[], cwd: string, specLies: number) =>
	(async (prompt: string) => {
		seen.push(prompt);
		if (prompt.includes("return ONLY a JSON object")) {
			return { stories: [{ id: "E1-S1", title: "Exportar CSV" }] };
		}
		if (prompt.includes("## Story to spec")) {
			const id = prompt.match(/## Story to spec\n(E\d+-S\d+)/)?.[1] ?? "?";
			const esReintento = prompt.includes("Tu intento anterior NO escribió");
			if (esReintento && specLies >= 1) {
				writeArtifact(cwd, `spec-${id}.md`);
				return `spec ${id} lista (reintento honesto)`;
			}
			return `spec ${id} lista`; // mentira: no escribe
		}
		if (prompt.includes("Business Analyst (Mary)")) {
			writeArtifact(cwd, "product-brief.md");
			return "brief.md listo";
		}
		if (prompt.includes("Product Manager (John)")) {
			writeArtifact(cwd, "prd.md");
			return "prd.md listo";
		}
		if (prompt.includes("Architect (Winston)")) {
			writeArtifact(cwd, "architecture.md");
			return "architecture.md listo";
		}
		if (prompt.includes("PM + Architect pairing")) {
			writeArtifact(cwd, "epics-and-stories.md");
			return "epics-and-stories.md listo";
		}
		return `echo: ${prompt.slice(0, 40)}`;
	}) as unknown as SpawnAgentFn;

describe("frida-aidd · hardening v2 (#68)", () => {
	it("resume idempotente: relanzar NO invoca agentes de stages resueltos NI pisa artefactos", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		// 1ª corrida: cadena completa + specs.
		await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r68a-1",
			spawnAgent: makeSpawn([], cwd),
			home,
			runId: randomUUID(),
			foreground: false,
		});
		// El usuario edita el PRD a mano entre corridas — su trabajo debe sobrevivir.
		const prdPath = join(cwd, "docs/aidd/planning/prd.md");
		writeFileSync(
			prdPath,
			"# PRD editado a mano por el usuario (sentinel #68)\n",
		);
		const specPath = join(cwd, "docs/aidd/planning/spec-E1-S1.md");
		const specSentinel = "sentinel-spec-68";
		writeFileSync(specPath, `${specSentinel}\n`);

		// 2ª corrida (mismo cwd): sólo el extractor corre; nada se re-escribe.
		const seen2: string[] = [];
		const r2 = (await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r68a-2",
			spawnAgent: makeSpawn(seen2, cwd),
			home,
			runId: randomUUID(),
			foreground: false,
		})) as unknown as { result: { summaries: Record<string, string> } };

		// Ningún agente de stage/spec corrió — sólo el extractor de historias.
		expect(
			seen2.filter(
				(p) =>
					p.includes("Business Analyst (Mary)") ||
					p.includes("Product Manager (John)") ||
					p.includes("Architect (Winston)") ||
					p.includes("PM + Architect pairing") ||
					p.includes("## Story to spec"),
			),
		).toHaveLength(0);
		expect(seen2.some((p) => p.includes("return ONLY a JSON object"))).toBe(true);
		// Los artefactos manualmente editados sobreviven intactos.
		expect(readFileSync(prdPath, "utf8")).toContain("sentinel #68");
		expect(readFileSync(specPath, "utf8")).toBe(`${specSentinel}\n`);
		// Los summaries reportan preservación.
		expect(r2.result.summaries.prd).toContain("preservado");
	}, 30000);

	it("spec mentirosa 1 vez: el reintento informado la escribe y el run completa", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const seen: string[] = [];

		const { result } = await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r68b",
			spawnAgent: makeLyingSpecsSpawn(seen, cwd, 1),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = result as { stories: string[]; specs: Record<string, string> };
		expect(r.stories).toEqual(["E1-S1"]);
		expect(r.specs["E1-S1"]).toContain("reintento honesto");
		expect(existsSync(join(cwd, "docs/aidd/planning/spec-E1-S1.md"))).toBe(true);
		// El reintento recibió la evidencia de la falla.
		const retryPrompt = seen.find(
			(p) => p.includes("## Story to spec") && p.includes("NO escribió"),
		);
		expect(retryPrompt).toContain("spec-E1-S1.md");
	}, 30000);

	it("specs mentirosas persistentes: failed con expediente (faltantes + ls)", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const seen: string[] = [];

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r68c",
			spawnAgent: makeLyingSpecsSpawn(seen, cwd, 0),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const err = await promise.then(() => "").catch((e: Error) => e.message);
		expect(err).toMatch(/specs fantasma[\s\S]*E1-S1/);
		expect(err).toContain("$ ls -la");
		// Cap estricto: 2 intentos por spec (inicial + reintento), ni uno más.
		const specPrompts = seen.filter((p) => p.includes("## Story to spec"));
		expect(specPrompts).toHaveLength(2);
	}, 30000);
});

/**
 * Spawner del caso #73 (agente silencioso): simula el fallo real del
 * 2026-08-18 — el gateway DevEngine devolvía 500 y el agente hijo terminaba
 * SIN texto ni tool calls (abort.log: stopReason=error, hadText=false). El
 * runner normaliza eso a null; el expediente debe DIAGNOSTICARLO, no
 * mostrar líneas vacías.
 */
const makeSilentPrdSpawn = (seen: string[], cwd: string) =>
	(async (prompt: string) => {
		seen.push(prompt);
		if (prompt.includes("return ONLY a JSON object")) {
			return { stories: [{ id: "E1-S1", title: "Exportar CSV" }] };
		}
		if (prompt.includes("## Story to spec")) {
			const id = prompt.match(/## Story to spec\n(E\d+-S\d+)/)?.[1] ?? "?";
			writeArtifact(cwd, `spec-${id}.md`);
			return `spec ${id} escrita`;
		}
		if (prompt.includes("Business Analyst (Mary)")) {
			writeArtifact(cwd, "product-brief.md");
			return "brief.md listo";
		}
		if (prompt.includes("Product Manager (John)")) {
			return null; // provider 500: el agente muere sin texto (run 8fb037a7)
		}
		if (prompt.includes("Architect (Winston)")) {
			writeArtifact(cwd, "architecture.md");
			return "architecture.md listo";
		}
		if (prompt.includes("PM + Architect pairing")) {
			writeArtifact(cwd, "epics-and-stories.md");
			return "epics-and-stories.md listo";
		}
		return `echo: ${prompt.slice(0, 40)}`;
	}) as unknown as SpawnAgentFn;

describe("frida-aidd · expediente con agente silencioso (#73)", () => {
	it("prd silencioso (provider 500): el expediente DIAGNOSTICA el silencio, no líneas vacías", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const seen: string[] = [];

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r73a",
			spawnAgent: makeSilentPrdSpawn(seen, cwd),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		await expect(promise).rejects.toThrow(/tras 2 intentos/);
		const err = await promise.catch((e: Error) => e.message);
		// Intento 1 y 2 SIN texto → diagnóstico del silencio, no cadenas vacías.
		expect(err).toMatch(/Intento 1: \(agente terminó SIN texto/);
		expect(err).toMatch(/Intento 2: \(agente terminó SIN texto/);
		// El reintento informado también recibió la evidencia del silencio.
		const retryPrompt = seen.find((p) => p.includes("FALLA ANTERIOR"));
		expect(retryPrompt).toContain("SIN texto");
		// Cap de 1 reintento: exactamente 2 intentos del stage prd.
		const prdPrompts = seen.filter((p) => p.includes("Product Manager (John)"));
		expect(prdPrompts).toHaveLength(2);
	}, 30000);
});

describe("frida-aidd · status.yaml de avance del plan (#78)", () => {
	const readStatusYaml = () =>
		fs.readFileSync(join(cwd, "docs/aidd/planning/status.yaml"), "utf-8");

	it("run completo: completed con stages done/attempts y specs done", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const seen: string[] = [];

		await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r78a",
			spawnAgent: makeLyingPrdSpawn(seen, cwd, 1),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const yaml = readStatusYaml();
		// Raíz completada.
		expect(yaml).toContain("status: completed");
		// Cada stage done con su artefacto; prd necesitó reintento (attempts: 2).
		expect(yaml).toMatch(
			/product-brief:\s*\n\s+status: done\s*\n\s+artifact: product-brief\.md/,
		);
		expect(yaml).toMatch(
			/prd:\s*\n\s+status: done\s*\n\s+artifact: prd\.md\s*\n\s+attempts: 2/,
		);
		expect(yaml).toMatch(
			/epics-and-stories:\s*\n\s+status: done/,
		);
		// Spec del fan-out.
		expect(yaml).toMatch(/E1-S1:\s*\n\s+status: done\s*\n\s+artifact: spec-E1-S1\.md/);
	}, 30000);

	it("resume idempotente: stages preserved, specs preserved, sin agentes de stage", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		// Run 1 completo.
		await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r78b",
			spawnAgent: makeLyingPrdSpawn([], cwd, 99),
			home,
			runId: randomUUID(),
			foreground: false,
		});
		// Run 2 (resume): todo preservado, ningún agente de stage.
		const seen2: string[] = [];
		await runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r78b2",
			spawnAgent: makeLyingPrdSpawn(seen2, cwd, 99),
			home,
			runId: randomUUID(),
			foreground: false,
		});
		const yaml = readStatusYaml();
		expect(yaml).toContain("status: completed");
		expect(yaml).toMatch(
			/product-brief:\s*\n\s+status: preserved/,
		);
		expect(yaml).toMatch(/prd:\s*\n\s+status: preserved/);
		expect(yaml).toMatch(/E1-S1:\s*\n\s+status: preserved/);
		// Los agentes de stage NO corrieron (solo el extractor de historias).
		expect(
			seen2.filter((p) => p.includes("Business Analyst (Mary)")).length,
		).toBe(0);
	}, 30000);

	it("fallo persistente: failed con failedStage; stages previos quedan done", async () => {
		const script = AIDD_PLAN_PATTERN.resolve(
			{ idea: "reportes", review: "auto" },
			{ cwd },
		);
		const seen: string[] = [];

		const promise = runWorkflowInStore({
			name: "aidd-plan",
			script,
			args: { idea: "reportes", review: "auto" },
			cwd,
			sessionId: "sess-r78c",
			spawnAgent: makeLyingPrdSpawn(seen, cwd, 0),
			home,
			runId: randomUUID(),
			foreground: false,
		});
		await expect(promise).rejects.toThrow(/tras 2 intentos/);

		const yaml = readStatusYaml();
		expect(yaml).toContain("status: failed");
		expect(yaml).toContain("failedStage: prd");
		// brief SÍ quedó done (never-regress del avance logrado).
		expect(yaml).toMatch(/product-brief:\s*\n\s+status: done/);
	}, 30000);
});
