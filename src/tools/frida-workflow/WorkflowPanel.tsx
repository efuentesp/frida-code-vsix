// WorkflowPanel — panel persistente (footer) del estado de runs de workflow.
// Remote React (fridaWeb): se monta una vez (mountWorkflowPanel, vía webBridge) y
// se re-renderiza solo ante cada mutation del store reactivo (useSyncExternalStore).
// Auto-hide: sin runs → null → tree:null → el webview no pinta nada.
//
// Jerarquía visual estructurada:
//   Workflow (Nivel 1 — Accordion por run con chevron, progreso, estado y botón Detener)
//     └── Tareas / Etapas (Nivel 2 — Conector visual izquierdo, plan target, actividad en vivo, impacto)
//           └── Transcript vivo (Nivel 3 — Monospace indentado con tools y acciones del subagente)
//
// Tags intrinsic de frida-webview (fbox/ftext/ficon), tipados en src/frida-webview/index.ts.

import { useSyncExternalStore, useState } from "react";
import type { ReactElement } from "react";
import {
	abortRun,
	getWorkflowRuns,
	rerunWorkflow,
	runCustomCommand,
	subscribeWorkflowRuns,
	type RunStatus,
	type RunView,
	type StageView,
	type StageViewStatus,
	type TranscriptEntry,
	type UnitView,
} from "./store";
import {
	countTrailingFailedValidates,
	resolveNextStep,
} from "./plan-utils";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";

const STAGE_COLOR: Record<StageViewStatus, string | undefined> = {
	pending: "var(--vscode-descriptionForeground, #888888)",
	running: "var(--vscode-charts-blue, #58a6ff)",
	completed: "var(--vscode-charts-green, #4ec9b0)",
	failed: "var(--vscode-charts-red, #f14c4c)",
	aborted: "var(--vscode-charts-yellow, #dcdcaa)",
};

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

function getLiveActivity(
	stage: StageView,
): { icon: string; text: string } | null {
	if (
		stage.status !== "running" ||
		!stage.transcript ||
		stage.transcript.length === 0
	) {
		return null;
	}
	const lastTool = [...stage.transcript]
		.reverse()
		.find((e) => e.kind === "tool");
	if (lastTool) {
		const name = lastTool.toolName ?? "tool";
		if (name === "edit" || name === "write") {
			const diff = lastTool.diffStat ? ` (${lastTool.diffStat})` : "";
			return {
				icon: "pencil",
				text: `editando: ${shortPath(lastTool.path ?? "")}${diff}`,
			};
		}
		if (name === "bash") {
			return {
				icon: "terminal",
				text: `bash: ${truncate(lastTool.command ?? "", 50)}`,
			};
		}
		if (name === "read") {
			return {
				icon: "file-text",
				text: `leyendo: ${shortPath(lastTool.path ?? "")}`,
			};
		}
		if (name === "grep" || name === "find") {
			return {
				icon: "search",
				text: `buscando: ${shortPath(lastTool.path ?? lastTool.command ?? "")}`,
			};
		}
		return { icon: "tools", text: `${name} en progreso…` };
	}
	const lastText = [...stage.transcript]
		.reverse()
		.find((e) => e.kind === "text");
	if (lastText && lastText.text) {
		return { icon: "sparkle", text: `pensando: ${truncate(lastText.text, 50)}` };
	}
	return null;
}

/** Factory del elemento raíz que monta el host vía webBridge.mountPersistent. */
export function createWorkflowPanelElement(): ReactElement {
	return <WorkflowPanel />;
}

