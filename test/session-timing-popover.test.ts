import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	computeTiming,
	SessionTimingDetail,
	SessionTimingPopover,
} from "../webview/components/SessionTimingPopover";
import type { Turn, Usage } from "../webview/types";

/**
 * #107 — Chip de tiempo activo + popover de detalle en el header.
 *
 * Render server-side con React.createElement (mismo patrón que
 * usage-dashboard.test.ts: JSX no está disponible en .ts). El popover cerrado
 * se valida por defecto (chip); el contenido del detalle, con el componente
 * puro SessionTimingDetail renderizado directo (sin hack de estado).
 */

function mkUsage(over: Partial<Usage> = {}): Usage {
	return {
		inputTotal: 214_000,
		outputTotal: 31_000,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 1.24,
		contextTokens: 0,
		contextWindow: 0,
		contextPercent: null,
		sessionDurationMs: 13_260_000, // 3h 41m
		activeMs: 4_980_000, // 1h 23m
		turnCount: 12,
		turnDurations: [
			150_000, 300_000, 90_000, 60_000, 1_390_000, 120_000, 60_000, 45_000,
			300_000, 90_000, 60_000, 1_395_000,
		],
		...over,
	};
}

const mkTurn = (over: Partial<Turn> = {}): Turn => ({
	id: 13,
	user: "siguiente tarea",
	segments: [],
	status: null,
	...over,
});

describe("computeTiming (#107)", () => {
	it("suma el turno en curso al total y marca running", () => {
		const now = Date.now();
		const t = computeTiming(
			mkUsage(),
			true,
			mkTurn({ startedAt: now - 30_000 }),
			now,
		);
		expect(t.running).toBe(true);
		expect(t.liveMs).toBe(30_000);
		expect(t.totalMs).toBe(4_980_000 + 30_000);
	});

	it("no marca running sin startedAt (turn reconstruido) aunque busy", () => {
		const t = computeTiming(
			mkUsage(),
			true,
			mkTurn({ startedAt: 0 }),
			Date.now(),
		);
		expect(t.running).toBe(false);
		expect(t.totalMs).toBe(4_980_000);
	});

	it("calcula % activo/pared, promedio y posición del máximo", () => {
		const t = computeTiming(mkUsage(), false, undefined, 0);
		expect(t.pct).toBe(38); // 4.98M / 13.26M ≈ 37.6 → 38
		expect(t.avgMs).toBe(Math.round(4_980_000 / 12));
		expect(t.maxIdx).toBe(11); // 1_395_000 (último) es el máximo
		expect(t.maxDur).toBe(1_395_000);
	});

	it("recorta el sparkline a las últimas 20 duraciones", () => {
		const durations = Array.from({ length: 30 }, (_, i) => (i + 1) * 60_000);
		const t = computeTiming(
			mkUsage({ turnDurations: durations, turnCount: 30 }),
			false,
			undefined,
			0,
		);
		expect(t.durations).toHaveLength(20);
		expect(t.durations[0]).toBe(11 * 60_000); // dura la 11..30
		expect(t.maxIdx).toBe(29);
	});

	it("empty=true cuando no hay activo ni turnos", () => {
		const t = computeTiming(
			mkUsage({
				activeMs: 0,
				turnCount: 0,
				turnDurations: [],
				sessionDurationMs: 0,
			}),
			false,
			undefined,
			0,
		);
		expect(t.empty).toBe(true);
	});
});

