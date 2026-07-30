// WorkflowPanel — panel persistente (footer) del estado de runs de workflow.
// Remote React (fridaWeb): se monta una vez (mountWorkflowPanel, vía webBridge) y
// se re-renderiza solo ante cada mutation del store reactivo (useSyncExternalStore).
// Auto-hide: sin runs → null → tree:null → el webview no pinta nada.
//
// Tags intrinsic de frida-webview (fbox/ftext), tipados en src/frida-webview/index.ts.

import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import {
	getWorkflowRuns,
	subscribeWorkflowRuns,
	type RunStatus,
	type RunView,
	type StageView,
	type StageViewStatus,
} from "./store";

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
	if (state.runs.length === 0) return null; // auto-hide
	// Más reciente primero.
	const runs = [...state.runs].reverse();
	return (
		<fbox flexDirection="column" padding={6} gap={4}>
			{runs.map((r) => (
				<RunBlock key={r.runId} run={r} />
			))}
		</fbox>
	);
}

function RunBlock({ run }: { run: RunView }): ReactElement {
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
				<StageRow key={`${s.name}-${i}`} stage={s} />
			))}
			{run.error ? <ftext color="#f14c4c">{run.error}</ftext> : null}
		</fbox>
	);
}

function StageRow({ stage }: { stage: StageView }): ReactElement {
	return (
		<fbox flexDirection="column" gap={2}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext color={STAGE_COLOR[stage.status]}>
					{STAGE_GLYPH[stage.status]}
				</ftext>
				<ftext>{stage.name}</ftext>
				{stage.retries && stage.retries > 0 ? (
					<ftext color="#888">↻{stage.retries}</ftext>
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
			</fbox>
			{stage.units && stage.units.length > 0
				? stage.units.map((u, i) => (
						<fbox key={i} flexDirection="row" gap={6} alignItems="center">
							<ftext
								color={
									STAGE_COLOR[
										u.status === "running"
											? "running"
											: u.status === "completed"
												? "completed"
												: "failed"
									]
								}
							>
								{u.status === "running"
									? "⟳"
									: u.status === "completed"
										? "✓"
										: "✗"}
							</ftext>
							<ftext color="#888">{u.label}</ftext>
						</fbox>
					))
				: null}
		</fbox>
	);
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
