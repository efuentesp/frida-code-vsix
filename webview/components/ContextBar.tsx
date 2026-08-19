import { useEffect, useRef, useState } from "react";
import type { Usage } from "../types";

function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
	return String(n);
}

/** Anillo de contexto 14×14 (F4 P2, §5.5 — ubicación AUTORIZADA por Edgar
 *  2026-08-19: vive EN el ContextBar junto al %, no en la toolbar). Arco
 *  proporcional con dasharray/dashoffset (rotado -90° para arrancar arriba);
 *  mismo semáforo low/mid/high del strip. Click → popup «Session Info». */
export function ContextRing({
	pct,
	unknown,
	onClick,
}: {
	pct: number;
	unknown?: boolean;
	onClick?: () => void;
}) {
	const level = pct >= 90 ? "error" : pct >= 70 ? "warning" : "";
	// circunferencia r=5.5 en viewBox 14: 2πr ≈ 34.56
	const C = 2 * Math.PI * 5.5;
	const filled = unknown ? C * 0.06 : (Math.min(100, pct) / 100) * C;
	return (
		<button
			type="button"
			className={"ctx-ring " + level}
			onClick={onClick}
			aria-label={
				unknown
					? "Contexto: tamaño desconocido. Detalles de la sesión"
					: `Contexto al ${pct}%. Detalles de la sesión`
			}
			title="Información de la sesión"
		>
			<svg
				className="circular-progress"
				viewBox="0 0 14 14"
				width="14"
				height="14"
				aria-hidden="true"
			>
				<circle className="progress-bg" cx="7" cy="7" r="5.5" />
				<circle
					className="progress-arc"
					cx="7"
					cy="7"
					r="5.5"
					strokeDasharray={`${filled} ${C}`}
				/>
			</svg>
		</button>
	);
}

/** Popup «Session Info» (§5.5): costo, uso+buffer rayado, desglose y aviso
 *  de calidad. Anclado arriba del strip; Esc/click-fuera cierran. */
function SessionInfo({ usage, onClose }: { usage: Usage; onClose: () => void }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		// listener en la próxima pasada: no cerrar con el mismo click que abre
		const id = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
		return () => {
			clearTimeout(id);
			document.removeEventListener("mousedown", onDown);
		};
	}, [onClose]);

	const rawPct = usage.pressurePercent ?? usage.contextPercent;
	const pct = Math.max(0, Math.min(100, Math.round(rawPct ?? 0)));
	const unknown = rawPct == null || Number.isNaN(rawPct);
	// buffer reservado (rayado): presión ajustada − uso bruto (≥0)
	const raw = Math.round((usage.contextPercent ?? 0) * 10) / 10;
	const buffered = unknown ? 0 : Math.max(0, Math.round((pct - raw) * 10) / 10);
	return (
		<div className="session-info" ref={ref} role="dialog" aria-label="Session Info">
			<div className="si-title">Session Info</div>
			{usage.cost > 0 ? (
				<div className="si-cost">${usage.cost.toFixed(3)}</div>
			) : null}
			<div className="si-usage-bar">
				<div className="si-usage-fill" style={{ width: `${unknown ? 4 : raw}%` }} />
				<div
					className="si-usage-buffer"
					style={{ width: `${buffered}%` }}
					title={`Buffer reservado para la respuesta: ~${buffered}%`}
				/>
			</div>
			<div className="si-usage-meta">
				{unknown
					? "tamaño desconocido (post-compactación)"
					: `${fmt(usage.contextTokens)} / ${fmt(usage.contextWindow)} tokens · buffer ~${buffered}%`}
			</div>
			<div className="si-breakdown">
				<span>↑ entrada {fmt(usage.inputTotal)}</span>
				<span>↓ salida {fmt(usage.outputTotal)}</span>
				{usage.cacheRead > 0 || usage.cacheWrite > 0 ? (
					<span>
						R {fmt(usage.cacheRead)} · W {fmt(usage.cacheWrite)}
					</span>
				) : null}
				{usage.cacheHitRate !== undefined ? (
					<span>cache hit {usage.cacheHitRate.toFixed(0)}%</span>
				) : null}
			</div>
			<div className="si-quality">
				A partir de ~70% el agente puede compactar el contexto automáticamente.
			</div>
		</div>
	);
}

// Fila de estado del footer: SÓLO info de contexto (tokens/uso) + anillo con
// popup «Session Info» (F4 P2). El badge de frida-lens y la versión se mudaron
// al header para que esta barra aproveche todo su ancho.
export function ContextBar({ usage }: { usage?: Usage }) {
	const [infoOpen, setInfoOpen] = useState(false);
	if (!usage) return null;
	// Presión ajustada por reserve (anticipa la compactación); fallback a la bruta.
	// null = tamaño desconocido (post-compactación, antes de la próxima respuesta):
	// mostramos "?" como el footer de la TUI de pi, en vez de un 0% engañoso.
	const rawPct = usage.pressurePercent ?? usage.contextPercent;
	const pct = Math.round(rawPct ?? 0);
	const unknown = rawPct == null || Number.isNaN(rawPct);
	const level = pct >= 90 ? "high" : pct >= 70 ? "mid" : "low";
	const warn = pct >= 70; // aviso de compactación desde el nivel mid
	const hasCache = usage.cacheRead > 0 || usage.cacheWrite > 0;
	return (
		<div className="status-bar">
			{infoOpen ? (
				<SessionInfo usage={usage} onClose={() => setInfoOpen(false)} />
			) : null}
			<ContextRing
				pct={pct}
				unknown={unknown}
				onClick={() => setInfoOpen((v) => !v)}
			/>
			<span className="ctx-label">Contexto</span>
			<span className={"ctx-bar " + level + (warn ? " pulse" : "")}>
				<span
					className="ctx-fill"
					style={{ width: Math.min(100, pct) + "%" }}
				/>
			</span>
			<span className="ctx-pct">{unknown ? "?" : `${pct}%`}</span>
			<span className="ctx-tokens">
				{usage.contextWindow > 0
					? `${fmt(usage.contextTokens)} / ${fmt(usage.contextWindow)}`
					: "…"}
			</span>
			{(usage.inputTotal > 0 || usage.outputTotal > 0) && (
				<>
					<span className="ctx-sep">·</span>
					<span className="ctx-stats">
						<span>↑{fmt(usage.inputTotal)}</span>
						<span>↓{fmt(usage.outputTotal)}</span>
						{hasCache && <span>R{fmt(usage.cacheRead)}</span>}
						{hasCache && <span>W{fmt(usage.cacheWrite)}</span>}
						{usage.cacheHitRate !== undefined && (
							<span>CH{usage.cacheHitRate.toFixed(0)}%</span>
						)}
						{usage.cost > 0 && <span>${usage.cost.toFixed(3)}</span>}
					</span>
				</>
			)}
		</div>
	);
}
