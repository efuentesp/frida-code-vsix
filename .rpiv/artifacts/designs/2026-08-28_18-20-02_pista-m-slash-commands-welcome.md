---
date: 2026-08-28T18:20:02-0600
author: Edgar F. Fuentes Perea
commit: abb1640
branch: main
repository: frida-code
topic: "Comandos slash + cards de inicio para los patrones de la Pista M"
tags: [design, pista-m, slash-commands, welcome, register-command, send-user-message, frida-app-walkthrough, frida-understand-app, frida-size-app, starter-cards]
status: ready
parent: .rpiv/artifacts/research/2026-08-28_18-01-10_pista-m-slash-commands-welcome.md
last_updated: 2026-08-28T18:20:02-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Design: Comandos slash + cards de inicio para los patrones de la Pista M

## Summary

Tres slash commands (`/walkthrough`, `/understand`, `/size`) registrados vía `pi.registerCommand` dentro de los setups existentes de los 3 skill-packs de la Pista M. Cada handler hace QuickPicks de `vscode.window` (vía adapter `SlashPickUI` inyectable en un `command.ts` por pack) por los args requeridos del patrón y lanza el workflow delegando al chat con `pi.sendUserMessage` (gate `ctx.isIdle()` → `deliverAs: "followUp"`), con guard `findBuiltinPattern` antes de enviar. Tres cards nuevas `actionType: "insert"` en `STARTER_CARDS`, fix del host para que el autocompletado `/` muestre las descripciones reales de los comandos de extensión, y alineación de textos de validadores/how-tos con los defaults aprobados. Cero cambios al motor (`src/tools/frida-extensible-workflows/`).

## Requirements

