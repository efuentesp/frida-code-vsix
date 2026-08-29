// M2 (#143) — lib host del Mapa del proyecto (Node puro, sin vscode).
// Fixtures honestos (lecciones 30ef616/9d6d8bb): reproducen el schema REAL
// del writer M8 (src/tools/frida-app-walkthrough/workflow.ts:313-330) con
// TODOS los campos que M2 lee.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadFunctionalMap } from "../src/project-map/functional-inventory";
import { deriveJourneys, type PmAction } from "../src/project-map/journeys";

// Timeline canónico del ejemplo de design (corte por goto):
//   J01: abre en paso 1 · traversed P01→P02 (form, paso 2) · traversed
//        P02→P03 (click, paso 3) · attempted-failed P03 (form sin progresión)
//   J02: abre con goto P03→P04 (paso 5) · fail shell-error (paso 6) ·
//        no-progression (paso 7) · done sin arista (paso 8)
const ACTION_LOG: PmAction[] = [
	{
		step: 1,
		screenId: "P01",
		kind: "goto",
		description: "abrir /login",
		outcome: "ok",
	},
	{
		step: 2,
		screenId: "P01",
		kind: "form",
		description: "creds",
		outcome: "ok",
	},
	{
		step: 3,
		screenId: "P02",
		kind: "click",
		description: "dashboard",
		outcome: "ok",
	},
	{
		step: 4,
		screenId: "P03",
		kind: "form",
		description: "filtro",
		outcome: "ok",
	},
	{
		step: 5,
		screenId: "P03",
		kind: "goto",
		description: "a /admin",
		outcome: "ok",
	},
	{
		step: 6,
		screenId: "P04",
		kind: "click",
		description: "usuarios",
		outcome: "fail: timeout",
	},
	{
		step: 7,
		screenId: "P04",
		kind: "click",
		description: "usuario-1",
		outcome: "ok",
	},
	{ step: 8, screenId: "P04", kind: "done", description: "fin", outcome: "ok" },
];

function screenFixture(
	id: string,
	title: string,
	canon: string,
	firstSeenStep: number,
) {
	return {
		id,
		canon,
		origin: `${canon}?utm=x`,
		title,
		firstSeenStep,
		snapshot: `docs/funcional/artifacts/steps/${String(firstSeenStep).padStart(3, "0")}-snapshot.json`,
		screenshot: `docs/funcional/screenshots/${id}-${title.toLowerCase()}.png`,
		purpose: `propósito de ${title}`,
		userRoles: ["operador"],
		mainElements: ["form"],
		validationEvidence: [],
	};
}

const INVENTORY = {
	run: {
		pattern: "app-walkthrough",
		url: "https://demo.local/",
		session: "s1",
		language: "es",
		// 4 pantallas + budget: alcanzable por el writer real (workflow.ts:396
		// corta ANTES de registrar la 5ª cuando maxScreens=4) — fixture honesto.
		maxScreens: 4,
		maxMinutes: 0,
		startedAt: "2026-08-29 00:00:00 -0600",
		startedAtEpoch: 1,
		finishedAt: "2026-08-29 00:05:00 -0600",
	},
	screens: [
		screenFixture("P01", "Login", "https://demo.local/login", 1),
		screenFixture("P02", "Dashboard", "https://demo.local/dashboard", 3),
		screenFixture("P03", "Filtros", "https://demo.local/filtros", 4),
		screenFixture("P04", "Admin", "https://demo.local/admin", 6),
	],
	actionLog: ACTION_LOG.map((a, i) => ({
		...a,
		ref: a.kind === "goto" ? "" : `@e${i}`,
		url: a.kind === "goto" ? "https://demo.local/x" : "",
	})),
	stoppedBy: "budget",
	stoppedByTime: false,
};

