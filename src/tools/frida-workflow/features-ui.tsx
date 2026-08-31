// features-ui.tsx — overlay N1 del pipeline SDD: /pipeline (FR#1).
//
// Espejo del contrato de board-ui.tsx (#169): panel colapsable del footer
// montado vía mountPersistent, con la preferencia de vista (colapsado) a
// nivel de módulo — el overlay vivo re-monta en cada cambio de features.json
// y el usuario no debe perderla. El host (mountPipelineOverlay, extension.ts)
// es el único que lee FS: suscribe subscribeFeaturesChanges +
// subscribeBoardChanges y re-monta este elemento con datos frescos (snapshot
// completo por cambio, patrón /board).
//
// Qué es DATO aquí y qué vive en el dominio (anti-drift, espejo panel-spec):
// - Columnas, etiquetas del botón y estado vacío vienen del SPEC
//   (resolvePanelSpec("sdd"); un override registrado gana), no hardcodeados.
// - El COMANDO de avance lo computa el dominio (advanceFeature pre-move,
//   AdvanceResult.command): la UI sólo dispara actions.onAdvance.
// - desync/badge/paused los aporta el host frescos en cada re-mount
//   (computeFeatureReconcile/shipBadge): la UI no toca el FS.
import { useState } from "react";
import type { ReactElement } from "react";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";
import {
	SDD_PANEL_SPEC,
	resolvePanelSpec,
	type PanelSpec,
	type PanelColumnSpec,
} from "./panel-spec";
import type { PipelineFeature, ShipBadge } from "./features";

// ── Contrato con el host (espejo BoardOverlayActions board-ui.tsx:32-50) ────

/** Feature + derivados que el host computa frescos en cada re-mount. */
export interface PipelineFeatureView extends PipelineFeature {
	/** FR#12: el FS tiene artefactos más avanzados que la tarjeta (ámbar). */
	desync: boolean;
	/** FR#6: badge «n/m fases» post-ship (shipBadge del dominio; el host lo
	 *  refresca vía subscribeBoardChanges — el board emite en cada run). */
	badge?: ShipBadge;
}

/** Banner ámbar FR#14: avance disparado sin el insumo previo en el FS. */
export interface PipelineWarning {
	/** Id de la feature que lo disparó (llave de la memoria de dismiss). */
	id: string;
	text: string;
}

/** Sección compacta del orquestador (D5): nivel + resumen, detalle en tooltip. */
export interface PipelineOrchestratorView {
	level: "ready" | "degraded" | "empty";
	/** Línea visible (ej. «orquestador v3.4.1 · hermanas 5/5»). */
	summary: string;
	/** Tooltip: conteos empaquetados + hermanas faltantes. */
	detail: string;
}

/** Snapshot fresco que el host inyecta en cada re-mount. */
export interface PipelineOverlayData {
	features: PipelineFeatureView[];
	status: PipelineOrchestratorView;
	/** FR#14 — activos (no dismissados) al momento del re-mount. */
	warnings: PipelineWarning[];
}

export interface PipelineOverlayActions {
	/** ▶ skill (FR#4): movimiento temprano + inyección del comando (host). */
	onAdvance: (id: string) => void;
	/** ▶ ship (FR#5): fases del plan → backlog del board N2, sin ejecución. */
	onShip: (id: string) => void;
	/** FR#15 — comando del estado vacío; el host resuelve el `<placeholder>`. */
	onRunEmptyCommand: (template: string) => void;
	/** FR#14 — dismiss del banner (memoria de sesión en el host). */
	onDismissWarning: (id: string) => void;
	/** Cierra el panel (unmount + desuscripciones). */
	onClose: () => void;
}

// ── Estado de módulo (sobrevive re-mounts; espejo board-ui.tsx:42) ──────────

/** Preferencia de vista del usuario (colapsado/expandido). */
let pipelinePanelCollapsed = false;

/** Título visible de una feature: reconciler topic > segmento tras el slug
 *  de fecha > basename. Compartido con el host (mensajes warn/ship). */
