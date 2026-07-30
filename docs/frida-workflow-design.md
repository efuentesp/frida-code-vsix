# Diseño — `frida-workflow` (porte nativo del motor de rpiv-workflow)

> **Estado:** ✅ **MOTOR COMPLETO** (Fases 0–8 implementadas, 243 tests en verde).
> Formalizado como **ADR-0020** + entrada **D32** en
> `CONTEXT.md`. Sigue la convención de D14/D15/D27/D28 (porte nativo, no cargar paquetes rpiv).
>
> Toma como referencia `@juicesharp/rpiv-workflow@2.1.0` (características + diseño interno)
> pero se implementa **nativamente** contra el modelo de sesiones/webview de Frida.

---

## 0. Decisiones fijadas (de las preguntas previas)

| Eje | Decisión |
| --- | --- |
| Estrategia | **Porte nativo** en `src/tools/frida-workflow/` (0 dependencias npm nuevas; reusa `createAgentSession` del SDK ya embebido) |
| Ejecución | **Sesiones hijas desprendidas** — cada etapa corre en su propio `AgentSession` en background; el chat principal queda usable |
| Alcance | **Paridad completa** con rpiv-workflow (loops, judges, verify, panel, collectors, skill-contracts) |
| UI | **Panel `fridaWeb` persistente** (footer/overlay) alimentado por los eventos de lifecycle |

No reabre **ADR-0005** (no se carga ninguna extensión ajena): es código propio en `src/`,
como `todo-web`, `frida-context` y `frida-permission-system`.

---

## 1. Glosario (reutiliza el de rpiv, adaptado)

- **Workflow** — grafo tipado: `name`, `start`, `stages`, `edges`.
- **Stage** — nodo del grafo. `kind: "produces" | "side-effect"`. Factorías `produces()`/`acts()`/`terminal()`.
- **Run** — una ejecución: `runId` + JSONL append-only (registro del que se resucita) + estado en memoria.
- **Output** — `{ kind, data, artifacts, meta }` que una etapa pasa abajo. Lo que leen routing/etapas downstream.
- **Outcome** — `{ name?, collector, parser? }`: cómo se construye el `Output` desde la sesión hija (collector enumera artefactos; parser interpreta).
- **spawnChild** — abrir una sesión hija desprendida (fresh / reattach / fork) y correr un prompt en ella.
- **Named channel** — `state.named[key][]`: registro de publicación; `reads`/`fanin` consumen de él.

---

## 2. Mapa de módulos (espejo del de rpiv, frida-flavored)

