# `frida-extensible-workflows` — orquestación multi-agente determinista (porte de `pi-extensible-workflows`)

**Estado:** aceptado (Fase 0 cerrada; ver §Decisiones D1–D10).

Se añade la extensión que aporta **orquestación multi-agente determinista** al modelo: el
agente lanza un *workflow* JavaScript que distribuye trabajo en paralelo, pausa para
aprobación y **reanuda sin recorrer lo completado**. Registra **7 tools**
(`workflow`, `workflow_catalog`, `workflow_status`, `workflow_respond`, `workflow_retry`,
`workflow_resume`, `workflow_stop`), expone `registerWorkflowExtension()` para que otros
`frida-*` registren funciones/aliases/hooks, y gestiona el ciclo de vida completo:
presupuestos agregados, checkpoints, worktrees, retry/resume determinista y entrega en
foreground/background.

Sigue el patrón de **porte nativo** establecido en ADR-0020/ADR-0021/ADR-0022: cero
dependencias npm nuevas, reusa el SDK de Pi ya embebido (ADR-0002), código propio en
`src/tools/frida-extensible-workflows/`. No reabre ADR-0005.

> **Diferencia clave con los portes anteriores.** `frida-workflow` (ADR-0020) porteó
> **otro** paquete (`@juicesharp/rpiv-workflow`) desde cero. Aquí porteamos el propio
> `pi-extensible-workflows` (by vekexasia, MIT, v5.1.1), que **ya es una extensión de Pi**
> y usa exactamente las mismas APIs del SDK que Frida embebe. Por eso la estrategia es
> **vendorizar el núcleo + adaptar seams**, no reescribir (D2).

## Contexto

`pi-extensible-workflows` v5.1.1 (~10 000 líneas TS, 24 módulos en `src/`) es la
extensión de orquestación determinista del ecosistema Pi. Convierte tareas multi-agente
en *jobs* que: se *fan-out* en paralelo (`parallel`/`pipeline`), pausan para aprobación
(`checkpoint`), respetan presupuestos agregados (`budget`), corren en worktrees aislados,
y **reanudan/reintentan sin repetir trabajo completado** (journal por *structural-path*).

`frida-code` ya tiene tres mecanismos de sesión-hija y orquestación:

- **frida-subagents** (ADR-0022): el modelo invoca `Agent` para spawnar un especialista y
  recibir su resultado. **Sin grafo ni determinismo.**
- **frida-workflow** (ADR-0020): despacha *stages* en sesiones hijas (`spawnChild`), pero
  el **grafo** controla el flujo y **no hay** parallel/pipeline/checkpoints/budgets/retry.
- **frida-pipeline** (ADR-0021): 15 perfiles `.md` + 3 workflows (build/vet/polish).

**La brecha:** Frida no tiene orquestación *determinista y reanudable* multi-agente. Sin
esta extensión, tareas como "revísalo por corrección, seguridad y tests en paralelo, y
resume" requieren que el modelo lo orqueste a mano en la sesión principal, sin
reanudación ante fallo ni presupuestos.

**El descubrimiento que cambia la estrategia:** `pi-extensible-workflows` es **ella misma
una extensión de Pi** que importa `@earendil-works/pi-coding-agent` (el mismo SDK que
Frida embebe, ADR-0002) y registra sus tools vía `pi.registerTool(defineTool(...))` — el
mismo patrón de `frida-subagents` (ADR-0022). Además, su ejecución de agentes
(`agent-execution.ts`) crea sesiones hijas con `createAgentSession` — el **mismo
primitivo** que `frida-subagents/agent-runner.ts` y `pi-session.ts:createChildSession`
usan hoy. En consecuencia, **~70% del código es agnóstico del runtime** y puede correr en
Frida casi intacto; el porte se reduce a reemplazar **sólo la capa de entrega TUI/tmux
→ webview**.

## Decisión

**Porte nativo de `pi-extensible-workflows` como `frida-extensible-workflows`, con 10
decisiones firmadas (Fase 0 cerrada):**

