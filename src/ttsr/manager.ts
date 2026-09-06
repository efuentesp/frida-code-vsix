// TTSR (#201): guards de estado del monitor — PURO e inyectable (clock).
//
// Anti-bucle es el riesgo estructural de TTSR: abortar → reinyectar → que el
// modelo vuelva a violar → abortar… Este módulo decide SI una violación debe
// convertirse en intervención, con cuatro guards:
//
//  1. `intervening`: tras disparar una intervención, ignorar TODO hasta el
//     agent_start siguiente — los deltas del stream moribundo (y el parcial
//     que el SDK aún emite) no re-disparan.
//  2. Conteo por regla por CADENA: una cadena arranca con cada prompt nuevo
//     del usuario (before_agent_start con prompt) y se corta con maxPerChain
//     (default 2). repeatMode=once además baja a 1 por cadena.
//  3. cooldownMs por regla entre intervenciones (si repeatMode=cooldown).
//  4. Tope duro por cadena (todas las reglas sumadas): corta cascadas si
//     varias reglas se disparan juntas (default 4).
//
// Puro (sin I/O ni SDK): el contrato completo se testea aquí; la política de
// "qué es una cadena" la alimenta el coordinator desde los eventos del SDK.

import type { TtsrRule, TtsrScope } from "./rules";

export interface TtsrViolation {
	ruleId: string;
	scope: TtsrScope;
	pattern: string;
	fragment: string;
	/** Reminder de la regla (lo usa el coordinator para el steer). */
	reminder: string;
}

export interface TtsrManagerDeps {
	now?: () => number;
	/** Tope de intervenciones por regla por cadena cuando la regla no define maxPerChain. */
	defaultMaxPerChain?: number;
	/** Tope duro de intervenciones totales por cadena (todas las reglas). */
	maxPerChainTotal?: number;
}

interface RuleState {
	interventions: number;
	lastInterventionAt: number | undefined;
}

export interface TtsrManager {
	/** Cadena nueva: prompt del usuario. Resetea contadores y cooldowns. */
	onUserPrompt(): void;
	/** agent_start del SDK: fin de la ventana `intervening` (nuevo run). */
	onAgentStart(): void;
	/** ¿Esta violación debe convertirse en intervención? (guards 1-4). */
	shouldIntervene(rule: TtsrRule, violation: Omit<TtsrViolation, "reminder">): boolean;
	/** Marca la intervención como disparada (actualiza contadores). */
	onIntervention(rule: TtsrRule): void;
	/** ¿Hay una intervención en vuelo (deltas del stream moribundo se ignoran)? */
	isIntervening(): boolean;
	/** Estado para diagnóstico. */
	snapshot(): { chain: number; total: number; byRule: Record<string, number> };
}

export function createTtsrManager(deps: TtsrManagerDeps = {}): TtsrManager {
	const now = deps.now ?? Date.now;
	const defaultMax = deps.defaultMaxPerChain ?? 2;
	const maxTotal = deps.maxPerChainTotal ?? 4;
	let chain = 0;
	let total = 0;
	let intervening = false;
	const byRule = new Map<string, RuleState>();

	const stateOf = (id: string): RuleState => {
		let s = byRule.get(id);
		if (!s) {
			s = { interventions: 0, lastInterventionAt: undefined };
			byRule.set(id, s);
		}
		return s;
	};

	return {
		onUserPrompt() {
			chain += 1;
			total = 0;
			intervening = false;
			byRule.clear();
		},
		onAgentStart() {
			intervening = false;
		},
		shouldIntervene(rule, v): boolean {
			if (intervening) return false; // stream moribundo tras el abort
			if (total >= maxTotal) return false; // tope duro de cadena
			const s = stateOf(v.ruleId);
			const cap = rule.maxPerChain ?? (rule.repeatMode === "once" ? 1 : defaultMax);
			if (s.interventions >= cap) return false;
			if (
				rule.repeatMode === "cooldown" &&
				rule.cooldownMs !== undefined &&
				s.lastInterventionAt !== undefined &&
				now() - s.lastInterventionAt < rule.cooldownMs
			) {
				return false;
			}
			return true;
		},
		onIntervention(rule) {
			intervening = true;
			total += 1;
			const s = stateOf(rule.id);
			s.interventions += 1;
			s.lastInterventionAt = now();
		},
		isIntervening() {
			return intervening;
		},
		snapshot() {
			const out: Record<string, number> = {};
			for (const [id, s] of byRule) out[id] = s.interventions;
			return { chain, total, byRule: out };
		},
	};
}
