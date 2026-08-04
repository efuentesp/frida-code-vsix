// Tarjeta KPI reutilizable del tab "Uso".

export function KPICard({ label, value }: { label: string; value: string }) {
	return (
		<div className="kpi-card">
			<div className="kpi-value">{value}</div>
			<div className="kpi-label">{label}</div>
		</div>
	);
}