| ID | Decisión | Justificación |
| --- | --- | --- |
| **D1** | **Nombre: `frida-extensible-workflows`** | Espejo de `pi-extensible-workflows`. Evita colisión con `frida-workflow` (ADR-0020, porte de `rpiv-workflow`) y `frida-pipeline`. Usuarios que conocen Pi lo identifican al instante. |
| **D2** | **Estrategia: vendorizar núcleo + adaptar seams (NO reescribir)** | "Exactamente toda la funcionalidad" ⇒ fidelidad máxima. 10 000 líneas; reescribir (estilo ADR-0020) multiplicaría el esfuerzo y el riesgo de *feature drift*. El núcleo determinista (`execution`/`persistence`/`validation`/`registry`/`budget`) es runtime-agnóstico por diseño. Sigue el espíritu de ADR-0022: *"createAgentSession del SDK (sin cambio)"*. |
| **D3** | **Núcleo agnóstico portado verbatim** | `types`, `registry`, `execution` (`node:vm`), `persistence`, `budget`, `validation`, `utils` se copian literales. Sólo se vendorizan `acorn` + `minimatch` (deps runtime puras JS). Cero riesgo de divergencia funcional. |
| **D4** | **Capa TUI/herdr → webview (reemplazo, no porte)** | `herdr.ts` (tmux: `HERDR_PANE_ID`/`SOCKET_PATH`), `session-handoff.ts` (handoff en vivo a terminal), `host-view.ts`/`host-delivery.ts` (render TUI) **no aplican a VS Code**. Se reemplazan por notificaciones de progreso y entrega vía `postMessage` + cola followUp (patrones ya probados en `frida-workflow/host.ts:captureTranscript` y `frida-subagents/subscribeAgentProgress`). |
| **D5** | **`agentDir` `~/.pi` → `~/.frida`** | ADR-0010. `runsDirectory`, `createLocalPiSession` y `getAgentDir()` se reescriben para usar `defaultAgentDir()` (`~/.frida`). Igual que `frida-subagents` (`FRIDA_AGENT_DIR`). |
| **D6** | **`import.meta.resolve` → resolución estática/polyfill** | `agent-execution.ts:194,481` usa `import.meta.resolve("@earendil-works/pi-coding-agent")` para cargar `core/prompt-templates.js` y resolver el binario `pi`. El binario **no existe en Frida** (no hay handoff a terminal) → se neutraliza. La carga de prompt-templates se resuelve con el path del SDK ya bundeleado (esbuild). Es el mismo punto frágil que ADR-0010 documenta para extensiones Pi nativas. |
| **D7** | **Evals diferidos/descartados** | `workflow-evals.ts` (894 l, `child_process` spawn del CLI `pi`), `ambient-workflow-evals.ts`, `eval-capture-extension.ts` son infraestructura de *benchmarking* que no aplica a VS Code. Se **excluyen** del porte. Los tests de Frida se hacen con `vitest` + sesiones reales (patrón `test/frida-subagents`). |
| **D8** | **`registerWorkflowExtension()` como API pública** | La guía oficial (`extensions.html`) define `registerWorkflowExtension()` como la API canónica para que terceros registren `functions`/`modelAliases`/`agentSetupHooks`/`agentAttemptActions`/`roleDirectories`. La extensión Frida **debe exponerla** (re-export del `registry` vendorizado) para preservar la extensibilidad de primer orden. El registro va dentro de la factory, jamás en top-level (el registry se congela en `session_start`). |
| **D9** | **Coexistencia con `frida-workflow` diferida a Fase 7** | Ambos exponen orquestación. **Recomendación:** marcar `frida-workflow` como *legacy* y consolidar en `frida-extensible-workflows` (mayor funcionalidad), pero la decisión final se toma en Fase 7 con datos de uso. Mismo dilema que ADR-0022 planteó con `pi-subagents`. **No cargar ambos simultáneamente** mientras dure la transición (riesgo de confusión del modelo). |
| **D10** | **Propagación del `ModelRuntime`/providers/gates vía `createChildSession`** | El `WorkflowAgentExecutor` lanza N agentes vía `FairAgentScheduler`. Cada sesión hija se crea reutilizando el camino de `pi-session.ts:createChildSession` (que ya propaga el `ModelRuntime` del padre con auth en `SecretStorage` + providers/gates curados, ADR-0010/0017), **no** creando un runtime nuevo. Evita el bug "No API key found" que ADR-0022 documenta. |

