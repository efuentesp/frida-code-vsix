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
// Issue #7 (reapertura): ¿cada sesión recibe una webBridge DISTINTA? Si la 2ª
// sesión llega con otra webBridge pero el singleton `wired`/`mounted` ya está
// puesto, se retorna el mount STALE (sobre la webBridge de la sesión anterior)
// y el panel no aparece en la nueva sesión. `lastBridge` detecta ese caso.
let lastBridge: ExtensibleWorkflowWebBridge | undefined;

/** Monta el panel persistente en el footer (idempotente). */
export function wireExtensibleWorkflowPanel(
	webBridge: ExtensibleWorkflowWebBridge,
): { unmount: () => void } {
	// ¿Llegó una webBridge distinta a la del montaje previo? (clave para H2)
	const bridgeChanged = lastBridge !== undefined && lastBridge !== webBridge;
	wfLog("wire_enter", {
		alreadyWired: wired,
		hasMounted: !!mounted,
		bridgeChanged,
		hasLastBridge: !!lastBridge,
	});
	lastBridge = webBridge;
	if (wired && mounted) {
		// Retornó sin re-montar. Si bridgeChanged, se devolvió el mount stale
		// (sobre la webBridge anterior) → el panel no se pinta en la sesión nueva.
		wfLog("wire_return_stale", { bridgeChanged });
		return mounted;
	}
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
	lastBridge = undefined;
}
