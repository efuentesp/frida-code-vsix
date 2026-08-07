// WorkflowPanel — panel persistente (footer) del estado de runs de workflow.
// Remote React (fridaWeb): se monta una vez (mountWorkflowPanel, vía webBridge) y
// se re-renderiza solo ante cada mutation del store reactivo (useSyncExternalStore).
// Auto-hide: sin runs → null → tree:null → el webview no pinta nada.
//
// Transcript expandible (live): cada etapa con transcript es clicable; al
// expandir muestra el transcript vivo de su child session (tools + texto del
// sub-agente), capturado por el host vía suscripción a los eventos del SDK.
//
// Estado visual por iconos lucide (ficon): el loader-circle de la etapa/run en
// curso rota (.spinner) para indicar "en progreso"; el botón Detener cancela el
// run vía abortRun (AbortController por run, análogo al run.signal + Ctrl-C del
// rpiv-workflow original).
//
// Tags intrinsic de frida-webview (fbox/ftext/ficon), tipados en src/frida-webview/index.ts.

import { useSyncExternalStore, useState } from "react";
import type { ReactElement } from "react";
import {
	abortRun,
	getWorkflowRuns,
	subscribeWorkflowRuns,
	type RunStatus,
	type RunView,
	type StageView,
	type StageViewStatus,
	type TranscriptEntry,
	type UnitView,
} from "./store";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";

const STAGE_COLOR: Record<StageViewStatus, string | undefined> = {
	pending: "#888",
	running: "#569cd6",
	completed: "#4ec9b0",
	failed: "#f14c4c",
	aborted: "#dcdcaa",
};

// Ícono lucide (vía ficon) por estado. En `running`, StatusIcon añade .spinner
// para rotar el loader-circle y transmitir "en progreso" (antes era un ⟳ estático).
const STATUS_ICON: Record<StageViewStatus, string> = {
	pending: "circle",
	running: "loader-circle",
	completed: "check",
	failed: "x",
	aborted: "circle-stop",
};

/** Ícono de estado lucide (ficon). En `running` rota con .spinner. */
function StatusIcon({
	status,
	size = 13,
}: {
	status: StageViewStatus;
	size?: number;
}): ReactElement {
	return (
		<ficon
			name={STATUS_ICON[status]}
			size={size}
			color={STAGE_COLOR[status]}
			cls={status === "running" ? "spinner" : undefined}
		/>
	);
}

/** Factory del elemento raíz que monta el host vía webBridge.mountPersistent. */
export function createWorkflowPanelElement(): ReactElement {
	return <WorkflowPanel />;
}

function WorkflowPanel(): ReactElement | null {
	const state = useSyncExternalStore(subscribeWorkflowRuns, getWorkflowRuns);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [collapsed, setCollapsed] = useState(false);
	if (state.runs.length === 0) return null; // auto-hide
	// Más reciente primero.
	const runs = [...state.runs].reverse();
	const toggle = (key: string): void =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	return (
		<CollapsiblePanel
			collapsed={collapsed}
			onToggle={() => setCollapsed((c) => !c)}
			padding={6}
			gap={4}
			header={
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon
						name="circle"
						size={8}
						color="var(--vscode-descriptionForeground)"
					/>
					<ftext bold>Workflow</ftext>
					<ftext color="var(--vscode-descriptionForeground)">
						({runs.length} run{runs.length === 1 ? "" : "s"})
					</ftext>
				</fbox>
			}
		>
			{runs.map((r) => (
				<RunBlock key={r.runId} run={r} expanded={expanded} onToggle={toggle} />
			))}
		</CollapsiblePanel>
	);
}

function RunBlock({
	run,
	expanded,
	onToggle,
}: {
	run: RunView;
	expanded: Set<string>;
	onToggle: (key: string) => void;
}): ReactElement {
	const done = run.stages.filter((s) => s.status === "completed").length;
	const running = run.status === "running";
	return (
		<fbox flexDirection="column" gap={2}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<StatusIcon status={runStatusToStage(run.status)} />
				<ftext bold>workflow: {run.workflow}</ftext>
				<ftext color="#888">
					({done}/{run.stages.length})
				</ftext>
				{running ? (
					<ftext color={STAGE_COLOR.running} size={11}>
						ejecutando…
					</ftext>
				) : null}
				<fbox flex={1} />
				{running ? (
					<fbutton
						variant="danger"
						cls="wf-stop"
						onClick={() => abortRun(run.runId)}
					>
						<ficon name="square" size={11} />
						<ftext>Detener</ftext>
					</fbutton>
				) : null}
			</fbox>
			{run.stages.map((s, i) => (
				<StageRow
					key={`${s.name}-${i}`}
					stage={s}
					stageKey={`${run.runId}:${i}`}
					expanded={expanded.has(`${run.runId}:${i}`)}
					onToggle={onToggle}
				/>
			))}
			{run.error ? <ftext color="#f14c4c">{run.error}</ftext> : null}
		</fbox>
	);
}

