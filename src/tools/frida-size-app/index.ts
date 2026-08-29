// frida-size-app — extensión (issue #139, M10 Pista M).
//
// Naturaleza: skill pack que COMPONE al motor existente
// (frida-extensible-workflows), igual que frida-tea (#41), frida-aidd (#38),
// frida-app-walkthrough (#133), frida-understand-app (#134) y
// frida-traffic2api (#135). No registra tools propios ni toca el ciclo de
// vida de la sesión: su única superficie es el patrón builtin `size-app`
// registrado en runtime (registerBuiltinPattern) y los prompts bundled en
// skills.ts.
//
// Uso:  workflow({ name: "size-app", args: { wage: 35000, currency: "MXN",
//        cocomoType: "semi-detached", maxMinutes: 60 } })
// Uso:  /size   → QuickPicks por modo COCOMO y salario (wage+currency) →
//        lanza el patrón vía chat (pi.sendUserMessage). Igual que /wf
//        pero guiado.
// El agente principal pregunta el presupuesto con ask_user_question ANTES
// de lanzar (wage es requerido A PROPÓSITO, D13: tras el launch la corrida
// es desatendida). El resolver 3-capas resuelve los prompts en launch-time
// (defaults → .frida/size-app/stages.json → ~/.frida/size-app/stages.json);
// el veto de solo-escritura y el juez de números viajan en
// SIZE_APP_PREAMBLE (no-stage) y sobreviven a cualquier override (D11).
//
// Primera dependencia binaria NO-npm del repo (D1/D4): scc v4.0.0 se
// pinea al agentDir (<agentDir>/bin/scc, sha256 verificado). resolve() es
// SÍNCRONA por contrato del motor (builtin-patterns.ts:389, invocada sin
// await), así que la instalación NO puede vivir ahí: la factory la dispara
// fire-and-forget al registrarse (D2, molde frida-hermes-memory/
// index.ts:181-190) — nunca bloquea ni tumba la sesión; el gate
// isSccInstalledAtPin la vuelve no-op tras la primera descarga y la
// primera corrida de size-app ya encuentra el binario. Si la descarga
// sigue en curso o falló, CAPABILITIES.scc=false degrada la corrida con
// causa+hint (la corrida NUNCA aborta por el binario, FR-7/D2).
//
// Seam del moat (D3): meta.moat declara flags JSON-safe que el motor
// consume para inyectar pi-lens/frida-codebase-index en las sesiones hijas;
// resolve() interpola la const CAPABILITIES host-side con la MISMA sonda
// (existsSync de la entry de pi-lens + isInstalledAtPin de codebase-index,
// AND el toggle frida.codebaseIndexEnabled) + la sonda síncrona propia
// isSccInstalledAtPin — exacta respecto de la instalación porque el
// spawner se construye en el mismo launch. El script invoca scc por ruta
// ABSOLUTA (SCC_BIN interpolada host-side con sccBinPath) — jamás del PATH
// (reproducibilidad del pin, D12).

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
import { SCC_PIN, sccBinPath } from "./constants";
import {
 ensureBinary,
 isSccInstalledAtPin,
 type SccInstallDeps,
} from "./installer";
import { resolveStagePrompts } from "./resolver";
import {
 generateSizeAppWorkflow,
 validateSizeAppArgs,
 type SizeAppCapabilities,
} from "./workflow";
import { registerSizeAppCommand } from "./command";

/** agentDir de Frida por defecto (~/.frida, ADR-0010) — lazy para que el
 *  aislamiento de HOME en tests aplique (os.homedir() lee process.env.HOME). */
function defaultFridaAgentDir(): string {
 return path.join(os.homedir(), ".frida");
}

/**
 * Sonda de capacidades host-side (D2/D3): la misma instalación que verán
 * las sesiones hijas y el script generado. scc = instalado AL PIN (sonda
 * síncrona propia del pack: marker + binario presente); lens = existsSync
 * de la entry (misma sonda que pi-session); codebaseIndex = instalado AL
 * PIN Y el toggle frida.codebaseIndex.enabled activo.
 */
