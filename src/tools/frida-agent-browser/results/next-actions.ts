/**
 * frida-agent-browser — nextActions contextuales (Fase 1).
 *
 * Porte enfocado de results/next-actions.js + recovery-actions del referencia:
 * payloads de seguimiento accionables (`details.nextActions`) con la shape estable
 *   { id, params: { args, sessionMode?, stdin? }, reason, tool: "agent_browser" }
 * para que el agente ejecute el siguiente paso sin reconstruir argv a mano.
 *
 * Se portean las acciones de mayor valor (continuación tras navegación + recuperación
 * ante fallos comunes); las especializadas del referencia (dialog-after-timeout,
 * click-candidates, dismiss-dialog…) se agregan cuando se porteen sus features.
 */

import type { FailureCategory } from "./categories";

export interface NextAction {
	id: string;
	params: { args: string[]; sessionMode?: "auto" | "fresh"; stdin?: string };
	reason: string;
	tool: "agent_browser";
}

const NAVIGATE_COMMANDS = new Set(["open", "goto", "navigate", "pushstate"]);

function snapshotAction(id: string, reason: string): NextAction {
	return {
		id,
		params: { args: ["snapshot", "-i"] },
		reason,
		tool: "agent_browser",
	};
}

export interface BuildNextActionsOptions {
	command?: string;
	succeeded: boolean;
	failureCategory?: FailureCategory;
}

/**
 * Construye las nextActions según el contexto del resultado.
 * Dedupe por id (preserva primer ocurrencia) — réplica de appendUnique.
 */
export function buildNextActions(opts: BuildNextActionsOptions): NextAction[] {
	const out: NextAction[] = [];
	const seen = new Set<string>();
	const push = (a: NextAction) => {
		if (!seen.has(a.id)) {
			seen.add(a.id);
			out.push(a);
		}
	};

	if (opts.succeeded) {
		// Tras navegación, los refs cambiaron → re-snapshotea antes de interactuar.
		if (opts.command && NAVIGATE_COMMANDS.has(opts.command)) {
			push(
				snapshotAction(
					"snapshot-after-navigation",
					"Refs are page-scoped; snapshot -i to get current @refs after navigation.",
				),
			);
		}
		return out;
	}

	switch (opts.failureCategory) {
		case "selector-not-found":
			push(
				snapshotAction(
					"refresh-interactive-refs",
					"Element not found; snapshot -i to refresh @refs and confirm visible targets.",
				),
			);
			break;
		case "stale-ref":
			push(
				snapshotAction(
					"refresh-interactive-refs",
					"@ref may be stale; snapshot -i to refresh refs before retrying.",
				),
			);
			break;
		case "timeout":
			push({
				id: "recover-after-timeout",
				params: { args: ["snapshot", "-i"] },
				reason:
					"Timed out; inspect current page state with snapshot -i before retrying a shorter action.",
				tool: "agent_browser",
			});
			break;
		case "missing-binary":
		case "parse-failure":
		case "aborted":
		case "upstream-error":
			// Sin nextAction automática útil (instalación / diagnóstico humano).
			break;
	}
	return out;
}
