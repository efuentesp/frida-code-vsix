// frida-understand-app — integración end-to-end del patrón sobre el motor
// real (runWorkflowInStore). Issue #134, M1 Pista M.
//
// Mock spawner por anclas (molde test/frida-app-walkthrough/e2e.test.ts):
// los agentes se enrutan por bloques runtime VERBATIM del script generado
// (Slice 2 del design 2026-08-24_20-01-44): overview ("## Capacidades
// detectadas"), scout ("## Área asignada"), escritor ("## Tu documento") y
// juez ("## Entregables a auditar"). Scouts y escritores ESCRIBEN archivos
// reales (#83: el mentiroso no pasa; mocks honestos, lesson bffd6f1/30ef616)
// y nada pre-crea lo que el workflow garantiza (mkdir/inventario propios).
//
// El juez mock deriva su decisión del contexto de corte del propio prompt
// (contrato observado): stoppedBy="budget"|"time" → CONCERNS documentando el
// gap (regla known-gap→CONCERNS del Slice 2); sin corte → opts.judgeDecision
// ?? "PASS" (el caso negativo del issue #134 devuelve FAIL con findings
// citando entendimiento.md §Qn).
//
// Bajo HOME aislado la sonda del pack (os.homedir() lee $HOME) deja
// CAPABILITIES={lens:false, codebaseIndex:false}: la corrida ejercita la
// degradación determinista D5 del bootstrap, el hint accionable del runtime
// block del overview y el veredicto "EL MOAT SE QUEDÓ CORTO" (D10).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import { resolveCheckpoint } from "../../src/tools/frida-extensible-workflows/frida-delivery";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { UNDERSTAND_APP_PATTERN } from "../../src/tools/frida-understand-app";

const REAL_HOME = process.env.HOME;
const REAL_PATH = process.env.PATH;

/** Entregables del understand-app (relativos al cwd de la corrida). */
const DOC = "docs/entendimiento";

let home: string;
let cwd: string;
let binDir: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "ua-e2e-home-"));
	cwd = mkdtempSync(join(tmpdir(), "ua-e2e-cwd-"));
	binDir = join(cwd, ".mock-bin");
	mkdirSync(binDir, { recursive: true });
	// HOME aislado también aisla la sonda del pack (os.homedir() lee $HOME):
	// CAPABILITIES={"lens":false,"codebaseIndex":false} en todos los tests.
	process.env.HOME = home;
	// El sandbox hereda el env del proceso (execution.ts): el date falsificado
	// del test de wall-clock gana al real en PATH.
	process.env.PATH = binDir + ":" + REAL_PATH;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	if (REAL_PATH) process.env.PATH = REAL_PATH;
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

/** date falsificado (molde M8): cada epoch avanza +30 s (contador en disco);
 *  el formato largo (%Y…) responde fecha fija determinista. */
const FAKE_DATE_MOCK = `#!/usr/bin/env bash
D="$(cd "$(dirname "$0")" && pwd)"
case "$*" in
 *%Y*)
  printf '2026-08-24 12:00:00 +0000\\n'
  ;;
 *)
  n=0
  if [ -f "$D/date.n" ]; then n=$(cat "$D/date.n"); fi
  n=$((n + 1))
  printf '%s' "$n" > "$D/date.n"
  printf '%s\\n' $((1750000000 + n * 30))
  ;;
esac
`;

function writeFakeDate(): void {
	writeFileSync(join(binDir, "date"), FAKE_DATE_MOCK, "utf-8");
	chmodSync(join(binDir, "date"), 0o755);
}

/** Escribe un artefacto real en el cwd de la corrida (contrato #83: los
 * mocks escriben archivos reales como los agentes con file tools). */
function writeArtifact(base: string, rel: string, content = "# doc\n"): void {
	const p = join(base, rel);
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, content, "utf-8");
}

interface SpawnOptions {
	/** Escritor que NUNCA escribe (claim sin archivo, incluso al reintentar). */
	liarDoc?: string;
	/** Escritor que solo escribe en el reintento (ancla FALLA ANTERIOR). */
	flakyDoc?: string;
	/** Área cuyo scout solo escribe en el reintento (rama de scouts). */
	flakyScout?: string;
	/** Decisión del juez cuando NO hay corte (default "PASS"). */
	judgeDecision?: "PASS" | "CONCERNS" | "FAIL";
}

