// webview/followup-rules.ts — Motor de sugerencias contextuales semánticas (Followups Copilot)
// (Fase 5: Footer — Paneles Dockeados y Followups).

import type { Turn, Segment } from "./types";

export interface FollowupSuggestion {
	id: string;
	label: string;
	prompt: string;
	iconName?: string;
}

/** Extrae el texto final de conclusión generado por el asistente en el turno. */
export function extractConclusionText(turn: Turn): string {
	const textSegments = turn.segments.filter(
		(s): s is Extract<Segment, { kind: "text" }> =>
			s.kind === "text" && typeof s.text === "string",
	);
	if (textSegments.length === 0) return "";
	return textSegments[textSegments.length - 1].text.trim();
}

/**
 * Extrae invocaciones de skills (/skill:nombre [args]) sugeridas explícitamente por el asistente.
 * Soporta bloques de código (```bash ...```), inline code (`/skill:...`), viñetas o texto plano.
 */
export function extractSkillFollowups(text: string): FollowupSuggestion[] {
	if (!text || !text.includes("/skill:")) return [];
	const suggestions: FollowupSuggestion[] = [];
	const seenPrompts = new Set<string>();

	const lines = text.split(/\r?\n/);
	for (const line of lines) {
		const regex =
			/(?:`{1,3}\s*)?\/skill:([a-zA-Z0-9_-]+)(?:[ \t]+([^\r\n`]+))?(?:`{1,3})?/g;
		let m: RegExpExecArray | null;
		while ((m = regex.exec(line)) !== null) {
			const name = m[1];
			const matchStr = m[0];
			const isInsideBackticks =
				matchStr.startsWith("`") ||
				line.trim().startsWith("```") ||
				line.trim().startsWith("/skill:");
			let rawArgs = (m[2] || "").trim();

			// Limpieza de backticks residuales
			rawArgs = rawArgs.replace(/`+$/, "").replace(/^`+/, "").trim();

			// Si los argumentos están entrecomillados, aislar el bloque entrecomillado
			if (rawArgs.startsWith('"')) {
				const nextQuote = rawArgs.indexOf('"', 1);
				if (nextQuote !== -1) {
					rawArgs = rawArgs.slice(0, nextQuote + 1);
				}
			} else if (rawArgs.startsWith("'")) {
				const nextQuote = rawArgs.indexOf("'", 1);
				if (nextQuote !== -1) {
					rawArgs = rawArgs.slice(0, nextQuote + 1);
				}
			} else if (!isInsideBackticks) {
				// En prosa sin backticks ni comillas, solo capturar flags o identificadores de fase
				if (/^--?[a-zA-Z0-9_-]+/i.test(rawArgs)) {
					const flagMatch = rawArgs.match(
						/^(--?[a-zA-Z0-9_=-]+(?:\s+--?[a-zA-Z0-9_=-]+)*)/,
					);
					rawArgs = flagMatch ? flagMatch[1] : "";
				} else if (/^Phase\s+\d+/i.test(rawArgs)) {
					const phaseMatch = rawArgs.match(/^(Phase\s+\d+(?:\s*:\s*[^\s,;.]+)?)/i);
					rawArgs = phaseMatch ? phaseMatch[1] : "";
				} else {
					rawArgs = "";
				}
			}

			// Limpiar puntuación exterior
			rawArgs = rawArgs.replace(/[\s.,;:)]+$/, "").trim();

			const prompt = rawArgs ? `/skill:${name} ${rawArgs}` : `/skill:${name}`;
			if (!seenPrompts.has(prompt)) {
				seenPrompts.add(prompt);
				let shortArgs = rawArgs;
				if (shortArgs.length > 24) {
					shortArgs = shortArgs.slice(0, 23).trimEnd() + "…";
				}
				const label = shortArgs ? `/skill:${name} ${shortArgs}` : `/skill:${name}`;
				suggestions.push({
					id: `skill-${name}-${suggestions.length}`,
					label,
					prompt,
					iconName: "sparkle",
				});
			}
		}
	}

	return suggestions.slice(0, 3);
}

/**
 * 1. Extrae propuestas / alternativas si el asistente las presentó explícitamente.
 *    Ejemplos: "### Propuesta 1: ...", "Propuesta A: ...", "**Opción 1**", "PROPUESTA 1".
 */
