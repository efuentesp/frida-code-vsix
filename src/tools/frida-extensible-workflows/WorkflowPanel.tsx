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
	type WorkflowRunView,
} from "./store";
import {
	groupBar,
	runPill,
	timelineRows,
	agentDisplayName,
	collapsedHeader,
	formatTokens,
	runStats,
	AGENT_ICON,
	SEGMENT_BG,
} from "./panel-view";

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
			header={<HeaderSummary runs={runs} collapsed={collapsed} />}
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
			<fbox flexDirection="row" gap={4}>
				<ficon name="trash-2" size={12} color="#8b949e" />
				<ftext bold>Huérfanos de sesiones previas ({orphans.length})</ftext>
				{stuckCount > 0 ? (
					<fbox flexDirection="row" gap={3} alignItems="center">
						<ficon name="triangle-alert" size={11} color="#d29922" />
						<ftext color="#d29922" size={11}>
							{stuckCount} atorado(s)
						</ftext>
					</fbox>
				) : null}
			</fbox>
			{orphans.map((o) => (
				<fbox key={o.runId} flexDirection="column" gap={2}>
					<fbox flexDirection="row" gap={6} alignItems="center">
						<ficon
							name={o.kind === "stuck" ? "triangle-alert" : "circle"}
							size={11}
							color={o.kind === "stuck" ? "#d29922" : "#8b949e"}
						/>
						<ftext color={o.kind === "stuck" ? "#d29922" : "#8b949e"} size={11}>
							{o.runId.slice(0, 8)} · {o.workflowName} · {o.state} · {Math.floor(o.ageDays)}d
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
							<fbox flexDirection="row" gap={4} alignItems="center">
								<ficon name="file-text" size={11} />
								<ftext size={11}>
									{journal?.runId === o.runId ? "Ocultar" : "Journal"}
								</ftext>
							</fbox>
						</fbutton>
						<fbutton variant="secondary" onClick={() => purgeOne(o)}>
							<ficon name="trash-2" size={11} />
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
				<fbox flexDirection="row" gap={4} alignItems="center">
					<ficon name="trash-2" size={11} />
					<ftext size={11}>Purgar los {orphans.length} huérfanos</ftext>
				</fbox>
			</fbutton>
		</fbox>
	);
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


/** Label legible de un agente (último tramo del path, o role, o "agent"). */
/** Contadores de agentes como iconos lucide + número (#79: sin glifos). */
function CountsRow({
	counts,
}: {
	counts: { completed: number; failed: number; running: number };
}): ReactElement {
	return (
		<fbox flexDirection="row" gap={6} alignItems="center">
			{counts.completed > 0 ? (
				<fbox flexDirection="row" gap={2} alignItems="center">
					<ficon name="check" size={10} color={STATE_COLOR.completed} />
					<ftext size={11} color={STATE_COLOR.completed}>
						{counts.completed}
					</ftext>
				</fbox>
			) : null}
			{counts.failed > 0 ? (
				<fbox flexDirection="row" gap={2} alignItems="center">
					<ficon name="x" size={10} color={STATE_COLOR.failed} />
					<ftext size={11} color={STATE_COLOR.failed}>
						{counts.failed}
					</ftext>
				</fbox>
			) : null}
			{counts.running > 0 ? (
				<fbox flexDirection="row" gap={2} alignItems="center">
					<ficon name="loader-circle" size={10} cls="spinner" />
					<ftext size={11}>{counts.running}</ftext>
				</fbox>
			) : null}
		</fbox>
	);
}

/** Header del panel (#80): contraído muestra progreso — barra de fases
 * segmentada + fase activa + ⟳N; expandido, título a secas. */
function HeaderSummary({
	runs,
	collapsed,
}: {
	runs: readonly WorkflowRunView[];
	collapsed: boolean;
}): ReactElement {
	const h = collapsedHeader(runs);
	const p = collapsed ? h.progress : undefined;
	return (
		<fbox flexDirection="row" gap={6} alignItems="center">
			<ftext bold>{h.title}</ftext>
			{p && p.total > 0 ? (
				<>
					<fbox
						flexDirection="row"
						gap={1}
						cls="wf-bar"
						height={6}
						overflow="hidden"
					>
						{Array.from({ length: p.total }, (_, i) => (
							<fbox
								key={i}
								flex={1}
								height={6}
								background={
									i < p.done
										? SEGMENT_BG.completed
										: i === p.done
											? SEGMENT_BG.running
											: SEGMENT_BG.queued
								}
							/>
						))}
					</fbox>
					<ftext size={11} color="#8b949e">
						{p.done}/{p.total}
					</ftext>
					{h.phase ? (
						<ftext size={11} color="#58a6ff">
							{h.phase}
						</ftext>
					) : null}
				</>
			) : null}
			{collapsed && h.running > 0 ? (
				<fbox flexDirection="row" gap={2} alignItems="center">
					<ficon name="loader-circle" size={10} cls="spinner" />
					<ftext size={11}>{h.running}</ftext>
				</fbox>
			) : null}
		</fbox>
	);
}

function RunView({ run }: { run: WorkflowRunView }): ReactElement {
	const pill = runPill(run.state);
	const counts = countAgents(run.agents);
	const now = Date.now();
	// #79: timeline vertical — una fila por fase vista, la activa con agentes.
	const timeline = timelineRows(run, now);
	const activeGroups = run.groups.filter((g) => g.state === "running");
	const groupedIds = new Set<string>();
	for (const g of activeGroups) {
		for (const a of run.agents) {
			if (belongsTo(a, g)) groupedIds.add(a.agentId);
		}
	}
	// Agentes ya anidados en el timeline → no se repiten como libres.
	const timelineIds = new Set<string>();
	for (const row of timeline) {
		for (const a of row.agents) timelineIds.add(a.agentId);
	}
	const freeAgents = run.agents.filter(
		(a) => !groupedIds.has(a.agentId) && !timelineIds.has(a.agentId),
	);
	const hasCounts =
		counts.completed > 0 || counts.failed > 0 || counts.running > 0;
	// #81: stats del run — ⏱ desde el inicio a la última interacción + ∑ tokens.
	const stats = runStats(run, now);

	return (
		<fbox bordered flexDirection="column" gap={8} padding={10} cls="wf-card">
			{/* Header de la card: glifo+nombre+id · pill de estado (#71) */}
			<fbox
				flexDirection="row"
				gap={8}
				alignItems="center"
				justifyContent="space-between"
			>
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon
						name={pill.icon}
						size={14}
						color={pill.color}
						cls={run.state === "running" ? "spinner" : undefined}
					/>
					<ftext bold size={13}>
						{run.workflowName}
					</ftext>
					<ftext color="#8b949e" size={11}>
						{run.runId.slice(0, 8)}
					</ftext>
				</fbox>
				<fbox
					cls="wf-pill"
					background={`${pill.color}26`}
					flexDirection="row"
					gap={4}
					alignItems="center"
					padding={3}
				>
					<ftext color={pill.color} size={11} bold>
						{pill.label}
					</ftext>
				</fbox>
			</fbox>

			{/* #81: ⏱ elapsed + ∑ tokens/costo del run */}
			{run.startedAt === undefined ? null : (
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon name="clock" size={10} color="#8b949e" />
					<ftext size={11} color="#8b949e">
						{formatDuration(stats.elapsedMs)}
					</ftext>
					{stats.tokens > 0 ? (
						<>
							<ficon name="coins" size={10} color="#8b949e" />
							<ftext size={11} color="#8b949e">
								∑ {formatTokens(stats.tokens)}
								{stats.costUsd > 0
									? ` ($${stats.costUsd.toFixed(2)})`
									: ""}
							</ftext>
						</>
					) : null}
				</fbox>
			)}

			{/* Contadores agregados de agentes (iconos lucide, no glifos) */}
			{hasCounts ? <CountsRow counts={counts} /> : null}

			{/* #79: timeline vertical — una fila por fase vista; la activa expandida
			    con sus agentes anidados (label humano + duración). */}
			{timeline.length > 0 ? (
				<fbox flexDirection="column" gap={2}>
					{timeline.map((row) => {
						const color =
							row.state === "current"
								? "#58a6ff"
								: row.state === "done"
									? STATE_COLOR.completed
									: "#8b949e";
						return (
							<fbox key={row.name} flexDirection="column" gap={1}>
								<fbox flexDirection="row" gap={4} alignItems="center">
									<ficon
										name={
											row.state === "current"
												? "circle-dot"
												: row.state === "done"
													? "circle-check"
													: "circle"
										}
										size={11}
										color={color}
									/>
									<ftext
										size={11}
										bold={row.state === "current"}
										color={color}
									>
										{row.name}
									</ftext>
									{row.state === "current" && counts.running > 0 ? (
										<fbox flexDirection="row" gap={2} alignItems="center">
											<ficon
												name="loader-circle"
												size={10}
												cls="spinner"
											/>
											<ftext size={11}>{counts.running}</ftext>
										</fbox>
									) : null}
									<ftext size={11} color="#8b949e">
										{formatDuration(row.durationMs)}
									</ftext>
								</fbox>
								{row.state === "current"
									? row.agents.map((a) => (
											<fbox
												key={a.agentId}
												flexDirection="row"
												gap={4}
												alignItems="center"
												paddingLeft={14}
											>
												<ficon
													name={AGENT_ICON[a.state]}
													size={10}
													color={STATE_COLOR[a.state]}
													cls={a.state === "running" ? "spinner" : undefined}
												/>
											<ftext size={11} color={STATE_COLOR[a.state]}>
												{a.label}
											</ftext>
											{a.tokens !== undefined && a.tokens > 0 ? (
												<ftext size={11} color="#8b949e">
													{formatTokens(a.tokens)}
												</ftext>
											) : null}
											<ftext size={11} color="#8b949e">
												{formatDuration(a.durationMs)}
											</ftext>
											</fbox>
											))
										: null}
							</fbox>
						);
					})}
				</fbox>
			) : run.phase ? (
				<ftext size={11} color="#8b949e">
					Fase <ftext bold>{run.phase}</ftext>
				</ftext>
			) : null}

			{/* Error del run (si falló) — antes no se pintaba */}
			{run.error ? (
				<ftext size={11} color="#f85149" wrap>
					{run.error}
				</ftext>
			) : null}

			{/* Banner de checkpoint con acciones al pie de SU card (#64/#71) */}
			{run.state === "awaiting" && run.checkpointName ? (
				<fbox
					cls="wf-checkpoint"
					background="#d2992221"
					flexDirection="row"
					gap={8}
					alignItems="center"
					padding={8}
				>
					<ftext color="#d29922" size={12}>
						Esperando tu aprobación: <ftext bold>{run.checkpointName}</ftext>
					</ftext>
					<fbutton
						variant="primary"
						onClick={() =>
							resolveCheckpointFromUi(run.runId, run.checkpointName ?? "", true)
						}
					>
						<fbox flexDirection="row" gap={4} alignItems="center">
							<ficon name="check" size={11} /> <ftext size={11}>Aprobar</ftext>
						</fbox>
					</fbutton>
					<fbutton
						variant="danger"
						onClick={() =>
							resolveCheckpointFromUi(run.runId, run.checkpointName ?? "", false)
						}
					>
						<fbox flexDirection="row" gap={4} alignItems="center">
							<ficon name="x" size={11} /> <ftext size={11}>Rechazar</ftext>
						</fbox>
					</fbutton>
				</fbox>
			) : null}

			{/* Grupos: barra segmentada (#71) + detalle por tarea */}
			{activeGroups.map((g) => {
				const bar = groupBar(g, run.agents);
				return (
					<fbox key={pathKey(g.structuralPath)} flexDirection="column" gap={3}>
							<fbox flexDirection="row" gap={4} alignItems="center">
								<ftext color="#8b949e" size={11}>
									{g.name}
								</ftext>
								<ftext size={11}>
									{bar.done}/{bar.total}
								</ftext>
								{bar.failed > 0 ? (
									<fbox flexDirection="row" gap={2} alignItems="center">
										<ficon name="x" size={10} color={STATE_COLOR.failed} />
										<ftext size={11} color={STATE_COLOR.failed}>
											{bar.failed}
										</ftext>
									</fbox>
								) : null}
								{bar.running > 0 ? (
									<fbox flexDirection="row" gap={2} alignItems="center">
										<ficon
											name="loader-circle"
											size={10}
											cls="spinner"
											/>
										<ftext size={11}>{bar.running}</ftext>
									</fbox>
								) : null}
							</fbox>
						<fbox
							flexDirection="row"
							gap={1}
							cls="wf-bar"
							height={6}
							overflow="hidden"
						>
							{bar.segments.map((s, i) => (
								<fbox
									key={String(i)}
									flex={1}
									height={6}
									background={SEGMENT_BG[s.state]}
								/>
							))}
						</fbox>
						<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
							{g.taskNames.map((t, i) => {
								const s = bar.segments[i]?.state;
								const color =
									s === "completed"
										? STATE_COLOR.completed
										: s === "failed"
											? STATE_COLOR.failed
											: s === "running"
												? "#58a6ff"
												: "#8b949e";
								return (
									<fbox
										key={t}
										flexDirection="row"
										gap={2}
										alignItems="center"
									>
										<ficon
											name={AGENT_ICON[s ?? "queued"]}
											size={10}
											color={color}
											cls={s === "running" ? "spinner" : undefined}
										/>
										<ftext size={11} color={color}>
											{t}
										</ftext>
									</fbox>
								);
							})}
						</fbox>
					</fbox>
				);
			})}

			{/* Agentes libres (sin grupo) con duración */}
				{freeAgents.map((a) => (
					<fbox key={a.agentId} flexDirection="row" gap={6} alignItems="center">
					<ficon
						name={AGENT_ICON[a.state]}
						size={11}
						color={STATE_COLOR[a.state]}
						cls={a.state === "running" ? "spinner" : undefined}
					/>
					<ftext size={11}>{agentDisplayName(a)}</ftext>
					{a.tokens !== undefined && a.tokens > 0 ? (
						<ftext size={11} color="#8b949e">
							{formatTokens(a.tokens)}
						</ftext>
					) : null}
					<ftext color="#8b949e" size={11}>
						{formatDuration((a.endedAt ?? now) - a.startedAt)}
					</ftext>
				</fbox>
			))}
		</fbox>
	);
}

