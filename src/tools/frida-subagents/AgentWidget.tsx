// frida-subagents — widget de agentes activos (fridaWeb React).
//
// Patrón de frida-pipeline/banner.tsx + todo-web/todo-web.tsx:
// useSyncExternalStore sobre agentWidgetStore. Auto-hide cuando no hay
// agentes. Muestra Codicons vectoriales, chips de rol y métricas tabulares.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { agentWidgetStore, type AgentDisplay } from "./store";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";

interface AgentStatusMeta {
	icon: string;
	color: string;
	spin?: boolean;
}

const STATUS_MAP: Record<AgentDisplay["status"], AgentStatusMeta> = {
	running: {
		icon: "sync",
		color: "var(--vscode-list-warningForeground, #cca700)",
		spin: true,
	},
	queued: {
		icon: "clock",
		color: "var(--vscode-descriptionForeground, #8b949e)",
	},
	completed: {
		icon: "check",
		color: "var(--vscode-testing-iconPassed, #3fb950)",
	},
	error: {
		icon: "error",
		color: "var(--vscode-errorForeground, #f85149)",
	},
	stopped: {
		icon: "debug-stop",
		color: "var(--vscode-descriptionForeground, #8b949e)",
	},
	steered: {
		icon: "sparkle",
		color: "var(--vscode-textLink-foreground, #4daafc)",
	},
	aborted: {
		icon: "error",
		color: "var(--vscode-errorForeground, #f85149)",
	},
};

function formatElapsed(startedAt: number, completedAt?: number): string {
	const totalMs = completedAt ? completedAt - startedAt : Date.now() - startedAt;
	const seconds = Math.floor(totalMs / 1000);
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

function AgentRow({ agent }: { agent: AgentDisplay }): ReactElement {
	const status = STATUS_MAP[agent.status] ?? STATUS_MAP.queued;
	const isRunning = agent.status === "running";
	const elapsed = formatElapsed(agent.startedAt, agent.completedAt);

	const stats: string[] = [];
	if (agent.turnCount != null && agent.turnCount > 0) {
		stats.push(
			`turn ${agent.turnCount}${agent.maxTurns == null ? "" : `/${agent.maxTurns}`}`,
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
		<fbox flexDirection="column" gap={2} cls="agent-dense-row">
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ficon
					name={status.icon}
					size={12}
					color={status.color}
					cls={status.spin ? "spinner" : undefined}
				/>
				<fbox cls="agent-role-chip" padding={2}>
					<ftext size={11} bold>
						{agent.type}
					</ftext>
				</fbox>
				<ftext bold size={12}>
					{agent.description}
				</ftext>
				<ftext
					color="var(--vscode-descriptionForeground)"
					size={11}
					cls="tabular-metrics"
				>
					· {stats.join(" · ")}
				</ftext>
			</fbox>
			{isRunning && agent.activity ? (
				<fbox
					flexDirection="row"
					alignItems="center"
					gap={6}
					paddingLeft={14}
					cls="agent-subactivity-guide"
				>
					<ficon
						name="arrow-right"
						size={10}
						color="var(--vscode-descriptionForeground)"
					/>
					<ftext
						color="var(--vscode-descriptionForeground)"
						size={11}
						cls="code-target"
					>
						{agent.activity}
					</ftext>
				</fbox>
			) : null}
		</fbox>
	);
}

function AgentWidgetPanel(): ReactElement | null {
	const agents = useSyncExternalStore(
		agentWidgetStore.subscribe,
		agentWidgetStore.getSnapshot,
	);
	// Reloj en vivo mientras haya agentes corriendo para actualizar el elapsed
	const [, setTick] = useState(0);
	const [collapsed, setCollapsed] = useState(false);
	const hasRunning = agents.some((a) => a.status === "running");
	useEffect(() => {
		if (!hasRunning) return;
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, [hasRunning]);

	if (agents.length === 0) return null;

	const running = agents.filter((a) => a.status === "running");
	const queued = agents.filter((a) => a.status === "queued");
	const done = agents.filter(
		(a) =>
			a.status === "completed" || a.status === "error" || a.status === "stopped",
	);

	return (
		<CollapsiblePanel
			collapsed={collapsed}
			onToggle={() => setCollapsed((c) => !c)}
			padding={6}
			cls="agent-widget-container"
			header={
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon name="copilot" size={13} />
					<ftext bold size={12}>
						AGENTES ACTIVOS
					</ftext>
					<ftext size={11} color="var(--vscode-descriptionForeground)">
						({running.length} en ejecución
						{queued.length > 0 ? `, ${queued.length} en cola` : ""})
					</ftext>
				</fbox>
			}
		>
			<fbox flexDirection="column" gap={4}>
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
					<ftext color="var(--vscode-descriptionForeground)" size={11}>
						{queued.length} en cola
					</ftext>
				)}
			</fbox>
		</CollapsiblePanel>
	);
}

/** Factory del elemento raíz (el host lo pasa a mountPersistent). */
export function createAgentWidgetElement(): ReactElement {
	return <AgentWidgetPanel />;
}
