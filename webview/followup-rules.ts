// webview/followup-rules.ts — Reglas de sugerencias contextuales (Followups Copilot)
// (Fase 5: Footer — Paneles Dockeados y Followups).

import type { Turn, Segment } from "./types";

export interface FollowupSuggestion {
	id: string;
	label: string;
	prompt: string;
	iconName?: string;
}

/**
 * Deriva sugerencias contextuales basadas en el último turno de la conversación.
 */
export function getContextualFollowups(
	turns: readonly Turn[],
	busy?: boolean,
): FollowupSuggestion[] {
	if (busy || turns.length === 0) return [];

	const lastTurn = turns[turns.length - 1];
	const suggestions: FollowupSuggestion[] = [];

	// 1. Si hubo error explícito en el turno
	if (lastTurn.error) {
		suggestions.push({
			id: "retry-error",
			label: "Reintentar acción",
			prompt: "Reintenta la última acción corrigiendo el error.",
			iconName: "refresh",
		});
		suggestions.push({
			id: "explain-error",
			label: "Explicar error",
			prompt: "¿Por qué ocurrió este error y cómo lo resolvemos?",
			iconName: "question",
		});
		return suggestions;
	}

	// 2. Extraer herramientas ejecutadas en el último turno
	const toolSegments = lastTurn.segments.filter(
		(s): s is Extract<Segment, { kind: "tool" }> => s.kind === "tool",
	);

	const hasEditOrWrite = toolSegments.some(
		(t) => t.tool === "edit" || t.tool === "write",
	);
	const hasTestOrBuild = toolSegments.some(
		(t) =>
			t.tool === "bash" &&
			typeof t.args === "object" &&
			t.args !== null &&
			"command" in t.args &&
			typeof (t.args as { command: unknown }).command === "string" &&
			/(test|vitest|jest|npm run build|tsc)/i.test(
				(t.args as { command: string }).command,
			),
	);
	const hasDiagnostics = toolSegments.some(
		(t) => t.tool === "lens_diagnostics" || t.tool === "lsp_diagnostics",
	);
	const hasWorkflow = toolSegments.some(
		(t) => t.tool === "workflow" || t.tool === "workflow_status",
	);

	// Sugerencias según acciones:
	if (hasEditOrWrite) {
		if (!hasTestOrBuild) {
			suggestions.push({
				id: "run-tests",
				label: "Ejecutar tests",
				prompt: "Ejecuta las pruebas unitarias para verificar los cambios.",
				iconName: "beaker",
			});
		}
		suggestions.push({
			id: "review-diff",
			label: "Revisar cambios",
			prompt: "Muestra un resumen de los cambios realizados en el git diff.",
			iconName: "git-compare",
		});
	}

	if (hasTestOrBuild && !hasDiagnostics) {
		suggestions.push({
			id: "check-diagnostics",
			label: "Comprobar diagnósticos",
			prompt: "Ejecuta lens_diagnostics para validar que no queden errores.",
			iconName: "checklist",
		});
	}

	if (hasWorkflow) {
		suggestions.push({
			id: "workflow-status",
			label: "Ver estado del workflow",
			prompt: "Muestra el estado actual y avance del workflow.",
			iconName: "dashboard",
		});
	}

	// Fallback inteligente si no hay sugerencias específicas:
	if (suggestions.length === 0 && lastTurn.segments.length > 0) {
		suggestions.push({
			id: "next-step",
			label: "¿Cuál es el siguiente paso?",
			prompt: "¿Cuál es el siguiente paso en la implementación?",
			iconName: "arrow-right",
		});
	}

	return suggestions.slice(0, 3);
}