Del FRD (`.rpiv/artifacts/discover/2026-08-28_17-29-53_pista-m-slash-commands-welcome.md`, issue #140) y el research:

- FR-4/5/6: cada comando pregunta por los args REQUERIDOS de su patrón (walkthrough: url + maxScreens; understand: maxHotspots; size: cocomoType + wage) — el resto vive en defaults del patrón.
- FR-7: 1 round-trip — el mensaje de lanzamiento lleva TODOS los requeridos ya resueltos; el agente no re-pregunta.
- FR-8: cancelación silenciosa (Esc o Enter-vacío en cualquier paso → no-op, cero notificaciones).
- FR-9: 3 cards nuevas en el Welcome (`actionType: "insert"`) sin tocar las 4 existentes.
- AC-1: los 3 comandos aparecen en el autocompletado `/` con descripción (requiere fix del host `src/extension.ts:1855-1857`).
- NFR: error accionable y sesión viva ante el caso "comando sí, patrón no" (motor apagado).
- Motor intacto: los handlers viven en las factories (fuera de `src/tools/frida-extensible-workflows/`).
- FR-10: how-tos espejo alineados con los defaults nuevos de QuickPick.
- Tests: registro + armado de mensaje + cancelación por pack, sin cargar vscode en vitest.

## Current State Analysis

Las tres factories ya reciben `_pi: ExtensionAPI` sin usarlo: `createFridaAppWalkthrough` (`src/tools/frida-app-walkthrough/index.ts:49`), `createFridaUnderstandApp(opts)` (`src/tools/frida-understand-app/index.ts:121`), `createFridaSizeApp(opts)` (`src/tools/frida-size-app/index.ts:154`). El wiring vive en `extensionFactories` del `DefaultResourceLoader` (`src/pi-session.ts:673/:681/:708`) — este feature NO toca pi-session.ts. El seam registro/envío ya está ejercitado en producción por `/goal` (closure `this.pi` + `sendUserMessage` diferido, `src/tools/frida-goal/runtime.ts:75/:118`) y `/fridasync` (`registerCommand` en setup + gate `ctx.isIdle()` → `followUp`, `src/tools/frida-git-sync/index.ts:141-158/:403-404`).

Falta: (a) los handlers de comando por pack, (b) el adapter UI inyectable (vscode no es resolvable en vitest — `vitest.config.ts:8-22` sin alias), (c) el fix del host para descripciones, (d) las cards, (e) la alineación de textos.

### Key Discoveries

- `registerCommand` es válido dentro del setup (solo `Map.set`, `loader.js:223-229`); `sendUserMessage` en setup LANZA (`"Extension runtime not initialized..."`, `loader.js:131-133`) hasta que `bindCore` lo reemplaza — el handler solo lo llama diferido.
- El dispatch: el host enruta `/cmd` detectado en `session.extensionApi.getCommands()` vía `session.prompt` (`src/extension.ts:4998-5007`); el SDK ejecuta `command.handler(args, ctx)` y SI EL HANDLER LANZA lo atrapa sin tumbar la sesión (`agent-session.js:939-946`). El texto `/cmd` NO aparece en el transcript; solo el mensaje `sendUserMessage` posterior.
- Los 3 packs NO están en `TOOL_TOGGLE_BASES` ni `TOGGLE_KEY_BY_FACTORY` (`src/tool-toggles.ts:186-226`) — `factoryEsModulo` (`src/extension.ts:1837`) NO los filtra: sus comandos fluyen al loop `extCommands` (`:1848-1863`) → `ResourceSummary.commands` → dropdown `/` del Composer (`webview/App.tsx:256-264`, mapeados como `kind: "builtin"` junto a los built-in).
- Gap del host: el push de `extCommands` hardcodea `description: ""` (`src/extension.ts:1855-1857`); el valor del Map (`Map<string, RegisteredCommand>`, `loader.js:394`) SÍ expone `.description` (`types.d.ts:852-858`, opcional).
- La heurística de auto-pregunta de `/wf` no dispara para los 3 patrones M (dicen "REQUERIDO", no "string no vacío"/"obligatoria", `src/extension.ts:4474-4478`) — los handlers nuevos preguntan por sí mismos.
- `vscode` no es resolvable en vitest (sin `__mocks__/`, sin alias): el repo lo evita con inline type-only import (`src/tools/frida-cc-plugins/index.ts:85`) + adapter inyectable (`src/worktree/command.ts:57`); un import estático de vscode en un `index.ts` de pack rompería las 3 suites `pattern.test.ts` existentes (guardián estructural).
- Welcome: grid 2 columnas fijas (`webview/styles.css:5345`); 7 cards = 4ª fila con hueco cosmético, no rompe. El canal `composer_insert` (card → `onInsert` → reducer con nonce → append+focus en Composer) está estable desde su landed (cero follow-up fixes).
- Validadores eager: `validateAppWalkthroughArgs` (`workflow.ts:93`, url + maxScreens entero 0-200), `validateUnderstandAppArgs` (`:99`, maxHotspots 0-100), `validateSizeAppArgs` (`:156`, wage > 0 decimales, cocomo enum, currency default USD). El mapeo "todo" → número `0` es OBLIGATORIO (string "todo" hace fallar `typeof !== "number"` en el resolve eager del tool).
- Ningún test lee los how-tos ni los textos de error de validadores (grep en `test/` = 0 matches) — la alineación de textos es segura.

## Scope

### Building

- `src/tools/frida-app-walkthrough/command.ts` (NEW): `SlashPickUI` + `createDefaultPickUI()` (vscode lazy, dynamic import) + handler `/walkthrough` (url inline o InputBox → QuickPick maxScreens "10 pantallas (recomendado)" · "5 pantallas" · "25 pantallas" · "Todo (sin tope)" = 0) + registro.
- `src/tools/frida-understand-app/command.ts` (NEW): ídem `/understand` (QuickPick maxHotspots 8·15·todo).
- `src/tools/frida-size-app/command.ts` (NEW): ídem `/size` (QuickPick cocomoType organic/semi-detached/embedded → QuickPick wage MXN $35,000 / USD $6,000 / monto propio → InputBox numérico).
- Wiring en los 3 `index.ts`: `opts.ui?` (inline type import), `pi.registerCommand` incondicional en el setup, encabezados "Uso:" actualizados.
- Fix del host: `src/extension.ts` extCommands lee `e.commands.get(n)?.description`.
- `webview/components/Welcome.tsx`: 3 cards `actionType: "insert"` (`/walkthrough` con espacio final; `/understand` y `/size` sin) + rebuild/commit de `dist-webview/`.
- Tests: `command.test.ts` por pack (registro, armado exacto de 1 `sendUserMessage`, cancelación FR-8 en cada paso) + stubs `{} as never` → fake con `registerCommand` no-op en las 3 `pattern.test.ts` + extensión de `test/welcome.test.ts`.
- Alineación de textos: mensajes de error de los 2 validadores + string `args` de size-app + 3 how-tos (defaults FRD + mención de los comandos nuevos).

### Not Building

- traffic2api (M9): fuera del lote (decisión FRD).
- Pre-autenticación de `/walkthrough`: la maneja el patrón M8 (gate de sesión viva en bootstrap).
- Curación/reorden de las 4 cards existentes del Welcome.
- Fix cosmético del hueco del grid con 7 cards (grid 2 columnas se mantiene).
- Retiro de skills launcher obsoletos en `~/.frida/skills/` (seguimiento aparte).
- Cambios al motor `src/tools/frida-extensible-workflows/` (congelado — diff vacío).
- `argumentHint` para comandos de extensión en el host (no hay fuente en `RegisteredCommand`; `getArgumentCompletions` no lo consume ningún flujo del repo).
- Vista de extensiones (`src/extension.ts:1754-1766`, `extensionsData` guarda solo nombres) — fuera de alcance; el fix cubre autocompletado y Recursos > Comandos.

## Decisions

### D1: Handler por-pack (motor intacto)

Research Q/A heredada. Los handlers viven en las factories de los packs; `BuiltinPatternMeta` es tipo cerrado sin `slashCommand` (`builtin-patterns.ts:348-372`) — alternativa meta-driven descartada por requerir cambios al motor. Evidencia: wiring existente `src/pi-session.ts:673/:681/:708`.

### D2: Delegar al chat vía `pi.sendUserMessage` (no `runWorkflowInStore`)

Research Q/A heredada. El handler arma un mensaje determinista y lo envía al chat; el tool `workflow` es el único orquestador. Replicar el seam de git-sync (`src/tools/frida-git-sync/index.ts:403-404`): `if (ctx.isIdle()) pi.sendUserMessage(prompt); else pi.sendUserMessage(prompt, { deliverAs: "followUp" });` — nunca `steer`. `sendUserMessage` es void fire-and-forget (sin await/retry); la visibilidad del run llega por los eventos del motor al panel.

### D3: QuickPicks con `vscode.window` + adapter inyectable `opts.ui?`

Research Q/A heredada (checkpoint de research): `vscode.window` es el precedente del flujo replicado (`postWfCommand`) y garantiza cancelación silenciosa; el adapter resuelve la testeabilidad (vscode no resolvable en vitest). `command.ts` por pack importa vscode solo en el default de producción; el `index.ts` referencia el tipo con inline import `ui?: import("./command").SlashPickUI` (molde `src/tools/frida-cc-plugins/index.ts:85`). `npm test` actúa como guardián estructural.

### D4: `command.ts` por pack (×3), sin módulo compartido

Confirmación direccional de este design (Developer Context). Cada pack duplica `SlashPickUI` + `createDefaultPickUI()` (vscode LAZY: `await import("vscode")` — command.ts lo importa index.ts, que las suites cargan en vitest sin vscode resolvable) + seam de envío (~120 líneas triplicadas) siguiendo el molde `presenter.ts` de cc-plugins (autonomía del pack, cero acoplamiento nuevo entre packs). Alternativa de módulo compartido descartada: ningún shared UI existe hoy entre packs fuera del motor congelado.

### D5: Args inline solo en `/walkthrough` (URL)

Decisión de este design (Developer Context): `args?.trim()` como URL (las URLs no tienen espacios — molde `postWfCommand` `src/extension.ts:4452-4460`); si vacía → InputBox (estilo aidd-plan: Esc Y Enter-vacío son no-op). `/understand` y `/size` ignoran args y siempre QuickPicks. Cards: `"/walkthrough "` con espacio final; `"/understand"` y `"/size"` sin espacio.

### D6: Cards `actionType: "insert"`, agregar sin tocar las 4 existentes

Research Q/A heredada. `STARTER_CARDS` pasa de 4 a 7 (`webview/components/Welcome.tsx:15-51`); precedente `aidd-plan` (`:22`, prompt con espacio final para insert).

### D7: Nombres EN cortos, descripciones es-MX

Research Q/A heredada. `/walkthrough` `/understand` `/size`; `description` es-MX no vacía en el `registerCommand`.

### D8: QuickPicks solo por args requeridos

Research Q/A heredada. url+maxScreens · maxHotspots · cocomoType+wage; `maxMinutes`/`review`/`language`/etc. viven en defaults del patrón (no mencionar en el mensaje para no cambiar semántica).

### D9: Fix del host incluido (`description` real en extCommands)

Research Q/A heredada. `description: String(e.commands?.get?.(n)?.description ?? "")` en el push de `src/extension.ts:1855-1857` — 1-3 líneas fuera del motor congelado; beneficia también a extensiones externas.

### D10: Defaults de QuickPick — gana el FRD

Research Q/A heredada. maxScreens: "10 pantallas (recomendado)" · "5 pantallas" · "25 pantallas" · "Todo (sin tope)" (valor 0); maxHotspots: "8 hotspots (recomendado)" · "15" · "todo"; wage: "MXN $35,000" (wage 35000, currency "MXN") · "USD $6,000" (wage 6000, currency "USD") · "monto propio" (InputBox numérico); cocomoType: "semi-detached (recomendado)" · "organic" · "embedded". Ninguna opción fuera de rango de los validadores (5/10/25 ∈ [0,200]; 8/15 ∈ [0,100]). Textos de error de validadores y how-tos se alinean en el mismo cambio.

### D11: Formato del mensaje de lanzamiento

`Ejecuta el workflow '<name>' con los siguientes argumentos:\n{ objeto literal }` (variante `src/extension.ts:4471`), con objeto literal que coincide 1:1 con el `args` del patrón, TODOS los requeridos presentes y tipos correctos (números; "todo" → `0`; enum literal con guion). `normalizeWorkflowArgs` tolera string-JSON (`args.ts:17-35`); el nombre exacto es lo que `findBuiltinPattern` matchea (`builtin-patterns.ts:469-471`).

### D12: Guard `findBuiltinPattern` antes de enviar

Research §8. Si el patrón no está registrado (motor apagado — gate `src/pi-session.ts:954`), `vscode.window.showWarningMessage` con causa+remedio, SIN enviar (el tool lanzaría un error opaco que no nombra el patrón, `index.ts:226-228` del motor). La sesión ya sobrevive por sí (`agent-session.js:939-946`).

### D13: Cancelación silenciosa (FR-8)

`return` plano tras `undefined` de cualquier picker/input; sin notify (el notify de git-sync en cancelaciones sería ruido aquí). Enter-vacío en la URL requerida también es no-op (estilo aidd-plan `src/extension.ts:4465`).

### D14: Stubs `{} as never` → fake mínimo; tests nuevos en `command.test.ts` por pack

El `pi.registerCommand` incondicional en los setups rompe ~14 sites de stub en las 3 `pattern.test.ts` (ej. `test/frida-app-walkthrough/pattern.test.ts:150`). Se actualizan a un fake local mínimo con `registerCommand: () => {}`; los tests completos del comando (registro/armado/cancelación) viven en `command.test.ts` nuevo por pack con moldes `fakePi` (`test/frida-cc-plugins/presenter.test.ts:59-86`) + captura `sendUserMessage` (`test/frida-goal/goal-runtime.test.ts:12-50`).

### D15: Serialización SIEMPRE a número/enum

"todo" → número `0`; wage "monto propio" → `Number.parseFloat` con validación `> 0` (si no parsea: `showErrorMessage`, sin envío — el picker es la única barrera previa al validador eager del `resolve()`).

## Architecture

### src/tools/frida-app-walkthrough/command.ts — NEW

Todo el comando vive aquí: UI adapter + armado de mensaje + registro.

```ts
/**
 * frida-app-walkthrough — slash command /walkthrough (issue #140, Pista M).
 *
 * Molde presenter.ts de cc-plugins (UI adapter por pack) con una
 * adaptación: vscode NO se importa estáticamente — command.ts lo importa
 * index.ts, que las suites pattern.test.ts cargan en vitest sin vscode
 * resolvable; el default de producción carga vscode LAZY (dynamic import)
 * únicamente cuando el handler corre sin ui inyectada. Así el comando
 * completo (interfaz + handler + registro) vive aquí sin romper el
 * guardián estructural (npm test).
 *
 * Flujo (FR-4/FR-7/FR-8): URL inline tras el comando o InputBox (D5) →
 * QuickPick de maxScreens con defaults del FRD (D10; "todo" = 0, D15) →
 * guard findBuiltinPattern (D12) → delegación al chat vía sendUserMessage
 * (D2, seam git-sync index.ts:403-404). Cancelación = no-op silencioso
 * (FR-8/D13): return plano tras undefined, sin notify.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findBuiltinPattern } from "../frida-extensible-workflows/builtin-patterns";

/** Opciones de maxScreens del QuickPick (D10 — defaults FRD; "todo" = 0). */
const MAX_SCREENS_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
 { label: "10 pantallas (recomendado)", value: 10 },
 { label: "5 pantallas", value: 5 },
 { label: "25 pantallas", value: 25 },
 { label: "Todo (sin tope)", value: 0 },
];

/**
 * UI adapter inyectable (molde WorktreeUI, src/worktree/command.ts:56-63):
 * pick/input devuelven undefined al cancelar (Esc) — el return plano del
 * handler ES el no-op de FR-8. Tests inyectan un fake; producción usa el
 * default lazy de abajo.
 */
export interface SlashPickUI {
 /** QuickPick sobre labels; undefined = Esc. */
 pick(title: string, labels: readonly string[]): Promise<string | undefined>;
 /** InputBox de texto; undefined = Esc. */
 input(prompt: string, placeHolder?: string): Promise<string | undefined>;
 /** Warning no-modal (guard D12: patrón ausente — causa+remedio). */
 warn(message: string): void;
}

/** Default de producción: vscode LAZY (ver cabecera). Solo extension host. */
async function createDefaultPickUI(): Promise<SlashPickUI> {
 const vscode = await import("vscode");
 return {
  async pick(title, labels) {
   return vscode.window.showQuickPick([...labels], { title });
  },
  async input(prompt, placeHolder) {
   return vscode.window.showInputBox({ prompt, placeHolder });
  },
  warn(message) {
   void vscode.window.showWarningMessage(message);
  },
 };
}

/**
 * Arma el mensaje de lanzamiento (D11 — objeto literal 1:1 con el `args`
 * declarado del patrón; todos los requeridos presentes, FR-7).
 */
export function buildWalkthroughPrompt(
 url: string,
 maxScreens: number,
): string {
 return `Ejecuta el workflow 'app-walkthrough' con los siguientes argumentos:\n{ url: ${JSON.stringify(url)}, maxScreens: ${maxScreens} }`;
}

/**
 * Registra el comando /walkthrough en el ExtensionAPI del pack. Se llama
 * desde el setup de la factory (index.ts); pi queda en closure —
 * sendUserMessage SOLO se invoca diferido, dentro del handler (nunca en
 * setup: el stub lanza hasta bindCore, loader.js:131-133).
 */
export function registerWalkthroughCommand(
 pi: ExtensionAPI,
 ui?: SlashPickUI,
): void {
 pi.registerCommand("walkthrough", {
  description:
   "Documenta una app web usándola como usuario real y genera docs/funcional/ (pantallas, journeys, reglas, roles). Pregunta URL y presupuesto de pantallas.",
  async handler(args, ctx) {
   const pickUi = ui ?? (await createDefaultPickUI());
   // D5: args inline = URL (sin espacios, molde postWfCommand
   // src/extension.ts:4452-4460). Esc y Enter-vacío: no-op (:4465).
   let url = args?.trim() ?? "";
   if (!url) {
    const entered = await pickUi.input(
     "URL de la app a documentar (sesión de navegador pre-autenticada)",
     "https://app.ejemplo.com",
     );
    if (!entered || !entered.trim()) return;
    url = entered.trim();
   }
   // D10/D15: presupuesto — "Todo" viaja como número 0.
   const label = await pickUi.pick(
    "¿Cuántas pantallas únicas documentar?",
    MAX_SCREENS_OPTIONS.map((o) => o.label),
   );
   if (label === undefined) return;
   const maxScreens =
    MAX_SCREENS_OPTIONS.find((o) => o.label === label)?.value ?? 10;

   // D12: comando sí, patrón no (motor apagado) — error accionable,
   // sin enviar (el tool fallaría opaco, index.ts:226-228 del motor).
   if (!findBuiltinPattern("app-walkthrough")) {
    pickUi.warn(
     "/walkthrough: el patrón 'app-walkthrough' no está registrado. Verifica que el motor de workflows extensibles esté activo y recarga con /reload.",
    );
    return;
   }
   const prompt = buildWalkthroughPrompt(url, maxScreens);
   // D2: seam git-sync (frida-git-sync/index.ts:403-404) — nunca steer.
   if (ctx.isIdle()) pi.sendUserMessage(prompt);
   else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  },
 });
}
```

### src/tools/frida-app-walkthrough/index.ts:9,49-57 — MODIFY

```ts
// Header del archivo — el bloque "Uso:" agrega (acompañando la línea
// existente de workflow({ name: "app-walkthrough", ... })):
//
// Uso:  /walkthrough [url]   → QuickPicks por args requeridos → lanza el
//        patrón vía chat (pi.sendUserMessage). Igual que /wf pero guiado.

// Import nuevo tras los existentes:
import { registerWalkthroughCommand } from "./command";

// Factory reemplazada (antes: createFridaAppWalkthrough() sin opts, setup
// con _pi sin usar):

/** Opts de la factory: UI del slash command inyectable para tests (D3).
 *  Producción omite `ui` y el handler carga vscode lazy (ver command.ts). */
export interface CreateFridaAppWalkthroughOptions {
 /** QuickPicks/InputBox del /walkthrough. Tests inyectan un fake. */
 ui?: import("./command").SlashPickUI;
}

/** Factory de la extensión frida-app-walkthrough. */
export function createFridaAppWalkthrough(
 opts: CreateFridaAppWalkthroughOptions = {},
) {
 return (pi: ExtensionAPI): void => {
  // Registro en runtime (#133): el motor (frida-extensible-workflows)
  // consume REGISTERED_PATTERNS vía findBuiltinPattern/
  // builtinPatternsCatalog. Idempotente por nombre; el cwd se resuelve
  // lazy en resolve().
  registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
  // #140: slash command /walkthrough — registro incondicional junto al
  // patrón (mueren juntos ante invalidación de sesión; /reload
  // re-registra ambos).
  registerWalkthroughCommand(pi, opts.ui);
 };
}
```

El call site `createFridaAppWalkthrough()` en `src/pi-session.ts:673` sigue compilando sin cambio (opts opcional). El resto del archivo (APP_WALKTHROUGH_PATTERN, imports) queda igual.

### test/frida-app-walkthrough/pattern.test.ts:140-167 — MODIFY

```ts
// Solo cambia el describe de registro (los 4 sites "{} as never" caen aquí);
// el resto del archivo queda intacto.
describe("frida-app-walkthrough · registro en runtime sobre el motor (#133)", () => {
 // #140: el setup ahora también registra el comando /walkthrough — el
 // stub {} as never ya no sirve (registerCommand incondicional). Los
 // tests del comando viven en command.test.ts.
 /** Stub mínimo de ExtensionAPI: solo registerCommand (no-op). */
 const setupPi = (): unknown => ({ registerCommand: () => {} });

 it("la factory registra el patrón (smoke de registro)", () => {
  expect(findBuiltinPattern("app-walkthrough")).toBeUndefined();
  createFridaAppWalkthrough()(setupPi() as never);
  const found = findBuiltinPattern("app-walkthrough");
  expect(found?.name).toBe("app-walkthrough");
  expect(found?.description).toContain("docs/funcional/");
 });

 it("el catálogo lista el patrón junto a los builtin (toContain, no conteo)", () => {
  createFridaAppWalkthrough()(setupPi() as never);
  const names = builtinPatternsCatalog().map((p) => p.name);
  expect(names).toContain("app-walkthrough");
  expect(names).toContain("code-review"); // los 4 de #19 siguen
 });

 it("la factory es idempotente por nombre (no duplica)", () => {
  const factory = createFridaAppWalkthrough();
  factory(setupPi() as never);
  factory(setupPi() as never);
  expect(
   builtinPatternsCatalog().filter((p) => p.name === "app-walkthrough"),
  ).toHaveLength(1);
 });
});
```

### test/frida-app-walkthrough/command.test.ts — NEW

```ts
/**
 * frida-app-walkthrough — tests del slash command /walkthrough (#140).
 * Moldes: fakePi capturando registerCommand (test/frida-cc-plugins/
 * presenter.test.ts:59-86) + captura de sendUserMessage (test/frida-goal/
 * goal-runtime.test.ts:12-50). Sin vscode: la UI se inyecta como fake
 * (adapter D3) — command.ts no importa vscode estáticamente.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
 clearRegisteredBuiltinPatterns,
 registerBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import {
 APP_WALKTHROUGH_PATTERN,
 createFridaAppWalkthrough,
} from "../../src/tools/frida-app-walkthrough";
import {
 buildWalkthroughPrompt,
 registerWalkthroughCommand,
 type SlashPickUI,
} from "../../src/tools/frida-app-walkthrough/command";

interface Sent {
 text: string;
 opts?: { deliverAs?: string };
}

/** Captura de ExtensionAPI: comandos en Map + sendUserMessage grabado. */
function fakePi() {
 const sent: Sent[] = [];
 const commands = new Map<
  string,
  { description?: string; handler: (a: string, c: unknown) => Promise<void> }
 >();
 const pi = {
  commands,
  sent,
  registerCommand: (
   n: string,
   o: {
    description?: string;
    handler: (a: string, c: unknown) => Promise<void>;
   },
  ) => commands.set(n, o),
  sendUserMessage: (text: string, opts?: { deliverAs?: string }) => {
   sent.push({ text, opts });
  },
 };
 return pi;
}

/** Fake de SlashPickUI con respuestas scripted (undefined = Esc). */
function fakeUi(responses: { url?: string; pick?: string }) {
 const ui: SlashPickUI = {
  async input(_prompt: string, _placeHolder?: string) {
   return responses.url;
  },
  async pick(_title: string, _labels: readonly string[]) {
   return responses.pick;
  },
  warn(message: string) {
   throw new Error("warn inesperado: " + message);
  },
 };
 return ui;
}

/** Fake de ExtensionCommandContext (solo isIdle). */
function fakeCtx(idle = true): unknown {
 return { isIdle: () => idle };
}

/** UI que además captura los warnings (para el guard D12). */
function fakeUiWithWarnings(responses: { url?: string; pick?: string }) {
 const warnings: string[] = [];
 const ui: SlashPickUI = {
  async input(_prompt: string, _placeHolder?: string) {
   return responses.url;
  },
  async pick(_title: string, _labels: readonly string[]) {
   return responses.pick;
  },
  warn(message: string) {
   warnings.push(message);
  },
 };
 return { ui, warnings };
}

afterEach(() => {
 // Lesson M8: el registro es module-global — limpiar entre tests.
 clearRegisteredBuiltinPatterns();
});

describe("frida-app-walkthrough · slash command /walkthrough (#140)", () => {
 it("buildWalkthroughPrompt arma el mensaje FR-7 (objeto literal con requeridos)", () => {
  expect(buildWalkthroughPrompt("https://a.b", 10)).toBe(
   'Ejecuta el workflow \'app-walkthrough\' con los siguientes argumentos:\n{ url: "https://a.b", maxScreens: 10 }',
  );
 });

 it("la factory registra /walkthrough con descripción es-MX no vacía", () => {
  const pi = fakePi();
  registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
  createFridaAppWalkthrough({
   ui: fakeUi({ pick: "10 pantallas (recomendado)" }),
  })(pi as unknown as ExtensionAPI);
  expect(pi.commands.has("walkthrough")).toBe(true);
  const desc = pi.commands.get("walkthrough")?.description ?? "";
  expect(desc.length).toBeGreaterThan(10);
  expect(desc).toMatch(/[áéíóúñ¿¡]|pantallas|document/);
 });

 it("armado completo con URL inline (FR-7): 1 sendUserMessage, sin InputBox", async () => {
  const pi = fakePi();
  registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
  let inputs = 0;
  const ui: SlashPickUI = {
   async input() {
    inputs++;
    return "https://x.app";
   },
   async pick() {
    return "10 pantallas (recomendado)";
   },
   warn: () => {},
  };
  registerWalkthroughCommand(pi as unknown as ExtensionAPI, ui);
  await pi.commands
   .get("walkthrough")
   ?.handler("https://app.ejemplo.com", fakeCtx());
  expect(inputs).toBe(0);
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.text).toContain(
   "Ejecuta el workflow 'app-walkthrough' con los siguientes argumentos:",
  );
  expect(pi.sent[0]?.text).toContain('url: "https://app.ejemplo.com"');
  expect(pi.sent[0]?.text).toContain("maxScreens: 10");
  expect(pi.sent[0]?.opts).toBeUndefined();
 });

 it("URL por InputBox cuando args vacíos; 'Todo' viaja como maxScreens: 0", async () => {
  const pi = fakePi();
  registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
  registerWalkthroughCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ url: "https://x.app", pick: "Todo (sin tope)" }),
  );
  await pi.commands.get("walkthrough")?.handler("   ", fakeCtx());
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.text).toContain('url: "https://x.app"');
  expect(pi.sent[0]?.text).toContain("maxScreens: 0");
 });

 it("no-idle: deliverAs followUp (seam git-sync index.ts:403-404)", async () => {
  const pi = fakePi();
  registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
  registerWalkthroughCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ pick: "5 pantallas" }),
  );
  await pi.commands
   .get("walkthrough")
   ?.handler("https://a.b", fakeCtx(false));
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.opts).toEqual({ deliverAs: "followUp" });
  expect(pi.sent[0]?.text).toContain("maxScreens: 5");
 });

 it("cancelación silenciosa FR-8: Esc o Enter-vacío en la URL → 0 envíos", async () => {
  registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
  for (const url of [undefined, "", "   "]) {
   const pi = fakePi();
   registerWalkthroughCommand(
    pi as unknown as ExtensionAPI,
    fakeUi({ url, pick: "10 pantallas (recomendado)" }),
   );
   await pi.commands.get("walkthrough")?.handler("", fakeCtx());
   expect(pi.sent).toHaveLength(0);
  }
 });

 it("cancelación silenciosa FR-8: Esc en el QuickPick → 0 envíos", async () => {
  const pi = fakePi();
  registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
  registerWalkthroughCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ pick: undefined }),
  );
  await pi.commands.get("walkthrough")?.handler("https://a.b", fakeCtx());
  expect(pi.sent).toHaveLength(0);
 });

 it("guard D12: patrón ausente → warning accionable, 0 envíos", async () => {
  const pi = fakePi();
  const { ui, warnings } = fakeUiWithWarnings({
   pick: "10 pantallas (recomendado)",
  });
  registerWalkthroughCommand(pi as unknown as ExtensionAPI, ui);
  await pi.commands.get("walkthrough")?.handler("https://a.b", fakeCtx());
  expect(pi.sent).toHaveLength(0);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("app-walkthrough");
  expect(warnings[0]).toContain("/reload");
 });
});
```

### src/tools/frida-understand-app/command.ts — NEW

Todo el comando vive aquí (molde command.ts de walkthrough, D4), adaptado a un patrón sin URL: sin InputBox, args ignorados, QuickPick único de maxHotspots.

```ts
/**
 * frida-understand-app — slash command /understand (issue #140, Pista M).
 *
 * Réplica del molde command.ts de frida-app-walkthrough (D4, Slice 1) con
 * la adaptación propia del patrón: NO hay InputBox ni args —
 * understand-app no tiene URL (el target es el cwd del repo), así que el
 * único paso es el QuickPick de maxHotspots (D5: args ignorados, siempre
 * QuickPick). El adapter SlashPickUI conserva los 3 métodos del molde
 * (input lo usan walkthrough/size) para mantener los fakes copiables
 * entre packs.
 *
 * vscode NO se importa estáticamente — index.ts importa este archivo y las
 * suites pattern.test.ts cargan index.ts en vitest sin vscode resolvable;
 * el default de producción carga vscode LAZY (dynamic import) únicamente
 * cuando el handler corre sin ui inyectada (molde Slice 1; guardián
 * estructural: npm test).
 *
 * Flujo (FR-4/FR-7/FR-8): QuickPick de maxHotspots con defaults del FRD
 * (D10; "todo" = 0, D15) → guard findBuiltinPattern (D12) → delegación al
 * chat vía sendUserMessage (D2, seam git-sync index.ts:403-404).
 * Cancelación = no-op silencioso (FR-8/D13): return plano tras undefined.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findBuiltinPattern } from "../frida-extensible-workflows/builtin-patterns";

/** Opciones de maxHotspots del QuickPick (D10 — defaults FRD; "todo" = 0). */
const MAX_HOTSPOTS_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
 { label: "8 hotspots (recomendado)", value: 8 },
 { label: "15 hotspots", value: 15 },
 { label: "Todo (sin tope)", value: 0 },
];

/**
 * UI adapter inyectable (molde WorktreeUI, src/worktree/command.ts:56-63):
 * pick/input devuelven undefined al cancelar (Esc) — el return plano del
 * handler ES el no-op de FR-8. Tests inyectan un fake; producción usa el
 * default lazy de abajo. input NO se usa en este pack (sin URL); se
 * conserva para uniformidad del molde (D4).
 */
export interface SlashPickUI {
 /** QuickPick sobre labels; undefined = Esc. */
 pick(title: string, labels: readonly string[]): Promise<string | undefined>;
 /** InputBox de texto; undefined = Esc. (Sin uso en este pack — molde D4.) */
 input(prompt: string, placeHolder?: string): Promise<string | undefined>;
 /** Warning no-modal (guard D12: patrón ausente — causa+remedio). */
 warn(message: string): void;
}

/** Default de producción: vscode LAZY (ver cabecera). Solo extension host. */
async function createDefaultPickUI(): Promise<SlashPickUI> {
 const vscode = await import("vscode");
 return {
  async pick(title, labels) {
   return vscode.window.showQuickPick([...labels], { title });
  },
  async input(prompt, placeHolder) {
   return vscode.window.showInputBox({ prompt, placeHolder });
  },
  warn(message) {
   void vscode.window.showWarningMessage(message);
  },
 };
}

/**
 * Arma el mensaje de lanzamiento (D11 — objeto literal 1:1 con el `args`
 * declarado del patrón; solo el requerido maxHotspots, D8: maxMinutes/
 * language/review viven en defaults del patrón y no se mencionan).
 */
export function buildUnderstandAppPrompt(maxHotspots: number): string {
 return `Ejecuta el workflow 'understand-app' con los siguientes argumentos:\n{ maxHotspots: ${maxHotspots} }`;
}

/**
 * Registra el comando /understand en el ExtensionAPI del pack. Se llama
 * desde el setup de la factory (index.ts); pi queda en closure —
 * sendUserMessage SOLO se invoca diferido, dentro del handler (nunca en
 * setup: el stub lanza hasta bindCore, loader.js:131-133).
 */
export function registerUnderstandAppCommand(
 pi: ExtensionAPI,
 ui?: SlashPickUI,
): void {
 pi.registerCommand("understand", {
  description:
   "Entiende un códigobase desconocido y produce el entendimiento técnico en docs/entendimiento/ (7 preguntas del día 1 con evidencia, riesgos, modelo LikeC4). Pregunta el presupuesto de hotspots.",
  async handler(_args, ctx) {
   const pickUi = ui ?? (await createDefaultPickUI());
   // D5: /understand NO lee args — el target es el cwd del repo y el
   // presupuesto se elige SIEMPRE en el QuickPick (cards sin espacio).
   const label = await pickUi.pick(
    "¿Cuántas áreas de riesgo (hotspots) explorar?",
    MAX_HOTSPOTS_OPTIONS.map((o) => o.label),
   );
   if (label === undefined) return;
   const maxHotspots =
    MAX_HOTSPOTS_OPTIONS.find((o) => o.label === label)?.value ?? 8;

   // D12: comando sí, patrón no (motor apagado) — error accionable,
   // sin enviar (el tool fallaría opaco, index.ts:226-228 del motor).
   if (!findBuiltinPattern("understand-app")) {
    pickUi.warn(
     "/understand: el patrón 'understand-app' no está registrado. Verifica que el motor de workflows extensibles esté activo y recarga con /reload.",
    );
    return;
   }
   const prompt = buildUnderstandAppPrompt(maxHotspots);
   // D2: seam git-sync (frida-git-sync/index.ts:403-404) — nunca steer.
   if (ctx.isIdle()) pi.sendUserMessage(prompt);
   else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  },
 });
}
```

### src/tools/frida-understand-app/index.ts:10,121-142 — MODIFY

```ts
// Header del archivo — el bloque "Uso:" agrega (acompañando la línea
// existente de workflow({ name: "understand-app", ... })):
//
// Uso:  /understand   → QuickPick del presupuesto de hotspots → lanza el
//        patrón vía chat (pi.sendUserMessage). Igual que /wf pero guiado.

// Import nuevo tras los existentes:
import { registerUnderstandAppCommand } from "./command";

// Interface existente — SOLO agrega el campo ui al final:
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

// Setup de la factory — reemplazo del bloque final (antes (_pi: ExtensionAPI)
// sin usar; ahora pi alimenta el comando):

 return (pi: ExtensionAPI): void => {
  // Registro en runtime (#134): el motor consume REGISTERED_PATTERNS vía
  // findBuiltinPattern/builtinPatternsCatalog. Idempotente por nombre.
  registerBuiltinPattern(pattern);
  // #140: slash command /understand — registro incondicional junto al
  // patrón (mueren juntos ante invalidación de sesión; /reload
  // re-registra ambos).
  registerUnderstandAppCommand(pi, opts.ui);
 };
```

El call site `createFridaUnderstandApp({...})` en `src/pi-session.ts:681` sigue compilando sin cambio (`ui` opcional). El resto del archivo (UNDERSTAND_APP_PATTERN, resolver, sonda) queda igual.

### test/frida-understand-app/pattern.test.ts:250-309 — MODIFY

```ts
// Solo cambia el describe final de registro (ahí caen los 6 sites
// "{} as never"); el resto del archivo queda intacto.
describe("frida-understand-app · registro en runtime sobre el motor (#134)", () => {
 // #140: el setup ahora también registra el comando /understand — el
 // stub {} as never ya no sirve (registerCommand incondicional). Los
 // tests del comando viven en command.test.ts.
 /** Stub mínimo de ExtensionAPI: solo registerCommand (no-op). */
 const setupPi = (): unknown => ({ registerCommand: () => {} });

 it("la factory registra el patrón (smoke de registro)", () => {
  expect(findBuiltinPattern("understand-app")).toBeUndefined();
  createFridaUnderstandApp()(setupPi() as never);
  const found = findBuiltinPattern("understand-app");
  expect(found?.name).toBe("understand-app");
  expect(found?.description).toContain("docs/entendimiento/");
 });

 it("el catálogo lista el patrón junto a los builtin (toContain, no conteo)", () => {
  createFridaUnderstandApp()(setupPi() as never);
  const names = builtinPatternsCatalog().map((p) => p.name);
  expect(names).toContain("understand-app");
  expect(names).toContain("code-review"); // los 4 de #19 siguen
 });

 it("la factory es idempotente por nombre (no duplica)", () => {
  const factory = createFridaUnderstandApp();
  factory(setupPi() as never);
  factory(setupPi() as never);
  expect(
   builtinPatternsCatalog().filter((p) => p.name === "understand-app"),
  ).toHaveLength(1);
 });

 it("la factory con agentDir propio interpola capacidades exactas (D6)", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "understand-agentdir-"));
  try {
   fixtureLensEntry(agentDir);
   createFridaUnderstandApp({ agentDir })(setupPi() as never);
   const script = findBuiltinPattern("understand-app")?.resolve(VALID, {
    cwd,
   });
   expect(script).toContain('"lens":true');
   expect(script).toContain('"codebaseIndex":false');
  } finally {
   rmSync(agentDir, { recursive: true, force: true });
  }
 });

 it("el getter codebaseIndexEnabled apagado degrada CAPABILITIES (D5)", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "understand-agentdir-"));
  try {
   fixtureLensEntry(agentDir);
   fixtureCodebaseIndexAtPin(agentDir);
   createFridaUnderstandApp({
    agentDir,
    codebaseIndexEnabled: () => false,
   })(setupPi() as never);
   const script = findBuiltinPattern("understand-app")?.resolve(VALID, {
    cwd,
   });
   expect(script).toContain(
    'const CAPABILITIES = {"lens":true,"codebaseIndex":false}',
   );
  } finally {
   rmSync(agentDir, { recursive: true, force: true });
  }
 });
});
```

### test/frida-understand-app/command.test.ts — NEW

```ts
/**
 * frida-understand-app — tests del slash command /understand (#140).
 * Moldes: fakePi capturando registerCommand (test/frida-cc-plugins/
 * presenter.test.ts:59-86) + captura de sendUserMessage (test/frida-goal/
 * goal-runtime.test.ts:12-50) + command.test.ts de walkthrough (Slice 1).
 * Sin vscode: la UI se inyecta como fake (adapter D3) — command.ts no
 * importa vscode estáticamente.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
 clearRegisteredBuiltinPatterns,
 registerBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import {
 UNDERSTAND_APP_PATTERN,
 createFridaUnderstandApp,
} from "../../src/tools/frida-understand-app";
import {
 buildUnderstandAppPrompt,
 registerUnderstandAppCommand,
 type SlashPickUI,
} from "../../src/tools/frida-understand-app/command";

interface Sent {
 text: string;
 opts?: { deliverAs?: string };
}

/** Captura de ExtensionAPI: comandos en Map + sendUserMessage grabado. */
function fakePi() {
 const sent: Sent[] = [];
 const commands = new Map<
  string,
  {
   description?: string;
   handler: (a: string | undefined, c: unknown) => Promise<void>;
  }
 >();
 const pi = {
  commands,
  sent,
  registerCommand: (
   n: string,
   o: {
    description?: string;
    handler: (a: string | undefined, c: unknown) => Promise<void>;
   },
  ) => commands.set(n, o),
  sendUserMessage: (text: string, opts?: { deliverAs?: string }) => {
   sent.push({ text, opts });
  },
 };
 return pi;
}

/**
 * Fake de SlashPickUI con respuesta scripted de pick. input LANZA si se
 * invoca: /understand no tiene paso de InputBox (D5 — el target es el cwd).
 */
function fakeUi(responses: { pick?: string }) {
 const ui: SlashPickUI = {
  async input() {
   throw new Error("input inesperado: /understand no usa InputBox");
  },
  async pick(_title: string, _labels: readonly string[]) {
   return responses.pick;
  },
  warn(message: string) {
   throw new Error("warn inesperado: " + message);
  },
 };
 return ui;
}

/** Fake de ExtensionCommandContext (solo isIdle). */
function fakeCtx(idle = true): unknown {
 return { isIdle: () => idle };
}

/** UI que además captura los warnings (para el guard D12). */
function fakeUiWithWarnings(responses: { pick?: string }) {
 const warnings: string[] = [];
 const ui: SlashPickUI = {
  async input() {
   throw new Error("input inesperado: /understand no usa InputBox");
  },
  async pick(_title: string, _labels: readonly string[]) {
   return responses.pick;
  },
  warn(message: string) {
   warnings.push(message);
  },
 };
 return { ui, warnings };
}

afterEach(() => {
 // Lesson M8: el registro es module-global — limpiar entre tests.
 clearRegisteredBuiltinPatterns();
});

describe("frida-understand-app · slash command /understand (#140)", () => {
 it("buildUnderstandAppPrompt arma el mensaje FR-7 (objeto literal con el requerido)", () => {
  expect(buildUnderstandAppPrompt(8)).toBe(
   "Ejecuta el workflow 'understand-app' con los siguientes argumentos:\n{ maxHotspots: 8 }",
  );
 });

 it("la factory registra /understand con descripción es-MX no vacía", () => {
  const pi = fakePi();
  registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
  createFridaUnderstandApp({
   ui: fakeUi({ pick: "8 hotspots (recomendado)" }),
  })(pi as unknown as ExtensionAPI);
  expect(pi.commands.has("understand")).toBe(true);
  const desc = pi.commands.get("understand")?.description ?? "";
  expect(desc.length).toBeGreaterThan(10);
  expect(desc).toMatch(/[áéíóúñ¿¡]|entendimiento|hotspots/);
 });

 it("armado completo: 1 sendUserMessage exacto; args ignorados (D5), sin InputBox", async () => {
  const pi = fakePi();
  registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
  registerUnderstandAppCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ pick: "8 hotspots (recomendado)" }),
  );
  await pi.commands.get("understand")?.handler("  15  ", fakeCtx());
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.text).toBe(
   "Ejecuta el workflow 'understand-app' con los siguientes argumentos:\n{ maxHotspots: 8 }",
  );
  expect(pi.sent[0]?.opts).toBeUndefined();
 });

 it("'Todo (sin tope)' viaja como maxHotspots: 0 (D15)", async () => {
  const pi = fakePi();
  registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
  registerUnderstandAppCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ pick: "Todo (sin tope)" }),
  );
  await pi.commands.get("understand")?.handler(undefined, fakeCtx());
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.text).toContain("maxHotspots: 0");
 });

 it("no-idle: deliverAs followUp (seam git-sync index.ts:403-404)", async () => {
  const pi = fakePi();
  registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
  registerUnderstandAppCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ pick: "15 hotspots" }),
  );
  await pi.commands.get("understand")?.handler(undefined, fakeCtx(false));
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.opts).toEqual({ deliverAs: "followUp" });
  expect(pi.sent[0]?.text).toContain("maxHotspots: 15");
 });

 it("cancelación silenciosa FR-8: Esc en el QuickPick → 0 envíos", async () => {
  const pi = fakePi();
  registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
  registerUnderstandAppCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ pick: undefined }),
  );
  await pi.commands.get("understand")?.handler(undefined, fakeCtx());
  expect(pi.sent).toHaveLength(0);
 });

 it("guard D12: patrón ausente → warning accionable, 0 envíos", async () => {
  const pi = fakePi();
  const { ui, warnings } = fakeUiWithWarnings({
   pick: "8 hotspots (recomendado)",
  });
  registerUnderstandAppCommand(pi as unknown as ExtensionAPI, ui);
  await pi.commands.get("understand")?.handler(undefined, fakeCtx());
  expect(pi.sent).toHaveLength(0);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("understand-app");
  expect(warnings[0]).toContain("/reload");
 });
});
```

### src/tools/frida-size-app/command.ts — NEW

Todo el comando vive aquí (molde command.ts de walkthrough, D4), adaptado al patrón con DOS QuickPicks requeridos (cocomoType primero, luego wage) y el InputBox numérico SOLO para "monto propio". El adapter agrega un 4º método `error` (adaptación del pack, D15).

```ts
/**
 * frida-size-app — slash command /size (issue #140, Pista M).
 *
 * Réplica del molde command.ts de frida-app-walkthrough (D4, Slice 1) con
 * las adaptaciones propias del patrón: DOS QuickPicks requeridos
 * (cocomoType primero, luego wage — D10) y el InputBox numérico SOLO para
 * "monto propio" (D15). El adapter SlashPickUI agrega un 4º método
 * `error` (adaptación del pack, D15): el warning (D12) cubre el patrón
 * ausente; el error cubre la entrada numérica inválida del usuario —
 * showWarningMessage sería semánticamente débil para esa barra.
 *
 * vscode NO se importa estáticamente — index.ts importa este archivo y las
 * suites pattern.test.ts cargan index.ts en vitest sin vscode resolvable;
 * el default de producción carga vscode LAZY (dynamic import) únicamente
 * cuando el handler corre sin ui inyectada (molde Slice 1; guardián
 * estructural: npm test).
 *
 * Flujo (FR-4/FR-7/FR-8): QuickPick cocomoType (D10) → QuickPick wage
 * (MXN/USD traen wage+currency; "monto propio" → InputBox numérico, sin
 * currency — default "USD" del patrón) → guard findBuiltinPattern (D12) →
 * delegación al chat vía sendUserMessage (D2, seam git-sync
 * index.ts:403-404). Cancelación = no-op silencioso (FR-8/D13): return
 * plano tras undefined o Enter-vacío. args se IGNORAN (D5: QuickPicks
 * siempre — cards sin espacio final).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findBuiltinPattern } from "../frida-extensible-workflows/builtin-patterns";
import type { CocomoType } from "./workflow";

/** Opciones de cocomoType del QuickPick (D10 — enum del validador). */
const COCOMO_OPTIONS: ReadonlyArray<{ label: string; value: CocomoType }> = [
 { label: "semi-detached (recomendado)", value: "semi-detached" },
 { label: "organic", value: "organic" },
 { label: "embedded", value: "embedded" },
];

/**
 * Opciones de wage del QuickPick (D10): MXN/USD traen wage+currency
 * embebidos; "monto propio" abre el InputBox numérico (sin currency — el
 * patrón aplica su default "USD", D15).
 */
const WAGE_OPTIONS: ReadonlyArray<{
 label: string;
 wage?: number;
 currency?: string;
 custom?: boolean;
}> = [
 { label: "MXN $35,000", wage: 35000, currency: "MXN" },
 { label: "USD $6,000", wage: 6000, currency: "USD" },
 { label: "monto propio", custom: true },
];

/**
 * UI adapter inyectable (molde WorktreeUI, src/worktree/command.ts:56-63):
 * pick/input devuelven undefined al cancelar (Esc) — el return plano del
 * handler ES el no-op de FR-8. Tests inyectan un fake; producción usa el
 * default lazy de abajo. `error` es la adaptación del pack (D15):
 * showErrorMessage para el monto propio inválido (entrada del usuario),
 * distinto del warn D12 (condición del entorno: patrón ausente).
 */
export interface SlashPickUI {
 /** QuickPick sobre labels; undefined = Esc. */
 pick(title: string, labels: readonly string[]): Promise<string | undefined>;
 /** InputBox de texto; undefined = Esc. */
 input(prompt: string, placeHolder?: string): Promise<string | undefined>;
 /** Warning no-modal (guard D12: patrón ausente — causa+remedio). */
 warn(message: string): void;
 /** Error no-modal (D15: monto propio no numérico — causa+remedio). */
 error(message: string): void;
}

/** Default de producción: vscode LAZY (ver cabecera). Solo extension host. */
async function createDefaultPickUI(): Promise<SlashPickUI> {
 const vscode = await import("vscode");
 return {
  async pick(title, labels) {
   return vscode.window.showQuickPick([...labels], { title });
  },
  async input(prompt, placeHolder) {
   return vscode.window.showInputBox({ prompt, placeHolder });
  },
  warn(message) {
   void vscode.window.showWarningMessage(message);
  },
  error(message) {
   void vscode.window.showErrorMessage(message);
  },
 };
}

/**
 * Arma el mensaje de lanzamiento (D11 — objeto literal 1:1 con el `args`
 * declarado del patrón): wage SIEMPRE (único requerido del patrón),
 * currency solo cuando la opción del pick la trae ("monto propio" deja el
 * default "USD" del patrón, D15) y cocomoType siempre (elegido en
 * QuickPick, D8: maxMinutes/language/review/exclude viven en defaults del
 * patrón y no se mencionan).
 */
export function buildSizeAppPrompt(
 wage: number,
 cocomoType: CocomoType,
 currency?: string,
): string {
 const parts = [`wage: ${wage}`];
 if (currency !== undefined) {
  parts.push(`currency: ${JSON.stringify(currency)}`);
 }
 parts.push(`cocomoType: ${JSON.stringify(cocomoType)}`);
 return `Ejecuta el workflow 'size-app' con los siguientes argumentos:\n{ ${parts.join(", ")} }`;
}

/**
 * Registra el comando /size en el ExtensionAPI del pack. Se llama desde el
 * setup de la factory (index.ts); pi queda en closure — sendUserMessage
 * SOLO se invoca diferido, dentro del handler (nunca en setup: el stub
 * lanza hasta bindCore, loader.js:131-133).
 */
export function registerSizeAppCommand(
 pi: ExtensionAPI,
 ui?: SlashPickUI,
): void {
 pi.registerCommand("size", {
  description:
   "Dimensiona cuantitativamente la app del repo para preventa: KLOC, COCOMO 81 con costo por salario mensual, deuda técnica y riesgos; entrega docs/dimensionamiento/. Pregunta modo COCOMO y salario.",
  async handler(_args, ctx) {
   const pickUi = ui ?? (await createDefaultPickUI());
   // D5: /size NO lee args — cocomoType y wage se eligen SIEMPRE en los
   // QuickPicks (cards sin espacio final).
   const cocomoLabel = await pickUi.pick(
    "¿Modo Basic COCOMO 81?",
    COCOMO_OPTIONS.map((o) => o.label),
   );
   if (cocomoLabel === undefined) return;
   const cocomoType =
    COCOMO_OPTIONS.find((o) => o.label === cocomoLabel)?.value ??
    "semi-detached";

   const wageLabel = await pickUi.pick(
    "¿Salario MENSUAL por persona?",
    WAGE_OPTIONS.map((o) => o.label),
   );
   if (wageLabel === undefined) return;
   const chosen = WAGE_OPTIONS.find((o) => o.label === wageLabel);
   let wage: number;
   let currency: string | undefined;
   if (chosen?.custom) {
    // D15: monto propio — InputBox numérico. Esc y Enter-vacío: no-op
    // silencioso (FR-8, molde aidd-plan src/extension.ts:4465).
    const entered = await pickUi.input(
     "Salario MENSUAL por persona (número > 0; punto decimal, p. ej. 35000.50)",
     "35000.50",
    );
    const text = entered?.trim() ?? "";
    if (!text) return;
    // Formato estricto ANTES del parseFloat: la coma ("35,000") es la
    // trampa clásica — parseFloat pararía en 35 y enviaría un wage
    // engañoso; se rechaza con causa+remedio (D15, sin envío).
    if (!/^\d+(?:\.\d+)?$/.test(text)) {
     pickUi.error(
      "/size: el salario debe ser un número > 0 con punto decimal (p. ej. 35000.50), sin comas ni texto. Vuelve a lanzar /size.",
     );
     return;
    }
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
     pickUi.error(
      "/size: el salario debe ser un número > 0. Vuelve a lanzar /size.",
     );
     return;
    }
    wage = parsed; // currency queda undefined → default "USD" del patrón
   } else {
    wage = chosen?.wage ?? 6000;
    currency = chosen?.currency;
   }

   // D12: comando sí, patrón no (motor apagado) — error accionable,
   // sin enviar (el tool fallaría opaco, index.ts:226-228 del motor).
   if (!findBuiltinPattern("size-app")) {
    pickUi.warn(
     "/size: el patrón 'size-app' no está registrado. Verifica que el motor de workflows extensibles esté activo y recarga con /reload.",
    );
    return;
   }
   const prompt = buildSizeAppPrompt(wage, cocomoType, currency);
   // D2: seam git-sync (frida-git-sync/index.ts:403-404) — nunca steer.
   if (ctx.isIdle()) pi.sendUserMessage(prompt);
   else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  },
 });
}
```

### src/tools/frida-size-app/index.ts:11-12,119-120,141-151,172-201 — MODIFY

```ts
// Header del archivo — el bloque "Uso:" agrega (acompañando la línea
// existente de workflow({ name: "size-app", args: {...} })):
//
// Uso:  /size   → QuickPicks por modo COCOMO y salario (wage+currency) →
//        lanza el patrón vía chat (pi.sendUserMessage). Igual que /wf
//        pero guiado.

// Import nuevo tras los existentes:
import { registerSizeAppCommand } from "./command";

// SIZE_APP_PATTERN (líneas :119-120 en disco) — string args alineado a los
// QuickPicks de /size (#140, D10): mismas opciones y orden que el comando
// (modo COCOMO primero, luego salario) + mención de la vía guiada
// (ask_user_question sigue siendo la vía primaria del agente). El resto
// del string (currency/exclude/maxMinutes/language/review) queda igual.
 args:
  '{ wage: number (REQUERIDO, > 0, salario MENSUAL por persona — decimales válidos; si falta, pregúntalo con ask_user_question en la sesión principal ANTES de lanzar (opciones: "MXN $35,000" (wage 35000, currency "MXN") · "USD $6,000" (wage 6000, currency "USD") · monto propio) o sugiere el comando /size, que pregunta modo COCOMO y salario con QuickPicks ("semi-detached (recomendado)" · "organic" · "embedded" → "MXN $35,000" · "USD $6,000" · monto propio), y relanza con el valor resuelto), currency?: string (default "USD", etiqueta del informe), cocomoType?: "organic"|"semi-detached"|"embedded" (default "semi-detached"), exclude?: string[] (directorios adicionales a excluir — AMPLÍAN la curada dist/build/node_modules/vendor/target/out/.next/coverage + patrón *.min.js; [] = solo curada), maxMinutes?: number (entero 1-240, backstop wall-clock que corta el descubrimiento; omitir = sin tope), language?: string (default "es-MX"), review?: "manual"|"auto" (default "manual") }',

// Interface existente — SOLO agrega el campo ui al final:
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

// Setup de la factory — reemplazo del bloque final (antes (_pi: ExtensionAPI)
// sin usar; ahora pi alimenta el comando; el disparo ensureBinary queda
// intacto):

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
```

El call site `createFridaSizeApp({...})` en `src/pi-session.ts:708` sigue compilando sin cambio (`ui` opcional). El resto del archivo (SIZE_APP_PATTERN salvo el string `args`, resolver, sonda) queda igual.

### test/frida-size-app/pattern.test.ts:353-505 — MODIFY

```ts
// Solo cambia el describe final de registro (ahí caen los 8 sites
// "{} as never", verificados en disco :359/:379/:397/:398/:422/:445/:469/:495);
// el resto del archivo queda intacto.
describe("frida-size-app · registro en runtime + fire-and-forget (#139, D2/V6)", () => {
 // #140: el setup ahora también registra el comando /size — el stub
 // {} as never ya no sirve (registerCommand incondicional). Los tests
 // del comando viven en command.test.ts.
 /** Stub mínimo de ExtensionAPI: solo registerCommand (no-op). */
 const setupPi = (): unknown => ({ registerCommand: () => {} });

 it("la factory registra el patrón (smoke de registro)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
   expect(findBuiltinPattern("size-app")).toBeUndefined();
   // ensureDeps rechazante: el disparo no toca la red (seam D2).
   createFridaSizeApp({ ensureDeps: noNetworkDeps() })(setupPi() as never);
   const found = findBuiltinPattern("size-app");
   expect(found?.name).toBe("size-app");
   expect(found?.description).toContain("docs/dimensionamiento/");
   // El rechazo del disparo ya corrió (sin warn residual post-restore):
   // el catch loguea 2 líneas (mensaje + guía) — assert por CONTENIDO
   // del mensaje de fallo, inmune al número de líneas del catch.
   await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
     expect.stringContaining("instalación de scc falló"),
    ),
   );
  } finally {
   warn.mockRestore();
  }
 });

 it("el catálogo lista el patrón junto a los builtin (toContain, no conteo)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
   createFridaSizeApp({ ensureDeps: noNetworkDeps() })(setupPi() as never);
   const names = builtinPatternsCatalog().map((p) => p.name);
   expect(names).toContain("size-app");
   expect(names).toContain("code-review"); // los builtin de #19 siguen
   await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
     expect.stringContaining("instalación de scc falló"),
    ),
   );
  } finally {
   warn.mockRestore();
  }
 });

 it("la factory es idempotente por nombre (no duplica)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
   const factory = createFridaSizeApp({ ensureDeps: noNetworkDeps() });
   factory(setupPi() as never);
   factory(setupPi() as never);
   expect(
    builtinPatternsCatalog().filter((p) => p.name === "size-app"),
   ).toHaveLength(1);
   // Cada factory() dispara su propio rechazo (2 fires → 2 mensajes de
   // fallo; el guide agrega líneas extra irrelevantes al conteo).
   await vi.waitFor(() =>
    expect(
     warn.mock.calls.filter(([m]) =>
      String(m).includes("instalación de scc falló"),
     ),
    ).toHaveLength(2),
   );
  } finally {
   warn.mockRestore();
  }
 });

 it("la factory con agentDir propio interpola capacidades y SCC_BIN exactos (D3/D12)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const agentDir = mkdtempSync(join(tmpdir(), "size-app-agentdir-"));
  try {
   fixtureSccAtPin(agentDir);
   fixtureLensEntry(agentDir);
   createFridaSizeApp({ agentDir })(setupPi() as never);
   const script = findBuiltinPattern("size-app")?.resolve(VALID, { cwd });
   expect(script).toContain('"scc":true');
   expect(script).toContain('"lens":true');
   expect(script).toContain(
    `const SCC_BIN = ${JSON.stringify(sccBinPath(agentDir))}`,
   );
  } finally {
   warn.mockRestore();
   rmSync(agentDir, { recursive: true, force: true });
  }
 });

 it("el getter codebaseIndexEnabled apagado degrada CAPABILITIES (D3)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const agentDir = mkdtempSync(join(tmpdir(), "size-app-agentdir-"));
  try {
   fixtureSccAtPin(agentDir);
   fixtureLensEntry(agentDir);
   fixtureCodebaseIndexAtPin(agentDir);
   createFridaSizeApp({
    agentDir,
    codebaseIndexEnabled: () => false,
   })(setupPi() as never);
   const script = findBuiltinPattern("size-app")?.resolve(VALID, { cwd });
   expect(script).toContain(
    'const CAPABILITIES = {"scc":true,"lens":true,"codebaseIndex":false}',
   );
  } finally {
   warn.mockRestore();
   rmSync(agentDir, { recursive: true, force: true });
  }
 });

 it("V6: registra el patrón aunque ensureBinary rechace — disparo ocurrió, nada a medias, warn con guía", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const agentDir = mkdtempSync(join(tmpdir(), "size-app-agentdir-"));
  let fetched = 0;
  try {
   expect(findBuiltinPattern("size-app")).toBeUndefined();
   const deps: SccInstallDeps = {
    fetchArchive: async () => {
     fetched++;
     return Buffer.alloc(8); // sha no matchea → rechazo
    },
    digests: { [currentSccAsset() ?? "asset-test"]: "0".repeat(64) },
   };
   createFridaSizeApp({ agentDir, ensureDeps: deps })(setupPi() as never);
   // El patrón quedó registrado ANTES de conocer el resultado.
   expect(findBuiltinPattern("size-app")?.name).toBe("size-app");
   // El disparo corrió y el catch tragó el rechazo (warn emitido).
   await vi.waitFor(() => expect(warn).toHaveBeenCalled());
   expect(fetched).toBe(1);
   // Nada a medias (V7): sin binario ni marker.
   expect(isSccInstalledAtPin(agentDir)).toBe(false);
  } finally {
   warn.mockRestore();
   rmSync(agentDir, { recursive: true, force: true });
  }
 });

 it("gate idempotente del disparo: ya instalado al pin → NO dispara (D2)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const agentDir = mkdtempSync(join(tmpdir(), "size-app-agentdir-"));
  let fetched = 0;
  try {
   fixtureSccAtPin(agentDir);
   const deps: SccInstallDeps = {
    fetchArchive: async () => {
     fetched++;
     throw new Error("no debía descargar");
    },
   };
   createFridaSizeApp({ agentDir, ensureDeps: deps })(setupPi() as never);
   expect(fetched).toBe(0);
   expect(warn).not.toHaveBeenCalled();
  } finally {
   warn.mockRestore();
   rmSync(agentDir, { recursive: true, force: true });
  }
 });
});
```

### test/frida-size-app/command.test.ts — NEW

```ts
/**
 * frida-size-app — tests del slash command /size (#140).
 * Moldes: fakePi capturando registerCommand (test/frida-cc-plugins/
 * presenter.test.ts:59-86) + captura de sendUserMessage (test/frida-goal/
 * goal-runtime.test.ts:12-50) + command.test.ts de walkthrough (Slice 1).
 * Sin vscode: la UI se inyecta como fake (adapter D3) — command.ts no
 * importa vscode estáticamente.
 *
 * HERENCIA del pack (File Map): HOME aislado + ensureDeps rechazante —
 * la factory dispara ensureBinary fire-and-forget contra el agentDir del
 * HOME; sin aislamiento tocaría ~/.frida real (molde pattern.test.ts:48-62).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
 clearRegisteredBuiltinPatterns,
 registerBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import {
 SIZE_APP_PATTERN,
 createFridaSizeApp,
} from "../../src/tools/frida-size-app";
import type { SccInstallDeps } from "../../src/tools/frida-size-app/installer";
import {
 buildSizeAppPrompt,
 registerSizeAppCommand,
 type SlashPickUI,
} from "../../src/tools/frida-size-app/command";

interface Sent {
 text: string;
 opts?: { deliverAs?: string };
}

/** Captura de ExtensionAPI: comandos en Map + sendUserMessage grabado. */
function fakePi() {
 const sent: Sent[] = [];
 const commands = new Map<
  string,
  {
   description?: string;
   handler: (a: string | undefined, c: unknown) => Promise<void>;
  }
 >();
 const pi = {
  commands,
  sent,
  registerCommand: (
   n: string,
   o: {
    description?: string;
    handler: (a: string | undefined, c: unknown) => Promise<void>;
   },
  ) => commands.set(n, o),
  sendUserMessage: (text: string, opts?: { deliverAs?: string }) => {
   sent.push({ text, opts });
  },
 };
 return pi;
}

/**
 * Fake de SlashPickUI con respuestas scripted por ORDEN de pick (1º
 * cocomoType, 2º wage — D10) + input para "monto propio". warn/error
 * LANZAN si algo inesperado se emite; los tests del guard D12 y del
 * monto inválido D15 usan fakeUiWithMessages.
 */
function fakeUi(responses: {
 cocomo?: string;
 wage?: string;
 customWage?: string;
}) {
 let pickCalls = 0;
 const ui: SlashPickUI = {
  async input(_prompt: string, _placeHolder?: string) {
   return responses.customWage;
  },
  async pick(_title: string, _labels: readonly string[]) {
   pickCalls++;
   return pickCalls === 1 ? responses.cocomo : responses.wage;
  },
  warn(message: string) {
   throw new Error("warn inesperado: " + message);
  },
  error(message: string) {
   throw new Error("error inesperado: " + message);
  },
 };
 return ui;
}

/** Fake de ExtensionCommandContext (solo isIdle). */
function fakeCtx(idle = true): unknown {
 return { isIdle: () => idle };
}

/** UI que además captura warn/error (guard D12 + wage inválido D15). */
function fakeUiWithMessages(responses: {
 cocomo?: string;
 wage?: string;
 customWage?: string;
}) {
 const warnings: string[] = [];
 const errors: string[] = [];
 let pickCalls = 0;
 const ui: SlashPickUI = {
  async input(_prompt: string, _placeHolder?: string) {
   return responses.customWage;
  },
  async pick(_title: string, _labels: readonly string[]) {
   pickCalls++;
   return pickCalls === 1 ? responses.cocomo : responses.wage;
  },
  warn(message: string) {
   warnings.push(message);
  },
  error(message: string) {
   errors.push(message);
  },
 };
 return { ui, warnings, errors };
}

/** Deps que rechazan sin tocar la red — seam ensureDeps de la factory. */
const noNetworkDeps = (): SccInstallDeps => ({
 fetchArchive: () => Promise.reject(new Error("sin red (test)")),
});

const REAL_HOME = process.env.HOME;
let home: string;

beforeEach(() => {
 // HOME aislado (File Map: herencia del pack — la factory sondea y
 // dispara la descarga de scc contra un agentDir derivado de
 // os.homedir(); sin esto tocaría ~/.frida real).
 home = mkdtempSync(join(tmpdir(), "size-app-cmd-home-"));
 process.env.HOME = home;
});

afterEach(() => {
 if (REAL_HOME) process.env.HOME = REAL_HOME;
 rmSync(home, { recursive: true, force: true });
 clearRegisteredBuiltinPatterns();
});

describe("frida-size-app · slash command /size (#140)", () => {
 it("buildSizeAppPrompt arma el mensaje FR-7 (objeto literal con requeridos)", () => {
  expect(buildSizeAppPrompt(35000, "semi-detached", "MXN")).toBe(
   'Ejecuta el workflow \'size-app\' con los siguientes argumentos:\n{ wage: 35000, currency: "MXN", cocomoType: "semi-detached" }',
  );
  expect(buildSizeAppPrompt(45000.5, "organic")).toBe(
   'Ejecuta el workflow \'size-app\' con los siguientes argumentos:\n{ wage: 45000.5, cocomoType: "organic" }',
  );
 });

 it("la factory registra /size con descripción es-MX no vacía", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
   const pi = fakePi();
   registerBuiltinPattern(SIZE_APP_PATTERN);
   createFridaSizeApp({
    ensureDeps: noNetworkDeps(),
    ui: fakeUi({
     cocomo: "semi-detached (recomendado)",
     wage: "MXN $35,000",
    }),
   })(pi as unknown as ExtensionAPI);
   expect(pi.commands.has("size")).toBe(true);
   const desc = pi.commands.get("size")?.description ?? "";
   expect(desc.length).toBeGreaterThan(10);
   expect(desc).toMatch(/[áéíóúñ¿¡]|dimensionamiento|salario/);
   // Silencio del fire-and-forget rechazante (molde pattern.test.ts) —
   // el warn llegó antes del mockRestore.
   await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
     expect.stringContaining("instalación de scc falló"),
    ),
   );
  } finally {
   warn.mockRestore();
  }
 });

 it("armado completo MXN: 1 sendUserMessage exacto; args ignorados (D5)", async () => {
  const pi = fakePi();
  registerBuiltinPattern(SIZE_APP_PATTERN);
  registerSizeAppCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ cocomo: "semi-detached (recomendado)", wage: "MXN $35,000" }),
  );
  await pi.commands.get("size")?.handler("35000", fakeCtx());
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.text).toBe(
   'Ejecuta el workflow \'size-app\' con los siguientes argumentos:\n{ wage: 35000, currency: "MXN", cocomoType: "semi-detached" }',
  );
  expect(pi.sent[0]?.opts).toBeUndefined();
 });

 it("USD $6,000: wage 6000, currency USD, cocomoType organic literal", async () => {
  const pi = fakePi();
  registerBuiltinPattern(SIZE_APP_PATTERN);
  registerSizeAppCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ cocomo: "organic", wage: "USD $6,000" }),
  );
  await pi.commands.get("size")?.handler(undefined, fakeCtx());
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.text).toBe(
   'Ejecuta el workflow \'size-app\' con los siguientes argumentos:\n{ wage: 6000, currency: "USD", cocomoType: "organic" }',
  );
 });

 it("monto propio: InputBox numérico con decimales; sin currency (default USD del patrón, D15)", async () => {
  const pi = fakePi();
  registerBuiltinPattern(SIZE_APP_PATTERN);
  registerSizeAppCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ cocomo: "organic", wage: "monto propio", customWage: " 45000.50 " }),
  );
  await pi.commands.get("size")?.handler(undefined, fakeCtx());
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.text).toContain("wage: 45000.5");
  expect(pi.sent[0]?.text).not.toContain("currency");
  expect(pi.sent[0]?.text).toContain('cocomoType: "organic"');
 });

 it("no-idle: deliverAs followUp (seam git-sync index.ts:403-404)", async () => {
  const pi = fakePi();
  registerBuiltinPattern(SIZE_APP_PATTERN);
  registerSizeAppCommand(
   pi as unknown as ExtensionAPI,
   fakeUi({ cocomo: "embedded", wage: "USD $6,000" }),
  );
  await pi.commands.get("size")?.handler(undefined, fakeCtx(false));
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.opts).toEqual({ deliverAs: "followUp" });
  expect(pi.sent[0]?.text).toContain('cocomoType: "embedded"');
 });

 it("cancelación silenciosa FR-8: Esc en cocomoType o en wage → 0 envíos", async () => {
  for (const responses of [
   { cocomo: undefined, wage: "MXN $35,000" },
   { cocomo: "organic", wage: undefined },
  ]) {
   const pi = fakePi();
   registerBuiltinPattern(SIZE_APP_PATTERN);
   registerSizeAppCommand(pi as unknown as ExtensionAPI, fakeUi(responses));
   await pi.commands.get("size")?.handler(undefined, fakeCtx());
   expect(pi.sent).toHaveLength(0);
  }
 });

 it("cancelación silenciosa FR-8: Esc o Enter-vacío en el monto propio → 0 envíos, sin error", async () => {
  for (const customWage of [undefined, "", "   "]) {
   const pi = fakePi();
   registerBuiltinPattern(SIZE_APP_PATTERN);
   const { ui, errors } = fakeUiWithMessages({
    cocomo: "organic",
    wage: "monto propio",
    customWage,
   });
   registerSizeAppCommand(pi as unknown as ExtensionAPI, ui);
   await pi.commands.get("size")?.handler(undefined, fakeCtx());
   expect(pi.sent).toHaveLength(0);
   expect(errors).toHaveLength(0);
  }
 });

 it("monto propio inválido → error accionable D15, 0 envíos (coma, texto, 0, negativo)", async () => {
  for (const customWage of ["35,000", "abc", "0", "-5"]) {
   const pi = fakePi();
   registerBuiltinPattern(SIZE_APP_PATTERN);
   const { ui, errors } = fakeUiWithMessages({
    cocomo: "organic",
    wage: "monto propio",
    customWage,
   });
   registerSizeAppCommand(pi as unknown as ExtensionAPI, ui);
   await pi.commands.get("size")?.handler(undefined, fakeCtx());
   expect(pi.sent).toHaveLength(0);
   expect(errors).toHaveLength(1);
   expect(errors[0]).toContain("/size");
   expect(errors[0]).toContain("número > 0");
  }
 });

 it("guard D12: patrón ausente → warning accionable, 0 envíos", async () => {
  const pi = fakePi();
  const { ui, warnings } = fakeUiWithMessages({
   cocomo: "semi-detached (recomendado)",
   wage: "MXN $35,000",
  });
  registerSizeAppCommand(pi as unknown as ExtensionAPI, ui);
  await pi.commands.get("size")?.handler(undefined, fakeCtx());
  expect(pi.sent).toHaveLength(0);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("size-app");
  expect(warnings[0]).toContain("/reload");
 });
});
```

### src/extension.ts:1847-1862 — MODIFY

```ts
  for (const e of (ext.extensions ?? []).filter((e: any) => !e.hidden)) {
   const extLabel = extNameOf(String(e.path ?? ""));
   // #54: los comandos de módulos frida (toggles/base) van al acordeón de
   // Herramientas; aquí solo quedan los de extensiones externas.
   if (factoryEsModulo(extLabel)) continue;
   for (const name of Array.from(e.commands?.keys?.() ?? [])) {
    const n = String(name);
    if (!n || builtinNames.has(n)) continue;
    extCommands.push({
     name: n,
     // #140 (D9): el Map del SDK (Map<string, RegisteredCommand>)
     // expone description opcional — el "" hardcodeado dejaba TODO
     // comando de extensión sin descripción en el autocompletado "/"
     // del Composer y en Recursos > Comandos.
     description: String(e.commands?.get?.(n)?.description ?? ""),
     source: "extension",
     extension: extLabel,
    });
   }
  }
```

### webview/components/Welcome.tsx:15-51 — MODIFY

```tsx
// STARTER_CARDS (líneas :15-51) — SOLO se agregan las 3 cards de la Pista M
// al final del array, después de la card "explain-arch" y antes del cierre
// `];`. Las 4 existentes quedan byte-idénticas (D6: agregar sin tocar; FR-9).
// Molde: card insert aidd-plan (:16-24 — prompt con espacio final cuando el
// comando acepta args tras el nombre, D5). Iconos verificados en el set
// @vscode/codicons ^0.0.46 (window · remote-explorer · graph); Codicon mapea
// name → clase codicon-<name> (webview/components/Codicon.tsx:35-36).
 {
  id: "walkthrough",
  title: "Documentar una App",
  desc: "Recorre la app como usuario real y genera la documentación funcional (pantallas, journeys, reglas, roles).",
  iconName: "window",
  prompt: "/walkthrough ",
  actionType: "insert",
 },
 {
  id: "understand",
  title: "Entender el Código",
  desc: "Produce el entendimiento técnico del repo con evidencia: 7 preguntas del día 1, riesgos y modelo LikeC4.",
  iconName: "remote-explorer",
  prompt: "/understand",
  actionType: "insert",
 },
 {
  id: "size",
  title: "Dimensionar para Preventa",
  desc: "KLOC, COCOMO, deuda técnica y costo con salario mensual para la conversación de preventa.",
  iconName: "graph",
  prompt: "/size",
  actionType: "insert",
 },
```

