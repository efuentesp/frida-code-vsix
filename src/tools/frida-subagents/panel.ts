// frida-subagents — wiring del widget al webview.
//
// Patrón de frida-pipeline/panel.ts: mountPersistent en el footer,
// idempotente. El host (extension.ts) lo cablea una vez por sesión.

import type { ReactElement } from "react";
import { createAgentWidgetElement } from "./AgentWidget";
import { startAutoPrune, stopAutoPrune } from "./store";

export interface AgentWidgetWebBridge {
	mountPersistent: (
		factory: () => ReactElement,
		placement?: "overlay" | "footer",
	) => { unmount: () => void };
}

let widgetMounted: { unmount: () => void } | undefined;
let wired = false;

/** Monta el widget persistente en el footer (idempotente). */
export function mountAgentWidget(webBridge: AgentWidgetWebBridge): {
	unmount: () => void;
} {
	if (widgetMounted) return widgetMounted;
	widgetMounted = webBridge.mountPersistent(createAgentWidgetElement, "footer");
	startAutoPrune();
	return widgetMounted;
}

/** Cableja todo una vez: monta el widget + arranca auto-prune. Idempotente. */
export function wireAgentWidget(webBridge: AgentWidgetWebBridge): void {
	if (wired) return;
	wired = true;
	mountAgentWidget(webBridge);
}

/** Desmonta el widget y detiene el auto-prune. */
export function unmountAgentWidget(): void {
	widgetMounted?.unmount();
	widgetMounted = undefined;
	wired = false;
	stopAutoPrune();
}

/** Sólo tests. */
export function _resetAgentWidget(): void {
	widgetMounted?.unmount();
	widgetMounted = undefined;
	wired = false;
	stopAutoPrune();
}
