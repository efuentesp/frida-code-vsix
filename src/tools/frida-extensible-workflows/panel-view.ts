// frida-extensible-workflows · panel-view (#71) — helpers puros de la vista
// v2 (cards con pills). El panel (WorkflowPanel.tsx) los consume para pintar
// el look webview: pill de estado semántico por run, barra segmentada por
// grupo y chips de fases. Puros y testeables — sin React ni DOM.
//
// taskState se extrajo de WorkflowPanel.tsx (misma lógica, ahora reutilizada
// por groupBar).

import {
	pathKey,
	type AgentProgressState,
	type AgentProgressView,
	type GroupProgressView,
	type OrphanRunView,
	type WorkflowRunState,
	type WorkflowRunView,
} from "./store";

/** Fondo del segmento de barra por estado (GitHub-like). */
export const SEGMENT_BG: Record<AgentProgressState | "queued", string> = {
	completed: "#3fb950",
	failed: "#f85149",
	running: "#58a6ff",
	queued: "#30363d",
};

export interface RunPill {
	/** Ícono lucide (kebab-case) del estado — se materializa vía ficon (#71). */
	icon: string;
	/** Etiqueta legible corta del pill (APROBAR / RUNNING / …). */
	label: string;
	/** Color semántico del pill (fondo translúcido lo pone el CSS). */
	color: string;
}

const NEUTRAL = "#8b949e";

/** Pill de estado de un run: awaiting es ámbar (acción requerida), running
 * azul, completed verde, failed rojo; el resto neutro. Íconos lucide vía ficon. */
export function runPill(state: WorkflowRunState): RunPill {
	switch (state) {
		case "awaiting":
			return { icon: "circle-pause", label: "APROBAR", color: "#d29922" };
		case "running":
			return { icon: "loader-circle", label: "RUNNING", color: "#58a6ff" };
		case "completed":
			return { icon: "circle-check", label: "COMPLETADO", color: "#3fb950" };
		case "failed":
			return { icon: "circle-x", label: "FALLÓ", color: "#f85149" };
		case "stopped":
			return { icon: "square", label: "DETENIDO", color: NEUTRAL };
		case "budget_exhausted":
			return { icon: "hourglass", label: "SIN PRESUPUESTO", color: NEUTRAL };
		default:
			return { icon: "circle", label: String(state), color: NEUTRAL };
	}
}

/** Ícono lucide por estado de agente/tarea (#71 — sin glifos unicode). */
export const AGENT_ICON: Record<AgentProgressState | "queued", string> = {
	completed: "check",
	failed: "x",
	running: "loader-circle",
	queued: "circle",
};

/** Estado efectivo de una tarea de un grupo a partir de sus agentes:
 * failed > running > completed; sin agentes → queued. */