export function featureTitle(f: { id: string; title?: string }): string {
	if (f.title) return f.title;
	const base = f.id.split("/").pop() ?? f.id;
	return (
		base
			.replace(/\.md$/, "")
			.replace(/^\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?_/, "") || base
	);
}

/** Factory del elemento raíz del overlay N1 (mountPersistent "footer"). */
export function createPipelineOverlayElement(
	data: PipelineOverlayData,
	actions: PipelineOverlayActions,
): ReactElement {
	return <PipelinePanel data={data} actions={actions} />;
}

// ── Acentos por columna (lenguaje visual /board: charts-* por etapa) ────────

const STAGE_ACCENT: Record<string, string> = {
	discover: "var(--vscode-charts-blue, #58a6ff)",
	research: "var(--vscode-charts-purple, #c586c0)",
	design: "var(--vscode-charts-yellow, #dcdcaa)",
	plan: "var(--vscode-charts-orange, #d18616)",
	"ready-to-ship": "var(--vscode-charts-green, #4ec9b0)",
};

// ── Panel raíz ──────────────────────────────────────────────────────────────

function PipelinePanel({
	data,
	actions,
}: {
	data: PipelineOverlayData;
	actions: PipelineOverlayActions;
}): ReactElement {
	const [collapsed, setCollapsed] = useState(pipelinePanelCollapsed);
	const toggleCollapsed = (): void => {
		pipelinePanelCollapsed = !pipelinePanelCollapsed;
		setCollapsed(pipelinePanelCollapsed);
	};
	// El panel es SDD-N1 (FR#9): un override registrado gana al default.
	const spec = resolvePanelSpec("sdd") ?? SDD_PANEL_SPEC;
	const desyncCount = data.features.filter((f) => f.desync).length;

	return (
		<CollapsiblePanel
			collapsed={collapsed}
			onToggle={toggleCollapsed}
			padding={6}
			gap={6}
			cls="pl-panel"
			header={
				<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
					<ficon
						name="rocket"
						size={12}
						color="var(--vscode-textLink-foreground, #4daafc)"
					/>
					<ftext bold size={12}>
						Pipeline
					</ftext>
					<ftext
						size={11}
						cls="pl-metric"
						color="var(--vscode-descriptionForeground)"
					>
						({data.features.length})
					</ftext>
					{desyncCount > 0 ? (
						<fbox
							flexDirection="row"
							gap={2}
							alignItems="center"
							cls="pl-desync"
							title={`${desyncCount} feature(s) desincronizada(s): el FS va por delante de la tarjeta — usa ▶ para alcanzarla`}
						>
							<ficon name="sync" size={10} />
							<ftext size={10}>{desyncCount}</ftext>
						</fbox>
					) : null}
				</fbox>
			}
			actions={
				<fbox onClick={actions.onClose} cls="pl-close" title="Cerrar pipeline">
					<ficon name="x" size={12} color="#8b949e" />
				</fbox>
			}
		>
			{data.warnings.map((w) => (
				<WarningBanner key={w.id} warning={w} actions={actions} />
			))}

			{data.features.length === 0 ? (
				<EmptyState spec={spec} actions={actions} />
			) : (
				<fbox flexDirection="row" gap={8} cls="pl-board">
					{spec.columns.map((col) => {
						// Contrato spec↔dominio: feature.stage === columna por id.
						const inCol = data.features.filter((f) => f.stage === col.id);
						return (
							<fbox key={col.id} flexDirection="column" gap={6} cls="pl-col">
								<fbox flexDirection="row" gap={4} alignItems="center">
									<fbox cls="pl-col-dot" background={STAGE_ACCENT[col.id] ?? "#888"} />
									<ftext size={11} bold color="var(--vscode-descriptionForeground)">
										{col.label}
									</ftext>
									<ftext
										size={10}
										cls="pl-metric"
										color="var(--vscode-descriptionForeground)"
									>
										({inCol.length})
									</ftext>
								</fbox>
								{inCol.map((f) => (
									<FeatureCard key={f.id} feature={f} spec={spec} actions={actions} />
								))}
							</fbox>
						);
					})}
				</fbox>
			)}

			<OrchestratorSection status={data.status} />
		</CollapsiblePanel>
	);
}

