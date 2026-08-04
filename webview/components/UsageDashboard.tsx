import { useEffect, useState } from "react";
import type { OutMessage, State, UsagePeriod } from "../types";
import { KPICard } from "./usage/KPICard";
import { BarChart } from "./usage/BarChart";
import { DonutChart } from "./usage/DonutChart";
import { Heatmap } from "./usage/Heatmap";

type Scope = "project" | "all";

const PERIODS: { id: UsagePeriod; label: string }[] = [
	{ id: "today", label: "Hoy" },
	{ id: "7d", label: "7 días" },
	{ id: "30d", label: "30 días" },
	{ id: "all", label: "Todo" },
];

function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
	return String(n);
}
function fmtMs(ms: number): string {
	const h = ms / 3_600_000;
	if (h >= 1) return h.toFixed(1) + "h";
	const m = ms / 60_000;
	return m >= 1 ? m.toFixed(0) + "m" : "<1m";
}
function projOf(cwd: string): string {
	return cwd ? (cwd.split(/[/\\]/).pop() ?? cwd) : "";
}

// Tab "Uso": filtro de proyecto (Este proyecto | Todas — paridad con SessionsPanel)
// + selector de periodo + 6 KPIs + 6 gráficas SVG/CSS. Pide el snapshot al host al
// cambiar scope o periodo (patrón fetch-on-open de SettingsHub).
export function UsageDashboard({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	const [period, setPeriod] = useState<UsagePeriod>("30d");
	const [scope, setScope] = useState<Scope>("project");
	useEffect(() => {
		post({ type: "list_usage", period, scope });
	}, [period, scope]); // eslint-disable-line react-hooks/exhaustive-deps

	const ur = state.usageReport;
	if (!ur || ur.period !== period || ur.scope !== scope)
		return <div className="cfg-stub">Cargando uso…</div>;
	const report = ur.report;
	if (!report || report.kpis.sessions === 0)
		return (
			<div className="cfg-stub">
				Sin datos de uso{scope === "project" ? " de este proyecto" : ""} en este
				periodo todavía.
			</div>
		);
	const k = report.kpis;
	const showProj = scope === "all";
	return (
		<div className="usage-dashboard">
			<div className="usage-head">
				<div className="seg-toggle">
					<button
						className={"seg" + (scope === "project" ? " active" : "")}
						onClick={() => setScope("project")}
					>
						Este proyecto
					</button>
					<button
						className={"seg" + (scope === "all" ? " active" : "")}
						onClick={() => setScope("all")}
					>
						Todas
					</button>
				</div>
				<div className="usage-period">
					{PERIODS.map((p) => (
						<button
							key={p.id}
							className={"usage-period-btn" + (period === p.id ? " active" : "")}
							onClick={() => setPeriod(p.id)}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>
			<div className="usage-kpis">
				<KPICard label="Tokens ↑↓" value={fmt(k.tokensIn + k.tokensOut)} />
				<KPICard label="Costo" value={"$" + k.cost.toFixed(2)} />
				<KPICard label="Sesiones" value={String(k.sessions)} />
				<KPICard label="Turnos" value={String(k.turns)} />
				<KPICard
					label="Cache hit"
					value={(k.cacheHitPct ?? 0).toFixed(0) + "%"}
				/>
				<KPICard label="Tiempo activo" value={fmtMs(k.activeMs)} />
			</div>
			<div className="usage-grid">
				<div className="usage-card">
					<div className="usage-card-title">Tokens por día</div>
					<BarChart
						format={fmt}
						data={report.breakdowns.byDay.map((d) => ({
							label: d.date.slice(5),
							value: d.tokens,
						}))}
					/>
				</div>
				<div className="usage-card">
					<div className="usage-card-title">Uso por modelo</div>
					<DonutChart
						data={report.breakdowns.byModel.map((m) => ({
							label: m.model,
							value: m.tokens,
						}))}
					/>
				</div>
				<div className="usage-card">
					<div className="usage-card-title">Top herramientas</div>
					<BarChart
						horizontal
						data={report.breakdowns.byTool
							.slice(0, 8)
							.map((t) => ({ label: t.tool, value: t.count }))}
					/>
				</div>
				<div className="usage-card">
					<div className="usage-card-title">
						Artefactos por lenguaje (líneas)
					</div>
					<BarChart
						horizontal
						data={report.breakdowns.byLanguage.slice(0, 8).map((l) => ({
							label: l.language,
							value: Math.round(l.assistedKloc * 1000),
						}))}
					/>
				</div>
				<div className="usage-card">
					<div className="usage-card-title">Actividad por hora / día</div>
					<Heatmap
						hours={report.breakdowns.byHour}
						dows={report.breakdowns.byDow}
					/>
				</div>
				<div className="usage-card">
					<div className="usage-card-title">Top sesiones</div>
					<div className="usage-sessions">
						{report.sessions.slice(0, 8).map((s) => (
							<div key={s.path} className="usage-session-row">
								<span className="usage-session-name">
									{(s.path.split(/[/\\]/).pop() ?? s.path).replace(
										/\.jsonl$/,
										"",
									)}
									{showProj && projOf(s.cwd) ? (
										<span className="usage-session-proj">
											{" "}
											· {projOf(s.cwd)}
										</span>
									) : null}
								</span>
								<span className="usage-session-meta">
									{fmt(s.tokensIn + s.tokensOut)} · {s.turns} turnos
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