describe("SessionTimingPopover — chip (#107)", () => {
	it("chip muestra tiempo activo (Σ turnos) + conteo cerrado", () => {
		const html = renderToStaticMarkup(
			React.createElement(SessionTimingPopover, {
				usage: mkUsage(),
				busy: false,
				turn: undefined,
			}),
		);
		expect(html).toContain("1h 23m"); // activeMs
		expect(html).toContain("12t");
		expect(html).toContain("st-chip");
	});

	it("popover cerrado por defecto: sin role=dialog ni sparkline", () => {
		const html = renderToStaticMarkup(
			React.createElement(SessionTimingPopover, {
				usage: mkUsage(),
				busy: false,
				turn: undefined,
			}),
		);
		expect(html).not.toContain('role="dialog"');
		expect(html).not.toContain("stp-spark");
	});

	it("punto live en el chip con turno en curso; chip no infla el conteo", () => {
		const html = renderToStaticMarkup(
			React.createElement(SessionTimingPopover, {
				usage: mkUsage(),
				busy: true,
				turn: mkTurn({ startedAt: Date.now() - 5_000 }),
			}),
		);
		expect(html).toContain("st-chip-live");
		expect(html).toContain("12t");
		expect(html).not.toContain("13t");
	});

	it("no renderiza nada sin datos", () => {
		const html = renderToStaticMarkup(
			React.createElement(SessionTimingPopover, {
				usage: mkUsage({
					activeMs: 0,
					turnCount: 0,
					turnDurations: [],
					sessionDurationMs: 0,
				}),
				busy: false,
				turn: undefined,
			}),
		);
		expect(html).toBe("");
	});
});

/** Busca en el árbol de elementos el primero con className dada. */
function findByClass(el: unknown, cls: string): any {
	if (!el || typeof el !== "object") return null;
	const e = el as { props?: any; type?: unknown };
	const c = e.props?.className;
	if (typeof c === "string" && c.split(/\s+/).includes(cls)) return e;
	const kids = e.props?.children;
	const list = Array.isArray(kids) ? kids : [kids];
	for (const k of list) {
		const hit = findByClass(k, cls);
		if (hit) return hit;
	}
	return null;
}

describe("SessionTimingDetail — popover (#107)", () => {
	it("desglose completo: sparkline, filas, %, pie y máximo con turno", () => {
		const t = computeTiming(mkUsage(), false, undefined, 0);
		const html = renderToStaticMarkup(
			React.createElement(SessionTimingDetail, { usage: mkUsage(), t }),
		);
		expect(html).toContain('role="dialog"');
		expect(html).toContain("stp-spark");
		expect(html).toContain("stp-bar max"); // barra del máximo en rojo
		expect(html).toContain("Tiempo de sesión");
		expect(html).toContain("Activo");
		expect(html).toContain("12 turnos");
		expect(html).toContain("Pared");
		expect(html).toContain("(38%)");
		expect(html).toContain("Promedio");
		expect(html).toContain("Máximo");
		expect(html).toContain("turno #12");
		expect(html).toContain("↑214k");
		expect(html).toContain("↓31k");
		expect(html).toContain("$1.24");
		expect(html).not.toContain("stp-running"); // sin turno en curso
	});

	it("fila running y 13 turnos cuando hay turno en curso", () => {
		const now = Date.now();
		const t = computeTiming(
			mkUsage(),
			true,
			mkTurn({ startedAt: now - 45_000 }),
			now,
		);
		const html = renderToStaticMarkup(
			React.createElement(SessionTimingDetail, { usage: mkUsage(), t }),
		);
		expect(html).toContain("stp-running");
		expect(html).toContain("turno en curso");
		expect(html).toContain("13 turnos"); // cerrados + en curso
	});

	it("REGRESIÓN: el botón ✕ cierra el popover (onClick wired a onClose)", () => {
		const t = computeTiming(mkUsage(), false, undefined, 0);
		const onClose = vi.fn();
		// Invocar el function component directamente (sin hooks) para obtener
		// su árbol de elementos con los handlers intactos.
		const el = SessionTimingDetail({ usage: mkUsage(), t, onClose });
		const close = findByClass(el, "stp-close");
		expect(close).toBeTruthy();
		expect(typeof close.props.onClick).toBe("function");
		close.props.onClick();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("sparkline limitado a 20 barras, máximo marcado dentro del recorte", () => {
		const durations = Array.from({ length: 30 }, (_, i) => (i + 1) * 60_000);
		const t = computeTiming(
			mkUsage({ turnDurations: durations, turnCount: 30 }),
			false,
			undefined,
			0,
		);
		const html = renderToStaticMarkup(
			React.createElement(SessionTimingDetail, { usage: mkUsage(), t }),
		);
		const bars = (html.match(/stp-bar/g) ?? []).length;
		expect(bars).toBe(20);
		expect(html).toContain("stp-bar max");
	});
});
