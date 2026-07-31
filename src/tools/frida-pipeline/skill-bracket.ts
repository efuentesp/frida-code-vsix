// frida-pipeline — skill-bracket: override de modelo/thinking por skill.
//
// Porte de `rpiv-core/skill-bracket.ts` (ADR-0021 Fase 3). Intercepta
// `/skill:<name>` en el hook `input`, mira `config.skills[name]`, y si hay
// override explícito aplica el modelo/thinking. Al terminar el turno
// (`agent_end`), restaura el baseline.
//
// Contract:
//  - Filtrar event.source === "interactive". El path de workflow es dueño de
//    source="extension"; rpc es raro y diferido.
//  - Parse del nombre de skill via parseSkillInvocation (tanto `/skill:foo`
//    crudo COMO wrapped `<skill name="…">…</skill>` post-frida-args).
//  - Armar SÓLO si hay entrada explícita en config.skills[name] — los defaults
//    no son trigger; sólo las entradas per-skill explícitas arman.
//  - Todas las mutaciones de pi envueltas en applyOrSkipIfStale.
//  - Un solo slot armable nullable — Pi serializa turnos; input concurrente
//    no puede disparar mientras agent_end está pendiente.
//  - Restaurar baseline SIEMPRE en agent_end (setModel persiste a disco).

import {
	type ExtensionAPI,
	type InputEvent,
	parseSkillBlock,
} from "@earendil-works/pi-coding-agent";
import {
	loadModelsConfig,
	type ModelThinkingLevelValue,
} from "./models-config";
import {
	applyEffectiveModel,
	applyOrSkipIfStale,
	type BaselineSnapshot,
	getCapturedModel,
	restoreBaseline,
} from "./session-capture";

const SKILL_PREFIX = "/skill:";

/** `hasModelChange` rastrea si llamamos pi.setModel durante el arm — en
 *  agent_end saltamos el restore-setModel cuando no hubo cambio de modelo
 *  (override de thinking únicamente), evitando una escritura innecesaria al
 *  archivo de settings. */
let armedBaseline: BaselineSnapshot | undefined;

/** Test reset. */
export function __resetSkillBracketState(): void {
	armedBaseline = undefined;
}

/**
 * Parse del nombre de skill desde el texto de un input-event. Maneja TANTO
 * `/skill:<name>` crudo (cuando frida-args no ha transformado, o no está
 * instalado) COMO wrapped `<skill name="…" location="…">…</skill>`
 * (post-transformación de frida-args).
 *
 * Tokeniza la forma cruda en el primer whitespace (space/newline/tab) para
 * que `/skill:commit\n` devuelva `name="commit"`, no `"commit\n"`.
 */
export function parseSkillInvocation(
	text: string,
): { name: string } | undefined {
	if (text.startsWith(SKILL_PREFIX)) {
		const wsIdx = text.search(/\s/);
		const name =
			wsIdx === -1
				? text.slice(SKILL_PREFIX.length)
				: text.slice(SKILL_PREFIX.length, wsIdx);
		return name.length > 0 ? { name } : undefined;
	}
	const wrapped = parseSkillBlock(text);
	return wrapped ? { name: wrapped.name } : undefined;
}

/**
 * Registra el skill-bracket en la instancia de Pi. Hookea `input` (para armar
 * el override) y `agent_end` (para restaurar el baseline).
 *
 * Idempotente: Pi deduplica handlers con la misma referencia de función.
 */
export function registerSkillBracket(pi: ExtensionAPI): void {
	pi.on("input", async (event: InputEvent) => {
		if (event.source !== "interactive") return { action: "continue" } as const;

		const parsed = parseSkillInvocation(event.text);
		if (!parsed) return { action: "continue" } as const;

		const config = loadModelsConfig();
		const override = config.skills?.[parsed.name];
		if (
			!override ||
			(override.model === undefined && override.thinking === undefined)
		) {
			return { action: "continue" } as const;
		}

		await applyOrSkipIfStale(async () => {
			const baselineThinking = pi.getThinkingLevel() as ModelThinkingLevelValue;
			armedBaseline = {
				thinking: baselineThinking,
				model: getCapturedModel(),
				hasModelChange: false,
			};

			const { hasModelChange } = await applyEffectiveModel(pi, {
				overrideModel: override.model,
				baselineModel: armedBaseline.model,
				overrideThinking: override.thinking,
				baselineThinking,
				label: `/skill:${parsed.name}`,
				setBaselineModel: false,
			});
			armedBaseline.hasModelChange = hasModelChange;
		});

		return { action: "continue" } as const;
	});

	pi.on("agent_end", async () => {
		if (!armedBaseline) return;
		const baseline = armedBaseline;
		// Limpiar el estado ANTES de intentar restaurar para que un throw
		// non-stale no pueda doble-restaurar en el próximo agent_end.
		armedBaseline = undefined;

		await applyOrSkipIfStale(() => restoreBaseline(pi, baseline));
	});
}
