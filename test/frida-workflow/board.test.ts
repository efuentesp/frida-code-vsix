// board.test.ts — #159/#160/#161: núcleo del board jerárquico (contratos,
// splits, primer hueco, bootstrap, blindaje multi-escritor).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defineRoute } from "../../src/tools/frida-workflow";
import {
	applyStageTransition,
	depsSatisfied,
	deriveBoardSpec,
	boardChildren,
	boardFilePath,
	bootstrapBoardFromRuns,
	dedupeBoard,
	firstRealGap,
	isUnitDone,
	loadBoard,
	openBoard,
	resolveNextStepWithBoard,
	saveBoard,
	setSkillContracts,
	restartUnit,
	sortArtifactsChronologically,
	syncUnitsFromPlan,
	validateFails,
	pendingDeps,
	type Board,
} from "../../src/tools/frida-workflow/board";
import {
	appendPhaseProgress,
	progressFilePath,
	normalizePhaseId,
	readCompletedPhases,
} from "../../src/tools/frida-workflow/plan-utils";
import {
	extractContractArtifactKind,
	scanSkillContracts,
} from "../../src/tools/frida-workflow/skill-contracts";

const PLAN = ".frida/artifacts/plans/plan-board.md";
const PLAN5 = [
	"# Plan",
	"## F10c.1 — Identidad",
	"## F10c.2 — Snapshot",
	"## F10c.3 — Saga",
	"## F10c.4 — Estrategias",
	"## F10c.5 — Wizard",
].join("\n");

let tmp: string;
beforeAll(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "board-test-"));
	fs.mkdirSync(path.join(tmp, ".frida", "artifacts", "plans"), {
		recursive: true,
	});
	fs.writeFileSync(path.join(tmp, PLAN), PLAN5);
});

beforeEach(() => {
	setSkillContracts({}); // estado módulo limpio entre tests
});

describe("board — sync jerárquico con splits (#160)", () => {
	it("fases raíz del plan → unidades origin plan; ids descendientes → split", () => {
		const board = openBoard(tmp, PLAN, PLAN5);
		expect(board.v).toBe(1); // #161 — schema version
		expect(board.units.map((u) => u.id)).toEqual([
			"F10c.1",
			"F10c.2",
			"F10c.3",
			"F10c.4",
			"F10c.5",
		]);
		expect(board.units.every((u) => u.origin === "plan")).toBe(true);

		// Un skill parte F10c.3: añade sub-fases al plan → re-sync las cuelga.
		const split = `${PLAN5}\n## F10c.3.1 — Saga paso A\n## F10c.3.2 — Saga paso B\n`;
		syncUnitsFromPlan(board, split);
		const children = boardChildren(board, "F10c.3");
		expect(children.map((c) => c.id)).toEqual(["F10c.3.1", "F10c.3.2"]);
		expect(children.every((c) => c.origin === "split")).toBe(true);
		expect(children.every((c) => c.parentId === "F10c.3")).toBe(true);
	});

	it("unidades que desaparecen del plan se conservan (histórico)", () => {
		const board = openBoard(tmp, PLAN, PLAN5);
		const ids = board.units.map((u) => u.id);
		syncUnitsFromPlan(board, "# Plan\n## F10c.9 — Nueva\n");
		expect(board.units.map((u) => u.id)).toEqual([...ids, "F10c.9"]);
	});
});