function WorkflowPanel(): ReactElement | null {
	const state = useSyncExternalStore(subscribeWorkflowRuns, getWorkflowRuns);
	const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
	const [collapsedRuns, setCollapsedRuns] = useState<Set<string>>(new Set());
	const [panelCollapsed, setPanelCollapsed] = useState(false);
	const [dismissed, setDismissed] = useState(false);

	// Más reciente primero.
	const runs = [...state.runs].reverse();
	const activeCount = runs.filter((r) => r.status === "running").length;

	const toggleStage = (key: string): void =>
		setExpandedStages((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	const toggleRun = (runId: string): void =>
		setCollapsedRuns((prev) => {
			const next = new Set(prev);
			if (next.has(runId)) next.delete(runId);
			else next.add(runId);
			return next;
		});

	if (runs.length === 0 || (dismissed && activeCount === 0)) return null; // auto-hide

	// Si hay un run activo, mostramos prioritariamente el run activo (o los activos).
	// Si no hay ninguno activo, mostramos el más reciente para evitar duplicar paneles.
	const visibleRuns =
		activeCount > 0 ? runs.filter((r) => r.status === "running") : [runs[0]!];
	const primaryRun = visibleRuns[0];
	const isRunning = primaryRun ? primaryRun.status === "running" : false;
	const doneStages = primaryRun
		? primaryRun.stages.filter((s) => s.status === "completed").length
		: 0;
	const totalStages = primaryRun ? primaryRun.stages.length : 0;
	const activeStage = primaryRun
		? (primaryRun.stages.find((s) => s.status === "running") ??
			primaryRun.stages[primaryRun.stages.length - 1])
		: undefined;
	const live = activeStage ? getLiveActivity(activeStage) : null;
	const phaseMatch = primaryRun?.input?.match(/Phase\s+([A-Za-z0-9._-]+)/i);
	const phaseLabel = phaseMatch ? ` [${phaseMatch[1]}]` : "";

	const lastValidate = primaryRun
		? [...primaryRun.stages].reverse().find((s) => s.name === "validate")
		: undefined;
	const isPassed =
		(lastValidate?.data as { passed?: boolean } | undefined)?.passed === true;
	// #154 — misma heurística del RunBlock para el ticker colapsado
	const isCircuitPaused =
		!isRunning &&
		!isPassed &&
		countTrailingFailedValidates(primaryRun?.stages ?? []) >= 3;

	return (
		<CollapsiblePanel
			collapsed={panelCollapsed}
			onToggle={() => setPanelCollapsed((c) => !c)}
			padding={6}
			gap={6}
			header={
				<fbox flexDirection="row" gap={6} alignItems="center" flex={1}>
					<ficon
						name={
							isRunning
								? "loader-circle"
								: isPassed
									? "check"
									: isCircuitPaused
										? "circle-alert"
										: "git-branch"
						}
						size={12}
						color={
							isRunning
								? "var(--vscode-charts-blue, #58a6ff)"
								: isPassed
									? "var(--vscode-charts-green, #4ec9b0)"
									: isCircuitPaused
										? "var(--vscode-charts-yellow, #dcdcaa)"
										: "var(--vscode-descriptionForeground)"
						}
						cls={isRunning ? "spinner" : undefined}
					/>
					<ftext bold size={12}>
						{primaryRun?.workflow}
						{phaseLabel}
					</ftext>
					{totalStages > 0 ? (
						<ftext size={11} color="var(--vscode-descriptionForeground)">
							({doneStages}/{totalStages})
						</ftext>
					) : null}

					{/* Ticker de actividad viva en tiempo real */}
					{isRunning ? (
						live ? (
							<fbox flexDirection="row" gap={4} alignItems="center">
								<ficon
									name={live.icon}
									size={10}
									color="var(--vscode-charts-blue, #58a6ff)"
								/>
								<ftext color="var(--vscode-charts-blue, #58a6ff)" size={11}>
									{live.text}
								</ftext>
							</fbox>
						) : (
							<ftext color="var(--vscode-charts-blue, #58a6ff)" size={11} bold>
								· en ejecución…
							</ftext>
						)
					) : isCircuitPaused ? (
						<ftext color="var(--vscode-charts-yellow, #dcdcaa)" size={11} bold>
							· pausa (3 ciclos)
						</ftext>
					) : isPassed ? (
						<ftext color="var(--vscode-charts-green, #4ec9b0)" size={11}>
							· completado ✅
						</ftext>
					) : (
						<ftext color="var(--vscode-descriptionForeground)" size={11}>
							· @{shortRunId(primaryRun?.runId ?? "")}
						</ftext>
					)}
				</fbox>
			}
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
			<fbox flexDirection="column" gap={6}>
				{visibleRuns.map((r) => (
					<RunBlock
						key={r.runId}
						run={r}
						hasOtherActive={activeCount > 0 && r.status !== "running"}
						isCollapsed={collapsedRuns.has(r.runId)}
						onToggleCollapse={() => toggleRun(r.runId)}
						expandedStages={expandedStages}
						onToggleStage={toggleStage}
					/>
				))}
			</fbox>
		</CollapsiblePanel>
	);
}

function RunBlock({
	run,
	hasOtherActive = false,
	isCollapsed,
	onToggleCollapse,
	expandedStages,
	onToggleStage,
}: {
	run: RunView;
	hasOtherActive?: boolean;
	isCollapsed: boolean;
	onToggleCollapse: () => void;
	expandedStages: Set<string>;
	onToggleStage: (key: string) => void;
}): ReactElement {
	const done = run.stages.filter((s) => s.status === "completed").length;
	const running = run.status === "running";
	const status = runStatusToStage(run.status);
	const [confirmingStop, setConfirmingStop] = useState(false);

	// Determinar si la última etapa de validación pasó
	const lastValidateStage = [...run.stages]
		.reverse()
		.find((s) => s.name === "validate");
	const lastValidatePassed =
		(lastValidateStage?.data as { passed?: boolean } | undefined)?.passed ===
		true;

	// #154 — Pausa del circuit breaker: 3 validates FAIL consecutivos al final
	// (robusto ante grafos con más etapas previas; antes: stages.length >= 6).
	const isCircuitPaused =
		!running &&
		!hasOtherActive &&
		!lastValidatePassed &&
		countTrailingFailedValidates(run.stages) >= 3;

	// Nivel 1: Detección automática del siguiente paso para cualquier workflow con plan cuando pasa
	const isCompleted =
		!running &&
		(lastValidatePassed || run.stages.some((s) => s.name === "commit"));
	// #153 — run.cwd (del lifecycle ctx) resuelve el plan relativo al workspace;
	// sin él, process.cwd() del extension host apunta a "/" y existsSync falla.
	const nextStep = isCompleted
		? resolveNextStep(run.input, run.cwd ?? process.cwd())
		: null;

	return (
		<fbox
			bordered
			flexDirection="column"
			gap={4}
			padding={8}
			cls="wf-card"
			background="var(--vscode-sideBar-background, rgba(0,0,0,0.1))"
		>
			{/* Nivel 1: Cabecera del Workflow con botón de colapsar/expandir individual */}
			<fbox
				flexDirection="row"
				gap={6}
				alignItems="center"
				justifyContent="space-between"
			>
				<fbox
					flexDirection="row"
					gap={6}
					alignItems="center"
					flex={1}
					onClick={onToggleCollapse}
					cls="wf-run-header-clickable"
				>
					<ficon
						name={isCollapsed ? "chevron-right" : "chevron-down"}
						size={12}
						color="var(--vscode-descriptionForeground)"
					/>
					<StatusIcon status={status} size={14} />
					<ftext bold size={13}>
						{run.workflow}
					</ftext>
					<ftext size={11} color="var(--vscode-descriptionForeground)">
						({done}/{run.stages.length})
					</ftext>
					{running ? (
						<ftext color={STAGE_COLOR.running} size={11} bold>
							ejecutando…
						</ftext>
					) : isCircuitPaused ? (
						<ftext color="var(--vscode-charts-yellow, #dcdcaa)" size={11} bold>
							pausa (3 ciclos)
						</ftext>
					) : (
						<ftext color={STAGE_COLOR[status]} size={11}>
							{status === "completed" ? "completado" : "falló"}
						</ftext>
					)}
					<ftext color="var(--vscode-descriptionForeground)" size={10}>
						· @{shortRunId(run.runId)}
					</ftext>
				</fbox>

				{running ? (
					confirmingStop ? (
						<fbox
							flexDirection="row"
							gap={4}
							alignItems="center"
							cls="wf-confirm-inline"
						>
							<ftext size={11} color="var(--vscode-charts-red, #f14c4c)" bold>
								¿Detener?
							</ftext>
							<fbox
								onClick={() => {
									abortRun(run.runId);
									setConfirmingStop(false);
								}}
								cls="wf-confirm-btn"
								title="Sí, detener"
							>
								<ftext size={11} color="var(--vscode-charts-red, #f14c4c)" bold>
									Sí
								</ftext>
							</fbox>
							<fbox
								onClick={() => setConfirmingStop(false)}
								cls="wf-cancel-btn"
								title="Cancelar"
							>
								<ftext size={11} color="var(--vscode-descriptionForeground)">
									No
								</ftext>
							</fbox>
						</fbox>
					) : (
						<fbox
							onClick={() => setConfirmingStop(true)}
							cls="wf-stop-icon-only"
							title="Detener este workflow"
						>
							<ficon
								name="circle-stop"
								size={14}
								color="var(--vscode-charts-red, #f14c4c)"
							/>
						</fbox>
					)
				) : null}
			</fbox>

			{/* Banner de Pausa de Seguridad con botón Continuar */}
			{isCircuitPaused ? (
				<fbox
					flexDirection="row"
					gap={6}
					alignItems="center"
					justifyContent="space-between"
					padding={6}
					background="rgba(88, 166, 255, 0.12)"
					cls="wf-circuit-banner"
				>
					<fbox flexDirection="column" gap={2} flex={1}>
						<fbox flexDirection="row" gap={4} alignItems="center">
							<ficon
								name="info"
								size={11}
								color="var(--vscode-charts-blue, #58a6ff)"
							/>
							<ftext bold size={11} color="var(--vscode-charts-blue, #58a6ff)">
								Pausa de seguridad (3 ciclos completados)
							</ftext>
						</fbox>
						<ftext size={11} color="var(--vscode-foreground)">
							El código avanzó pero aún faltan criterios por pasar. Puedes continuar
							para dar 3 ciclos más.
						</ftext>
					</fbox>
					<fbutton
						variant="primary"
						onClick={() => rerunWorkflow(run.runId)}
						title="Lanzar otros 3 ciclos de implementación y validación"
					>
						<ficon name="play" size={10} />
						<ftext size={11}>Continuar (3 ciclos)</ftext>
					</fbutton>
				</fbox>
			) : null}

			{/* Nivel 1: Tarjeta de Siguiente Paso Sugerido cuando el workflow concluye */}
			{isCompleted && nextStep ? (
				<fbox
					flexDirection="column"
					gap={4}
					padding={8}
					background="rgba(78, 201, 176, 0.08)"
					cls="wf-next-step-card"
				>
					<fbox
						flexDirection="row"
						gap={6}
						alignItems="center"
						justifyContent="space-between"
					>
						<fbox flexDirection="row" gap={4} alignItems="center">
							<ficon
								name="sparkle"
								size={12}
								color="var(--vscode-charts-green, #4ec9b0)"
							/>
							<ftext bold size={11} color="var(--vscode-charts-green, #4ec9b0)">
								{nextStep.isPlanComplete
									? `¡Plan 100% completado! (${nextStep.totalPhases}/${nextStep.totalPhases} fases)`
									: `Fase completada (${nextStep.phaseIndex}/${nextStep.totalPhases})`}
							</ftext>
						</fbox>
					</fbox>

					{!nextStep.isPlanComplete && nextStep.nextPhase ? (
						<fbox flexDirection="column" gap={3}>
							<ftext size={11} color="var(--vscode-foreground)" bold>
								👉 Siguiente paso sugerido: {nextStep.nextPhase.fullName}
							</ftext>
							<fbox flexDirection="row" gap={6} alignItems="center">
								{nextStep.shipCommand ? (
									<fbutton
										variant="primary"
										onClick={() => {
											if (nextStep.shipCommand) {
												runCustomCommand(nextStep.shipCommand);
											}
										}}
										title="Lanzar sdd-ship para la siguiente fase"
									>
										<ficon name="play" size={10} />
										<ftext size={11}>Avanzar a {nextStep.nextPhase.id}</ftext>
									</fbutton>
								) : null}
								{nextStep.elaborateCommand ? (
									<fbutton
										variant="secondary"
										onClick={() => {
											if (nextStep.elaborateCommand) {
												runCustomCommand(nextStep.elaborateCommand);
											}
										}}
										title="Elaborar la siguiente fase"
									>
										<ficon name="file-text" size={10} />
										<ftext size={11}>Elaborar {nextStep.nextPhase.id}</ftext>
									</fbutton>
								) : null}
							</fbox>
						</fbox>
					) : null}
				</fbox>
			) : null}

			{/* Nivel 2: Árbol de Tareas / Etapas con guía de indentación jerárquica */}
			{isCollapsed ? null : (
				<fbox flexDirection="column" gap={4} paddingLeft={14} cls="wf-stages-tree">
					{run.stages.map((s, i) => (
						<StageRow
							key={`${s.name}-${i}`}
							stage={s}
							index={i}
							stageKey={`${run.runId}:${i}`}
							expanded={expandedStages.has(`${run.runId}:${i}`)}
							onToggle={onToggleStage}
						/>
					))}
					{run.error ? (
						<fbox paddingLeft={6}>
							<ftext color="var(--vscode-charts-red, #f14c4c)" size={11}>
								{run.error}
							</ftext>
						</fbox>
					) : null}
				</fbox>
			)}
		</fbox>
	);
}

function extractFailureSummary(stage: StageView): string[] {
	if (!stage.transcript) return [];
	const textEntries = stage.transcript.filter(
		(e) => e.kind === "text" && e.text,
	);
	if (textEntries.length === 0) return [];

	const allText = textEntries.map((e) => e.text).join("\n");
	const lines = allText
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const bullets: string[] = [];

	for (const line of lines) {
		if (line.startsWith("- ") || line.startsWith("* ") || /^\d+\.\s/.test(line)) {
			const clean = line
				.replace(/^[-*\d.]+\s+/, "")
				.replace(/\*\*/g, "")
				.trim();
			if (
				clean.length > 5 &&
				!clean.startsWith("`") &&
				!clean.toLowerCase().includes("reporte generado")
			) {
				bullets.push(clean);
			}
		} else if (
			line.toLowerCase().includes("no existen") ||
			line.toLowerCase().includes("faltan") ||
			line.toLowerCase().includes("phpstan reporta") ||
			line.toLowerCase().includes("error")
		) {
			if (!line.startsWith("#") && line.length < 140 && !bullets.includes(line)) {
				bullets.push(line.replace(/\*\*/g, "").trim());
			}
		}
	}

	return bullets.slice(0, 4);
}

function StageRow({
	stage,
	index,
	stageKey,
	expanded,
	onToggle,
}: {
	stage: StageView;
	index: number;
	stageKey: string;
	expanded: boolean;
	onToggle: (key: string) => void;
}): ReactElement {
	const tools = stage.transcript?.filter((e) => e.kind === "tool") ?? [];
	const hasTranscript =
		tools.length > 0 ||
		(stage.transcript?.some((e) => e.kind === "text") ?? false);
	const isRunning = stage.status === "running";

	// Insumo / Objetivo
	const targetPath = stage.primaryHandle || stage.input;
	const liveActivity = getLiveActivity(stage);

	// Veredicto de negocio de la etapa (si produjo output data)
	const verdictData = stage.data as { passed?: boolean } | undefined;
	const isPassed = verdictData?.passed === true;
	const isFailed = verdictData?.passed === false;

	// Visual status: si la ejecución terminó pero el veredicto fue fail, pintar como failed (rojo ✗)
	const visualStatus: StageViewStatus = isFailed
		? "failed"
		: isPassed
			? "completed"
			: stage.status;

	// Impacto / Estadísticas del transcript
	const editedCount = new Set(
		tools
			.filter((t) => (t.toolName === "edit" || t.toolName === "write") && t.path)
			.map((t) => t.path),
	).size;
	const bashCount = tools.filter((t) => t.toolName === "bash").length;

	return (
		<fbox flexDirection="column" gap={2} cls="wf-stage-block">
			{/* Fila principal de la Tarea / Etapa */}
			<fbox
				flexDirection="row"
				gap={6}
				alignItems="center"
				padding={4}
				tone={isRunning ? "active" : undefined}
				onClick={hasTranscript ? () => onToggle(stageKey) : undefined}
				cls="wf-stage-row"
			>
				<StatusIcon status={visualStatus} size={12} />
				<ftext bold={isRunning} size={12}>
					{index + 1}. {stage.name}
				</ftext>

				{/* Objetivo / Target (ej. plan o archivo validado) */}
				{targetPath ? (
					<ftext color="var(--vscode-descriptionForeground)" size={11}>
						→ {shortPath(targetPath)}
					</ftext>
				) : null}

				{/* Veredicto de negocio explícito (PASS / FAIL) */}
				{isFailed ? (
					<fbox
						flexDirection="row"
						gap={2}
						alignItems="center"
						background="rgba(241, 76, 76, 0.15)"
						padding={2}
					>
						<ftext color="var(--vscode-charts-red, #f14c4c)" size={10} bold>
							FAIL ❌
						</ftext>
					</fbox>
				) : isPassed ? (
					<fbox
						flexDirection="row"
						gap={2}
						alignItems="center"
						background="rgba(78, 201, 176, 0.15)"
						padding={2}
					>
						<ftext color="var(--vscode-charts-green, #4ec9b0)" size={10} bold>
							PASS ✅
						</ftext>
					</fbox>
				) : null}

				{/* Alerta de implement sin modificaciones */}
				{stage.name === "implement" &&
				stage.status === "completed" &&
				editedCount === 0 ? (
					<fbox
						flexDirection="row"
						gap={2}
						alignItems="center"
						background="rgba(229, 192, 123, 0.15)"
						padding={2}
					>
						<ftext color="#e5c07b" size={10}>
							⚠️ sin cambios
						</ftext>
					</fbox>
				) : null}

				{/* Reintentos */}
				{stage.retries && stage.retries > 0 ? (
					<fbox flexDirection="row" gap={2} alignItems="center">
						<ficon name="rotate-cw" size={10} color="#e5c07b" />
						<ftext color="#e5c07b" size={10}>
							reintento #{stage.retries}
						</ftext>
					</fbox>
				) : null}

				{/* Resumen de impacto (archivos editados) */}
				{editedCount > 0 ? (
					<fbox
						flexDirection="row"
						gap={2}
						alignItems="center"
						background="rgba(78, 201, 176, 0.15)"
						padding={2}
					>
						<ficon
							name="pencil"
							size={9}
							color="var(--vscode-charts-green, #4ec9b0)"
						/>
						<ftext color="var(--vscode-charts-green, #4ec9b0)" size={10}>
							{editedCount} editado{editedCount === 1 ? "" : "s"}
						</ftext>
					</fbox>
				) : null}

				{/* Resumen de comandos / tests */}
				{bashCount > 0 ? (
					<fbox
						flexDirection="row"
						gap={2}
						alignItems="center"
						background="rgba(128,128,128,0.15)"
						padding={2}
					>
						<ficon
							name="terminal"
							size={9}
							color="var(--vscode-descriptionForeground)"
						/>
						<ftext color="var(--vscode-descriptionForeground)" size={10}>
							{bashCount} cmd{bashCount === 1 ? "" : "s"}
						</ftext>
					</fbox>
				) : null}

				<fbox flex={1} />

				{hasTranscript ? (
					<ficon
						name={expanded ? "chevron-down" : "chevron-right"}
						size={11}
						color="var(--vscode-descriptionForeground)"
					/>
				) : null}
			</fbox>

			{/* Sub-línea de Actividad en Vivo (mientras corre la etapa) */}
			{isRunning && liveActivity ? (
				<fbox
					flexDirection="row"
					gap={4}
					alignItems="center"
					paddingLeft={20}
					padding={2}
				>
					<ficon
						name={liveActivity.icon}
						size={10}
						color="var(--vscode-charts-blue, #58a6ff)"
					/>
					<ftext color="var(--vscode-charts-blue, #58a6ff)" size={11}>
						{liveActivity.text}
					</ftext>
				</fbox>
			) : null}

			{/* Nivel 3: Tarjeta explicativa de fallo cuando la etapa no pasó */}
			{expanded && isFailed ? (
				<fbox
					flexDirection="column"
					gap={3}
					padding={6}
					background="rgba(241, 76, 76, 0.08)"
					cls="wf-failure-reasons-box"
				>
					<fbox flexDirection="row" gap={4} alignItems="center">
						<ficon
							name="circle-alert"
							size={11}
							color="var(--vscode-charts-red, #f14c4c)"
						/>
						<ftext bold size={11} color="var(--vscode-charts-red, #f14c4c)">
							Motivos del fallo detectados en la validación:
						</ftext>
					</fbox>
					{extractFailureSummary(stage).length > 0 ? (
						extractFailureSummary(stage).map((reason, i) => (
							<fbox
								key={i}
								flexDirection="row"
								gap={4}
								alignItems="flex-start"
								paddingLeft={4}
							>
								<ftext color="var(--vscode-charts-red, #f14c4c)" size={10}>
									•
								</ftext>
								<ftext color="var(--vscode-foreground)" size={11}>
									{reason}
								</ftext>
							</fbox>
						))
					) : (
						<fbox paddingLeft={4}>
							<ftext color="var(--vscode-descriptionForeground)" size={11}>
								Los criterios de aceptación de esta fase no se cumplieron al 100%.
								Revisa el transcript para ver los detalles.
							</ftext>
						</fbox>
					)}
				</fbox>
			) : null}

			{/* Nivel 3: Acciones hijas / tools / texto del sub-agente ejecutándose */}
			{expanded && stage.transcript && stage.transcript.length > 0 ? (
				<fbox
					flexDirection="column"
					gap={2}
					paddingLeft={16}
					padding={4}
					cls="wf-transcript-container"
				>
					{stage.transcript.map((e, i) => (
						<TranscriptLine key={`${e.id}-${i}`} entry={e} />
					))}
				</fbox>
			) : null}

			{stage.units && stage.units.length > 0 ? (
				<fbox flexDirection="column" gap={2} paddingLeft={16}>
					{stage.units.map((u, i) => (
						<UnitRow key={i} unit={u} />
					))}
				</fbox>
			) : null}
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
			<StatusIcon status={status} size={11} />
			<ftext color="var(--vscode-descriptionForeground)" size={11}>
				{unit.label}
			</ftext>
		</fbox>
	);
}

function TranscriptLine({ entry }: { entry: TranscriptEntry }): ReactElement {
	if (entry.kind === "text") {
		return (
			<ftext color="#9aa5ce" size={10} cls="wf-mono">
				{" "}
				«{truncate(entry.text ?? "", 140)}»
			</ftext>
		);
	}
	const status: StageViewStatus =
		entry.status === "failed"
			? "failed"
			: entry.status === "completed"
				? "completed"
				: "running";
	return (
		<fbox flexDirection="row" gap={4} alignItems="center">
			<StatusIcon status={status} size={10} />
			<ftext color={STAGE_COLOR[status]} size={10} cls="wf-mono">
				{toolLabel(entry)}
			</ftext>
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

function shortRunId(id: string): string {
	const lastDash = id.lastIndexOf("-");
	if (lastDash >= 0 && id.length - lastDash <= 6) {
		return id.slice(lastDash + 1);
	}
	return id.slice(-4);
}
