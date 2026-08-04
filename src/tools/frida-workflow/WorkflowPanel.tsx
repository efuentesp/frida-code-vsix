// WorkflowPanel — panel persistente (footer) del estado de runs de workflow.
// Remote React (fridaWeb): se monta una vez (mountWorkflowPanel, vía webBridge) y
// se re-renderiza solo ante cada mutation del store reactivo (useSyncExternalStore).
// Auto-hide: sin runs → null → tree:null → el webview no pinta nada.
//
// Transcript expandible (live): cada etapa con transcript es clicable; al
// expandir muestra el transcript vivo de su child session (tools + texto del
// sub-agente), capturado por el host vía suscripción a los eventos del SDK.
//
// Tags intrinsic de frida-webview (fbox/ftext), tipados en src/frida-webview/index.ts.

import { useSyncExternalStore, useState } from "react";
import type { ReactElement } from "react";
import {
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

const STAGE_GLYPH: Record<StageViewStatus, string> = {
	pending: "○",
	running: "⟳",
	completed: "✓",
	failed: "✗",
	aborted: "⏹",
};
const STAGE_COLOR: Record<StageViewStatus, string | undefined> = {
	pending: "#888",
	running: "#569cd6",
	completed: "#4ec9b0",
	failed: "#f14c4c",
	aborted: "#dcdcaa",
};
const RUN_GLYPH: Record<RunStatus, string> = {
	running: "⟳",
	completed: "✓",
	failed: "✗",
	aborted: "⏹",
};

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
					<ftext>●</ftext>
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
	return (
		<fbox flexDirection="column" gap={2}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext color={STAGE_COLOR[runStatusToStage(run.status)]}>
					{RUN_GLYPH[run.status]}
				</ftext>
				<ftext bold>workflow: {run.workflow}</ftext>
				<ftext color="#888">
					({done}/{run.stages.length})
				</ftext>
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
				onClick={hasTranscript ? () => onToggle(stageKey) : undefined}
			>
				<ftext color={STAGE_COLOR[stage.status]}>
					{STAGE_GLYPH[stage.status]}
				</ftext>
				<ftext>{stage.name}</ftext>
				{stage.retries && stage.retries > 0 ? (
					<ftext color="#888">↻{stage.retries}</ftext>
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
					<ftext color="#888">{expanded ? "▾" : "▸"}</ftext>
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
	const isRunning = unit.status === "running";
	const glyph = isRunning ? "⟳" : unit.status === "completed" ? "✓" : "✗";
	const color =
		STAGE_COLOR[
			isRunning
				? "running"
				: unit.status === "completed"
					? "completed"
					: "failed"
		];
	return (
		<fbox flexDirection="row" gap={6} alignItems="center">
			<ftext color={color}>{glyph}</ftext>
			<ftext color="#888">{unit.label}</ftext>
		</fbox>
	);
}

function TranscriptLine({ entry }: { entry: TranscriptEntry }): ReactElement {
	if (entry.kind === "text") {
		return <ftext color="#9aa5ce"> «{truncate(entry.text ?? "", 140)}»</ftext>;
	}
	const status = entry.status ?? "running";
	const glyph = status === "running" ? "⟳" : status === "failed" ? "✗" : "✓";
	const color =
		status === "running"
			? STAGE_COLOR.running
			: status === "failed"
				? STAGE_COLOR.failed
				: STAGE_COLOR.completed;
	return (
		<ftext color={color}>
			{"  "}
			{glyph} {toolLabel(entry)}
		</ftext>
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
