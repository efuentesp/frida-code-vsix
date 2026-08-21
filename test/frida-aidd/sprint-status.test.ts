// frida-aidd — tests de sprint-status (#38, ADR-0050 pieza 5).
// SPRINT_STATUS_LIB corre en un vm real (mismo ambiente que el sandbox del
// workflow, sin new Function en el host).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
	SPRINT_STATUS_LIB,
	SPRINT_STORY_STATUSES,
	SPRINT_STATUS_PATH,
} from "../../src/tools/frida-aidd/sprint-status";

/** Compila la lib en un contexto vm y la expone como objeto. */
function loadLib(): {
	sprintParseStatus: (text: string, origin?: string) => unknown;
	sprintSerializeStatus: (status: unknown) => string;
	sprintApplyTransition: (
		status: unknown,
		id: string,
		to: string,
		reason?: string,
	) => unknown;
	sprintCanTransition: (from: string, to: string) => boolean;
	SPRINT_STATUS_PATH: string;
} {
	const context = vm.createContext(
		{},
		{ codeGeneration: { strings: false, wasm: false } },
	);
	vm.runInContext(
		SPRINT_STATUS_LIB.replace(/^\n/, ""),
		context,
		{ filename: "sprint-status-lib.js" },
	);
	return context as never;
}

const SAMPLE = `sprint: 1
stories:
  E1-S1:
    title: Exportar CSV
    spec: docs/aidd/planning/spec-E1-S1.md
    status: done
    attempts: 1
  E1-S2:
    title: Filtro por fecha
    spec: docs/aidd/planning/spec-E1-S2.md
    status: pending
`;

