// M3 (#144) — tab "Sonar" del SettingsHub: quality gate local tipo SonarQube
// sobre pi-lens (frida-sonar). Muestra el veredicto por familias del último
// turno (PASS/WARN/FAIL), el diff +N -M contra el snapshot del turno anterior,
// las issues actuales por familia (clic → open_file, reuso M2), la tendencia
// del historial persistido, las degradaciones honestas (familias frías,
// timeouts) y el gate completo bajo demanda (FR-7: botón + progreso +
// resultado enriquecido). Contrato {state, post}; carga al montar (molde
// ProductivityTab.tsx:44-47) vía sonar_gate refresh; la verdad del estado
// vive en el host (state.sonar ← sonar_gate_state, replace plano — D4; el
// badge del chat lee el MISMO campo).
//
// NFR UX: es-MX, codicons (sin glifos unicode), variables --vscode-*,
// prefijo .sn- conforme a docs/webview-ui-styles.md. NFR secrets: las issues
// sólo renderizan refs (path:line + regla/tool) — NUNCA message.

import { useEffect } from "react";
import type {
	OutMessage,
	SonarFamily,
	SonarFullGateState,
	SonarIssueUi,
	SonarTurnData,
	SonarUiState,
	SonarVerdict,
	State,
} from "../types";
import { Codicon } from "./Codicon";

/** Orden de presentación de las familias — espejo visual de SONAR_FAMILIES
 *  (src/sonar/gate.ts; builds separados: la lib congela el orden por test,
 *  la UI duplica las 8 etiquetas para render). */
const FAMILY_ORDER: readonly SonarFamily[] = [
	"errores",
	"secrets",
	"cve",
	"warnings",
	"complejidad",
	"dup",
	"ciclos",
	"dead-code",
];

/** Etiquetas es-MX por familia (FR-3). */
const FAMILY_LABEL: Record<SonarFamily, string> = {
	errores: "errores",
	secrets: "secrets",
	cve: "CVEs",
	warnings: "warnings",
	complejidad: "complejidad",
	dup: "duplicación",
	ciclos: "ciclos",
	"dead-code": "dead code",
};

/** Meta visual del veredicto: codicon + clase de color (molde pm-badge).
 *  Exportado para el badge de la franja (Slice 5 — «el badge reusa helpers
 *  visuales del tab», Ordering Constraint). */
export const VERDICT_META: Record<
	SonarVerdict,
	{ label: string; icon: string; cls: string }
> = {
	pass: { label: "PASS", icon: "pass", cls: "is-pass" },
	warn: { label: "WARN", icon: "warning", cls: "is-warn" },
	fail: { label: "FAIL", icon: "error", cls: "is-fail" },
	"no-data": { label: "SIN DATOS", icon: "circle-slash", cls: "is-nodata" },
};

