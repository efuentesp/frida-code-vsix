// Tarjeta KPI reutilizable del tab "Uso".
import { Tooltip } from "../Tooltip";

type TipSide = "top" | "bottom" | "bottom-right" | "bottom-left";

export function KPICard({
	label,
	value,
	tip,
	tone,
	wide,
	tipSide = "top",
}: {
	label: string;
	value: string;
	/** Tooltip explicativo; se ancla en el ⓘ. */
	tip?: string;
	/** Tono de color del valor (p.ej. semáforo del cache hit). */
	tone?: "ok" | "warn" | "bad";
	/** Tooltip ancho (para explicaciones largas). */
	wide?: boolean;
	/** Lado/dirección en que abre el tooltip respecto al ⓘ. */
	tipSide?: TipSide;
}) {
	return (
		<div className="kpi-card">
			<div className={"kpi-value" + (tone ? " tone-" + tone : "")}>{value}</div>
			<div className="kpi-label">
				{label}
				{tip && (
					<Tooltip label={tip} side={tipSide} wide={wide}>
						<span className="kpi-info" aria-hidden="true">
							ⓘ
						</span>
					</Tooltip>
				)}
			</div>
		</div>
	);
}
