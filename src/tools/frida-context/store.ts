// Cache de systemPromptOptions + systemPromptText, poblado en before_agent_start.
// El handler slash /context (en extension.ts) no tiene ctx del SDK, así que lee de
// aquí. El tool execute sí tiene ctx y puede llamar a ctx.getSystemPrompt() directo,
// pero usa getCachedPromptOptions() para el desglose (options no se expone fuera del
// event before_agent_start).

import type { BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

let cachedOptions: BuildSystemPromptOptions | undefined;
let cachedSystemPrompt: string | undefined;

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
export function resetContextCache(): void {
	cachedOptions = undefined;
	cachedSystemPrompt = undefined;
}