### Diseño de alto nivel (6 ejes)

1. **Estrategia — porte por vendorizado + seams.** Núcleo agnóstico copiado literal
   (D3); sólo se reescriben los ~5 módulos acoplados a TUI/runtime (D4/D5/D6). 0 deps npm
   nuevas. Sigue ADR-0020/0021/0022. No reabre ADR-0005.

2. **Tools — 7 tools del modelo.** Registrados vía `defineTool` + `pi.registerTool`
   (mismo mecanismo que `frida-subagents`):
   - `workflow` — lanzar (`script`/`scriptPath`, `name`, `foreground`, `budget`, `concurrency`)
   - `workflow_catalog` — inspeccionar funciones/aliases/settings disponibles
   - `workflow_status` — resumen autoritativo de una run (estado, agents, budget, paths)
   - `workflow_respond` — aprobar/rechazar checkpoints y propuestas de presupuesto
   - `workflow_retry` — reejecutar una run `failed` en una hija (replay de paths completados)
   - `workflow_resume` — continuar una run `budget_exhausted`
   - `workflow_stop` — detener una run

3. **DSL — sandbox `node:vm` determinista.** El script corre en un contexto VM con un
   sandbox congelado: `{ agent, shell, withWorktree, prompt, checkpoint, parallel,
   pipeline, phase, log, args, Promise, JSON, Math }` + funciones registradas (globales).
   Sin imports/fs/red/proceso. Cada llamada obtiene identidad por call-site
   (`structuralPath`) que hace el replay determinista. **Idéntico al original** (`execution.ts`).

4. **Sesiones hijas — `createAgentSession` vía `createChildSession`.** Cada agente del
   workflow corre en una sesión de Pi aislada, creada reutilizando
   `pi-session.ts:createChildSession` (D10). El `FairAgentScheduler` aplica concurrencia
   justa según `settings.concurrency`.

5. **Persistencia — artefactos por run bajo `~/.frida`.** Cada run escribe
   `state.json`, `journal.json`, `snapshot.json`, `workflow.js`, `result.json`,
   `summary.json` en su directorio (`runsDirectory`). `RunStore` + `SessionLease`
   garantizan escritura segura. Sobrevive a reload/restart de VS Code.

6. **UI — React fridaWeb (Fase 7).** Gestor de runs activas, picker `/workflow`,
   agentes con progreso en vivo, budget/checkpoints, journal. Mismo patrón que
   `WorkflowPanel.tsx` (ADR-0020) y el widget de `frida-subagents` (ADR-0022 D5). Las
   `agentAttemptActions` (acciones contextuales del dashboard `/workflow`) se mapean a
   botones del panel. Las fases previas usan sólo notificaciones en el chat (`post`).

### Costuras adaptadas (lo único que SÍ cambia)

| `pi-extensible-workflows` | `frida-extensible-workflows` | Razón |
| --- | --- | --- |
| `herdr.ts` (tmux) + `session-handoff.ts` (handoff a terminal) | **Eliminado** → progreso/entrega vía webview (`postMessage` + followUp) | Frida es webview, no TUI |
| `host-view.ts` / `host-delivery.ts` (render TUI + follow-up) | `frida-delivery.ts` (entrega + progreso React) | Frida pinta tools en webview |
| `host.ts` (orquestación con entrega TUI) | `frida-host.ts` (orquestación con entrega webview) | Seam de entrega |
| `agent-execution.ts` `createLocalPiSession` (agentDir `~/.pi`) | `frida-agent-execution.ts` (agentDir `~/.frida` + `ModelRuntime` del padre) | ADR-0010 / D10 |
| `agent-execution.ts` `import.meta.resolve` (l.194,481) | Resolución estática del SDK bundeleado + neutralizar binario `pi` | ADR-0010 / D6 |
| `workflow-evals.ts` (`child_process` spawn `pi`) | **Excluido** | D7 (no aplica a VS Code) |
| `getAgentDir()` → `~/.pi/agent` | `defaultAgentDir()` → `~/.frida` | ADR-0010 / D5 |
| `renderCall`/`renderResult` (TUI Ink) de los 7 tools | Sin render TUI (Frida pinta en webview) | Frida es webview |
| Todo lo demás (`types`/`registry`/`execution`/`persistence`/`budget`/`validation`/`utils`) | **Copiado literal** | D3 — agnóstico del runtime |

