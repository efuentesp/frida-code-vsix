// frida-git-sync — widget de estado de sincronización (fridaWeb React).
//
// Patrón de frida-subagents/AgentWidget.tsx: useSyncExternalStore sobre
// syncWidgetStore. Auto-hide cuando está idle. Muestra Codicons vectoriales,
// fase/mensaje, elapsed y un botón Cancel.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { syncWidgetStore, type SyncWidgetStatus } from "./store";

interface SyncStatusMeta {
	icon: string;
	color: string;
	spin?: boolean;
}

const STATUS_MAP: Record<SyncWidgetStatus, SyncStatusMeta> = {
	idle: {
		icon: "circle",
		color: "var(--vscode-descriptionForeground)",
	},
	running: {
		icon: "sync",
		color: "var(--vscode-list-warningForeground, #cca700)",
		spin: true,
	},
	stopping: {
		icon: "sync",
		color: "var(--vscode-list-warningForeground, #cca700)",
		spin: true,
	},
	cancelled: {
		icon: "circle-slash",
		color: "var(--vscode-gitDecoration-deletedResourceForeground, #f85149)",
	},
	done: {
		icon: "check",
		color: "var(--vscode-testing-iconPassed, #3fb950)",
	},
	error: {
		icon: "error",
		color: "var(--vscode-errorForeground, #f85149)",
	},
};

function formatElapsed(elapsedMs: number): string {
	const seconds = Math.floor(elapsedMs / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${seconds % 60}s`;
}

function GitSyncPanel(): ReactElement | null {
	const s = useSyncExternalStore(
		syncWidgetStore.subscribe,
		syncWidgetStore.getSnapshot,
	);

	// Ticker para el elapsed
	const [, setTick] = useState(0);
	const isActive = s.status === "running" || s.status === "stopping";
	useEffect(() => {
		if (!isActive) return;
		const id = setInterval(() => setTick((n) => n + 1), 1000);
		return () => clearInterval(id);
	}, [isActive]);

	if (s.status === "idle") return null;

	const meta = STATUS_MAP[s.status] ?? STATUS_MAP.idle;
	const label =
		s.status === "done"
			? "Synchronized"
			: s.status === "error"
				? "Error"
				: s.status === "cancelled"
					? "Cancelled"
					: s.status === "stopping"
						? "Stopping…"
						: s.message;

	return (
		<fbox
			flexDirection="row"
			gap={6}
			alignItems="center"
			padding={6}
			cls="git-sync-widget"
		>
			<ficon
				name={meta.icon}
				size={12}
				color={meta.color}
				cls={meta.spin ? "spinner" : undefined}
			/>
			<ftext bold size={12}>
				frida-git-sync
			</ftext>
			<ftext size={12}>{label}</ftext>
			{(s.status === "running" || s.status === "stopping") && (
				<ftext
					color="var(--vscode-descriptionForeground)"
					size={11}
					cls="tabular-nums"
				>
					· {formatElapsed(s.elapsedMs)}
				</ftext>
			)}
			{s.cancelFn && s.status === "running" && (
				<fbutton variant="secondary" onClick={() => syncWidgetStore.cancel()}>
					Cancel
				</fbutton>
			)}
		</fbox>
	);
}

/** Factory del elemento raíz (el host lo pasa a mountPersistent). */
export function createGitSyncWidget(): ReactElement {
	return <GitSyncPanel />;
}