```
src/tools/frida-workflow/
├── index.ts                  # factory createWorkflowExtension(pi) — registra /wf + monta host
├── dsl/
│   ├── define.ts             # defineWorkflow (passthrough de tipos, 0 costo runtime)
│   ├── stages.ts             # produces / acts / terminal (+ .script / .prompt accessors)
│   ├── routing.ts            # gate / match / defineRoute + gt/gte/lt/lte/eq
│   ├── loops.ts              # fanout / iterate / assess + verify + judge + panel + majority/all/any
│   └── outcomes.ts           # collectors + parsers + defineCollector/defineParser + handles (fs/url/opaque/inline)
├── types.ts                  # Workflow, StageDef, Output, OutputSpec, LoopDef, Judge, Edge…
├── host.ts                   # FridaWorkflowHost: impl de WorkflowHostContext (spawnChild/maxConcurrency) ← EL CRUCE
├── child-session.ts          # createFridaChildSession(): AgentSession hija reutilizando el núcleo de pi-session.ts
├── runner/
│   ├── runner.ts             # runWorkflow / resumeWorkflow — travesía del grafo
│   ├── run-stage.ts          # sesión + extracción + validación + fila JSONL
│   ├── chain-advance.ts      # aplica edges / routing
│   ├── preflight.ts          # skill-registry check + named-reads check
│   ├── resume.ts             # reconstruye RunState del JSONL
│   ├── loops/                # fanout (waves Kahn) / iterate / assess / verify / panel
│   └── script-stage.ts       # etapas sin modelo
├── audit/
│   ├── jsonl.ts              # append-only: header + filas stage/route/loop/failure
│   ├── names.ts              # --name → runId index
│   └── readers.ts            # listRuns / readLastStage / listArtifacts (públicos)
├── state/
│   ├── state.ts              # RunState (named[], primaryArtifact, visited, termination…)
│   ├── names.ts              # registro named-publish + reads/fanin
│   └── paths.ts              # childSessionsDir + runs dir (globalStorageUri)
├── load/
│   ├── layers.ts             # built-in ← user ← project (merge por nombre)
│   ├── loader.ts             # jiti (dep transitiva) sobre config.ts / packs/*.ts
│   ├── alias.ts              # skillAliases (remap antes de validar)
│   └── resolve-default.ts
├── validate/
│   ├── graph.ts              # BFS alcanzabilidad + dangling edges
│   ├── stage-rules.ts        # produces-requires-outcome, loop×continue, reads-publicado…
│   └── contract-compat.ts    # skill-contracts (consumes/produces)
├── lifecycle.ts              # 12 hooks (onWorkflowStart…onWorkflowEnd) + registro
├── command.ts                # handler de /wf (parse: preview / run / @resume / --name)
├── store.ts                  # store reactivo del panel (useSyncExternalStore, como todo-web)
└── WorkflowPanel.tsx         # UI fridaWeb persistente (grafo de etapas + estado en vivo)
```

**Principio de capas (igual que rpiv):** `dsl/` y `validate/` no importan nada de Pi;
`runner/` solo toca el *port* `host.ts` (nunca tipos de `pi-coding-agent`); el núcleo
reutilizable de Frida vive en `child-session.ts`. Esto deja la mayor parte **testeable
sin arrancar el SDK** (igual que rpiv funciona sin rpiv-pi).

---

## 3. El cruce: `FridaWorkflowHost` (el `spawnChild`)

Es la pieza que más cambia respecto al TUI. rpiv delega el executor en `rpiv-pi`
(`SdkWorkflowHost`, que es TUI-específico: taps de teclas, lane dock Ink). Frida lo
implementa **directamente** contra `createAgentSession` ya embebido.

### 3.1 El port (isomorfo al de rpiv, sin tipos de Pi en la superficie)

```ts
// host.ts — Frida implementa esto; el runner solo consume el port.
export interface WorkflowSessionContext {
  sendUserMessage(content: string): Promise<void>;
  getBranch(): unknown;        // transcript de la hija → lo leen los collectors
  getSessionId(): string;
  getSessionFile(): string | undefined;
  waitForIdle(): Promise<void>;
  abort(): Promise<void>;
  toolTimeout?(): { reason: string } | undefined;
}

export interface FridaWorkflowHost {
  cwd: string;
  maxConcurrency: number;       // 1 ⇒ secuencial (loops fanout usan min(concurrency, max))
  signal?: AbortSignal;
  spawnChild<T>(opts: {
    prompt: string;
    model?: ModelSelection;
    signal?: AbortSignal;
    reattach?: { sessionFile: string };   // abrir sesión persistida in-place
    fork?: { sessionFile: string };        // sessionPolicy: "continue"
    unitIndex?: number;                    // hint de lane (ignorado por ahora)
    withSession: (child: WorkflowSessionContext) => Promise<T>;
  }): Promise<T>;
}
```

### 3.2 `spawnChild` → `createFridaChildSession`

El secreto: **refactorizar `src/pi-session.ts`** para separar (a) lo *compartido* de la
sesión interactiva del webview y (b) el *núcleo de construcción* reutilizable por hijas.