/**
 * Spawner mock por anclas de runtime context (molde M8/tea): el overview
 * devuelve el mapa con 3 áreas priorizadas; los scouts y escritores ESCRIBEN
 * archivos reales; el juez deriva del contexto de corte. `seen` captura los
 * prompts para assertar el contrato (hint D5, reintentos informados).
 */
const makeSpawn = (
	opts: SpawnOptions = {},
	seen: string[] = [],
	artifactsCwd: string = cwd,
) =>
	(async (prompt: string) => {
		seen.push(prompt);
		// Overview — ancla: bloque "## Capacidades detectadas".
		if (prompt.includes("## Capacidades detectadas")) {
			return {
				components: [
					{
						name: "API HTTP",
						kind: "service",
						path: "src/api",
						purpose: "endpoints REST",
						entryPoints: ["src/api/server.ts"],
						hubs: ["src/api/router.ts"],
					},
					{
						name: "Core de dominio",
						kind: "module",
						path: "src/core",
						purpose: "reglas de negocio",
						entryPoints: [],
						hubs: [],
					},
				],
				languages: ["TypeScript"],
				frameworks: ["Express"],
				areas: [
					{
						name: "Autenticación",
						why: "login y sesiones dispersos",
						priority: 1,
						hints: ["src/auth"],
					},
					{
						name: "Pagos",
						why: "llamadas al servicio de pagos sin trazar",
						priority: 2,
						hints: ["src/payments"],
					},
					{
						name: "API y base de datos",
						why: "flujo endpoint→BD sin documentar",
						priority: 3,
						hints: ["src/api", "src/db"],
					},
				],
				toolsUsed: ["project_report", "semantic_search"],
				degradations: [],
				indexStatus: "modo guía: sin pin",
				embeddingsProvider: "",
				summary: "2 componentes, 3 áreas propuestas",
			};
		}
		// Scout — ancla: bloque "## Área asignada".
		if (prompt.includes("## Área asignada")) {
			const area = prompt.match(/"name": "([^"]+)"/)?.[1] ?? "";
			const report =
				prompt.match(/Ruta EXACTA donde escribir tus hallazgos: (\S+)/)?.[1] ?? "";
			const isRetry = prompt.includes("FALLA ANTERIOR");
			const findings: Record<string, { summary: string; risks: string[] }> = {
				Autenticación: {
					summary: "3 hallazgos: login, middleware de sesión, expiración",
					risks: ["sesiones sin expiración"],
				},
				Pagos: {
					summary: "2 hallazgos: pasarela y webhooks",
					risks: ["webhook sin verificación de firma"],
				},
				"API y base de datos": {
					summary: "2 hallazgos: repositorio directo en handlers",
					risks: ["N+1 en listados"],
				},
			};
			const f = findings[area] ?? { summary: "sin hallazgos", risks: [] };
			if (opts.flakyScout === area && !isRetry) {
				return {
					summary: "primera pasada vacía",
					findingsCount: 0,
					keyRisks: [],
					unanswered: [area],
					toolsUsed: [],
					degradations: [],
				};
			}
			writeArtifact(
				artifactsCwd,
				report,
				"# " + area + "\n\nHallazgos con evidencia file:line.\n",
			);
			return {
				summary: f.summary,
				findingsCount: 3,
				keyRisks: f.risks,
				unanswered: [],
				toolsUsed: ["semantic_search", "call_graph"],
				degradations: [],
			};
		}
		// Escritor — ancla: bloque "## Tu documento".
		if (prompt.includes("## Tu documento")) {
			const file = prompt.match(/Ruta EXACTA donde escribirlo: (\S+)/)?.[1] ?? "";
			const isRetry = prompt.includes("FALLA ANTERIOR");
			if (opts.liarDoc && file === opts.liarDoc) {
				return { doc: file, sections: ["claim"], summary: "claim sin archivo" };
			}
			if (opts.flakyDoc && file === opts.flakyDoc && !isRetry) {
				return { doc: file, sections: ["falla"], summary: "primera pasada vacía" };
			}
			const content = file.endsWith(".c4")
				? "model {\n  component api {\n  }\n}\n"
				: "# " + file + "\n\nEscrito por el escritor mock.\n";
			writeArtifact(artifactsCwd, file, content);
			const base = {
				doc: file,
				sections: ["resumen"],
				summary: file + " escrito",
			};
			if (file.endsWith("entendimiento.md")) {
				// El escritor de entendimiento sincroniza la rúbrica (mergeQuestions).
				return {
					...base,
					questions: [
						{ id: "Q1", status: "answered", evidence: ["src/auth/login.ts:42"] },
						{
							id: "Q2",
							status: "answered",
							evidence: ["src/payments/checkout.ts:18"],
						},
						{ id: "Q3", status: "answered", evidence: ["src/auth/middleware.ts:9"] },
						{ id: "Q4", status: "answered", evidence: ["src/api/contracts.ts:77"] },
						{ id: "Q5", status: "answered", evidence: ["src/api/users.ts:31"] },
						{
							id: "Q6",
							status: "partial",
							evidence: ["src/payments/checkout.ts:18"],
						},
						{ id: "Q7", status: "sin-evidencia", evidence: [] },
					],
				};
			}
			return base;
		}
		// Juez — ancla: bloque "## Entregables a auditar".
		if (prompt.includes("## Entregables a auditar")) {
			// Contrato observado: el contexto de corte viaja en el prompt. Un corte
			// por presupuesto/tiempo es gap CONOCIDO → CONCERNS documentado, no FAIL.
			const cut = prompt.match(/stoppedBy="(budget|time)"/);
			if (cut) {
				return {
					decision: "CONCERNS",
					findings: [
						{
							severity: "MEDIUM",
							evidence:
								"gap documentado: corrida cortada por " +
								cut[1] +
								" (stoppedBy del inventario)",
							fix: "relanzar con presupuesto mayor para cubrir lo faltante",
						},
					],
					summary: "corte conocido",
				};
			}
			if (opts.judgeDecision === "FAIL") {
				return {
					decision: "FAIL",
					findings: [
						{
							severity: "CRITICAL",
							evidence:
								"docs/entendimiento/entendimiento.md §Q3 responde 'middleware' sin evidencia file:line real",
							fix: "citar file:line verificable o marcar 'sin evidencia suficiente'",
						},
					],
					summary: "claim falsa",
				};
			}
			return {
				decision: opts.judgeDecision ?? "PASS",
				findings: [],
				summary: "auditoría mock",
			};
		}
		return "echo: " + prompt.slice(0, 40);
	}) as unknown as SpawnAgentFn;