export function extractProposals(text: string): FollowupSuggestion[] {
	if (!text) return [];
	const suggestions: FollowupSuggestion[] = [];
	const seenIds = new Set<string>();

	// Patrón 1: Encabezados markdown "### Propuesta 1: Título" o "**Propuesta A: Título**"
	const headingRegex =
		/(?:###|\*\*)\s*(?:Propuesta|Opción|Alternativa)\s+([1-4]|[A-D])(?:\s*[:\-—.)]\s*([^\n*]+)|\*\*)/gi;
	let m: RegExpExecArray | null;
	while ((m = headingRegex.exec(text)) !== null) {
		const key = m[1].toUpperCase();
		const rawTitle = (m[2] ?? "").trim();
		const cleanTitle = rawTitle
			.replace(/\([^)]+\)/g, "")
			.replace(/\*\*/g, "")
			.trim();
		const id = `prop-${key.toLowerCase()}`;
		if (!seenIds.has(id)) {
			seenIds.add(id);
			const label = cleanTitle
				? `Propuesta ${key}: ${cleanTitle.length > 20 ? cleanTitle.slice(0, 19) + "…" : cleanTitle}`
				: `Propuesta ${key}`;
			suggestions.push({
				id,
				label,
				prompt: `Procedamos con la Propuesta ${key}.`,
				iconName: "sparkle",
			});
		}
	}

	// Patrón 2: Bloques en cajas ASCII o texto "PROPUESTA 1 (Título)" / "PROPUESTA A:"
	if (suggestions.length === 0) {
		const boxRegex =
			/PROPUESTA\s+([1-4]|[A-D])(?:\s*\(([^)]+)\)|[:\s]+([^\n│]+))/gi;
		while ((m = boxRegex.exec(text)) !== null) {
			const key = m[1].toUpperCase();
			const rawTitle = (m[2] || m[3] || "")
				.trim()
				.replace(/[│┌┐└┘├┤─]/g, "")
				.trim();
			const cleanTitle = rawTitle.replace(/\*\*/g, "").trim();
			const id = `prop-${key.toLowerCase()}`;
			if (!seenIds.has(id)) {
				seenIds.add(id);
				const label = cleanTitle
					? `Propuesta ${key}: ${cleanTitle.length > 20 ? cleanTitle.slice(0, 19) + "…" : cleanTitle}`
					: `Propuesta ${key}`;
				suggestions.push({
					id,
					label,
					prompt: `Procedamos con la Propuesta ${key}.`,
					iconName: "sparkle",
				});
			}
		}
	}

	return suggestions.slice(0, 3);
}

/**
 * 2. Extrae sugerencias dirigidas a la pregunta de cierre formulada por el asistente.
 */
