// Análisis de capacidad del contexto (fase B). Porte simplificado de supi-context
// `analysis.ts`: estimación de tokens, categorías de mensajes, desglose del system
// prompt y orquestación. Funciones PURAS (sin side-effects) para poder llamarlas
// tanto desde el tool execute (ctx del SDK) como desde el handler slash /context
// (frida.session + store cacheado en before_agent_start).

import {
	buildSessionContext,
	getLatestCompactionEntry,
	type BuildSystemPromptOptions,
	type ContextUsage,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ContextPressureSnapshot } from "./types";

/** ≈4 chars/token (heurística de supi; suficiente para atribución). */
export function estimateTextTokens(text: string): number {
	return Math.ceil((text ?? "").length / 4);
}

export interface CategoryTokens {
	systemPrompt: number;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	other: number;
}

/** Tokens de un mensaje cualquiera (serializa y estima). */
function estimateMessageTokens(msg: any): number {
	// Contenido textual real (no metadata) para no inflar con IDs/timestamps.
	try {
		const content = msg?.content;
		if (typeof content === "string") return estimateTextTokens(content);
		if (Array.isArray(content)) {
			return content.reduce((sum: number, b: any) => {
				if (typeof b === "string") return sum + estimateTextTokens(b);
				if (b?.type === "text") return sum + estimateTextTokens(b.text ?? "");
				if (b?.type === "thinking")
					return sum + estimateTextTokens(b.thinking ?? "");
				if (b?.type === "toolCall")
					return (
						sum +
						estimateTextTokens(
							(b.name ?? "") + JSON.stringify(b.arguments ?? {}),
						)
					);
				if (b?.type === "toolResult")
					return (
						sum +
						estimateTextTokens(
							typeof b.content === "string"
								? b.content
								: JSON.stringify(b.content ?? ""),
						)
					);
				return sum + estimateTextTokens(JSON.stringify(b ?? ""));
			}, 0);
		}
		return estimateTextTokens(JSON.stringify(msg));
	} catch {
		return 0;
	}
}

/** Assistant: separa texto/thinking de toolCalls (paridad estimateAssistantMessage). */
function categorizeAssistant(msg: any): { text: number; toolCalls: number } {
	let textChars = 0;
	let toolChars = 0;
	const blocks = Array.isArray(msg?.content) ? msg.content : [];
	for (const b of blocks) {
		if (b?.type === "text") textChars += (b.text ?? "").length;
		else if (b?.type === "thinking") textChars += (b.thinking ?? "").length;
		else if (b?.type === "toolCall")
			toolChars +=
				(b.name ?? "").length + JSON.stringify(b.arguments ?? {}).length;
	}
	return {
		text: Math.ceil(textChars / 4),
		toolCalls: Math.ceil(toolChars / 4),
	};
}

/** Categoriza los mensajes de la rama por rol (paridad computeMessageCategories). */
export function computeMessageCategories(messages: any[]): CategoryTokens {
	const c: CategoryTokens = {
		systemPrompt: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolCalls: 0,
		toolResults: 0,
		other: 0,
	};
	for (const msg of messages) {
		const role = msg?.role;
		if (role === "user") c.userMessages += estimateMessageTokens(msg);
		else if (role === "assistant") {
			const est = categorizeAssistant(msg);
			c.assistantMessages += est.text;
			c.toolCalls += est.toolCalls;
		} else if (role === "tool" || role === "toolResult")
			c.toolResults += estimateMessageTokens(msg);
		else c.other += estimateMessageTokens(msg);
	}
	return c;
}

/** Si hay tokens medidos, escala las categorías estimadas para que sumen el real
 *  (paridad applyScaling). Sin medición, queda la estimación cruda. */
export function applyScaling(
	categories: CategoryTokens,
	actualTokens: number | null,
): {
	scaled: boolean;
	approximationNote: string | null;
	usedTokens: number;
	rawTotal: number;
} {
	const rawTotal =
		categories.systemPrompt +
		categories.userMessages +
		categories.assistantMessages +
		categories.toolCalls +
		categories.toolResults +
		categories.other;
	const hasActual = typeof actualTokens === "number" && actualTokens > 0;
	const approximationNote = !hasActual
		? "Estimación: el gateway no reportó tokens medidos tras la última respuesta."
		: null;
	if (hasActual && rawTotal > 0) {
		const scale = actualTokens! / rawTotal;
		categories.systemPrompt = Math.round(categories.systemPrompt * scale);
		categories.userMessages = Math.round(categories.userMessages * scale);
		categories.assistantMessages = Math.round(
			categories.assistantMessages * scale,
		);
		categories.toolCalls = Math.round(categories.toolCalls * scale);
		categories.toolResults = Math.round(categories.toolResults * scale);
		categories.other = Math.round(categories.other * scale);
		return {
			scaled: true,
			approximationNote,
			usedTokens: actualTokens!,
			rawTotal,
		};
	}
	return {
		scaled: false,
		approximationNote,
		usedTokens: hasActual ? actualTokens! : rawTotal,
		rawTotal,
	};
}