### test/welcome.test.ts:23-30 — MODIFY

```ts
// Test de Starter Cards (:23-30) — reemplazo íntegro del test: el nombre
// "2x2" queda obsoleto con 7 cards (4ª fila con hueco cosmético; grid 2
// columnas se mantiene — Not Building). Se agregan los títulos de las 3
// cards nuevas (#140, D6) + un fragmento distintivo de cada desc; los
// asserts de las 4 existentes quedan intactos (regresión FR-9).
// Nota: renderToStaticMarkup no renderiza handlers — prompts y actionType
// insert se verifican en el smoke manual (canal composer_insert, estable
// desde su landed); la suite mantiene su patrón estático existente.
 it("renderiza las Starter Cards interactivas (4 base + 3 de la Pista M)", () => {
  const html = renderToStaticMarkup(React.createElement(Welcome, {}));
  expect(html).toContain("welcome-cards");
  // 4 existentes sin tocar (D6 — FR-9).
  expect(html).toContain("Planificar con AiDD");
  expect(html).toContain("Diseñar Pruebas (TEA)");
  expect(html).toContain("Auditar Codebase");
  expect(html).toContain("Explicar Arquitectura");
  // 3 nuevas de la Pista M (#140): título + fragmento del desc.
  expect(html).toContain("Documentar una App");
  expect(html).toContain("documentación funcional");
  expect(html).toContain("Entender el Código");
  expect(html).toContain("7 preguntas del día 1");
  expect(html).toContain("Dimensionar para Preventa");
  expect(html).toContain("COCOMO");
 });
```