```ts
// child-session.ts
export async function createFridaChildSession(
  shared: FridaSessionShared,      // modelRuntime, settingsManager, agentDir, cwd,
                                   //   ApprovalBridge, UiBridge, WebBridge, getMode,
                                   //   gatePatterns, approvalLogger, gateStats…
  opts: {
    prompt: string;
    model?: ModelSelection;
    sessionKind: "fresh" | { reattach: string } | { fork: string };
    signal?: AbortSignal;
  },
): Promise<{ session: AgentSession; sessionManager: SessionManager }> {
  // 1) SessionManager según sessionKind:
  //    fresh   → SessionManager.create(cwd, childSessionDir)
  //    reattach→ SessionManager.open(sessionFile, childSessionDir, cwd)
  //    fork    → SessionManager.forkFrom(sourcePath, cwd, childSessionDir)
  //    (las 3 existen en el SDK — verificado: session-manager.js)
  //
  // 2) childSessionDir = <globalStorageUri>/workflows/<encoded-cwd>/<runId>/sessions/
  //
  // 3) Loader HIJO: mismas skills/prompts/provider que el padre (shared.resourceLoader
  //    ya los cargó) + las MISMAS factories de gates/bridges, atadas a los bridges
  //    COMPARTIDOS (ApprovalBridge/UiBridge/WebBridge del webview).
  //
  // 4) createAgentSession({ resourceLoader: childLoader, modelRuntime, model, … })
  //    + session.bindExtensions({ uiContext: shared.uiContext, mode: "rpc" })
  //
  // 5) si sessionKind !== reattach/fork → session.prompt(opts.prompt)
  //    subscribir, esperar waitForIdle(), resolver.
}
```

`spawnChild` queda entonces: `createFridaChildSession(...)` → adapta la `session` al
`WorkflowSessionContext` del port → invoca `withSession(child)`.

### 3.3 ⚠️ Gates en sesiones hijas (paridad de seguridad — lo más importante)

**Problema:** las etapas ejecutan `bash`/`edit`/`write` en sesiones hijas *desprendidas*.
Si esas sesiones no pasan por el gate de aprobación, un workflow puede correr `rm -rf`
sin visto bueno → **rompe el postulado disuasivo de ADR-0001/D7**.

**Solución:** el loader de la sesión hija **reusa la factory `createPermissionSystem`
atada al MISMO `ApprovalBridge`** del webview. El `ApprovalBridge` ya es un `Map` de
peticiones pendientes y soporta concurrencia (varias hijas pueden tener gates en vuelo
a la vez; el webview las muestra como tarjetas/`ApprovalDialog` Remote React, igual que
hoy). `toolTimeout`/watchdog no aplica en hijas (no hay wall-clock por comando del TUI);
se omite y todo abort queda como abort plano.

> **Consecuencia deseada:** una etapa que quiera hacer `bash` pausa hasta que el usuario
> apruebe en el panel — exactamente como en el chat. El disuasivo se preserva.

### 3.4 `sessionPolicy: "continue"`

`fork: { sessionFile }` → `SessionManager.forkFrom(sourcePath, cwd, childSessionDir)`:
abre una hija **nueva** que hereda el transcript completo de la predecesora, sin mutar el
archivo fuente (DAG-fork-safe). El SDK ya lo soporta. El runner manda la continuación por
`sendUserMessage` (no re-envía `prompt`).

---

## 4. Comando `/wf` en el composer de Frida

`extension.ts` ya intercepta slash commands (`BUILTIN_SLASH`). Se añade `"wf"`:

| Forma | Comportamiento |
| --- | --- |
| `/wf` | Preview de todos los workflows cargados (overlay fridaWeb) |
| `/wf <nombre>` | Preview del grafo de ese workflow |
| `/wf <nombre> <input>` | **Lanza desprendido**: monta `WorkflowPanel`, spawnea el run, devuelve el prompt al instante |
| `/wf <input>` | Run del workflow default |
| `/wf @<ref>` | Resume (run-id / `--name` / path `.jsonl`) |
| `/wf … --name <slug>` | Alias humano (sólo token inicial/final; en medio se ignora con warning) |

