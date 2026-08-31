// board.test.ts — #159/#160/#161: núcleo del board jerárquico (contratos,
// splits, primer hueco, bootstrap, blindaje multi-escritor).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	applyStageTransition,
	boardChildren,
	boardFilePath,
	bootstrapBoardFromRuns,
	firstRealGap,
	isUnitDone,
	loadBoard,
	openBoard,
	saveBoard,
	setSkillContracts,
	syncUnitsFromPlan,
	type Board,
} from "../../src/tools/frida-workflow/board";
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
		expect(t("validate")).toBeDefined();
		expect(board.units[0]!.status).toBe("elaborada"); // validate sin passed: sin cambio
		t("implement");
		expect(board.units[0]!.status).toBe("implementada");
		t("validate", false);
		expect(board.units[0]!.status).toBe("implementada"); // FAIL no avanza
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
		expect(board.units[1]!.transitions.at(-1)!.artifactKind).toBe("validation-v2");

		// El spec del workflow gana sobre el contrato — en una unidad FRESCA
		// (tras validate ya no puede aplicarse implement: no retrocede).
		applyStageTransition(board, "F10c.4", {
			stage: "implement",
			runId: "r",
			ts: "t",
			spec: { stageKinds: { implement: "mutation-custom" } },
		});
		expect(
			board.units.find((u) => u.id === "F10c.4")!.transitions.at(-1)!
				.artifactKind,
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
			{ type: "workflow", runId: "run-1", input: `"${PLAN} Phase F10c.2"`, ts: "t" },
			{ type: "stage", runId: "run-1", stage: "elaborate", status: "completed" },
			{
				type: "stage",
				runId: "run-1",
				stage: "validate",
				status: "completed",
				output: {
					data: { passed: true },
					artifacts: [
						{ handle: { path: "/abs/validation.md" }, role: "primary" },
					],
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
