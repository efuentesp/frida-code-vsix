// Contadores de decisiones del gate para la sesión actual (ADR-0016, Fase 3).
//
// A diferencia del logger (JSONL persistente que cruza sesiones), este store es
// EN MEMORIA y por sesión: lleva los contadores ✓N/✗M/⚡Z que muestra el Stats
// footer del webview. Se resetea al iniciar una sesión nueva.
//
// Clasificación por source (paridad con ApprovalLogEntry.source):
//  - `mode`           → autoAllow (el modo dejó pasar sin preguntar).
//  - `user_approved`  → allow (aprobada en el diálogo).
//  - el resto (sensitive_path/dangerous_command/user_rejected/gate_error) → block.

import type { DecisionSource } from "../../gates/approval-logger";
import type { GateStats } from "./types";

export class GateStatsStore {
	private stats: GateStats = { allow: 0, block: 0, autoAllow: 0 };

	constructor(private readonly onChange: (s: GateStats) => void) {}

	/** Cuenta una decisión por su source. Emite el snapshot actualizado al host. */
	record(source: DecisionSource): void {
		if (source === "mode" || source === "session_pattern")
			this.stats.autoAllow++;
		else if (source === "user_approved") this.stats.allow++;
		else this.stats.block++;
		this.emit();
	}

	/** Resetea los contadores (sesión nueva). Emite ceros. */
	reset(): void {
		this.stats = { allow: 0, block: 0, autoAllow: 0 };
		this.emit();
	}

	private emit(): void {
		this.onChange({ ...this.stats });
	}
}
