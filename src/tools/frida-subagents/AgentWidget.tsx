// frida-subagents — widget de agentes activos (fridaWeb React).
//
// Patrón de frida-pipeline/banner.tsx + todo-web/todo-web.tsx:
// useSyncExternalStore sobre agentWidgetStore. Auto-hide cuando no hay
// agentes. Muestra spinners animados, tipo, descripción y estado.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { agentWidgetStore, type AgentDisplay } from "./store";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const STATUS_ICON: Record<AgentDisplay["status"], string> = {
	running: "●",
	queued: "○",
	completed: "✓",
	error: "✗",
	stopped: "■",
	steered: "✓",
	aborted: "✗",
};

const STATUS_COLOR: Partial<Record<AgentDisplay["status"], string>> = {
	running: "var(--vscode-list-warningForeground, #cca700)",
	completed: "var(--vscode-gitDecoration-addedResourceForeground, #3fb950)",
	error: "var(--vscode-gitDecoration-deletedResourceForeground, #f85149)",
	stopped: "var(--vscode-descriptionForeground)",
	aborted: "var(--vscode-gitDecoration-deletedResourceForeground, #f85149)",
};

function formatElapsed(startedAt: number): string {
	const seconds = Math.floor((Date.now() - startedAt) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remSeconds = seconds % 60;
	return `${minutes}m${remSeconds}s`;
}

/** Formato compacto de tokens: "33.8k", "1.2M". */
function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
	return `${count}`;
}

function AgentRow({
	agent,
	frame,
}: {
	agent: AgentDisplay;
	frame: number;
}): ReactElement {
	// running → spinner de braille animado (frame rota cada ~100ms desde el panel);
	// el resto usa su glyph de estado.
	const isRunning = agent.status === "running";
	const icon = isRunning
		? SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
		: STATUS_ICON[agent.status];
	const color = STATUS_COLOR[agent.status];
	const elapsed = agent.completedAt
		? `${Math.floor((agent.completedAt - agent.startedAt) / 1000)}s`
		: formatElapsed(agent.startedAt);

	// Stats en vivo desde el activity-tracker de la sesión hija (D1+D2):
	// ↻turns≤max · N tools · N.Nk tok · elapsed. Sólo se muestran cuando el
	// tracker ya reportó progreso; mientras tanto queda solo el elapsed.
	const stats: string[] = [];
	if (agent.turnCount != null && agent.turnCount > 0) {
		stats.push(
			`↻${agent.turnCount}${agent.maxTurns != null ? `≤${agent.maxTurns}` : ""}`,
		);
	}
	if (agent.toolUses && agent.toolUses > 0) {
		stats.push(`${agent.toolUses} tool${agent.toolUses === 1 ? "" : "s"}`);
	}
	if (agent.tokens && agent.tokens > 0) {
		stats.push(`${formatTokens(agent.tokens)} tok`);
	}
	stats.push(elapsed);

	return (
		<fbox flexDirection="column">
			<fbox flexDirection="row" gap={4} alignItems="center">
				<ftext color={color}>{icon}</ftext>
				<ftext bold>{agent.type}</ftext>
				<ftext color="var(--vscode-descriptionForeground)">
					{agent.description}
				</ftext>
				<ftext color="var(--vscode-descriptionForeground)">
					· {stats.join(" · ")}
				</ftext>
			</fbox>
			{isRunning && agent.activity ? (
				<ftext color="var(--vscode-descriptionForeground)">
					{"  ⎿  "}
					{agent.activity}
				</ftext>
			) : null}
		</fbox>
	);
}

function AgentWidgetPanel(): ReactElement | null {
	const agents = useSyncExternalStore(
		agentWidgetStore.subscribe,
		agentWidgetStore.getSnapshot,
	);
	// Reloj en vivo mientras haya agentes corriendo: rota el frame del spinner de
	// braille y hace que el cronómetro (elapsed) avance en tiempo real. Sin esto el
	// widget se ve "congelado" (icono fijo + elapsed estático) y el usuario no
	// percibe que los subagentes siguen trabajando.
	const [frame, setFrame] = useState(0);
	const hasRunning = agents.some((a) => a.status === "running");
	useEffect(() => {
		if (!hasRunning) return;
		const id = setInterval(() => setFrame((n) => n + 1), 100);
		return () => clearInterval(id);
	}, [hasRunning]);

	if (agents.length === 0) return null;

	const running = agents.filter((a) => a.status === "running");
	const queued = agents.filter((a) => a.status === "queued");
	const done = agents.filter(
		(a) =>
			a.status === "completed" ||
			a.status === "error" ||
			a.status === "stopped",
	);

	return (
		<fbox flexDirection="column" padding={6}>
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext>●</ftext>
				<ftext bold>Agents</ftext>
				<ftext color="var(--vscode-descriptionForeground)">
					({running.length} running
					{queued.length > 0 ? `, ${queued.length} queued` : ""})
				</ftext>
			</fbox>
			{running.map((a) => (
				<AgentRow key={a.id} agent={a} frame={frame} />
			))}
			{queued.map((a) => (
				<AgentRow key={a.id} agent={a} frame={frame} />
			))}
			{done.map((a) => (
				<AgentRow key={a.id} agent={a} frame={frame} />
			))}
			{queued.length > 0 && (
				<ftext color="var(--vscode-descriptionForeground)">
					{queued.length} en cola
				</ftext>
			)}
		</fbox>
	);
}

/** Factory del elemento raíz (el host lo pasa a mountPersistent). */
export function createAgentWidgetElement(): ReactElement {
	return <AgentWidgetPanel />;
}
