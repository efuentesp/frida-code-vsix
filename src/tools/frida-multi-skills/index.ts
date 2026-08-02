// frida-multi-skills — Invocación multi-skill con sintaxis `$skill_name`.
//
// Porte de `pi-multi-skills` (MIT, QuangThai) como extensión nativa embebida
// de Frida. Permite referenciar skills desde CUALQUIER parte del prompt y
// combinar varias en un solo mensaje:
//
//   "Aplica $code-review y $commit a estos cambios"
//
// La expansión `$skill` → bloque `<skill>` produce el MISMO formato que
// `/skill:xxx` nativo de Pi (y que frida-args), así el modelo lo procesa
// idéntico. La diferencia es ergonómica: posición libre + varias por mensaje.
//
// Arquitectura (patrón dual, igual que frida-args):
//   - `expandMultiSkillText` (expand.ts) es la ÚNICA fuente de verdad.
//   - El hook `input` de esta factory es el SALVAVIDAS: expande el texto que
//     no venga del host (sesiones hijas, prompts programáticos). El texto que
//     YA viene expandido (empieza con `<skill `) no trae `$skill` → pasa
//     intacto por aquí (parseSkillRefs no encuentra nada) y por la guardia de
//     re-entrada de frida-args.
//   - El host (runPrompt en extension.ts) TAMBIÉN llama a expandMultiSkillText
//     para mostrar el bloque en vivo en el webview (paridad display ↔ modelo).
//
// No registra tools ni comandos propios: los comandos `/skills` y
// `/skills-search` los gestiona el host (BUILTIN_COMMANDS) y el autocomplete
// `$` vive en el composer (Composer.tsx). 100% headless → modo rpc.

import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { expandMultiSkillText } from "./expand";

/**
 * Handler del hook `input` — salva la expansión cuando el texto no viene del
 * host (runPrompt ya expandió pre-envío). Si no hay `$skill`, pasa intacto.
 */
export async function handleInput(
	event: InputEvent,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): Promise<InputEventResult> {
	const result = await expandMultiSkillText(event.text, {
		pi,
		sessionId: ctx.sessionManager.getSessionId(),
		cwd: process.cwd(),
	});
	if (result === null) return { action: "continue" };

	if (result.unresolved.length > 0) {
		// Best-effort: ctx.ui.notify sólo existe si el runner propagó el
		// uiContext (frida lo hace vía bindExtensions). Si no, se omite.
		ctx.ui?.notify?.(
			`Skills desconocidas: ${result.unresolved.join(", ")}. Usa /skills para ver las disponibles.`,
			"warning",
		);
	}

	return { action: "transform", text: result.transformed };
}

/**
 * Factory de la extensión frida-multi-skills para el loader de Pi.
 *
 * Registra el hook `input` (salvavidas). Idempotente: Pi deduplica handlers
 * con la misma referencia de función.
 *
 * Debe registrarse DESPUÉS de frida-args (reutiliza su índice de skills).
 */
export function createFridaMultiSkills() {
	return (pi: ExtensionAPI): void => {
		pi.on("input", async (event, ctx) => handleInput(event, ctx, pi));
	};
}

// Re-export del contrato público (lo consume runPrompt en extension.ts).
export {
	expandMultiSkillText,
	type ExpandMultiSkillDeps,
	type ExpandMultiSkillResult,
} from "./expand";
export {
	parseSkillRefs,
	replaceSkillRefs,
	hasSkillRefs,
	type ParsedRef,
	type SkillReplacement,
} from "./parser";
