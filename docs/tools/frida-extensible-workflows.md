<!--
Documentación de herramienta — frida-code.
Hermana de docs/tools/frida-workflow.md (que porta rpiv-workflow). Esta porta
pi-extensible-workflows (by vekexasia). Ver ADR-0028.
-->

# `frida-extensible-workflows`

> **Estado:** estable (fases 1-7) · [ADR-0028](../adr/0028-frida-extensible-workflows-porter-pi-extensible-workflows.md) · [pi-extensible-workflows](https://vekexasia.github.io/pi-extensible-workflows/)

Orquestación **multi-agente determinista**: convierte tareas complejas en un *workflow* JavaScript que distribuye trabajo en paralelo, pausa para aprobación, respeta presupuestos y **reanuda sin recorrer lo completado**. Porte nativo de `pi-extensible-workflows` (mismo SDK de Pi embebido, ADR-0002).

## ¿Qué es?

Un workflow es un script JS que se ejecuta en un **sandbox `node:vm` aislado** (proceso hijo forkeado) con un conjunto congelado de primitivas (`agent`, `parallel`, `pipeline`, `checkpoint`, `withWorktree`, `shell`, `prompt`, `log`, `args`) más las **funciones registradas** del catálogo. Sin imports, fs, red ni proceso: el trabajo real lo hacen los agentes (sesiones hijas vía `createAgentSession`).

Cada llamada obtiene una **identidad por call-site** (`structuralPath`) que hace el **replay determinista**: al reanudar o reintentar, las operaciones ya completadas devuelven su valor almacenado (journal en disco) sin re-ejecutarse. Las runs sobreviven a recargas de VS Code.

## ¿Cuándo usarla?

- Tareas que se descomponen en sub-tareas **independientes** que corren en paralelo (`parallel`) y se resumen en un agente final.
- Flujos que necesitan **aprobación humana** antes de un paso (`checkpoint`).
- Trabajo largo que puede **exceder un presupuesto** y debe reanudarse (`budget` + `workflow_resume`).
- Ejecución que puede **fallar a mitad** y conviene **reintentar sin repetir** lo hecho (`workflow_retry`).
- Aislamiento por **worktree** para ramas paralelas que commitean a branches propios.

**NO la uses si** la tarea cabe en un solo agente: usa `Agent` (frida-subagents) directamente. Un workflow es overhead cuando no hay paralelismo ni reanudación.

## Conceptos

| Término | Significado |
| --- | --- |
| **run** | Una ejecución de un workflow; tiene `runId`, estado y artefactos en disco. |
| **journal** | Registro de operaciones completadas por `structuralPath`; motor del replay determinista. |
| **structuralPath** | Identidad determinista de una llamada (call-site + ocurrencia + scope). |
| **bridge** | Las implementaciones reales de `agent`/`shell`/`checkpoint` que el sandbox invoca por RPC. |
| **foreground/background** | Foreground bloquea el tool hasta terminar; background devuelve el `runId` y entrega el resultado como *follow-up*. |

## DSL del script

```js
// Fan-out paralelo + resumen (path por defecto)
const reviews = await parallel("review", {
  correctness: () => agent("Revisa corrección."),
  security:    () => agent("Revisa riesgos de seguridad."),
  tests:       () => agent("Revisa cobertura de tests."),
});
return await agent(prompt("Resume y prioriza:\n\n{reviews}", { reviews }));
```

| Primitiva | Descripción |
| --- | --- |
| `agent(prompt, opts?)` | Lanza un sub-agente; devuelve su resultado (JSON). Opts: `model`, `thinking`, `tools`, `role`, `outputSchema`, `retries`, `timeoutMs`. |
| `parallel(name, tasks)` | Ejecuta tareas *keyed* en paralelo; devuelve `{key: valor}`. |
| `pipeline(name, items, stages)` | Items × etapas ordenadas; devuelve el valor final por item. |
| `checkpoint({name, prompt, context})` | Pausa hasta aprobación; devuelve `"approved"`/`"rejected"`. Requiere background. |
| `withWorktree(name, cb)` | Ejecuta el callback en un git worktree aislado; agentes ahí corren en su path. |
| `shell(cmd, opts?)` | Comando host determinista → `{exitCode, stdout, stderr}`. |
| `prompt(tpl, values)` | Interpola valores JSON en el template (strings crudos, objetos pretty-json). |
| `phase(name)` / `log(msg)` | Progreso / logs operativos. |
| `args` | Valores JSON pasados al lanzar. |

> El script **no** puede importar módulos, tocar fs/red/proceso o usar timers. Delega ese trabajo en `agent`/`shell`.

## Tools del modelo

### `workflow`

Lanza una run. Parámetros: `name` (req), `script` | `scriptPath` (exactamente uno) **o el `name` de un patrón curado** (sin script; ver abajo), `args`, `foreground`, `budget`, `concurrency`. Background por defecto → devuelve `runId` y entrega el resultado como follow-up.

#### Patrones curados (#19, Lotes 1 y 2)

`name` sin `script`/`scriptPath` resuelve al patrón builtin si coincide (un script explícito siempre gana). Puertos de `pi-dynamic-workflows` (MIT), ejecutan sobre este runtime sin código nuevo de orquestación:

| Patrón | Args | Qué hace |
| --- | --- | --- |
| `multi-perspective` | `{ topic, perspectives? }` | Un agente por perspectiva (5 por defecto: técnica, producto, seguridad, UX, mantenibilidad) en paralelo → síntesis balanceada. `<2` perspectivas cae a las defaults. |
| `codebase-audit` | `{ scope, checks: string[] }` | Un agente por check en paralelo → cross-validation contra el código citado → reporte priorizado. |
| `adversarial-review` | `{ task, reviewers?: 1-5, threshold?: 0-1 }` | Investiga hallazgos → cada uno lo juzgan N revisores escépticos en paralelo (outputSchema `{real, reason}`) → sólo sobreviven los que superan el umbral de acuerdo (default 0.5). |
| `code-review` | `{ diff, diffSource? }` | 7 finders especializados (correctness ×3, cleanup ×3, altitude) con outputSchema + verify CONFIRMED/PLAUSIBLE/REFUTED por candidato → dedup → ranking → top 10. Diff truncado a 200k chars con aviso. |

```text
workflow({ name: "multi-perspective", args: { topic: "¿React 19 o quedarnos en 18?" } })
workflow({ name: "codebase-audit", args: { scope: "src/tools/", checks: ["imports circulares", "exports muertos"] } })
workflow({ name: "adversarial-review", args: { task: "revisar el fix de permisos" } })
workflow({ name: "code-review", args: { diff: "<git diff>", diffSource: "git diff HEAD" } })
```

Los scripts son estáticos (leen `args` en runtime → identidad de journaling estable) y los valida eager antes de lanzar. `workflow_catalog` los lista bajo `builtinPatterns`.

#### Salida estructurada: `agent({ outputSchema })` (#19 G1)

Cualquier llamada `agent()` (patrón curado o script propio) puede pedir salida JSON: el host aumenta el prompt con el contrato del schema, parsea la respuesta (tolerante a fences y prosa), valida (type/required/properties/items/enum) y **repara acotadamente** (1 reintento con los errores concretos) antes de fallar. El accounting de los intentos de reparación se suma al del agente (#18). Sin `outputSchema` el paso es passthrough exacto.

#### Ruteo por tier: `agent({ tier })` (#19 G2)

`tier: "small" | "medium" | "big"` resuelve el modelo vía `modelAliases` de settings (`~/.frida/pi-extensible-workflows/settings.json` o `.pi/pi-extensible-workflows/settings.json` del proyecto):

```json
{ "modelAliases": { "small": "zai/glm-4.6-flash", "medium": "zai/glm-4.6", "big": "zai/glm-5.3" } }
```

Precedencia: `model` explícito > `role.model` > `tier`. Sin alias configurado el tier **degrada al modelo de la sesión** (es una pista de ruteo, no un requerimiento). `code-review` usa tiers: A/B/C medium, D/E/F small, G y síntesis big.

### `workflow_status({ runId })`

Resumen autoritativo de una run: estado, agentes, error. Llámalo **antes** de recuperar para confirmar el estado persistido.

### `workflow_catalog({ name? })`

Inspecciona funciones/aliases/settings disponibles como globales en los scripts, y los **patrones curados** bajo `builtinPatterns`. Sin `name` → índice compacto; con `name` → detalle completo (patrón builtin o función registrada).

### `workflow_stop({ runId })`

Detiene una run background en curso (abort de su controller).

### `workflow_respond({ runId, name, approved })`

Aprueba/rechaza un **checkpoint** pendiente, o resuelve una decisión. `approved: boolean`.

### `workflow_retry({ runId })`

Reintenta una run **fallida**: crea una run hija que *replays* los paths completados del source y ejecuta los incompletos. Sólo para `failed`/`stopped`.

### `workflow_resume({ runId, budget? })`

Continúa una run **`budget_exhausted`**: re-hidrata el uso, aplica un *budget patch* opcional (relaja límites), y re-corre replaysando lo completado. Sólo para `budget_exhausted`.

## Presupuestos (budget)

Dimensiones: `tokens`, `costUsd`, `durationMs`, `agentLaunches`; cada una `{ soft?, hard? }` con `soft < hard`. Al superar un **hard**, la run pasa a `budget_exhausted` y se reanuda con `workflow_resume`.

```js
// Lanzar con budget (vía parámetro del tool workflow):
// { "name": "review", "script": "...", "budget": { "agentLaunches": { "hard": 5 } } }
```

> **Nota de implementación (Fase 5-7):** `agentLaunches.hard` se enforcea totalmente. `tokens`/`costUsd` requieren la contabilidad por sesión (en integración); `durationMs`/soft-crossed son informativos.

## Roles

Archivos `.md` con *frontmatter* (`model`, `thinking`, `tools`, `description`, `overrideSystemPrompt`) en `~/.frida/roles/` (globales) o `.frida/roles/` (proyecto). Se aplican vía `agent(prompt, { role: "reviewer" })`. Las extensiones pueden registrar dirs de roles con `registerWorkflowExtension({ roleDirectories: [...] })`.

## API pública de extensión

```ts
import { registerWorkflowExtension } from "frida-workflow-extensible"; // vía src/tools/frida-extensible-workflows
export default function extension() {
  registerWorkflowExtension({
    version: "1.0.0",
    headline: "Mis funciones",
    functions: {
      miFn: {
        description: "...",
        input: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
        output: { type: "string" },
        async run(input, ctx) { return String(input.x); },
      },
    },
  });
}
```

`miFn` queda disponible como **global** en los scripts. El journal aplica también a funciones registradas (replay determinista). Registro **dentro de la factory** (el registry se congela en `session_start`).

## Persistencia y recuperación

Cada run escribe bajo `~/.frida/workflows/projects/<cwd-hash>/sessions/<sessionId>/runs/<runId>/`: `state.json`, `journal.json`, `snapshot.json`, `workflow.js`, `result.json`, `summary.json`. Sobrevive a recargas.

**Mapa de recuperación:**

- `agent(..., { retries })` → re-intenta una llamada de agente concreta.
- `workflow_retry({ runId })` → replays una run `failed` en una hija.
- `workflow_resume({ runId, budget? })` → continúa una `budget_exhausted`.
- Tras un fallo, llama `workflow_status` primero y pasa su estado como referencia.

## Diferencias con `frida-workflow`

`frida-workflow` (ADR-0020) porteó **otro** paquete (`@juicesharp/rpiv-workflow`): grafo de stages con routing/loops/jueces, controlado por el grafo. `frida-extensible-workflows` aporta **orquestación determinista multi-agente con reanudación**, presupuestos, checkpoints y retry/resume. **Coexistencia (D9):** mientras dure la transición, no cargues ambos para el mismo propósito; `frida-extensible-workflows` cubre el caso general.

## Más

- [ADR-0028](../adr/0028-frida-extensible-workflows-porter-pi-extensible-workflows.md) — diseño y fases.
- [ADR-0030](../adr/0030-frida-dynamic-workflows-patrones-sobre-extensible.md) — patrones curados de `pi-dynamic-workflows` (#19).
- [pi-extensible-workflows (upstream)](https://vekexasia.github.io/pi-extensible-workflows/) — referencia canónica.
