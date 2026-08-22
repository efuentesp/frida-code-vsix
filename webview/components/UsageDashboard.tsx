import { useEffect, useState } from "react";
import type { OutMessage, State, UsagePeriod } from "../types";
import { Codicon } from "./Codicon";
import { BarChart } from "./usage/BarChart";
import { DonutChart } from "./usage/DonutChart";
import { Heatmap } from "./usage/Heatmap";
import { KPICard } from "./usage/KPICard";

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

// Etiqueta legible de una sesión: su primer prompt (firstMessage) o, si no, el
// nombre del archivo (timestamp+UUID). Paridad con SessionsPanel (name||firstMessage).
function sessionLabel(s: {
	name?: string;
	firstMessage: string;
	path: string;
}): string {
	if (s.name) return s.name;
	if (s.firstMessage) return s.firstMessage;
	return (s.path.split(/[/\\]/).pop() ?? s.path).replace(/\.jsonl$/, "");
}

// --- Tooltips de los KPIs de tokens y cache hit ---
// Total de tokens: qué incluye y cómo compararlo contra lo que reporta el proveedor.
const TOKENS_TIP = [
	"Total de tokens procesados = entrada + caché (leída + escrita) + salida.",
	"",
	"• Entrada: contexto nuevo de cada turno (tu mensaje + archivos/herramientas que no estaban en caché).",
	"• Caché leída: contexto de turnos previos que se reutiliza. Es la mayor parte del total y se factura con descuento.",
	"• Caché escrita: contexto nuevo que se guarda en caché para reusar después.",
	"• Salida: lo que generó el modelo.",
	"",
	"No incluye razonamiento (thinking): si tu proveedor sí lo cuenta, su total será un poco mayor.",
	"",
	"Comparación con el proveedor: coincide con su «total de tokens» (entrada + salida + caché). Si solo reporta entrada + salida sin caché, su cifra será mucho menor. Para comparar $ usa el KPI «Costo»: la caché se factura a otro precio, así que los tokens no escalan 1:1 con el dinero.",
].join("\n");

// Banda de eficiencia del cache hit → tono de color del número (lente costo:
// alto = bueno, la mayor parte del contexto se relee barato).
function cacheTone(pct: number): "ok" | "warn" | "bad" {
	if (pct >= 70) return "ok";
	if (pct >= 40) return "warn";
	return "bad";
}

// Tooltip del cache hit: explica qué son los tokens de caché + rangos + consejo
// del rango ACTUAL del usuario (para que sepa qué hacer en su situación).
function cacheTip(pct: number): string {
	const advice =
		pct >= 70
			? "Mantén sesiones continuas y un system prompt estable para conservar el reuso; si el contexto crece mucho, vigila calidad y latencia (no el costo)."
			: pct >= 40
				? "Sube el reuso: alarga sesiones continuas, evita reiniciar contexto seguido y mantén estables el system prompt y las tools."
				: "Estás pagando casi todo a precio lleno. Suele indicar turnos sueltos o contexto muy cambiante: agrupa trabajo relacionado en la misma sesión.";
	return [
		"Cache hit = % del contexto de entrada que se sirve desde caché (precio de descuento) en vez de a precio lleno.",
		"",
		"• Caché leída: contexto de turnos previos reutilizado (barato).",
		"• Caché escrita: contexto nuevo guardado para reusar después.",
		"",
		"Rangos: ≥ 70% eficiente · 40–69% a revisar · < 40% actuar.",
		"",
		`Tu caso (${pct.toFixed(0)}%): ${advice}`,
		"",
		"Nota: un % alto también es típico de sesiones largas (mucho historial releído). Es bueno para el costo; si degrada calidad o latencia, vigila el tamaño de contexto por turno, no este %.",
	].join("\n");
}

