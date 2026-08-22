import { useEffect, useState } from "react";
import type { OutMessage, State, UsagePeriod } from "../types";
import { Codicon } from "./Codicon";

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

function cacheTone(pct: number): "ok" | "warn" | "bad" {
	if (pct >= 70) return "ok";
	if (pct >= 40) return "warn";
	return "bad";
}

export function ProductivityTab({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	const [period, setPeriod] = useState<UsagePeriod>("30d");
	const [scope, setScope] = useState<Scope>("project");
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		post({ type: "list_usage", period, scope });
	}, [period, scope]); // eslint-disable-line react-hooks/exhaustive-deps

	const ur = state.usageReport;
	if (!ur || ur.period !== period || ur.scope !== scope) {
		return (
			<div className="cfg-stub">
				<Codicon name="loading" size={14} spin /> Cargando scorecard de
				productividad...
			</div>
		);
	}

	const report = ur.report;
	if (!report || report.kpis.sessions === 0) {
		return (
			<div className="cfg-stub">
				Sin datos de telemetría{scope === "project" ? " de este proyecto" : ""} en
				este periodo todavía.
			</div>
		);
	}

	const k = report.kpis;
	const totalLines = report.breakdowns.byFileType.reduce(
		(acc, f) => acc + Math.round(f.assistedKloc * 1000),
		0,
	);
	const avgCostPerTurn = k.turns > 0 ? k.cost / k.turns : 0;
	const peakHour = report.breakdowns.byHour.reduce(
		(maxIdx, val, idx, arr) => (val > arr[maxIdx] ? idx : maxIdx),
		0,
	);

	const adoptionCount =
		(report.adoption.browserUsed ? 1 : 0) +
		(report.adoption.subagentsUsed ? 1 : 0) +
		(report.adoption.contextToolUsed ? 1 : 0);
	const adoptionRate = Math.round((adoptionCount / 3) * 100);

	const handleCopyReport = () => {
		const json = JSON.stringify(
			{
				version: "frida-usage-report/v1",
				scope,
				period,
				generatedAt: new Date().toISOString(),
				kpis: k,
				breakdowns: report.breakdowns,
				behavior: report.behavior,
				adoption: report.adoption,
			},
			null,
			2,
		);
		navigator.clipboard.writeText(json).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	return (
		<div className="productivity-tab">
			{/* Barra de control superior */}
			<div className="usage-head">
				<div className="seg-toggle">
					<button
						type="button"
						className={"seg" + (scope === "project" ? " active" : "")}
						onClick={() => setScope("project")}
					>
						Este proyecto
					</button>
					<button
						type="button"
						className={"seg" + (scope === "all" ? " active" : "")}
						onClick={() => setScope("all")}
					>
						Todas las sesiones
					</button>
				</div>
				<div className="usage-period">
					{PERIODS.map((p) => (
						<button
							key={p.id}
							type="button"
							className={"usage-period-btn" + (period === p.id ? " active" : "")}
							onClick={() => setPeriod(p.id)}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			{/* Sección 1: Scorecard Multimarco (DX AI x SPACE) */}
			<div className="prod-section">
				<div className="cfg-section">
					<Codicon name="dashboard" size={13} /> SCORECARD MULTIMARCO (DX AI × SPACE)
				</div>

				<div className="prod-pillars-grid">
					{/* Pilar 1: Utilización */}
					<div className="prod-pillar-card">
						<div className="prod-pillar-head">
							<span className="prod-pillar-title">UTILIZACIÓN (DX AI)</span>
							<span className="prod-pillar-badge badge-verified">
								<Codicon name="check" size={10} /> Medido con Logs
							</span>
						</div>
						<div className="prod-pillar-main">
							<div className="prod-pillar-metric">{adoptionRate}%</div>
							<div className="prod-pillar-label">Adopción de capacidades</div>
						</div>
						<div className="prod-pillar-footer">
							<span>{adoptionCount} de 3 capacidades activas</span>
							<span className="prod-dot">·</span>
							<span>{report.breakdowns.byTool.length} tools en uso</span>
						</div>
					</div>

					{/* Pilar 2: Impacto */}
					<div className="prod-pillar-card">
						<div className="prod-pillar-head">
							<span className="prod-pillar-title">IMPACTO & THROUGHPUT</span>
							<span className="prod-pillar-badge badge-proxy">
								<Codicon name="symbol-event" size={10} /> Proxy Directo
							</span>
						</div>
						<div className="prod-pillar-main">
							<div className="prod-pillar-metric">
								{totalLines > 0 ? `${fmt(totalLines)} lin` : `${k.turns} tur`}
							</div>
							<div className="prod-pillar-label">
								{totalLines > 0 ? "Código asistido entregado" : "Turnos completados"}
							</div>
						</div>
						<div className="prod-pillar-footer">
							<span>
								{k.turns} turnos en {k.sessions} sesiones
							</span>
							<span className="prod-dot">·</span>
							<span>{(k.turns / Math.max(k.sessions, 1)).toFixed(1)} tur/ses</span>
						</div>
					</div>

					{/* Pilar 3: Costo & Eficiencia */}
					<div className="prod-pillar-card">
						<div className="prod-pillar-head">
							<span className="prod-pillar-title">COSTO & EFICIENCIA</span>
							<span className="prod-pillar-badge badge-verified">
								<Codicon name="check" size={10} /> Medido con Logs
							</span>
						</div>
						<div className="prod-pillar-main">
							<div className="prod-pillar-metric">${k.cost.toFixed(2)}</div>
							<div className="prod-pillar-label">
								${avgCostPerTurn.toFixed(3)} USD / turno
							</div>
						</div>
						<div className="prod-pillar-footer">
							<span className={`prod-tone-${cacheTone(k.cacheHitPct ?? 0)}`}>
								{(k.cacheHitPct ?? 0).toFixed(0)}% Cache Hit
							</span>
							<span className="prod-dot">·</span>
							<span>{fmtMs(k.activeMs)} activo</span>
						</div>
					</div>
				</div>

				{/* Cobertura de dimensiones SPACE */}
				<div className="prod-space-card">
					<div className="prod-space-title">
						<Codicon name="organization" size={12} /> Cobertura de dimensiones del
						framework SPACE:
					</div>
					<div className="prod-space-pills">
						<div
							className="prod-space-pill pill-ok"
							title="Medido exhaustivamente con conteo de turnos, tools y líneas asistidas"
						>
							<Codicon name="check" size={11} /> Activity (100%)
						</div>
						<div
							className="prod-space-pill pill-ok"
							title="Medido con tiempo activo, cache hit, compactaciones y ritmo de trabajo"
						>
							<Codicon name="check" size={11} /> Efficiency & Flow (100%)
						</div>
						<div
							className="prod-space-pill pill-proxy"
							title="Aproximado con señales de ejecución exitosa de herramientas"
						>
							<Codicon name="symbol-event" size={11} /> Performance (~60%)
						</div>
						<div
							className="prod-space-pill pill-pending"
							title="Dimensión perceptual: requiere encuestas de satisfacción opt-in"
						>
							<Codicon name="circle-outline" size={11} /> Satisfaction (Encuesta)
						</div>
						<div
							className="prod-space-pill pill-pending"
							title="Requiere integración con sistemas de colaboración de equipo"
						>
							<Codicon name="circle-outline" size={11} /> Communication (Org)
						</div>
					</div>
				</div>
			</div>

			{/* Sección 2: El Agente como Equipo (DX Agent Lead Model) */}
			<div className="prod-section">
				<div className="cfg-section">
					<Codicon name="organization" size={13} /> EL AGENTE COMO EQUIPO (DX AGENT
					LEAD MODEL)
				</div>

				<div className="usage-grid">
					<div className="usage-card">
						<div className="usage-card-title">
							<Codicon name="pulse" size={13} /> Telemetría de orquestación y HITL
						</div>
						<div className="prod-orchestration-grid">
							<div className="prod-orch-item">
								<span className="prod-orch-val">
									{report.behavior.subagentsLaunched}
								</span>
								<span className="prod-orch-label">Subagentes lanzados</span>
							</div>
							<div className="prod-orch-item">
								<span className="prod-orch-val">{report.behavior.questionsAsked}</span>
								<span className="prod-orch-label">Preguntas HITL</span>
							</div>
							<div className="prod-orch-item">
								<span className="prod-orch-val">{report.behavior.compactations}</span>
								<span className="prod-orch-label">Compactaciones</span>
							</div>
							<div className="prod-orch-item">
								<span className="prod-orch-val">
									{(k.turns / Math.max(k.sessions, 1)).toFixed(1)}
								</span>
								<span className="prod-orch-label">Turnos / sesión</span>
							</div>
						</div>
					</div>

					<div className="usage-card">
						<div className="usage-card-title">
							<Codicon name="tools" size={13} /> Capacidades avanzadas habilitadas
						</div>
						<div className="prod-capabilities-list">
							<div className="prod-cap-row">
								<div className="prod-cap-info">
									<Codicon name="browser" size={13} />
									<span>Navegador Web (`agent_browser`)</span>
								</div>
								<span
									className={`prod-cap-status ${report.adoption.browserUsed ? "active" : "ready"}`}
								>
									{report.adoption.browserUsed ? "Activo" : "Disponible"}
								</span>
							</div>

							<div className="prod-cap-row">
								<div className="prod-cap-info">
									<Codicon name="search" size={13} />
									<span>Búsqueda Semántica (`codebase-index`)</span>
								</div>
								<span
									className={`prod-cap-status ${report.adoption.contextToolUsed ? "active" : "ready"}`}
								>
									{report.adoption.contextToolUsed ? "Activo" : "Disponible"}
								</span>
							</div>

							<div className="prod-cap-row">
								<div className="prod-cap-info">
									<Codicon name="organization" size={13} />
									<span>Subagentes Autónomos (`Agent`)</span>
								</div>
								<span
									className={`prod-cap-status ${report.adoption.subagentsUsed ? "active" : "ready"}`}
								>
									{report.adoption.subagentsUsed ? "Activo" : "Disponible"}
								</span>
							</div>

							<div className="prod-cap-row">
								<div className="prod-cap-info">
									<Codicon name="mic" size={13} />
									<span>Dictado por Voz</span>
								</div>
								<span className="prod-cap-status roadmap">Próximo (#95)</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Sección 3: Ritmo de Desarrollo & Flow (SPACE-E) */}
			<div className="prod-section">
				<div className="cfg-section">
					<Codicon name="graph" size={13} /> RITMO DE DESARROLLO & FLOW (SPACE-E)
				</div>

				<div className="prod-flow-card">
					<div className="prod-flow-metrics">
						<div className="prod-flow-metric-item">
							<Codicon name="clock" size={14} />
							<div>
								<div className="prod-flow-val">{fmtMs(k.activeMs)}</div>
								<div className="prod-flow-lbl">Tiempo activo</div>
							</div>
						</div>

						<div className="prod-flow-metric-item">
							<Codicon name="zap" size={14} />
							<div>
								<div className="prod-flow-val">
									{fmt(
										k.avgTurnTokens ||
											Math.round((k.tokensIn + k.tokensOut) / Math.max(k.turns, 1)),
									)}
								</div>
								<div className="prod-flow-lbl">Tokens / turno</div>
							</div>
						</div>

						<div className="prod-flow-metric-item">
							<Codicon name="flame" size={14} />
							<div>
								<div className="prod-flow-val">{peakHour}:00 hrs</div>
								<div className="prod-flow-lbl">Hora pico</div>
							</div>
						</div>

						<div className="prod-flow-metric-item">
							<Codicon name="layers" size={14} />
							<div>
								<div className="prod-flow-val">{k.sessions}</div>
								<div className="prod-flow-lbl">Sesiones activas</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Sección 4: Preparación DORA & Flow Framework */}
			<div className="prod-section">
				<div className="cfg-section">
					<Codicon name="cloud-upload" size={13} /> PREPARACIÓN DORA & FLOW FRAMEWORK
					(EXPORT)
				</div>

				<div className="prod-dora-card">
					<div className="prod-dora-info">
						<div className="prod-dora-title">
							Principio: «Frida etiqueta telemetría; el concentrador externo cruza»
						</div>
						<div className="prod-dora-desc">
							Los marcos organizacionales como DORA (lead time a producción, deployment
							frequency) y FLOW Framework (value streams de negocio) requieren cruzar
							datos de CI/CD y despliegues. Frida genera y etiqueta los insumos de
							desarrollo en formato estándar versionado{" "}
							<code>frida-usage-report/v1</code>.
						</div>
					</div>
					<div className="prod-dora-actions">
						<button
							type="button"
							className="btn btn-secondary prod-export-btn"
							onClick={handleCopyReport}
						>
							<Codicon name={copied ? "check" : "copy"} size={13} />
							{copied ? "¡Reporte JSON Copiado!" : "Copiar JSON Telemetría (v1)"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
