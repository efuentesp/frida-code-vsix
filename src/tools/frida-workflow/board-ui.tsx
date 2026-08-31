// board-ui.tsx — #169: tablero kanban del plan como panel COLAPSABLE del footer
// (mismo patrón que WorkflowPanel), rediseñado con la guía de frontend-design
// (scan-only sobre el sistema establecido: VS Code vars, codicons, escala 10/11/12).
//
// Frontend-design (7 dimensiones aplicadas):
//  · Tipografía: id bold 11 · títulos 11 desc · métricas 10 tabular.
//  · Color: acento charts-* por columna; done=verde; ciclos=naranja; hueco=focus.
//  · Espaciado: 4/6/8 ritmo vertical uniforme; cards 8px padding.
//  · Layout: barra de progreso segmentada (1 celda por fase) + columnas scroll-x.
//  · Componentes: CollapsiblePanel compartido; kb-art/kb-advance reutilizados.
//  · Interacción: hover en tarjetas y botones; tooltips en todo lo clicable.
//  · Accesibilidad: contraste AA (foreground/descriptionForeground); title=ARIA.
//
// El estado colapsado vive a nivel módulo: el overlay vivo re-monta el panel en
// cada transición (#163) y el usuario no debe perder su preferencia de vista.
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { Board, BoardUnit } from "./board";
import {
	boardChildren,
	sortArtifactsChronologically,
	depsSatisfied,
	firstRealGap,
	isUnitDone,
	pendingDeps,
	validateFails,
} from "./board";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";
import { getWorkflowRuns, subscribeWorkflowRuns } from "./store";
import { extractPhaseId } from "./plan-utils";

export interface BoardOverlayActions {
	/** Abre un artefacto (elaboración/validación/sha) en el editor. */
	onOpenArtifact: (path: string) => void;
	/** Lanza el workflow autónomo sobre la hoja sugerida. */
	onAdvance: (planPath: string, phaseId: string) => void;
	/** Cierra el panel. */
	onClose: () => void;
}

/** Preferencia de vista del usuario: sobrevive a los re-mounts del board vivo. */
let boardPanelCollapsed = false;

/** Factory del elemento raíz del panel (mountPersistent "footer"). */
export function createBoardOverlayElement(
	board: Board,
	actions: BoardOverlayActions,
): ReactElement {
	return <BoardPanel board={board} actions={actions} />;
}

const COL_ACCENT: Record<string, string> = {
	backlog: "var(--vscode-descriptionForeground, #888888)",
	elaborate: "var(--vscode-charts-blue, #58a6ff)",
	implement: "var(--vscode-charts-purple, #c586c0)",
	validate: "var(--vscode-charts-yellow, #dcdcaa)",
	commit: "var(--vscode-charts-green, #4ec9b0)",
	// Compat: columnas default previas a #163 (elaborada/implementada/…).
	elaborada: "var(--vscode-charts-blue, #58a6ff)",
	implementada: "var(--vscode-charts-purple, #c586c0)",
	validada: "var(--vscode-charts-yellow, #dcdcaa)",
	commiteada: "var(--vscode-charts-green, #4ec9b0)",
};