describe("board — transiciones con contratos (#159)", () => {
	it("avanza por columnas; validate FAIL no avanza; no retrocede; idempotente", () => {
		const board = openBoard(tmp, PLAN, PLAN5);
		const t = (stage: string, passed?: boolean) =>
			applyStageTransition(board, "F10c.1", {
				stage,
				runId: "r1",
				ts: "2026-08-30T10:00:00Z",
				passed,
				source: "sdd-ship", // #161
			});

		expect(t("elaborate")?.status).toBe("elaborada");
		t("implement");
		expect(board.units[0]!.status).toBe("implementada");
		// #171 — validate SIN verdict (inicio de etapa): avanza temprano a validada
		// (sincronía con el panel que muestra la etapa en curso).
		t("validate");
		expect(board.units[0]!.status).toBe("validada");
		t("validate", false); // FAIL explícito: rebota a implementada
		expect(board.units[0]!.status).toBe("implementada");
		t("validate", true);
		expect(board.units[0]!.status).toBe("validada");
		t("commit");
		expect(board.units[0]!.status).toBe("commiteada");
		t("implement"); // ya done — no retrocede
		expect(board.units[0]!.status).toBe("commiteada");

		const last = board.units[0]!.transitions.at(-1)!;
		expect(last.source).toBe("sdd-ship"); // #161 — trazabilidad
		expect(last.artifactKind).toBe("git-commit"); // default del vocabulario
	});

	it("artifactKind: config > contrato SKILL.md > default", () => {
		setSkillContracts({ validate: "validation-v2" }); // contrato registrado
		const board = openBoard(tmp, PLAN, PLAN5);
		applyStageTransition(board, "F10c.2", {
			stage: "validate",
			runId: "r",
			ts: "t",
			passed: true,
		});
		expect(board.units[1]!.transitions.at(-1)!.artifactKind).toBe(
			"validation-v2",
		);

		// El spec del workflow gana sobre el contrato — en una unidad FRESCA
		// (tras validate ya no puede aplicarse implement: no retrocede).
		applyStageTransition(board, "F10c.4", {
			stage: "implement",
			runId: "r",
			ts: "t",
			spec: { stageKinds: { implement: "mutation-custom" } },
		});
		expect(
			board.units.find((u) => u.id === "F10c.4")!.transitions.at(-1)!.artifactKind,
		).toBe("mutation-custom");
	});

	it("stageColumns del spec reasigna la columna destino", () => {
		const spec = {
			columns: ["todo", "haciendo", "hecho"],
			doneColumn: "hecho",
			stageColumns: { implement: "haciendo", commit: "hecho" },
		};
		const board = openBoard(tmp, PLAN, PLAN5, spec);
		applyStageTransition(board, "F10c.3", {
			stage: "implement",
			runId: "r",
			ts: "t",
			spec,
		});
		expect(board.units.find((u) => u.id === "F10c.3")!.status).toBe("haciendo");
		// Sin spec, el default "implementada" NO existe en este board → no-op seguro.
		applyStageTransition(board, "F10c.4", {
			stage: "implement",
			runId: "r",
			ts: "t",
		});
		expect(board.units.find((u) => u.id === "F10c.4")!.status).toBe("todo");
	});
});

describe("board — cierre jerárquico y primer hueco (#160)", () => {
	it("padre done sólo si TODAS sus hojas done; gap DFS sugiere la hoja pendiente", () => {
		const split = `${PLAN5}\n## F10c.3.1 — A\n## F10c.3.2 — B\n`;
		const board = openBoard(tmp, PLAN, split);
		const t = (id: string, stages: string[]) => {
			for (const stage of stages) {
				applyStageTransition(board, id, {
					stage,
					runId: "r",
					ts: "t",
					passed: true,
				});
			}
		};
		t("F10c.1", ["commit"]);
		t("F10c.2", ["commit"]);
		t("F10c.3.1", ["commit"]);

		const father = board.units.find((u) => u.id === "F10c.3")!;
		expect(isUnitDone(board, father)).toBe(false); // 3.2 pendiente
		expect(firstRealGap(board)?.id).toBe("F10c.3.2"); // DFS: la hoja, no F10c.4

		t("F10c.3.2", ["commit"]);
		expect(isUnitDone(board, father)).toBe(true);
		expect(firstRealGap(board)?.id).toBe("F10c.4"); // sigue tras el padre cerrado
	});
});