Como las etapas corren en hijas, `/wf` **no bloquea el chat** — el usuario sigue trabajando
mientras el workflow avanza en background y el panel refleja el estado.

---

## 5. Layout de archivos (frida-flavored, no `.rpiv`)

```
<cwd>/.frida/workflows/
├── config.ts                 # config del proyecto (hand-edited, jiti)
└── packs/*.ts                # bundles instalables

~/.frida/workflows/
├── config.ts                 # config de usuario
└── packs/*.ts

<globalStorageUri>/workflows/<encoded-cwd>/runs/
├── <run-id>.jsonl            # audit append-only (header + filas)
├── names.json                # --name → run-id
└── <run-id>/sessions/        # transcripciones JSONL de las sesiones hijas
```

**Por qué `globalStorageUri` para runs (no `cwd`):** paridad con D13 (sesiones desacopladas
del agentDir y del repo). Un trail de run **no debe commitearse** (lleva artefactos/rutas
del proyecto del dev). `<encoded-cwd>` (como `SessionManager` codifica el cwd en su dir de
sesiones) asocia runs al workspace sin ensuciar el repo. `XDG_CONFIG_HOME` no aplica (Frida
usa `~/.frida`).

**Carga:** `jiti` (dependencia **transitiva** — pi-coding-agent la usa para skills/extensiones;
verificado). Soporta `.ts` sin build step, igual que rpiv. `.json` también, como fallback.

**Capas (merge por nombre, config > packs dentro de cada capa):**
`built-in (registerBuiltIns) ← user packs ← user config ← project packs ← project config`.
`skillAliases` sólo en config (packs no pueden); `default` en cascada project > user > primero.

---

## 6. Audit JSONL + Resume

Espejo fiel de rpiv (es el subsystem más valioso y el mejor testado):

- **Header** `{ runId, workflow, input, ts, v: 2, trigger, name? }` — `v` = `STATE_SCHEMA_VERSION`; mismatch en resume → rechazo (sin migración in-place).
- **Filas:** `stage` (éxito/retry/fallo/abort), `route` (con `note` si no-match), `loop-cap`, `failure`. Cada una **tras** persistirse dispara su evento de lifecycle.
- **`state.named[key][]`** — arrays; `reads` lee `.at(-1)`, `fanin(name)` lee todo (fan-in barrier).
- **Resume:** `/wf @<ref}` reconstruye `RunState` plegando el trail; re-entra en el paso pendiente; las unidades ya completas se **replay** desde el output journalizado (no se re-corren). Contrato de determinismo: `units()`/`next()`/`done()`/`feedForward` se recomputan al replegar y deben coincidir con lo grabado, si no → rechazo terminal (no re-corre unidades equivocadas).
- **Run caps:** `maxIterations` (32), saltos hacia atrás (2 por destino stage).

---

## 7. UI — `WorkflowPanel` (fridaWeb persistente)

Patrón idéntico a `todo-web` (D23/ADR-0014) y `frida-context` (D27):

- `store.ts` — store reactivo (`setWorkflowState` **emite**); el componente consume con `useSyncExternalStore` → re-render solo ante cada mutation.
- `WorkflowPanel.tsx` — se monta con `WebBridge.mountPersistent(factory, "footer")` al iniciar un `/wf` y se desmonta al `onWorkflowEnd`.
- **Alimentación:** `registerLifecycle({ onStageStart, onStageEnd, onUnitStart, onUnitEnd, onRoute, onLoopCap, onStageError, onWorkflowEnd })` → cada hook muta el store. Como en rpiv, disparan **después** de su fila JSONL.
- **Republish tras recarga del webview:** `WebBridge.republish()` (D23) re-publica el último árbol; el estado se reconstruye del JSONL.

**Render propuesto:**

