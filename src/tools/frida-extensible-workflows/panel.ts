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
	if (wired && mounted) return mounted;
	wired = true;
	if (!mounted) {
		mounted = webBridge.mountPersistent(
			createExtensibleWorkflowPanelElement,
			"footer",
		);
	}
	return mounted;
}

/** Sólo tests. */
export function _resetExtensibleWorkflowPanel(): void {
	mounted?.unmount();
	mounted = undefined;
	wired = false;
}