### src/tools/frida-app-walkthrough/workflow.ts:100-104 — MODIFY

```ts
// validateAppWalkthroughArgs — SOLO cambia el throw de maxScreens ausente
// (alineación #140/D10: opciones del QuickPick de /walkthrough, byte-exactas
// vs MAX_SCREENS_OPTIONS de command.ts, + mención de la vía guiada;
// ask_user_question sigue siendo la vía primaria — el error lo lee el
// agente, que no puede abrir QuickPicks). El resto del validador queda
// igual.

 if (record.maxScreens === undefined) {
  throw new Error(
   'Patrón "app-walkthrough": falta args.maxScreens (entero 0-200; 0 = "todo"). Resuélvelo ANTES de lanzar — tras el launch la corrida es desatendida y no puede preguntar: pregunta el presupuesto al usuario con ask_user_question en la sesión principal (opciones: "10 pantallas (recomendado)" · "5 pantallas" · "25 pantallas" · "Todo (sin tope)" (= 0), o un número propio) y relanza el workflow con el valor resuelto — o sugiere al usuario el comando /walkthrough, que pregunta lo mismo con QuickPick.',
  );
 }
```

### src/tools/frida-understand-app/workflow.ts:101-105 — MODIFY

```ts
// validateUnderstandAppArgs — SOLO cambia el throw de maxHotspots ausente
// (alineación #140/D10: opciones del QuickPick de /understand, byte-exactas
// vs MAX_HOTSPOTS_OPTIONS de command.ts, + mención de la vía guiada;
// ask_user_question sigue siendo la vía primaria — el error lo lee el
// agente, que no puede abrir QuickPicks). El resto del validador queda
// igual.

 if (record.maxHotspots === undefined) {
  throw new Error(
   'Patrón "understand-app": falta args.maxHotspots (entero 0-100; 0 = "todo"). Resuélvelo ANTES de lanzar — tras el launch la corrida es desatendida y no puede preguntar: pregunta el presupuesto al usuario con ask_user_question en la sesión principal (opciones: "8 hotspots (recomendado)" · "15 hotspots" · "Todo (sin tope)" (= 0), o un número propio) y relanza el workflow con el valor resuelto — o sugiere al usuario el comando /understand, que pregunta lo mismo con QuickPick.',
  );
 }
```

