// features.test.ts — dominio del pipeline N1 (features.json).
// Molde: test/frida-workflow/board.test.ts (fixture tmp + mkdtemp; atomicidad).
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PIPELINE_STAGES,
	STAGE_BUCKET,
	advanceFeature,
	computeFeatureReconcile,
	featureAdvanceCommand,
	featuresFilePath,
	findFeature,
	loadFeatures,
	nextStage,
	reconcileFeatures,
	saveFeatures,
	setFeaturePaused,
	shipBadge,
	shipFeature,
	stageIndex,
	subscribeFeaturesChanges,
	type FeaturesFile,
	type PipelineFeature,
} from "../../src/tools/frida-workflow/features";
import {
	applyStageTransition,
	DEFAULT_BOARD_COLUMNS,
	loadBoard,
	saveBoard,
	subscribeBoardChanges,
} from "../../src/tools/frida-workflow/board";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "features-test-"));
});

afterEach(() => {
	vi.restoreAllMocks();
});

function sampleFeature(
	overrides: Partial<PipelineFeature> = {},
): PipelineFeature {
	return {
		id: ".frida/artifacts/discover/2026-08-31_07-08-47_mi-feature.md",
		stage: "discover",
		history: [],
		...overrides,
	};
}

describe("features — persistencia atómica (espejo board)", () => {
	it("loadFeatures devuelve null si features.json no existe", () => {
		expect(loadFeatures(tmp)).toBeNull();
	});

	it("saveFeatures crea el directorio pipeline/ y persiste con v=1", () => {
		const state: FeaturesFile = {
			v: 1,
			features: [sampleFeature()],
			updatedAt: "",
			source: "test",
		};
		saveFeatures(tmp, state);
		const file = featuresFilePath(tmp);
		expect(existsSync(file)).toBe(true);
		const round = loadFeatures(tmp);
		expect(round).not.toBeNull();
		expect(round!.v).toBe(1);
		expect(round!.features).toHaveLength(1);
		expect(round!.features[0]!.id).toBe(sampleFeature().id);
		expect(round!.updatedAt).not.toBe("");
	});

	it("saveFeatures no deja archivos .tmp huérfanos", () => {
		const state: FeaturesFile = { v: 1, features: [], updatedAt: "" };
		saveFeatures(tmp, state);
		saveFeatures(tmp, state);
		const dir = path.dirname(featuresFilePath(tmp));
		const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
		expect(leftovers).toEqual([]);
	});

	it("loadFeatures degrada a vacío ante JSON corrupto (NFR reliability)", () => {
		const file = featuresFilePath(tmp);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, "{ esto no es json", "utf8");
		expect(loadFeatures(tmp)).toBeNull();
	});

	it("loadFeatures normaliza v ausente y features no-array", () => {
		const file = featuresFilePath(tmp);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify({ features: {} }), "utf8");
		const loaded = loadFeatures(tmp);
		expect(loaded).not.toBeNull();
		expect(loaded!.v).toBe(1);
		expect(loaded!.features).toEqual([]);
	});

	it("findFeature resuelve por id canónico", () => {
		const state: FeaturesFile = {
			v: 1,
			features: [sampleFeature()],
			updatedAt: "",
		};
		expect(findFeature(state, sampleFeature().id)?.stage).toBe("discover");
		expect(findFeature(state, "otra")).toBeUndefined();
	});
});

describe("features — listeners (overlay vivo)", () => {
	it("saveFeatures emite el cambio a los suscritos", () => {
		const fn = vi.fn();
		const off = subscribeFeaturesChanges(fn);
		saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
		expect(fn).toHaveBeenCalledTimes(1);
		off();
		saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
		expect(fn).toHaveBeenCalledTimes(1); // desuscrito: no vuelve a disparar
	});

	it("un listener que lanza no bloquea a los demás", () => {
		const broken = vi.fn(() => {
			throw new Error("roto");
		});
		const ok = vi.fn();
		subscribeFeaturesChanges(broken);
		const off = subscribeFeaturesChanges(ok);
		saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
		expect(ok).toHaveBeenCalledTimes(1);
		off();
	});
});

