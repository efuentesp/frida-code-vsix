// Análisis de capacidad del contexto (fase B, paridad supi-context). Porte ampliado:
// estimación de tokens, categorías de mensajes, desglose del system prompt con
// atribución (instruction files, skills, guidelines por fuente, tool snippets por
// tool) + tool definitions. Funciones PURAS para llamarlas tanto desde el tool
// execute (ctx del SDK) como desde el comando /context (frida.session + store).

import {
	buildSessionContext,
	formatSkillsForPrompt,
	getLatestCompactionEntry,
	type BuildSystemPromptOptions,
	type ContextUsage,
	type SessionEntry,
	type Skill,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
	classifyGuidelines,
	determineOrigin,
	extractGuidelineBullets,
	extractGuidelinesSection,
	type GuidelineSourceInfo,
} from "./prompt-inference";
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

export interface ContextFileInfo {
	path: string;
	tokens: number;
	lines: number;
	origin: "global" | "project";
}
export interface SkillInfo {
	name: string;
	tokens: number;
}
export interface ToolSnippetInfo {
	name: string;
	tokens: number;
}
export interface ToolDefInfo {
	name: string;
	description: string;
	tokens: number;
}
export interface ToolDefinitions {
	count: number;
	tokens: number;
	tools: ToolDefInfo[];
}

/** Tokens de un mensaje cualquiera (serializa y estima). */
function estimateMessageTokens(msg: any): number {
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

/** Assistant: separa texto/thinking de toolCalls. */
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

/** Categoriza los mensajes de la rama por rol. */
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

/** Escala las categorías estimadas para sumar el real si hay tokens medidos. */
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

// --- Composición del system prompt (atribución detallada, paridad supi) ---

const INSTRUCTION_FILE_PATTERN = /^(AGENTS|CLAUDE|\.claude\.local)\.md$/i;

function isInstructionFile(path: string): boolean {
	const basename = path.replace(/\\/g, "/").split("/").pop() ?? "";
	return INSTRUCTION_FILE_PATTERN.test(basename);
}

/** Separa contextFiles en instruction (AGENTS/CLAUDE) y contextFiles ( resto). */
function computeContextFiles(
	options: BuildSystemPromptOptions | undefined,
	cwd: string,
): {
	instructionFiles: ContextFileInfo[];
	contextFiles: ContextFileInfo[];
} {
	const instructionFiles: ContextFileInfo[] = [];
	const contextFiles: ContextFileInfo[] = [];
	for (const cf of options?.contextFiles ?? []) {
		const info: ContextFileInfo = {
			path: String(cf.path ?? ""),
			tokens: estimateTextTokens(cf.content ?? ""),
			lines: (cf.content ?? "").split("\n").length,
			origin: determineOrigin(String(cf.path ?? ""), cwd),
		};
		if (isInstructionFile(info.path)) instructionFiles.push(info);
		else contextFiles.push(info);
	}
	return { instructionFiles, contextFiles };
}

/** Skills con tokens individuales (vía formatSkillsForPrompt, como supi). */
function computeSkills(
	options: BuildSystemPromptOptions | undefined,
): SkillInfo[] {
	return (options?.skills ?? []).map((s: Skill) => ({
		name: String(s.name ?? "skill"),
		tokens: estimateTextTokens(formatSkillsForPrompt([s])),
	}));
}

/** Snippets de tool con tokens individuales. */
function buildToolSnippetDetails(
	toolSnippets: Record<string, string> | undefined,
): ToolSnippetInfo[] {
	if (!toolSnippets) return [];
	return Object.entries(toolSnippets)
		.map(([name, snippet]) => ({ name, tokens: estimateTextTokens(snippet) }))
		.sort((a, b) => b.tokens - a.tokens);
}

/** Tool definitions activos con tokens (requiere allTools + activeTools cacheados). */
export function computeToolDefinitions(
	allTools: ToolInfo[],
	activeTools: string[],
): ToolDefinitions {
	const active = new Set(activeTools);
	const tools = allTools
		.filter((t) => active.has(t.name))
		.map((t) => ({
			name: t.name,
			description: t.description,
			tokens: estimateTextTokens(
				JSON.stringify({
					name: t.name,
					description: t.description,
					parameters: t.parameters,
				}),
			),
		}))
		.sort((a, b) => b.tokens - a.tokens);
	return {
		count: tools.length,
		tokens: tools.reduce((s, t) => s + t.tokens, 0),
		tools,
	};
}

export interface SystemPromptBreakdown {
	base: number;
	guidelines: number;
	toolSnippets: number;
	appendText: number;
	customPrompt: number;
	skills: SkillInfo[];
	contextFiles: ContextFileInfo[];
	instructionFiles: ContextFileInfo[];
	toolSnippetDetails: ToolSnippetInfo[];
	guidelineSources: GuidelineSourceInfo[];
	guidelineBullets: string[];
}

/** Desglose del system prompt con atribución detallada (paridad supi). */
export function computeSystemPromptBreakdown(
	options: BuildSystemPromptOptions | undefined,
	systemPromptText: string | undefined,
	systemPromptTokens: number,
	cwd: string,
): SystemPromptBreakdown {
	const { instructionFiles, contextFiles } = computeContextFiles(options, cwd);
	const skills = computeSkills(options);
	const skillsTotal = skills.reduce((s, c) => s + c.tokens, 0);

	// Guidelines: inferimos del systemPrompt final (incluye defaults del core);
	// fallback a promptGuidelines de options si no hay texto.
	const inferredGuidelines = extractGuidelinesSection(systemPromptText ?? "");
	const guidelines = inferredGuidelines
		? estimateTextTokens(inferredGuidelines)
		: options?.promptGuidelines
			? estimateTextTokens(options.promptGuidelines.join("\n"))
			: 0;
	const guidelineBullets = extractGuidelineBullets(inferredGuidelines);
	const guidelineSources = classifyGuidelines(
		guidelineBullets,
		options?.selectedTools ?? [],
	);

	const toolSnippetDetails = buildToolSnippetDetails(options?.toolSnippets);
	const toolSnippets = toolSnippetDetails.reduce((s, t) => s + t.tokens, 0);
	const appendText = options?.appendSystemPrompt
		? estimateTextTokens(options.appendSystemPrompt)
		: 0;
	const customPrompt = options?.customPrompt
		? estimateTextTokens(options.customPrompt)
		: 0;

	const known =
		skillsTotal +
		contextFiles.reduce((s, c) => s + c.tokens, 0) +
		instructionFiles.reduce((s, c) => s + c.tokens, 0) +
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
		instructionFiles,
		toolSnippetDetails,
		guidelineSources,
		guidelineBullets,
	};
}