```
┌─ workflow: ship ── [⟳ corriendo · etapa 2/3] ────────┐
│ ✓ research    planes/auth.md        sesion-A · 4 tools │
│ ⟳ plan        (turno 2/3)           sesion-B · gate ▸  │  ← gate pendiente → ApprovalDialog
│ ○ commit      pendiente                                  │
│                                                        │
│ [▷ reanudar]  [✕ abortar]  [ver runs]                  │
└────────────────────────────────────────────────────────┘
```

- Estado por etapa/unidad: `○ pendiente · ⟳ corriendo · ✓ ok · ✗ fallo · ⏸ gate`.
- Click en una etapa → abre su sesión hija (nice-to-have: reattach en una pestaña).
- Los gates de las hijas aparecen como `ApprovalDialog` (Remote React, ya existen) sobre el panel.

---

## 8. Matriz de paridad (qué porta y de dónde)

| Feature rpiv | Origen (fichero rpiv) | Destino frida | Notas |
| --- | --- | --- | --- |
| `defineWorkflow` / DSL | `stage-def.ts`, `routing-dsl.ts`, `loop-def.ts` | `dsl/` | Copiar tipos + factorías; **0 deps** |
| `produces/acts/terminal` + `.script/.prompt` | `stage-def.ts`, `built-ins.ts` | `dsl/stages.ts` | Igual |
| `gate/match/defineRoute` + helpers | `routing-dsl.ts`, `predicates.ts` | `dsl/routing.ts` | `note` en no-match |
| `fanout/iterate/assess` + `verify` + `judge` + `panel` | `loop-kinds.ts`, `loops/*` | `dsl/loops.ts` + `runner/loops/` | Waves Kahn, fold canónico |
| Collectors (transcript/tool/FS-diff/git/union) + parsers | `outcomes/` | `dsl/outcomes.ts` | FS-diff ya usa `git status` (Frida ya lo corre en el host) |
| Schemas (Standard Schema v1) | `validate-output.ts`, `typebox-adapter.ts` | `validate/` | TypeBox ya es dep transitiva |
| JSONL audit + resume | `audit.ts`, `runner/resume.ts`, `state/` | `audit/` + `state/` + `runner/resume.ts` | Paths bajo globalStorage |
| Carga por capas + alias | `load/` | `load/` | jiti (transitiva) |
| Lifecycle (12 hooks) | `events.ts`, `registration.ts` | `lifecycle.ts` | Hooks → store del panel |
| **Host / spawnChild** | `host.ts` (port) + rpiv-pi (impl) | **`host.ts` + `child-session.ts`** | ← lo único realmente nuevo |
| Skill-contracts | `skill-contracts/`, `validate/contract-compat.ts` | `validate/contract-compat.ts` | adjudica composición en carga |
| `/wf` command | `command.ts`, `command-run.ts` | `command.ts` | Hook en `BUILTIN_SLASH` de Frida |
| Preview | `preview.ts` | overlay fridaWeb | |

**Lo único que no existe en rpiv y sí aquí:** el `FridaWorkflowHost` (rpiv lo externaliza a
rpiv-pi). Todo lo demás es porte/adaptación de paths.

---

## 9. Refactor previo en `pi-session.ts`

Hoy `createFridaSession` construye loader + bridges + sesión interactiva en uno. Para que
las hijas reusen el núcleo, separar:

```ts
// pi-session.ts — extraer lo compartible
export interface FridaSessionShared {
  modelRuntime: ModelRuntime;
  settingsManager: SettingsManager;
  agentDir: string; cwd: string;
  resourceLoader: DefaultResourceLoader;   // skills/prompts/provider ya cargados
  bridge: ApprovalBridge;     uiBridge: UiBridge;   webBridge: WebBridge;  // COMPARTIDOS
  uiContext: ExtensionUIContext;
  getMode; getGatePatterns; approvalLogger; gateStats; sessionApprovals;
  // …callbacks al webview (onPendingApprovals, onUiRequest, onWebCommit, onLensDiagnostics…)
}

export async function createFridaSession(opts): Promise<FridaSession> {
  const shared = buildShared(opts);     // lo que hoy está inline
  const interactive = await buildInteractiveSession(shared, opts);
  return { ...shared, ...interactive };
}
```