// ── Tipos del inventario/return leídos del disco (contrato del Slice 2) ────

interface InventoryComponent {
	id: string;
	name: string;
	kind: string;
	path: string;
	purpose: string;
	entryPoints: string[];
	hubs: string[];
}

interface InventoryHotspot {
	id: string;
	name: string;
	why: string;
	priority: number;
	report: string;
	status: string;
	summary: string;
	keyRisks: string[];
	unanswered: string[];
}

interface InventoryTool {
	name: string;
	extension: string;
	available: boolean;
	usedCount: number;
	phases: string[];
	degraded: boolean;
}

interface InventoryQuestion {
	id: string;
	question: string;
	status: string;
	evidence: string[];
}

interface Inventory {
	run: {
		pattern: string;
		language: string;
		maxHotspots: number;
		maxMinutes: number;
		review: string;
	};
	capabilities: {
		lensAvailable: boolean;
		codebaseIndexAvailable: boolean;
		indexPresent: boolean;
		indexStatus: string;
		embeddingsProvider: string;
	};
	tools: InventoryTool[];
	degradations: Array<{
		phase: string;
		tool: string;
		reason: string;
		workaround: string;
		evidence: string;
	}>;
	components: InventoryComponent[];
	languages: string[];
	frameworks: string[];
	hotspots: InventoryHotspot[];
	questions: InventoryQuestion[];
	stoppedBy: string;
	stoppedByTime: boolean;
}

interface UaResult {
	pattern: string;
	components: number;
	hotspots: number;
	questions: {
		answered: number;
		partial: number;
		"sin-evidencia": number;
	};
	degradations: number;
	stoppedBy: string;
	stoppedByTime: boolean;
	docs: Record<string, string>;
	judge: {
		decision: string;
		findings: Array<{ severity: string; evidence: string; fix: string }>;
		summary: string;
	};
}