export interface ContextAnalysis {
	snapshot: ContextPressureSnapshot;
	categories: CategoryTokens;
	scaled: boolean;
	approximationNote: string | null;
	usedTokens: number;
	systemPromptBreakdown: SystemPromptBreakdown;
	toolDefinitions: ToolDefinitions;
}

/** Snapshot puro desde datos (sin ctx). */
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

/** Orquesta el reporte completo. Puras — el caller aporta todos los datos. */
export function analyzeContext(params: {
	usage: ContextUsage | undefined;
	branch: SessionEntry[];
	systemPromptText: string | undefined;
	options: BuildSystemPromptOptions | undefined;
	modelName: string;
	compactionEnabled: boolean;
	reserveTokens: number;
	allTools: ToolInfo[];
	activeTools: string[];
}): ContextAnalysis {
	const {
		usage,
		branch,
		systemPromptText,
		options,
		modelName,
		compactionEnabled,
		reserveTokens,
		allTools,
		activeTools,
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
	const cwd = options?.cwd ?? process.cwd();
	return {
		snapshot,
		categories,
		scaled: scaling.scaled,
		approximationNote: scaling.approximationNote,
		usedTokens: scaling.usedTokens,
		systemPromptBreakdown: computeSystemPromptBreakdown(
			options,
			systemPromptText,
			categories.systemPrompt,
			cwd,
		),
		toolDefinitions: computeToolDefinitions(allTools, activeTools),
	};
}
