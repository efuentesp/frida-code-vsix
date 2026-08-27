// frida-traffic2api — extensión (issue #135, M9 Pista M).
//
// Naturaleza: skill pack que COMPONE al motor existente
// (frida-extensible-workflows), igual que frida-tea (#41), frida-aidd (#38),
// frida-app-walkthrough (#133) y frida-understand-app (#134). No registra
// tools propios ni toca el ciclo de vida de la sesión: su única superficie
// es el patrón builtin `traffic2api` registrado en runtime
// (registerBuiltinPattern) y los prompts bundled en skills.ts.
//
// Uso:  workflow({ name: "traffic2api", args: { url: "https://app…",
//        maxScreens: 15 } })              // modo walk: navega y graba el HAR
//        workflow({ name: "traffic2api", args: { harPath: "x.har" } })
//                                          // modo externo: HAR ya capturado
// El agente principal pregunta el presupuesto con ask_user_question ANTES
// de lanzar (maxScreens es requerido A PROPÓSITO en walk, D2: tras el
// launch la corrida es desatendida). El resolver 3-capas resuelve los
// prompts en launch-time (defaults → .frida/traffic2api/stages.json →
// ~/.frida/traffic2api/stages.json); los vetos (irreversibles sobre la app
// + solo-escritura en docs/api/** + seguridad del HAR) viajan en
// TRAFFIC2API_PREAMBLE (no-stage) y sobreviven a cualquier override.
//
// Es el PRIMER pack que combina los dos ejes de sus hermanos: moat
// declarativo (meta.moat, M1 understand-app) Y sesión de navegador
// pinneada por args (M8 app-walkthrough) — ejes ortogonales del motor.
//
// Seam del moat (D3): meta.moat declara flags JSON-safe que el motor
// consume para inyectar pi-lens/frida-codebase-index en las sesiones
// hijas; resolve() interpola la const CAPABILITIES host-side con la MISMA
// sonda (existsSync de la entry de pi-lens + isInstalledAtPin de
// codebase-index, AND el toggle frida.codebaseIndexEnabled) — exacta
// respecto de la instalación porque el spawner se construye en el mismo
// launch.

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
import { resolveStagePrompts } from "./resolver";
import {
 generateTraffic2ApiWorkflow,
 validateTraffic2ApiArgs,
 type Traffic2ApiCapabilities,
} from "./workflow";

/** agentDir de Frida por defecto (~/.frida, ADR-0010) — lazy para que el
 *  aislamiento de HOME en tests aplique (os.homedir() lee process.env.HOME). */
function defaultFridaAgentDir(): string {
 return path.join(os.homedir(), ".frida");
}

/**
 * Sonda de capacidades del moat host-side (D3): la misma instalación que
 * verán las sesiones hijas. lens = existsSync de la entry (misma sonda que
 * pi-session); codebaseIndex = instalado AL PIN (isInstalledAtPin) Y el
 * toggle frida.codebaseIndex.enabled activo.
 */
export function detectTraffic2ApiCapabilities(
 agentDir: string,
 codebaseIndexEnabled = true,
): Traffic2ApiCapabilities {
 // Sonda compartida con el motor (molde M1): piLensEntryPath es la única
 // fuente del literal de la entry de pi-lens.
 const lensEntry = piLensEntryPath(agentDir);
 return {
  lens: fs.existsSync(lensEntry),
  codebaseIndex: codebaseIndexEnabled && isInstalledAtPin(agentDir),
 };
}

/** resolve en 3 pasos: valida eager los modos excluyentes (D2) → resuelve
 *  prompts 3 capas (D11) → interpola CAPABILITIES (D3) y genera el script. */
function resolveTraffic2ApiScript(
 args: unknown,
 ctx: { cwd: string } | undefined,
 capabilities: Traffic2ApiCapabilities,
): string {
 const validated = validateTraffic2ApiArgs(args);
 const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
 return generateTraffic2ApiWorkflow(stages, validated, capabilities);
}