// ── FR#14 — Banner ámbar dismissible ────────────────────────────────────────

function WarningBanner({
	warning,
	actions,
}: {
	warning: PipelineWarning;
	actions: PipelineOverlayActions;
}): ReactElement {
	return (
		<fbox
			flexDirection="row"
			gap={6}
			alignItems="center"
			cls="pl-warn"
			title={warning.text}
		>
			<ficon name="triangle-alert" size={11} />
			<ftext size={10} cls="pl-warn-text">
				{warning.text}
			</ftext>
			<fbox
				onClick={() => actions.onDismissWarning(warning.id)}
				cls="pl-warn-dismiss"
				title="Descartar por esta sesión"
			>
				<ficon name="x" size={10} color="var(--vscode-descriptionForeground)" />
			</fbox>
		</fbox>
	);
}

// ── FR#15 — Estado vacío: el comando que lo llena, accionable ───────────────

function EmptyState({
	spec,
	actions,
}: {
	spec: PanelSpec;
	actions: PipelineOverlayActions;
}): ReactElement {
	return (
		<fbox flexDirection="column" gap={4} cls="pl-empty">
			<ftext size={11} color="var(--vscode-descriptionForeground)">
				{spec.emptyState.hint}
			</ftext>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext size={10} cls="pl-cmd">
					{spec.emptyState.command}
				</ftext>
				<fbutton
					variant="secondary"
					onClick={() => actions.onRunEmptyCommand(spec.emptyState.command)}
					title={`${spec.emptyState.command} — el host pide el valor del placeholder`}
				>
					<ficon name="play" size={10} />
					<ftext size={11}>Ejecutar</ftext>
				</fbutton>
			</fbox>
		</fbox>
	);
}

// ── D5 — Sección compacta del orquestador (ex-banner) ───────────────────────

const ORCH_ICON: Record<PipelineOrchestratorView["level"], string> = {
	ready: "check",
	degraded: "triangle-alert",
	empty: "circle",
};

const ORCH_COLOR: Record<PipelineOrchestratorView["level"], string> = {
	ready: "var(--vscode-gitDecoration-addedResourceForeground, #3fb950)",
	degraded: "var(--vscode-list-warningForeground, #cca700)",
	empty: "var(--vscode-descriptionForeground)",
};

function OrchestratorSection({
	status,
}: {
	status: PipelineOrchestratorView;
}): ReactElement {
	return (
		<fbox
			flexDirection="row"
			gap={4}
			alignItems="center"
			cls="pl-orch"
			title={status.detail}
		>
			<ficon
				name={ORCH_ICON[status.level]}
				size={10}
				color={ORCH_COLOR[status.level]}
			/>
			<ftext size={10} color={ORCH_COLOR[status.level]}>
				{status.summary}
			</ftext>
		</fbox>
	);
}

// ── Tarjeta de feature (FR#4/#5/#6/#11/#12/#13) ─────────────────────────────