describe("features — etapas", () => {
	it("PIPELINE_STAGES tiene las 5 columnas del FRD en orden", () => {
		expect([...PIPELINE_STAGES]).toEqual([
			"discover",
			"research",
			"design",
			"plan",
			"ready-to-ship",
		]);
	});

	it("STAGE_BUCKET mapea a los buckets plurales de los skills bundled", () => {
		expect(STAGE_BUCKET).toEqual({
			discover: "discover",
			research: "research",
			design: "designs",
			plan: "plans",
		});
	});

	it("nextStage avanza y termina en ready-to-ship", () => {
		expect(nextStage("discover")).toBe("research");
		expect(nextStage("research")).toBe("design");
		expect(nextStage("design")).toBe("plan");
		expect(nextStage("plan")).toBe("ready-to-ship");
		expect(nextStage("ready-to-ship")).toBeUndefined();
		expect(stageIndex("ready-to-ship")).toBe(4);
	});
});

// ── Reconciler (Slice 2) ────────────────────────────────────────────────────

/** Escribe un artefacto .md con frontmatter bajo tmp (ruta relativa con `/`). */
function writeArtifact(
	rel: string,
	frontmatter: Record<string, string> = {},
): string {
	const abs = path.join(tmp, ...rel.split("/"));
	mkdirSync(path.dirname(abs), { recursive: true });
	const fm = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
	writeFileSync(abs, `---\n${fm}\n---\n\n# doc\n`, "utf8");
	return abs;
}

/** Fuerza el mtime (orden determinista entre candidatos). */
function setMtime(abs: string, ms: number): void {
	const d = new Date(ms);
	utimesSync(abs, d, d);
}

const FRD = ".frida/artifacts/discover/2026-01-01_10-00-00_mi-feature.md";

describe("reconciler — auto-adopción (FR#3/D4)", () => {
	it("adopta un FRD nuevo como feature en discover con source reconciler", () => {
		writeArtifact(FRD, { status: "ready" });
		const r = reconcileFeatures(tmp);
		expect(r.adopted).toEqual([FRD]);
		const state = loadFeatures(tmp)!;
		expect(state.features).toHaveLength(1);
		expect(state.features[0]!.stage).toBe("discover");
		expect(state.features[0]!.title).toBe("mi-feature");
		expect(state.features[0]!.history).toEqual([
			{ to: "discover", ts: expect.any(String), source: "reconciler" },
		]);
		expect(state.source).toBe("reconciler");
	});

	it("adopta FRDs del seed .rpiv (slug de fecha sola) con id de la raíz", () => {
		const seed = ".rpiv/artifacts/discover/2025-07-31_porte-rpiv.md";
		writeArtifact(seed, { status: "ready" });
		const r = reconcileFeatures(tmp);
		expect(r.adopted).toEqual([seed]);
		expect(loadFeatures(tmp)!.features[0]!.title).toBe("porte-rpiv");
	});

	it("workspace vacío: no escribe features.json y changed=false (NFR arranque)", () => {
		const r = reconcileFeatures(tmp);
		expect(r.changed).toBe(false);
		expect(existsSync(featuresFilePath(tmp))).toBe(false);
	});

	it("re-scan idéntico no duplica ni re-escribe (lección #1: dedup por id)", () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		const r2 = reconcileFeatures(tmp);
		expect(r2.adopted).toEqual([]);
		expect(r2.changed).toBe(false);
		const state = loadFeatures(tmp)!;
		expect(state.features).toHaveLength(1);
		expect(state.features[0]!.history).toHaveLength(1);
	});

	it("md sin frontmatter no rompe el escaneo (parent undefined, topic del nombre)", () => {
		const abs = path.join(tmp, ...FRD.split("/"));
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, "sin frontmatter\n", "utf8");
		expect(() => reconcileFeatures(tmp)).not.toThrow();
		expect(loadFeatures(tmp)!.features[0]!.title).toBe("mi-feature");
	});
});

