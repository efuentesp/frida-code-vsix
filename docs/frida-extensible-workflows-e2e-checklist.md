# Checklist E2E manual — `frida-extensible-workflows`

Verificación en VS Code (Extension Development Host) con el gateway Softtek real.
Cada bloque: **paso** (qué pedirle a Frida) → **esperado** → **verificar**.

> Los scripts son JS del sandbox (sin imports/fs/red). Pídelos textualmente al
> agente dentro de Frida: *"usa el tool workflow con este script: …"*.

## 0. Pre-requisitos

- [ ] **Build + dev host**: `F5` ("Run Frida (Extension)") — preLaunch `npm: build`. Se abre una ventana de VS Code con la extensión cargada.
- [ ] **Gateway**: API key de Softtek configurada (`Frida: Actualizar API key`); un workspace abierto (repo git para el test de worktree).
- [ ] **(Opcional) Panel UI**: si quieres ver runs activos, añade en `src/extension.ts` (junto a `wireWorkflowPanel`):

  ```ts
  import { wireExtensibleWorkflowPanel } from "./tools/frida-extensible-workflows/panel";
  // …en el setup de sesión (junto al otro wire), idempotente:
  wireExtensibleWorkflowPanel(s.webBridge);
  ```

  Re-build (`F5`). Sin esto, los pasos siguientes igual funcionan (sólo falta el widget visual).
- [ ] **Confirmar build**: `node esbuild.js` EXIT=0; `npm run typecheck` limpio.

## 1. Sanity — los 7 tools visibles

- **Paso**: en Frida, pregunta *"¿qué tools de workflow tienes?"* o `/help`.
- **Esperado**: el modelo lista `workflow`, `workflow_status`, `workflow_catalog`, `workflow_stop`, `workflow_respond`, `workflow_retry`, `workflow_resume`.
- **Verificar**: si falta alguno, la factory no se registró (revisa la consola del dev host por errores en `createFridaExtensibleWorkflows`).

## 2. Foreground — parallel + agent + summary

- **Paso**:

  ```js
  const r = await parallel("review", {
    a: () => agent("Resume en 1 línea qué hace src/extension.ts"),
    b: () => agent("Cuenta los archivos en src/tools/"),
  });
  return await agent(prompt("Combina en un resumen:\n\n{r}", { r }));
  ```

  con `foreground: true`, `name: "e2e-fg"`.
- **Esperado**: la llamada **bloquea** hasta terminar y devuelve inline el resumen.
- **Verificar**: respuesta coherente con ambas ramas; demora acorde a 3 llamadas modelo.

## 3. Background + follow-up + status + stop

- **Paso**: mismo script, `foreground: false` (default), `name: "e2e-bg"`.
- **Esperado**: devuelve **inmediatamente** un `runId` ("lanzado en background…").
- **Verificar**:
  - Pide al agente `workflow_status({ runId: "<id>" })` → `state: running` mientras corre.
  - Al completar, llega un **follow-up** con el resultado (el agente lo procesa como nuevo turno).
  - **Stop**: lanza otro background y, antes de que termine, `workflow_stop({ runId })` → "cancelada"; `workflow_status` → `state: stopped`.

## 4. Catalog

- **Paso**: `workflow_catalog({})` y `workflow_catalog({ name: "workflow" })`.
- **Esperado**: índice de funciones/aliases (vacío si no registraste ninguna) sin error; el detalle de `"workflow"` no rompe.

## 5. Checkpoints + workflow_respond (background)

- **Paso** (background, `name: "e2e-cp"`):

  ```js
  const ok = await checkpoint({ name: "gate", prompt: "¿Procedo con el deploy?", context: { env: "staging" } });
  if (ok !== "approved") return "abortado por checkpoint";
  return await agent("Simula el deploy en staging");
  ```

- **Esperado**: la run **pausa**; llega un **follow-up** pidiendo aprobación con el texto del checkpoint y cómo responder.
- **Verificar**: el agente (o tú) responde `workflow_respond({ runId, name: "gate", approved: true })` → la run **continúa** y entrega "deploy simulado". Con `approved: false` → `"abortado por checkpoint"`.
- **Nota**: `checkpoint()` devuelve `"approved"`/`"rejected"` (strings, no booleanos).

## 6. Budget hard + workflow_resume