export function taskState(
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

export interface GroupBarSegment {
	state: AgentProgressState | "queued";
}

export interface GroupBar {
	segments: GroupBarSegment[];
	total: number;
	done: number;
	failed: number;
	running: number;
}

/** Barra segmentada de un grupo: un segmento por tarea en orden taskNames,
 * coloreable por estado (el CSS pinta verde/gris/rojo/ámbar). */
export function groupBar(
	group: GroupProgressView,
	agents: readonly AgentProgressView[],
): GroupBar {
	let done = 0;
	let failed = 0;
	let running = 0;
	const segments = group.taskNames.map((task) => {
		const state = taskState(group, task, agents);
		if (state === "completed") done++;
		else if (state === "failed") failed++;
		else if (state === "running") running++;
		return { state };
	});
	return { segments, total: segments.length, done, failed, running };
}

export interface PhaseChip {
	name: string;
	state: "done" | "current" | "pending";
}

/** Chips de fases vistas por el run: ✓ las anteriores a la actual, ● la
 * actual, · las vistas posteriores (aún no alcanzadas de nuevo). */
export function phaseChips(
	phases: readonly string[],
	current: string | undefined,
): PhaseChip[] {
	if (!current) return phases.map((name) => ({ name, state: "done" as const }));
	const seen = new Set<string>();
	const chips: PhaseChip[] = [];
	for (const name of phases) {
		if (name === current) {
			chips.push({ name, state: "current" });
			seen.add(name);
		} else if (!seen.has(name)) {
			chips.push({ name, state: "done" });
			seen.add(name);
		}
	}
	if (!seen.has(current)) {
		chips.push({ name: current, state: "current" });
	}
	// Fases vistas DESPUÉS de la actual (no debería ocurrir en una cadena,
	// pero un replay las produce): quedan como pendientes implícitas.
	const curIdx = phases.indexOf(current);
	return chips.map((chip) =>
		chip.state === "done" && curIdx >= 0 && phases.indexOf(chip.name) > curIdx
			? { ...chip, state: "pending" }
			: chip,
	);
}

// ── Propuesta 1: Copilot Pipeline Graph (DAG) ────────────────────────────────

export interface PipelineGraphNode {
	name: string;
	state: "done" | "current" | "pending";
	agentCount?: number;
	durationMs?: number;
	isLast: boolean;
}

/** Nodos del grafo horizontal del pipeline (Propuesta 1). Muestra todas las
 * fases conectadas con estado semántico (done/current/pending), conteo de
 * agentes y duración acumulada. */
export function pipelineGraph(
	run: Pick<WorkflowRunView, "phases" | "phase" | "phaseTimes" | "agents">,
	now: number,
): readonly PipelineGraphNode[] {
	const total = run.phases.length;
	return run.phases.map((name, index) => {
		const timing = run.phaseTimes[name];
		const isCurrent = run.phase === name;
		const startedAt = timing?.startedAt;
		const endedAt = timing?.endedAt;
		const state: PipelineGraphNode["state"] = isCurrent
			? "current"
			: startedAt === undefined
				? "pending"
				: "done";
		const agentCount = run.agents.filter((a) => a.phase === name).length;
		const durationMs = startedAt === undefined ? 0 : (endedAt ?? now) - startedAt;
		return {
			name,
			state,
			agentCount: agentCount > 0 ? agentCount : undefined,
			durationMs: durationMs > 0 ? durationMs : undefined,
			isLast: index === total - 1,
		};
	});
}

// ── #79: timeline vertical + label humano ─────────────────────────────────────

/** Agente anidado bajo su fase en el timeline (#79): el AgentProgressView
 * con label humano y duración ya computados (plano, para consumo directo). */
export interface TimelineAgentRow extends AgentProgressView {
	label: string;
	durationMs: number;
}

/** Fila del timeline vertical: una por fase vista, en orden (#79). */
export interface TimelineRow {
	name: string;
	state: "done" | "current" | "pending";
	startedAt?: number;
	endedAt?: number;
	durationMs: number;
	agents: readonly TimelineAgentRow[];
}

/** Label humano de un agente (#79): label de options > último tramo del
 * path > role > "agent". Es lo que muestra el panel en vez de "agent #2". */
export function agentDisplayName(a: AgentProgressView): string {
	if (a.label && a.label.trim()) return a.label;
	const last = a.structuralPath[a.structuralPath.length - 1];
	const base = last ?? a.role ?? "agent";
	return a.occurrence && a.occurrence > 1 ? `${base} #${a.occurrence}` : base;
}

/** Progreso de fases del run (#80): done = índice de la fase activa
 * (la activa aún no cuenta); fase desconocida → done = total. */
export function phaseProgress(run: Pick<WorkflowRunView, "phases" | "phase">): {
	done: number;
	total: number;
} {
	const total = run.phases.length;
	if (!total) return { done: 0, total: 0 };
	const idx = run.phases.indexOf(run.phase ?? "");
	return { done: idx >= 0 ? idx : total, total };
}

/** Datos del header contraído del panel (#80). */
export interface CollapsedHeader {
	title: string;
	progress?: { done: number; total: number };
	phase?: string;
	running: number;
}

/** Header del panel contraído (#80): con 1 run activo muestra nombre +
 * barra de fases + fase activa + ⟳N; con varios, agregado sin barra. */
export function collapsedHeader(
	runs: readonly Pick<
		WorkflowRunView,
		"workflowName" | "state" | "phase" | "phases" | "agents"
	>[],
): CollapsedHeader {
	const active = runs.filter(
		(r) => r.state === "running" || r.state === "awaiting",
	);
	const running = active.reduce(
		(n, r) => n + r.agents.filter((a) => a.state === "running").length,
		0,
	);
	if (active.length === 1) {
		const r = active[0];
		const h: CollapsedHeader = { title: r.workflowName, running };
		if (r.phase && r.phases.length > 0) {
			const p = phaseProgress(r);
			if (p.total > 0) {
				h.progress = p;
				h.phase = r.phase;
			}
		}
		return h;
	}
	if (active.length > 1) {
		return { title: `Workflows · ${active.length}`, running };
	}
	// Sin activos: título a secas (count de todos si hay varios).
	return {
		title: runs.length > 1 ? `Workflows · ${runs.length}` : "Workflows",
		running: 0,
	};
}

// ── #81: stats del run — ⏱ elapsed + ∑ tokens/costo ──────────────────────────

/** Tokens legibles (#81): 950 → "950", 543000 → "543K", 1234567 → "1.2M". */
export function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		const m = Math.round((n / 1_000_000) * 10) / 10;
		return `${m}M`;
	}
	if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
	return String(n);
}