function BoardPanel({
	board,
	actions,
}: {
	board: Board;
	actions: BoardOverlayActions;
}): ReactElement {
	const [collapsed, setCollapsed] = useState(boardPanelCollapsed);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const toggleCollapsed = (): void => {
		boardPanelCollapsed = !boardPanelCollapsed;
		setCollapsed(boardPanelCollapsed);
	};
	// #175 — Fase EN EJECUCIÓN (reactivo): pulso en su tarjeta, sin ▶, y el resto
	// del backlog con ▶ deshabilitado hasta que el run termine.
	const runsState = useSyncExternalStore(subscribeWorkflowRuns, getWorkflowRuns);
	// #177 — Fases EN EJECUCIÓN (SET: flujos en paralelo permitidos por deps).
	const runningPhases = new Set(
		runsState.runs
			.filter((r) => r.status === "running")
			.map((r) => (r.input ? extractPhaseId(r.input)?.phaseId : undefined))
			.filter((p): p is string => !!p),
	);
	const gap = firstRealGap(board);
	const roots = board.units.filter((u) => u.parentId === undefined);
	const doneCount = roots.filter((r) => isUnitDone(board, r)).length;

	const toggleUnit = (id: string): void =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<CollapsiblePanel
			collapsed={collapsed}
			onToggle={toggleCollapsed}
			padding={6}
			gap={6}
			cls="kb-panel"
			header={
				<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
					<ficon
						name="kanban"
						size={12}
						color="var(--vscode-textLink-foreground, #4daafc)"
					/>
					<ftext bold size={12}>
						Board
					</ftext>
					<ftext size={11} color="var(--vscode-descriptionForeground)">
						{board.planPath.split("/").pop()}
					</ftext>
					<ftext
						size={11}
						color="var(--vscode-charts-green, #4ec9b0)"
						cls="kb-metric"
					>
						{doneCount}/{roots.length}
					</ftext>
					{/* Barra de progreso segmentada: 1 celda por fase raíz. */}
					<fbox flexDirection="row" gap={2} cls="kb-progress">
						{roots.map((r) => (
							<fbox
								key={r.id}
								cls={`kb-progress-cell${isUnitDone(board, r) ? " done" : ""}${
									gap?.id === r.id ? " gap" : ""
								}`}
								title={`${r.id} — ${isUnitDone(board, r) ? "completada" : "pendiente"}`}
							/>
						))}
					</fbox>
					{collapsed && gap ? (
						<ftext size={11} color="var(--vscode-textLink-foreground, #4daafc)">
							· siguiente: {gap.id}
						</ftext>
					) : null}
				</fbox>
			}
			actions={
				<fbox onClick={actions.onClose} cls="kb-close" title="Cerrar tablero">
					<ficon name="x" size={12} color="#8b949e" />
				</fbox>
			}
		>
			<fbox flexDirection="row" gap={8} cls="kb-board">
				{board.columns.map((col) => {
					const inCol = roots.filter((r) => r.status === col);
					return (
						<fbox key={col} flexDirection="column" gap={6} cls="kb-col">
							<fbox flexDirection="row" gap={4} alignItems="center" cls="kb-col-title">
								<fbox cls="kb-col-dot" background={COL_ACCENT[col] ?? "#888"} />
								<ftext size={11} bold color="var(--vscode-descriptionForeground)">
									{col}
								</ftext>
								<ftext
									size={10}
									cls="kb-metric"
									color="var(--vscode-descriptionForeground)"
								>
									({inCol.length})
								</ftext>
							</fbox>
							{inCol.map((u) => (
								<PhaseCard
									key={u.id}
									board={board}
									unit={u}
									runningPhases={runningPhases}
									isGap={gap?.id === u.id}
									expanded={expanded.has(u.id)}
									onToggle={() => toggleUnit(u.id)}
									actions={actions}
								/>
							))}
						</fbox>
					);
				})}
			</fbox>
		</CollapsiblePanel>
	);
}