describe("skill-contracts — vocabulario desde SKILL.md (#159)", () => {
	it("extrae produces.meta.artifactKind de frontmatter reales", () => {
		const elaborate = `---\nname: elaborate\ncontract:\n  produces:\n    kind: produces\n    meta:\n      artifactKind: elaboration\n  consumes:\n    meta:\n      artifactKind: [plan]\n---\n# Elaborate\n`;
		expect(extractContractArtifactKind(elaborate)).toBe("elaboration");

		const validate = `---\ncontract:\n  produces:\n    kind: produces\n    meta:\n      artifactKind: validation\n---\n`;
		expect(extractContractArtifactKind(validate)).toBe("validation");

		const commit = `---\ncontract:\n  produces:\n    kind: side-effect\n    meta:\n      effect: git-commit\n---\n`;
		expect(extractContractArtifactKind(commit)).toBeUndefined(); // effect, no artifactKind
	});

	it("scanSkillContracts escanea un agentDir y registra skill⇒kind", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentdir-"));
		for (const [skill, kind] of [
			["elaborate", "elaboration"],
			["validate", "validation"],
		] as const) {
			fs.mkdirSync(path.join(agentDir, "skills", skill), { recursive: true });
			fs.writeFileSync(
				path.join(agentDir, "skills", skill, "SKILL.md"),
				`---\ncontract:\n  produces:\n    kind: produces\n    meta:\n      artifactKind: ${kind}\n---\n`,
			);
		}
		expect(scanSkillContracts(agentDir)).toEqual({
			elaborate: "elaboration",
			validate: "validation",
		});
	});
});

describe("board — bootstrap desde runs + blindaje multi-escritor (#161)", () => {
	it("bootstrapBoardFromRuns: transiciones con artefactos reales + migración progress", () => {
		const runsDir = path.join(tmp, "runs-b");
		fs.mkdirSync(runsDir, { recursive: true });
		const rows = [
			{
				type: "workflow",
				runId: "run-1",
				input: `"${PLAN} Phase F10c.2"`,
				ts: "t",
			},
			{ type: "stage", runId: "run-1", stage: "elaborate", status: "completed" },
			{
				type: "stage",
				runId: "run-1",
				stage: "validate",
				status: "completed",
				output: {
					data: { passed: true },
					artifacts: [{ handle: { path: "/abs/validation.md" }, role: "primary" }],
				},
			},
			{ type: "stage", runId: "run-1", stage: "commit", status: "completed" },
		];
		fs.writeFileSync(
			path.join(runsDir, "run-1.jsonl"),
			rows.map((r) => JSON.stringify(r)).join("\n"),
		);

		bootstrapBoardFromRuns(runsDir, tmp);
		const board = loadBoard(tmp, PLAN)!;
		expect(board).not.toBeNull();
		const u2 = board.units.find((u) => u.id === "F10c.2")!;
		expect(u2.status).toBe("commiteada");
		const val = u2.transitions.find((t) => t.stage === "validate")!;
		expect(val.artifacts?.[0]?.path).toBe("/abs/validation.md"); // vínculo explícito
	});

	it("migración progress: ids normalizados matchean la unidad canónica (sin duplicados)", () => {
		// Regresión real de SELE-DEV: readCompletedPhases devuelve "f10c1" (sin
		// punto) y la migración creaba unidades fantasma en vez de commitear F10c.1.
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-mig-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp2, PLAN), PLAN5);
		// F10c.1 SÓLO en progress (su run JSONL ya no existe) — como SELE-DEV.
		appendPhaseProgress(
			tmp2,
			PLAN,
			"F10c.1",
			"593930d-manual",
			"2026-08-30T16:05:00Z",
		);

		bootstrapBoardFromRuns(path.join(tmp2, "runs-inexistentes"), tmp2);
		// El bootstrap sin JSONLs no procesa nada: la migración vive en el loop de
		// runs. Verificamos la misma vía que usa el runtime: openBoard + migración
		// explícita vía applyStageTransition con id canónico resuelto.
		const board = openBoard(tmp2, PLAN, PLAN5);
		const doneIds = readCompletedPhases(tmp2, PLAN);
		expect(doneIds).toContain("f10c1"); // normalizado, sin punto
		for (const doneId of doneIds) {
			const canonical =
				board.units.find((u) => normalizePhaseId(u.id) === doneId)?.id ?? doneId;
			applyStageTransition(board, canonical, {
				stage: "commit",
				runId: "progress-158",
				ts: "migrated",
			});
		}
		expect(board.units.find((u) => u.id === "F10c.1")!.status).toBe("commiteada");
		expect(board.units.some((u) => u.id === "f10c1")).toBe(false); // sin fantasma
	});

	it("blindaje: v persistida, carga normaliza v ausente, escritura sin .tmp residual", () => {
		const board = openBoard(tmp, PLAN, PLAN5);
		saveBoard(tmp, PLAN, board);
		expect(board.v).toBe(1);

		// Board viejo sin v → loadBoard lo normaliza a 1.
		const file = boardFilePath(tmp, PLAN);
		const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Board;
		delete (raw as { v?: number }).v;
		fs.writeFileSync(file, JSON.stringify(raw));
		expect(loadBoard(tmp, PLAN)!.v).toBe(1);

		saveBoard(tmp, PLAN, board);
		const dirFiles = fs.readdirSync(path.dirname(file));
		expect(dirFiles.filter((f) => f.endsWith(".tmp"))).toEqual([]); // atómico limpio
	});
});

