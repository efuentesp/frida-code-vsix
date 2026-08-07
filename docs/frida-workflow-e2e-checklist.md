# Checklist E2E manual — `frida-workflow` (comando `/wf`)

Verificación en VS Code (Extension Development Host) con el gateway Softtek real.
Valida la **integración** del motor (ADR-0020, motor probado con 80 tests mock) en
vivo: comando `/wf`, picker, panel reactivo, abort (Detener) y persistencia del
trail JSONL.

> El motor está testeado; este checklist cubre lo que los mocks no pueden: el
> camino vivo con `createAgentSession` hijas + gateway real.

## 0. Pre-requisitos

- [ ] **Build + dev host**: `F5` ("Run Frida (Extension)") — preLaunch `npm: build`. El WIP de frida-workflow debe estar aplicado (o ya commiteado).
- [ ] **Gateway**: API key de Softtek configurada; un workspace abierto (repo git).
- [ ] **DSL bundle**: `dist/frida-workflow.js` existe (se genera con `npm run build`).
- [ ] **Workflow de prueba**: crea `<workspace>/.frida/workflows/hello.workflow.ts`:

  ```ts
  import {
    defineWorkflow, produces, acts,
    transcriptPathCollector, jsonBodyParser, typeboxSchema,
    gate, eq, Type,
  } from "frida-workflow";

  export default defineWorkflow({
    name: "hello",
    start: "ask",
    stages: {
      // La etapa produce JSON {ok: 0|1} parseado del transcript (.md).
      ask: produces({
        outcome: { collector: transcriptPathCollector({ pattern: /\.md$/ }), parser: jsonBodyParser },
        outputSchema: typeboxSchema(Type.Object({ ok: Type.Integer() })),
      }),
      done: acts(),
    },
    edges: { ask: gate("ok", { done: eq(1) }, "done"), done: "stop" },
  });
  ```

## 1. `/wf` — picker QuickPick agrupado

- **Paso**: escribe `/wf` (solo) en el chat de Frida.
- **Esperado**: se abre un **QuickPick** con los workflows agrupados por origen: `Internos (extensión)` · `Globales (~/.frida/workflows)` · `Proyecto (<cwd>/.frida/workflows)`. Tu `hello` aparece bajo **Proyecto**.
- **Verificar**: al elegir `hello` → un **InputBox** pide el `input` → al confirmar, **arranca el run** (notificación toast). El `hello` con esquema inválido se marcaría ⚠ (no se oculta).

## 2. `/wf <name>` y `/wf @<ref>` — lanzamiento directo

- **Paso**: `/wf hello "revisa el README"` (y si aplica, `/wf @<ref-de-run-anterior>`).
- **Esperado**: arranca el workflow `hello` **sin pasar por el picker**, pasando el input. Para `@<ref>`, retoma/referencia un run previo.
- **Verificar**: si el nombre no existe → mensaje `"Workflow 'X' no encontrado. Disponibles: …"` (no crash).

## 3. Panel `WorkflowPanel` (footer) — estado en vivo

- **Paso**: con un run en curso, mira el **footer** del webview.
- **Esperado**: el panel muestra el run con sus **etapas** y su estado (`running` → `completed`/`failed`/`aborted`). Cada etapa muestra `skill` y `status` (running/completed/failed) actualizado en tiempo real (store reactivo).
- **Verificar**: el **chat principal sigue usable** mientras corre (las etapas van en sesiones hijas desprendidas, no bloquean).

## 4. Botón **Detener** → abort cooperativo

- **Paso**: lanza `/wf hello "…"` y, mientras una etapa está `running`, pulsa **Detener** en el panel.
- **Esperado**: el run pasa a **`aborted`**; la sesión hija recibe `abort()` y se detiene de inmediato (parity con rpiv-workflow `run.signal` → Ctrl-C).
- **Verificar**: tras abortar, un run **nuevo** arranca limpio (el AbortController del anterior se soltó del store — no filtra). Si abortas y el run ya había terminado, es no-op.

## 5. Toast al terminar

- **Paso**: deja que un run llegue a `completed` (o `failed`).
- **Esperado**: llega un **toast/notificación** con el resultado. En `completed`, el trail refleja las etapas producidas; en `failed`, el error de la etapa caída.

## 6. `/wf check` — validación y saltar a archivo:línea

- **Paso previo**: rompe a propósito `hello.workflow.ts` (p.ej. quita `start:` o pon un `edges` que apunte a una etapa inexistente).
- **Paso**: `/wf check`.
- **Esperado**: QuickPick con **todos los issues** de carga + validación. Al elegir uno → abre el archivo en la **línea** del error.
- **Verificar**: arregla el archivo → `/wf check` de nuevo → sin issues. (El flujo `/wf` normal también avisa `"'X' no valida. Usa /wf check"`.)

## 7. Trail JSONL — persistencia y resume

- **Paso**: corre un run hasta `completed`.
- **Esperado**: se escribe el **trail JSONL** bajo el directorio de runs (`<globalStorage>/workflows/…`).
- **Verificar**:
  - El archivo JSONL existe y tiene una entrada por etapa (produce/act + outcome).
  - **Resume**: si frida-workflow expone resume (re-anudar un run interrumpido), verifica que retoma desde el trail sin repetir etapas completadas (cabecera con `parentSession → source`, `cwd` actualizado).

## 8. Orígenes por capas (precedencia)

- **Paso**: crea un workflow `hello` tanto en `~/.frida/workflows/` (user) como en `<cwd>/.frida/workflows/` (project).
- **Esperado**: el **project** gana (capa más alta → later wins por nombre). El picker muestra ambos orígenes pero al ejecutar `hello` corre el project.
- **Verificar**: el `default` sólo lo puede setear un config (no un `.workflow.ts`).

---

## Fallos comunes y dónde mirar

| Síntoma | Dónde mirar |
| --- | --- |
| `/wf` no hace nada | Dispatcher `case "wf"` (extension.ts:2038) → `postWfCommand`; ¿el WIP está aplicado/rebuild? |
| El picker no lista tu workflow | `loadWorkflows` (load.ts); revisa que el archivo sea `.workflow.ts` y `export default defineWorkflow({...})` |
| `Cannot find module "frida-workflow"` al cargar | `dslBundlePath` (dist/frida-workflow.js) ausente → `npm run build` |
| El panel no aparece | `wireWorkflowPanel(s.webBridge)` (extension.ts:2372); ¿Fase 5 montada? |
| Detener no aborta | `abortRun` (store) → `registerAbort` (runner) → `childOpts.signal` (pi-session); ¿el hunk de abort está aplicado? |
| La etapa cuelga para siempre | `createAgentSession` hija sin respuesta del gateway → revisa API key / modelo |
| No hay trail JSONL | `runsDirBase` (globalStorage/workflows); permisos de escritura |

## Criterio de éxito global

- [ ] `/wf` abre el picker agrupado por origen y lista el workflow de proyecto.
- [ ] `/wf <name>` arranca directo; `/wf` con nombre inexistente avisa sin crash.
- [ ] El panel muestra etapas en vivo y el chat sigue usable.
- [ ] **Detener** aborta la sesión hija y el run queda `aborted`.
- [ ] Toast al completar/fallar.
- [ ] `/wf check` valida y abre archivo:línea.
- [ ] El trail JSONL se persiste y (si aplica) resume sin repetir etapas.
