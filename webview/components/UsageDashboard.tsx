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
			? "🟢 Mantén sesiones continuas y un system prompt estable para conservar el reuso; si el contexto crece mucho, vigila calidad y latencia (no el costo)."
			: pct >= 40
				? "🟡 Sube el reuso: alarga sesiones continuas, evita reiniciar contexto seguido y mantén estables el system prompt y las tools."
				: "🔴 Estás pagando casi todo a precio lleno. Suele indicar turnos sueltos o contexto muy cambiante: agrupa trabajo relacionado en la misma sesión.";
	return [
		"Cache hit = % del contexto de entrada que se sirve desde caché (precio de descuento) en vez de a precio lleno.",
		"",
		"• Caché leída: contexto de turnos previos reutilizado (barato).",
		"• Caché escrita: contexto nuevo guardado para reusar después.",
		"",
		"Rangos: 🟢 ≥ 70% eficiente · 🟡 40–69% a revisar · 🔴 < 40% actuar.",
		"",
		`Tu caso (${pct.toFixed(0)}%): ${advice}`,
		"",
		"Nota: un % alto también es típico de sesiones largas (mucho historial releído). Es bueno para el costo; si degrada calidad o latencia, vigila el tamaño de contexto por turno, no este %.",
	].join("\n");
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
			<div className="usage-kpis">
				<KPICard
					label="Tokens ↑↓"
					value={fmt(k.tokensIn + k.tokensOut)}
					tip={TOKENS_TIP}
					tipSide="bottom-right"
					wide
				/>
				<KPICard label="Costo" value={"$" + k.cost.toFixed(2)} />
				<KPICard label="Sesiones" value={String(k.sessions)} />
				<KPICard label="Turnos" value={String(k.turns)} />
				<KPICard
					label="Cache hit"
					value={(k.cacheHitPct ?? 0).toFixed(0) + "%"}
					tip={cacheTip(k.cacheHitPct ?? 0)}
					tone={cacheTone(k.cacheHitPct ?? 0)}
					tipSide="bottom-left"
					wide
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
					<div className="usage-card-title">Top herramientas (tokens)</div>
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
				<div className="usage-card">
					<div className="usage-card-title">
						Artefactos por tipo de archivo (KLOCs)
					</div>
					<BarChart
						horizontal
						data={report.breakdowns.byFileType.slice(0, 8).map((l) => ({
							label: l.fileType,
							value: Math.round(l.assistedKloc * 1000),
							hint: l.family,
							valText: `${fmt(Math.round(l.assistedKloc * 1000))} · ${fmt(l.tokens)} tok`,
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
								<span
									className="usage-session-name"
									title={s.name || s.firstMessage || s.path}
								>
									{sessionLabel(s)}
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