// ── #163 — Tablero-vivo: columnas derivadas, zigzag y remap ──────────────────
describe("board — tablero-vivo (#163)", () => {
	const SDD_SHIP = {
		name: "sdd-ship",
		stages: {
			elaborate: {},
			implement: {},
			validate: {},
			commit: {},
		},
		edges: {
			elaborate: "implement",
			implement: "validate",
			validate: defineRoute(["commit", "implement", "stop"], () => "stop"),
			commit: "stop",
		},
	};

	it("deriveBoardSpec: columnas = backlog + stages; validateRegress del route", () => {
		const spec = deriveBoardSpec(SDD_SHIP);
		expect(spec.columns).toEqual([
			"backlog",
			"elaborate",
			"implement",
			"validate",
			"commit",
		]);
		expect(spec.doneColumn).toBe("commit");
		expect(spec.stageColumns?.validate).toBe("validate"); // identidad
		expect(spec.validateRegress).toBe("implement"); // targets: commit/stop fuera
	});

	it("zigzag: validate FAIL registra ciclo y REGRESA si estaba más adelante", () => {
		const spec = deriveBoardSpec(SDD_SHIP);
		let tmp2: string;
		tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-zigzag-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp2, PLAN), PLAN5);
		const board = openBoard(tmp2, PLAN, PLAN5, spec);
		const t = (stage: string, passed?: boolean) =>
			applyStageTransition(board, "F10c.1", {
				stage,
				runId: "r",
				ts: "t",
				passed,
				spec,
			});

		t("elaborate");
		t("implement");
		t("validate", false); // 1er FAIL: estaba en implement → ciclo sin regreso
		expect(board.units[0]!.status).toBe("implement");
		expect(validateFails(board.units[0]!)).toBe(1);

		t("implement");
		t("validate", true); // PASS → validada
		expect(board.units[0]!.status).toBe("validate");
		t("validate", false); // re-validación fallida → REGRESA a implement
		expect(board.units[0]!.status).toBe("implement");
		expect(validateFails(board.units[0]!)).toBe(2);
		const last = board.units[0]!.transitions.at(-1)!;
		expect(last.failed).toBe(true);
		expect(last.regress).toBe(true);

		t("implement");
		t("validate", true);
		t("commit");
		expect(board.units[0]!.status).toBe("commit"); // done
	});

	it("remap: board persistido con columnas default migra a las derivadas", () => {
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-remap-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp2, PLAN), PLAN5);
		// Board con columnas default y una fase commiteada (estado pre-#163).
		const old = openBoard(tmp2, PLAN, PLAN5);
		applyStageTransition(old, "F10c.1", { stage: "commit", runId: "r", ts: "t" });
		saveBoard(tmp2, PLAN, old);
		expect(loadBoard(tmp2, PLAN)!.units[0]!.status).toBe("commiteada");

		// Al abrir con el spec derivado de sdd-ship, el status remapea.
		const spec = deriveBoardSpec(SDD_SHIP);
		const remapped = openBoard(tmp2, PLAN, PLAN5, spec);
		const u = remapped.units.find((x) => x.id === "F10c.1")!;
		expect(u.status).toBe("commit"); // commiteada → commit
		expect(isUnitDone(remapped, u)).toBe(true);
	});
});

