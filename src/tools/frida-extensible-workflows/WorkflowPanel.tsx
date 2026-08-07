// WorkflowPanel — panel persistente (footer) de runs de frida-extensible-workflows.
// Remote React (fridaWeb): se monta una vez (wireExtensibleWorkflowPanel, vía
// webBridge) y se re-renderiza solo ante cada mutación del store reactivo
// (useSyncExternalStore). Auto-hide: sin runs → null → el webview no pinta nada.
//
// Tags intrinsic de frida-webview (fbox/ftext), tipados en src/frida-webview/index.ts.

import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import {
	getWorkflowRuns,
	subscribeWorkflowRuns,
	type WorkflowRunState,
} from "./store";

/** Factory del elemento raíz (para webBridge.mountPersistent). */
export function createExtensibleWorkflowPanelElement(): ReactElement {
	return <WorkflowPanel />;
}

function WorkflowPanel(): ReactElement | null {
	const runs = useSyncExternalStore(subscribeWorkflowRuns, getWorkflowRuns);
	if (runs.length === 0) return null;
	const active = runs.filter((r) => r.state === "running");
	if (active.length === 0) return null; // sólo muestra runs en curso
	return (
		<fbox flexDirection="column" gap={4}>
			<ftext bold>Workflows ({active.length})</ftext>
			{active.map((r) => (
				<fbox key={r.runId} flexDirection="row" gap={8} alignItems="center">
					<ftext cls="spinner">{stateIcon(r.state)}</ftext>
					<ftext bold>{r.workflowName}</ftext>
					<ftext color="#888" size={11}>
						{r.runId.slice(0, 8)}
					</ftext>
					<ftext color="#888" size={11}>
						{r.state}
					</ftext>
				</fbox>
			))}
		</fbox>
	);
}

function stateIcon(state: WorkflowRunState): string {
	switch (state) {
		case "running":
			return "⟳";
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "stopped":
			return "■";
		case "budget_exhausted":
			return "⏸";
		default:
			return "•";
	}
}
