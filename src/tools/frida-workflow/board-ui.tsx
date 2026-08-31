// board-ui.tsx — #160: tablero kanban del plan (overlay, comando /board).
//
// Columnas = estado de la unidad; tarjetas = fases raíz. Los splits (sub-fases
// que un skill añadió al plan) se anidan dentro de la tarjeta del padre con
// su propio estado (k/n) — sin glifos de árbol: indentación + border-guide.
// Artefactos clicables (elaboración/validación/sha) vía vínculos explícitos
// del board. La hoja sugerida (firstRealGap) se resalta con acción directa.
import { useState } from "react";
import type { ReactElement } from "react";
import type { Board, BoardUnit } from "./board";
import {
	boardChildren,
	firstRealGap,
	isUnitDone,
	validateFails,
} from "./board";

export interface BoardOverlayActions {
	/** Abre un artefacto (elaboración/validación/sha) en el editor. */
	onOpenArtifact: (path: string) => void;
	/** Lanza el workflow autónomo sobre la hoja sugerida. */
	onAdvance: (planPath: string, phaseId: string) => void;
	/** Cierra el overlay. */
	onClose: () => void;
}

/** Factory del elemento raíz del overlay (mountPersistent "overlay"). */
export function createBoardOverlayElement(
	board: Board,
	actions: BoardOverlayActions,
): ReactElement {
	return <BoardOverlay board={board} actions={actions} />;
}

const COL_ACCENT: Record<string, string> = {
	backlog: "var(--vscode-descriptionForeground, #888888)",
	elaborada: "var(--vscode-charts-blue, #58a6ff)",
	implementada: "var(--vscode-charts-purple, #c586c0)",
	validada: "var(--vscode-charts-yellow, #dcdcaa)",
	commiteada: "var(--vscode-charts-green, #4ec9b0)",
};

function BoardOverlay({
	board,
	actions,
}: {
	board: Board;
	actions: BoardOverlayActions;
}): ReactElement {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const gap = firstRealGap(board);
	const roots = board.units.filter((u) => u.parentId === undefined);
	const doneCount = roots.filter((r) => isUnitDone(board, r)).length;

	const toggle = (id: string): void =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<fbox flexDirection="column" gap={8} cls="kb-overlay">
			<fbox flexDirection="row" gap={8} alignItems="center">
				<ficon
					name="kanban"
					size={14}
					color="var(--vscode-textLink-foreground, #4daafc)"
				/>
				<ftext bold size={12}>
					Board del plan
				</ftext>
				<ftext size={11} color="var(--vscode-descriptionForeground)">
					{board.planPath}
				</ftext>
				<ftext size={11} color="var(--vscode-charts-green, #4ec9b0)">
					{doneCount}/{roots.length} fases done
				</ftext>
				<fbox flexDirection="row" flex={1} />
				<fbox onClick={actions.onClose} cls="kb-close" title="Cerrar tablero">
					<ficon name="x" size={12} color="#8b949e" />
				</fbox>
			</fbox>

			<fbox flexDirection="row" gap={8} cls="kb-board">
				{board.columns.map((col) => {
					const inCol = roots.filter((r) => r.status === col);
					return (
						<fbox key={col} flexDirection="column" gap={6} cls="kb-col">
							<fbox flexDirection="row" gap={4} alignItems="center">
								<fbox cls="kb-col-dot" background={COL_ACCENT[col] ?? "#888"} />
								<ftext size={11} bold color="var(--vscode-descriptionForeground)">
									{col}
								</ftext>
								<ftext size={10} color="var(--vscode-descriptionForeground)">
									({inCol.length})
								</ftext>
							</fbox>
							{inCol.map((u) => (
								<PhaseCard
									key={u.id}
									board={board}
									unit={u}
									isGap={gap?.id === u.id}
									expanded={expanded.has(u.id)}
									onToggle={() => toggle(u.id)}
									actions={actions}
								/>
							))}
						</fbox>
					);
				})}
			</fbox>
		</fbox>
	);
}

function PhaseCard({
	board,
	unit,
	isGap,
	expanded,
	onToggle,
	actions,
}: {
	board: Board;
	unit: BoardUnit;
	isGap: boolean;
	expanded: boolean;
	onToggle: () => void;
	actions: BoardOverlayActions;
}): ReactElement {
	const children = boardChildren(board, unit.id);
	const doneChildren = children.filter((c) => isUnitDone(board, c)).length;
	const isDone = isUnitDone(board, unit);
	const fails = validateFails(unit); // #163 — ciclos de reintentos visibles
	const accent = isDone
		? (COL_ACCENT.commiteada ?? "#4ec9b0")
		: (COL_ACCENT[unit.status] ?? "#888");

	return (
		<fbox flexDirection="column" gap={4} cls={`kb-card${isGap ? " kb-gap" : ""}`}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<fbox cls="kb-card-bar" background={accent} />
				<ftext size={11} bold>
					{unit.id}
				</ftext>
				{unit.title ? (
					<ftext size={11} color="var(--vscode-descriptionForeground)">
						{unit.title.length > 28 ? `${unit.title.slice(0, 27)}…` : unit.title}
					</ftext>
				) : null}
				{children.length > 0 ? (
					<ftext size={10} color="var(--vscode-charts-blue, #58a6ff)">
						{doneChildren}/{children.length}
					</ftext>
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
			</fbox>

			{children.length > 0 ? (
				<fbox
					onClick={onToggle}
					cls="kb-sub-toggle"
					title={expanded ? "Colapsar subtareas" : "Expandir subtareas"}
				>
					<ficon
						name={expanded ? "chevron-down" : "chevron-right"}
						size={10}
						color="var(--vscode-descriptionForeground)"
					/>
					<ftext size={10} color="var(--vscode-descriptionForeground)">
						subtareas
					</ftext>
				</fbox>
			) : null}

			{children.length > 0 && expanded
				? children.map((c) => (
						<fbox
							key={c.id}
							flexDirection="row"
							gap={4}
							alignItems="center"
							cls={`kb-sub${isGap && gapIsChild(board, c) ? " kb-gap" : ""}`}
						>
							<ftext size={10} bold color={subColor(board, c)}>
								{c.id}
							</ftext>
							<ftext size={10} color="var(--vscode-descriptionForeground)">
								{c.title ? truncate(c.title, 24) : ""}
							</ftext>
							<UnitArtifacts unit={c} actions={actions} />
						</fbox>
					))
				: null}

			<UnitArtifacts unit={unit} actions={actions} />

			{!isDone ? (
				<fbox
					onClick={() => actions.onAdvance(board.planPath, unit.id)}
					cls={`kb-advance${isGap ? "" : " kb-advance-quiet"}`}
					title={`Ejecutar la fase ${unit.id} con el workflow autónomo`}
				>
					<ficon name="play" size={10} />
					{isGap ? (
						<ftext size={10} bold>
							Avanzar {unit.id}
						</ftext>
					) : null}
				</fbox>
			) : null}
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
	const links = lastArtifacts(unit);
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
	const byKind = new Map<string, { kind: string; path: string; label?: string }>();
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