function readInv(base: string): Inventory {
	return JSON.parse(
		readFileSync(join(base, DOC, "artifacts/inventory.json"), "utf-8"),
	) as Inventory;
}

function docPath(base: string, rel: string): string {
	return join(base, DOC, rel);
}

/** SAFETY: el return del workflow es el objeto del contrato del Slice 2
 *  (pattern/components/hotspots/questions/…/judge) — lo produce el propio
 *  script del patrón; el cast sólo cruza la frontera JsonValue del journal. */
function asResult(value: unknown): UaResult {
	return value as UaResult;
}

describe("frida-understand-app · e2e sobre el motor (#134)", () => {
	it("recorrido feliz: overview → 3 scouts → 3 escritores → síntesis determinista e inventario auditable", async () => {
		const args = { maxHotspots: 5, review: "auto" };
		const script = UNDERSTAND_APP_PATTERN.resolve(args, { cwd });
		const seen: string[] = [];

		const { result } = await runWorkflowInStore({
			name: "understand-app",
			script,
			args,
			cwd,
			sessionId: "sess-ua-1",
			spawnAgent: makeSpawn({}, seen),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = asResult(result);
		expect(r.pattern).toBe("understand-app");
		expect(r.components).toBe(2);
		expect(r.hotspots).toBe(3);
		expect(r.stoppedBy).toBe("");
		expect(r.stoppedByTime).toBe(false);
		expect(r.judge.decision).toBe("PASS");
		expect(r.questions).toEqual({
			answered: 5,
			partial: 1,
			"sin-evidencia": 1,
		});
		// Degradación determinista D5 del bootstrap (CAPABILITIES false/false).
		expect(r.degradations).toBe(1);

		// Entregables en disco (ninguno pre-creado por el test).
		for (const rel of [
			"README.md",
			"entendimiento.md",
			"mapa-riesgos.md",
			"m4-m5-veredicto.md",
			"likec4/modelo.c4",
			"artifacts/inventory.json",
			"artifacts/hotspots/H01-autenticacion.md",
			"artifacts/hotspots/H02-pagos.md",
			"artifacts/hotspots/H03-api-y-base-de-datos.md",
		]) {
			expect(existsSync(docPath(cwd, rel)), rel).toBe(true);
		}

		const inv = readInv(cwd);
		expect(inv.components.map((c) => c.id)).toEqual(["C01", "C02"]);
		expect(inv.hotspots.map((h) => h.id)).toEqual(["H01", "H02", "H03"]);
		expect(inv.hotspots[0].report).toBe(
			DOC + "/artifacts/hotspots/H01-autenticacion.md",
		);
		// Sonda híbrida bajo HOME aislado (D6): moat ausente, índice ausente.
		expect(inv.capabilities).toMatchObject({
			lensAvailable: false,
			codebaseIndexAvailable: false,
			indexPresent: false,
		});
		expect(inv.degradations[0]).toMatchObject({
			phase: "bootstrap",
			tool: "index_codebase",
		});
		expect(inv.tools.find((t) => t.name === "index_codebase")?.degraded).toBe(
			true,
		);
		// Hint accionable D5 en el runtime block del overview (primer spawn).
		expect(seen[0]).toContain(
			"Hint accionable: frida-codebase-index NO disponible",
		);
		// Registro de uso por fase (overview usó lens; scouts acumularon índice).
		const pr = inv.tools.find((t) => t.name === "project_report");
		expect(pr?.usedCount).toBe(1);
		expect(pr?.phases).toEqual(["overview"]);
		const ss = inv.tools.find((t) => t.name === "semantic_search");
		expect(ss?.usedCount).toBe(4); // 1 overview + 3 scouts
		expect(ss?.phases).toEqual(["overview", "hotspots"]);
		// Rúbrica sincronizada desde el escritor de entendimiento (D10).
		expect(inv.questions[0]).toMatchObject({ id: "Q1", status: "answered" });
		expect(inv.questions[0].evidence).toEqual(["src/auth/login.ts:42"]);
		expect(inv.questions[6]).toMatchObject({ id: "Q7", status: "sin-evidencia" });

		// README y veredicto sintetizados desde el MISMO inventario (D10).
		const readme = readFileSync(docPath(cwd, "README.md"), "utf-8");
		expect(readme).toContain("| H01 |");
		expect(readme).toContain("5 answered");
		const veredicto = readFileSync(docPath(cwd, "m4-m5-veredicto.md"), "utf-8");
		expect(veredicto).toContain("EL MOAT SE QUEDÓ CORTO");
	}, 45000);

	it("corta por presupuesto (maxHotspots=1): stoppedBy=budget, checkpoint manual, juez CONCERNS", async () => {
		const args = { maxHotspots: 1, review: "manual" };
		const script = UNDERSTAND_APP_PATTERN.resolve(args, { cwd });
		const checkpoints: Array<{ name: string }> = [];
		const runId = randomUUID();

		const promise = runWorkflowInStore({
			name: "understand-app",
			script,
			args,
			cwd,
			sessionId: "sess-ua-2",
			spawnAgent: makeSpawn(),
			home,
			runId,
			foreground: false,
			onCheckpoint: (cp) => checkpoints.push({ name: cp.name }),
		});

		await waitUntil(() => checkpoints.length >= 1);
		expect(checkpoints[0].name).toBe("understand-app-final");
		resolveCheckpoint(runId, "understand-app-final", true);

		const { result } = await promise;
		const r = asResult(result);
		expect(r.hotspots).toBe(1);
		expect(r.stoppedBy).toBe("budget");
		expect(r.stoppedByTime).toBe(false);
		// Gap CONOCIDO → CONCERNS documentado, no FAIL (R8).
		expect(r.judge.decision).toBe("CONCERNS");

		const inv = readInv(cwd);
		expect(inv.run.maxHotspots).toBe(1);
		expect(inv.hotspots.map((h) => h.id)).toEqual(["H01"]); // prioridad 1 gana
		// El corte NO aborta: escritores y síntesis corren sobre lo alcanzado.
		expect(existsSync(docPath(cwd, "README.md"))).toBe(true);
		expect(existsSync(docPath(cwd, "mapa-riesgos.md"))).toBe(true);
	}, 30000);

	it("corta por wall-clock (maxMinutes=1) marcando stoppedByTime; writers/juez siguen", async () => {
		writeFakeDate(); // +30 s por epoch: deadline vence justo antes del fanout
		const args = { maxHotspots: 0, maxMinutes: 1, review: "auto" };
		const script = UNDERSTAND_APP_PATTERN.resolve(args, { cwd });

		const { result } = await runWorkflowInStore({
			name: "understand-app",
			script,
			args,
			cwd,
			sessionId: "sess-ua-3",
			spawnAgent: makeSpawn(),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		const r = asResult(result);
		expect(r.stoppedBy).toBe("time");
		expect(r.stoppedByTime).toBe(true);
		expect(r.components).toBe(2); // el overview sí alcanzó a correr
		expect(r.hotspots).toBe(0); // el fanout de scouts se saltó
		// El corte por tiempo NO aborta: analyze/synthesize/judge corren igual.
		expect(existsSync(docPath(cwd, "README.md"))).toBe(true);
		expect(existsSync(docPath(cwd, "entendimiento.md"))).toBe(true);
		expect(r.judge.decision).toBe("CONCERNS"); // gap conocido
		expect(readInv(cwd).stoppedByTime).toBe(true);
	}, 30000);

	it("escritor mentiroso: gate test -s falla el run tras el reintento informado (#83 redux)", async () => {
		const args = { maxHotspots: 2, review: "auto" };
		const script = UNDERSTAND_APP_PATTERN.resolve(args, { cwd });
		const seen: string[] = [];

		const promise = runWorkflowInStore({
			name: "understand-app",
			script,
			args,
			cwd,
			sessionId: "sess-ua-4",
			spawnAgent: makeSpawn({ liarDoc: DOC + "/mapa-riesgos.md" }, seen),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		await expect(promise).rejects.toThrow(/NO escribieron/);
		// El reintento informado corrió UNA vez antes de fallar (lesson 619d9e7).
		expect(
			seen.some(
				(p) => p.includes("FALLA ANTERIOR") && p.includes("mapa-riesgos.md"),
			),
		).toBe(true);
		expect(existsSync(docPath(cwd, "mapa-riesgos.md"))).toBe(false);
	}, 30000);

	it("scout flaky: el reintento informado del fanout rescata la corrida", async () => {
		const args = { maxHotspots: 0, review: "auto" };
		const script = UNDERSTAND_APP_PATTERN.resolve(args, { cwd });

		const { result } = await runWorkflowInStore({
			name: "understand-app",
			script,
			args,
			cwd,
			sessionId: "sess-ua-5",
			spawnAgent: makeSpawn({ flakyScout: "Pagos" }),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		expect(existsSync(docPath(cwd, "artifacts/hotspots/H02-pagos.md"))).toBe(
			true,
		);
		const r = asResult(result);
		expect(r.hotspots).toBe(3); // los 3 scouts documentados tras el reintento
		expect(r.judge.decision).toBe("PASS");
	}, 30000);

	it("escritor flaky: el reintento informado de writers rescata la corrida", async () => {
		// maxHotspots 0 = sin tope → sin corte presupuestario → stoppedBy="" →
		// la rama judgeDecision del mock decide (no la rama cut/CONCERNS).
		const args = { maxHotspots: 0, review: "auto" };
		const script = UNDERSTAND_APP_PATTERN.resolve(args, { cwd });

		const { result } = await runWorkflowInStore({
			name: "understand-app",
			script,
			args,
			cwd,
			sessionId: "sess-ua-6",
			spawnAgent: makeSpawn({ flakyDoc: DOC + "/likec4/modelo.c4" }),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		expect(existsSync(docPath(cwd, "likec4/modelo.c4"))).toBe(true);
		const r = asResult(result);
		expect(r.judge.decision).toBe("PASS");
	}, 30000);

	it("caso negativo del juez: FAIL con findings citando entendimiento.md §Qn (criterio #134)", async () => {
		// Sin corte presupuestario (0 = todo): la rama judgeDecision="FAIL" del
		// mock decide — el contexto de corte interpola stoppedBy="" y no matchea.
		const args = { maxHotspots: 0, review: "auto" };
		const script = UNDERSTAND_APP_PATTERN.resolve(args, { cwd });

		const { result } = await runWorkflowInStore({
			name: "understand-app",
			script,
			args,
			cwd,
			sessionId: "sess-ua-7",
			spawnAgent: makeSpawn({ judgeDecision: "FAIL" }),
			home,
			runId: randomUUID(),
			foreground: false,
		});

		// El FAIL del juez NO aborta: el veredicto viaja en el return (R8).
		const r = asResult(result);
		expect(r.judge.decision).toBe("FAIL");
		expect(r.judge.findings[0].severity).toBe("CRITICAL");
		expect(r.judge.findings[0].evidence).toMatch(/entendimiento\.md §Q\d/);
	}, 30000);

	it("inventario determinista: dos corridas idénticas → hotspots deep-equal", async () => {
		const runOnce = async () => {
			const runCwd = mkdtempSync(join(tmpdir(), "ua-e2e-det-"));
			const args = { maxHotspots: 0, review: "auto" };
			const script = UNDERSTAND_APP_PATTERN.resolve(args, { cwd: runCwd });
			await runWorkflowInStore({
				name: "understand-app",
				script,
				args,
				cwd: runCwd,
				sessionId: "sess-ua-det",
				spawnAgent: makeSpawn({}, [], runCwd),
				home,
				runId: randomUUID(),
				foreground: false,
			});
			const inv = readInv(runCwd);
			rmSync(runCwd, { recursive: true, force: true });
			return inv;
		};
		const first = await runOnce();
		const second = await runOnce();
		// IDs, reports relativos, summaries y riesgos estables entre corridas.
		expect(second.hotspots).toEqual(first.hotspots);
		expect(second.questions.map((q) => q.status)).toEqual(
			first.questions.map((q) => q.status),
		);
	}, 45000);
});

/** waitUntil mínimo sin importar el helper del suite de workflows (molde M8). */
async function waitUntil(cond: () => boolean, ms = 10000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error("timeout esperando condición");
		await new Promise((res) => setTimeout(res, 20));
	}
}