/** Stats agregadas del run para la card (#81). Elapsed = última interacción
 * − inicio (o now si sigue corriendo sin actividad reciente). */
export function runStats(
	run: Pick<
		WorkflowRunView,
		"startedAt" | "lastActivityAt" | "tokens" | "costUsd"
	>,
	now: number,
): { elapsedMs: number; tokens: number; costUsd: number } {
	const start = run.startedAt ?? now;
	return {
		elapsedMs: Math.max(0, (run.lastActivityAt ?? now) - start),
		tokens: run.tokens,
		costUsd: run.costUsd,
	};
}

/** Runs fallidos recientes de la sesión viva (#74): más reciente primero,
 * cap 3 — para que un fallo rápido siga visible en el panel y se pueda
 * debuggear desde la UI (antes el return null los borraba de la pantalla). */
export function recentFailed(
	runs: readonly WorkflowRunView[],
): readonly WorkflowRunView[] {
	return runs
		.filter((r) => r.state === "failed")
		.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
		.slice(0, 3);
}

/** ¿Hay algo que pintar en el panel? (#84) — contenido real (runs/huérfanos)
 * o visibilidad forzada (pin fijado / request del comando). */
export function hasPanelContent(
	runs: readonly unknown[],
	orphans: readonly unknown[],
	flags: { pinned?: boolean; showRequested?: boolean } = {},
): boolean {
	if (flags.pinned || flags.showRequested) return true;
	return runs.length > 0 || orphans.length > 0;
}

/** ¿El agente cuelga de un grupo parallel/pipeline? (su path lo extiende) */
function hangsFromGroup(
	a: AgentProgressView,
	groups: readonly GroupProgressView[],
): boolean {
	const ap = pathKey(a.structuralPath);
	return groups.some(
		(g) => ap.length > 0 && ap.startsWith(`${pathKey(g.structuralPath)}/`),
	);
}

/** Rows del timeline vertical (#79): una por fase vista en orden; la activa
 * lleva anidados sus agentes libres (los de grupos quedan en su sección). */
export function timelineRows(
	run: Pick<
		WorkflowRunView,
		"phases" | "phase" | "phaseTimes" | "agents" | "groups"
	>,
	now: number,
): readonly TimelineRow[] {
	return run.phases.map((name) => {
		const timing = run.phaseTimes[name];
		const isCurrent = run.phase === name;
		const startedAt = timing?.startedAt;
		const endedAt = timing?.endedAt;
		const state: TimelineRow["state"] = isCurrent
			? "current"
			: startedAt === undefined
				? "pending"
				: "done";
		const agents: readonly TimelineAgentRow[] = run.agents
			.filter((a) => a.phase === name && !hangsFromGroup(a, run.groups))
			.sort((x, y) => x.startedAt - y.startedAt)
			.map((a) => ({
				...a,
				label: agentDisplayName(a),
				durationMs: (a.endedAt ?? now) - a.startedAt,
			}));
		return {
			name,
			state,
			startedAt,
			endedAt,
			durationMs: startedAt === undefined ? 0 : (endedAt ?? now) - startedAt,
			agents,
		};
	});
}

/** Pill de estado para runs huérfanas de sesiones previas (#149). */
export function orphanStatusPill(
	orphan: Pick<OrphanRunView, "state" | "kind">,
): RunPill {
	if (orphan.kind === "stuck") {
		return { icon: "triangle-alert", label: "ATORADO", color: "#d29922" };
	}
	return runPill(orphan.state as WorkflowRunState);
}

// ── Tree View nativo Copilot / VS Code ───────────────────────────────────────

/** Extrae el badge para un agente: modelo:thinking (ej. "glm-5.3-flash:low"),
 * tier:thinking (ej. "small:low") o role (ej. "refiner"). */
export function agentBadge(
	agent: Pick<AgentProgressView, "model" | "tier" | "role" | "effort">,
): string | undefined {
	const effort = agent.effort ? `:${agent.effort}` : "";
	if (agent.model) {
		const name = agent.model.includes("/")
			? (agent.model.split("/").pop() ?? agent.model)
			: agent.model;
		return `${name}${effort}`;
	}
	if (agent.tier) {
		return `${agent.tier}${effort}`;
	}
	if (agent.role) {
		return agent.role;
	}
	return undefined;
}

