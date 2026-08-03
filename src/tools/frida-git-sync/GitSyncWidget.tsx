// frida-git-sync — widget de estado de sincronización (fridaWeb React).
//
// Patrón de frida-subagents/AgentWidget.tsx: useSyncExternalStore sobre
// syncWidgetStore. Auto-hide cuando está idle. Muestra spinner, fase/mensaje,
// elapsed y un botón Cancel (cuando la operación es cancelable).

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { syncWidgetStore, type SyncWidgetStatus } from "./store";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const STATUS_ICON: Partial<Record<SyncWidgetStatus, string>> = {
	running: "●",
	stopping: "●",
	cancelled: "✗",
	done: "✓",
	error: "✗",
};

const STATUS_COLOR: Partial<Record<SyncWidgetStatus, string>> = {
	running: "var(--vscode-list-warningForeground, #cca700)",
	stopping: "var(--vscode-list-warningForeground, #cca700)",
	cancelled: "var(--vscode-gitDecoration-deletedResourceForeground, #f85149)",
	done: "var(--vscode-gitDecoration-addedResourceForeground, #3fb950)",
	error: "var(--vscode-gitDecoration-deletedResourceForeground, #f85149)",
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

	// Reloj en vivo mientras corre: rota el frame del spinner de braille.
	const [frame, setFrame] = useState(0);
	const isActive = s.status === "running" || s.status === "stopping";
	useEffect(() => {
		if (!isActive) return;
		const id = setInterval(() => setFrame((n) => n + 1), 100);
		return () => clearInterval(id);
	}, [isActive]);

	if (s.status === "idle") return null;

	const icon =
		s.status === "running"
			? SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
			: (STATUS_ICON[s.status] ?? "●");
	const color = STATUS_COLOR[s.status];
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
		<fbox flexDirection="row" gap={6} alignItems="center" padding={6}>
			<ftext color={color}>{icon}</ftext>
			<ftext bold>frida-git-sync</ftext>
			<ftext>{label}</ftext>
			{(s.status === "running" || s.status === "stopping") && (
				<ftext color="var(--vscode-descriptionForeground)">
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