### docs/how-to-frida-app-walkthrough.md — MODIFY

````markdown
<!-- #140 (Slice 6): alineación con los QuickPicks de /walkthrough. Se
     reemplazan SOLO los bloques listados; todo lo demás queda igual. -->

## Flujo típico — se reemplaza SOLO el bloque de código de la sección; el
párrafo posterior ("Al terminar tienes `docs/funcional/`…") queda intacto:

```text
1. Pre-autentica (una vez) — pídelo en el chat:
   Tú: "abre https://app.ejemplo.com en la sesión 'app-walkthrough'"
   → el agente corre agent_browser({ args: ["--session", "app-walkthrough",
       "open", "https://app.ejemplo.com"] })
   → TÚ inicias sesión en esa ventana (es tu navegador real)
2. Lanza el comando slash (vía guiada):
   Tú: /walkthrough https://app.ejemplo.com
   → QuickPick "¿Cuántas pantallas únicas documentar?" → "10 pantallas
      (recomendado)" · "5 pantallas" · "25 pantallas" · "Todo (sin tope)"
      (= maxScreens 0)
3. Lanzamiento — desatendido desde aquí:
   workflow({ name: "app-walkthrough",
              args: { url: "https://app.ejemplo.com", maxScreens: 10 } })
```

Bullet final de "Antes de empezar" (reemplazo del bullet "Una idea del
presupuesto…"):

- Una idea del presupuesto: ¿cuántas pantallas únicas esperas? (app mediana:
  20–50; el comando `/walkthrough` ofrece "10 pantallas (recomendado)" ·
  "5 pantallas" · "25 pantallas" · "Todo (sin tope)" = `0`).

### Paso 2 — Pide documentar la app (reemplazo íntegro):

```text
Tú: /walkthrough https://app.ejemplo.com
    (o en lenguaje natural: "documenta la app en https://app.ejemplo.com —
    ya inicié sesión en la sesión 'app-walkthrough'")
```

### Paso 3 — Responde el QuickPick de presupuesto (reemplazo íntegro; el
título cambia de "Responde la pregunta de presupuesto"):

