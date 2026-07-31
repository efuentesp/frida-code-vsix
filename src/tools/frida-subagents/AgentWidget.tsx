// frida-subagents — widget de agentes activos (fridaWeb React).
//
// Patrón de frida-pipeline/banner.tsx + todo-web/todo-web.tsx:
// useSyncExternalStore sobre agentWidgetStore. Auto-hide cuando no hay
// agentes. Muestra spinners animados, tipo, descripción y estado.

import { useSyncExternalStore } from "react";
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

function AgentRow({ agent }: { agent: AgentDisplay }): ReactElement {
	const icon = STATUS_ICON[agent.status];
	const color = STATUS_COLOR[agent.status];
	const elapsed = agent.completedAt
		? `${Math.floor((agent.completedAt - agent.startedAt) / 1000)}s`
		: formatElapsed(agent.startedAt);

	return (
		<fbox flexDirection="row" gap={4} alignItems="center">
			<ftext color={color}>{icon}</ftext>
			<ftext bold>{agent.type}</ftext>
			<ftext color="var(--vscode-descriptionForeground)">
				{agent.description}
			</ftext>
			<ftext color="var(--vscode-descriptionForeground)">· {elapsed}</ftext>
		</fbox>
	);
}

function AgentWidgetPanel(): ReactElement | null {
	const agents = useSyncExternalStore(
		agentWidgetStore.subscribe,
		agentWidgetStore.getSnapshot,
	);

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
				<AgentRow key={a.id} agent={a} />
			))}
			{queued.map((a) => (
				<AgentRow key={a.id} agent={a} />
			))}
			{done.map((a) => (
				<AgentRow key={a.id} agent={a} />
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