export function detectSizeAppCapabilities(
 agentDir: string,
 codebaseIndexEnabled = true,
): SizeAppCapabilities {
 // Sonda compartida con el motor (molde M1/M9): piLensEntryPath es la
 // única fuente del literal de la entry de pi-lens.
 const lensEntry = piLensEntryPath(agentDir);
 return {
  scc: isSccInstalledAtPin(agentDir),
  lens: fs.existsSync(lensEntry),
  codebaseIndex: codebaseIndexEnabled && isInstalledAtPin(agentDir),
 };
}

/** resolve en 3 pasos (molde M1/M9): valida eager (D13) → resuelve prompts
 *  3 capas con el cwd del launch (D11) → interpola CAPABILITIES (D2/D3) y
 *  la ruta ABSOLUTA del binario pineado (D12) y genera el script. */
function resolveSizeAppScript(
 args: unknown,
 ctx: { cwd: string } | undefined,
 capabilities: SizeAppCapabilities,
 sccBin: string,
): string {
 const validated = validateSizeAppArgs(args);
 const stages = resolveStagePrompts(ctx?.cwd ?? process.cwd());
 return generateSizeAppWorkflow(stages, validated, capabilities, sccBin);
}

/**
 * Patrón size-app: dimensiona cuantitativamente la app del cwd para
 * preventa — KLOC efectivos, COCOMO Basic 81 con spread EAF y costo (wage
 * mensual), SQALE proxy de deuda, percentiles de complejidad,
 * hotspots/churn/coupling/autores y bus factor (scc v4.0.0 pineado), olas
 * de migración strangler-fig. Entregables deterministas en
 * docs/dimensionamiento/ con metrics.json como ÚNICA fuente de verdad
 * numérica. El cwd se resuelve en launch-time desde el ctx que el motor
 * inyecta en resolve() (los overrides de equipo son por repo).
 */
export const SIZE_APP_PATTERN: BuiltinPattern = {
 name: "size-app",
 description:
  "Dimensiona cuantitativamente una app para preventa: KLOC efectivos, COCOMO Basic 81 con spread EAF 0.85/1.00/1.15 y costo con wage mensual, SQALE proxy de deuda técnica, percentiles de complejidad, hotspots/churn/coupling/autores y bus factor (binario scc v4.0.0 pineado al agentDir), y olas de migración strangler-fig priorizadas por deuda. Entregables deterministas en docs/dimensionamiento/ (informe + README + anexos interpretativos) con metrics.json como única fuente de verdad numérica; juez detached PASS/CONCERNS/FAIL y checkpoint final si review=manual.",
 args:
  '{ wage: number (REQUERIDO, > 0, salario MENSUAL por persona — decimales válidos; si falta, pregúntalo con ask_user_question en la sesión principal ANTES de lanzar (opciones: "MXN $35,000" (wage 35000, currency "MXN") · "USD $6,000" (wage 6000, currency "USD") · monto propio) o sugiere el comando /size, que pregunta modo COCOMO y salario con QuickPicks ("semi-detached (recomendado)" · "organic" · "embedded" → "MXN $35,000" · "USD $6,000" · monto propio), y relanza con el valor resuelto), currency?: string (default "USD", etiqueta del informe), cocomoType?: "organic"|"semi-detached"|"embedded" (default "semi-detached"), exclude?: string[] (directorios adicionales a excluir — AMPLÍAN la curada dist/build/node_modules/vendor/target/out/.next/coverage + patrón *.min.js; [] = solo curada), maxMinutes?: number (entero 1-240, backstop wall-clock que corta el descubrimiento; omitir = sin tope), language?: string (default "es-MX"), review?: "manual"|"auto" (default "manual") }',
 meta: {
  requiredTools: ["shell"],
  executionHints: { autonomous: true },
  // Seam del moat (D3): flags declarativas JSON-safe — el motor las
  // consume para inyectar las factories extra en las sesiones hijas.
  moat: { lens: true, codebaseIndex: true },
 },
 resolve(args: unknown, ctx?: { cwd: string }) {
  return resolveSizeAppScript(
   args,
   ctx,
   detectSizeAppCapabilities(defaultFridaAgentDir()),
   sccBinPath(defaultFridaAgentDir()),
  );
 },
};