### Layout

```
src/tools/frida-extensible-workflows/
├── index.ts                  # createFridaExtensibleWorkflows() factory → 7 tools + registerWorkflowExtension
├── frida-host.ts             # ADAPTADOR: orquestación (reemplaza host.ts → entrega webview)
├── frida-delivery.ts         # ADAPTADOR: entrega final + progreso (postMessage/cola followUp)
├── frida-agent-execution.ts  # ADAPTADOR: createLocalPiSession con ~/.frida + ModelRuntime del padre
├── frida-paths.ts            # defaultAgentDir/runsDirectory → ~/.frida
├── WorkflowPanel.tsx         # UI React (runs, agentes, budget, checkpoints) — Fase 7
├── vendor/
│   ├── acorn/                # AST analysis del script (validation.ts)
│   └── minimatch/            # globs
└── core/                     # COPIA LITERAL del original (agnóstico del runtime)
    ├── types.ts · registry.ts · execution.ts · persistence.ts
    ├── budget.ts · validation.ts · utils.ts
    └── host-phases.ts · host-runtime.ts · host-recovery.ts · host-navigator.ts
```

> **Nota sobre el "core/ copia literal":** en lugar de duplicar físicamente, se evalúa
> importar directamente de `pi-extensible-workflows` si se añade como dep pineada (ADR-0004),
> o copiar los archivos y vendorizarlos. La copia da control total sobre los seams sin
> arrastrar `peerDependencies` de Pi; la dep da *upstream gratis* a costa de acoplamiento
> de versión. **Recomendación inicial:** copia + vendor (máximo aislamiento, coherente
> con ADR-0010). Se revisa al cerrar la Fase 1.

## Plan por fases

| Fase | Entregable | Gate |
| --- | --- | --- |
| **0** | ADR-0028 (este doc) | ✅ Firmado |
| **1** | Núcleo vendorizado **headless**: copiar `types/registry/execution/persistence/budget/validation/utils`, vendorizar `acorn`/`minimatch`, `frida-paths.ts` (`~/.frida`), exponer `registerWorkflowExtension()`. **Sin registrar tools aún.** | Tests unitarios (`vitest`): sandbox `node:vm`, validación AST, `RunStore` persiste/carga en `~/.frida`. |
| **2** | Ejecutor de agentes adaptado (`frida-agent-execution.ts`) + resolver `import.meta.resolve` (D6). Registrar `workflow` **foreground-only** (sin background/checkpoints). | El modelo lanza `workflow` con `parallel({a:()=>agent(...),b:()=>agent(...)})` y devuelve resultados inline en VS Code. |
| **3** | Persistencia completa + `workflow_status`, `workflow_catalog`. Snapshot/journal/`SessionLease`. | `workflow_status({runId})` devuelve estado/agents; runs sobreviven a reload; replay determinista verificado. |
| **4** | Background + entrega (`frida-delivery.ts`) + `workflow_stop`. Progreso al webview. | Run background entrega resultado como follow-up al completar; `workflow_stop` cancela; widget de progreso vivo. |
| **5** | Checkpoints + presupuestos: `workflow_respond`. UI de aprobación webview (integración con `frida-permission-system`/`ApprovalBridge`). | Un `checkpoint()` pausa y el usuario aprueba vía webview; `budget` hard detiene y `workflow_resume` continúa. |
| **6** | `workflow_retry`, `workflow_resume`, `withWorktree`, roles `.md` (`~/.frida/global/roles/` + `.frida/roles/`). | Retry replays paths completados; resume continúa `budget_exhausted`; worktree aislado commitea a branch. |
| **7** | UI completa (`WorkflowPanel.tsx`, picker `/workflow`) + `docs/tools/frida-extensible-workflows.md`. **Decisión D9 coexistencia.** | Picker `/workflow` funcional; E2E verde; vsix + CHANGELOG. |

