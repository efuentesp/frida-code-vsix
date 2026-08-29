// M2 (#143) — lib host del Mapa del proyecto (Node puro, sin vscode).
// Fixtures honestos (lecciones 30ef616/9d6d8bb): reproducen el schema REAL
// del writer M8 (src/tools/frida-app-walkthrough/workflow.ts:313-330) con
// TODOS los campos que M2 lee.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	loadFunctionalMap,
	readScreenshotDataUri,
	safeResolveWithin,
} from "../src/project-map/functional-inventory";
import { deriveJourneys, type PmAction } from "../src/project-map/journeys";
import {
	isSizeSkipHint,
	lensEnginePath,
	loadTechnicalMap,
	TECH_POLL_DELAYS_MS,
} from "../src/project-map/lens-project-report";
import {
	CROSS_MISSING_HINT,
	loadCrossMap,
	normalizeModulePath,
} from "../src/project-map/matrix-cross";

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

// ══ Fase 2: guard de contención + lector de PNGs como data-URI ══

describe("safeResolveWithin · guard de contención (molde agents-sync safeJoin)", () => {
	afterEach(() => {
		for (const d of tmpDirs.splice(0))
			fs.rmSync(d, { recursive: true, force: true });
	});

	it("rel dentro del cwd → abs resuelto", () => {
		const cwd = makeCwd();
		expect(safeResolveWithin(cwd, "docs/a.png")).toBe(
			path.resolve(cwd, "docs/a.png"),
		);
	});
	it("escape ../ → null", () => {
		expect(safeResolveWithin(makeCwd(), "../escape.png")).toBeNull();
	});
	it("path absoluto → null (nunca sale del workspace)", () => {
		expect(safeResolveWithin(makeCwd(), "/etc/passwd")).toBeNull();
	});
});