describe("reconciler — vinculación híbrida parent+topic (D6)", () => {
	it("encadena por parent explícito (research ← frd; design ← research)", () => {
		const RESEARCH =
			".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
		const DESIGN = ".frida/artifacts/designs/2026-01-03_10-00-00_mi-feature.md";
		writeArtifact(FRD);
		writeArtifact(RESEARCH, { parent: FRD });
		// parent con comillas estilo YAML: el parser las pela
		writeArtifact(DESIGN, { parent: `"${RESEARCH}"` });
		reconcileFeatures(tmp);
		const f = loadFeatures(tmp)!.features[0]!;
		expect(f.stage).toBe("design"); // adopción: etapa derivada del más avanzado
		expect(f.artifacts).toEqual({ research: RESEARCH, design: DESIGN });
	});

	it("fallback por topic cuando no hay parent (seed histórico)", () => {
		const RESEARCH = ".rpiv/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
		writeArtifact(FRD);
		writeArtifact(RESEARCH); // sin parent
		reconcileFeatures(tmp);
		expect(loadFeatures(tmp)!.features[0]!.artifacts?.research).toBe(RESEARCH);
	});

	it("topic distinto no vincula (sin colisiones del fallback)", () => {
		writeArtifact(FRD);
		writeArtifact(".frida/artifacts/research/2026-01-02_10-00-00_otra-cosa.md");
		reconcileFeatures(tmp);
		expect(loadFeatures(tmp)!.features[0]!.artifacts?.research).toBeUndefined();
	});

	it("entre candidatos empatados gana el mtime más reciente", () => {
		writeArtifact(FRD);
		const a = writeArtifact(
			".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md",
			{ parent: FRD },
		);
		const b = writeArtifact(
			".frida/artifacts/research/2026-01-02_11-00-00_mi-feature.md",
			{ parent: FRD },
		);
		setMtime(a, 1_000);
		setMtime(b, 2_000);
		reconcileFeatures(tmp);
		expect(loadFeatures(tmp)!.features[0]!.artifacts?.research).toContain(
			"11-00-00",
		);
	});

	it("cadena completa frd→research→design→plan adopta en plan (techo manual)", () => {
		const RESEARCH =
			".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
		const DESIGN = ".frida/artifacts/designs/2026-01-03_10-00-00_mi-feature.md";
		const PLAN = ".frida/artifacts/plans/2026-01-04_10-00-00_mi-feature.md";
		writeArtifact(FRD);
		writeArtifact(RESEARCH, { parent: FRD });
		writeArtifact(DESIGN, { parent: RESEARCH });
		writeArtifact(PLAN, { parent: DESIGN, phase_count: "8" });
		reconcileFeatures(tmp);
		const f = loadFeatures(tmp)!.features[0]!;
		expect(f.stage).toBe("plan");
		expect(f.artifacts?.plan).toBe(PLAN);
	});
});

describe("reconciler — desync y relink (FR#12)", () => {
	it("desync true cuando el FS va más adelante que features.json", () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp); // adopta en discover
		writeArtifact(".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md", {
			parent: FRD,
		});
		expect(computeFeatureReconcile(tmp)).toEqual([
			{ id: FRD, derivedStage: "research", desync: true },
		]);
	});

	it("computeFeatureReconcile es puro: cero escrituras (snapshot del monitor)", () => {
		writeArtifact(FRD);
		computeFeatureReconcile(tmp);
		expect(existsSync(featuresFilePath(tmp))).toBe(false);
	});

	it("early-move (etapa por delante del artefacto) NO es desync", () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		const state = loadFeatures(tmp)!;
		state.features[0]!.stage = "research"; // simula el ▶ (Slice 3)
		saveFeatures(tmp, state);
		expect(computeFeatureReconcile(tmp)[0]!.desync).toBe(false);
	});

	it("relink actualiza artifacts sin adelantar la etapa, y es idempotente", () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		writeArtifact(".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md", {
			parent: FRD,
		});
		const r1 = reconcileFeatures(tmp);
		expect(r1.relinked).toEqual([FRD]);
		const f1 = loadFeatures(tmp)!.features[0]!;
		expect(f1.artifacts?.research).toBeDefined();
		expect(f1.stage).toBe("discover"); // relink NO adelanta
		expect(r1.report[0]!.desync).toBe(true); // el ámbar cubre el hueco
		const r2 = reconcileFeatures(tmp);
		expect(r2.relinked).toEqual([]);
		expect(r2.changed).toBe(false);
	});

	it("feature en ready-to-ship nunca marca desync (ship manual, FR#5)", () => {
		writeArtifact(FRD);
		writeArtifact(".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md", {
			parent: FRD,
		});
		reconcileFeatures(tmp);
		const state = loadFeatures(tmp)!;
		state.features[0]!.stage = "ready-to-ship";
		saveFeatures(tmp, state);
		expect(computeFeatureReconcile(tmp)[0]!.desync).toBe(false);
	});

	it("FRD desaparecido: la feature sobrevive sin desync (histórico)", () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		rmSync(path.join(tmp, ...FRD.split("/")));
		expect(computeFeatureReconcile(tmp)).toEqual([
			{ id: FRD, derivedStage: undefined, desync: false },
		]);
	});
});

// ── Acciones (Slice 3) ──────────────────────────────────────────────────────

const RESEARCH_REL =
	".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
