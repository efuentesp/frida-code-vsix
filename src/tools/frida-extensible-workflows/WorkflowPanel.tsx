// WorkflowPanel — panel persistente (footer) de runs de frida-extensible-workflows.
// Remote React (fridaWeb): se monta una vez (wireExtensibleWorkflowPanel, vía
// webBridge) y se re-renderiza solo ante cada mutación del store reactivo
// (useSyncExternalStore). Auto-hide: sin runs activos → null → el webview no pinta.
//
// Issue #7: vista de progreso en vivo (port de host-view). Por cada run en curso
// muestra fase + contadores (✓/✗/⟳), y el detalle de cada grupo parallel/pipeline
// con el glifo de estado de sus tareas. La info la publica el store reactivo vía
// applyWorkflowProgress (eventos agent_start/end, group_start/end, phase).
//
// Tags intrinsic de frida-webview (fbox/ftext), tipados en src/frida-webview/index.ts.

import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import {
	getWorkflowRuns,
	pathKey,
	subscribeWorkflowRuns,
	type AgentProgressState,
	type AgentProgressView,
	type GroupProgressView,
	type WorkflowRunState,
	type WorkflowRunView,
} from "./store";

/** Factory del elemento raíz (para webBridge.mountPersistent). */
export function createExtensibleWorkflowPanelElement(): ReactElement {
	return <WorkflowPanel />;
}

function WorkflowPanel(): ReactElement | null {
	const runs = useSyncExternalStore(subscribeWorkflowRuns, getWorkflowRuns);
	const active = runs.filter((r) => r.state === "running");
	if (active.length === 0) return null; // sólo muestra runs en curso
	return (
		<fbox flexDirection="column" gap={4}>
			<ftext bold>Workflows ({active.length})</ftext>
			{active.map((r) => (
				<RunView key={r.runId} run={r} />
			))}
		</fbox>
	);
}

/** Glifo de estado de run (port de RUN_STATE_GLYPH de la original). */
function runIcon(state: WorkflowRunState): string {
	switch (state) {
		case "running":
			return "⟳";
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "stopped":
			return "■";
		case "budget_exhausted":
			return "⏸";
		default:
			return "•";
	}
}

/** Glifo de estado de agente/tarea (port de AGENT_STATE_GLYPH). */
function agentIcon(state: AgentProgressState | "queued"): string {
	switch (state) {
		case "running":
			return "⟳";
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		default:
			return "○"; // queued: la tarea aún no lanzó agentes
	}
}

const STATE_COLOR: Record<AgentProgressState, string | undefined> = {
	running: undefined, // foreground (destacado por defecto)
	completed: "#3fb950", // verde
	failed: "#f85149", // rojo
};

interface AgentCounts {
	completed: number;
	failed: number;
	running: number;
}

function countAgents(agents: readonly AgentProgressView[]): AgentCounts {
	let completed = 0;
	let failed = 0;
	let running = 0;
	for (const a of agents) {
		if (a.state === "completed") completed += 1;
		else if (a.state === "failed") failed += 1;
		else running += 1;
	}
	return { completed, failed, running };
}