// ── #166 — Boards de roadmap: sync del plan desactivable ─────────────────────
describe("board — disablePlanSync (#166)", () => {
	it("un board de roadmap NO gana unidades del sync de headers del plan", () => {
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-nosync-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		// Plan maestro: headers AGRUPADOS (F0..F6–F8) ≠ unidades del roadmap (F01..F17).
		const maestro = [
			"# Plan maestro",
			"## F0 — Cimientos",
			"## F1 — Núcleo",
			"## F6–F8 — Migración y salida",
			"| F01 | … | F17 | tabla de vista general |",
		].join("\n");
		fs.writeFileSync(path.join(tmp2, PLAN), maestro);

		// Board de roadmap con unidades manuales y sync desactivado.
		const board = openBoard(tmp2, PLAN, maestro);
		board.disablePlanSync = true;
		board.units = [
			{
				id: "F01",
				title: "Fundación",
				origin: "plan",
				status: "backlog",
				transitions: [],
			},
			{
				id: "F17",
				title: "Cutover",
				origin: "plan",
				status: "backlog",
				transitions: [],
			},
		];
		saveBoard(tmp2, PLAN, board);

		// Re-abrir CON planContent (lo que hacen /board y el bootstrap): los
		// headers F0/F1/F6 NO deben colarse como unidades.
		const reopened = openBoard(tmp2, PLAN, maestro);
		expect(reopened.units.map((u) => u.id)).toEqual(["F01", "F17"]);
	});
});

// ── #171 — Sincronía tablero↔panel: movimiento TEMPRANO al iniciar etapa ─────
describe("board — desfase tablero/panel (#171)", () => {
	it("el inicio de una etapa mueve la tarjeta aunque no haya terminado (passed undefined)", () => {
		const spec = {
			columns: ["backlog", "elaborate", "implement", "validate", "commit"],
			stageColumns: {
				elaborate: "elaborate",
				implement: "implement",
				validate: "validate",
				commit: "commit",
			},
			doneColumn: "commit",
			validateRegress: "implement",
		};
		// tmp FRESCO: el board compartido de `tmp` arrastra estados de tests
		// previos (F10c.2 commiteada) y el movimiento temprano sería no-op.
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-desfase-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp2, PLAN), PLAN5);
		const board = openBoard(tmp2, PLAN, PLAN5, spec);
		// El workflow muestra "ejecutando implement" (onStageStart, sin output):
		const unit = applyStageTransition(board, "F10c.2", {
			stage: "implement",
			runId: "r",
			ts: "t",
			spec,
		});
		expect(unit?.status).toBe("implement"); // la tarjeta YA está en implement
	});
});

// ── #172 — Breaker trip: la tarjeta se queda en validate con marca blocked ───
describe("board — breaker trip (#172)", () => {
	it("3er FAIL con breakerTrip deja la tarjeta en VALIDATE + blocked (no rebota)", () => {
		const spec = {
			columns: ["backlog", "elaborate", "implement", "validate", "commit"],
			stageColumns: {
				elaborate: "elaborate",
				implement: "implement",
				validate: "validate",
				commit: "commit",
			},
			doneColumn: "commit",
			validateRegress: "implement",
		};
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-breaker-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp2, PLAN), PLAN5);
		const board = openBoard(tmp2, PLAN, PLAN5, spec);
		const t = (stage: string, passed?: boolean, breakerTrip?: boolean) =>
			applyStageTransition(board, "F10c.1", {
				stage,
				runId: "r",
				ts: "t",
				passed,
				breakerTrip,
				spec,
			});

		t("elaborate");
		t("implement");
		// Ciclos 1 y 2: rebote implement↔validate (zigzag normal).
		t("validate", false);
		expect(board.units[0]!.status).toBe("implement");
		t("implement");
		t("validate", false);
		expect(board.units[0]!.status).toBe("implement");
		// Ciclo 3 (breaker): la tarjeta SE QUEDA en validate, donde falló.
		t("validate", false, true);
		expect(board.units[0]!.status).toBe("validate");
		const last = board.units[0]!.transitions.at(-1)!;
		expect(last.failed).toBe(true);
		expect(last.blocked).toBe(true);
		expect(last.regress).toBeUndefined();
		expect(validateFails(board.units[0]!)).toBe(3); // badge de ciclos
	});
});

