// M2 (#143) — componente ProjectMapTab (molde productivity-tab.test.ts:
// renderToStaticMarkup + post=vi.fn(); los efectos NO corren — la carga al
// montar se prueba en vivo, documentado en IndexTab.tsx:701-704).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectMapTab } from "../webview/components/ProjectMapTab";
import {
	FunctionalView,
	serializeFunctionalExport,
} from "../webview/components/project-map/FunctionalView";
import {
	TechnicalView,
	serializeTechnicalExport,
} from "../webview/components/project-map/TechnicalView";
import type {
	PmCrossState,
	PmFunctionalData,
	PmTechnicalState,
	State,
} from "../webview/types";

const baseState: State = {
	keyNeeded: false,
	busy: false,
	mode: "manual",
	turns: [],
	approvals: [],
	modelChanges: [],
	uiRequests: [],
	queued: [],
	isCompacting: false,
	compactions: [],
	branchSummaries: [],
	nextId: 1,
};

const fnData: PmFunctionalData = {
	screens: [
		{
			id: "P01",
			title: "Login",
			canon: "https://demo.local/login",
			origin: "https://demo.local/login",
			firstSeenStep: 1,
			snapshot: "docs/funcional/artifacts/steps/001-snapshot.json",
			screenshot: "docs/funcional/screenshots/P01-login.png",
			purpose: "",
			userRoles: [],
		},
		{
			id: "P02",
			title: "Dashboard",
			canon: "https://demo.local/dashboard",
			origin: "https://demo.local/dashboard",
			firstSeenStep: 3,
			snapshot: "",
			screenshot: "",
			purpose: "",
			userRoles: [],
		},
	],
	journeys: [
		{
			id: "J01",
			startStep: 1,
			screenIds: ["P01", "P02"],
			edges: [
				{
					type: "traversed",
					from: "P01",
					to: "P02",
					kind: "form",
					description: "creds",
					step: 2,
				},
				// Fase 2: edge attempted-failed para el test de la lista de fallos.
				{
					type: "attempted-failed",
					from: "P01",
					to: "",
					kind: "form",
					description: "filtro x",
					step: 3,
					cause: "no-progression",
					detail: "la pantalla no cambió tras la acción",
				},
			],
		},
	],
	stoppedBy: "budget",
	orphans: [],
	runUrl: "https://demo.local/",
};

function render(state: State): string {
	const post = vi.fn();
	return renderToStaticMarkup(
		React.createElement(ProjectMapTab, { state, post }),
	);
}

describe("ProjectMapTab · estados", () => {
	it("sin estado → cargando (sin spinner eterno: el host SIEMPRE responde)", () => {
		const html = render(baseState);
		expect(html).toContain("Cargando mapa funcional");
	});

	it("empty/missing → workaround accionable del M8", () => {
		const html = render({
			...baseState,
			projectMap: {
				functional: {
					status: "empty",
					reason: "missing",
					hint:
						"Sin mapa funcional — corre el patrón app-walkthrough (M8) para generar docs/funcional/",
				},
				busy: null,
			},
		});
		expect(html).toContain("app-walkthrough (M8)");
	});

	it("error → hint visible, no silencio", () => {
		const html = render({
			...baseState,
			projectMap: {
				functional: { status: "error", hint: "EACCES" },
				busy: null,
			},
		});
		expect(html).toContain("EACCES");
	});

	it("ready → lista de journeys con badge de cobertura parcial", () => {
		const html = render({
			...baseState,
			projectMap: {
				functional: { status: "ready", data: fnData, loadedAt: 1 },
				busy: null,
			},
		});
		expect(html).toContain("J01");
		expect(html).toContain("1 journey");
		expect(html).toContain("cobertura parcial: tope de pantallas");
		// FR-3: colapsado por defecto — el grafo NO renderiza sin expandir.
		expect(html).not.toContain("pm-graph");
	});
});

// ══ Fase 2: FunctionalView directo (open inyectado — el toggle vive en
//    ProjectMapTab y renderToStaticMarkup no corre efectos NI handlers) ══

function renderFn(
	data: PmFunctionalData,
	shots: Record<string, string>,
	open: string[],
	cross?: PmCrossState,
): string {
	return renderToStaticMarkup(
		React.createElement(FunctionalView, {
			data,
			loadedAt: 1,
			shots,
			open: new Set(open),
			onToggle: () => {},
			onToggleAll: () => {},
			post: vi.fn(),
			cross,
		}),
	);
}

