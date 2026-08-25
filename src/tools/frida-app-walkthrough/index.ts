// frida-app-walkthrough — extensión (issue #133, M8 Pista M).
//
// Naturaleza: skill pack que COMPONE al motor existente
// (frida-extensible-workflows), igual que frida-tea (#41) y frida-aidd
// (#38). No registra tools propios ni toca el ciclo de vida de la sesión:
// su única superficie es el patrón builtin `app-walkthrough` registrado en
// runtime (registerBuiltinPattern) y los prompts bundled en skills.ts.
//
// Uso:  workflow({ name: "app-walkthrough", args: { url: "https://app…",
//        maxScreens: 30 } })
// El resolver 3-capas (reusado de #38) resuelve los prompts en launch-time:
// defaults → .frida/app-walkthrough/stages.json →
// ~/.frida/app-walkthrough/stages.json. El veto de acciones irreversibles
// viaja en WALKTHROUGH_PREAMBLE (no-stage) y sobrevive a cualquier override.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerBuiltinPattern,
	type BuiltinPattern,
} from "../frida-extensible-workflows/builtin-patterns";
import { resolveStagePrompts } from "./resolver";
import {
	generateAppWalkthroughWorkflow,
	validateAppWalkthroughArgs,
} from "./workflow";

/**
 * Patrón app-walkthrough: el agente usa la app como usuario real (sesión de
 * navegador pre-autenticada con pin --session) y genera la documentación
 * funcional completa en docs/funcional/. El cwd se resuelve en launch-time
 * desde el ctx que el motor inyecta en resolve() (los overrides de equipo
 * son por repo).
 */
export const APP_WALKTHROUGH_PATTERN: BuiltinPattern = {
	name: "app-walkthrough",
	description:
		"Documenta una app web usándola como usuario real: exploración secuencial sobre una sesión de navegador pre-autenticada (pin --session), interpretación pantalla por pantalla, fan-out de 4 escritores (catálogo, journeys, reglas, roles) y juez PASS/CONCERNS/FAIL. Entregables en docs/funcional/ (README, catálogo, journeys, reglas, roles + dashboard index.html autónomo).",
	args:
		'{ url: string (requerida, la app), maxScreens: number (REQUERIDO, entero 0-200; 0 = "todo"), maxMinutes?: number (entero 1-240, backstop wall-clock), session?: string (default "app-walkthrough"), language?: string (default "es-MX"), review?: "manual"|"auto" }',
	meta: { requiredTools: ["shell"], executionHints: { autonomous: true } },
	resolve(args: unknown, ctx?: { cwd: string }) {
		const validated = validateAppWalkthroughArgs(args);
		const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
		return generateAppWalkthroughWorkflow(stages, validated);
	},
};

/** Factory de la extensión frida-app-walkthrough. */
export function createFridaAppWalkthrough() {
	return (_pi: ExtensionAPI): void => {
		// Registro en runtime (#133): el motor (frida-extensible-workflows)
		// consume REGISTERED_PATTERNS vía findBuiltinPattern/
		// builtinPatternsCatalog. Idempotente por nombre; el cwd se resuelve
		// lazy en resolve().
		registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
	};
}
