// M3 (#144) — componente SonarTab (molde project-map-tab.test.ts:
// renderToStaticMarkup + post=vi.fn(); los efectos NO corren — la carga al
// montar se prueba en vivo, documentado en IndexTab.tsx:701-704).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// FASE 4: SIN el import de SonarGateBadge (llega en la Fase 5 con el
// componente — un import de un módulo inexistente rompe typecheck:test).
import { SonarGateBadge } from "../webview/components/SonarGateBadge";
import { SonarTab } from "../webview/components/SonarTab";
import type { SonarTurnData, SonarUiState, State } from "../webview/types";

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

const settings = { maxWarnings: 0, disabledFamilies: [], historyLimit: 500 };

const readyData: SonarTurnData = {
	ts: 1750000000000,
	verdict: "fail",
	degraded: false,
	causes: [],
	blocking: 1,
	errors: 1,
	warnings: 3,
	effectiveWarnings: 3,
	diff: { added: 2, resolved: 1 },
	countsPorFamilia: { errores: 1, warnings: 2 },
	issues: [
		{
			key: "src/api/client.ts:42:F821",
			path: "src/api/client.ts",
			line: 42,
			rule: "F821",
			tool: "ruff",
			severity: "error",
			family: "errores",
		},
		{
			key: "webview/x.ts:3:noUnusedVariables",
			path: "webview/x.ts",
			line: 3,
			rule: "noUnusedVariables",
			tool: "biome",
			severity: "warning",
			family: "warnings",
		},
		{
			key: "webview/x.ts:9:biome",
			path: "webview/x.ts",
			line: 9,
			tool: "biome",
			severity: "warning",
			family: "warnings",
		},
	],
	issuesTruncated: false,
	busTruncated: true,
	trend: [
		{ ts: 1749999000000, verdict: "warn", warnings: 5 },
		{ ts: 1749999500000, verdict: "fail", warnings: 8 },
		{ ts: 1750000000000, verdict: "fail", warnings: 3 },
	],
	familiesUnavailable: [
		{ family: "cve", cause: "no corrió en esta pasada (frío): trivy" },
	],
};

function render(sonar?: SonarUiState): string {
	const post = vi.fn();
	return renderToStaticMarkup(
		React.createElement(SonarTab, { state: { ...baseState, sonar }, post }),
	);
}

describe("SonarTab · estados honestos (D9)", () => {
	it("sin estado → cargando (el host SIEMPRE responde al refresh)", () => {
		const html = render();
		expect(html).toContain("Cargando gate de calidad");
	});

	it("not-installed → hint accionable verbatim SIN botón Reintentar (FR-10)", () => {
		const html = render({
			status: "not-installed",
			hint:
				"pi-lens no está cargado. Instálalo en ~/.frida (npm i pi-lens en ~/.frida/npm) y recarga Frida (/reload) para activar el gate de calidad.",
			settings,
		});
		expect(html).toContain("pi-lens no está cargado");
		expect(html).toContain("/reload");
		expect(html).not.toContain("Reintentar");
		expect(html).not.toContain("sn-retry");
		expect(html).not.toContain("Recargar"); // D9: ni el Recargar del header
	});

	it("no-data → hint del host + botón Reintentar", () => {
		const html = render({
			status: "no-data",
			hint: "pi-lens todavía no tiene diagnósticos de esta sesión.",
			settings,
		});
		expect(html).toContain("todavía no tiene diagnósticos");
		expect(html).toContain("Reintentar");
	});

	it("error → hint visible, sin silencio (f3112ec)", () => {
		const html = render({
			status: "error",
			hint: "EACCES: permission denied",
			settings,
		});
		expect(html).toContain("EACCES");
		expect(html).toContain("Reintentar");
	});
});

