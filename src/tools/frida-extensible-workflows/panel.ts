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
// puesto, se retornaba el mount STALE (sobre la webBridge de la sesión anterior
// — newSession() además dispone esa bridge) y el panel no aparecía nunca más.
// `lastBridge` detecta ese caso y ahora SÍ re-monta sobre la bridge nueva.
let lastBridge: ExtensibleWorkflowWebBridge | undefined;

/** Monta el panel persistente en el footer (idempotente por bridge). */
function mountOn(webBridge: ExtensibleWorkflowWebBridge): {
	unmount: () => void;
} {
	mounted = webBridge.mountPersistent(
		createExtensibleWorkflowPanelElement,
		"footer",
	);
	wfLog("wire_mount_ok", {
		hasUnmount: typeof mounted?.unmount === "function",
	});
	return mounted;
}

/** Monta el panel persistente en el footer (idempotente). */
export function wireExtensibleWorkflowPanel(
	webBridge: ExtensibleWorkflowWebBridge,
): { unmount: () => void } {
	// ¿Llegó una webBridge distinta a la del montaje previo? (nueva sesión tras
	// newSession(), o webview recreado) → el mount previo quedó huérfano sobre
	// una bridge dispuesta: re-montar sobre la nueva.
	const bridgeChanged = lastBridge !== undefined && lastBridge !== webBridge;
	wfLog("wire_enter", {
		alreadyWired: wired,
		hasMounted: !!mounted,
		bridgeChanged,
		hasLastBridge: !!lastBridge,
	});
	lastBridge = webBridge;
	if (bridgeChanged && mounted) {
		// Desmontar el mount stale ANTES de re-montar (patrón remountWorkflowPanel
		// #165 de frida-workflow). El unmount de una bridge ya dispuesta no debe
		// romper el flujo.
		try {
			mounted.unmount();
		} catch (e) {
			wfLog("wire_unmount_stale_error", { error: String(e) });
		}
		mounted = undefined;
		wfLog("wire_remount", { reason: "bridgeChanged" });
	}
	wired = true;
	if (!mounted) {
		try {
			return mountOn(webBridge);
		} catch (e) {
			wfLog("wire_mount_error", { error: String(e) });
			throw e;
		}
	}
	return mounted;
}

/** #7 reapertura — La webview se (re)montó: el mount del footer se PIERDE cuando
 * VS Code recrea/deshidrata la webview del chat. Re-montar el panel sobre la
 * bridge vigente (el store conserva los runs; el panel simplemente reaparece).
 * Incondicional POR DISEÑO (paridad con remountWorkflowPanel #165 de
 * frida-workflow): la webview puede recrearse bajo el MISMO objeto bridge
 * (republish), así que "ya montado aquí" no garantiza un root React vivo. */
export function remountExtensibleWorkflowPanel(
	webBridge: ExtensibleWorkflowWebBridge,
): void {
	if (mounted) {
		try {
			mounted.unmount();
		} catch (e) {
			wfLog("wire_unmount_stale_error", { error: String(e) });
		}
	}
	mounted = undefined;
	lastBridge = webBridge;
	wired = true;
	wfLog("wire_remount", { reason: "webview-remount" });
	try {
		mountOn(webBridge);
	} catch (e) {
		wfLog("wire_mount_error", { error: String(e) });
	}
}

/** Sólo tests. */
export function _resetExtensibleWorkflowPanel(): void {
	mounted?.unmount();
	mounted = undefined;
	wired = false;
	lastBridge = undefined;
}