describe("readScreenshotDataUri · data-URI on-demand", () => {
	afterEach(() => {
		for (const d of tmpDirs.splice(0))
			fs.rmSync(d, { recursive: true, force: true });
	});

	it("PNG del workspace → data:image/png;base64", () => {
		const cwd = makeCwd();
		fs.mkdirSync(path.join(cwd, "docs/funcional/screenshots"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(cwd, "docs/funcional/screenshots/P01.png"),
			"png-fake",
		);
		expect(readScreenshotDataUri(cwd, "docs/funcional/screenshots/P01.png")).toBe(
			"data:image/png;base64," + Buffer.from("png-fake").toString("base64"),
		);
	});
	it('escape del cwd / extensión no-imagen / inexistente → ""', () => {
		const cwd = makeCwd();
		expect(readScreenshotDataUri(cwd, "../../etc/passwd")).toBe("");
		expect(readScreenshotDataUri(cwd, "docs/funcional/x.json")).toBe("");
		expect(readScreenshotDataUri(cwd, "no-existe.png")).toBe("");
	});
	it('> 4MB → "" (techo anti-postMessage)', () => {
		const cwd = makeCwd();
		fs.mkdirSync(path.join(cwd, "shots"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, "shots/big.png"),
			Buffer.alloc(4 * 1024 * 1024 + 1),
		);
		expect(readScreenshotDataUri(cwd, "shots/big.png")).toBe("");
	});
});

// ══ Fase 3: seam pi-lens — mock honesto del contrato (layout espejo del
//    real: package.json type:module porque el dist es ESM; hints verbatim del
//    contrato 3.8.72; lecciones 30ef616/9d6d8bb: congelar el contrato upstream)
// ══

const READY_REPORT = {
	available: true,
	trust: {
		graphBuiltAt: "2026-08-29T00:00:00.000Z",
		filesCovered: 90,
		filesTotal: 100,
		coverage: 0.9,
		stale: false,
		lowCoverage: false,
		notes: [],
	},
	hubs: [
		{ file: "src/extension.ts", fanIn: 38, blastRadius: 12, role: "activate" },
	],
	entryPoints: [{ file: "webview/main.tsx", fanIn: 0, fanOut: 22 }],
	subsystems: {
		directories: ["src", "test", "webview"],
		edges: [
			{ from: "webview", to: "src", count: 12 },
			{ from: "test", to: "src", count: 8 },
			{ from: "src", to: "test", count: 3 },
		],
		cycles: [{ dirs: ["src", "test"], edgeCount: 11 }],
		violations: [{ from: "src", to: "test", count: 3, dominantCount: 8 }],
	},
	riskHotspots: [
		{ file: "src/extension.ts", fanIn: 38, maxComplexity: 30, score: 1140 },
	],
	deadWeight: {
		files: [{ file: "docs/x.md" }],
		disclaimer: "Low confidence: verifica antes de borrar.",
	},
};

/** agentDir temporal con un lens-engine.js FAKE pero honesto (ESM espejo). */
function makeAgentDir(moduleBody?: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pm-lens-"));
	tmpDirs.push(dir);
	const pkgRoot = path.join(dir, "npm/node_modules/pi-lens");
	fs.mkdirSync(path.join(pkgRoot, "dist/clients"), { recursive: true });
	// Layout espejo del real: el dist de pi-lens es ESM ("type":"module").
	fs.writeFileSync(
		path.join(pkgRoot, "package.json"),
		JSON.stringify({ name: "pi-lens", type: "module", version: "0.0.0-test" }),
	);
	fs.writeFileSync(
		path.join(pkgRoot, "dist/clients/lens-engine.js"),
		moduleBody ??
			`export async function projectReport(cwd, options) {
 globalThis.__pmLensCall = { cwd, options };
 return ${JSON.stringify(READY_REPORT)};
}
`,
	);
	return dir;
}

describe("lens-project-report · seam pi-lens (mock honesto del contrato)", () => {
	afterEach(() => {
		for (const d of tmpDirs.splice(0))
			fs.rmSync(d, { recursive: true, force: true });
		delete (globalThis as any).__pmLensCall;
	});

	it("isSizeSkipHint: lenient por prefijo — size-skip sí, cache fría no", () => {
		expect(
			isSizeSkipHint(
				"review graph disabled: project has 12000 files, cap is 5000 — raise maxProjectFiles in .pi-lens.json or set PI_LENS_REVIEW_GRAPH_MAX_FILES",
			),
		).toBe(true);
		expect(isSizeSkipHint("Review graph disabled (otra redacción)")).toBe(true);
		expect(
			isSizeSkipHint(
				"No review graph cached for this workspace yet — a build was kicked off in the background; retry this call shortly.",
			),
		).toBe(false);
		expect(isSizeSkipHint("")).toBe(false);
	});

	it("TECH_POLL_DELAYS_MS congelado: 10 intentos, rampa 2s→5s→10s", () => {
		expect(TECH_POLL_DELAYS_MS).toHaveLength(10);
		for (let i = 1; i < TECH_POLL_DELAYS_MS.length; i++) {
			expect(TECH_POLL_DELAYS_MS[i]).toBeGreaterThanOrEqual(
				TECH_POLL_DELAYS_MS[i - 1],
			);
		}
		expect(TECH_POLL_DELAYS_MS[0]).toBe(2000);
		expect(TECH_POLL_DELAYS_MS[9]).toBe(10000);
	});

	it("lensEnginePath: layout espejo del piLensEntryPath del moat", () => {
		expect(lensEnginePath(path.join("X", "agent"))).toBe(
			path.join(
				"X",
				"agent",
				"npm",
				"node_modules",
				"pi-lens",
				"dist",
				"clients",
				"lens-engine.js",
			),
		);
	});

	it("sin instalación → empty/not-installed (sonda sin throw)", async () => {
		const r = await loadTechnicalMap(makeCwd(), makeCwd(), 10);
		expect(r.status).toBe("empty");
		if (r.status === "empty") expect(r.reason).toBe("not-installed");
	});

	it("hint de cache fría → building (re-poll del host)", async () => {
		const agentDir = makeAgentDir(
			`export async function projectReport() {
 return { available: false, hint: "No review graph cached for this workspace yet — a build was kicked off in the background; retry this call shortly." };
}
`,
		);
		const r = await loadTechnicalMap(makeCwd(), agentDir, 10);
		expect(r.status).toBe("building");
	});

	it("hint de size-skip → empty/disabled (paro, no re-poll)", async () => {
		const agentDir = makeAgentDir(
			`export async function projectReport() {
 return { available: false, hint: "review graph disabled: project has 12000 files, cap is 5000 — raise maxProjectFiles in .pi-lens.json" };
}
`,
		);
		const r = await loadTechnicalMap(makeCwd(), agentDir, 10);
		expect(r.status).toBe("empty");
		if (r.status === "empty") expect(r.reason).toBe("disabled");
	});

	it("available:true → ready normalizado + options.limit viaja al seam", async () => {
		const cwd = makeCwd();
		const r = await loadTechnicalMap(cwd, makeAgentDir(), 25);
		expect(r.status).toBe("ready");
		if (r.status === "ready") {
			expect(r.limit).toBe(25);
			expect(r.data.hubs[0]?.file).toBe("src/extension.ts");
			expect(r.data.subsystems.directories).toEqual(["src", "test", "webview"]);
			expect(r.data.riskHotspots[0]?.score).toBe(1140);
			expect(Math.round(r.data.trust.coverage * 100)).toBe(90);
		}
		expect((globalThis as any).__pmLensCall?.options?.limit).toBe(25);
	});

	it("rechazo del import/llamada → empty/error + warn ruidoso (f3112ec)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const agentDir = makeAgentDir(
				`export async function projectReport() { throw new Error("boom-lens"); }
`,
			);
			const r = await loadTechnicalMap(makeCwd(), agentDir, 10);
			expect(r.status).toBe("empty");
			if (r.status === "empty") {
				expect(r.reason).toBe("error");
				expect(r.hint).toContain("boom-lens");
			}
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

// ══ Fase 4: cruce técnico↔funcional — fixtures honestos del schema
//    MATRIX_SCHEMA del writer (traffic2api/workflow.ts:605, 1266-1276) ══

function makeApiCwd(inv?: unknown): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-pm-x-"));
	tmpDirs.push(dir);
	if (inv !== undefined) {
		fs.mkdirSync(path.join(dir, "docs/api/artifacts"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, "docs/api/artifacts/inventory.json"),
			typeof inv === "string" ? inv : JSON.stringify(inv),
		);
	}
	return dir;
}

const MATRIX_INV = {
	matrix: [
		{
			id: "M01",
			functionality: "inicio de sesión",
			screenIds: ["P01", "P02"],
			endpoints: [{ id: "E01", method: "POST", path: "/login" }],
			modules: [
				{ path: "./src/auth.js", evidence: "route POST /login" },
				{ path: "webview\\login-form.tsx", evidence: "form creds" },
			],
			evidence: "walk step 2",
		},
		{
			// sin id — el normalizador asigna M02 por orden (defense del writer)
			functionality: "administración de usuarios",
			screenIds: ["P04", "P99"],
			endpoints: [{ id: "", method: "GET", path: "/users" }],
			modules: [
				{ path: "src/admin/users.ts", evidence: "handler" },
				{ path: "server.js", evidence: "bootstrap" },
			],
			evidence: "",
		},
	],
	orphans: { apiSinUi: [], uiSinCodigo: [] },
	deadZone: [],
	summary: "fixture honesto",
};

const KNOWN_SCREENS = ["P01", "P02", "P03", "P04"];
const DIRS = ["src", "webview", "(root)"];

describe("matrix-cross · normalización de módulos (paths LLM)", () => {
	afterEach(() => {
		for (const d of tmpDirs.splice(0))
			fs.rmSync(d, { recursive: true, force: true });
	});

	it("strip ./ y backslashes → cwd-relativa POSIX", () => {
		expect(normalizeModulePath("/x", "./src/a.ts")).toBe("src/a.ts");
		expect(normalizeModulePath("/x", "webview\\b.tsx")).toBe("webview/b.tsx");
	});

	it('absoluto bajo el cwd → relativiza; fuera o vacío → ""', () => {
		const cwd = makeCwd();
		expect(normalizeModulePath(cwd, path.resolve(cwd, "src/a.ts"))).toBe(
			"src/a.ts",
		);
		expect(normalizeModulePath(cwd, "/fuera/de/aqui.ts")).toBe("");
		expect(normalizeModulePath(cwd, "")).toBe("");
	});
});

describe("matrix-cross · degradación digna (FR-7)", () => {
	afterEach(() => {
		for (const d of tmpDirs.splice(0))
			fs.rmSync(d, { recursive: true, force: true });
	});

	it("sin docs/api → omitted/missing con workaround M9", () => {
		const r = loadCrossMap(makeApiCwd(), KNOWN_SCREENS, DIRS);
		expect(r.status).toBe("omitted");
		if (r.status === "omitted") {
			expect(r.reason).toBe("missing");
			expect(r.hint).toBe(CROSS_MISSING_HINT);
			expect(r.hint).toContain("traffic2api (M9)");
		}
	});

	it("JSON corrupto → omitted/corrupt, sin throw", () => {
		const r = loadCrossMap(makeApiCwd("{no-json"), KNOWN_SCREENS, DIRS);
		expect(r.status).toBe("omitted");
		if (r.status === "omitted") expect(r.reason).toBe("corrupt");
	});

	it("sin matrix[] → omitted/corrupt (canon de forma)", () => {
		const r = loadCrossMap(
			makeApiCwd({ orphans: MATRIX_INV.orphans, deadZone: [], summary: "x" }),
			KNOWN_SCREENS,
			DIRS,
		);
		expect(r.status).toBe("omitted");
		if (r.status === "omitted") expect(r.reason).toBe("corrupt");
	});
});

describe("matrix-cross · joins pantalla↔módulo↔subsystem", () => {
	afterEach(() => {
		for (const d of tmpDirs.splice(0))
			fs.rmSync(d, { recursive: true, force: true });
	});

	it("join funcional + ids normalizados por orden + dangling", () => {
		const r = loadCrossMap(makeApiCwd(MATRIX_INV), KNOWN_SCREENS, DIRS);
		expect(r.status).toBe("ready");
		if (r.status !== "ready") return;
		expect(r.data.entries.map((x) => x.id)).toEqual(["M01", "M02"]);
		expect(r.data.entries[0]?.modules).toEqual([
			"src/auth.js",
			"webview/login-form.tsx",
		]);
		expect(r.data.entries[0]?.endpointCount).toBe(1);
		expect(r.data.byScreen["P01"]?.map((l) => l.module)).toEqual([
			"src/auth.js",
			"webview/login-form.tsx",
		]);
		expect(r.data.byScreen["P04"]?.map((l) => l.module)).toEqual([
			"src/admin/users.ts",
			"server.js",
		]);
		expect(r.data.byScreen["P99"]).toBeUndefined();
		expect(r.data.danglingScreens).toEqual(["P99"]);
	});

	it("join técnico por prefijo de segmentos completos + (root)", () => {
		const r = loadCrossMap(makeApiCwd(MATRIX_INV), KNOWN_SCREENS, DIRS);
		expect(r.status).toBe("ready");
		if (r.status !== "ready") return;
		expect(r.data.byDirectory["src"]).toEqual(["P01", "P02", "P04"]);
		expect(r.data.byDirectory["webview"]).toEqual(["P01", "P02"]);
		expect(r.data.byDirectory["(root)"]).toEqual(["P04"]); // server.js raíz
		expect(r.data.unmatchedModules).toEqual([]);
	});

	it("srca NO matchea src; módulo fuera → unmatched", () => {
		const r = loadCrossMap(
			makeApiCwd({
				matrix: [
					{
						id: "M01",
						functionality: "f",
						screenIds: ["P01"],
						endpoints: [],
						modules: [{ path: "srca/x.js" }],
					},
				],
				orphans: MATRIX_INV.orphans,
				deadZone: [],
				summary: "",
			}),
			KNOWN_SCREENS,
			["src"],
		);
		expect(r.status).toBe("ready");
		if (r.status !== "ready") return;
		expect(r.data.byDirectory).toEqual({});
		expect(r.data.unmatchedModules).toEqual(["srca/x.js"]);
	});

	it("directorio citado tal cual (sin extensión) matchea su subsystem", () => {
		const r = loadCrossMap(
			makeApiCwd({
				matrix: [
					{
						id: "M01",
						functionality: "f",
						screenIds: ["P01"],
						endpoints: [],
						modules: [{ path: "src" }],
					},
				],
				orphans: MATRIX_INV.orphans,
				deadZone: [],
				summary: "",
			}),
			KNOWN_SCREENS,
			["src", "(root)"],
		);
		expect(r.status).toBe("ready");
		if (r.status !== "ready") return;
		expect(r.data.byDirectory["src"]).toEqual(["P01"]);
	});

	it("módulo cuenta en TODOS los dirs ancestro presentes", () => {
		const r = loadCrossMap(
			makeApiCwd({
				matrix: [
					{
						id: "M01",
						functionality: "f",
						screenIds: ["P01"],
						endpoints: [],
						modules: [{ path: "src/admin/users.ts" }],
					},
				],
				orphans: MATRIX_INV.orphans,
				deadZone: [],
				summary: "",
			}),
			KNOWN_SCREENS,
			["src", "src/admin"],
		);
		expect(r.status).toBe("ready");
		if (r.status !== "ready") return;
		expect(r.data.byDirectory["src"]).toEqual(["P01"]);
		expect(r.data.byDirectory["src/admin"]).toEqual(["P01"]);
	});

	it("sin Técnica (dirs=[]) el cruce por pantalla funciona igual", () => {
		const r = loadCrossMap(makeApiCwd(MATRIX_INV), KNOWN_SCREENS, []);
		expect(r.status).toBe("ready");
		if (r.status !== "ready") return;
		expect(r.data.byDirectory).toEqual({});
		expect(r.data.unmatchedModules).toEqual([]); // sin referencia no hay "fuera de"
		expect(r.data.byScreen["P01"]?.length).toBe(2);
	});

	it("dedup: mismo módulo en dos entradas para la misma pantalla → un link", () => {
		const r = loadCrossMap(
			makeApiCwd({
				matrix: [
					{
						id: "M01",
						functionality: "a",
						screenIds: ["P01"],
						endpoints: [],
						modules: [{ path: "src/a.ts" }],
					},
					{
						id: "M02",
						functionality: "b",
						screenIds: ["P01"],
						endpoints: [],
						modules: [{ path: "./src/a.ts" }],
					},
				],
				orphans: MATRIX_INV.orphans,
				deadZone: [],
				summary: "",
			}),
			KNOWN_SCREENS,
			["src"],
		);
		expect(r.status).toBe("ready");
		if (r.status !== "ready") return;
		expect(r.data.byScreen["P01"]).toEqual([
			{ entryId: "M01", module: "src/a.ts" },
		]);
	});
});