describe("SonarTab · ready (veredicto, diff, familias, issues, tendencia)", () => {
	const ready: SonarUiState = { status: "ready", data: readyData, settings };

	it("veredicto FAIL con clase de color + diff +2 -1 (FR-2/FR-8)", () => {
		const html = render(ready);
		expect(html).toContain("FAIL");
		expect(html).toContain("sn-verdict is-fail");
		expect(html).toContain("+2");
		expect(html).toContain("-1");
	});

	it("issues por familia con path:line y regla/tool; SIN message (NFR secrets)", () => {
		const html = render(ready);
		expect(html).toContain("errores (1)");
		expect(html).toContain("warnings (2)");
		expect(html).toContain("src/api/client.ts:42");
		expect(html).toContain("F821");
		expect(html).toContain("noUnusedVariables");
		// La issue sin rule muestra el tool; la de línea ausente no imprime ":undefined":
		expect(html).toContain("webview/x.ts:9");
		expect(html).not.toContain("undefined name");
		expect(html).not.toContain(":undefined");
	});

	it("familias: chips de las 8, fría «/nd» con causa visible (FR-4)", () => {
		const html = render(ready);
		expect(html).toContain("errores 1");
		expect(html).toContain("warnings 2");
		expect(html).toContain("CVEs 0/nd");
		expect(html).toContain("duplicación 0");
		expect(html).toContain("trivy");
	});

	it("familia deshabilitada por setting → chip atenuado «deshabilitada» (D3)", () => {
		const html = render({
			status: "ready",
			data: readyData,
			settings: { ...settings, disabledFamilies: ["complejidad"] },
		});
		expect(html).toContain("sn-chip is-off");
		expect(html).toContain("deshabilitada");
	});

	it("degradado → causas visibles con nota warn (FR-7 honesto)", () => {
		const html = render({
			status: "ready",
			data: {
				...readyData,
				degraded: true,
				causes: [
					"el escaneo excedió su presupuesto de tiempo (5 min) — resultados parciales",
				],
			},
			settings,
		});
		expect(html).toContain("Gate degradado");
		expect(html).toContain("resultados parciales");
	});

	it("avisos honestos de truncado: busTruncated (tope 12) e issuesTruncated (400)", () => {
		const html = render(ready);
		expect(html).toContain("tope del bus");
		const html2 = render({
			status: "ready",
			data: { ...readyData, issuesTruncated: true },
			settings,
		});
		expect(html2).toContain("truncada a 400");
	});

	it("tendencia → barras por turno coloreadas por veredicto, sin glifos", () => {
		const html = render(ready);
		expect(html).toContain("Tendencia (últimos 3 turnos)");
		expect(html.split("sn-trend-bar").length - 1).toBe(3);
		expect(html).toContain("sn-trend-bar is-fail");
	});

	it("umbrales activos visibles (FR-5/D7)", () => {
		const html = render(ready);
		expect(html).toContain("maxWarnings 0");
		expect(html).toContain("historial 500");
	});

	it("sin issues → nota explícita (ausencia de hallazgos ≠ vacío silencioso)", () => {
		const html = render({
			status: "ready",
			data: { ...readyData, issues: [], countsPorFamilia: {} },
			settings,
		});
		expect(html).toContain("Sin issues abiertas");
	});
});

// ── Badge de gate (Slice 5, FR-6) ─────────────────────────────────────────

describe("SonarGateBadge · visibilidad honesta (D9: sólo ready)", () => {
	it("sin state.sonar / not-installed / no-data / error → null (el badge NO aparece)", () => {
		const mk = (sonar: SonarUiState | undefined): string =>
			renderToStaticMarkup(
				React.createElement(SonarGateBadge, { sonar, onOpen: vi.fn() }),
			);
		expect(mk(undefined)).toBe("");
		expect(mk({ status: "not-installed", hint: "x", settings })).toBe("");
		expect(mk({ status: "no-data", settings })).toBe("");
		expect(mk({ status: "error", hint: "boom", settings })).toBe("");
	});
});