const DESIGN_REL = ".frida/artifacts/designs/2026-01-03_10-00-00_mi-feature.md";
const PLAN_REL = ".frida/artifacts/plans/2026-01-04_10-00-00_mi-feature.md";

/** FRD→research→design→plan encadenados por parent (adopta en plan). */
function seedFullChain(): void {
	writeArtifact(FRD);
	writeArtifact(RESEARCH_REL, { parent: FRD });
	writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
	writeArtifact(PLAN_REL, { parent: DESIGN_REL });
}

/** Plan con fases `## FN` reales (syncUnitsFromPlan sólo parsea headers). */
function writePlan(rel: string, parent: string, titles: string[]): void {
	const abs = writeArtifact(rel, { parent });
	const body = titles.map((t, i) => `## F0${i + 1} — ${t}`).join("\n");
	writeFileSync(abs, `---\nparent: ${parent}\n---\n\n${body}\n`, "utf8");
}

describe("acciones — advanceFeature (FR#4 movimiento temprano)", () => {
	it("avanza una etapa, registra history con el escritor y emite el cambio", () => {
		writeArtifact(FRD);
		saveFeatures(tmp, {
			v: 1,
			features: [sampleFeature({ id: FRD })],
			updatedAt: "",
		});
		const fn = vi.fn();
		const off = subscribeFeaturesChanges(fn);
		const r = advanceFeature(tmp, FRD, "pipeline-ui");
		off();
		expect(r.moved).toBe(true);
		expect(r.to).toBe("research");
		expect(r.prerequisitesMet).toBe(true); // el FRD existe
		expect(r.command).toBe(`/skill:research ${FRD}`); // FR#4: pre-move
		expect(fn).toHaveBeenCalledTimes(1);
		const f = loadFeatures(tmp)!.features[0]!;
		expect(f.stage).toBe("research");
		expect(f.history).toEqual([
			{ to: "research", ts: expect.any(String), source: "pipeline-ui" },
		]);
	});

	it("feature inexistente: moved false y NO crea features.json", () => {
		const r = advanceFeature(tmp, "no-existe.md");
		expect(r.moved).toBe(false);
		expect(existsSync(featuresFilePath(tmp))).toBe(false);
	});

	it("en plan NO avanza: el gesto terminal es el ship (FR#5)", () => {
		seedFullChain();
		reconcileFeatures(tmp); // adopta en plan
		const r = advanceFeature(tmp, FRD);
		expect(r.moved).toBe(false);
		expect(loadFeatures(tmp)!.features[0]!.stage).toBe("plan");
		expect(loadFeatures(tmp)!.features[0]!.history).toHaveLength(1);
	});

	it("prerequisitesMet false cuando el insumo falta (FR#14) pero MUEVE igual", () => {
		saveFeatures(tmp, {
			v: 1,
			features: [sampleFeature({ id: FRD, stage: "research" })], // sin research real
			updatedAt: "",
		});
		const r = advanceFeature(tmp, FRD);
		expect(r.moved).toBe(true);
		expect(r.to).toBe("design");
		expect(r.prerequisitesMet).toBe(false);
		expect(r.command).toBe(`/skill:design ${FRD}`);
	});

	it("featureAdvanceCommand arma /skill:<etapa> <frd> sin mover (FR#4/FR#13)", () => {
		expect(featureAdvanceCommand(sampleFeature({ id: FRD }))).toBe(
			`/skill:research ${FRD}`,
		);
		expect(
			featureAdvanceCommand(sampleFeature({ id: FRD, stage: "plan" })),
		).toBeUndefined();
		expect(
			featureAdvanceCommand(sampleFeature({ id: FRD, stage: "ready-to-ship" })),
		).toBeUndefined();
	});
});