/** Opts de la factory: la sesión principal inyecta su agentDir real y el
 *  getter del toggle para que CAPABILITIES sea exacta (D2/D3). ensureDeps
 *  es el seam de tests sin red para el disparo fire-and-forget. */
export interface CreateFridaSizeAppOptions {
 /** agentDir de Frida (~/.frida): dónde sondear el moat e instalar/sondear
  *  el binario scc pineado. */
 agentDir?: string;
 /** Toggle frida.codebaseIndex.enabled (default true) — evaluado en cada
  *  resolve() para interpolar CAPABILITIES.codebaseIndex fiel al estado. */
 codebaseIndexEnabled?: () => boolean;
 /** Seam de tests sin red (D2): deps inyectadas al ensureBinary del
  *  disparo fire-and-forget — producción NO lo pasa (descarga real). */
 ensureDeps?: SccInstallDeps;
 /** QuickPicks del /size (#140). Tests inyectan un fake (D3); producción
  *  omite `ui` y el handler carga vscode lazy (command.ts). */
 ui?: import("./command").SlashPickUI;
}

/** Factory de la extensión frida-size-app. */
export function createFridaSizeApp(opts: CreateFridaSizeAppOptions = {}) {
 // Clona el patrón con closure que re-sondea en CADA resolve() (molde
 // M1/M9): la sonda es exacta por launch aunque la instalación cambie en
 // caliente (p. ej. la descarga fire-and-forget terminó a mitad de sesión).
 const pattern: BuiltinPattern = {
  ...SIZE_APP_PATTERN,
  resolve(args: unknown, ctx?: { cwd: string }) {
   return resolveSizeAppScript(
    args,
    ctx,
    detectSizeAppCapabilities(
     opts.agentDir ?? defaultFridaAgentDir(),
     opts.codebaseIndexEnabled?.() ?? true,
    ),
    sccBinPath(opts.agentDir ?? defaultFridaAgentDir()),
   );
  },
 };
 return (pi: ExtensionAPI): void => {
  // Registro en runtime (#139): el motor consume REGISTERED_PATTERNS vía
  // findBuiltinPattern/builtinPatternsCatalog. Idempotente por nombre.
  registerBuiltinPattern(pattern);
  // #140: slash command /size — registro incondicional junto al patrón
  // (mueren juntos ante invalidación de sesión; /reload re-registra
  // ambos).
  registerSizeAppCommand(pi, opts.ui);
  // D2: descarga fire-and-forget del binario pineado (molde hermes
  // index.ts:181-190) — gate idempotente, JAMÁS bloquea ni tumba la
  // sesión: si la descarga sigue en curso o falló, CAPABILITIES.scc=false
  // degrada la corrida con causa+hint (V6).
  const agentDir = opts.agentDir ?? defaultFridaAgentDir();
  if (!isSccInstalledAtPin(agentDir)) {
   void ensureBinary(agentDir, { deps: opts.ensureDeps })
    .then((res) => {
     // Log de éxito solo en producción (seam silencioso en tests).
     if (!res.alreadyInstalled && opts.ensureDeps === undefined) {
      console.log(
       `[frida-size-app] scc v${SCC_PIN} instalado en ${sccBinPath(agentDir)} — size-app listo.`,
      );
     }
    })
    .catch((e: any) => {
     // Guía accionable, no error opaco (molde moat-factories.ts:92):
     // la sesión sigue; la degradación del script y el doctor
     // (checkScc) explican cómo reparar.
     console.warn(
      `[frida-size-app] instalación de scc falló: ${e?.message ?? e}`,
     );
     if (e?.guide) console.warn(`[frida-size-app] guía: ${e.guide}`);
    });
  }
 };
}