`createFridaChildSession(shared, …)` construye entonces un loader **hijo** que reusa las
skills del `shared.resourceLoader` + las **mismas** factories de gates/bridges atadas a los
bridges compartidos. Así `pi-session.ts` no se duplica y las hijas heredan gates/UI.

> **Detalle del loader hijo (confirmado por spike Fase 0):** `DefaultResourceLoader` no
> guarda estado por sesión (sin campos `session`/`sessionId`/`activeSession`), así que se
> **reusa directamente** la MISMA instancia del padre en cada hija — sin clonar, sin recargar
> skills. Ver `test/frida-workflow/spike-fase0.test.ts` (Q1). No se recrea `ModelRuntime` ni
> se recargan skills (caro). Cada hija sólo necesita su propio `SessionManager`.

---

## 10. Riesgos y puntos a verificar

> ✅ **Fase 0 SUPERADA** (`test/frida-workflow/spike-fase0.test.ts`, 3/3 verde). Las tres
> preguntas go/no-go quedaron resueltas empíricamente:
>
> - **Q1 — `resourceLoader` compartido:** 2 `AgentSession` offline reusan la MISMA instancia
>   del loader; crear la segunda no corrompe la primera; las skills cargan. Es un loader
>   puro reutilizable (confirmado por inspección: 0 campos de sesión).
> - **Q2 — `SessionManager.forkFrom` in-process:** filesystem puro (`loadEntriesToFile` →
>   `writeFileSync`+`appendFileSync`); crea archivo nuevo con id nuevo, `parentSession`
>   apuntando al source, y copia las entradas no-header. Corre tal cual en el host de VS Code.
> - **Q3 — Gates de hijas → 1 bridge compartido:** `createPermissionSystem(bridge,…)` no
>   está acoplado a una sesión (cierra sobre `bridge`, lee el `sessionId` del `ctx`); 2
>   factorías (2 hijas) registran 2 handlers que confluyen en el mismo `ApprovalBridge`,
>   acumulando N pendientes y resolviendo accept/reject correctamente. **Paridad de
>   seguridad confirmada: un workflow que corre `bash` en una hija SIGUE pidiendo aprobación.**
>
> Adicional: `ModelRuntime.create({ modelsPath:null, allowModelNetwork:false })` con
> `PI_OFFLINE=1` carga catálogos built-in estáticos → se pueden crear sesiones hijas sin
> red ni auth (el auth sólo se valida al `prompt()`, no al construir la sesión).

| Riesgo | Acción |
| --- | --- |
| ~~Compartir `resourceLoader` entre sesiones~~ | ✅ Resuelto (spike Q1): se reusa directo. |
| ~~`SessionManager.forkFrom` en el host de VS Code~~ | ✅ Resuelto (spike Q2): filesystem puro, corre in-process. |
| **Gates concurrentes** de varias hijas a la vez | Acumulación en el bridge **probada** (spike Q3: N pendientes de N hijas). Resta validar que el `ApprovalDialog` Remote React renderice varias sin pisarse (`webRoots` por `req.id`, como hoy en D28). |
| **Costo de N sesiones hijas** (cada una = su propio AgentSession + provider + contexto) | `maxConcurrency` por defecto bajo (1–2); documentar el trade-off (rpiv advierte lo mismo: Pi es single-active, las hijas cuestan). |
| **`maxConcurrency` en Frida** — el host VS Code no es single-active como el TUI | Frida puede correr varias hijas en paralelo de verdad (a diferencia de rpiv-pi, que serializa por la restricción del TUI). Oportunidad: paralelismo real en fanout. |
| **Estado del panel si el webview se recarga a mitad de run** | `republish()` + reconstrucción del store desde el JSONL (ya patrón de todo-web). |
| **Punto frágil en bump de Pi (D12)** | `createAgentSession`, `SessionManager.{create,open,forkFrom}`, `bindExtensions`, `getBranch`, `prompt/subscribe/waitForIdle/abort`. Agregar a la lista de D18. |
| **Trust boundary de `config.ts`** | Igual que rpiv: jiti evalúa top-level al cargar. Aviso en el preview de `/wf` si se detecta config fuera del repo del workspace. |