// ── #177 — Dependencias: gating del ▶ y paralelismo ─────────────────────────
describe("board — dependencias (#177)", () => {
	it("pendingDeps/depsSatisfied: bloquea hasta que TODAS las deps están done", () => {
		// tmp FRESCO: el board compartido arrastra estados de tests previos.
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-deps-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp2, PLAN), PLAN5);
		const board = openBoard(tmp2, PLAN, PLAN5);
		const u = board.units.find((x) => x.id === "F10c.4")!;
		u.deps = ["F10c.1", "F10c.2"];
		expect(pendingDeps(board, u)).toEqual(["F10c.1", "F10c.2"]);
		expect(depsSatisfied(board, u)).toBe(false);

		applyStageTransition(board, "F10c.1", {
			stage: "commit",
			runId: "r",
			ts: "t",
		});
		expect(pendingDeps(board, u)).toEqual(["F10c.2"]); // parcial

		applyStageTransition(board, "F10c.2", {
			stage: "commit",
			runId: "r",
			ts: "t",
		});
		expect(depsSatisfied(board, u)).toBe(true); // habilita el ▶
	});

	it("sin deps declaradas → satisfechas (item independiente, paralelo)", () => {
		const board = openBoard(tmp, PLAN, PLAN5);
		const u = board.units.find((x) => x.id === "F10c.5")!;
		expect(depsSatisfied(board, u)).toBe(true);
	});
});

// ── #179 — Reinicio de ciclo: relanzada tras breaker recorre el kanban otra vez
describe("board — restart de ciclo (#179)", () => {
	it("breaker (validate blocked) → restartUnit → backlog → elaborate AVANZA", () => {
		const spec = {
			columns: ["backlog", "elaborate", "implement", "validate", "commit"],
			stageColumns: {
				elaborate: "elaborate",
				implement: "implement",
				validate: "validate",
				commit: "commit",
			},
			doneColumn: "commit",
			validateRegress: "implement",
		};
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-restart-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp2, PLAN), PLAN5);
		const board = openBoard(tmp2, PLAN, PLAN5, spec);
		const t = (stage: string, passed?: boolean, breakerTrip?: boolean) =>
			applyStageTransition(board, "F10c.1", {
				stage,
				runId: "r1",
				ts: "t",
				passed,
				breakerTrip,
				spec,
			});

		// Ciclo 1 completo hasta el breaker: tarjeta queda en validate blocked.
		t("elaborate");
		t("implement");
		t("validate", false, true);
		expect(board.units[0]!.status).toBe("validate");
		expect(board.units[0]!.transitions.at(-1)!.blocked).toBe(true);

		// RELANZAMIENTO (nuevo run): onWorkflowStart → restartUnit.
		restartUnit(board, "F10c.1", { runId: "r2", ts: "t2", source: "sdd-ship" });
		expect(board.units[0]!.status).toBe("backlog"); // vuelve al inicio
		const last = board.units[0]!.transitions.at(-1)!;
		expect(last.stage).toBe("restart"); // badge de bloqueada despejado
		expect(last.blocked).toBeUndefined();

		// El nuevo ciclo avanza desde backlog: onStageStart(elaborate) mueve.
		t("elaborate");
		expect(board.units[0]!.status).toBe("elaborate"); // ¡se mueve!
		t("implement");
		expect(board.units[0]!.status).toBe("implement");
	});

	it("restartUnit sobre fase SIN transiciones (primer arranque) es no-op", () => {
		const board = openBoard(tmp, PLAN, PLAN5);
		const u = restartUnit(board, "F10c.5", { runId: "r", ts: "t" });
		expect(u?.status).toBe("backlog");
		expect(u?.transitions.length).toBe(0); // sin transición restart espuria
	});
});

