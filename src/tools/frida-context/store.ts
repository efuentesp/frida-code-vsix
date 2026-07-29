// Cache de systemPromptOptions + systemPromptText, poblado en before_agent_start.
// El handler slash /context (en extension.ts) no tiene ctx del SDK, así que lee de
// aquí. El tool execute sí tiene ctx y puede llamar a ctx.getSystemPrompt() directo,
// pero usa getCachedPromptOptions() para el desglose (options no se expone fuera del
// event before_agent_start).

import type {
	BuildSystemPromptOptions,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";

let cachedOptions: BuildSystemPromptOptions | undefined;
let cachedSystemPrompt: string | undefined;
let cachedAllTools: ToolInfo[] = [];
let cachedActiveTools: string[] = [];

export function setCachedPromptOptions(
	o: BuildSystemPromptOptions | undefined,
): void {
	cachedOptions = o;
}
export function getCachedPromptOptions(): BuildSystemPromptOptions | undefined {
	return cachedOptions;
}
export function setCachedSystemPrompt(s: string | undefined): void {
	cachedSystemPrompt = s;
}
export function getCachedSystemPrompt(): string | undefined {
	return cachedSystemPrompt;
}
/** Tools activos + catálogo completo, cacheados en before_agent_start para que el
 *  comando /context (sin ctx del SDK) pueda armar Tool Definitions. */
export function setCachedTools(all: ToolInfo[], active: string[]): void {
	cachedAllTools = all;
	cachedActiveTools = active;
}
export function getCachedAllTools(): ToolInfo[] {
	return cachedAllTools;
}
export function getCachedActiveTools(): string[] {
	return cachedActiveTools;
}
export function resetContextCache(): void {
	cachedOptions = undefined;
	cachedSystemPrompt = undefined;
	cachedAllTools = [];
	cachedActiveTools = [];
}