describe("acciones — shipFeature (FR#5)", () => {
	it("crea unidades backlog del plan SIN transiciones (cero ejecución)", () => {
		writeArtifact(FRD);
		writeArtifact(RESEARCH_REL, { parent: FRD });
		writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
		writePlan(PLAN_REL, DESIGN_REL, ["alpha", "beta", "gamma"]);
		reconcileFeatures(tmp); // adopta en plan con artifacts.plan
		const r = shipFeature(tmp, FRD, "pipeline-ui");
		expect(r.moved).toBe(true);
		expect(r.phaseCount).toBe(3);
		expect(r.planPath).toBe(PLAN_REL);
		const f = loadFeatures(tmp)!.features[0]!;
		expect(f.stage).toBe("ready-to-ship");
		expect(f.planPath).toBe(PLAN_REL);
		expect(f.shippedAt).toEqual(expect.any(String));
		// Board N2: fases en backlog, columnas default (espejo /board sin spec)
		const board = loadBoard(tmp, PLAN_REL)!;
		expect(board.columns).toEqual([...DEFAULT_BOARD_COLUMNS]);
		expect(board.units).toHaveLength(3);
		for (const u of board.units) {
			expect(u.status).toBe("backlog");
			expect(u.transitions).toEqual([]); // FR#5: sin ejecutar nada
		}
	});

	it("emite el cambio del board (overlay N2 vivo)", () => {
		writeArtifact(FRD);
		writeArtifact(RESEARCH_REL, { parent: FRD });
		writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
		writePlan(PLAN_REL, DESIGN_REL, ["alpha"]);
		reconcileFeatures(tmp);
		const fn = vi.fn();
		const off = subscribeBoardChanges(fn);
		const r = shipFeature(tmp, FRD);
		off();
		expect(r.moved).toBe(true);
		expect(fn).toHaveBeenCalled();
	});

	it("sin plan enlazado: failure no-plan y features.json intacto", () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp); // adopta en discover, sin artifacts.plan
		const r = shipFeature(tmp, FRD);
		expect(r.moved).toBe(false);
		expect(r.failure).toBe("no-plan");
		const f = loadFeatures(tmp)!.features[0]!;
		expect(f.stage).toBe("discover");
		expect(f.shippedAt).toBeUndefined();
		expect(f.history).toHaveLength(1);
	});

	it("re-ship en ready-to-ship: already-shipped, idempotente", () => {
		writeArtifact(FRD);
		writeArtifact(RESEARCH_REL, { parent: FRD });
		writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
		writePlan(PLAN_REL, DESIGN_REL, ["alpha", "beta"]);
		reconcileFeatures(tmp);
		shipFeature(tmp, FRD);
		const r = shipFeature(tmp, FRD);
		expect(r.moved).toBe(false);
		expect(r.failure).toBe("already-shipped");
		expect(loadBoard(tmp, PLAN_REL)!.units).toHaveLength(2);
		expect(loadFeatures(tmp)!.features[0]!.history).toHaveLength(2);
	});

	it("feature inexistente: failure missing", () => {
		expect(shipFeature(tmp, "no-existe.md")).toEqual({
			moved: false,
			failure: "missing",
			phaseCount: 0,
		});
	});
});

describe("acciones — setFeaturePaused (FR#11)", () => {
	it("persiste el flag y emite el cambio", () => {
		writeArtifact(FRD);
		saveFeatures(tmp, {
			v: 1,
			features: [sampleFeature({ id: FRD })],
			updatedAt: "",
		});
		const fn = vi.fn();
		const off = subscribeFeaturesChanges(fn);
		const f = setFeaturePaused(tmp, FRD, true, "monitor");
		off();
		expect(f?.paused).toBe(true);
		expect(loadFeatures(tmp)!.features[0]!.paused).toBe(true);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("feature inexistente: undefined sin crear features.json", () => {
		expect(setFeaturePaused(tmp, "no-existe.md", true)).toBeUndefined();
		expect(existsSync(featuresFilePath(tmp))).toBe(false);
	});
});

describe("badge — shipBadge (FR#6)", () => {
	it("n/m fases done del board N2 (raíces; jerarquía splits vía isUnitDone)", () => {
		writeArtifact(FRD);
		writeArtifact(RESEARCH_REL, { parent: FRD });
		writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
		writePlan(PLAN_REL, DESIGN_REL, ["alpha", "beta", "gamma"]);
		reconcileFeatures(tmp);
		shipFeature(tmp, FRD);
		// Fase F01 commiteada (transición real del lifecycle N2)
		const board = loadBoard(tmp, PLAN_REL)!;
		applyStageTransition(board, "F01", {
			stage: "commit",
			runId: "t1",
			ts: "t1",
		});
		saveBoard(tmp, PLAN_REL, board);
		const f = loadFeatures(tmp)!.features[0]!;
		expect(shipBadge(tmp, f)).toEqual({ done: 1, total: 3 });
	});

	it("undefined sin planPath o sin board (feature no shipped)", () => {
		expect(shipBadge(tmp, sampleFeature())).toBeUndefined();
		expect(
			shipBadge(
				tmp,
				sampleFeature({ planPath: ".frida/artifacts/plans/nada.md" }),
			),
		).toBeUndefined();
	});
});
