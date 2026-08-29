// frida-understand-app — extensión (issue #134, M1 Pista M).
//
// Naturaleza: skill pack que COMPONE al motor existente
// (frida-extensible-workflows), igual que frida-tea (#41), frida-aidd (#38)
// y frida-app-walkthrough (#133). No registra tools propios ni toca el
// ciclo de vida de la sesión: su única superficie es el patrón builtin
// `understand-app` registrado en runtime (registerBuiltinPattern) y los
// prompts bundled en skills.ts.
//
// Uso:  workflow({ name: "understand-app", args: { maxHotspots: 8,
//        maxMinutes: 90 } })
// Uso:  /understand   → QuickPick del presupuesto de hotspots → lanza el
//        patrón vía chat (pi.sendUserMessage). Igual que /wf pero guiado.
// El agente principal pregunta el presupuesto con ask_user_question ANTES
// de lanzar (maxHotspots es requerido A PROPÓSITO, D13: tras el launch la
// corrida es desatendida). El resolver 3-capas resuelve los prompts en
// launch-time (defaults → .frida/understand-app/stages.json →
// ~/.frida/understand-app/stages.json); el veto de solo-lectura viaja en
// UNDERSTAND_APP_PREAMBLE (no-stage) y sobrevive a cualquier override.
//
// Seam del moat (D3/D6): meta.moat declara flags JSON-safe que el motor
// consume para inyectar pi-lens/frida-codebase-index en las sesiones hijas;
// resolve() interpola la const CAPABILITIES host-side con la MISMA sonda
// (existsSync de la entry de pi-lens + isInstalledAtPin de codebase-index,
// AND el toggle frida.codebaseIndexEnabled) — exacta respecto de la
// instalación porque el spawner se construye en el mismo launch.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerBuiltinPattern,
	type BuiltinPattern,
} from "../frida-extensible-workflows/builtin-patterns";
import { piLensEntryPath } from "../frida-extensible-workflows/moat-factories";
import { isInstalledAtPin } from "../frida-codebase-index/installer";
import { registerUnderstandAppCommand } from "./command";
import { resolveStagePrompts } from "./resolver";
import {
	generateUnderstandAppWorkflow,
	validateUnderstandAppArgs,
	type UnderstandAppCapabilities,
} from "./workflow";

/** agentDir de Frida por defecto (~/.frida, ADR-0010) — lazy para que el
 *  aislamiento de HOME en tests aplique (os.homedir() lee process.env.HOME). */
function defaultFridaAgentDir(): string {
	return path.join(os.homedir(), ".frida");
}

/**
 * Sonda de capacidades del moat host-side (D6): la misma instalación que
 * verán las sesiones hijas. lens = existsSync de la entry (misma sonda que
 * pi-session); codebaseIndex = instalado AL PIN (isInstalledAtPin) Y el
 * toggle frida.codebaseIndex.enabled activo (D5).
 */
export function detectUnderstandAppCapabilities(
	agentDir: string,
	codebaseIndexEnabled = true,
): UnderstandAppCapabilities {
	// S1 (Plan Review): sonda compartida con el motor — piLensEntryPath es la
	// única fuente del literal de la entry (dedup post-D2).
	const lensEntry = piLensEntryPath(agentDir);
	return {
		lens: fs.existsSync(lensEntry),
		codebaseIndex: codebaseIndexEnabled && isInstalledAtPin(agentDir),
	};
}

/** resolve en 3 pasos: valida eager (D13) → resuelve prompts 3 capas (D7)
 *  → interpola CAPABILITIES (D6) y genera el script. */
function resolveUnderstandAppScript(
	args: unknown,
	ctx: { cwd: string } | undefined,
	capabilities: UnderstandAppCapabilities,
): string {
	const validated = validateUnderstandAppArgs(args);
	const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
	return generateUnderstandAppWorkflow(stages, validated, capabilities);
}

/**
 * Patrón understand-app: toma un códigobase desconocido (el cwd) y produce
 * el entendimiento técnico documentado y verificable en
 * docs/entendimiento/ (7 preguntas del día 1 con evidencia file:line),
 * usando el moat como grounding. El cwd se resuelve en launch-time desde el
 * ctx que el motor inyecta en resolve() (los overrides de equipo son por
 * repo). Sin `url`: el target es el cwd del repo.
 */
export const UNDERSTAND_APP_PATTERN: BuiltinPattern = {
	name: "understand-app",
	description:
		"Entiende un códigobase desconocido y produce el entendimiento técnico en docs/entendimiento/: overview cartógrafo con las tools del moat (pi-lens + codebase-index), fan-out de scouts por áreas de riesgo, 3 escritores (entendimiento §Q1..§Q7 con evidencia file:line, mapa de riesgos, modelo LikeC4 semilla), síntesis determinista (README + veredicto M4/M5 + inventario auditable) y juez PASS/CONCERNS/FAIL contra las 7 preguntas del día 1.",
	args:
		'{ maxHotspots: number (REQUERIDO, entero 0-100; 0 = "todo"; si falta, preguntar el presupuesto con ask_user_question ANTES de lanzar), maxMinutes?: number (entero 1-240, backstop wall-clock; omitir = sin tope), language?: string (default "es-MX"), review?: "manual"|"auto" (default "manual") }',
	meta: {
		requiredTools: ["shell"],
		executionHints: { autonomous: true },
		// Seam del moat (D3): flags declarativas JSON-safe — el motor las
		// consume para inyectar las factories extra en las sesiones hijas.
		moat: { lens: true, codebaseIndex: true },
	},
	resolve(args: unknown, ctx?: { cwd: string }) {
		return resolveUnderstandAppScript(
			args,
			ctx,
			detectUnderstandAppCapabilities(defaultFridaAgentDir()),
		);
	},
};

/** Opts de la factory: la sesión principal inyecta su agentDir real y el
 *  getter del toggle para que CAPABILITIES sea exacta (D5/D6). */
export interface CreateFridaUnderstandAppOptions {
	/** agentDir de Frida (~/.frida): dónde sondear la instalación del moat. */
	agentDir?: string;
	/** Toggle frida.codebaseIndex.enabled (default true) — evaluado en cada
	 *  resolve() para interpolar CAPABILITIES.codebaseIndex fiel al estado. */
	codebaseIndexEnabled?: () => boolean;
	/** QuickPicks del /understand (#140). Tests inyectan un fake (D3);
	 *  producción omite `ui` y el handler carga vscode lazy (command.ts). */
	ui?: import("./command").SlashPickUI;
}

/** Factory de la extensión frida-understand-app. */
export function createFridaUnderstandApp(
	opts: CreateFridaUnderstandAppOptions = {},
) {
	const pattern: BuiltinPattern = {
		...UNDERSTAND_APP_PATTERN,
		resolve(args: unknown, ctx?: { cwd: string }) {
			return resolveUnderstandAppScript(
				args,
				ctx,
				detectUnderstandAppCapabilities(
					opts.agentDir ?? defaultFridaAgentDir(),
					opts.codebaseIndexEnabled?.() ?? true,
				),
			);
		},
	};
	return (pi: ExtensionAPI): void => {
		// Registro en runtime (#134): el motor consume REGISTERED_PATTERNS vía
		// findBuiltinPattern/builtinPatternsCatalog. Idempotente por nombre.
		registerBuiltinPattern(pattern);
		// #140: slash command /understand — registro incondicional junto al
		// patrón (mueren juntos ante invalidación de sesión; /reload
		// re-registra ambos).
		registerUnderstandAppCommand(pi, opts.ui);
	};
}