export interface SystemPromptBreakdown {
	base: number;
	guidelines: number;
	toolSnippets: number;
	appendText: number;
	customPrompt: number;
	skills: { name: string; tokens: number }[];
	contextFiles: { path: string; tokens: number }[];
}

/** Desglose del system prompt desde BuildSystemPromptOptions (paridad simplificada
 *  de computeSystemPromptBreakdown: sin extractGuidelinesSection/classifyGuidelines). */
export function computeSystemPromptBreakdown(
	options: BuildSystemPromptOptions | undefined,
	systemPromptTokens: number,
): SystemPromptBreakdown {
	const skills = (options?.skills ?? []).map((s: any) => ({
		name: String(s?.name ?? "skill"),
		tokens: estimateTextTokens(
			typeof s === "string" ? s : JSON.stringify(s ?? ""),
		),
	}));
	const contextFiles = (options?.contextFiles ?? []).map((f: any) => ({
		path: String(f?.path ?? ""),
		tokens: estimateTextTokens(f?.content ?? ""),
	}));
	const guidelines = options?.promptGuidelines
		? estimateTextTokens(options.promptGuidelines.join("\n"))
		: 0;
	const toolSnippets = options?.toolSnippets
		? estimateTextTokens(Object.values(options.toolSnippets).join("\n"))
		: 0;
	const appendText = options?.appendSystemPrompt
		? estimateTextTokens(options.appendSystemPrompt)
		: 0;
	const customPrompt = options?.customPrompt
		? estimateTextTokens(options.customPrompt)
		: 0;
	const known =
		skills.reduce((s, c) => s + c.tokens, 0) +
		contextFiles.reduce((s, c) => s + c.tokens, 0) +
		guidelines +
		toolSnippets +
		appendText +
		customPrompt;
	return {
		base: Math.max(0, systemPromptTokens - known),
		guidelines,
		toolSnippets,
		appendText,
		customPrompt,
		skills,
		contextFiles,
	};
}

export interface ContextAnalysis {
	snapshot: ContextPressureSnapshot;
	categories: CategoryTokens;
	scaled: boolean;
	approximationNote: string | null;
	usedTokens: number;
	systemPromptBreakdown: SystemPromptBreakdown;
}

/** Snapshot puro desde datos (sin ctx). Reutilizado por el tool concise y analyzeContext. */
export function buildSnapshot(params: {
	usage: ContextUsage | undefined;
	modelName: string;
	compactionEnabled: boolean;
	reserveTokens: number;
	compacted: boolean;
}): ContextPressureSnapshot {
	const { usage, modelName, compactionEnabled, reserveTokens, compacted } =
		params;
	const contextWindow = usage?.contextWindow ?? null;
	const hasMeasured = usage?.tokens != null;
	const usedTokens = usage?.tokens ?? 0;
	const effective =
		contextWindow != null ? Math.max(0, contextWindow - reserveTokens) : null;
	return {
		modelName,
		contextWindow,
		usedTokens,
		usagePercent:
			contextWindow && contextWindow > 0
				? Math.round((usedTokens / contextWindow) * 100)
				: null,
		compactionEnabled,
		reserveTokens,
		headroomTokens: effective != null ? effective - usedTokens : null,
		pressurePercent:
			effective != null && effective > 0
				? Math.round((usedTokens / effective) * 100)
				: null,
		compacted,
		approximationNote: !hasMeasured
			? "Estimación: el gateway no reportó tokens medidos tras la última respuesta."
			: null,
	};
}

/** Orquesta el reporte completo: snapshot + categorías (escaladas) + desglose del
 *  system prompt. Puras — el caller aporta usage/branch/systemPromptText/options. */
export function analyzeContext(params: {
	usage: ContextUsage | undefined;
	branch: SessionEntry[];
	systemPromptText: string | undefined;
	options: BuildSystemPromptOptions | undefined;
	modelName: string;
	compactionEnabled: boolean;
	reserveTokens: number;
}): ContextAnalysis {
	const {
		usage,
		branch,
		systemPromptText,
		options,
		modelName,
		compactionEnabled,
		reserveTokens,
	} = params;
	const messages = buildSessionContext(branch).messages as any[];
	const categories = computeMessageCategories(messages);
	categories.systemPrompt = estimateTextTokens(systemPromptText ?? "");
	const scaling = applyScaling(categories, usage?.tokens ?? null);
	const snapshot = buildSnapshot({
		usage,
		modelName,
		compactionEnabled,
		reserveTokens,
		compacted: getLatestCompactionEntry(branch) !== null,
	});
	return {
		snapshot,
		categories,
		scaled: scaling.scaled,
		approximationNote: scaling.approximationNote,
		usedTokens: scaling.usedTokens,
		systemPromptBreakdown: computeSystemPromptBreakdown(
			options,
			categories.systemPrompt,
		),
	};
}
