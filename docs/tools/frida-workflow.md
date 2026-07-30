# frida-workflow

> **Estado:** ✅ motor completo (Fases 0–8) · [ADR-0020](../adr/0020-frida-workflow-porte-nativo.md) · [diseño](../frida-workflow-design.md)

Motor de **workflows** para Frida: define cadenas de etapas (cada una despacha un
skill en una sesión hija desprendida), con **routing** por predicados, **loops**
(paralelismo/iteración), **jueces** (verificación/auto-mejora), validación con
**schemas**, y un **trail JSONL** del que se resucita.

Es un **porte nativo** de [`@juicesharp/rpiv-workflow`](https://www.npmjs.com/package/@juicesharp/rpiv-workflow):
mismo modelo mental y misma API, pero sin cargar el paquete npm (reusa el SDK de Pi
embebido en Frida).

---

## ¿Qué es?

Un workflow es un **grafo tipado de etapas**. Cada etapa declara **qué produce** (un
artefacto con *handle* — un path, URL, commit, etc.) o que es un **side-effect**, y
**a dónde va después** (un edge fijo o un route dinámico). El runner:

1. Empieza en `start`.
2. Por cada etapa, **despacha** su acción (a un skill en una sesión hija, a un
   script puro, o a un prompt crudo).
3. **Recolecta** el resultado (un *outcome*: extrae el path/URL/etc. del turno del
   modelo o del valor retornado).
4. Avanza por el edge/route, pasando el *output* aguas abajo.
5. Va dejando un **trail JSONL append-only** (header + filas por etapa/route).

Las sesiones hijas son **desprendidas** (background): el chat principal queda usable
mientras el workflow corre. Los **gates** de cada hija confluyen en el mismo
`ApprovalBridge` del webview → mismo perímetro disuasivo que el chat principal.

## ¿Cuándo usarla?

**Úsala cuando** una tarea del agente sea naturalmente **multi-etapa, condicional o
paralela**, y quieras reproducibilidad + observabilidad:

- "Lee el brief, planea, implementa, y verifica que compila" (lineal + verify).
- "Para cada componente de la lista, genera tests" (fanout paralelo).
- "Itera mejorando el draft hasta que pase el linter" (assess loop).
- "Genera, luego un panel de 3 jueces decide si aprueba" (panel + majority).
- "Lee el plan y decide: si es trivial → implementa, si no → pregunta" (routing).

**NO la uses si** un solo turno del agente basta. Un workflow añade estructura;
para "cambia esta función" un mensaje directo es más simple.

## Conceptos

| Término | Significado |
| --- | --- |
| **Workflow** | Grafo tipado: `stages` + `edges` + `start`. |
| **Stage (etapa)** | Un nodo. Tiene `kind`: `produces` (devuelve artefactos) o `side-effect`. |
| **Dispatch** | Cómo se ejecuta la etapa: **skill** (`/skill:<name>`), **script** (TS puro, sin modelo) o **prompt** (texto crudo). |
| **Output** | `{ kind, data, artifacts }` — lo que produce una etapa `produces`. |
| **Artifact / Handle** | Un valor concreto del output: path FS, URL, commit git, tool-call… con un `role` (p.ej. `primary`). |
| **Outcome** | Cómo se extrae el artifact del turno del modelo (collector) o del script. |
| **Edge** | Conexión fija `from → to`, o un **route** (función que decide el destino leyendo el output). |
| **Loop** | `fanout` (paralelo), `iterate` (secuencial hasta tope), `fanin` (recoge varios). |
| **Judge** | Etapa que evalúa el output de otra y emite un veredicto (`judge`/`verify`/`assess`/`panel`). |
| **Trail** | JSONL append-only del run (`header` + filas `stage`/`route`), del que se hace resume. |
| **Primary slot** | El handle "actual" que heredan las etapas downstream; `terminal` lo limpia. |

## Uso

Los workflows se definen en **archivos de configuración** (TypeScript) y se cargan por
capas. Se corren con el comando slash `/wf`.

```text
/wf plan-implement "crea un endpoint /health"
        → corre el workflow "plan-implement" con ese input

/wf @2024-07-21-ab12        → resume/replay un run anterior por su id
/wf --name=mi-run plan ...  → asigna un nombre legible al run
```

**Dónde viven los configs** (carga por capas, ver [Configuración](#configuración)):

- `<cwd>/.frida/workflows/*.ts` — del proyecto (prioridad más alta).
- `~/.frida/workflows/*.ts` — del usuario.
- Built-in (los que Frida empaqueta).

Mientras corre, el **panel Workflow** (footer) muestra etapas, unidades de loop y
veredictos en vivo.

## API / DSL

Todo se importa de `"frida-workflow"` (en los configs, vía el alias jiti al bundle
`dist/frida-workflow.js`):

```ts
import {
  defineWorkflow, produces, acts, terminal,
  transcriptPathCollector, fs, url,
  gate, match, STOP, gt,
  fanout, iterate, fanin,
  judge, verify, assess, panel, majority,
  Type, typeboxSchema, validateWorkflow,
} from "frida-workflow";
```

### `defineWorkflow`

Define el grafo. Es lo único obligatorio en un config.

```ts
defineWorkflow({
  name: "plan-implement",          // identificador (único tras carga por capas)
  description?: string,
  start: "plan",                   // etapa inicial
  stages: { [name: string]: StageDef },
  edges: { [from: string]: EdgeTarget | EdgeFn },  // "stop" o nombre de etapa o route
})
```

### Etapas: `produces` / `acts` / `terminal`

| Constructor | `kind` | ¿Produce output? | Primary slot |
| --- | --- | --- | --- |
| `produces(...)` | `produces` | sí (requiere `outcome` o `run`/`prompt`) | lo setea |
| `acts(...)` | `side-effect` | no | lo hereda |
| `terminal(...)` | `side-effect` | no | **lo limpia** |

```ts
// Skill (despacho por defecto): /skill:<name> en sesión hija
produces({
  skill?: "mi-skill",          // default: nombre de la etapa
  outcome: { collector: transcriptPathCollector({ pattern: /\b(\S+\.ts)\b/ }) },
  inputSchema?: typeboxSchema(Type.Object({ ... })),  // valida el output upstream
  outputSchema?: typeboxSchema(Type.Object({ ... })), // valida el propio output
  sessionPolicy?: "continue" | "fresh",
})
acts({ skill?: "...", sessionPolicy?: "continue" })
terminal({ skill?: "..." })
```

#### Despacho script (sin modelo)

`run(ctx)` es TS puro: hace trabajo de FS/computación y devuelve el resultado. **No**
abre sesión hija. Disponible como *namespace* de cada constructor:

```ts
produces.script({
  run: async (ctx) => {                      // ctx: { cwd, input, state }
    const p = path.join(ctx.cwd, "out.md");
    fs_write(p, "...");
    return { kind: "doc", artifacts: [fs(p)], data: { n: 1 } };
  },
  outputSchema?: typeboxSchema(...),
})
acts.script({ run: async (ctx) => { /* side-effect, retorna void */ } })
terminal.script({ run: async () => {} })     // limpia el primary slot
```

#### Despacho prompt (texto crudo)

Envía texto al modelo **sin** el prefijo `/skill:` (un "chat turn"). Útil cuando no
hay un skill registrado y solo quieres mandar instrucciones:

```ts
produces.prompt({
  prompt: "escribe un resumen en un .md",       // string
  outcome: { collector: transcriptPathCollector({ pattern: /(\S+\.md)/ }) },
})
acts.prompt({
  prompt: ({ input }) => `refina ${input?.data}`,  // o PromptFn dinámica
})
```

> **Restricciones:** `script` es excluyente con skill/outcome/loop/prompt/verify;
> `prompt` es excluyente con skill/run/loop/reads/verify. El validador las hace
> cumplir.

### Outcomes y handles

Un **outcome** extrae los artifacts del resultado. Cada artifact tiene un `handle`
(path FS, URL, commit, …) y un `role` (normalmente `primary`).

| Export | Para qué |
| --- | --- |
| `transcriptPathCollector({ pattern })` | Saca un path del texto del turno (regex). |
| `fs(path)` · `url(href)` · `opaque(value)` | Construyen handles directamente (útil en scripts). |
| `directoryPathCollector(...)` | Extrae un directorio. |
| `urlCollector(...)` · `toolCallCollector(...)` | URL / tool-call del turno. |
| `workspaceDiffCollector` · `gitCommitCollector` | Diff del workspace / commit creado. |
| `unionCollectors(...)` · `defineCollector(...)` | Combina o define collectors a medida. |
| `noopCollector` | No extrae (uso interno). |

```ts
produces({
  outcome: {
    name: "plan",                              // canal nombrado (para reads/routing)
    collector: transcriptPathCollector({ pattern: /\b(plan-\S+\.md)\b/ }),
  },
})
```

### Routing

Por defecto un edge es fijo: `edges: { plan: "implement" }`. Para decidir
dinámicamente, usa un **route** que lee el `output.data` (requiere `outputSchema` en
la etapa origen):

```ts
edges: {
  decide: defineRoute({
    targets: ["trivial", "preguntar", "stop"],
    route: (ctx) => ctx.output.data.trivial ? "trivial" : "preguntar",
  }),
  // o azúcar:
  gate: (ctx) => ctx.output.data.ok ? "next" : STOP,   // STOP = "stop"
}
```

| Export | Descripción |
| --- | --- |
| `gate(predicate)` | Devuelve el siguiente destino o `STOP`. |
| `match(value, { caso: destino })` | Switch sobre un valor. |
| `defineRoute({ targets, route })` | Route explícito (valida `targets`). |
| `STOP` | Constante para terminar la cadena. |
| `gt` · `gte` · `lt` · `lte` · `eq` | Predicados numéricos para gates. |

### Loops

Una etapa `produces` puede **expandirse** en N unidades (una sesión hija por unidad):

```ts
fanout({                       // paralelo (waves Kahn + concurrency)
  units: (ctx) => ctx.input.data.items.map(it => ({ input: it })),
  concurrency?: 4,
  failFast?: true,             // default: true (la primera falla detiene el wave)
})
iterate({                      // secuencial, hasta max o onCap
  units: (ctx, prev) => generarSiguiente(prev),
  max?: 8,
})
fanin({ reads: [{ name: "canal", all: true }] })  // recoge todos los de un canal
```

- **`fanout`** corre en paralelo con tope de concurrencia; los outputs se publican
  en el canal del `outcome.name`.
- **`iterate`** genera la siguiente unidad a partir de la anterior, hasta `max`.
- **`fanin`** consume `reads` (un canal nombrado, o `all:true` para todas las
  unidades).

`onCap` controla qué pasa al llegar al tope (`"advance"` sigue, `"halt"` frena).

### Jueces

Un **judge** evalúa el output de otra etapa y emite un veredicto (también un Output):

```ts
// verify: post-condición. Produce → judge → done(); si no, reintenta con feedback.
produces({
  outcome: { name: "draft", collector: ... },
  verify: {
    judge: judge({ skill: "linter-judge", outcome: { collector: ..., name: "verdict" } }),
    done: (verdict) => verdict.data.errors === 0,
    feedForward?: (ctx) => `Corrige: ${ctx.verdict.data.msgs}`,  // retry message
    max?: 1,                    // default 1 (gate-only, sin retry)
  },
})

// assess: loop juzgado. Produce → judge → ¿done? : mejorar y repetir (hasta max).
produces({
  outcome: { name: "draft", collector: ... },
  loop: assess({
    judge: judge({ skill: "critic" }),
    done: (verdict) => verdict.data.aprueba,
    max?: 8, onCap?: "advance",   // default onCap "advance", max 8
  }),
})

// panel: N jueces + un fold que agrega los veredictos (majority / all / any).
panel({
  judges: [judge({ skill: "j1" }), judge({ skill: "j2" }), judge({ skill: "j3" })],
  fold: majority,               // o all / any / foldFn propio
  tie?: "reject",               // qué hacer en empate
  agreement?: 2,                // cuántos deben coincidir
})
```

| Export | Descripción |
| --- | --- |
| `judge({ skill, outcome?, sessionPolicy? })` | Judge simple (un skill evalúa). |
| `verify({ judge, done, feedForward?, max? })` | Post-condición con retry. |
| `assess({ judge, done, feedForward?, max?, onCap? })` | Loop de auto-mejora. |
| `panel({ judges, fold, tie?, agreement? })` | Panel de N jueces. |
| `majority` · `all` · `any` | Folds de azúcar (quórum / unanimidad / alguno). |

### Skill contracts (scaffolding)

Declara qué canales consume/produce un skill; `canCompose` valida la composición.
(La check práctica de "reads publicado" ya la hace el validador.)

```ts
registerSkillContracts([{ skill: "implement", consumes: ["plan"], produces: ["code"] }]);
const ok = canCompose(["plan"], ["plan", "drafts"]);  // { ok: true } | { ok: false, missing: [...] }
```

### Schemas y validación

Validación con Standard Schema v1 vía TypeBox (bundleado en el DSL):

```ts
import { Type, typeboxSchema, validateSchema } from "frida-workflow";

const S = typeboxSchema(Type.Object({ files: Type.Number() }));
const r = await validateSchema(S, data);   // { ok: true } | { ok: false, issues }
```

Valida el grafo completo antes de correr:

```ts
import { validateWorkflow, hasErrors } from "frida-workflow";
const issues = validateWorkflow(wf);        // errors + warnings (alcance, reads, loops…)
if (hasErrors(issues)) { /* no corras */ }
```

## Ejemplos

### Lineal: plan → implement

```ts
import { defineWorkflow, produces, acts, transcriptPathCollector } from "frida-workflow";

export default defineWorkflow({
  name: "plan-implement",
  start: "plan",
  stages: {
    plan: produces({
      skill: "planner",
      outcome: { collector: transcriptPathCollector({ pattern: /\b(\S+\.md)\b/ }) },
    }),
    implement: acts({ skill: "coder" }),
  },
  edges: { plan: "implement", implement: "stop" },
});
```

### Con routing condicional

```ts
import { defineWorkflow, produces, acts, gate, Type, typeboxSchema } from "frida-workflow";

export default defineWorkflow({
  name: "maybe-ask",
  start: "decide",
  stages: {
    decide: produces({
      outcome: { collector: c, outputSchema: typeboxSchema(Type.Object({ trivial: Type.Boolean() })) },
    }),
    trivial: acts({ skill: "coder" }),
    preguntar: acts({ skill: "asker" }),
  },
  edges: {
    decide: gate((ctx) => (ctx.output.data.trivial ? "trivial" : "preguntar")),
    trivial: "stop",
    preguntar: "stop",
  },
});
```

### Paralelo (fanout) + verificación

```ts
export default defineWorkflow({
  name: "tests-por-componente",
  start: "gen",
  stages: {
    gen: produces({
      outcome: { name: "test", collector: c },
      loop: fanout({ units: (ctx) => componentes.map(k => ({ input: k })) }),
      verify: {
        judge: judge({ skill: "lint-judge", outcome: { collector: cv, name: "verdict" } }),
        done: (v) => v.data.errors === 0,
      },
    }),
  },
  edges: { gen: "stop" },
});
```

### Script puro (sin modelo)

```ts
export default defineWorkflow({
  name: "merge-outputs",
  start: "merge",
  stages: {
    merge: produces.script({
      run: async (ctx) => ({
        kind: "merged",
        artifacts: [/* fs(path) al resultado */],
        data: { count: ctx.input?.data.items.length ?? 0 },
      }),
    }),
  },
  edges: { merge: "stop" },
});
```

## Configuración

**Carga por capas** (built-in ← usuario ← proyecto, gana el proyecto):

```text
<cwd>/.frida/workflows/*.ts   ← config del proyecto (prioridad)
~/.frida/workflows/*.ts        ← config del usuario
built-in                       ← los que empaqueta Frida
```

- Los configs son **TypeScript** cargado con **jiti** (dep ya incluida). Importan el
  DSL de `"frida-workflow"`, que jiti resuelve vía alias al bundle
  `dist/frida-workflow.js` (TypeBox incluido).
- Un config puede `export default defineWorkflow(...)` o `export const x = ...`.
- `skillAliases` mapea nombres lógicos a skills reales.
- El sobre (`{ default: wf }`) y el `default` directo se aceptan ambos.

**Runs** (auditoría y resume):

```text
<globalStorageUri>/workflows/<encoded-cwd>/runs/<runId>.jsonl
<globalStorageUri>/workflows/<encoded-cwd>/names.json   ← nombres legibles (--name)
```

## Integración con Frida

- **Host:** `createFridaWorkflowHost({ frida, cwd, notify })` construye el host que
  despacha sesiones hijas con el loader curado (provider hooks + gates, sin montar
  paneles).
- **Sesiones hijas:** cada etapa abre su propio `AgentSession` en background
  (`createChildSession` en `pi-session.ts`); el chat principal queda libre.
- **Gates:** el loader de cada hija reusa `createPermissionSystem` atado al
  **mismo `ApprovalBridge`** → las aprobaciones confluyen en un solo puente
  (paridad de seguridad con el chat).
- **UI:** `WorkflowPanel` (panel `fridaWeb` en el footer) se alimenta de los 12
  hooks de lifecycle; `wireWorkflowPanel` lo monta idempotentemente al primer `/wf`.
- **Offline:** con `PI_OFFLINE=1`, las hijas usan catálogos built-in estáticos.

## Arquitectura / Internals

```text
src/tools/frida-workflow/
  types.ts        — tipos del modelo (Stage/Output/Handle/Loop/Judge/…)
  dsl.ts          — define/produces/acts/terminal (+ namespaces script/prompt)
  routing.ts      — gate/match/defineRoute + helpers gt/gte/lt/lte/eq
  loops.ts        — fanout/iterate/fanin (defs)
  loop-runner.ts  — waves Kahn + concurrency + caps
  outcomes.ts     — catálogo de collectors + parsers
  schema.ts       — typeboxSchema (adapter Standard Schema v1)
  judges.ts       — judge/verify/assess/panel + folds majority/all/any
  judge-runner.ts — runJudge/runVerify/runAssess + PANEL_VERDICT
  contracts.ts    — skill-contracts (registerSkillContracts/canCompose)
  state.ts        — RunState (slots, canales nombrados, primary)
  unit.ts         — executeUnit (factored: single + loop + judge)
  runner.ts       — runStage (dispatch skill/script/prompt) + runWorkflow/resume
  resume.ts       — reconstructState (replay desde el JSONL)
  audit.ts        — header + stage/route rows + names.json
  load.ts         — carga por capas (jiti + alias al DSL bundle)
  validate.ts     — validateWorkflow (alcance, reads, loops, jueces, script/prompt)
  lifecycle.ts    — 12 hooks (stage/workflow/loop/unit/judge events)
  store.ts        — store reactivo (useSyncExternalStore) para el panel
  panel.ts        — bridge lifecycle → store + mountWorkflowPanel
  WorkflowPanel.tsx — UI fridaWeb (fbox/ftext)
  host.ts         — createFridaWorkflowHost (sesión hija curada)
  command.ts      — handleWfSlash + registry
  index.ts        — API pública (barrel)
```

El DSL se publica como **bundle CJS** (`dist/frida-workflow.js`, TypeBox dentro) —
segunda entrada de `esbuild.js` — para que los configs lo importen vía alias sin
tocar ESM. El panel/React **no** entra en ese bundle (vía `index.ts`, sin refs).

## Ver también

- [README](../../README.md) — índice general de Frida Code.
- [Diseño](../frida-workflow-design.md) — modelo completo y plan por fases.
- [ADR-0020](../adr/0020-frida-workflow-porte-nativo.md) — decisión del porte nativo.
- [rpiv-workflow](https://www.npmjs.com/package/@juicesharp/rpiv-workflow) — la
  extensión original de la que es porte.

## Estado y madurez

**Motor completo** — las 8 fases están implementadas y testeadas (243 tests):

- ✅ Fase 0 — Spike de viabilidad (loader, forkFrom, gates compartidos).
- ✅ Fase 1 — Grafo lineal + audit JSONL + `/wf`.
- ✅ Fase 2 — Routing + outcomes + schemas.
- ✅ Fase 3 — Resume (`@ref`, replay, determinismo).
- ✅ Fase 4 — Carga por capas (jiti + DSL bundle).
- ✅ Fase 5 — `WorkflowPanel` + lifecycle.
- ✅ Fase 6 — Loops (fanout/iterate/fanin).
- ✅ Fase 7 — Jueces (judge/verify/assess/panel).
- ✅ Fase 8 — Script/prompt stages + skill-contracts.

Los tests del runner usan un **host stub** (sin SDK), más un test de integración con
el DSL bundle real. Queda pendiente una **demo end-to-end con sesiones hijas reales**
(requiere auth del gateway).