`/walkthrough` abre: **¿Cuántas pantallas únicas documentar?** Elige
"10 pantallas (recomendado)", "5 pantallas", "25 pantallas" o
"Todo (sin tope)" (= `maxScreens: 0`). El presupuesto se pregunta ANTES
del launch porque tras el lanzamiento la corrida es desatendida (el único
checkpoint es el final, y es booleano). Si lo pediste en lenguaje natural,
el agente pregunta lo mismo con `ask_user_question`.

### Paso 4 — Lanzamiento (solo el ejemplo de código; antes maxScreens: 30):

```text
workflow({ name: "app-walkthrough",
           args: { url: "https://app.ejemplo.com", maxScreens: 10 } })
```

### Receta "Documentar una app por primera vez" (reemplazo íntegro):

```text
Tú: /walkthrough https://app.ejemplo.com
```

El comando pregunta el presupuesto (QuickPick), lanza el workflow y al final
resume: N pantallas en M pasos, decisión del juez y rutas de los entregables.
Si algo no quedó documentado (corte por presupuesto), el juez lo lista como
`CONCERNS` — relanza con un `maxScreens` mayor para ampliar.

### Receta "En otro idioma" (solo el ejemplo; antes maxScreens: 30):

```text
workflow({ name: "app-walkthrough", args: {
  url: "https://app.ejemplo.com", maxScreens: 10, language: "en-US" } })
```

### Receta "Corrida desatendida" (solo el ejemplo; antes maxScreens: 30):

```text
workflow({ name: "app-walkthrough", args: {
  url: "https://app.ejemplo.com", maxScreens: 10, review: "auto" } })
```

### Receta "Sobre una sesión que ya tenías con otro nombre" (solo el bloque
de código; antes maxScreens: 30):

```text
# pre-auth con ese nombre:
agent_browser({ args: ["--session", "demo-cliente", "open", "https://app.ejemplo.com"] })
# y el mismo nombre en args:
workflow({ name: "app-walkthrough", args: {
  url: "https://app.ejemplo.com", maxScreens: 10, session: "demo-cliente" } })
```
````

### docs/how-to-frida-understand-app.md — MODIFY

````markdown
<!-- #140 (Slice 6): alineación con el QuickPick de /understand. Se
     reemplazan SOLO los bloques listados; todo lo demás queda igual. -->

## Flujo típico — se reemplaza SOLO el bloque de código de la sección; el
párrafo posterior ("Al terminar tienes `docs/entendimiento/`…") queda
intacto:

