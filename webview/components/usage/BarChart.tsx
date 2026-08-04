// BarChart para el tab "Uso": horizontal (CSS, con etiqueta+valor) o vertical
// (CSS, valor encima + barra + día debajo + tooltip nativo). `format` opcional
// formatea el valor mostrado (p.ej. tokens → "27.7M").

interface BarDatum {
	label: string;
	value: number;
	hint?: string;
}
export function BarChart({
	data,
	horizontal,
	format,
}: {
	data: BarDatum[];
	horizontal?: boolean;
	format?: (v: number) => string;
}) {
	if (data.length === 0) return <div className="chart-empty">Sin datos</div>;
	const max = Math.max(...data.map((d) => d.value), 1);
	const fmtVal = (v: number) => (format ? format(v) : String(v));
	if (horizontal) {
		return (
			<div className="bar-h-list">
				{data.map((d) => (
				<div
					key={d.label}
					className="bar-h-row"
					title={
						d.hint
							? `${d.label} · ${d.hint} · ${fmtVal(d.value)} tokens ≈`
							: d.label
					}
				>
					<span className="bar-h-label" title={d.label}>
							{d.label}
						</span>
						<div className="bar-h-track">
							<div
								className="bar-h-fill"
								style={{ width: `${(d.value / max) * 100}%` }}
							/>
						</div>
						<span className="bar-h-val">{fmtVal(d.value)}</span>
					</div>
				))}
			</div>
		);
	}
	// Vertical: valor encima + barra + día debajo; tooltip nativo (title) al hover.
	return (
		<div className="bar-v-list">
			{data.map((d) => (
				<div
					key={d.label}
					className="bar-v-col"
					title={`${d.label} — ${fmtVal(d.value)}`}
				>
					<span className="bar-v-val">{fmtVal(d.value)}</span>
					<div className="bar-v-col-track">
						<div
							className="bar-v-col-fill"
							style={{ height: `${(d.value / max) * 100}%` }}
						/>
					</div>
					<span className="bar-v-day">{d.label}</span>
				</div>
			))}
		</div>
	);
}