---

## 11. Plan por fases — ✅ COMPLETO (paridad con rpiv-workflow)

> Las 8 fases están implementadas y testeadas (243 tests). Cada fase: tests del
> runner **sin SDK** (host stub) + integración con sesión hija real (Fases 0/4).

- **Fase 0 — Spike de viabilidad. ✅** (`test/frida-workflow/spike-fase0.test.ts`).
- **Fase 1 — Esqueleto + grafo lineal. ✅** `dsl` + `runner` + `audit` + `host`/`child-session` (spawnChild); `/wf <nombre> <input>`.
- **Fase 2 — Routing + outcomes + schemas. ✅** `gate/match/defineRoute`, collectors (transcript/FS-diff/tool/git/url), `outputSchema`/`inputSchema` (TypeBox vía `typeboxSchema`), `validate`.
- **Fase 3 — Resume. ✅** `/wf @ref`, reconstrucción del JSONL, replay, determinismo, `--name`.
- **Fase 4 — Carga por capas + alias. ✅** `loadWorkflows` (jiti + **bundle DSL** `dist/frida-workflow.js` + alias), capas user/project, `skillAliases`, `default`.
- **Fase 5 — `WorkflowPanel` + lifecycle. ✅** store reactivo + panel `fridaWeb` en footer + 12 hooks de lifecycle.
- **Fase 6 — Loops. ✅** `fanout` (waves Kahn + concurrency + `failFast`), `iterate`, `fanin`/`reads`, caps (`max`/`maxIterations`).
- **Fase 7 — Judges. ✅** `judge`, `verify` (post-condición), `assess` (loop juzgado), `panel` (`majority`/`all`/`any` + `PANEL_VERDICT`).
- **Fase 8 — Skill-contracts + script/prompt stages. ✅** `produces.script`/`acts.script`/`terminal.script`, `produces.prompt`/`acts.prompt`, `contracts` (`canCompose`).

---

## 12. Qué NO porta (deliberadamente)

- **Overlay TUI / lane dock / viewer de rpiv-pi** — Frida tiene webview; el `WorkflowPanel` es el equivalente.
- **`onTerminalInput` / abort por teclas del TUI** — Frida aborta desde el webview (`/wf` panel → botón ✕ → `AbortController`).
- **`registerWorkflowExecutionHost` como inyección cross-package** — Frida es el único host; se cablea directo (no hace falta el seam de Symbol.for).
- **Detección de layouts legacy de rpiv** (`.rpiv-workflow/` etc.) — partimos de cero con `.frida/workflows/`.

---

## 13. Trazabilidad a ADRs existentes

- **ADR-0001/D7** (disuasivo, gates): los gates **deben** aplicar en sesiones hijas (§3.3).
- **ADR-0005** (descubrimiento abierto): **no se reabre** — código propio en `src/`, 0 deps npm.
- **ADR-0010** (`~/.frida`): config de usuario bajo `~/.frida/workflows/`.
- **ADR-0012/0014** (fridaWeb, paneles persistentes): `WorkflowPanel` vía `mountPersistent`.
- **ADR-0006** (tool dedicado, host en `hasUI=false`): el `/wf` es un **slash command** del composer (no un tool del modelo), así que no choca con el `uiContext` RPC.
- **D13** (sesiones en globalStorage): runs bajo `globalStorageUri/workflows/<encoded-cwd>/`.
- **D12** (bump de Pi): añadir los métodos de `AgentSession`/`SessionManager` tocados a la lista de puntos frágiles.
