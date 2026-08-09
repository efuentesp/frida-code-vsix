// frida-extensible-workflows — cableado del panel UI (Fase 7).
//
// EXTENSION-side: importa React vía WorkflowPanel.tsx. El host (extension.ts) lo
// cablea una vez con la webBridge de la sesión:
//
//   import { wireExtensibleWorkflowPanel } from "./tools/frida-extensible-workflows/panel";
//   wireExtensibleWorkflowPanel(s.webBridge); // idempotente
//
// El store (store.ts) lo muta index.ts directamente al iniciar/completar/fallar
// runs en background → el panel se re-renderiza solo (useSyncExternalStore).
// No se Suscribe a pi.events: la mutación es directa (patrón frida-workflow).

import type { ReactElement } from "react";
import { createExtensibleWorkflowPanelElement } from "./WorkflowPanel";
import { wfLog } from "./telemetry";

export interface ExtensibleWorkflowWebBridge {
	mountPersistent: (
		factory: () => ReactElement,
		placement?: "overlay" | "footer",
	) => { unmount: () => void };
}

let mounted: { unmount: () => void } | undefined;
let wired = false;

/** Monta el panel persistente en el footer (idempotente). */
export function wireExtensibleWorkflowPanel(
	webBridge: ExtensibleWorkflowWebBridge,
): { unmount: () => void } {
	wfLog("wire_enter", { alreadyWired: wired, hasMounted: !!mounted });
	if (wired && mounted) return mounted;
	wired = true;
	if (!mounted) {
		try {
			mounted = webBridge.mountPersistent(
				createExtensibleWorkflowPanelElement,
				"footer",
			);
			wfLog("wire_mount_ok", {
				hasUnmount: typeof mounted?.unmount === "function",
			});
		} catch (e) {
			wfLog("wire_mount_error", { error: String(e) });
			throw e;
		}
	}
	return mounted;
}

/** Sólo tests. */
export function _resetExtensibleWorkflowPanel(): void {
	mounted?.unmount();
	mounted = undefined;
	wired = false;
}