function PhaseCard({
	board,
	unit,
	runningPhases,
	isGap,
	expanded,
	onToggle,
	actions,
}: {
	board: Board;
	unit: BoardUnit;
	/** #175/#177 — ids de fases en ejecución (runs activos, en paralelo). */
	runningPhases: Set<string>;
	isGap: boolean;
	expanded: boolean;
	onToggle: () => void;
	actions: BoardOverlayActions;
}): ReactElement {
	const children = boardChildren(board, unit.id);
	const doneChildren = children.filter((c) => isUnitDone(board, c)).length;
	const isDone = isUnitDone(board, unit);
	const isRunning = runningPhases.has(unit.id); // #175 — pulso + sin ▶
	// #177 — El ▶ se habilita por DEPENDENCIAS (no por actividad): paralelo real.
	const blockedDeps = pendingDeps(board, unit);
	const depsOk = depsSatisfied(board, unit);
	const fails = validateFails(unit); // #163 — ciclos de reintentos visibles
	const blocked = unit.transitions.at(-1)?.blocked === true; // #172 — breaker
	const hasBadges =
		children.length > 0 ||
		blockedDeps.length > 0 ||
		!!(unit.deps && unit.deps.length > 0) ||
		fails > 0 ||
		blocked ||
		lastArtifacts(unit).length > 0; // #180 — renglón 2 sólo si hay contenido
	const accent = isDone
		? (COL_ACCENT.commit ?? "#4ec9b0")
		: (COL_ACCENT[unit.status] ?? "#888");

	return (
		<fbox
			flexDirection="column"
			gap={4}
			cls={`kb-card${isGap ? " kb-gap" : ""}${isRunning ? " kb-running" : ""}`}
		>
			{/* #180 — Renglón 1: id indivisible (nowrap) + título flexible (ellipsis).
			 *  El tooltip del título completo va en el fbox (ftext no soporta title). */}
			<fbox flexDirection="row" gap={6} alignItems="center" title={unit.title}>
				<fbox cls="kb-card-bar" background={accent} />
				<ftext size={11} bold cls="kb-card-id">
					{unit.id}
				</ftext>
				{unit.title ? (
					<ftext
						size={11}
						color="var(--vscode-descriptionForeground)"
						cls="kb-card-title"
					>
						{unit.title}
					</ftext>
				) : null}
			</fbox>

			{/* #180 — Renglón 2: badges completos e indivisibles (wrap por badge). */}
			{hasBadges ? (
				<fbox flexDirection="row" gap={6} alignItems="center" cls="kb-badges">
					{children.length > 0 ? (
						<ftext
							size={10}
							cls="kb-metric"
							color="var(--vscode-charts-blue, #58a6ff)"
						>
							{doneChildren}/{children.length}
						</ftext>
					) : null}
					{blockedDeps.length > 0 ? (
						<fbox
							flexDirection="row"
							gap={2}
							alignItems="center"
							cls="kb-deps kb-deps-pending"
							title={`Depende de: ${blockedDeps.join(", ")} — el ▶ se habilita al completarlas`}
						>
							<ficon name="git-branch" size={9} />
							<ftext size={10}>{blockedDeps.join(",")}</ftext>
						</fbox>
					) : unit.deps && unit.deps.length > 0 ? (
						<fbox
							flexDirection="row"
							gap={2}
							alignItems="center"
							cls="kb-deps"
							title={`Dependencias satisfechas: ${unit.deps.join(", ")}`}
						>
							<ficon name="check" size={9} />
						</fbox>
					) : null}
					{fails > 0 ? (
						<fbox
							flexDirection="row"
							gap={2}
							alignItems="center"
							cls="kb-cycles"
							title={`${fails} ciclo(s) de reintento (validate FAIL)`}
						>
							<ficon name="sync" size={9} />
							<ftext size={10}>{fails}</ftext>
						</fbox>
					) : null}
					{blocked ? (
						<fbox
							flexDirection="row"
							gap={2}
							alignItems="center"
							cls="kb-blocked"
							title="Bloqueada por circuit breaker tras los ciclos FAIL — relanza para continuar"
						>
							<ficon name="error" size={10} />
							<ftext size={10}>bloqueada</ftext>
						</fbox>
					) : null}
					<UnitArtifacts unit={unit} actions={actions} />
				</fbox>
			) : null}

			{children.length > 0 ? (
				<fbox
					onClick={onToggle}
					cls="kb-sub-toggle"
					title={expanded ? "Colapsar subtareas" : "Expandir subtareas"}
				>
					<ficon
						name={expanded ? "chevron-down" : "chevron-right"}
						size={11}
						color="var(--vscode-descriptionForeground)"
					/>
				</fbox>
			) : null}

			{children.length > 0 && expanded
				? children.map((c) => (
						<fbox
							key={c.id}
							flexDirection="row"
							gap={4}
							alignItems="center"
							cls={`kb-sub${isGap && gapIsChild(board, c) ? " kb-gap" : ""}${runningPhases.has(c.id) ? " kb-sub-running" : ""}`}
						>
							<ftext size={10} bold color={subColor(board, c)}>
								{c.id}
							</ftext>
							<ftext size={10} color="var(--vscode-descriptionForeground)">
								{c.title ? truncate(c.title, 22) : ""}
							</ftext>
							<UnitArtifacts unit={c} actions={actions} />
						</fbox>
					))
				: null}

			{isRunning ? null : depsOk ? (
				isDone ? null : isGap ? (
					// #175 — Mismo look que el botón «Avanzar» del panel del workflow.
					<fbutton
						variant="primary"
						onClick={() => actions.onAdvance(board.planPath, unit.id)}
						title={`Ejecutar la fase ${unit.id} con el workflow autónomo`}
					>
						<ficon name="play" size={11} />
						<ftext size={11} bold>
							Avanzar {unit.id}
						</ftext>
					</fbutton>
				) : (
					<fbox
						onClick={() => actions.onAdvance(board.planPath, unit.id)}
						cls="kb-advance-quiet"
						title={`Ejecutar la fase ${unit.id} con el workflow autónomo`}
					>
						<ficon name="play" size={11} color="var(--vscode-foreground)" />
					</fbox>
				)
			) : (
				// #178 — Bloqueado por dependencias: icono puro (candado, sin caja).
				<fbox
					cls="kb-advance-disabled"
					title={`Depende de: ${blockedDeps.join(", ")} — disponible al completarlas`}
				>
					<ficon name="lock" size={10} color="var(--vscode-descriptionForeground)" />
				</fbox>
			)}
		</fbox>
	);
}

