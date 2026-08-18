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
	type WorkflowRunState,
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
export function phaseChips(phases: readonly string[], current: string | undefined): PhaseChip[] {
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
		chip.state === "done" &&
		curIdx >= 0 &&
		phases.indexOf(chip.name) > curIdx
			? { ...chip, state: "pending" }
			: chip,
	);
}
