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
import { resolveCheckpointFromUi, stopWorkflowRun } from "./frida-delivery";
import {
	purgeOrphans,
	readOrphanJournal,
	readLiveRuns,
	scanOrphans,
} from "./gc";
import { wfLog } from "./telemetry";
import {
	getOrphanRuns,
	getWorkflowRuns,
	rehydrateRuns,
	removeWorkflowRun,
	setOrphanRuns,
	subscribePanelVisibility,
	subscribeOrphanRuns,
	subscribeWorkflowRuns,
	consumePanelShowRequest,
	type OrphanRunView,
	type WorkflowRunView,
} from "./store";
import {
	buildWorkflowTree,
	formatCost,
	formatTime,
	formatTokens,
	orphanStatusPill,
	recentFailed,
	runPill,
	runStats,
	collapsedHeader,
	agentDisplayName,
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
	const [collapsedRuns, setCollapsedRuns] = useState<Set<string>>(new Set());
	const [dismissed, setDismissed] = useState(false);
	const toggleRun = (runId: string) => {
		setCollapsedRuns((prev) => {
			const next = new Set(prev);
			if (next.has(runId)) next.delete(runId);
			else next.add(runId);
			return next;
		});
	};
	useEffect(() => {
		if (active.length > 0) setDismissed(false);
	}, [active.length]);
	const [showForced, setShowForced] = useState(false);
	useEffect(() => {
		if (consumePanelShowRequest()) setShowForced(true);
		return subscribePanelVisibility(() => {
			if (consumePanelShowRequest()) setShowForced(true);
		});
	}, []);
	useEffect(() => {
		if (showForced) setCollapsed(false); // mostrar = también expandir
	}, [showForced]);
	// #69: journal expandido de un huérfano ([Ver journal]).
	const [journal, setJournal] = useState<{ runId: string; text: string } | null>(
		null,
	);
	// #69: scan de huérfanos al montar el panel (la sesión viva queda excluida
	// por su lease owner.json — no necesita excludeSessionIds).
	// #84: rehidrata runs running/awaiting de sesiones VIVAS leídos de disco —
	// checkpoints nacidos antes de este montaje vuelven a ser visibles.
	useEffect(() => {
		readLiveRuns()
			.then(rehydrateRuns)
			.catch(() => undefined);
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
	// #74: fallidos de la sesión viva — visibles para debuggear, cap 3.
	const failedRecent = recentFailed(runs);
	const empty =
		active.length === 0 && failedRecent.length === 0 && orphans.length === 0;
	// Auto-hide total: si está vacío o el usuario lo cerró, no renderiza nada en el footer.
	if (empty || dismissed) return null;
	return (
		<CollapsiblePanel
			collapsed={collapsed}
			onToggle={() => setCollapsed((c) => !c)}
			padding={6}
			gap={4}
			header={<HeaderSummary runs={runs} collapsed={collapsed} />}
			actions={
				<fbox
					onClick={() => setDismissed(true)}
					cls="wf-close-icon-only"
					title="Cerrar panel de workflows"
				>
					<ficon name="x" size={12} color="#8b949e" />
				</fbox>
			}
		>
			{active.map((r) => (
				<RunView
					key={r.runId}
					run={r}
					isCollapsed={collapsedRuns.has(r.runId)}
					onToggleCollapse={() => toggleRun(r.runId)}
				/>
			))}
			{/* #74: fallidos recientes de la sesión viva — el panel ya no se
			    auto-oculta cuando un workflow muere rápido; dismiss por card. */}
			{failedRecent.length > 0 ? (
				<fbox flexDirection="column" gap={4}>
					<fbox flexDirection="row" gap={4} alignItems="center">
						<ficon name="triangle-alert" size={11} color="#f85149" />
						<ftext bold size={11} color="#f85149">
							Fallidos recientes
						</ftext>
						<ftext size={11} color="#8b949e">
							({failedRecent.length})
						</ftext>
					</fbox>
					{failedRecent.map((r) => (
						<fbox key={r.runId} flexDirection="row" gap={4} alignItems="flex-start">
							<fbox flex={1} flexDirection="column">
								<RunView
									run={r}
									isCollapsed={collapsedRuns.has(r.runId)}
									onToggleCollapse={() => toggleRun(r.runId)}
								/>
							</fbox>
							<fbox
								onClick={() => removeWorkflowRun(r.runId)}
								cls="wf-close-icon-only"
								title="Quitar de fallidos recientes"
							>
								<ficon name="x" size={11} color="#8b949e" />
							</fbox>
						</fbox>
					))}
				</fbox>
			) : null}
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
	// Purga individual: olderThanDays 0 — el usuario ya lo vio y decidio.
	const purgeOne = (o: OrphanRunView) => {
		purgeOrphans({ runIds: [o.runId], olderThanDays: 0 })
			.then(() => onChanged())
			.catch(() => undefined);
	};
	// Lote: todos los huerfanos listados (incluye terminales), sin margen.
	const purgeAll = () => {
		purgeOrphans({ runIds: orphans.map((o) => o.runId), olderThanDays: 0 })
			.then(() => onChanged())
			.catch(() => undefined);
	};
	return (
		<fbox flexDirection="column" gap={6} padding={6} cls="wf-orphans-section">
			{/* Cabecera con titulo, badge y accion masiva */}
			<fbox
				flexDirection="row"
				alignItems="center"
				justifyContent="space-between"
				cls="wf-orphans-head"
			>
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon name="trash-2" size={13} color="#8b949e" />
					<ftext bold size={11}>
						Huérfanos de sesiones previas
					</ftext>
					<ftext size={11} color="#8b949e">
						({orphans.length})
					</ftext>
					{stuckCount > 0 ? (
						<fbox flexDirection="row" gap={3} alignItems="center" cls="wf-pill">
							<ficon name="triangle-alert" size={10} color="#d29922" />
							<ftext color="#d29922" size={10} bold>
								{stuckCount} atorado(s)
							</ftext>
						</fbox>
					) : null}
				</fbox>

				<fbutton variant="secondary" onClick={purgeAll}>
					<fbox flexDirection="row" gap={4} alignItems="center">
						<ficon name="trash-2" size={11} />
						<ftext size={11}>Purgar todos ({orphans.length})</ftext>
					</fbox>
				</fbutton>
			</fbox>

			{/* Lista de tarjetas compactas individuales */}
			<fbox flexDirection="column" gap={4}>
				{orphans.map((o) => {
					const pill = orphanStatusPill(o);
					const isJournalOpen = journal?.runId === o.runId;
					return (
						<fbox
							key={o.runId}
							flexDirection="column"
							gap={4}
							bordered
							padding={6}
							cls="wf-orphan-card"
						>
							<fbox
								flexDirection="row"
								alignItems="center"
								justifyContent="space-between"
								gap={6}
							>
								{/* Identificacion del workflow + Run ID */}
								<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
									<ficon name={pill.icon} size={12} color={pill.color} />
									<ftext bold size={11}>
										{o.workflowName}
									</ftext>
									<ftext size={10} color="#8b949e" cls="wf-mono">
										{o.runId.slice(0, 8)}
									</ftext>
								</fbox>

								{/* Pill de estado + antiguedad */}
								<fbox flexDirection="row" gap={6} alignItems="center">
									<fbox flexDirection="row" gap={4} alignItems="center" cls="wf-pill">
										<ftext color={pill.color} size={10} bold>
											{pill.label}
										</ftext>
									</fbox>

									<ftext size={10} color="#8b949e">
										{Math.floor(o.ageDays)}d
									</ftext>

									{/* Acciones contextuales */}
									<fbutton
										variant="secondary"
										onClick={() => {
											if (isJournalOpen) {
												setJournal(null);
												return;
											}
											readOrphanJournal(o.runDir).then((text) =>
												setJournal({ runId: o.runId, text }),
											);
										}}
									>
										<fbox flexDirection="row" gap={3} alignItems="center">
											<ficon name="file-text" size={10} />
											<ftext size={10}>{isJournalOpen ? "Ocultar" : "Journal"}</ftext>
										</fbox>
									</fbutton>

									<fbutton
										variant="secondary"
										onClick={() => purgeOne(o)}
										title="Purgar huérfano"
									>
										<ficon name="trash-2" size={10} />
									</fbutton>
								</fbox>
							</fbox>

							{/* Visor de Journal tipo consola/terminal */}
							{isJournalOpen ? (
								<fbox
									flexDirection="column"
									gap={2}
									padding={6}
									cls="wf-orphan-journal"
								>
									<ftext size={10} color="#8b949e" cls="wf-mono">
										{journal?.text || "(Journal vacío)"}
									</ftext>
								</fbox>
							) : null}
						</fbox>
					);
				})}
			</fbox>
		</fbox>
	);
}

/** Header del panel (#80): contraído muestra un ticker en vivo con el workflow activo,
 * fase actual, agente activo y métricas; expandido, título a secas + conteo de activos. */
function HeaderSummary({
	runs,
	collapsed,
}: {
	runs: readonly WorkflowRunView[];
	collapsed: boolean;
}): ReactElement {
	const h = collapsedHeader(runs);
	const activeRuns = runs.filter(
		(r) => r.state === "running" || r.state === "awaiting",
	);
	const singleActive = activeRuns.length === 1 ? activeRuns[0] : undefined;

	if (!collapsed || !singleActive) {
		return (
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext bold size={12}>
					{h.title}
				</ftext>
				{h.running > 0 ? (
					<fbox cls="ui-chip info">
						<ftext size={10}>
							{h.running} activo{h.running > 1 ? "s" : ""}
						</ftext>
					</fbox>
				) : null}
			</fbox>
		);
	}

	// Ticker en vivo cuando está contraído (preferencia de usuario de Frida Studio)
	const now = Date.now();
	const stats = runStats(singleActive, now);
	const activeAgent = singleActive.agents.find((a) => a.state === "running");
	const pill = runPill(singleActive.state);

	return (
		<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
			<ficon
				name={pill.icon}
				size={12}
				color={pill.color}
				cls={singleActive.state === "running" ? "spinner" : undefined}
			/>
			<ftext bold size={11}>
				{singleActive.workflowName}
			</ftext>
			{singleActive.phase ? (
				<>
					<ftext color="#8b949e" size={11}>
						·
					</ftext>
					<ftext size={11} color="var(--vscode-charts-blue, #58a6ff)">
						{singleActive.phase}
					</ftext>
				</>
			) : null}
			{activeAgent ? (
				<>
					<ftext color="#8b949e" size={11}>
						&gt;
					</ftext>
					<ftext size={11} color="#8b949e">
						{agentDisplayName(activeAgent)}
					</ftext>
				</>
			) : null}
			<fbox
				flexDirection="row"
				gap={8}
				alignItems="center"
				flex={1}
				justifyContent="flex-end"
			>
				{stats.tokens > 0 ? (
					<ftext size={10} color="#8b949e" cls="wf-mono">
						{formatTokens(stats.tokens)} tok
					</ftext>
				) : null}
				{stats.elapsedMs > 0 ? (
					<ftext size={10} color="#8b949e" cls="wf-mono">
						{formatTime(stats.elapsedMs)}
					</ftext>
				) : null}
			</fbox>
		</fbox>
	);
}

function RunView({
	run,
	isCollapsed = false,
	onToggleCollapse,
}: {
	run: WorkflowRunView;
	isCollapsed?: boolean;
	onToggleCollapse?: () => void;
}): ReactElement {
	const pill = runPill(run.state);
	const now = Date.now();
	const tree = buildWorkflowTree(run, now);
	const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
	const [confirmingStop, setConfirmingStop] = useState(false);

	const togglePhase = (phaseName: string) => {
		setCollapsedPhases((prev) => {
			const next = new Set(prev);
			if (next.has(phaseName)) next.delete(phaseName);
			else next.add(phaseName);
			return next;
		});
	};

	const canStop = run.state === "running" || run.state === "awaiting";

	const statusColor =
		run.state === "running"
			? "var(--vscode-charts-blue, #58a6ff)"
			: run.state === "completed"
				? "var(--vscode-testing-iconPassed, #3fb950)"
				: run.state === "failed"
					? "var(--vscode-testing-iconFailed, #f85149)"
					: pill.color;

	const statusIcon =
		run.state === "running"
			? "sync"
			: run.state === "completed"
				? "pass-filled"
				: run.state === "failed"
					? "error"
					: pill.icon;

	return (
		<fbox bordered flexDirection="column" gap={6} padding={8} cls="wf-card">
			{/* Header de la card: chevron + icono + nombre + id + pill · métricas a la derecha + stop */}
			<fbox
				flexDirection="row"
				alignItems="center"
				justifyContent="space-between"
				gap={8}
			>
				<fbox
					flexDirection="row"
					gap={6}
					alignItems="center"
					onClick={onToggleCollapse}
					cls="wf-run-header-clickable"
				>
					<ficon
						name={isCollapsed ? "chevron-right" : "chevron-down"}
						size={11}
						color="#8b949e"
					/>
					<ficon
						name={statusIcon}
						size={13}
						color={statusColor}
						cls={run.state === "running" ? "spinner" : undefined}
					/>
					<ftext bold size={12}>
						{run.workflowName}
					</ftext>
					<ftext color="#8b949e" size={10} cls="wf-mono">
						{run.runId.slice(0, 8)}
					</ftext>
					<fbox cls="wf-pill" background={`${pill.color}22`} padding={2}>
						<ftext color={pill.color} size={9} bold>
							{pill.label}
						</ftext>
					</fbox>
				</fbox>

				{/* Métricas a la derecha + botón Stop */}
				<fbox flexDirection="row" gap={8} alignItems="center">
					{tree.totalTokens > 0 ? (
						<ftext cls="wf-metric-text">{formatTokens(tree.totalTokens)} tok</ftext>
					) : null}
					{tree.totalCostUsd > 0 ? (
						<ftext cls="wf-metric-text">{formatCost(tree.totalCostUsd)}</ftext>
					) : null}
					{tree.totalDurationMs > 0 ? (
						<ftext cls="wf-metric-text">{formatTime(tree.totalDurationMs)}</ftext>
					) : null}

					{/* Botón detener con confirmación en 2 pasos */}
					{canStop ? (
						confirmingStop ? (
							<fbox
								cls="wf-confirm-inline"
								flexDirection="row"
								gap={4}
								alignItems="center"
							>
								<ftext size={10} color="var(--vscode-charts-red, #f14c4c)">
									¿Detener?
								</ftext>
								<fbox
									onClick={() => {
										stopWorkflowRun(run.runId);
										setConfirmingStop(false);
									}}
									cls="wf-confirm-btn"
									title="Sí, detener"
								>
									<ftext size={10} color="var(--vscode-charts-red, #f14c4c)" bold>
										Sí
									</ftext>
								</fbox>
								<fbox
									onClick={() => setConfirmingStop(false)}
									cls="wf-cancel-btn"
									title="Cancelar"
								>
									<ftext size={10} color="var(--vscode-descriptionForeground)">
										No
									</ftext>
								</fbox>
							</fbox>
						) : (
							<fbox
								onClick={() => setConfirmingStop(true)}
								cls="wf-stop-icon-only"
								title="Detener workflow"
							>
								<ficon
									name="circle-stop"
									size={13}
									color="var(--vscode-charts-red, #f14c4c)"
								/>
							</fbox>
						)
					) : null}
				</fbox>
			</fbox>

			{isCollapsed ? null : (
				<>
					{/* Árbol Jerárquico: Fases -> Agentes */}
					<fbox flexDirection="column" gap={3} cls="wf-tree-container">
						{tree.phases.map((phase) => {
							const isExpanded = !collapsedPhases.has(phase.name);
							const hasAgents = phase.agents.length > 0;
							const isCurrent = phase.state === "current";
							const isDone = phase.state === "done";
							const phaseColor = isCurrent
								? "var(--vscode-charts-blue, #58a6ff)"
								: isDone
									? "var(--vscode-testing-iconPassed, #3fb950)"
									: "var(--vscode-descriptionForeground, #8b949e)";
							const phaseIcon = isCurrent ? "sync" : isDone ? "check" : "circle";

							return (
								<fbox key={phase.name} flexDirection="column" gap={2}>
									{/* Fila de la Fase */}
									<fbox
										flexDirection="row"
										alignItems="center"
										justifyContent="space-between"
										cls={`wf-tree-row${hasAgents ? "" : " non-clickable"}`}
										onClick={hasAgents ? () => togglePhase(phase.name) : undefined}
									>
										{/* Izquierda: Chevron + Icono + Nombre de la Fase */}
										<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
											{hasAgents ? (
												<ficon
													name={isExpanded ? "chevron-down" : "chevron-right"}
													size={10}
													color="#8b949e"
												/>
											) : (
												<fbox paddingLeft={10} />
											)}
											<ficon
												name={phaseIcon}
												size={11}
												color={phaseColor}
												cls={isCurrent ? "spinner" : undefined}
											/>
											<ftext
												size={11}
												bold={isCurrent}
												color={isCurrent ? "var(--vscode-charts-blue, #58a6ff)" : undefined}
											>
												{phase.name}
											</ftext>
										</fbox>

										{/* Derecha: Métricas agregadas de la Fase */}
										<fbox flexDirection="row" gap={8} alignItems="center">
											{phase.tokens > 0 ? (
												<ftext cls="wf-metric-text">{formatTokens(phase.tokens)} tok</ftext>
											) : null}
											{phase.costUsd > 0 ? (
												<ftext cls="wf-metric-text">{formatCost(phase.costUsd)}</ftext>
											) : null}
											{phase.durationMs > 0 ? (
												<ftext cls="wf-metric-text">{formatTime(phase.durationMs)}</ftext>
											) : null}
										</fbox>
									</fbox>

									{/* Hijos de la Fase (Agentes) */}
									{hasAgents && isExpanded ? (
										<fbox flexDirection="column" gap={2} cls="wf-tree-children">
											{phase.agents.map((agent) => {
												const agentColor =
													agent.state === "completed"
														? "var(--vscode-testing-iconPassed, #3fb950)"
														: agent.state === "failed"
															? "var(--vscode-testing-iconFailed, #f85149)"
															: "var(--vscode-charts-blue, #58a6ff)";
												const agentIcon =
													agent.state === "completed"
														? "check"
														: agent.state === "failed"
															? "x"
															: "sync";

												return (
													<fbox
														key={agent.agentId}
														flexDirection="row"
														alignItems="center"
														justifyContent="space-between"
														cls="wf-tree-row non-clickable"
													>
														{/* Izquierda: Icono + Label + Badge */}
														<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
															<ficon
																name={agentIcon}
																size={10}
																color={agentColor}
																cls={agent.state === "running" ? "spinner" : undefined}
															/>
															<ftext
																size={11}
																color={
																	agent.state === "failed"
																		? "var(--vscode-testing-iconFailed, #f85149)"
																		: undefined
																}
															>
																{agent.label}
															</ftext>
															{agent.badge ? (
																<fbox cls="wf-badge-chip">
																	<ftext size={9} color="var(--vscode-descriptionForeground)">
																		{agent.badge}
																	</ftext>
																</fbox>
															) : null}
														</fbox>

														{/* Derecha: Métricas del Agente */}
														<fbox flexDirection="row" gap={8} alignItems="center">
															{agent.tokens !== undefined && agent.tokens > 0 ? (
																<ftext cls="wf-metric-text">
																	{formatTokens(agent.tokens)} tok
																</ftext>
															) : null}
															{agent.cost !== undefined && agent.cost > 0 ? (
																<ftext cls="wf-metric-text">{formatCost(agent.cost)}</ftext>
															) : null}
															{agent.durationMs > 0 ? (
																<ftext cls="wf-metric-text">
																	{formatTime(agent.durationMs)}
																</ftext>
															) : null}
														</fbox>
													</fbox>
												);
											})}
										</fbox>
									) : null}
								</fbox>
							);
						})}

						{/* Agentes raíz (sin fase) */}
						{tree.rootAgents.length > 0 ? (
							<fbox flexDirection="column" gap={2} cls="wf-tree-children">
								{tree.rootAgents.map((agent) => {
									const agentColor =
										agent.state === "completed"
											? "var(--vscode-testing-iconPassed, #3fb950)"
											: agent.state === "failed"
												? "var(--vscode-testing-iconFailed, #f85149)"
												: "var(--vscode-charts-blue, #58a6ff)";
									const agentIcon =
										agent.state === "completed"
											? "check"
											: agent.state === "failed"
												? "x"
												: "sync";

									return (
										<fbox
											key={agent.agentId}
											flexDirection="row"
											alignItems="center"
											justifyContent="space-between"
											cls="wf-tree-row non-clickable"
										>
											<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
												<ficon
													name={agentIcon}
													size={10}
													color={agentColor}
													cls={agent.state === "running" ? "spinner" : undefined}
												/>
												<ftext size={11}>{agent.label}</ftext>
												{agent.badge ? (
													<fbox cls="wf-badge-chip">
														<ftext size={9} color="var(--vscode-descriptionForeground)">
															{agent.badge}
														</ftext>
													</fbox>
												) : null}
											</fbox>
											<fbox flexDirection="row" gap={8} alignItems="center">
												{agent.tokens !== undefined && agent.tokens > 0 ? (
													<ftext cls="wf-metric-text">
														{formatTokens(agent.tokens)} tok
													</ftext>
												) : null}
												{agent.cost !== undefined && agent.cost > 0 ? (
													<ftext cls="wf-metric-text">{formatCost(agent.cost)}</ftext>
												) : null}
												{agent.durationMs > 0 ? (
													<ftext cls="wf-metric-text">{formatTime(agent.durationMs)}</ftext>
												) : null}
											</fbox>
										</fbox>
									);
								})}
							</fbox>
						) : null}
					</fbox>

					{/* Error del run (si falló) */}
					{run.error ? (
						<ftext size={11} color="var(--vscode-testing-iconFailed, #f85149)" wrap>
							{run.error}
						</ftext>
					) : null}

					{/* Banner de checkpoint con acciones al pie de SU card (#64/#71) */}
					{run.state === "awaiting" && run.checkpointName ? (
						<fbox
							cls="wf-checkpoint"
							background="#d2992221"
							flexDirection="column"
							gap={6}
							padding={8}
							bordered
						>
							<fbox flexDirection="row" gap={6} alignItems="center">
								<ficon name="shield-alert" size={13} color="#d29922" />
								<ftext color="#d29922" size={12} bold>
									Esperando aprobación de checkpoint:
								</ftext>
								<ftext color="#d29922" size={12}>
									{run.checkpointName}
								</ftext>
							</fbox>
							<fbox flexDirection="row" gap={6} alignItems="center">
								<fbutton
									variant="primary"
									onClick={() =>
										resolveCheckpointFromUi(run.runId, run.checkpointName ?? "", true)
									}
								>
									<fbox flexDirection="row" gap={4} alignItems="center">
										<ficon name="check" size={11} />
										<ftext size={11} bold>
											Aprobar y Continuar
										</ftext>
									</fbox>
								</fbutton>
								<fbutton
									variant="danger"
									onClick={() =>
										resolveCheckpointFromUi(run.runId, run.checkpointName ?? "", false)
									}
								>
									<fbox flexDirection="row" gap={4} alignItems="center">
										<ficon name="x" size={11} />
										<ftext size={11}>Rechazar / Detener</ftext>
									</fbox>
								</fbutton>
							</fbox>
						</fbox>
					) : null}
				</>
			)}
		</fbox>
	);
}