/** HH:MM:SS local sin dependencia de locale (determinista en render). */
function fmtTime(ts: number): string {
	const d = new Date(ts);
	const p = (n: number): string => String(n).padStart(2, "0");
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** mm:ss transcurridos desde busySince (#111). Foto al render: el host
 *  re-postea sonar_gate_state con cada tick de progreso (throttle 250ms del
 *  productor), así el reloj avanza sin timers propios del webview. */
function fmtElapsed(since: number): string {
	const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Agrupa issues por familia (el orden de render sale de FAMILY_ORDER). */
function groupByFamily(
	issues: readonly SonarIssueUi[],
): Partial<Record<SonarFamily, SonarIssueUi[]>> {
	const out: Partial<Record<SonarFamily, SonarIssueUi[]>> = {};
	for (const i of issues) {
		(out[i.family] ??= []).push(i);
	}
	return out;
}

/** Chips de las 8 familias (FR-3) con estados honestos: conteo, deshabilitada
 *  (setting, D3) y fría «/nd» (FR-4). Compartidos por el bloque del turno y
 *  el resultado del gate completo (FR-7) — un render, cero duplicación. */
function SonarFamiliesChips({
	counts,
	disabled,
	unavailable,
}: {
	counts: Partial<Record<SonarFamily, number>>;
	disabled: ReadonlySet<SonarFamily>;
	unavailable: ReadonlyMap<string, string>;
}) {
	return (
		<div className="sn-families">
			{FAMILY_ORDER.map((f) => {
				const nd = unavailable.get(f);
				const cls =
					"sn-chip" + (disabled.has(f) ? " is-off" : "") + (nd ? " is-nd" : "");
				const title = nd
					? `no disponible — ${nd}`
					: disabled.has(f)
						? "deshabilitada (frida.sonar.disabledFamilies)"
						: undefined;
				return (
					<span key={f} className={cls} title={title}>
						{FAMILY_LABEL[f]} {counts[f] ?? 0}
						{nd ? "/nd" : ""}
					</span>
				);
			})}
		</div>
	);
}

/** Secciones de issues por familia (FR-8): clic → abrir archivo en la línea
 *  (open_file, reuso M2). Compartidas turno/gate completo. Sin issues → nota
 *  explícita (ausencia de hallazgos no es vacío silencioso). */
function SonarIssueLists({
	issues,
	post,
}: {
	issues: readonly SonarIssueUi[];
	post: (m: OutMessage) => void;
}) {
	if (issues.length === 0) {
		return (
			<div className="sn-note">
				<Codicon name="check" size={11} />
				<span>
					Sin issues abiertas en las familias cubiertas por el bus (archivos editados
					esta sesión).
				</span>
			</div>
		);
	}
	const grouped = groupByFamily(issues);
	return (
		<>
			{FAMILY_ORDER.map((f) => {
				const list = grouped[f] ?? [];
				if (list.length === 0) return null;
				return (
					<section key={f} className="sn-list">
						<h4 className="sn-list-title">
							{FAMILY_LABEL[f]} ({list.length})
						</h4>
						{list.map((i) => (
							<button
								key={i.key}
								type="button"
								className={
									"sn-issue" + (i.severity === "error" ? " is-error" : " is-warning")
								}
								title={`abrir ${i.path}${i.line === undefined ? "" : `:${i.line}`}`}
								onClick={() => post({ type: "open_file", file: i.path, line: i.line })}
							>
								<span className="sn-issue-main">
									{i.path}
									{i.line === undefined ? "" : `:${i.line}`}
								</span>
								<span className="sn-issue-meta">
									{[i.rule, i.tool].filter(Boolean).join(" · ")}
								</span>
							</button>
						))}
					</section>
				);
			})}
		</>
	);
}

export function SonarTab({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	// Carga al montar: el host responde SIEMPRE con sonar_gate_state (case
	// delgado, molde M2) — sin spinner eterno.
	useEffect(() => {
		post({ type: "sonar_gate", action: "refresh" });
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const sonar = state.sonar;
	const fg =
		sonar && sonar.status !== "not-installed" ? sonar.fullGate : undefined;
	const disabledSet = new Set(sonar?.settings.disabledFamilies ?? []);
	const body = sonar ? (
		sonar.status === "not-installed" ? (
			// FR-10/D9: degradación accionable SIN botón de reintento (instalar
			// pi-lens requiere pasos manuales; reintentar no cambia nada).
			<div className="cfg-stub sn-empty">
				<Codicon name="package" size={16} />
				<span>{sonar.hint}</span>
			</div>
		) : sonar.status === "no-data" || sonar.status === "error" ? (
			<div className="cfg-stub sn-empty">
				<Codicon name={sonar.status === "error" ? "warning" : "info"} size={16} />
				<span>{sonar.hint ?? "Aún no hay un gate de este turno."}</span>
				<button
					type="button"
					className="sn-retry"
					onClick={() => post({ type: "sonar_gate", action: "refresh" })}
				>
					Reintentar
				</button>
			</div>
		) : (
			<SonarReady
				sonar={sonar}
				post={post}
				fullGate={fg}
				disabledSet={disabledSet}
			/>
		)
	) : (
		<div className="cfg-stub">
			<Codicon name="loading" size={14} spin /> Cargando gate de calidad…
		</div>
	);

	return (
		<div className="sn-tab">
			<div className="sn-head">
				<span className="sn-title">
					<Codicon name="shield" size={14} />
					<span>Quality gate de código estático (frida-sonar)</span>
				</span>
				{/* D9: en not-installed NINGÚN botón (ni Recargar ni gate completo):
						el refresh no cambia nada sin recargar Frida. */}
				{sonar?.status !== "not-installed" && (
					<>
						{/* FR-7 — gate completo bajo demanda: tool viva mode=full +
								refreshRunners=all (hasta 5 min, wall-clock interno del productor);
								busy lo deshabilita (guard reentrancia adicional en el host). */}
						<button
							type="button"
							className="pc-save"
							disabled={fg?.busy === true}
							title="Escaneo completo del proyecto (lens_diagnostics mode=full con analizadores, hasta 5 min): LSP + jscpd, madge, knip, gitleaks, trivy, dead-code"
							onClick={() => post({ type: "sonar_gate", action: "run_full_gate" })}
						>
							<Codicon name="run-all" size={13} />
							<span>Ejecutar gate completo</span>
						</button>
						<button
							type="button"
							className="pc-save"
							onClick={() => post({ type: "sonar_gate", action: "refresh" })}
						>
							<Codicon name="refresh" size={13} />
							<span>Recargar</span>
						</button>
					</>
				)}
			</div>
			{body}
		</div>
	);
}

/** Cuerpo ready: veredicto + diff + familias + issues + tendencia + full gate. */
function SonarReady({
	sonar,
	post,
	fullGate,
	disabledSet,
}: {
	sonar: Extract<SonarUiState, { status: "ready" }>;
	post: (m: OutMessage) => void;
	fullGate?: SonarFullGateState;
	disabledSet: ReadonlySet<SonarFamily>;
}) {
	const d = sonar.data;
	const meta = VERDICT_META[d.verdict];
	const unavailable = new Map(
		d.familiesUnavailable.map((f) => [f.family, f.cause] as const),
	);
	const trendMax = Math.max(1, ...d.trend.map((t) => t.warnings));

	return (
		<>
			{/* Veredicto del turno + diff contra el snapshot anterior (FR-2/FR-8) */}
			<div className="sn-verdict-row">
				<span
					className={"sn-verdict " + meta.cls}
					title={`${d.blocking} blocking · ${d.errors} errores · ${d.effectiveWarnings} warnings efectivas (de ${d.warnings})`}
				>
					<Codicon name={meta.icon} size={14} />
					<span>{meta.label}</span>
				</span>
				<span
					className="sn-diff"
					title="Issues nuevas (+) y resueltas (-) contra el snapshot del turno anterior"
				>
					<span className="sn-diff-add">
						<Codicon name="diff-added" size={11} />+{d.diff.added}
					</span>
					<span className="sn-diff-res">
						<Codicon name="diff-removed" size={11} />-{d.diff.resolved}
					</span>
				</span>
				<span className="sn-meta">· turno cerrado a las {fmtTime(d.ts)}</span>
			</div>

			{/* Degradaciones honestas (FR-4: ausencia de datos NO es PASS limpio) */}
			{d.degraded && (
				<div className="sn-note is-warn">
					<Codicon name="warning" size={11} />
					<span>Gate degradado: {d.causes.join(" · ")}</span>
				</div>
			)}
			{d.familiesUnavailable.length > 0 && (
				<div className="sn-note">
					<Codicon name="circle-slash" size={11} />
					<span>
						Sin datos:{" "}
						{d.familiesUnavailable.map((f) => `${f.family} (${f.cause})`).join(" · ")}
					</span>
				</div>
			)}

			{/* Familias (FR-3): conteos, deshabilitadas (setting) y frías (/nd) */}
			<SonarFamiliesChips
				counts={d.countsPorFamilia}
				disabled={disabledSet}
				unavailable={unavailable}
			/>

			{/* Issues por familia (FR-8): clic → abrir archivo en la línea (M2) */}
			<SonarIssueLists issues={d.issues} post={post} />

			{/* Avisos honestos de truncado */}
			{d.issuesTruncated && (
				<div className="sn-note">
					<Codicon name="layers" size={11} />
					<span>Lista truncada a 400 issues por el presupuesto del mensaje.</span>
				</div>
			)}
			{d.busTruncated && (
				<div className="sn-note">
					<Codicon name="warning" size={11} />
					<span>
						Algunos archivos llegaron al tope del bus (12 diagnósticos por
						archivo/evento): el conteo real puede ser mayor.
					</span>
				</div>
			)}
			{/* Limitación documentada (D3): best-effort de disabledFamilies */}
			<div className="sn-note">
				<Codicon name="info" size={11} />
				<span>
					duplicación/ciclos/dead-code sólo aportan totales en el gate completo (sus
					hallazgos no viajan per-issue por el bus).
				</span>
			</div>

			{/* Tendencia del snapshot histórico (FR-8) — barras, sin glifos */}
			{d.trend.length > 0 && (
				<section className="sn-list">
					<h4 className="sn-list-title">
						<Codicon name="history" size={12} />
						Tendencia (últimos {d.trend.length} turno
						{d.trend.length === 1 ? "" : "s"})
					</h4>
					<div
						className="sn-trend"
						role="img"
						aria-label="Tendencia del veredicto por turno"
					>
						{d.trend.map((t, idx) => {
							const m = VERDICT_META[t.verdict];
							const h = 4 + Math.round((t.warnings / trendMax) * 20);
							return (
								<span
									key={`${t.ts}-${idx}`}
									className={"sn-trend-bar " + m.cls}
									style={{ height: `${h}px` }}
									title={`${fmtTime(t.ts)} · ${m.label} · ${t.warnings} warning${t.warnings === 1 ? "" : "s"}`}
								/>
							);
						})}
					</div>
				</section>
			)}

			<SonarFullGateSection
				fullGate={fullGate}
				post={post}
				disabledSet={disabledSet}
			/>

			{/* Umbrales activos (FR-5/D7: el host los lee en vivo del setting) */}
			<div className="sn-meta">
				Umbrales activos: maxWarnings {sonar.settings.maxWarnings} · familias
				deshabilitadas: {""}
				{sonar.settings.disabledFamilies.length === 0
					? "ninguna"
					: sonar.settings.disabledFamilies
							.map((f) => FAMILY_LABEL[f])
							.join(", ")}{" "}
				· historial {sonar.settings.historyLimit}
			</div>
		</>
	);
}

/** FR-7 — gate completo bajo demanda: progreso en vivo (busy + lastLine +
 *  reloj desde busySince, #111) y resultado enriquecido al terminar. Null si
 *  nunca corrió. */
function SonarFullGateSection({
	fullGate,
	post,
	disabledSet,
}: {
	fullGate?: SonarFullGateState;
	post: (m: OutMessage) => void;
	disabledSet: ReadonlySet<SonarFamily>;
}) {
	const fg = fullGate;
	if (!fg || (!fg.busy && !fg.lastLine && !fg.result)) return null;
	return (
		<section className="sn-list">
			<h4 className="sn-list-title">
				<Codicon name="search" size={12} />
				<span>Gate completo (bajo demanda)</span>
			</h4>
			{fg.busy && (
				<div className="sn-note is-warn">
					<Codicon name="loading" size={11} spin />
					<span>
						Ejecutando gate completo…{" "}
						{fg.busySince === null ? "" : `(${fmtElapsed(fg.busySince)}) `}
						{fg.lastLine ?? "preparando el escaneo (puede tardar hasta 5 min)"}
					</span>
				</div>
			)}
			{!fg.busy && fg.lastLine && !fg.result && (
				<div className="sn-note is-warn">
					<Codicon name="warning" size={11} />
					<span>{fg.lastLine}</span>
				</div>
			)}
			{fg.result && (
				<SonarFullGateResult
					data={fg.result}
					post={post}
					disabledSet={disabledSet}
				/>
			)}
		</section>
	);
}

/** Resultado del gate completo: veredicto sobre los AGREGADOS del full (los
 *  analizadores pesados sólo aportan totales aquí — asimetría del
 *  full-scan), diff informativo contra el último snapshot persistido (el
 *  historial sólo registra turnos, FR-9) y desglose per-issue del
 *  consolidado post-escaneo. */
function SonarFullGateResult({
	data,
	post,
	disabledSet,
}: {
	data: SonarTurnData;
	post: (m: OutMessage) => void;
	disabledSet: ReadonlySet<SonarFamily>;
}) {
	const meta = VERDICT_META[data.verdict];
	const unavailable = new Map(
		data.familiesUnavailable.map((f) => [f.family, f.cause] as const),
	);
	return (
		<>
			<div className="sn-verdict-row">
				<span
					className={"sn-verdict " + meta.cls}
					title={`${data.blocking} blocking · ${data.errors} errores · ${data.effectiveWarnings} warnings efectivas (de ${data.warnings})`}
				>
					<Codicon name={meta.icon} size={14} />
					<span>{meta.label}</span>
				</span>
				<span
					className="sn-diff"
					title="Issues del escaneo completo contra el último snapshot persistido (diff informativo: el historial sólo registra turnos)"
				>
					<span className="sn-diff-add">
						<Codicon name="diff-added" size={11} />+{data.diff.added}
					</span>
					<span className="sn-diff-res">
						<Codicon name="diff-removed" size={11} />-{data.diff.resolved}
					</span>
				</span>
				<span className="sn-meta">· completado a las {fmtTime(data.ts)}</span>
			</div>
			{data.degraded && (
				<div className="sn-note is-warn">
					<Codicon name="warning" size={11} />
					<span>Gate degradado: {data.causes.join(" · ")}</span>
				</div>
			)}
			{data.familiesUnavailable.length > 0 && (
				<div className="sn-note">
					<Codicon name="circle-slash" size={11} />
					<span>
						Sin datos:{" "}
						{data.familiesUnavailable
							.map((f) => `${f.family} (${f.cause})`)
							.join(" · ")}
					</span>
				</div>
			)}
			<SonarFamiliesChips
				counts={data.countsPorFamilia}
				disabled={disabledSet}
				unavailable={unavailable}
			/>
			<SonarIssueLists issues={data.issues} post={post} />
			{data.issuesTruncated && (
				<div className="sn-note">
					<Codicon name="layers" size={11} />
					<span>Lista truncada a 400 issues por el presupuesto del mensaje.</span>
				</div>
			)}
		</>
	);
}