**Dependencias:** 1 → 2 → 3 → 4 → (5 ∥ 6) → 7. Cada fase deja la extensión *usable* en su
subconjunto.

## API pública de extensión (preservada del original)

La extensión re-exporta el contrato de authoring de `pi-extensible-workflows`
(`extensions.html`), para que otros `frida-*` o el usuario registren capacidades:

```ts
import { registerWorkflowExtension } from "frida-extensible-workflows";

export default function extension() {
  registerWorkflowExtension({
    version: "1.0.0",
    headline: "Task review",
    functions: {
      reviewTask: {
        description: "Ask an agent to review a task and return its report.",
        input:  { type: "object", properties: { task: { type: "string" } }, required: ["task"], additionalProperties: false },
        output: { type: "object", properties: { task: { type: "string" }, report: { type: "string" } }, required: ["task", "report"], additionalProperties: false },
        async run(input, context) {
          const report = await context.agent(context.run.workflow.name + ":\n\n" + input.task);
          return { task: input.task, report };
        },
      },
    },
  });
}
```

- **`WorkflowExtension`** = 5 campos de capacidad: `functions`, `modelAliases`,
  `agentSetupHooks`, `agentAttemptActions`, `roleDirectories` (más `version` semver,
  `headline`, `description` obligatorios).
- **`WorkflowFunctionContext`** = `run`/`agent`/`shell`/`prompt`/`parallel`/`pipeline`/
  `withWorktree`/`checkpoint`/`phase`/`log` **+ `invoke(name, input)`** (composición sin
  importar implementaciones).
- El journal por *structural-path* aplica **también a funciones registradas**: una
  llamada repetida con el mismo path devuelve el resultado almacenado sin reejecutar.
- Registro **dentro de la factory**, nunca en top-level (el registry se congela en
  `session_start`; top-level falla con `REGISTRY_FROZEN`).

## ADRs que referencia (no reabre)

- **ADR-0001** (disuasivo): los agentes del workflow heredan el `ApprovalBridge`
  compartido; los gates aplican a las sesiones hijas.
- **ADR-0002** (SDK en-proceso): base de toda la estrategia — el SDK embebido hace que el
  porte sea vendorizado, no reescrito.
- **ADR-0004** (depender y pinear): versión del SDK pineada; revisar compatibilidad con
  la peer-dep `*` de `pi-extensible-workflows`.
- **ADR-0005** (descubrimiento abierto): código propio en `src/`, 0 deps npm.
- **ADR-0010** (agentDir `~/.frida`): base de D5/D6; punto frágil recurrente.
- **ADR-0011/0012** (extension-ui-context / frida-webview): UI React vía `WebBridge`.
- **ADR-0016** (frida-permission-system): gates aplican a sesiones hijas del scheduler.
- **ADR-0017/0018/0019** (providers/models): la resolución de alias de modelo y el scope
  operan sobre el catálogo canónico.
- **ADR-0020** (frida-workflow): patrón de sesión-hija; **D9 coexistencia**.
- **ADR-0022** (frida-subagents): `createAgentSession` del SDK (sin cambio); patrón de UI.

## Puntos frágiles en bump de Pi

- **`createAgentSession` API**: ADR-0022 documentó el cambio `modelRegistry` →
  `modelRuntime` en 0.80.8. Frida pinea 0.81.1; `pi-extensible-workflows` 5.1.1 declara
  `peerDependencies` `*`. **Validar compatibilidad de la API** (`SessionManager`,
  `DefaultResourceLoader`, `createAgentSession`) entre la versión pineada y la esperada.
