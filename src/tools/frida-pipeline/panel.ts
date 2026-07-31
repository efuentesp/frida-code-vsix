// frida-pipeline — wire del banner persistente (Fase 1).
//
// Espejo de `frida-workflow/panel.ts` (D32): monta el banner React en el
// footer del webview, idempotente. El host (extension.ts) llama `wirePipeline`
// una vez por sesión; llamadas subsecuentes son no-op.

import type { ReactElement } from "react";
import { createPipelineBannerElement } from "./banner";

/** Slice del WebBridge que el banner necesita (structural — no importa el SDK). */
export interface PipelineWebBridge {
	mountPersistent: (
		factory: () => ReactElement,
		placement?: "overlay" | "footer",
	) => { unmount: () => void };
}

let panelMounted: { unmount: () => void } | undefined;
let wired = false;

/** Monta el banner persistente en el footer (idempotente). */
export function mountPipelinePanel(webBridge: PipelineWebBridge): {
	unmount: () => void;
} {
	if (panelMounted) return panelMounted;
	panelMounted = webBridge.mountPersistent(
		createPipelineBannerElement,
		"footer",
	);
	return panelMounted;
}

/** Cableja todo una vez: monta el banner. Idempotente. */
export function wirePipelinePanel(webBridge: PipelineWebBridge): void {
	if (wired) return;
	wired = true;
	mountPipelinePanel(webBridge);
}

/** Sólo tests. */
export function _resetPipelinePanel(): void {
	panelMounted?.unmount();
	panelMounted = undefined;
	wired = false;
}