describe("FunctionalView · grafo SVG por columnas (slice 2)", () => {
	it("journey cerrado → cabecera plegable SIN grafo en el DOM (render condicional)", () => {
		const html = renderFn(fnData, {}, []);
		expect(html).toContain("pm-journey-head");
		expect(html).toContain("J01");
		expect(html).not.toContain("pm-graph");
	});

	it("journey abierto → columnas por pantalla + arista bezier", () => {
		const html = renderFn(fnData, {}, ["J01"]);
		expect(html).toContain("pm-graph");
		expect(html).toContain(">P01<");
		expect(html).toContain(">P02<");
		expect(html).toContain("pm-edge");
		expect(html).toContain("pm-node");
	});

	it("shots on-demand: pendiente → capturando…; cacheado → data-URI; fallido → sin captura", () => {
		expect(renderFn(fnData, {}, ["J01"])).toContain("capturando…");
		expect(
			renderFn(fnData, { P01: "data:image/png;base64,QUJD" }, ["J01"]),
		).toContain("data:image/png;base64,QUJD");
		expect(renderFn(fnData, { P01: "" }, ["J01"])).toContain("sin captura");
	});

	it("attempted-failed se lista bajo el grafo con su causa", () => {
		const html = renderFn(fnData, {}, ["J01"]);
		expect(html).toContain("pm-fail-row");
		expect(html).toContain("#3");
		expect(html).toContain("sin progresión");
	});
});

// ══ Fase 3: vista Técnica (TechnicalView directo — open/busy inyectados;
//    renderToStaticMarkup no corre efectos NI handlers, molde renderFn) ══

const techReady: PmTechnicalState = {
	status: "ready",
	limit: 10,
	loadedAt: 1,
	data: {
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
	},
};

function renderTech(
	tech: PmTechnicalState | undefined,
	cross?: PmCrossState,
): string {
	return renderToStaticMarkup(
		React.createElement(TechnicalView, {
			tech,
			busy: false,
			post: vi.fn(),
			cross,
		}),
	);
}

describe("ProjectMapTab · conmutador de vistas (slice 3)", () => {
	it("render inicial: segmentos Funcional (activo) y Técnica presentes", () => {
		const html = render(baseState);
		expect(html).toContain("Funcional");
		expect(html).toContain("Técnica");
	});
});

describe("TechnicalView · estados (slice 3)", () => {
	it("sin estado → cargando", () => {
		expect(renderTech(undefined)).toContain("Cargando mapa técnico");
	});

	it("building → intentos visibles + hint verbatim (re-poll del host)", () => {
		const html = renderTech({
			status: "building",
			hint: "No review graph cached — retry this call shortly.",
			attempts: 3,
		});
		expect(html).toContain("Construyendo mapa técnico");
		expect(html).toContain("(3/10)");
		expect(html).toContain("retry this call shortly");
	});

	it("disabled (size-skip) → hint verbatim + botón Reintentar, sin re-poll", () => {
		const html = renderTech({
			status: "empty",
			reason: "disabled",
			hint: "review graph disabled: project has 12000 files, cap is 5000",
		});
		expect(html).toContain("review graph disabled");
		expect(html).toContain("Reintentar");
	});

	it("not-installed → hint accionable SIN botón Reintentar", () => {
		const html = renderTech({
			status: "empty",
			reason: "not-installed",
			hint: "pi-lens no está instalado en ~/.frida/npm",
		});
		expect(html).not.toContain("Reintentar");
	});

	it("ready → grafo de subsystems + listas + overlay + deadWeight", () => {
		const html = renderTech(techReady);
		expect(html).toContain("pm-graph");
		expect(html).toContain("12 import(s)");
		expect(html).toContain("src/extension.ts");
		expect(html).toContain("fanIn 38");
		expect(html).toContain("score 1140");
		expect(html).toContain("cobertura 90%");
		expect(html).toContain("sin importadores conocidos");
		expect(html).toContain("pm-node-box is-danger"); // dir "src" hospeda hotspot
	});
});

// ══ Fase 4: cruce técnico↔funcional en ambas vistas ══