// ── #181 — Orden cronológico de iconos + migración sin fantasmas ─────────────
describe("board — orden cronológico y migración (#181)", () => {
	it("sortArtifactsChronologically: elaboración → validación → commit", () => {
		const links = [
			{ kind: "git-commit", path: "" },
			{ kind: "elaboration", path: "e.md" },
			{ kind: "validation", path: "v.md" },
			{ kind: "desconocido", path: "x" },
		];
		expect(sortArtifactsChronologically(links).map((l) => l.kind)).toEqual([
			"elaboration",
			"validation",
			"git-commit",
			"desconocido",
		]);
	});

	it("migración: id normalizado sin unidad NI fase del plan → sin fantasma", () => {
		const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "board-fantasma-"));
		fs.mkdirSync(path.join(tmp2, ".frida", "artifacts", "plans"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(tmp2, PLAN), "# Plan\n## F01 — A\n## F02 — B\n");
		appendPhaseProgress(tmp2, PLAN, "F09", "r", "t"); // progress con fase ajena
		const runsDir = path.join(tmp2, "runs");
		fs.mkdirSync(runsDir, { recursive: true });
		fs.writeFileSync(
			path.join(runsDir, "run-x.jsonl"),
			[
				{
					type: "workflow",
					runId: "run-x",
					input: `"${PLAN} Phase F01"`,
					ts: "t",
				},
				{ type: "stage", runId: "run-x", stage: "commit", status: "completed" },
			]
				.map((r) => JSON.stringify(r))
				.join("\n"),
		);
		bootstrapBoardFromRuns(runsDir, tmp2);
		const board = loadBoard(tmp2, PLAN)!;
		// Las fases del plan (F01, F02 headers) SÍ se sincronizan — no son fantasmas.
		// El id normalizado ajeno (f09) NO debe aparecer como unidad.
		expect(board.units.map((u) => u.id)).toEqual(["F01", "F02"]);
		expect(board.units.some((u) => u.id === "f09")).toBe(false);
	});
});

// ── #185 — Deduplicación de transiciones (replay del bootstrap) ───────────────
describe("board — dedup de transiciones (#185)", () => {
	it("applyStageTransition no duplica la misma transición (run+stage+ts)", () => {
		const board = openBoard(tmp, PLAN, PLAN5);
		const input = {
			stage: "commit" as const,
			runId: "r1",
			ts: "t1",
			source: "bootstrap",
		};
		applyStageTransition(board, "F01", input);
		applyStageTransition(board, "F01", input); // replay
		applyStageTransition(board, "F01", input); // replay
		const u = board.units.find((x) => x.id === "F01")!;
		expect(u.transitions.filter((t) => t.stage === "commit").length).toBe(1);
	});

	it("dedupeBoard conserva una sola aparición de cada (runId, stage, ts)", () => {
		const board = openBoard(tmp, PLAN, PLAN5);
		applyStageTransition(board, "F01", {
			stage: "elaborate",
			runId: "r0",
			ts: "t0",
		}); // crea la unidad on-demand
		const u = board.units.find((x) => x.id === "F01")!;
		for (let i = 0; i < 5; i++) {
			u.transitions.push({
				to: "commit",
				stage: "validate",
				artifactKind: "validation",
				runId: "r1",
				ts: "t1",
			});
		}
		dedupeBoard(board);
		expect(u.transitions.filter((t) => t.runId === "r1").length).toBe(1);
		// La clave idéntica en OTRA unidad no se roba la transición
		applyStageTransition(board, "F02", {
			stage: "commit",
			runId: "r1",
			ts: "t1",
		});
		const u2 = board.units.find((x) => x.id === "F02")!;
		expect(u2.transitions.filter((t) => t.runId === "r1").length).toBe(1);
	});
});

