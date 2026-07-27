/**
 * D16 — puente de diagnósticos de pi-lens hacia el webview.
 *
 * pi-lens emite `pilens:diagnostics` en el bus de eventos de Pi (EventBus) cada
 * vez que recalcula diagnósticos (tras writes/edits del agente). Esta factory se
 * suscribe a ese canal y reenvía el payload al host por callback, igual que los
 * gates (ApprovalBridge) y ask_user_question (QuestionBridge) — patrón de ADR-0006.
 *
 * A diferencia del editor de VS Code (squiggles), aquí NO publicamos al editor
 * (redundante con su LSP): publicamos un RESUMEN agregado al webview, para dar
 * visibilidad del feedback que de otra forma viaja oculto al modelo.
 */

/** Severity de un diagnóstico de pi-lens: string (normalizado) o número (LSP crudo). */
export type LensSeverity =
	| "error"
	| "warning"
	| "information"
	| "hint"
	| string
	| number;

export interface LensDiagnostic {
	range?: {
		start?: { line?: number; character?: number };
		end?: { line?: number; character?: number };
	};
	severity?: LensSeverity;
	message?: string;
	code?: string | number;
	source?: string;
	semantic?: string | null;
}

/** Payload del evento `pilens:diagnostics` (v1). Ver publishDiagnostics en pi-lens. */
export interface LensDiagnosticsPayload {
	v?: number;
	source?: string;
	cwd?: string;
	seq?: number;
	ts?: number;
	files: Array<{
		path: string;
		diagnostics: LensDiagnostic[];
		truncated?: boolean;
	}>;
}

/** Categoría de severidad ya clasificada (para contar y pintar). */
export type LensCategory = "error" | "warning" | "other";

export function classifySeverity(s: LensSeverity | undefined): LensCategory {
	if (s === undefined || s === null) return "other";
	if (typeof s === "number") {
		// LSP crudo: 1=Error, 2=Warning, 3=Info, 4=Hint.
		if (s <= 1) return "error";
		if (s === 2) return "warning";
		return "other";
	}
	const low = String(s).toLowerCase();
	if (low === "error") return "error";
	if (low === "warning" || low === "warn") return "warning";
	return "other";
}

/**
 * Devuelve una factory de Pi que se suscribe a `pilens:diagnostics` y reenvía
 * cada payload a `onDiagnostics`. Si el canal nunca se emite (pi-lens no cargó,
 * p. ej.), el callback simplemente no se invoca — sin error.
 */
export function createLensDiagnosticsBridge(
	onDiagnostics: (payload: LensDiagnosticsPayload) => void,
) {
	return (pi: import("@earendil-works/pi-coding-agent").ExtensionAPI) => {
		pi.events?.on?.("pilens:diagnostics", (raw: unknown) => {
			// El bus entrega `unknown`; validamos la forma mínima antes de reenviar.
			if (
				raw &&
				typeof raw === "object" &&
				Array.isArray((raw as LensDiagnosticsPayload).files)
			) {
				onDiagnostics(raw as LensDiagnosticsPayload);
			}
		});
	};
}