function UnitArtifacts({
	unit,
	actions,
}: {
	unit: BoardUnit;
	actions: BoardOverlayActions;
}): ReactElement | null {
	const links = sortArtifactsChronologically(lastArtifacts(unit)); // #181 — cronológico
	if (links.length === 0) return null;
	return (
		<fbox flexDirection="row" gap={6} alignItems="center">
			{links.map((a, i) => (
				<fbox
					key={`${a.path}-${i}`}
					onClick={a.path ? () => actions.onOpenArtifact(a.path) : undefined}
					cls="kb-art"
					title={a.path || a.label || a.kind}
				>
					<ficon
						name={artifactIcon(a.kind)}
						size={10}
						color="var(--vscode-textLink-foreground, #4daafc)"
					/>
					{a.label && !a.path ? (
						<ftext size={9} color="var(--vscode-descriptionForeground)">
							{a.label}
						</ftext>
					) : null}
				</fbox>
			))}
		</fbox>
	);
}

/** Último artefacto por kind (evita repetir 3× validation del mismo ciclo). */
function lastArtifacts(unit: BoardUnit): {
	kind: string;
	path: string;
	label?: string;
}[] {
	const byKind = new Map<
		string,
		{ kind: string; path: string; label?: string }
	>();
	for (let i = unit.transitions.length - 1; i >= 0; i--) {
		for (const a of unit.transitions[i]!.artifacts ?? []) {
			if (!byKind.has(a.kind))
				byKind.set(a.kind, { kind: a.kind, path: a.path, label: a.label });
		}
	}
	return [...byKind.values()];
}

function artifactIcon(kind: string): string {
	if (kind === "elaboration") return "file-text";
	if (kind === "validation") return "verified";
	if (kind === "git-commit") return "git-commit";
	return "file";
}

function subColor(board: Board, u: BoardUnit): string {
	return isUnitDone(board, u)
		? "var(--vscode-charts-green, #4ec9b0)"
		: "var(--vscode-descriptionForeground)";
}

function gapIsChild(board: Board, u: BoardUnit): boolean {
	const gap = firstRealGap(board);
	return gap?.id === u.id;
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
