// Heatmap de strips de intensidad (hora 0–23 / día de la semana 0–6) para el tab
// "Uso". En F1 el indexer produce totales marginales (no la matriz cruzada 7×24);
// la matriz cruzada y bySdlcPhase son F2.

const DOW = ["D", "L", "M", "X", "J", "V", "S"];
export function Heatmap({ hours, dows }: { hours: number[]; dows: number[] }) {
	const maxH = Math.max(...hours, 1);
	const maxD = Math.max(...dows, 1);
	return (
		<div className="heatmap">
			<div className="heatmap-strip">
				<span className="heatmap-label">Hora</span>
				<div className="heatmap-cells">
					{hours.map((v, i) => (
						<div
							key={i}
							className="heatmap-cell"
							title={`${i}:00 — ${v}`}
							style={{ opacity: 0.12 + (v / maxH) * 0.88 }}
						/>
					))}
				</div>
			</div>
			<div className="heatmap-strip">
				<span className="heatmap-label">Día</span>
				<div className="heatmap-cells dow">
					{dows.map((v, i) => (
						<div
							key={i}
							className="heatmap-cell dow"
							title={`${DOW[i]} — ${v}`}
							style={{ opacity: 0.12 + (v / maxD) * 0.88 }}
						>
							{DOW[i]}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
