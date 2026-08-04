// DonutChart SVG con leyenda para el tab "Uso" (uso por modelo/proveedor).

interface DonutDatum {
	label: string;
	value: number;
}
const COLORS = [
	"#4f9cf9",
	"#22c55e",
	"#f59e0b",
	"#ec4899",
	"#a855f7",
	"#06b6d4",
	"#ef4444",
	"#6b7280",
];

export function DonutChart({ data }: { data: DonutDatum[] }) {
	const total = data.reduce((a, b) => a + b.value, 0);
	if (total === 0) return <div className="chart-empty">Sin datos</div>;
	let acc = 0;
	const r = 18,
		cx = 25,
		cy = 25,
		C = 2 * Math.PI * r;
	return (
		<div className="donut-wrap">
			<svg className="donut" viewBox="0 0 50 50">
				<circle
					cx={cx}
					cy={cy}
					r={r}
					fill="none"
					stroke="var(--cfg-border,#333)"
					strokeWidth="8"
				/>
				{data.slice(0, 8).map((d, i) => {
					const frac = d.value / total;
					const dash = `${frac * C} ${C}`;
					const off = -acc * C;
					acc += frac;
					return (
						<circle
							key={i}
							cx={cx}
							cy={cy}
							r={r}
							fill="none"
							stroke={COLORS[i % COLORS.length]}
							strokeWidth="8"
							strokeDasharray={dash}
							strokeDashoffset={off}
							transform={`rotate(-90 ${cx} ${cy})`}
						/>
					);
				})}
			</svg>
			<div className="donut-legend">
				{data.slice(0, 8).map((d, i) => (
					<div key={i} className="donut-leg-row">
						<span
							className="donut-dot"
							style={{ background: COLORS[i % COLORS.length] }}
						/>
						{d.label}{" "}
						<span className="muted">
							{Math.round((d.value / total) * 100)}%
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
