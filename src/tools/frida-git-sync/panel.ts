// frida-git-sync — wiring del widget de estado al webview.
//
// Patrón de frida-subagents/panel.ts: mountPersistent en el footer, idempotente.
// El host (extension.ts) lo cablea una vez por sesión.

import type { ReactElement } from "react";
import { createGitSyncWidget } from "./GitSyncWidget";

export interface GitSyncWidgetWebBridge {
	mountPersistent: (
		factory: () => ReactElement,
		placement?: "overlay" | "footer",
	) => { unmount: () => void };
}

let widgetMounted: { unmount: () => void } | undefined;
let wired = false;

/** Monta el widget persistente en el footer (idempotente). */
export function mountGitSyncWidget(webBridge: GitSyncWidgetWebBridge): {
	unmount: () => void;
} {
	if (widgetMounted) return widgetMounted;
	widgetMounted = webBridge.mountPersistent(createGitSyncWidget, "footer");
	return widgetMounted;
}

/** Cableja todo una vez: monta el widget. Idempotente. */
export function wireGitSyncWidget(webBridge: GitSyncWidgetWebBridge): void {
	if (wired) return;
	wired = true;
	mountGitSyncWidget(webBridge);
}

/** Desmonta el widget. */
export function unmountGitSyncWidget(): void {
	widgetMounted?.unmount();
	widgetMounted = undefined;
	wired = false;
}

/** Sólo tests. */
export function _resetGitSyncWidget(): void {
	widgetMounted?.unmount();
	widgetMounted = undefined;
	wired = false;
}