// Tab "Uso" rediseñado (#101 — Opción 2: Developer Velocity & Telemetry Stream):
// Banner ejecutivo de velocidad + 6 KPIs + telemetría de código asistido,
// ritmo de actividad, herramientas invocadas y timeline de sesiones.
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
	if (!ur || ur.period !== period || ur.scope !== scope) {
		return (
			<div className="cfg-stub">
				<Codicon name="loading" size={14} spin /> Cargando telemetría de uso...
			</div>
		);
	}

	const report = ur.report;
	if (!report || report.kpis.sessions === 0) {
		return (
			<div className="cfg-stub">
				Sin datos de uso{scope === "project" ? " de este proyecto" : ""} en este periodo todavía.
			</div>
		);
	}

	const k = report.kpis;
	const showProj = scope === "all";
	const totalLines = report.breakdowns.byFileType.reduce(
		(acc, f) => acc + Math.round(f.assistedKloc * 1000),
		0,
	);

	return (
		<div className="usage-dashboard">
			{/* Barra de control superior: Ámbito y Periodo */}
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
							className={
								"usage-period-btn" + (period === p.id ? " active" : "")
							}
							onClick={() => setPeriod(p.id)}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			{/* Banner Ejecutivo de Velocidad de Desarrollo */}
			<div className="usage-velocity-banner">
				<div className="usage-velocity-left">
					<div className="usage-velocity-icon-wrap">
						<Codicon name="pulse" size={20} className="usage-velocity-icon" />
					</div>
					<div className="usage-velocity-info">
						<div className="usage-velocity-title">
							Velocidad y Telemetría de Desarrollo
						</div>
						<div className="usage-velocity-subtitle">
							<span>Código Asistido: <strong>{fmt(totalLines)} líneas</strong></span>
							<span className="usage-velocity-dot">·</span>
							<span>Tokens: <strong>{fmt(k.tokensIn + k.tokensOut)}</strong></span>
							<span className="usage-velocity-dot">·</span>
							<span>Inversión: <strong>${k.cost.toFixed(2)} USD</strong></span>
						</div>
					</div>
				</div>

				<div className="usage-velocity-right">
					<div
						className={`usage-cache-badge tone-${cacheTone(k.cacheHitPct ?? 0)}`}
						title={cacheTip(k.cacheHitPct ?? 0)}
					>
						<Codicon name="sparkle" size={13} />
						<span>Cache Hit: {(k.cacheHitPct ?? 0).toFixed(0)}%</span>
					</div>
					<div className="usage-time-tag">
						<Codicon name="clock" size={12} />
						<span>{fmtMs(k.activeMs)} activo</span>
					</div>
				</div>
			</div>

			{/* 6 Tarjetas KPI Clave */}
			<div className="usage-kpis">
				<KPICard
					label="Tokens ↑↓"
					value={fmt(k.tokensIn + k.tokensOut)}
					tip={TOKENS_TIP}
					tipSide="bottom-right"
					wide
				/>
				<KPICard label="Costo Est." value={"$" + k.cost.toFixed(2)} />
				<KPICard
					label="Código Asistido"
					value={totalLines > 0 ? `${fmt(totalLines)} lin` : "—"}
					tip="Líneas de código generadas, modificadas o inspeccionadas con asistencia de IA."
				/>
				<KPICard
					label="Sesiones / Turnos"
					value={`${k.sessions} ses / ${k.turns} tur`}
					tip={`Promedio de ${k.sessions > 0 ? (k.turns / k.sessions).toFixed(1) : 0} turnos por sesión.`}
				/>
				<KPICard
					label="Cache Hit"
					value={(k.cacheHitPct ?? 0).toFixed(0) + "%"}
					tip={cacheTip(k.cacheHitPct ?? 0)}
					tone={cacheTone(k.cacheHitPct ?? 0)}
					tipSide="bottom-left"
					wide
				/>
				<KPICard
					label="Tiempo Activo"
					value={fmtMs(k.activeMs)}
					tip="Tiempo total transcurrido con el modelo generando o ejecutando herramientas."
				/>
			</div>

			{/* Sección 1: Ritmo y Actividad en el Tiempo */}
			<div className="usage-section-group">
				<div className="cfg-section">
					<Codicon name="graph" size={13} /> RITMO Y ACTIVIDAD EN EL TIEMPO
				</div>
				<div className="usage-grid">
					<div className="usage-card">
						<div className="usage-card-title">
							<Codicon name="graph-line" size={13} /> Consumo de tokens por día
						</div>
						<BarChart
							format={fmt}
							data={report.breakdowns.byDay.map((d) => ({
								label: d.date.slice(5),
								value: d.tokens,
							}))}
						/>
					</div>
					<div className="usage-card">
						<div className="usage-card-title">
							<Codicon name="calendar" size={13} /> Actividad por hora y día de la semana
						</div>
						<Heatmap
							hours={report.breakdowns.byHour}
							dows={report.breakdowns.byDow}
						/>
					</div>
				</div>
			</div>

			{/* Sección 2: Impacto en el Código y Herramientas del Agente */}
			<div className="usage-section-group">
				<div className="cfg-section">
					<Codicon name="code" size={13} /> IMPACTO EN EL CÓDIGO Y HERRAMIENTAS
				</div>
				<div className="usage-grid">
					<div className="usage-card">
						<div className="usage-card-title">
							<Codicon name="file-code" size={13} /> Código asistido por tipo de archivo (líneas)
						</div>
						<BarChart
							horizontal
							data={report.breakdowns.byFileType.slice(0, 8).map((l) => ({
								label: l.fileType,
								value: Math.round(l.assistedKloc * 1000),
								hint: l.family,
								valText: `${fmt(Math.round(l.assistedKloc * 1000))} lin · ${fmt(l.tokens)} tok`,
							}))}
						/>
					</div>
					<div className="usage-card">
						<div className="usage-card-title">
							<Codicon name="tools" size={13} /> Top herramientas invocadas (tokens)
						</div>
						<BarChart
							horizontal
							format={fmt}
							data={report.breakdowns.byTool.slice(0, 8).map((t) => ({
								label: t.tool,
								value: Math.round(t.tokens),
								hint: `${t.count} llamadas`,
							}))}
						/>
					</div>
				</div>
			</div>

			{/* Sección 3: Modelos Utilizados y Adopción */}
			<div className="usage-section-group">
				<div className="cfg-section">
					<Codicon name="pie-chart" size={13} /> MODELOS UTILIZADOS Y ADOPCIÓN
				</div>
				<div className="usage-grid">
					<div className="usage-card">
						<div className="usage-card-title">
							<Codicon name="pie-chart" size={13} /> Distribución por modelo
						</div>
						<DonutChart
							data={report.breakdowns.byModel.map((m) => ({
								label: m.model,
								value: m.tokens,
							}))}
						/>
					</div>
					<div className="usage-card">
						<div className="usage-card-title">
							<Codicon name="sparkle" size={13} /> Adopción de capacidades avanzadas
						</div>
						<div className="usage-adoption-list">
							<div className="usage-adoption-row">
								<div className="usage-adoption-icon">
									<Codicon name="organization" size={15} />
								</div>
								<div className="usage-adoption-info">
									<span className="usage-adoption-name">Subagentes concurrentes</span>
									<span className="usage-adoption-desc">Agentes secundarios lanzados en background</span>
								</div>
								<span className="usage-adoption-val">
									{report.behavior.subagentsLaunched} lanzados
								</span>
							</div>

							<div className="usage-adoption-row">
								<div className="usage-adoption-icon">
									<Codicon name="question" size={15} />
								</div>
								<div className="usage-adoption-info">
									<span className="usage-adoption-name">Preguntas interactivas</span>
									<span className="usage-adoption-desc">Cuestionarios ask_user_question respondidos</span>
								</div>
								<span className="usage-adoption-val">
									{report.behavior.questionsAsked} preguntas
								</span>
							</div>

							<div className="usage-adoption-row">
								<div className="usage-adoption-icon">
									<Codicon name="fold" size={15} />
								</div>
								<div className="usage-adoption-info">
									<span className="usage-adoption-name">Compactaciones de contexto</span>
									<span className="usage-adoption-desc">Podas automáticas para ahorrar tokens</span>
								</div>
								<span className="usage-adoption-val">
									{report.behavior.compactations} podas
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Sección 4: Sesiones Recientes */}
			<div className="usage-section-group">
				<div className="cfg-section">
					<Codicon name="history" size={13} /> SESIONES RECIENTES DE DESARROLLO
				</div>
				<div className="usage-sessions-card">
					<div className="usage-sessions-list">
						{report.sessions.slice(0, 10).map((s) => (
							<div key={s.path} className="usage-session-item">
								<div className="usage-session-icon">
									<Codicon name="comment-discussion" size={14} />
								</div>
								<div className="usage-session-main">
									<div className="usage-session-title-row">
										<span
											className="usage-session-title"
											title={s.name || s.firstMessage || s.path}
										>
											{sessionLabel(s)}
										</span>
										{showProj && projOf(s.cwd) ? (
											<span className="usage-session-proj-badge">
												{projOf(s.cwd)}
											</span>
										) : null}
									</div>
									<div className="usage-session-meta-row">
										<span>{s.turns} {s.turns === 1 ? "turno" : "turnos"}</span>
										<span className="usage-session-dot">·</span>
										<span>{fmt(s.tokensIn + s.tokensOut)} tokens</span>
										{s.lastTs > s.firstTs ? (
											<>
												<span className="usage-session-dot">·</span>
												<span>{fmtMs(s.lastTs - s.firstTs)}</span>
											</>
										) : null}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