function StageRow({
	stage,
	stageKey,
	expanded,
	onToggle,
}: {
	stage: StageView;
	stageKey: string;
	expanded: boolean;
	onToggle: (key: string) => void;
}): ReactElement {
	const tools = stage.transcript?.filter((e) => e.kind === "tool") ?? [];
	const hasTranscript =
		tools.length > 0 ||
		(stage.transcript?.some((e) => e.kind === "text") ?? false);
	return (
		<fbox flexDirection="column" gap={2}>
			<fbox
				flexDirection="row"
				gap={6}
				alignItems="center"
				tone={stage.status === "running" ? "active" : undefined}
				onClick={hasTranscript ? () => onToggle(stageKey) : undefined}
			>
				<StatusIcon status={stage.status} />
				<ftext>{stage.name}</ftext>
				{stage.retries && stage.retries > 0 ? (
					<fbox flexDirection="row" gap={2} alignItems="center">
						<ficon name="rotate-cw" size={10} color="#888" />
						<ftext color="#888">{stage.retries}</ftext>
					</fbox>
				) : null}
				{tools.length > 0 ? (
					<ftext color="#888">
						· {tools.length} tool{tools.length === 1 ? "" : "s"}
					</ftext>
				) : null}
				{stage.primaryHandle ? (
					<ftext color="#888">→ {shortPath(stage.primaryHandle)}</ftext>
				) : null}
				{stage.units && stage.units.length > 0 ? (
					<ftext color="#888">
						· {stage.units.filter((u) => u.status === "completed").length}/
						{stage.units.length} unidades
					</ftext>
				) : null}
				{hasTranscript ? (
					<ficon
						name={expanded ? "chevron-down" : "chevron-right"}
						size={12}
						color="#888"
					/>
				) : null}
			</fbox>
			{expanded && stage.transcript && stage.transcript.length > 0
				? stage.transcript.map((e, i) => (
						<TranscriptLine key={`${e.id}-${i}`} entry={e} />
					))
				: null}
			{stage.units && stage.units.length > 0
				? stage.units.map((u, i) => <UnitRow key={i} unit={u} />)
				: null}
		</fbox>
	);
}

function UnitRow({ unit }: { unit: UnitView }): ReactElement {
	const status: StageViewStatus =
		unit.status === "running"
			? "running"
			: unit.status === "completed"
				? "completed"
				: "failed";
	return (
		<fbox flexDirection="row" gap={6} alignItems="center">
			<StatusIcon status={status} size={12} />
			<ftext color="#888">{unit.label}</ftext>
		</fbox>
	);
}

function TranscriptLine({ entry }: { entry: TranscriptEntry }): ReactElement {
	if (entry.kind === "text") {
		return <ftext color="#9aa5ce"> «{truncate(entry.text ?? "", 140)}»</ftext>;
	}
	const status: StageViewStatus =
		entry.status === "failed"
			? "failed"
			: entry.status === "completed"
				? "completed"
				: "running";
	return (
		<fbox flexDirection="row" gap={4} alignItems="center">
			<StatusIcon status={status} size={11} />
			<ftext color={STAGE_COLOR[status]}>{toolLabel(entry)}</ftext>
		</fbox>
	);
}

/** Etiqueta legible de una entrada de tool: «edit src/auth.ts (+12 -3)»,
 *  «bash: npm test», «read config.ts»… */
function toolLabel(entry: TranscriptEntry): string {
	const name = entry.toolName ?? "tool";
	if (entry.command) return `${name}: ${truncate(entry.command, 80)}`;
	if (entry.path) {
		const diff = entry.diffStat ? ` (${entry.diffStat})` : "";
		return `${name} ${shortPath(entry.path)}${diff}`;
	}
	return name;
}

function truncate(s: string, max: number): string {
	const flat = s.replace(/\s+/g, " ").trim();
	return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

function runStatusToStage(s: RunStatus): StageViewStatus {
	return s === "running"
		? "running"
		: s === "completed"
			? "completed"
			: "failed";
}

function shortPath(p: string): string {
	const parts = p.split("/");
	return parts.slice(-2).join("/");
}