/** Formatea milisegundos a mm:ss o hh:mm:ss ("00:03", "02:23", "05:58", "10:47"). */
export function formatTime(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "--:--";
	const totalSec = Math.floor(ms / 1000);
	const sec = totalSec % 60;
	const min = Math.floor(totalSec / 60) % 60;
	const hr = Math.floor(totalSec / 3600);
	const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
	if (hr > 0) return `${pad(hr)}:${pad(min)}:${pad(sec)}`;
	return `${pad(min)}:${pad(sec)}`;
}

/** Formatea costo USD a string corto ("$0.05", "$0.007", "$0.02"). */
export function formatCost(usd: number | undefined): string {
	if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return "";
	if (usd < 0.01) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}

export interface WorkflowTreeAgentNode {
	agentId: string;
	label: string;
	state: AgentProgressState;
	startedAt: number;
	endedAt?: number;
	durationMs: number;
	badge?: string;
	tokens?: number;
	cost?: number;
}

export interface WorkflowTreePhaseNode {
	name: string;
	state: "done" | "current" | "pending";
	durationMs: number;
	tokens: number;
	costUsd: number;
	agents: readonly WorkflowTreeAgentNode[];
}

export interface WorkflowTreeData {
	phases: readonly WorkflowTreePhaseNode[];
	rootAgents: readonly WorkflowTreeAgentNode[];
	totalTokens: number;
	totalCostUsd: number;
	totalDurationMs: number;
}

/** Construye la estructura de árbol jerárquico nativo estilo Copilot/VS Code:
 * Workflow -> Fases (con métricas agregadas) -> Agentes (con chips de modelo y métricas). */
export function buildWorkflowTree(
	run: WorkflowRunView,
	now: number,
): WorkflowTreeData {
	const phasesSeen = new Set<string>();
	const phaseNodes: WorkflowTreePhaseNode[] = run.phases.map((name) => {
		phasesSeen.add(name);
		const timing = run.phaseTimes[name];
		const isCurrent = run.phase === name;
		const startedAt = timing?.startedAt;
		const endedAt = timing?.endedAt;

		const phaseAgents = run.agents
			.filter((a) => a.phase === name)
			.sort((x, y) => x.startedAt - y.startedAt);

		const agents: WorkflowTreeAgentNode[] = phaseAgents.map((a) => ({
			agentId: a.agentId,
			label: agentDisplayName(a),
			state: a.state,
			startedAt: a.startedAt,
			endedAt: a.endedAt,
			durationMs: Math.max(0, (a.endedAt ?? now) - a.startedAt),
			badge: agentBadge(a),
			tokens: a.tokens,
			cost: a.cost,
		}));

		const tokens = agents.reduce((sum, a) => sum + (a.tokens ?? 0), 0);
		const costUsd = agents.reduce((sum, a) => sum + (a.cost ?? 0), 0);
		const durationMs =
			startedAt === undefined ? 0 : Math.max(0, (endedAt ?? now) - startedAt);

		let state: WorkflowTreePhaseNode["state"] = "pending";
		if (
			agents.some((a) => a.state === "running") ||
			(isCurrent && run.state === "running")
		) {
			state = "current";
		} else if (startedAt !== undefined || agents.length > 0) {
			state = "done";
		}

		return {
			name,
			state,
			durationMs,
			tokens,
			costUsd,
			agents,
		};
	});

	const rootAgents: WorkflowTreeAgentNode[] = run.agents
		.filter((a) => !a.phase || !phasesSeen.has(a.phase))
		.sort((x, y) => x.startedAt - y.startedAt)
		.map((a) => ({
			agentId: a.agentId,
			label: agentDisplayName(a),
			state: a.state,
			startedAt: a.startedAt,
			endedAt: a.endedAt,
			durationMs: Math.max(0, (a.endedAt ?? now) - a.startedAt),
			badge: agentBadge(a),
			tokens: a.tokens,
			cost: a.cost,
		}));

	const totalTokens = run.tokens;
	const totalCostUsd = run.costUsd;
	const start = run.startedAt ?? now;
	const totalDurationMs = Math.max(0, (run.lastActivityAt ?? now) - start);

	return {
		phases: phaseNodes,
		rootAgents,
		totalTokens,
		totalCostUsd,
		totalDurationMs,
	};
}