/** ms legible: "…", "12s", "1.4m". */
function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "…";
	if (ms < 1000) return "…";
	if (ms < 60000) return `${Math.round(ms / 1000)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

/** ¿El agente cuelga de un grupo (su structuralPath extiende el del grupo)? */
function belongsTo(
	agent: AgentProgressView,
	group: GroupProgressView,
): boolean {
	const gp = group.structuralPath;
	const ap = agent.structuralPath;
	if (ap.length < gp.length) return false;
	for (let i = 0; i < gp.length; i += 1) {
		if (ap[i] !== gp[i]) return false;
	}
	return true;
}

/** Estado agregado de una tarea (taskName) dentro de un grupo. */
function taskState(
	group: GroupProgressView,
	taskName: string,
	agents: readonly AgentProgressView[],
): AgentProgressState | "queued" {
	const groupPath = pathKey(group.structuralPath);
	let hasRunning = false;
	let hasFailed = false;
	let any = false;
	for (const a of agents) {
		// La tarea es el elemento justo después del path del grupo.
		const taskIdx = group.structuralPath.length;
		if (
			pathKey(a.structuralPath.slice(0, taskIdx)) !== groupPath ||
			a.structuralPath[taskIdx] !== taskName
		) {
			continue;
		}
		any = true;
		if (a.state === "running") hasRunning = true;
		else if (a.state === "failed") hasFailed = true;
	}
	if (!any) return "queued";
	if (hasFailed) return "failed";
	if (hasRunning) return "running";
	return "completed";
}

/** Label legible de un agente (último tramo del path, o role, o "agent"). */
function agentLabel(a: AgentProgressView): string {
	const last = a.structuralPath[a.structuralPath.length - 1];
	const base = last ?? a.role ?? "agent";
	return a.occurrence && a.occurrence > 1 ? `${base} #${a.occurrence}` : base;
}

function RunView({ run }: { run: WorkflowRunView }): ReactElement {
	const counts = countAgents(run.agents);
	const activeGroups = run.groups.filter((g) => g.state === "running");
	const groupedIds = new Set<string>();
	for (const g of activeGroups) {
		for (const a of run.agents) {
			if (belongsTo(a, g)) groupedIds.add(a.agentId);
		}
	}
	const freeAgents = run.agents.filter((a) => !groupedIds.has(a.agentId));
	const now = Date.now();

	return (
		<fbox flexDirection="column" gap={2}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext cls="spinner">{runIcon(run.state)}</ftext>
				<ftext bold>{run.workflowName}</ftext>
				{run.phase ? (
					<ftext color="#888" size={11}>
						[{run.phase}]
					</ftext>
				) : null}
				{(counts.completed > 0 || counts.failed > 0 || counts.running > 0) && (
					<fbox flexDirection="row" gap={4} alignItems="center">
						{counts.completed > 0 ? (
							<ftext size={11} color={STATE_COLOR.completed}>
								✓{counts.completed}
							</ftext>
						) : null}
						{counts.failed > 0 ? (
							<ftext size={11} color={STATE_COLOR.failed}>
								✗{counts.failed}
							</ftext>
						) : null}
						{counts.running > 0 ? (
							<ftext size={11}>⟳{counts.running}</ftext>
						) : null}
					</fbox>
				)}
				<ftext color="#888" size={11}>
					{run.runId.slice(0, 8)}
				</ftext>
			</fbox>

			{activeGroups.map((g) => {
				const states = g.taskNames.map((t) => taskState(g, t, run.agents));
				const done = states.filter((s) => s === "completed").length;
				return (
					<fbox
						key={pathKey(g.structuralPath)}
						flexDirection="row"
						gap={6}
						alignItems="center"
						padding={14}
					>
						<ftext color="#888" size={11}>
							▸ {g.name}
						</ftext>
						<ftext size={11}>
							{done}/{g.taskNames.length}
						</ftext>
						{g.taskNames.map((t, i) => {
							const s = states[i];
							const color =
								s === "completed"
									? STATE_COLOR.completed
									: s === "failed"
										? STATE_COLOR.failed
										: undefined;
							return (
								<ftext key={t} size={11} color={color}>
									{agentIcon(s)} {t}
								</ftext>
							);
						})}
					</fbox>
				);
			})}

			{freeAgents.map((a) => (
				<fbox
					key={a.agentId}
					flexDirection="row"
					gap={6}
					alignItems="center"
					padding={14}
				>
					<ftext color={STATE_COLOR[a.state]}>{agentIcon(a.state)}</ftext>
					<ftext size={11}>{agentLabel(a)}</ftext>
					<ftext color="#888" size={11}>
						{formatDuration((a.endedAt ?? now) - a.startedAt)}
					</ftext>
				</fbox>
			))}
		</fbox>
	);
}
