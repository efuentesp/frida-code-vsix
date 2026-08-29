// M2 (#143) — componente ProjectMapTab (molde productivity-tab.test.ts:
// renderToStaticMarkup + post=vi.fn(); los efectos NO corren — la carga al
// montar se prueba en vivo, documentado en IndexTab.tsx:701-704).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectMapTab } from "../webview/components/ProjectMapTab";
import { FunctionalView } from "../webview/components/project-map/FunctionalView";
import type { PmFunctionalData, State } from "../webview/types";

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