// ── #193 — Escalera: board completo ⇒ plan completo (no «Avanzar a F0») ─────
describe("board — resolveNextStepWithBoard (#193)", () => {
	const PLAN_PDLE2 = ".frida/artifacts/plans/plan-pdle2-grupos.md";
	const PLAN_PDLE2_MD = [
		"# Plan dos niveles",
		"## F0 — Cimientos",
		"### F01 · Fundación reproducible",
		"### F02 · Perfilado de datos legado",
		"## F1 — Núcleo transversal",
		"### F04 · Identidad y acceso",
	].join("\n");

	beforeAll(() => {
		fs.writeFileSync(path.join(tmp, PLAN_PDLE2), PLAN_PDLE2_MD);
	});

	/** Los tests comparten tmp+PLAN: resetear el board persistido Y el progress
	 *  file (#158) para que cada caso arranque del estado que construye
	 *  (openBoard NO limpia el board guardado — hereda transiciones del test
	 *  anterior; el progress alimenta la sugerencia relativa). */
	const resetBoard = (plan: string) => {
		const file = boardFilePath(tmp, plan);
		if (fs.existsSync(file)) fs.rmSync(file);
		const progress = progressFilePath(tmp, plan);
		if (fs.existsSync(progress)) fs.rmSync(progress);
	};

	it("board completo y cobertura total ⇒ isPlanComplete sin botón fantasma", () => {
		resetBoard(PLAN);
		const board = openBoard(tmp, PLAN, PLAN5);
		for (const u of board.units)
			applyStageTransition(board, u.id, { stage: "commit", runId: "t", ts: "t" });
		saveBoard(tmp, PLAN, board);
		const res = resolveNextStepWithBoard(`${PLAN} Phase F10c.3`, tmp);
		expect(res.boardGap).toBeUndefined();
		expect(res.effective?.isPlanComplete).toBe(true);
		expect(res.effective?.nextPhase).toBeUndefined();
		expect(res.effective?.shipCommand).toBeUndefined();
	});

	it("board con hueco ⇒ sugiere el gap (comportamiento previo)", () => {
		resetBoard(PLAN);
		const board = openBoard(tmp, PLAN, PLAN5);
		for (const u of board.units.slice(0, 2))
			applyStageTransition(board, u.id, { stage: "commit", runId: "t", ts: "t" });
		saveBoard(tmp, PLAN, board);
		const res = resolveNextStepWithBoard(`${PLAN} Phase F10c.3`, tmp);
		expect(res.boardGap?.id).toBe("F10c.3");
		expect(res.effective?.isPlanComplete).toBe(false);
		expect(res.effective?.shipCommand).toContain("Phase F10c.3");
	});

	it("board sin unidad para una fase del plan ⇒ NO declara completo (guard)", () => {
		resetBoard(PLAN);
		const board = openBoard(tmp, PLAN, PLAN5);
		for (const u of board.units)
			applyStageTransition(board, u.id, { stage: "commit", runId: "t", ts: "t" });
		board.units = board.units.filter((u) => u.id !== "F10c.5"); // plan la conoce, board no
		saveBoard(tmp, PLAN, board);
		const res = resolveNextStepWithBoard(`${PLAN} Phase F10c.3`, tmp);
		expect(res.effective?.isPlanComplete).toBe(false);
	});

	it("formato pdle2 (grupos h2 + fases h3 ·) ⇒ completa con las fases reales", () => {
		const board = openBoard(tmp, PLAN_PDLE2, PLAN_PDLE2_MD);
		// Con el fix #193 el board se crea con las FASES h3 (no los grupos h2).
		expect(board.units.map((u) => u.id).sort()).toEqual(["F01", "F02", "F04"]);
		for (const u of board.units)
			applyStageTransition(board, u.id, { stage: "commit", runId: "t", ts: "t" });
		saveBoard(tmp, PLAN_PDLE2, board);
		const res = resolveNextStepWithBoard(`${PLAN_PDLE2} Phase F02`, tmp);
		// Antes: parser veía grupos [F0, F1] jamás presentes en el board →
		// «Avanzar a F0» con shipCommand sobre una fase inexistente.
		expect(res.effective?.isPlanComplete).toBe(true);
		expect(res.effective?.nextPhase).toBeUndefined();
		expect(res.effective?.shipCommand).toBeUndefined();
	});
});
