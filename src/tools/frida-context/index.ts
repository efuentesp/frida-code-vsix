// frida-context — observabilidad de la capacidad del contexto.
//
// Porte conceptual de @mrclrchtr/supi-context (paridad de filosofía, superficie
// web en vez de TUI). Registra el tool agent-facing `context`:
//   - mode "concise" (default) → ContextPressureSnapshot (JSON 1 línea).
//   - mode "full"               → ContextAnalysis (categorías + desglose del system
//                                 prompt) en JSON, para diagnóstico de atribución.
//
// Cachea systemPromptOptions + systemPromptText en before_agent_start (store.ts)
// para que el comando /context (extension.ts, sin ctx del SDK) pueda armar el reporte.
// El medidor persistente para el humano ya existe (webview/components/ContextBar.tsx).
// ADR-0015.

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	getLatestCompactionEntry,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyzeContext, buildSnapshot } from "./analysis";
import {
	getCachedActiveTools,
	getCachedAllTools,
	getCachedPromptOptions,
	setCachedPromptOptions,
	setCachedSystemPrompt,
	setCachedTools,
} from "./store";
import type { ContextPressureSnapshot } from "./types";

const contextParams = Type.Object({
	mode: Type.Optional(
		Type.String({
			description:
				"Omitir (o 'concise') para el snapshot de presión. 'full' devuelve el reporte de atribución (categorías de uso + composición del system prompt).",
		}),
	),
});

function settingsFor(ctx: ExtensionContext) {
	return SettingsManager.create(ctx.cwd, undefined, {
		projectTrusted: ctx.isProjectTrusted(),
	});
}

/** Factory de la extensión. Registra el tool `context` (agent-facing) + cachea el
 *  systemPrompt en before_agent_start para el desglose (fase B). */
export function createFridaContext() {
	return (pi: ExtensionAPI) => {
		// Cache para el desglose del system prompt: before_agent_start trae
		// event.systemPromptOptions; el texto se lee del ctx (no va en el event).
		pi.on("before_agent_start", async (event, ctx) => {
			setCachedPromptOptions(event.systemPromptOptions);
			setCachedSystemPrompt(ctx?.getSystemPrompt());
			setCachedTools(pi.getAllTools(), pi.getActiveTools());
		});

		pi.registerTool({
			name: "context",
			label: "Context Usage",
			description:
				"Devuelve la presión del contexto para auto-regularte. mode 'concise' (default): snapshot JSON 1 línea {contextWindow, usedTokens, usagePercent, headroomTokens, pressurePercent, compactionEnabled, compacted}. Úsalo ANTES de operaciones grandes para decidir si cabe o si compactar/ser conciso. mode 'full': reporte de atribución (dónde se gasta el contexto: categorías de mensajes + composición del system prompt).",
			promptSnippet:
				"Consulta la presión del contexto antes de operaciones grandes",
			parameters: contextParams,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const settings = settingsFor(ctx);
				const usage = ctx.getContextUsage();
				const modelName =
					ctx.model?.name ?? ctx.model?.id ?? "No model selected";
				const compactionEnabled = settings.getCompactionEnabled();
				const reserveTokens = settings.getCompactionReserveTokens();

				if (params.mode !== "full") {
					const snapshot: ContextPressureSnapshot = buildSnapshot({
						usage,
						modelName,
						compactionEnabled,
						reserveTokens,
						compacted:
							getLatestCompactionEntry(ctx.sessionManager.getBranch()) !== null,
					});
					return {
						content: [{ type: "text", text: JSON.stringify(snapshot) }],
						details: { mode: "concise" as const, snapshot },
					};
				}

				const analysis = analyzeContext({
					usage,
					branch: ctx.sessionManager.getBranch(),
					systemPromptText: ctx.getSystemPrompt(),
					options: getCachedPromptOptions(),
					modelName,
					compactionEnabled,
					reserveTokens,
					allTools: getCachedAllTools(),
					activeTools: getCachedActiveTools(),
				});
				return {
					content: [{ type: "text", text: JSON.stringify(analysis) }],
					details: { mode: "full" as const, analysis },
				};
			},
		});
	};
}