export function extractQuestionFollowups(text: string): FollowupSuggestion[] {
	if (!text || !text.includes("?")) return [];

	// Obtener la última pregunta (desde ¿ o el último tramo hasta ?)
	const lastQIndex = text.lastIndexOf("?");
	const prevQ = text.lastIndexOf("¿", lastQIndex);
	const question = (
		prevQ === -1
			? text.slice(Math.max(0, lastQIndex - 140), lastQIndex + 1)
			: text.slice(prevQ, lastQIndex + 1)
	).toLowerCase();

	// Release / Publicación / Versión
	if (/(release|publicar|versión|v\d+\.\d+|tag)/i.test(question || text)) {
		const versionMatch = text.match(/\b(v\d+\.\d+\.\d+)\b/i);
		const ver = versionMatch ? versionMatch[1] : "el release";
		return [
			{
				id: "release-publish",
				label: `Publicar ${ver}`,
				prompt: `Sí, preparemos y publiquemos ${ver} en GitHub.`,
				iconName: "rocket",
			},
			{
				id: "release-changelog",
				label: "Revisar changelog",
				prompt: "Revisemos el changelog antes de publicar.",
				iconName: "book",
			},
		];
	}

	// Aplicar ajustes / Cambios inmediatos
	if (/(aplicar|ajuste|proceder|implementar|aplico)/i.test(question || text)) {
		return [
			{
				id: "apply-yes",
				label: "Sí, aplicar ajustes",
				prompt: "Sí, aplica estos ajustes.",
				iconName: "check",
			},
			{
				id: "apply-adjust",
				label: "Ajustar detalles",
				prompt: "Me gustaría ajustar algunos detalles primero.",
				iconName: "edit",
			},
		];
	}

	// Commit / Guardar en git
	if (/(commit|guardar|comitear)/i.test(question || text)) {
		return [
			{
				id: "commit-yes",
				label: "Hacer commit",
				prompt: "Sí, crea un commit con estos cambios.",
				iconName: "git-commit",
			},
			{
				id: "commit-diff",
				label: "Ver git diff",
				prompt: "Muestra el git diff antes de hacer commit.",
				iconName: "git-compare",
			},
		];
	}

	// Siguiente paso / Continuar
	if (/(siguiente|continuar|paso|avanzar|proseguir)/i.test(question || text)) {
		return [
			{
				id: "next-step-yes",
				label: "Sí, siguiente paso",
				prompt: "Continuemos con el siguiente paso.",
				iconName: "arrow-right",
			},
			{
				id: "review-status",
				label: "Revisar estado",
				prompt: "Revisemos el estado actual antes de continuar.",
				iconName: "checklist",
			},
		];
	}

	// Pregunta binaria de confirmación
	if (
		/(deseas|quieres|te parece|confirmas|procedemos|hacemos)/i.test(question)
	) {
		return [
			{
				id: "confirm-yes",
				label: "Sí, adelante",
				prompt: "Sí, adelante.",
				iconName: "check",
			},
			{
				id: "confirm-no",
				label: "No, espera",
				prompt: "No, espera un momento.",
				iconName: "close",
			},
		];
	}

	return [];
}

/**
 * Deriva sugerencias contextuales inteligentes basadas en la conclusión del último turno.
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
		return [
			{
				id: "retry-error",
				label: "Reintentar acción",
				prompt: "Reintenta la última acción corrigiendo el error.",
				iconName: "refresh",
			},
			{
				id: "explain-error",
				label: "Explicar error",
				prompt: "¿Por qué ocurrió este error y cómo lo resolvemos?",
				iconName: "question",
			},
		];
	}

	// 2. Analizar semánticamente el texto de conclusión del asistente
	const conclusion = extractConclusionText(lastTurn);
	const assistantFullText = lastTurn.segments
		.filter(
			(s): s is Extract<Segment, { kind: "text" }> =>
				s.kind === "text" && typeof s.text === "string",
		)
		.map((s) => s.text)
		.join("\n\n");

	// Nivel A: ¿El asistente propuso explícitamente skills para continuar?
	const skillFollowups = extractSkillFollowups(
		conclusion.includes("/skill:") ? conclusion : assistantFullText,
	);
	if (skillFollowups.length > 0) {
		return skillFollowups;
	}

	// Nivel B: ¿El asistente presentó propuestas / alternativas?
	const proposals = extractProposals(conclusion);
	if (proposals.length > 0) {
		return proposals;
	}

	// Nivel C: ¿El asistente formuló una pregunta de cierre / call to action?
	const questionFollowups = extractQuestionFollowups(conclusion);
	if (questionFollowups.length > 0) {
		return questionFollowups;
	}

	// Nivel C: Heurística basada en herramientas ejecutadas
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

	if (hasEditOrWrite) {
		if (hasTestOrBuild) {
			suggestions.push({
				id: "commit-changes",
				label: "Crear commit",
				prompt: "Crea un commit con estos cambios.",
				iconName: "git-commit",
			});
		} else {
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

	if (hasTestOrBuild && !hasDiagnostics && suggestions.length < 3) {
		suggestions.push({
			id: "check-diagnostics",
			label: "Comprobar diagnósticos",
			prompt: "Ejecuta lens_diagnostics para validar que no queden errores.",
			iconName: "checklist",
		});
	}

	if (hasWorkflow && suggestions.length < 3) {
		suggestions.push({
			id: "workflow-status",
			label: "Ver estado del workflow",
			prompt: "Muestra el estado actual y avance del workflow.",
			iconName: "dashboard",
		});
	}

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