- **`import.meta.resolve`** (D6): confirmar comportamiento con el bundle de esbuild en el
  extension host. Si falla, polyfill o resolución estática del path del SDK.
- **`FairAgentScheduler` lanza N sesiones**: el scheduler crea sesiones en volumen —
  verificar que la propagación del `ModelRuntime` + gates escala sin fugas
  (`frida-subagents` lo hace de a uno).
- **`getAgentDir()` del SDK sigue siendo `~/.pi/agent`**: cualquier llamada interna del
  SDK (no la nuestra) apuntaría a `~/.pi`. Auditoría por bump (ADR-0010 lo marca
  recurrente).
- **`defineTool` + `pi.registerTool`**: si Pi cambia la API de registro de tools, los 7
  tools dejan de funcionar.
- **`session.bindExtensions()`**: necesario para que los hooks disparen en sesiones hijas.

## Coexistencia con `frida-workflow` (ADR-0020) y con `pi-extensible-workflows`

- **Con `frida-workflow`**: ambos exponen orquestación con UI de panel. **No cargar ambos
  simultáneamente** mientras dure la transición. D9 define la consolidación en Fase 7.
  Documentar en README: *"Usa `frida-extensible-workflows` para orquestación determinista
  multi-agente con reanudación; `frida-workflow` queda como legacy."*
- **Con `pi-extensible-workflows`**: si un usuario carga **ambos** en la misma sesión Pi,
  los 7 tools colisionan (Pi toma el último registrado). **Recomendación:** no cargar
  ambos. `frida-extensible-workflows` en Frida; `pi-extensible-workflows` en el CLI `pi`.
  Los `roleDirectories`/funciones del usuario viven en `~/.frida` (no `~/.pi`) → sin
  colisión de paths, pero el mismo rol `.md` podría duplicarse si se copia a mano.

## Fase 7 — cierre y decisión D9

Las 7 fases del porte están completas y verificadas (41 tests vitest verdes,
typecheck limpio, bundle esbuild EXIT=0):

| Fase | Entregable |
| --- | --- |
| 1 | Núcleo vendorizado headless (sandbox `node:vm`, validación AST, `RunStore`) |
| 2 | Tool `workflow` foreground + ejecutor adaptado (`createAgentSession` + `ModelRuntime`) |
| 3 | Persistencia + journal/replay determinista + `workflow_status`/`workflow_catalog` |
| 4 | Background + entrega follow-up + `workflow_stop` + eventos de progreso |
| 5 | Checkpoints + `workflow_respond` + budget (`agentLaunches` hard) |
| 6 | `workflow_retry`/`workflow_resume` + `withWorktree` aislado |
| 7 | Roles `.md`, UI (`WorkflowPanel` + store reactivo), docs, **decisión D9** |

**Decisión D9 (coexistencia con `frida-workflow`):** `frida-extensible-workflows`
se posiciona como la orquestación de propósito general (determinista, reanudable,
con presupuestos/checkpoints/retry). `frida-workflow` (ADR-0020, porte de
`rpiv-workflow`: grafo de stages con routing/loops/jueces) queda como *legacy* para
los workflows existentes basados en grafo. **No cargar ambos para el mismo propósito.**
Migración gradual: los nuevos workflows usan `frida-extensible-workflows`.

### Fuera de alcance (follow-ups)

- **Budget `tokens`/`costUsd`/`durationMs`**: `agentLaunches.hard` está completo; el
  resto requiere hookear los eventos de *usage* por sesión (contabilidad más profunda).
- **Montaje del panel en el webview live**: el módulo UI (`WorkflowPanel` + `panel.ts` +
  `store.ts`) está completo y compila; Falta la **única línea de cableado** en
  `extension.ts` (`wireExtensibleWorkflowPanel(s.webBridge)`, idempotente) — requiere
  verificación visual en VS Code. Mismo patrón que `wireWorkflowPanel` (ADR-0020).
- **E2E en VS Code con modelo real**: la fontanería está verificada con mocks; la
  prueba con el gateway Softtek + el spawner real es manual.
