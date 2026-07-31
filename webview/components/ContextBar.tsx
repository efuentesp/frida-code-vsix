import type { Usage } from "../types";
import { Tooltip } from "./Tooltip";

function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
	return String(n);
}

// Fila de estado del footer. A la izquierda: info de contexto (tokens/uso) cuando
// exista. A la derecha (siempre): badge de frida-lens y versión. Así el header
// queda limpio y estos indicadores viven junto a la info de contexto.
export function ContextBar({
	usage,
	lensStatus,
	version,
	onVersionClick,
}: {
	usage?: Usage;
	lensStatus?: { loaded: boolean; active: boolean };
	version?: string;
	onVersionClick?: () => void;
}) {
	// Presión ajustada por reserve (anticipa la compactación); fallback a la bruta.
	const pct = usage
		? Math.round(usage.pressurePercent ?? usage.contextPercent)
		: 0;
	const level = pct >= 90 ? "high" : pct >= 70 ? "mid" : "low";
	const hasCache = !!usage && (usage.cacheRead > 0 || usage.cacheWrite > 0);
	return (
		<div className="status-bar">
			{usage && (
				<>
					<span className="ctx-label">Contexto</span>
					<span className={"ctx-bar " + level}>
						<span
							className="ctx-fill"
							style={{ width: Math.min(100, pct) + "%" }}
						/>
					</span>
					<span className="ctx-pct">{pct}%</span>
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
				</>
			)}
			<span className="ctx-right">
				{lensStatus?.loaded && (
					<Tooltip
						label={
							lensStatus.active
								? "frida-lens activo (emitiendo diagnósticos)"
								: "frida-lens cargado (sin actividad aún este turno)"
						}
						side="top"
					>
						<span
							className={"lens-badge" + (lensStatus.active ? " active" : "")}
						>
							{lensStatus.active ? "✓" : "○"} frida-lens
						</span>
					</Tooltip>
				)}
				{version && (
					<Tooltip
						label="Versión instalada · click para comprobar actualizaciones (/update)"
						side="top"
					>
						<button className="sub-version" onClick={onVersionClick}>
							v{version}
						</button>
					</Tooltip>
				)}
			</span>
		</div>
	);
}
