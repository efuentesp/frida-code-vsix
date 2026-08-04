// BarChart SVG (vertical) o CSS (horizontal) para el tab "Uso".

interface BarDatum {
	label: string;
	value: number;
}
export function BarChart({
	data,
	horizontal,
}: {
	data: BarDatum[];
	horizontal?: boolean;
}) {
	if (data.length === 0) return <div className="chart-empty">Sin datos</div>;
	const max = Math.max(...data.map((d) => d.value), 1);
	if (horizontal) {
		return (
			<div className="bar-h-list">
				{data.map((d) => (
					<div key={d.label} className="bar-h-row">
						<span className="bar-h-label" title={d.label}>
							{d.label}
						</span>
						<div className="bar-h-track">
							<div
								className="bar-h-fill"
								style={{ width: `${(d.value / max) * 100}%` }}
							/>
						</div>
						<span className="bar-h-val">{d.value}</span>
					</div>
				))}
			</div>
		);
	}
	const w = 100,
		h = 60,
		bw = w / data.length;
	return (
		<svg className="bar-v" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
			{data.map((d, i) => {
				const bh = (d.value / max) * h;
				return (
					<rect
						key={i}
						x={i * bw + 1}
						y={h - bh}
						width={Math.max(1, bw - 2)}
						height={bh}
						className="bar-v-fill"
					/>
				);
			})}
		</svg>
	);
}