function FeatureCard({
	feature,
	spec,
	actions,
}: {
	feature: PipelineFeatureView;
	spec: PanelSpec;
	actions: PipelineOverlayActions;
}): ReactElement {
	// Contrato spec↔dominio: la columna de la tarjeta es feature.stage por id.
	const col = spec.columns.find((c) => c.id === feature.stage);
	const currentIndex = spec.columns.findIndex((c) => c.id === feature.stage);
	const accent = STAGE_ACCENT[feature.stage] ?? "#888";

	return (
		<fbox
			flexDirection="column"
			gap={4}
			cls={`pl-card${feature.desync ? " pl-card-desync" : ""}`}
		>
			{/* Renglón 1: barra de acento + título (ellipsis) + pausa (FR#11). */}
			<fbox flexDirection="row" gap={6} alignItems="center" title={feature.id}>
				<fbox cls="pl-card-bar" background={accent} />
				<ftext size={11} bold cls="pl-card-title">
					{featureTitle(feature)}
				</ftext>
				{feature.paused ? (
					<fbox
						flexDirection="row"
						alignItems="center"
						cls="pl-paused"
						title="Pausada — el avance NO está bloqueado (FR#14)"
					>
						<ficon name="debug-pause" size={10} />
					</fbox>
				) : null}
			</fbox>

			{/* Renglón 2: mini-timeline (FR#11) + ámbar desync (FR#12) + badge
			 *  n/m post-ship (FR#6) — badges indivisibles (patrón kb-badges). */}
			<fbox flexDirection="row" gap={6} alignItems="center" cls="pl-badges">
				<MiniTimeline
					spec={spec}
					currentIndex={currentIndex}
					paused={feature.paused}
				/>
				{feature.desync ? (
					<fbox
						flexDirection="row"
						gap={2}
						alignItems="center"
						cls="pl-desync"
						title="El FS tiene artefactos más avanzados que la tarjeta — usa ▶ para alcanzarla (el reconciler no adelanta stages)"
					>
						<ficon name="sync" size={9} />
						<ftext size={10}>desinc</ftext>
					</fbox>
				) : null}
				{feature.badge ? (
					<fbox
						title={`${feature.badge.done}/${feature.badge.total} fases raíz commiteadas en el board N2`}
					>
						<ftext
							size={10}
							cls="pl-metric"
							color="var(--vscode-charts-green, #4ec9b0)"
						>
							{feature.badge.done}/{feature.badge.total} fases
						</ftext>
					</fbox>
				) : null}
			</fbox>

			{/* Renglón 3: botón nombrado por el spec (FR#13); la terminal no
			 *  lleva botón (FR#6: post-ship vive con el badge). */}
			{col && !col.terminal ? (
				<fbutton
					variant={col.advanceKind === "ship" ? "primary" : "secondary"}
					onClick={() =>
						col.advanceKind === "ship"
							? actions.onShip(feature.id)
							: actions.onAdvance(feature.id)
					}
					title={advanceTooltip(col, feature)}
				>
					<ficon name={col.advanceKind === "ship" ? "rocket" : "play"} size={10} />
					<ftext size={11} bold={col.advanceKind === "ship"}>
						{col.advanceLabel}
					</ftext>
				</fbutton>
			) : null}
		</fbox>
	);
}

/** Tooltip del botón según el gesto declarado por el spec (FR#9/FR#13). */
function advanceTooltip(
	col: PanelColumnSpec,
	feature: PipelineFeatureView,
): string {
	if (col.advanceKind === "ship") {
		return feature.artifacts?.plan
			? `Crear las fases de ${feature.artifacts.plan} como unidades backlog del board N2 (sin ejecutar nada)`
			: "Ship: no hay plan enlazado — completa /skill:plan primero";
	}
	return "Inyectar el comando de la skill al chat y mover la tarjeta al instante (movimiento temprano)";
}

/** FR#11 — mini-timeline de las etapas del spec: 4 estados por punto
 *  (completada, actual, próxima, pausada-ámbar cuando la feature está
 *  paused — el punto ACTUAL pasa a ámbar sin bloquear el avance). */
function MiniTimeline({
	spec,
	currentIndex,
	paused,
}: {
	spec: PanelSpec;
	currentIndex: number;
	paused?: boolean;
}): ReactElement {
	return (
		<fbox flexDirection="row" gap={2} alignItems="center">
			{spec.columns.map((c, i) => {
				const state =
					i < currentIndex
						? "done"
						: i === currentIndex
							? paused
								? "paused"
								: "current"
							: "next";
				return (
					<fbox
						key={c.id}
						cls={`pl-dot ${state}`}
						title={`${c.label} — ${dotLabel(state)}`}
					/>
				);
			})}
		</fbox>
	);
}

function dotLabel(state: string): string {
	if (state === "done") return "completada";
	if (state === "current") return "actual";
	if (state === "paused") return "pausada (el avance no se bloquea)";
	return "próxima";
}