const crossReady: PmCrossState = {
	status: "ready",
	loadedAt: 1,
	data: {
		entries: [
			{
				id: "M01",
				functionality: "inicio de sesión",
				screenIds: ["P01", "P02"],
				modules: ["src/auth.js"],
				endpointCount: 1,
			},
		],
		byScreen: { P01: [{ entryId: "M01", module: "src/auth.js" }] },
		byDirectory: { src: ["P01", "P02"] },
		danglingScreens: [],
		unmatchedModules: [],
	},
};

describe("FunctionalView · cruce M9 (slice 4)", () => {
	it("journey abierto con cruce → chips de módulo (open_file al clic)", () => {
		const html = renderFn(fnData, {}, ["J01"], crossReady);
		expect(html).toContain("pm-cross-chip");
		expect(html).toContain("src/auth.js");
	});

	it("omitted → nota de omisión FR-7, sin chips ni error", () => {
		const html = renderFn(fnData, {}, ["J01"], {
			status: "omitted",
			reason: "missing",
			hint:
				"Sin matriz M9 — corre el patrón traffic2api (M9) para generar docs/api/ y enlazar pantallas↔módulos",
		});
		expect(html).toContain("traffic2api (M9)");
		expect(html).not.toContain("pm-cross-chip");
	});

	it("pantallas colgantes → nota de matriz stale", () => {
		const html = renderFn(fnData, {}, ["J01"], {
			status: "ready",
			loadedAt: 1,
			data: {
				...crossReady.data,
				byScreen: {},
				danglingScreens: ["P09"],
			},
		});
		expect(html).toContain("no registrada");
	});

	it("sin cruce (undefined) → sin sección ni nota (retro-compatible)", () => {
		const html = renderFn(fnData, {}, ["J01"]);
		expect(html).not.toContain("pm-cross");
	});
});

	describe("TechnicalView · cruce M9 (slice 4)", () => {
	it("ready + cross → sección Cruce funcional con pantallas por directorio", () => {
		const html = renderTech(techReady, crossReady);
		expect(html).toContain("Cruce funcional (M9)");
		expect(html).toContain("P01 · P02");
	});

	it("unmatched → nota de módulos fuera del grafo", () => {
		const html = renderTech(techReady, {
			status: "ready",
			loadedAt: 1,
			data: {
				...crossReady.data,
				byDirectory: {},
				unmatchedModules: ["vendor/x.js"],
			},
		});
		expect(html).toContain("fuera de los subsystems");
	});

	it("sin cross → sin sección (retro-compatible)", () => {
		expect(renderTech(techReady, undefined)).not.toContain("Cruce funcional");
	});
});

// ══ Fase 5: serializadores del export (la mitad webview del seam FR-9;
//    reusan los fixtures locked fnData/techReady/crossReady) ══

describe("serializeFunctionalExport · payload de la vista Funcional", () => {
	it("journey abierto viaja open, fails como notas, shot cacheado inlinado", () => {
		const p = serializeFunctionalExport(
			fnData,
			new Set(["J01"]),
			{ P01: "data:image/png;base64,QUJD" },
			crossReady,
		);
		expect(p.view).toBe("functional");
		expect(p.sections[0]?.open).toBe(true);
		expect(p.sections[0]?.notes.join(" ")).toContain("sin progresión");
		const p01 = p.sections[0]?.columns[0]?.nodes[0];
		expect(p01?.screenId).toBe("P01");
		expect(p01?.shot).toBe("data:image/png;base64,QUJD");
	});

	it("pantalla SIN screenshot path → nodo compacto (sin screenId ni shot)", () => {
		const p = serializeFunctionalExport(
			fnData,
			new Set(["J01"]),
			{},
			undefined,
		);
		const p02 = p.sections[0]?.columns[1]?.nodes[0]; // P02 no tiene screenshot
		expect(p02?.screenId).toBeUndefined();
		expect(p02?.shot).toBeUndefined();
	});
});

describe("serializeTechnicalExport · payload de la vista Técnica", () => {
	it("sección de grafo + notas de hubs/riesgo + cruce por directorio", () => {
		const p = serializeTechnicalExport(techReady, crossReady);
		expect(p.view).toBe("technical");
		expect(p.sections[0]?.columns.length).toBeGreaterThan(0);
		expect(p.sections.some((s) => s.id === "hubs")).toBe(true);
		expect(
			p.sections.find((s) => s.id === "risk")?.notes.join(" "),
		).toContain("score 1140");
		expect(
			p.sections.find((s) => s.id === "cross")?.notes.join(" "),
		).toContain("P01 · P02");
	});
});
