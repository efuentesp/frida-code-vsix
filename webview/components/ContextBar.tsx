import type { Usage } from "../types";

function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
	return String(n);
}

// Fila de estado del footer: SÓLO info de contexto (tokens/uso). El badge de
// frida-lens y la versión se mudaron al header (pegados al título "Frida Code")
// para que esta barra aproveche todo su ancho con la información de contexto.
export function ContextBar({ usage }: { usage?: Usage }) {
	if (!usage) return null;
	// Presión ajustada por reserve (anticipa la compactación); fallback a la bruta.
	// null = tamaño desconocido (post-compactación, antes de la próxima respuesta):
	// mostramos "?" como el footer de la TUI de pi, en vez de un 0% engañoso.
	const rawPct = usage.pressurePercent ?? usage.contextPercent;
	const pct = Math.round(rawPct ?? 0);
	const unknown = rawPct == null || Number.isNaN(rawPct);
	const level = pct >= 90 ? "high" : pct >= 70 ? "mid" : "low";
	const hasCache = usage.cacheRead > 0 || usage.cacheWrite > 0;
	return (
		<div className="status-bar">
			<span className="ctx-label">Contexto</span>
			<span className={"ctx-bar " + level}>
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