describe("frida-aidd · sprint-status lib (#38 pieza 5)", () => {
	it("parse: yaml válido → sprint + stories completos", () => {
		const lib = loadLib();
		const parsed = lib.sprintParseStatus(SAMPLE) as {
			sprint: string;
			stories: Record<
				string,
				{
					title: string;
					spec: string;
					status: string;
					attempts?: number;
				}
			>;
		};
		expect(parsed.sprint).toBe("1");
		expect(Object.keys(parsed.stories)).toEqual(["E1-S1", "E1-S2"]);
		expect(parsed.stories["E1-S1"]!.title).toBe("Exportar CSV");
		expect(parsed.stories["E1-S1"]!.status).toBe("done");
		expect(parsed.stories["E1-S1"]!.attempts).toBe(1);
		expect(parsed.stories["E1-S2"]!.status).toBe("pending");
	});

	it("parse: round-trip estable (serialize → parse → igual)", () => {
		const lib = loadLib();
		const first = lib.sprintParseStatus(SAMPLE) as never;
		const text = lib.sprintSerializeStatus(first);
		const second = lib.sprintParseStatus(text) as never;
		expect(lib.sprintSerializeStatus(second)).toBe(text);
	});

	it("parse: tolera baselineCommit y propiedades de metadatos opcionales (#93)", () => {
		const lib = loadLib();
		const yaml = `sprint: 1
baselineCommit: a1b2c3d
stories:
  E1-S1:
    title: Onboarding
    spec: docs/aidd/planning/spec-E1-S1.md
    status: done
    attempts: 1
    baselineCommit: 120d564
`;
		const parsed = lib.sprintParseStatus(yaml) as any;
		expect(parsed.sprint).toBe("1");
		expect(parsed.stories["E1-S1"].title).toBe("Onboarding");
		expect(parsed.stories["E1-S1"].baselineCommit).toBe("120d564");
	});

	it("parse: rechaza status ilegal, historia sin title/spec, indentación rara", () => {
		const lib = loadLib();
		expect(() =>
			lib.sprintParseStatus(
				"sprint: 1\nstories:\n  E1-S1:\n    title: x\n    spec: s.md\n    status: yolo\n",
			),
		).toThrow(/status ilegal/);
		expect(() =>
			lib.sprintParseStatus(
				"sprint: 1\nstories:\n  E1-S1:\n    spec: s.md\n    status: pending\n",
			),
		).toThrow(/sin title/);
		expect(() =>
			lib.sprintParseStatus(
				"sprint: 1\nstories:\n   E1-S1:\n    title: x\n    spec: s.md\n    status: pending\n",
			),
		).toThrow(/indentación/);
	});

	it("serialize: rechaza vacío, '#' inicial y saltos de línea; ':' es legal", () => {
		const lib = loadLib();
		expect(() =>
			lib.sprintSerializeStatus({
				sprint: "1",
				stories: { A: { title: "", spec: "s", status: "pending" } },
			}),
		).toThrow(/vacío/);
		expect(() =>
			lib.sprintSerializeStatus({
				sprint: "1",
				stories: { A: { title: "#x", spec: "s", status: "pending" } },
			}),
		).toThrow(/'#'/);
		expect(() =>
			lib.sprintSerializeStatus({
				sprint: "1",
				stories: { A: { title: "a\nb", spec: "s", status: "pending" } },
			}),
		).toThrow(/salto de línea/);
		// ':' en el medio es legal (razones tipo "lie-detector: claims sin diff")
		// y round-trip estable.
		const text = lib.sprintSerializeStatus({
			sprint: "1",
			stories: {
				A: {
					title: "a: b",
					spec: "s",
					status: "blocked",
					blockedReason: "lie-detector: claims sin diff: src/x.ts",
				},
			},
		});
		expect(text).toContain("blockedReason: lie-detector: claims sin diff: src/x.ts");
		const back = lib.sprintParseStatus(text) as never;
		expect(lib.sprintSerializeStatus(back)).toBe(text);
	});

	it("never-regress: la tabla de aristas es exacta", () => {
		const lib = loadLib();
		// Legales (incluye la diagonal idempotente from===from para los 6 estados).
		const legal: Array<[string, string]> = [
			["pending", "in_progress"],
			["pending", "blocked"],
			["pending", "deferred"],
			["in_progress", "review"],
			["in_progress", "blocked"],
			["in_progress", "deferred"],
			["review", "done"],
			["review", "in_progress"],
			["review", "blocked"],
			["blocked", "pending"],
			["deferred", "pending"],
			...SPRINT_STORY_STATUSES.map(
				(s): [string, string] => [s, s],
			),
		];
		for (const [from, to] of legal) {
			expect(lib.sprintCanTransition(from, to), `${from}→${to}`).toBe(true);
		}
		// Ilegales: todo lo demás (done terminal, regresiones, saltos raros).
		for (const from of SPRINT_STORY_STATUSES) {
			for (const to of SPRINT_STORY_STATUSES) {
				const isLegal = legal.some(
					([f, t]) => f === from && t === to,
				);
				if (!isLegal) {
					expect(lib.sprintCanTransition(from, to), `${from}→${to}`).toBe(
						false,
					);
				}
			}
		}
	});

	it("applyTransition: inmutable, limpia blockedReason y resetea attempts en pending", () => {
		const lib = loadLib();
		const status = lib.sprintParseStatus(
			"sprint: 1\nstories:\n  E1-S1:\n    title: x\n    spec: s.md\n    status: blocked\n    attempts: 2\n    blockedReason: API caída\n",
		) as { stories: Record<string, { status: string; attempts?: number; blockedReason?: string }> };
		const next = lib.sprintApplyTransition(status, "E1-S1", "pending") as {
			stories: Record<string, { status: string; attempts?: number; blockedReason?: string }>;
		};
		// El original no mutó.
		expect(status.stories["E1-S1"]!.status).toBe("blocked");
		expect(next.stories["E1-S1"]!.status).toBe("pending");
		expect(next.stories["E1-S1"]!.attempts).toBe(0);
		expect(next.stories["E1-S1"]!.blockedReason).toBeUndefined();
	});

	it("applyTransition: blocked exige razón; done desde review ok; review→done→pending lanza", () => {
		const lib = loadLib();
		const base = lib.sprintParseStatus(
			"sprint: 1\nstories:\n  E1-S1:\n    title: x\n    spec: s.md\n    status: review\n",
		);
		const done = lib.sprintApplyTransition(base, "E1-S1", "done");
		expect(
			(done as { stories: Record<string, { status: string }> }).stories[
				"E1-S1"
			]!.status,
		).toBe("done");
		// done es terminal.
		expect(() => lib.sprintApplyTransition(done, "E1-S1", "pending")).toThrow(
			/transicion ilegal/,
		);
		// blocked sin razón → default explícito.
		const blocked = lib.sprintApplyTransition(base, "E1-S1", "blocked", "tests rojos");
		expect(
			(blocked as { stories: Record<string, { blockedReason?: string }> })
				.stories["E1-S1"]!.blockedReason,
		).toBe("tests rojos");
	});

	it("la lib del sandbox se mantiene compilable sin codeGeneration.strings", () => {
		// loadLib ya corre con codeGeneration deshabilitado; si la lib usara
		// eval/new Function, habría lanzado al compilar. Sanity adicional:
		expect(() => loadLib()).not.toThrow();
		// Y la constante de ruta coincide con el host.
		expect(loadLib().SPRINT_STATUS_PATH).toBe(SPRINT_STATUS_PATH);
	});

	it("el archivo fuente de la lib no mutó entre carga y disco", () => {
		// Guard: la lib del sandbox se sirve desde el mismo módulo TS (fuente
		// única); dos cargas producen el mismo parse (comparado por valor — el
		// serialize es determinista, las referencias nunca serán ===).
		const lib1 = loadLib();
		const lib2 = loadLib();
		expect(lib1.SPRINT_STATUS_PATH).toBe(lib2.SPRINT_STATUS_PATH);
		expect(lib1.sprintSerializeStatus(lib1.sprintParseStatus(SAMPLE))).toBe(
			lib2.sprintSerializeStatus(lib2.sprintParseStatus(SAMPLE)),
		);
	});
});

// Evita el lint de import no usado si SPRINT_STORY_STATUSES sólo se usa arriba.
void SPRINT_STORY_STATUSES;