describe("journeys · corte por goto (semántica fijada en design)", () => {
	it("deriva J01/J02: el goto que progresa abre journey", () => {
		const js = deriveJourneys(ACTION_LOG);
		expect(js.map((j) => j.id)).toEqual(["J01", "J02"]);
		expect(js[0].screenIds).toEqual(["P01", "P02", "P03"]);
		expect(
			js[0].edges
				.filter((e) => e.type === "traversed")
				.map((e) => `${e.from}->${e.to}#${e.step}`),
		).toEqual(["P01->P02#2", "P02->P03#3"]);
		expect(js[1].screenIds).toEqual(["P03", "P04"]);
		expect(
			js[1].edges
				.filter((e) => e.type === "traversed")
				.map((e) => `${e.from}->${e.to}#${e.step}`),
		).toEqual(["P03->P04#5"]);
	});

	it("goto SIN progresión no abre journey ni produce arista", () => {
		const js = deriveJourneys([
			{ step: 1, screenId: "P01", kind: "goto", description: "x", outcome: "ok" },
			{
				step: 2,
				screenId: "P01",
				kind: "goto",
				description: "recarga",
				outcome: "ok",
			},
		]);
		expect(js).toHaveLength(1); // solo J01 (primera acción)
		expect(js[0].edges).toHaveLength(0);
	});

	it("fails NO cortan el journey — quedan como attempted-failed en curso", () => {
		const js = deriveJourneys(ACTION_LOG);
		const failEdges = js[1].edges.filter((e) => e.cause === "shell-error");
		expect(failEdges).toHaveLength(1);
		expect(failEdges[0]?.detail).toContain("timeout");
	});

	it("click/form sin progresión → attempted-failed no-progression (canon M9)", () => {
		const js = deriveJourneys(ACTION_LOG);
		const noProg = js
			.flatMap((j) => j.edges)
			.filter((e) => e.cause === "no-progression");
		expect(noProg.map((e) => e.step)).toEqual([4, 7]);
	});

	it("validate → attempted-failed app-validation", () => {
		const js = deriveJourneys([
			{
				step: 1,
				screenId: "P01",
				kind: "validate",
				description: "regla",
				outcome: "ok",
			},
		]);
		expect(js[0].edges[0]?.cause).toBe("app-validation");
	});
});

// ── Helpers de tmpdir compartidos (a nivel de archivo; las Fases 2-4 los
//    reutilizan — forma final de la fusión del slice 2 del diseño) ──
const tmpDirs: string[] = [];
function makeCwd(inventory?: unknown): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pm-"));
	tmpDirs.push(dir);
	if (inventory !== undefined) {
		fs.mkdirSync(path.join(dir, "docs/funcional/artifacts"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(dir, "docs/funcional/artifacts/inventory.json"),
			typeof inventory === "string" ? inventory : JSON.stringify(inventory),
		);
	}
	return dir;
}

describe("loadFunctionalMap · degradación digna y payload honesto", () => {
	afterEach(() => {
		for (const d of tmpDirs.splice(0))
			fs.rmSync(d, { recursive: true, force: true });
	});

	it("sin docs/funcional → empty/missing con workaround accionable", () => {
		const r = loadFunctionalMap(makeCwd());
		expect(r.status).toBe("empty");
		if (r.status === "empty") {
			expect(r.reason).toBe("missing");
			expect(r.hint).toContain("app-walkthrough (M8)");
		}
	});

	it("JSON corrupto → empty/corrupt, sin throw", () => {
		const r = loadFunctionalMap(makeCwd("{no-json"));
		expect(r.status).toBe("empty");
		if (r.status === "empty") expect(r.reason).toBe("corrupt");
	});

	it("sin screens/actionLog arrays → empty/corrupt (canon de forma)", () => {
		const r = loadFunctionalMap(makeCwd({ run: {}, screens: "x" }));
		expect(r.status).toBe("empty");
	});

	it("inventory válido → ready con journeys, stoppedBy y runUrl", () => {
		const r = loadFunctionalMap(makeCwd(INVENTORY));
		expect(r.status).toBe("ready");
		if (r.status === "ready") {
			expect(r.data.journeys.map((j) => j.id)).toEqual(["J01", "J02"]);
			expect(r.data.stoppedBy).toBe("budget");
			expect(r.data.runUrl).toBe("https://demo.local/");
			expect(r.data.screens).toHaveLength(4);
		}
	});

	it("screenId huérfano del actionLog se excluye y se reporta", () => {
		const bad = {
			...INVENTORY,
			actionLog: [
				...INVENTORY.actionLog,
				{
					step: 9,
					screenId: "P99",
					kind: "click",
					description: "fantasma",
					ref: "@e9",
					url: "",
					outcome: "ok",
				},
			],
		};
		const r = loadFunctionalMap(makeCwd(bad));
		expect(r.status).toBe("ready");
		if (r.status === "ready") {
			expect(r.data.orphans).toEqual(["P99"]);
			expect(
				r.data.journeys.every((j) => j.screenIds.every((sid) => sid !== "P99")),
			).toBe(true);
		}
	});
});
