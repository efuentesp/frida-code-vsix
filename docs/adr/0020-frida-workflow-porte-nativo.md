# `frida-workflow` — porte nativo del motor de rpiv-workflow

**Estado:** aceptado — ✅ **motor completo** (Fases 0–8 implementadas, 243 tests en verde).

Se añade un motor de **workflows** (cadenas de etapas tipo DAG con routing por
predicados, loops, jueces y estado auditable/resumible) a Frida. Es un **porte
nativo** del diseño de `@juicesharp/rpiv-workflow` (la extensión de pi) — **no** se
carga el paquete npm, sino que se reimplementa en `src/` contra el modelo de
sesiones/webview de Frida. Sigue el mismo criterio que D14/D15/D27/D28 (porte
nativo de rpiv-*: `todo`, `ask_user_question`, `context`, `permission-system`).

Diseño completo en [`docs/frida-workflow-design.md`](../frida-workflow-design.md).

## Contexto

`rpiv-workflow` cadena skills de pi en un grafo tipado: cada etapa corre en su
propia sesión desprendida, valida su salida contra un schema, enruta por
predicados sobre los datos, y append-ea cada paso a un trail JSONL del que se
resucita. Su motor (DSL + runner + audit) es **host-agnostic**; todo lo TUI-específico
(lane dock, viewer, taps de teclas) vive en `rpiv-pi`, no en `rpiv-workflow`.

Frida es extensión VS Code con **webview** y su propio `agentDir` (`~/.frida`,
ADR-0010). Cargar `rpiv-workflow`+`rpiv-pi` arrastraría ~530ms de runtime, exigiría
`jiti` en `~/.frida`, y el ejecutor desprendido (`rpiv-pi`) es específico del TUI
— además de reabrir ADR-0005 (descubrimiento de extensión ajena).

## Decisión

**Porte nativo** en `src/tools/frida-workflow/`, con 4 ejes (fijados con el usuario):

1. **Estrategia — porte nativo.** DSL + runner + audit propios, 0 dependencias npm
   nuevas (reusa `createAgentSession` del SDK ya embebido). No reabre ADR-0005.
2. **Ejecución — sesiones hijas desprendidas.** Cada etapa abre su propio
   `AgentSession` en background (`spawnChild` → `createAgentSession` con su propio
   `SessionManager`); el chat principal queda usable y el run resume desde JSONL.
3. **Alcance — paridad completa.** Todo el motor: loops (`fanout`/`iterate`/`assess`),
   `verify`, `panel` (jueces), collectors, schemas (Standard Schema v1), resume,
   carga por capas, skill-contracts. Entrega incremental por fases (1–8).
4. **UI — panel `fridaWeb` persistente en el footer.** Como `todo-web`/`context`:
   `WorkflowPanel` montado vía `WebBridge.mountPersistent(…,"footer")`, alimentado
   por los hooks de lifecycle. Los gates de las hijas aparecen como `ApprovalDialog`.

### El cruce: `FridaWorkflowHost` (el `spawnChild`)

rpiv externaliza el executor a `rpiv-pi` (TUI). Frida lo implementa directo contra
`createAgentSession`. Se refactoriza `src/pi-session.ts` para separar un
`FridaSessionShared` (modelRuntime, loader, bridges) del núcleo de construcción,
y exponer `createFridaChildSession(shared, {prompt, model, sessionKind})` que reusa
el loader/skills/provider y crea una hija con su propio `SessionManager`
(`create` / `open` reattach / `forkFrom` continue).

### ⚠ Gates en sesiones hijas (paridad de seguridad — lo crítico)

Las etapas ejecutan `bash`/`edit`/`write` en hijas desprendidas. Si esas sesiones
no pasan por el gate, un workflow correría `rm -rf` sin visto bueno y **rompería
ADR-0001/D7**. Por eso el loader de cada hija reusa `createPermissionSystem`
atado al **mismo `ApprovalBridge`** del webview — los gates confluyen en un solo
puente y el disuasivo se preserva.

## Spike Fase 0 — superado

`test/frida-workflow/spike-fase0.test.ts` (3/3 verde, offline y sin auth) respondió
las 3 preguntas go/no-go:

- **Q1** — `DefaultResourceLoader` es **reutilizable** entre sesiones (0 campos de
  sesión por inspección; 2 `AgentSession` comparten la MISMA instancia sin corrupción).
- **Q2** — `SessionManager.forkFrom` corre **in-process** (filesystem puro).
- **Q3** — `createPermissionSystem(bridge,…)` **no está acoplado a una sesión**:
  N hijas registran N handlers que confluyen en un solo `ApprovalBridge` (acumula N
  pendientes, accept/reject correctos). Paridad de seguridad confirmada.

Adicional: `ModelRuntime.create({modelsPath:null, allowModelNetwork:false})` con
`PI_OFFLINE=1` carga catálogos built-in estáticos → sesiones hijas sin red ni auth
(el auth sólo se valida al `prompt()`).

## Layout

- Config: `<cwd>/.frida/workflows/{config.ts, packs/*.ts}` + `~/.frida/workflows/`
  (jiti, dependencia transitiva de pi).
- Runs: `<globalStorageUri>/workflows/<encoded-cwd>/runs/<run-id>.jsonl` (D13:
  desacoplado del repo, no se commitea) + `names.json` + `<run-id>/sessions/`.

## No reabre ADRs

- **ADR-0001/D7** (disuasivo): gates aplican en hijas (§gates, probado por spike Q3).
- **ADR-0005** (descubrimiento abierto): código propio en `src/`, 0 deps npm.
- **ADR-0006** (`hasUI=false`): `/wf` es slash command del composer, no tool del modelo.
- **ADR-0010/0012/0014**: `~/.frida`, `fridaWeb`, `mountPersistent` footer.

## Punto frágil en bump de Pi (D12/D18)

`createAgentSession`, `SessionManager.{create,open,forkFrom}`, `bindExtensions`,
`AgentSession.{prompt,subscribe,waitForIdle,abort,getBranch,getSessionId}`,
`DefaultResourceLoader` (shareabilidad). Añadir a la lista de vigilancia de D18.

## Plan

Fase 0 ✅ · Fase 1 esqueleto+grafo lineal · Fase 2 routing+outcomes+schemas ·
Fase 3 resume · Fase 4 carga por capas+alias · Fase 5 `WorkflowPanel`+lifecycle ·
Fase 6 loops · Fase 7 judges · Fase 8 skill-contracts + script/prompt stages.