```text
1. Pide entender el proyecto con el comando slash (o lenguaje natural):
   Tú: /understand
      (equivalente natural: "no conozco este proyecto — necesito entender
       dónde se autentica, quién llama a pagos y qué rompe si cambio la
       interfaz de pagos")
2. Presupuesto — /understand abre el QuickPick:
   "¿Cuántas áreas de riesgo (hotspots) explorar?" → "8 hotspots
   (recomendado)" · "15 hotspots" · "Todo (sin tope)" (= maxHotspots 0)
3. Lanzamiento — desatendido desde aquí:
   workflow({ name: "understand-app", args: { maxHotspots: 8 } })
```

Bullet final de "Antes de empezar" (reemplazo del bullet "Una idea del
presupuesto…"):

- Una idea del presupuesto: ¿cuántas áreas de riesgo esperas? (app mediana:
  5–15; el comando `/understand` ofrece "8 hotspots (recomendado)" ·
  "15 hotspots" · "Todo (sin tope)" = `0`).

### Paso 1 — Pide entender el proyecto (reemplazo íntegro):

```text
Tú: /understand
    (o en lenguaje natural: "entiende este proyecto: dónde se autentican
     los usuarios, quién llama al servicio de pagos y qué código está muerto")
```

El agente principal sabe que el presupuesto se pregunta ANTES del launch
(`maxHotspots` es requerido a propósito: tras el lanzamiento la corrida es
desatendida).

### Paso 2 — Responde el QuickPick de presupuesto (reemplazo íntegro; el
título cambia de "Responde la pregunta de presupuesto"):

`/understand` abre: **¿Cuántas áreas de riesgo (hotspots) explorar?**
Elige "8 hotspots (recomendado)", "15 hotspots" o "Todo (sin tope)"
(= `maxHotspots: 0`). El presupuesto se pregunta ANTES del launch porque
tras el lanzamiento la corrida es desatendida. Si lo pediste en lenguaje
natural, el agente pregunta lo mismo con `ask_user_question`; y si el repo
es grande, pide además un tope de tiempo (`maxMinutes`, default: sin tope).

### Paso 3 — Lanzamiento (solo el ejemplo; antes maxHotspots: 10,
maxMinutes: 90 — maxMinutes sale del flujo típico: no lo pregunta el
comando, D8):

```text
workflow({ name: "understand-app", args: { maxHotspots: 8 } })
```

### Receta "Entender un proyecto por primera vez" (reemplazo íntegro):

```text
Tú: /understand
```

El comando pregunta el presupuesto (QuickPick), lanza el workflow y al
final resume: N componentes, M hotspots, estado de las 7 preguntas y
decisión del juez.

### Recetas "En otro idioma" y "Corrida desatendida" (solo los ejemplos;
antes maxHotspots: 10):

```text
workflow({ name: "understand-app", args: { maxHotspots: 8, language: "en-US" } })
```

```text
workflow({ name: "understand-app", args: { maxHotspots: 8, review: "auto" } })
```
````

### docs/how-to-frida-size-app.md — MODIFY

````markdown
<!-- #140 (Slice 6): alineación con los QuickPicks de /size. Se reemplazan
     SOLO los bloques listados; todo lo demás queda igual. -->

"El modelo en 30 segundos" — punto 1 (reemplazo):

1. **Presupuesto antes del launch**: el comando `/size` pregunta el modo
   COCOMO y el salario mensual con QuickPicks — tras el lanzamiento la
   corrida es desatendida.

## Flujo típico — se reemplaza SOLO el bloque de código de la sección; el
párrafo posterior ("Al terminar tienes `docs/dimensionamiento/`…") queda
intacto (maxMinutes sale del flujo: no lo pregunta el comando, D8):

```text
1. Lanza el comando slash (vía guiada):
   Tú: /size
   → "¿Modo Basic COCOMO 81?" → "semi-detached (recomendado)" · "organic" ·
      "embedded"
   → "¿Salario MENSUAL por persona?" → "MXN $35,000" (wage 35000,
      currency "MXN") · "USD $6,000" (wage 6000, currency "USD") ·
      "monto propio" (InputBox numérico)
2. Lanzamiento — desatendido desde aquí:
   workflow({ name: "size-app",
              args: { wage: 35000, currency: "MXN",
                      cocomoType: "semi-detached" } })
```

Bullet final de "Antes de empezar" (reemplazo del bullet "Una idea del
salario mensual por persona para la pregunta de presupuesto."):

- Una idea del salario mensual por persona para el QuickPick de `/size`.

### Paso 1 — Pide el dimensionamiento (reemplazo íntegro):

```text
Tú: /size
    (o en lenguaje natural: "dimensiona esta app para una propuesta de
     mantenimiento")
```

### Paso 2 — Responde los QuickPicks de presupuesto (reemplazo íntegro; el
título cambia de "Responde las preguntas de presupuesto"):

`/size` abre primero **¿Modo Basic COCOMO 81?** ("semi-detached
(recomendado)" para mixed; "organic" para codebases pequeñas y conocidas;
"embedded" para críticas con restricciones duras) y luego
**¿Salario MENSUAL por persona?** ("MXN $35,000" / "USD $6,000" /
"monto propio" — InputBox numérico con punto decimal; "monto propio" sin
moneda deja el default `currency: "USD"`). Todo ANTES del launch — después
la corrida es desatendida. Si lo pediste en lenguaje natural, el agente
pregunta lo mismo con `ask_user_question` y puede añadir el tope de tiempo
(`maxMinutes`, default: sin tope).

Problemas frecuentes — fila de `args.wage` falta (reemplazo de la fila):

| `args.wage` falta (error eager) | el launch se hizo sin presupuesto | Relanza con `/size` (QuickPicks de modo y salario) o responde la pregunta del agente (MXN/USD/propio) — el error instruye cómo |
````

## Slices

### Slice 1: Molde slash command — frida-app-walkthrough (foundation)

**Files**: `src/tools/frida-app-walkthrough/command.ts`, `src/tools/frida-app-walkthrough/index.ts`, `test/frida-app-walkthrough/pattern.test.ts`, `test/frida-app-walkthrough/command.test.ts`

#### Automated Verification

- [ ] Type checking pasa: `npm run typecheck`
- [ ] Tests del pack pasan: `npx vitest run test/frida-app-walkthrough/`
- [ ] Stubs migrados (cero `{} as never`): `grep -c "{} as never" test/frida-app-walkthrough/pattern.test.ts` devuelve `0`
- [ ] command.ts sin vscode estático (guardián vitest): `grep -c "import \* as vscode" src/tools/frida-app-walkthrough/command.ts` devuelve `0`

#### Manual Verification

- [ ] Sesión viva (F5 del host): `/walkthrough https://app.ejemplo.com` abre el QuickPick "¿Cuántas pantallas únicas documentar?" con las 4 opciones del FRD; Esc en cualquier paso no envía nada (FR-8)
- [ ] Smoke e2e completo (mensaje → tool workflow → run en panel) diferido a la fase de validación (lesson 30ef616)

### Slice 2: Réplica — frida-understand-app

**Files**: `src/tools/frida-understand-app/command.ts`, `src/tools/frida-understand-app/index.ts`, `test/frida-understand-app/pattern.test.ts`, `test/frida-understand-app/command.test.ts`

#### Automated Verification

- [ ] Type checking pasa: `npm run typecheck`
- [ ] Tests del pack pasan: `npx vitest run test/frida-understand-app/`
- [ ] Stubs migrados (cero `{} as never`): `grep -c "{} as never" test/frida-understand-app/pattern.test.ts` devuelve `0`
- [ ] command.ts sin vscode estático (guardián vitest): `grep -c "import \* as vscode" src/tools/frida-understand-app/command.ts` devuelve `0`

#### Manual Verification

- [ ] Sesión viva (F5 del host): `/understand` abre el QuickPick "¿Cuántas áreas de riesgo (hotspots) explorar?" con las 3 opciones del FRD; Esc no envía nada (FR-8)
- [ ] Smoke e2e completo (mensaje → tool workflow → run en panel) diferido a la fase de validación (lesson 30ef616)

### Slice 3: Réplica — frida-size-app

**Files**: `src/tools/frida-size-app/command.ts`, `src/tools/frida-size-app/index.ts`, `test/frida-size-app/pattern.test.ts`, `test/frida-size-app/command.test.ts`

#### Automated Verification

- [ ] Type checking pasa: `npm run typecheck`
- [ ] Tests del pack pasan: `npx vitest run test/frida-size-app/`
- [ ] Stubs migrados (cero `{} as never`): `grep -c "{} as never" test/frida-size-app/pattern.test.ts` devuelve `0`
- [ ] command.ts sin vscode estático (guardián vitest): `grep -c "import \* as vscode" src/tools/frida-size-app/command.ts` devuelve `0`

#### Manual Verification

- [ ] Sesión viva (F5 del host): `/size` abre "¿Modo Basic COCOMO 81?" (3 opciones del FRD) y luego "¿Salario MENSUAL por persona?" (MXN $35,000 · USD $6,000 · monto propio); Esc en cualquier paso no envía nada (FR-8); monto propio inválido (p. ej. "35,000") muestra error accionable sin envío (D15)
- [ ] Smoke e2e completo (mensaje → tool workflow → run en panel) diferido a la fase de validación (lesson 30ef616)

### Slice 4: Fix del host — descripciones en autocompletado /

**Files**: `src/extension.ts`

#### Automated Verification

- [ ] Type checking pasa: `npm run typecheck`
- [ ] El push ya no hardcodea descripción vacía: `grep -c 'description: ""' src/extension.ts` devuelve `0`
- [ ] El push lee la descripción real del Map del SDK: `grep -c 'description: String(e.commands?.get?.(n)?.description ?? "")' src/extension.ts` devuelve `1`

#### Manual Verification

- [ ] Sesión viva (F5 del host): dropdown `/` del Composer — `/walkthrough`, `/understand` y `/size` (Slices 1-3) aparecen con su descripción es-MX visible, no vacía (mapeo `c.description`, `webview/App.tsx:262`)
- [ ] Recursos > Comandos: las mismas entradas muestran la descripción en la lista (`webview/components/ResourcesPanel.tsx:472-474`)
- [ ] Los 22 comandos built-in del host siguen mostrando su descripción igual que antes (regresión visual nula)

### Slice 5: Cards de Welcome

**Files**: `webview/components/Welcome.tsx`, `test/welcome.test.ts`

#### Automated Verification

- [ ] Type checking pasa: `npm run typecheck`
- [ ] Tests del Welcome pasan: `npx vitest run test/welcome.test.ts`
- [ ] Las 3 cards nuevas presentes: `grep -c "Documentar una App\|Entender el Código\|Dimensionar para Preventa" webview/components/Welcome.tsx` devuelve `3`
- [ ] Las 4 existentes intactas (regresión FR-9): `grep -c "Planificar con AiDD\|Diseñar Pruebas (TEA)\|Auditar Codebase\|Explicar Arquitectura" webview/components/Welcome.tsx` devuelve `4`
- [ ] Bundle rebuild refleja las cards: `npm run build:webview` exitoso y `grep -c "Documentar una App" dist-webview/assets/index-*.js` devuelve al menos `1`

#### Manual Verification

- [ ] Sesión viva (F5 del host): Welcome renderiza 7 cards — las 4 existentes idénticas + «Documentar una App» · «Entender el Código» · «Dimensionar para Preventa»; grid 2 columnas se mantiene (4ª fila con hueco cosmético — no se arregla, Not Building)
- [ ] Click en «Documentar una App» → el Composer recibe `/walkthrough` (con espacio final, D5) y toma foco, SIN enviar (insert ≠ submit); Enter abre el flujo del comando de los Slices 1-3 (InputBox de URL si no se escribió ninguna, luego QuickPick de maxScreens)
- [ ] Click en «Entender el Código» / «Dimensionar para Preventa» → inserta `/understand` / `/size` (sin espacio) sin enviar; Enter abre el QuickPick correspondiente
- [ ] `dist-webview/` rebuild commiteado junto a Welcome.tsx: `git status --porcelain dist-webview/` limpio tras el commit (los bundles se commitean — File Map)

### Slice 6: Alineación de textos — validadores y how-tos

**Files**: `src/tools/frida-app-walkthrough/workflow.ts`, `src/tools/frida-understand-app/workflow.ts`, `src/tools/frida-size-app/index.ts`, `docs/how-to-frida-app-walkthrough.md`, `docs/how-to-frida-understand-app.md`, `docs/how-to-frida-size-app.md`

#### Automated Verification

- [ ] Type checking pasa: `npm run typecheck`
- [ ] Suite completa del repo pasa (slice terminal, baseline del proyecto): `npm test`
- [ ] Validador walkthrough alineado — texto viejo fuera: `grep -c '"30 pantallas"' src/tools/frida-app-walkthrough/workflow.ts` devuelve `0`
- [ ] Validador walkthrough alineado — defaults FRD + comando: `grep -c '"10 pantallas (recomendado)"' src/tools/frida-app-walkthrough/workflow.ts` devuelve `1` y `grep -c '/walkthrough' src/tools/frida-app-walkthrough/workflow.ts` devuelve `1`
- [ ] Validador understand alineado — texto viejo fuera: `grep -c '"10 hotspots"' src/tools/frida-understand-app/workflow.ts` devuelve `0`
- [ ] Validador understand alineado — defaults FRD + comando: `grep -c '"8 hotspots (recomendado)"' src/tools/frida-understand-app/workflow.ts` devuelve `1` y `grep -c '/understand' src/tools/frida-understand-app/workflow.ts` devuelve `1`
- [ ] String args de size-app alineado: `grep -c 'sugiere el comando /size' src/tools/frida-size-app/index.ts` devuelve `1`
- [ ] How-to walkthrough alineado: `grep -c 'Tú: /walkthrough' docs/how-to-frida-app-walkthrough.md` devuelve al menos `2`, `grep -c '¿Cuántas pantallas únicas documentar?' docs/how-to-frida-app-walkthrough.md` devuelve al menos `2` y `grep -c 'maxScreens: 30' docs/how-to-frida-app-walkthrough.md` devuelve `0`
- [ ] How-to understand alineado: `grep -c 'Tú: /understand' docs/how-to-frida-understand-app.md` devuelve al menos `2`, `grep -c '¿Cuántas áreas de riesgo (hotspots) explorar?' docs/how-to-frida-understand-app.md` devuelve al menos `2` y `grep -c 'maxHotspots: 10' docs/how-to-frida-understand-app.md` devuelve `0`
- [ ] How-to size alineado: `grep -c 'Tú: /size' docs/how-to-frida-size-app.md` devuelve al menos `2`, `grep -c '¿Modo Basic COCOMO 81?' docs/how-to-frida-size-app.md` devuelve al menos `2` y `grep -c '¿Salario MENSUAL por persona?' docs/how-to-frida-size-app.md` devuelve al menos `2`

