// Puente host↔webview para confirmar cambios de proveedor/modelo (red de
// seguridad anti cambio silencioso). Sigue el patrón DialogBridge<T,U>
// (ADR-0006): el host llama request() y queda en await; el webview responde
// vía resolve() cuando el usuario elige Aceptar/Cancelar.
//
// Tres orígenes cubiertos:
//  - "manual": el usuario cambió en el ModelPanel / /model / login → pre-confirmación.
//  - "skill":  un skill-bracket overridea el modelo → pre-confirmación con razón.
//  - "auto-detected": el modelo cambió durante un turno SIN que el host lo
//    iniciara (ciclo del SDK, restore corrupto, failover) → alerta post-run +
//    ofrecer revertir al anterior.
//
// El "cancel" SIEMPRE significa "quedarse en el proveedor/modelo actual"
// (no aplicar el cambio, o revertir si ya se aplicó).

import { DialogBridge } from "./dialog-bridge";

export interface ModelChangeEndpoint {
	provider: string; // id interno: "zai" | "softtek-devengine" | "github-copilot" | ...
	modelId: string; // "glm-4.6" | ...
}

export interface ModelChangeRequest {
	id: string;
	from: ModelChangeEndpoint;
	to: ModelChangeEndpoint;
	source: "manual" | "skill" | "auto-detected";
	/** Motivo legible: "manual", "el skill «research» pide este modelo",
	 *  "posible fallo de conexión (detectado al final del turno)". */
	reason?: string;
}

export interface ModelChangeResponse {
	id: string;
	decision: "accept" | "cancel";
}

export class ModelChangeBridge extends DialogBridge<
	ModelChangeRequest,
	ModelChangeResponse
> {
	constructor(onChange: (reqs: ModelChangeRequest[]) => void) {
		super(onChange);
	}

	protected cancelledResponse(id: string): ModelChangeResponse {
		return { id, decision: "cancel" };
	}
}