- **Paso**: lanza background con `budget: { agentLaunches: { hard: 1 } }` y:

  ```js
  const a = await agent("Paso 1");
  const b = await agent("Paso 2");
  return [a, b];
  ```

- **Esperado**: corre el paso 1 y la run pasa a **`budget_exhausted`** (el paso 2 no arranca).
- **Verificar**:
  - `workflow_status({ runId })` → `state: budget_exhausted`.
  - `workflow_resume({ runId, budget: { agentLaunches: { hard: 3 } } })` → el paso 1 **replaya** (no se re-ejecuta) y el paso 2 corre → `completed`.

## 7. Retry (replay de paths completados)

- **Paso**: lanza background con **2+ agentes**; cuando lleve un rato, `workflow_stop({ runId })` (→ `stopped`).
- **Esperado**: la run queda `stopped` con parte del trabajo completado en el journal.
- **Verificar**: `workflow_retry({ runId })` → crea una **run hija** que *replaya* lo completado y ejecuta el resto → `completed`. El `runId` devuelto es distinto al original.

## 8. withWorktree (aislamiento git)

- **Paso** (en un repo git, background, `name: "e2e-wt"`):

  ```js
  const r = await withWorktree("feature-x", async () => {
    return await agent("Crea un archivo prueba.txt y commitealo en este worktree");
  });
  return r;
  ```

- **Esperado**: se crea un **git worktree** aislado; el agente corre ahí y commitea a un branch `wf-worktree/named/feature-x-<id>`.
- **Verificar**: `git worktree list` muestra el worktree bajo `~/.frida/.frida-worktrees/...`; el commit está en ese branch, no en tu working tree.

## 9. Roles

- **Paso previo**: crea `~/.frida/roles/reviewer.md` (o `.frida/roles/`):

  ```md
  ---
  model: "<provider/modelId válido en tu gateway>"
  thinking: high
  tools: ["read", "bash"]
  description: Reviewer estricto
  ---
  Eres un reviewer de código estricto.
  ```

- **Paso**: en un workflow, `agent("Revisa este archivo", { role: "reviewer" })`.
- **Esperado**: el agente usa el modelo/thinking/tools del rol; no error.
- **Verificar**: cambia `model` en el `.md` y confirma que el agente cambia de modelo (o al menos no falla al resolverlo).

## 10. Persistencia / artefactos en disco

- Tras cualquier run, inspecciona:

  ```
  ~/.frida/workflows/projects/<slug>-<hash-cwd>/sessions/<sessionId>/runs/<runId>/
  ```

- **Verificar** que existen: `state.json`, `journal.json`, `snapshot.json`, `workflow.js`.
- **Recarga VS Code** y `workflow_status({ runId })` sigue devolviendo el estado → las runs **sobreviven a reload**.

---

## Fallos comunes y dónde mirar

| Síntoma | Dónde mirar |
| --- | --- |
| Los 7 tools no aparecen | Consola del dev host (errores en la factory); `pi-session.ts:495` (registro). |
| `agent()` falla con "No API key found" | No se propagó el `ModelRuntime` del padre → revisa `createFridaAgentSpawner` (`frida-agent-execution.ts`). |
| Background no entrega follow-up | `pi.sendMessage` no disponible → revisa `deliverFollowUp` (`frida-delivery.ts`). |
| Checkpoint no reanuda | `workflow_respond` no encontró el checkpoint en vivo → la run ya terminó o el `name` no coincide. |
| `budget_exhausted` no resume | Sin `budget` patch o el patch no relaja el `hard` suficiente. |
| Retry no replays | `replaySources` no llegó al bridge → `retryWorkflow` (`frida-host.ts`). |
| Worktree falla | El cwd del workflow no es un repo git (o sin commits). |

## Criterio de éxito global

- [ ] Los 7 tools responden sin error.
- [ ] Foreground bloquea y devuelve; background devuelve runId + follow-up al completar.
- [ ] Checkpoints pausan y `workflow_respond` los resuelve.
- [ ] Budget hard → `budget_exhausted` → resume con patch → `completed`.
- [ ] Retry replays lo completado; resume continúa lo incompleto.
- [ ] withWorktree aísla en un branch propio.
- [ ] Runs sobreviven a recarga de VS Code.