#### Manual Verification

- [ ] Error accionable residual en vivo (F5 del host): pedir en lenguaje natural "ejecuta el workflow app-walkthrough con url <https://app.ejemplo.com>" (sin maxScreens) → el error del validador nombra las opciones "10 pantallas (recomendado)" · "5 pantallas" · "25 pantallas" · "Todo (sin tope)" y sugiere /walkthrough; sesión intacta
- [ ] Ídem understand: mensaje sin maxHotspots → error nombra "8 hotspots (recomendado)" · "15 hotspots" · "Todo (sin tope)" y sugiere /understand
- [ ] Lectura cruzada de los 3 how-tos: las opciones citadas coinciden 1:1 con los QuickPicks de los comandos (Slices 1-3) y los ejemplos usan los defaults recomendados (maxScreens 10, maxHotspots 8, wage MXN 35000 + cocomoType semi-detached)

## Desired End State

Desde el chat de una sesión viva de Frida (transcript vacío → Welcome visible):

```text
Usuario teclea "/walk" → autocompletado "/": "/walkthrough — Documenta una app web usándola como usuario real (pantallas, journeys, reglas, roles)".
Enter → QuickPick "¿Cuántas pantallas únicas documentar?" → "10 pantallas (recomendado)" | "5 pantallas" | "25 pantallas" | "Todo (sin tope)" (= maxScreens 0).
(Si no escribió URL tras el comando) InputBox "URL de la app".
El chat recibe: "Ejecuta el workflow 'app-walkthrough' con los siguientes argumentos:
{ url: "https://app.ejemplo.com", maxScreens: 10 }"
→ el agente invoca el tool workflow → run visible en el panel de workflows.
```

```tsx
// Welcome: las cards nuevas aparecen en el grid (7 total, hueco cosmético en la 4ª fila)
const STARTER_CARDS: StarterCard[] = [
 // …4 existentes sin tocar…
 { id: "walkthrough", title: "Documentar una App", desc: "Recorre la app como usuario real y genera la documentación funcional (pantallas, journeys, reglas, roles).", iconName: "window", prompt: "/walkthrough ", actionType: "insert" },
 { id: "understand", title: "Entender el Código", desc: "Produce el entendimiento técnico del repo con evidencia: 7 preguntas del día 1, riesgos y modelo LikeC4.", iconName: "remote-explorer", prompt: "/understand", actionType: "insert" },
 { id: "size", title: "Dimensionar para Preventa", desc: "KLOC, COCOMO, deuda técnica y costo con salario mensual para la conversación de preventa.", iconName: "graph", prompt: "/size", actionType: "insert" },
];
```

```ts
// Esc en cualquier picker → NADA: sin mensajes, sin runs, sesión intacta (FR-8).
// Motor apagado (toggle) → showWarningMessage accionable, sin envío (D12).
```

## File Map

```
src/tools/frida-app-walkthrough/command.ts    # NEW — SlashPickUI + createDefaultPickUI (vscode lazy) + handler /walkthrough + registro
src/tools/frida-app-walkthrough/index.ts       # MODIFY — opts ui? + pi.registerCommand en setup + header Uso
test/frida-app-walkthrough/pattern.test.ts     # MODIFY — stub {} as never → fake registerCommand no-op
test/frida-app-walkthrough/command.test.ts     # NEW — registro / armado / cancelación (FR-8)
src/tools/frida-understand-app/command.ts      # NEW — ídem /understand (QuickPick 8·15·todo)
src/tools/frida-understand-app/index.ts        # MODIFY — ui? en CreateFridaUnderstandAppOptions + registro
test/frida-understand-app/pattern.test.ts      # MODIFY — stub
test/frida-understand-app/command.test.ts      # NEW
src/tools/frida-size-app/command.ts            # NEW — ídem /size (cocomo + wage)
src/tools/frida-size-app/index.ts              # MODIFY — ui? en CreateFridaSizeAppOptions + registro + string args
test/frida-size-app/pattern.test.ts            # MODIFY — stub
test/frida-size-app/command.test.ts            # NEW — HOME aislado + ensureDeps rechazante
src/extension.ts                               # MODIFY — extCommands: description real (:1855-1857)
webview/components/Welcome.tsx                 # MODIFY — 3 cards insert (4→7)
test/welcome.test.ts                           # MODIFY — títulos nuevos
src/tools/frida-app-walkthrough/workflow.ts    # MODIFY — texto de error maxScreens alineado (10/5/25/todo)
src/tools/frida-understand-app/workflow.ts     # MODIFY — texto de error maxHotspots alineado (8/15/todo)
docs/how-to-frida-app-walkthrough.md           # MODIFY — defaults + comando /walkthrough
docs/how-to-frida-understand-app.md            # MODIFY — defaults + comando /understand
docs/how-to-frida-size-app.md                  # MODIFY — comando /size
dist-webview/                                 # REBUILD (npm run build:webview) — se commitea junto a Welcome.tsx
```

## Ordering Constraints

- Slice 1 ANTES que 2-3 (establece el molde que replican). 2 y 3 entre sí son independientes (podrían paralelizarse).
- Slices 1-3 ANTES que 4-6 (el fix del host y las cards/how-tos presuponen comandos existentes).
- Slice 5 (cards) y 6 (textos) independientes entre sí.
- Dentro de cada slice de pack: `command.ts` → `index.ts` → tests (el registro incondicional del index rompe los stubs viejos, tests van juntos).
- Commit atómico final: handlers + cards + how-tos + stubs + tests + dist-webview juntos (lesson 1ff6b0e/34d496a).

## Verification Notes

- Smoke REAL por comando en fase de validación (los mocks no validan el AC principal — lesson 30ef616): 1 envío → 1 invocación del tool `workflow` → run visible en el panel. Requiere sesión viva con la app desplegada.
- Esc en CADA paso del picker por pack (FR-8; el repo ya se quemó con cancelación diferida — 1522bf1).
- `npm test` completo tras cualquier toque de wiring (guardián: un import estático de vscode en un index.ts de pack rompe las suites pattern.test.ts).
- Grep de formato del mensaje: los tests de armado asertan exactamente 1 `sendUserMessage` con `Ejecuta el workflow '<name>' con los siguientes argumentos:` y args resueltos ("todo" → `0`).
- Comandos visibles con descripción: abrir el dropdown `/` en el webview y verificar descripción no vacía (tras el fix del host).
- `git status` limpio de `dist-webview/` tras el rebuild (los bundles se commitean).
- Selector de la sesión: los handlers viven solo en la sesión principal (sesiones hijas sin packs — `createChildSession` `src/pi-session.ts:201`).
- El `/reload` re-corre las factories y re-registra comando+patrón juntos (idempotente por nombre).

## Performance Considerations

- Handlers ligeros: 1-2 QuickPicks + 1 `findBuiltinPattern` (Array.find sobre ~10 patrones) + 1 envío fire-and-forget void. Sin hot paths, sin N+1, sin I/O nueva.
- La descarga fire-and-forget de scc en el setup de size-app sigue sin bloquear el loader (D2 de M10 intacto).

## Migration Notes

No aplica: no hay schema persistido ni datos existentes que migrar. Los comandos son aditivos; el registro es idempotente por nombre (`builtin-patterns.ts:481-484`).

## Pattern References

- `src/tools/frida-cc-plugins/presenter.ts:14-33` — interfaz UI + default vscode en archivo propio del pack ("no la importen los tests"). Base de cada `command.ts`.
- `src/tools/frida-cc-plugins/index.ts:62-88` — opts con inline type import (`presenter?: import("./presenter").CcPluginsPresenter`). Base de `ui?` en las factories.
- `src/worktree/command.ts:56-111` — `WorktreeUI` + `createVscodeWorktreeUI()` (firmas `Promise<string | undefined>` = Esc limpio; wrappers exactos de `showInputBox/showQuickPick`).
- `src/tools/frida-git-sync/index.ts:141-158` — `pi.registerCommand` con `description` + `async handler(args, ctx)` en el setup, `pi` en closure.
- `src/tools/frida-git-sync/index.ts:402-404` — seam de envío con gate `ctx.isIdle()` → `deliverAs: "followUp"` (replicar literal).
- `src/extension.ts:4447-4497` — `postWfCommand`: parseo por tokens, InputBox estilo aidd-plan (`:4465`), formato del mensaje (`:4468/:4471-4472`).
- `src/tools/frida-goal/runtime.ts:75/:118` — closure `pi` + `sendUserMessage` diferido al handler.
- `webview/components/Welcome.tsx:15-51` — `STARTER_CARDS` + card insert con espacio final (`:22`).
- `test/frida-cc-plugins/presenter.test.ts:59-86` — molde `fakePi` (captura `registerCommand` en Map + invocación del handler).
- `test/frida-goal/goal-runtime.test.ts:12-50` — molde captura de `sendUserMessage`.
- `test/frida-size-app/pattern.test.ts:48-62/:103-105` — HOME aislado + `ensureDeps` rechazante + `vi.spyOn(console, "warn")`.

## Developer Context

**Q (design, confirm direccional): voy a propagar el molde "interfaz UI + default vscode en archivo propio del pack" (`src/tools/frida-cc-plugins/presenter.ts:14-33`, usado ×1) a los 3 packs M — infra genérica triplicada (~120 líneas). ¿Por-pack o módulo compartido?**
A: "Por-pack (×3)" — autonomía del pack, molde presenter/WorktreeUI; sin acoplamiento nuevo entre packs. (D4)

**Q (design, ambigüedad): ¿los comandos aceptan argumentos escritos tras el nombre? El molde `/wf` (`src/extension.ts:4452-4460`) usa el texto como input y la card insert `"/walkthrough "` con espacio presupone leer la URL ahí.**
A: "Solo URL en walkthrough" — `args?.trim()` = URL con fallback InputBox; maxScreens SIEMPRE QuickPick; understand/size ignoran args (QuickPicks siempre). Cards: `"/walkthrough "` con espacio; `"/understand"` `"/size"` sin. (D5)

**Q (design): resumen presentado (3 handlers por-pack con SlashPickUI, delegación al chat, 3 cards, fix host, alineación textos, tests fakePi). ¿Proceder a descomposición?**
A: "Proceder".

**Q (design): 6 slices (1 molde walkthrough foundation, 2-3 réplicas, 4 fix host, 5 cards, 6 textos+baseline terminal). ¿Aprobar?**
A: "Aprobar".

**Q (design, micro-checkpoint Slice 5): 3 cards insert byte-idénticas al Desired End State (`webview/components/Welcome.tsx:15-51`, molde aidd-plan :16-24, iconos verificados en el set real de @vscode/codicons) + test extendido con títulos y fragmentos de descs (`test/welcome.test.ts:23-30`, patrón renderToStaticMarkup intacto); verificador OK/OK/WARNING cosmético conciliado. ¿Aprobar?**
A: "Approve".

**Q (design, micro-checkpoint Slice 6): alineación de textos — 2 mensajes de error con opciones FRD byte-exactas (`workflow.ts:102`/`:103`) + comandos como alternativa, string args de size-app con vía /size (`index.ts:119-120`), 3 how-tos espejo (flujos/pasos/recetas, 5/5 sitios de `maxScreens: 30`, 4/4 de `maxHotspots: 10`, maxMinutes fuera de flujos por D8); verificador ronda 2 OK/OK/OK + WARNING cosmético (counts de títulos en exactamente 2). ¿Aprobar?**
A: "Approve".

Contexto heredado del research (Q/As del checkpoint de research, decisiones fijas — no re-preguntadas): seam de lanzamiento delegado al chat; handler por-pack; `vscode.window` para QuickPicks; cards insert; solo los 3 comandos del issue; pre-autenticación la maneja M8; nombres EN cortos con descripciones es-MX; solo args requeridos; cards agregar sin tocar; fix del host incluido; defaults FRD ganan; adapter UI inyectable para tests.

## Design History

- Slice 1: Molde slash command — frida-app-walkthrough (foundation) — approved as generated (verificador OK/OK/WARNING cosmético: prosa conciliada a createDefaultPickUI y labels reales del pick)
- Slice 2: Réplica — frida-understand-app — approved as generated (verificador OK/OK/WARNING cosmético: heading del pattern.test.ts corregido a :250-309)
- Slice 3: Réplica — frida-size-app — approved as generated (verificador OK/OK/WARNING cosmético: headings corregidos a index.ts:11-12,141-151,172-201 y pattern.test.ts:353-505; `npm test` completo diferido al slice terminal por descomposición aprobada)
- Slice 4: Fix del host — descripciones en autocompletado / — approved as generated (verificador OK/OK/WARNING cosmético: cita del criterio manual corregida a ResourcesPanel.tsx:472-474; heading reconciliado a :1847-1862 — loop real en disco)
- Slice 5: Cards de Welcome — approved as generated (verificador OK/OK/WARNING cosmético: heading del test reconciliado a :23-30, cita Codicon.tsx:35-36, criterio manual InputBox-vs-QuickPick del flujo /walkthrough; comentario JSX "2x2" huérfano cubierto por Not Building)
- Slice 6: Alineación de textos — validadores y how-tos — approved as generated (verificador ronda 1: 3 VIOLATIONS — recetas maxScreens: 30 :204/:216 no cubiertas, 2 grep-counts insatisfacibles, anclaje "Flujo típico íntegro" ambiguo — corregidas; ronda 2: OK/OK/OK + WARNING cosmético: counts de títulos de pick en exactamente 2, sin margen para ediciones futuras)

## References

- Research: `.rpiv/artifacts/research/2026-08-28_18-01-10_pista-m-slash-commands-welcome.md`
- FRD (discover): `.rpiv/artifacts/discover/2026-08-28_17-29-53_pista-m-slash-commands-welcome.md` (issue #140)
- Research M10: `.rpiv/artifacts/research/2026-08-27_06-28-43_m10-size-app.md`
- Validación M8: `.rpiv/artifacts/validation/2026-08-24_18-09-01_m8-skill-pack-frida-app-walkthrough.md`
- Validación M10: `.rpiv/artifacts/validation/2026-08-28_08-05-45_m10-size-app.md`