describe("SonarGateBadge · ready (veredicto + diff, codicons)", () => {
	function renderBadge(sonar: SonarUiState): string {
		return renderToStaticMarkup(
			React.createElement(SonarGateBadge, { sonar, onOpen: vi.fn() }),
		);
	}

	it("pill con clase de veredicto, «Sonar FAIL» y diff +2 -1 (reúso de VERDICT_META del tab)", () => {
		const html = renderBadge({ status: "ready", data: readyData, settings });
		expect(html).toContain("sn-badge is-fail");
		expect(html).toContain("Sonar FAIL");
		expect(html).toContain("codicon-error");
		expect(html).toContain("+2");
		expect(html).toContain("-1");
		expect(html).toContain("codicon-diff-added");
		expect(html).toContain("codicon-diff-removed");
	});

	it("PASS limpio renderiza +0 -0 (el badge SÍ aparece cuando el panel lens se auto-oculta)", () => {
		const html = renderBadge({
			status: "ready",
			data: { ...readyData, verdict: "pass", diff: { added: 0, resolved: 0 } },
			settings,
		});
		expect(html).toContain("sn-badge is-pass");
		expect(html).toContain("Sonar PASS");
		expect(html).toContain("+0");
		expect(html).toContain("-0");
	});

	it("degradado → codicon warning visible (FR-4 honesto hasta en la franja)", () => {
		const html = renderBadge({
			status: "ready",
			data: {
				...readyData,
				degraded: true,
				causes: [
					"el escaneo excedió su presupuesto de tiempo (5 min) — resultados parciales",
				],
			},
			settings,
		});
		expect(html).toContain("gate degradado");
		expect(html).toContain("codicon-warning");
	});

	it("tooltip/title lleva conteos + diff + hint de apertura (sin message, NFR secrets)", () => {
		const html = renderBadge({ status: "ready", data: readyData, settings });
		expect(html).toContain("1 blocking");
		expect(html).toContain("3 warnings efectivas");
		expect(html).toContain("Clic para abrir el tab Sonar");
	});
});

// ── Gate completo bajo demanda (Slice 6, FR-7) ─────────────────────────────

describe("SonarTab · gate completo (FR-7)", () => {
	it("ready sin fullGate → botón «Ejecutar gate completo» visible y SIN sección de resultado", () => {
		const html = render({ status: "ready", data: readyData, settings });
		expect(html).toContain("Ejecutar gate completo");
		expect(html).not.toContain("Gate completo (bajo demanda)");
	});

	it("not-installed → SIN botón de gate completo (nada que correr sin pi-lens)", () => {
		const html = render({
			status: "not-installed",
			hint:
				"pi-lens no está cargado. Instálalo en ~/.frida (npm i pi-lens en ~/.frida/npm) y recarga Frida (/reload) para activar el gate de calidad.",
			settings,
		});
		expect(html).not.toContain("Ejecutar gate completo");
	});

	it("busy → sección con «Ejecutando gate completo», línea de progreso ASCII, reloj mm:ss y botón deshabilitado", () => {
		const html = render({
			status: "ready",
			data: readyData,
			settings,
			fullGate: {
				busy: true,
				busySince: Date.now() - 65_000,
				lastLine: "Escaneando diagnósticos del proyecto… 34/120 (28%)",
			},
		});
		expect(html).toContain("Gate completo (bajo demanda)");
		expect(html).toContain("Ejecutando gate completo");
		expect(html).toContain("Escaneando diagnósticos del proyecto… 34/120 (28%)");
		expect(html).toContain("1:05"); // reloj mm:ss derivado de busySince (#111)
		expect(html).toMatch(/<button[^>]*disabled/); // bloqueado durante el escaneo
		// NFR UX: la barra de bloques del productor jamás llega a la UI:
		expect(html).not.toMatch(/[█░]/);
	});

	it("result degradado → veredicto propio del full (warn), causas, familia fría y diff informativo", () => {
		const html = render({
			status: "ready",
			data: readyData,
			settings,
			fullGate: {
				busy: false,
				busySince: null,
				result: {
					...readyData,
					verdict: "warn",
					degraded: true,
					causes: [
						"el escaneo excedió su presupuesto de tiempo (5 min) — resultados parciales",
					],
					diff: { added: 12, resolved: 3 },
					countsPorFamilia: { errores: 12, warnings: 77 },
					familiesUnavailable: [
						{ family: "cve", cause: "no corrió en esta pasada (frío): trivy" },
					],
				},
			},
		});
		expect(html).toContain("sn-verdict is-warn");
		expect(html).toContain("resultados parciales");
		expect(html).toContain("trivy");
		expect(html).toContain("+12");
		expect(html).toContain("completado a las");
	});

	it("error del full (sin result) → línea visible con nota warn, veredicto del turno intacto", () => {
		const html = render({
			status: "ready",
			data: readyData,
			settings,
			fullGate: {
				busy: false,
				busySince: null,
				lastLine: "Falló el gate completo: tool timeout",
			},
		});
		expect(html).toContain("Falló el gate completo");
		expect(html).toContain("sn-verdict is-fail"); // el turno sigue en FAIL
	});
});
