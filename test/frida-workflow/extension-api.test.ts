import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyStageTransition, openBoard, saveBoard } from "../../src/tools/frida-workflow/board";
import {
	frida,
	setBoardShowHandler,
} from "../../src/tools/frida-workflow/extension-api";

const PLAN = "plan.md";
const PLAN3 = "# Plan\n\n## F01 — Primera\n## F02 — Segunda\n## F03 — Tercera\n";

const dirs: string[] = [];
afterAll(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function newBoard(): string {
	const cwd = mkdtempSync(join(tmpdir(), "ext-api-"));
	dirs.push(cwd);
	const board = openBoard(cwd, PLAN, PLAN3);
	// Done con transición real (el status directo no cuenta para firstRealGap)
	applyStageTransition(board, "F01", { stage: "commit", runId: "fixture", ts: "t1" });
	applyStageTransition(board, "F02", { stage: "commit", runId: "fixture", ts: "t2" });
	saveBoard(cwd, PLAN, board);
	return cwd;
}

describe("frida.board.* — superficie extensionApi (#161)", () => {
	it("open devuelve el board persistido", () => {
		const cwd = newBoard();
		const b = frida.board.open(PLAN, { cwd });
		expect(b).not.toBeNull();
		expect(b!.units.map((u) => u.id)).toContain("F03");
	});

	it("open devuelve null si el board no existe", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ext-api-"));
		dirs.push(cwd);
		expect(frida.board.open("inexistente.md", { cwd })).toBeNull();
	});

	it("transition es append-only: añade sin tocar historia previa", () => {
		const cwd = newBoard();
		const antes = frida.board.open(PLAN, { cwd })!;
		const t0 = antes.units.find((u) => u.id === "F03")!.transitions.length;

		const ok = frida.board.transition(
			PLAN,
			"F03",
			{ stage: "implement", source: "mi-extension" },
			{ cwd },
		);
		expect(ok).toBe(true);

		// Recarga desde disco (lo que /board lee vía FS) — criterio de aceptación
		const despues = frida.board.open(PLAN, { cwd })!;
		const u = despues.units.find((x) => x.id === "F03")!;
		expect(u.transitions.length).toBe(t0 + 1);
		expect(u.status).toBe("implementada");
		const nueva = u.transitions[u.transitions.length - 1]!;
		expect(nueva.runId).toBe("mi-extension");
		expect(nueva.source).toBe("mi-extension");
	});

	it("transition crea la unidad on-demand y false si no hay board", () => {
		const cwd = newBoard();
		expect(
			frida.board.transition(
				PLAN,
				"F09",
				{ stage: "elaborate", source: "otra-ext" },
				{ cwd },
			),
		).toBe(true);
		const u = frida.board.open(PLAN, { cwd })!.units.find((x) => x.id === "F09");
		expect(u?.status).toBe("elaborada");
		expect(
			frida.board.transition(
				"no-existe.md",
				"F01",
				{ stage: "implement" },
				{ cwd },
			),
		).toBe(false);
	});

	it("gap devuelve el primer hueco real", () => {
		const cwd = newBoard();
		expect(frida.board.gap(PLAN, { cwd })).toBe("F03");
	});

	it("show dispara el handler inyectado por el host", () => {
		let llamadas = 0;
		setBoardShowHandler(() => {
			llamadas++;
		});
		frida.board.show();
		expect(llamadas).toBe(1);
		setBoardShowHandler(undefined); // limpieza: no filtrar entre tests
	});
});
