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

import { useSyncExternalStore, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";
import { resolveCheckpointFromUi } from "./frida-delivery";
import { purgeOrphans, readOrphanJournal, scanOrphans } from "./gc";
import { wfLog } from "./telemetry";
import {
	getOrphanRuns,
	getWorkflowRuns,
	pathKey,
	setOrphanRuns,
	subscribeOrphanRuns,
	subscribeWorkflowRuns,
	type AgentProgressState,
	type AgentProgressView,
	type GroupProgressView,
	type OrphanRunView,
	type WorkflowRunState,
	type WorkflowRunView,
} from "./store";

/** Factory del elemento raíz (para webBridge.mountPersistent). */
export function createExtensibleWorkflowPanelElement(): ReactElement {
	return <WorkflowPanel />;
}

function WorkflowPanel(): ReactElement | null {
	const runs = useSyncExternalStore(subscribeWorkflowRuns, getWorkflowRuns);
	const orphans = useSyncExternalStore(subscribeOrphanRuns, getOrphanRuns);
	// Activas incluye awaiting (#64): una run esperando aprobación sigue "en
	// curso" — el panel no debe desaparecer justo cuando necesita al usuario.
	const active = runs.filter(
		(r) => r.state === "running" || r.state === "awaiting",
	);
	const [collapsed, setCollapsed] = useState(false);
	// #69: journal expandido de un huérfano ([Ver journal]).
	const [journal, setJournal] = useState<{ runId: string; text: string } | null>(
		null,
	);
	// #69: scan de huérfanos al montar el panel (la sesión viva queda excluida
	// por su lease owner.json — no necesita excludeSessionIds).
	useEffect(() => {
		scanOrphans()
			.then(setOrphanRuns)
			.catch(() => undefined);
	}, []);
	const refreshOrphans = () => {
		scanOrphans()
			.then(setOrphanRuns)
			.catch(() => undefined);
	};
	wfLog("render", {
		totalRuns: runs.length,
		activeRuns: active.length,
		orphans: orphans.length,
		runs: runs.map((r) => ({ id: r.runId.slice(0, 8), state: r.state })),
	});
	if (active.length === 0 && orphans.length === 0) return null; // nada que mostrar
	return (
		<CollapsiblePanel
			collapsed={collapsed}
			onToggle={() => setCollapsed((c) => !c)}
			padding={6}
			gap={4}
			header={
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ftext bold>Workflows</ftext>
					<ftext color="#888">({active.length})</ftext>
				</fbox>
			}
		>
			{active.map((r) => (
				<RunView key={r.runId} run={r} />
			))}
			{orphans.length > 0 ? (
				<OrphansSection
					orphans={orphans}
					journal={journal}
					setJournal={setJournal}
					onChanged={refreshOrphans}
				/>
			) : null}
		</CollapsiblePanel>
	);
}

/** Sección «Huérfanos» (#69): runs de sesiones muertas con purga individual
 * y en lote. ⚠ = atascado (irrecuperable); · = terminal (historia).
 * [Ver journal] muestra el tail (~15 líneas) como evidencia final. */
function OrphansSection(props: {
	orphans: readonly OrphanRunView[];
	journal: { runId: string; text: string } | null;
	setJournal: (j: { runId: string; text: string } | null) => void;
	onChanged: () => void;
}): ReactElement {
	const { orphans, journal, setJournal, onChanged } = props;
	const stuckCount = orphans.filter((o) => o.kind === "stuck").length;
	// Purga individual (🗑): olderThanDays 0 — el usuario ya lo vió y decidió.
	const purgeOne = (o: OrphanRunView) => {
		purgeOrphans({ runIds: [o.runId], olderThanDays: 0 })
			.then(() => onChanged())
			.catch(() => undefined);
	};
	// Lote: todos los huérfanos listados (incluye terminales), sin margen.
	const purgeAll = () => {
		purgeOrphans({ runIds: orphans.map((o) => o.runId), olderThanDays: 0 })
			.then(() => onChanged())
			.catch(() => undefined);
	};
	return (
		<fbox flexDirection="column" gap={4} padding={6}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext bold>🧹 Huérfanos de sesiones previas ({orphans.length})</ftext>
				{stuckCount > 0 ? (
					<ftext color="#d29922">{stuckCount} atorado(s) ⚠</ftext>
				) : null}
			</fbox>
			{orphans.map((o) => (
				<fbox key={o.runId} flexDirection="column" gap={2}>
					<fbox flexDirection="row" gap={6} alignItems="center">
						<ftext color={o.kind === "stuck" ? "#d29922" : "#888"}>
							{o.kind === "stuck" ? "⚠" : "·"} {o.runId.slice(0, 8)} · {o.workflowName} · {o.state} · {Math.floor(o.ageDays)}d
						</ftext>
						<fbutton
							variant="secondary"
							onClick={() => {
								if (journal?.runId === o.runId) {
									setJournal(null);
									return;
								}
								readOrphanJournal(o.runDir).then((text) =>
									setJournal({ runId: o.runId, text }),
								);
							}}
						>
							{journal?.runId === o.runId ? "Ocultar" : "Ver journal"}
						</fbutton>
						<fbutton variant="secondary" onClick={() => purgeOne(o)}>
							🗑
						</fbutton>
					</fbox>
					{journal?.runId === o.runId ? (
						<ftext size={11} color="#888">
							{journal.text}
						</ftext>
					) : null}
				</fbox>
			))}
			<fbutton variant="secondary" onClick={purgeAll}>
				Purgar los {orphans.length} huérfanos
			</fbutton>
		</fbox>
	);
}

/** Glifo de estado de run (port de RUN_STATE_GLYPH de la original). */
function runIcon(state: WorkflowRunState): string {
	switch (state) {
		case "running":
			return "⟳";
		case "awaiting":
			return "⏸";
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

			{run.state === "awaiting" && run.checkpointName ? (
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ftext color="#d29922">Esperando tu aprobación: {run.checkpointName}</ftext>
					<fbutton
						variant="primary"
						onClick={() =>
							resolveCheckpointFromUi(run.runId, run.checkpointName ?? "", true)
						}
					>
						✓ Aprobar
					</fbutton>
					<fbutton
						variant="secondary"
						onClick={() =>
							resolveCheckpointFromUi(run.runId, run.checkpointName ?? "", false)
						}
					>
						✗ Rechazar
					</fbutton>
				</fbox>
			) : null}

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
