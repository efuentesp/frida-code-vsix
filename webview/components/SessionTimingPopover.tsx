import { useEffect, useRef, useState } from "react";
import type { Turn, Usage } from "../types";
import { fmtTokens, formatDuration } from "../format";
import { Codicon } from "./Codicon";

/**
 * #107 — Chip de tiempo de sesión en el header + popover de detalle.
 *
 * El chip muestra el TIEMPO ACTIVO (Σ duraciones de turnos cerrados, sin gaps
 * de lectura) y el número de turnos; mientras el agente trabaja suma en vivo
 * el turno en curso. Click abre un popover anclado (patrón file-popup) con el
 * desglose completo: sparkline de duraciones, activo vs pared con proporción,
 * promedio, máximo y tokens/costo.
 *
 * Fuente de verdad: `usage.activeMs/turnCount/turnDurations` (JSONL vía
 * postUsage — sobrevive recargas y compactación). El turno abierto se mide
 * localmente (`now − turn.startedAt`) porque aún no está en el JSONL.
 */

/** Máximo de barras del sparkline (últimas N duraciones). */
const SPARK_MAX = 20;

/** Cómputo compartido entre chip y detalle (puro, testeable). */
export function computeTiming(
	usage: Usage,
	busy: boolean,
	turn: Turn | undefined,
	now: number,
) {
	const closedMs = usage.activeMs ?? 0;
	const running = !!(
		busy &&
		turn?.startedAt !== undefined &&
		turn.startedAt > 0
	);
	const liveMs = running ? Math.max(0, now - (turn?.startedAt ?? 0)) : 0;
	const totalMs = closedMs + liveMs;
	const turnsClosed = usage.turnCount ?? 0;
	const wallMs = usage.sessionDurationMs ?? 0;
	const pct = wallMs > 0 ? Math.round((totalMs / wallMs) * 100) : null;
	const durationsAll = usage.turnDurations ?? [];
	const durations = durationsAll.slice(-SPARK_MAX);
	const maxDur = durations.length > 0 ? Math.max(...durations) : 0;
	const maxIdx = durationsAll.indexOf(maxDur);
	const avgMs = turnsClosed > 0 ? Math.round(closedMs / turnsClosed) : 0;
	return {
		closedMs,
		liveMs,
		totalMs,
		turnsClosed,
		wallMs,
		pct,
		durations,
		maxDur,
		maxIdx,
		avgMs,
		running,
		empty: totalMs <= 0 && turnsClosed === 0,
	};
}

export type Timing = ReturnType<typeof computeTiming>;