/**
 * Patrón traffic2api: captura el tráfico HTTP real de una app web (walk
 * agéntico grabando HAR sobre una sesión pre-autenticada, o HAR externo
 * devtools/mitmproxy) y deriva docs/api/: spec OpenAPI 3.1 (openapi.json),
 * matriz funcionalidad↔endpoint↔módulo (grounding moat), huérfanos
 * bidireccionales, zona muerta calificada y grafo de navegación. El cwd se
 * resuelve en launch-time desde el ctx que el motor inyecta en resolve().
 */
export const TRAFFIC2API_PATTERN: BuiltinPattern = {
 name: "traffic2api",
 description:
  "Documenta la API real de una app web desde su tráfico HTTP observado: walk agéntico sobre una sesión de navegador pre-autenticada grabando HAR (agent-browser network har), o ingesta de un HAR externo (devtools/mitmproxy). Deriva docs/api/ con la spec OpenAPI 3.1 (openapi.json, paths colapsados, errores 4xx/5xx incluidos), la matriz funcionalidad↔endpoint↔módulo con grounding del moat (pi-lens + codebase-index), huérfanos bidireccionales, zona muerta calificada por alcanzabilidad y grafo de navegación con frontera clasificada. Juez PASS/CONCERNS/FAIL + inventario auditable.",
 args:
  'Modo walk { url: string (la app), maxScreens: number (REQUERIDO, entero 0-200; 0 = "todo"; si falta, preguntar el presupuesto con ask_user_question ANTES de lanzar), maxMinutes?: number (entero 1-240, backstop wall-clock), session?: string (default "app-walkthrough", sesión pre-autenticada), language?: string (default "es-MX"), review?: "manual"|"auto" } O modo externo { harPath: string (ruta a un HAR ya capturado con devtools/mitmproxy), maxMinutes?, language?, review? } — url y harPath son MUTUAMENTE EXCLUYENTES',
 meta: {
  requiredTools: ["shell"],
  executionHints: { autonomous: true },
  // Seam del moat (D3): flags declarativas JSON-safe — el motor las
  // consume para inyectar las factories extra en las sesiones hijas.
  moat: { lens: true, codebaseIndex: true },
 },
 resolve(args: unknown, ctx?: { cwd: string }) {
  return resolveTraffic2ApiScript(
   args,
   ctx,
   detectTraffic2ApiCapabilities(defaultFridaAgentDir()),
  );
 },
};

/** Opts de la factory: la sesión principal inyecta su agentDir real y el
 *  getter del toggle para que CAPABILITIES sea exacta (D3). */
export interface CreateFridaTraffic2ApiOptions {
 /** agentDir de Frida (~/.frida): dónde sondear la instalación del moat. */
 agentDir?: string;
 /** Toggle frida.codebaseIndex.enabled (default true) — evaluado en cada
  *  resolve() para interpolar CAPABILITIES.codebaseIndex fiel al estado. */
 codebaseIndexEnabled?: () => boolean;
}

/** Factory de la extensión frida-traffic2api. */
export function createFridaTraffic2Api(
 opts: CreateFridaTraffic2ApiOptions = {},
) {
 // Clona el patrón con closure que re-sondea en CADA resolve() (molde M1):
 // la sonda es exacta por launch aunque la instalación cambie en caliente.
 const pattern: BuiltinPattern = {
  ...TRAFFIC2API_PATTERN,
  resolve(args: unknown, ctx?: { cwd: string }) {
   return resolveTraffic2ApiScript(
    args,
    ctx,
    detectTraffic2ApiCapabilities(
     opts.agentDir ?? defaultFridaAgentDir(),
     opts.codebaseIndexEnabled?.() ?? true,
    ),
   );
  },
 };
 return (_pi: ExtensionAPI): void => {
  // Registro en runtime (#135): el motor (frida-extensible-workflows)
  // consume REGISTERED_PATTERNS vía findBuiltinPattern/
  // builtinPatternsCatalog. Idempotente por nombre.
  registerBuiltinPattern(pattern);
 };
}