/** Cuerpo del popover: desglose completo de la sesión. onClose wired al ✕. */
export function SessionTimingDetail({
	usage,
	t,
	onClose,
}: {
	usage: Usage;
	t: Timing;
	onClose?: () => void;
}) {
	return (
		<div className="stp" role="dialog" aria-label="Detalle de tiempo de sesión">
			<div className="stp-head">
				<span className="stp-title">
					<Codicon name="watch" size={13} /> Tiempo de sesión
				</span>
				<button
					type="button"
					className="stp-close"
					aria-label="Cerrar"
					onClick={onClose}
				>
					<Codicon name="close" size={13} />
				</button>
			</div>
			{t.durations.length > 0 && (
				<div
					className="stp-spark"
					role="img"
					aria-label={`Duración de los últimos ${t.durations.length} turnos`}
				>
					{t.durations.map((d, i) => {
						const h = t.maxDur > 0 ? Math.max(6, (d / t.maxDur) * 100) : 6;
						const isMax = d === t.maxDur && t.maxIdx >= 0;
						return (
							<span
								key={i}
								className={"stp-bar" + (isMax ? " max" : "")}
								style={{ height: `${h}%` }}
								title={`Turno ${i + 1}: ${formatDuration(d)}`}
							/>
						);
					})}
				</div>
			)}
			<div className="stp-rows">
				<div className="stp-row">
					<span className="stp-k">
						<Codicon name="zap" size={12} /> Activo
					</span>
					<span className="stp-v">
						{formatDuration(t.totalMs)} · {t.turnsClosed + (t.running ? 1 : 0)} turnos
					</span>
				</div>
				<div className="stp-row">
					<span className="stp-k">
						<Codicon name="clock" size={12} /> Pared
					</span>
					<span className="stp-v">
						{formatDuration(t.wallMs)}
						{t.pct !== null && ` (${t.pct}%)`}
					</span>
				</div>
				{t.pct !== null && (
					<span className="stp-prop" aria-hidden="true">
						<span
							className="stp-prop-fill"
							style={{ width: `${Math.min(100, t.pct)}%` }}
						/>
					</span>
				)}
				<div className="stp-row">
					<span className="stp-k">
						<Codicon name="dash" size={12} /> Promedio
					</span>
					<span className="stp-v">{formatDuration(t.avgMs)}</span>
				</div>
				<div className="stp-row">
					<span className="stp-k">
						<Codicon name="arrow-up" size={12} /> Máximo
					</span>
					<span className="stp-v">
						{t.maxDur > 0
							? `${formatDuration(t.maxDur)} · turno #${t.maxIdx + 1}`
							: "—"}
					</span>
				</div>
			</div>
			<div className="stp-foot">
				↑{fmtTokens(usage.inputTotal)} · ↓{fmtTokens(usage.outputTotal)}
				{usage.cost > 0 && ` · $${usage.cost.toFixed(2)}`}
			</div>
			{t.running && (
				<div className="stp-running">
					<span className="stp-pulse" /> turno en curso +{formatDuration(t.liveMs)}
				</div>
			)}
		</div>
	);
}

/** Chip del header + estado de apertura del popover. */
export function SessionTimingPopover({
	usage,
	busy,
	turn,
}: {
	usage: Usage;
	busy: boolean;
	/** Último turno (para el timer en vivo del turno abierto). */
	turn: Turn | undefined;
}) {
	const [open, setOpen] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const rootRef = useRef<HTMLSpanElement>(null);

	// Cómputo del timing antes de los efectos (el tic-tac depende de running).
	const t = computeTiming(usage, busy, turn, now);
	const running = t.running;

	// Tic-tac (1s) solo mientras hay turno en curso: el total avanza en vivo.
	useEffect(() => {
		if (!running) return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [running]);

	// Esc + click fuera cierran el popover (contrato de ModelConfirmDialog
	// adaptado a popover anclado).
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setOpen(false);
			}
		};
		const onDown = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		window.addEventListener("keydown", onKey, true);
		document.addEventListener("mousedown", onDown, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			document.removeEventListener("mousedown", onDown, true);
		};
	}, [open]);

	const summaryTip = [
		`Tiempo activo: ${formatDuration(t.totalMs)} (Σ turnos)`,
		`Turnos: ${t.turnsClosed}${t.running ? " (+1 en curso)" : ""} · promedio ${formatDuration(t.avgMs)}`,
		t.wallMs > 0 ? `Sesión (reloj de pared): ${formatDuration(t.wallMs)}` : "",
		`↑${fmtTokens(usage.inputTotal)} ↓${fmtTokens(usage.outputTotal)} tokens · click para detalle`,
	]
		.filter(Boolean)
		.join("\n");

	// Oculto mientras no haya nada que mostrar (regla del chip actual).
	if (t.empty) return null;

	return (
		<span className="st-wrap" ref={rootRef}>
			<button
				type="button"
				className="st-chip"
				aria-expanded={open}
				aria-haspopup="dialog"
				title={summaryTip}
				onClick={() => setOpen((v) => !v)}
			>
				<Codicon name="watch" size={13} />
				<span className="st-chip-time">{formatDuration(t.totalMs)}</span>
				<span className="st-chip-sep">·</span>
				<span className="st-chip-turns">{t.turnsClosed}t</span>
				{t.running && <span className="st-chip-live" aria-label="en curso" />}
			</button>
			{open && (
				<SessionTimingDetail
					usage={usage}
					t={t}
					onClose={() => setOpen(false)}
				/>
			)}
		</span>
	);
}
