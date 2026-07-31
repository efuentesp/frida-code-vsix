# `frida-subagents` — sub-agentes autónomos estilo Claude Code (porte de `pi-subagents`)

**Estado:** aceptado (Fase 0 cerrada; ver §Decisiones D1–D10).

Se añade la extensión que aporta **sub-agentes autónomos** al modelo: el
agente padre puede spawnar especialistas que corren en sesiones hijas
aisladas, cada una con su propio modelo, tools, system prompt y nivel de
thinking. Registra 3 tools (`Agent`, `get_subagent_result`,
`steer_subagent`), descubre agentes `.md` de `.frida/agents/` y
`~/.frida/global/agents/` (donde frida-pipeline ya sincroniza los 15
perfiles), y gestiona el lifecycle completo: concurrencia, notificaciones
de completación, steering mid-run, graceful max_turns, worktree isolation,
memory persistente y skill preloading.

Sigue el patrón de **porte nativo** establecido en ADR-0020/ADR-0021: cero
dependencias npm nuevas, reusa SDK de Pi ya embebido, código propio en
`src/tools/frida-subagents/`. No reabre ADR-0005.

Análisis completo en
[`.rpiv/artifacts/discover/2025-07-31_frida-subagents-porter-pi-subagents.md`](../../.rpiv/artifacts/discover/2025-07-31_frida-subagents-porter-pi-subagents.md).

## Contexto

`@tintinweb/pi-subagents` v0.14.3 es la extensión más rica del ecosistema Pi
(8431 líneas, 20 módulos). Aporta sub-agentes estilo Claude Code: el modelo
invoca el tool `Agent` para spawnar un especialista, recibe el resultado al
terminar, y puede sterearlo mid-run. Soporta agentes custom (`.md` con
frontmatter), concurrencia (cola de 4), git worktree isolation, memory
persistente, skill preloading, scheduling (cron), y UI TUI (widgets Ink,
fleet view, conversation viewer).

`frida-code` ya tiene dos mecanismos de sesión-hija:

- **frida-workflow** (ADR-0020) despacha stages en sesiones hijas
  (`spawnChild`), pero el **grafo** controla el flujo — el modelo no decide
  cuándo spawnar.
- **frida-pipeline** (ADR-0021) aporta 15 perfiles de subagente `.md` y los
  sincroniza a `~/.frida/global/agents/`, pero **no registra el tool
  `Agent`** que les da vida.

**La brecha:** sin `frida-subagents`, el modelo no puede decidir
autónomamente "necesito spawnar un codebase-locator para buscar X" — tiene
que hacerlo todo en la sesión principal, o el usuario tiene que invocar
`/skill:` manualmente. Cargar `pi-subagents` arrastría `croner` y `nanoid`
como deps, su UI es TUI Ink (no webview), y reabriría ADR-0005.

## Decisión

**Porte nativo de `pi-subagents` como `frida-subagents`**, con 10 decisiones
firmadas (Fase 0 cerrada):

| ID | Decisión | Justificación |
| --- | --- | --- |
| **D1** | **Nombre: `frida-subagents`** | Espejo de `pi-subagents`; usuarios que conocen Pi lo identifican al instante. Evita confusión con `frida-pipeline` (orquestador) y `frida-agent-browser` (browser automation). |
| **D2** | **Scheduling diferido** | `croner` es la única dep npm nueva real de pi-subagents. Diferir el scheduling a una fase posterior reduce el scope del porte y evita la dep. El scheduler (`schedule.ts`, 365 líneas + `schedule-store.ts`, 153 líneas) se porta cuando se decida incluirlo. |
| **D3** | **Git worktree isolation incluido** | 191 líneas, 0 deps nuevas. Alto valor: permite que un agente corra en una copia aislada del repo y auto-commitee sus cambios a un branch. |
| **D4** | **Persistent memory incluido** | 179 líneas, 0 deps nuevas. Soporta `memory: project/local/user` con archivos MEMORY.md. Los agentes read-only reciben memoria de sólo lectura automáticamente. |
| **D5** | **UI: React fridaWeb (Fase 6)** | Los widgets TUI Ink de pi-subagents (566+380+362 = 1308 líneas) se reescriben como componentes React para el webview de Frida (mismo patrón que `WorkflowPanel.tsx` de frida-workflow). La Fase 1 usa sólo notificaciones en el chat (`post`); la UI visual llega en Fase 6. |
| **D6** | **Defaults heredados de pi-subagents** | Los 3 defaults (`general-purpose`, `Explore`, `Plan`) se portan con adaptaciones mínimas: paths `.frida/`, español en descripciones. `general-purpose` hereda el system prompt del padre (gemelo); `Explore` usa modelo rápido (haiku/fallback); `Plan` es read-only. |
| **D7** | **Cross-extension RPC via `pi.events`** | El bus de eventos de Pi ya está disponible en Frida. Los eventos `subagents:rpc:*` funcionan sin modificación. Otras extensiones pueden spawnar/parar sub-agentes via el bus. |
| **D8** | **Agent discovery: `.frida/agents/` + `~/.frida/global/agents/`** | frida-pipeline (ADR-0021 D2) ya sincroniza los 15 perfiles a `~/.frida/global/agents/`. frida-subagents los descubre de ahí + `.frida/agents/` (proyecto). **No** incluye `.agents/agents/` (workspace cross-tool) — simplificación. |
| **D9** | **Skill preloading incluido** | frida-pipeline (Fase 11) ya sincroniza las 27 skills a `~/.frida/skills/`. frida-subagents las descubre y puede inyectarlas en el prompt del agente via `skills: name1, name2` en el frontmatter. |
| **D10** | **Model fuzzy resolution porteado** | ~80 líneas. Alto valor: permite especificar modelos por nombre corto (`"haiku"`, `"sonnet"`) con matching tolerante (`.`/`-` interchangeable, date stamp opcional, fallback a otro provider). |

### Diseño de alto nivel (5 ejes)

1. **Estrategia — porte nativo.** Todo en `src/tools/frida-subagents/`, 0 deps
   npm nuevas (`nanoid` → `crypto.randomUUID()`). Sigue ADR-0020/ADR-0021. No
   reabre ADR-0005.

2. **Tools — 3 tools del modelo.** A diferencia de frida-pipeline (0 tools),
   frida-subagents registra exactamente 3 tools via `defineTool` +
   `pi.registerTool`:
   - `Agent` — spawn (foreground bloquea, background no)
   - `get_subagent_result` — consulta estado + resultado
   - `steer_subagent` — inyecta mensaje mid-run

   Estos son los únicos tools del modelo que frida-subagents registra.

3. **Sesiones hijas — `createAgentSession`.** Cada subagente corre en una
   sesión de Pi aislada, creada via `createAgentSession({model, tools,
   settingsManager, sessionManager, resourceLoader, ...})`. La sesión tiene
   su propio agentDir, tools set, modelo y system prompt. `SessionManager`
   puede ser `inMemory` (default) o `create` (persistente).

4. **Agent discovery — consume frida-pipeline.** frida-subagents NO
   sincroniza agentes (frida-pipeline es dueño de eso). Los descubre de:
   `.frida/agents/*.md` (proyecto, prioridad alta) y
   `~/.frida/global/agents/*.md` (global, donde frida-pipeline los copia).
   Los 3 defaults (`general-purpose`, `Explore`, `Plan`) van embebidos en el
   código.

5. **UI — React fridaWeb (Fase 6).** El widget persistente de agentes activos
   (spinners, tool activity, token counts, status icons) se monta via
   `webBridge.mountPersistent` en el footer del webview — mismo patrón que
   `WorkflowPanel.tsx`. La Fase 1 usa notificaciones en el chat (`post`).

### Layout

```
src/tools/frida-subagents/
├── index.ts              # createFridaSubagents() factory: 3 tools + /agents + hooks
├── types.ts              # AgentConfig, AgentRecord, AgentInvocation
├── default-agents.ts     # 3 defaults embebidos (general-purpose, Explore, Plan)
├── custom-agents.ts      # descubre .md de .frida/agents/ + ~/.frida/global/agents/
├── agent-types.ts        # registry unificado: defaults + custom + tool resolution
├── agent-runner.ts       # createAgentSession + tools scoping + graceful max_turns
├── agent-manager.ts      # concurrency queue + lifecycle + completion notifications
├── settings.ts           # subagents.json (.frida/ + ~/.frida/)
├── prompts.ts            # system prompt builder (replace / append)
├── context.ts            # buildParentContext (fork conversación padre)
├── memory.ts             # MEMORY.md + scopes project/local/user
├── worktree.ts           # git worktree create/cleanup/prune
├── output-file.ts        # streaming JSONL transcripts
├── skill-loader.ts       # preload skills desde ~/.frida/skills/
├── enabled-models.ts     # model scope enforcement (referencia ADR-0017/18/19)
├── group-join.ts         # batched notifications con timeout
├── cross-extension-rpc.ts # RPC via pi.events (spawn/stop/ping)
└── panel.tsx             # widget React fridaWeb (Fase 6) — agentes activos
```

### Adaptaciones vs `pi-subagents` (decisiones técnicas forzadas)

| `pi-subagents` | `frida-subagents` | Razón |
| --- | --- | --- |
| `.pi/agents/*.md` (proyecto) | `.frida/agents/*.md` (proyecto) | Namespace Frida (ADR-0010) |
| `~/.pi/agent/agents/*.md` (global) | `~/.frida/global/agents/*.md` (global) | frida-pipeline ya sincroniza aquí (ADR-0021 D2) |
| `.agents/agents/*.md` (workspace) | **No** | Simplificación; Frida no usa `.agents/` |
| `<cwd>/.pi/subagents.json` | `<cwd>/.frida/subagents.json` | Namespace Frida |
| `~/.pi/agent/subagents.json` (global) | `~/.frida/subagents.json` (global) | Namespace Frida |
| `<cwd>/.pi/agent-memory/` | `<cwd>/.frida/agent-memory/` | Namespace Frida |
| TUI Ink widgets (3 módulos, 1308 líneas) | React fridaWeb (Fase 6) | Frida es webview, no TUI |
| Scheduling (`croner` dep, 518 líneas) | **Diferido** (D2) | Evita dep npm nueva |
| `nanoid` para IDs | `crypto.randomUUID()` | Node built-in, mismo propósito |
| `getAgentDir()` → `~/.pi` | `defaultAgentDir()` → `~/.frida` | ADR-0010 |
| `$PI_CODING_AGENT_DIR` | No (hardcode `~/.frida`) | Frida no expone esta env var |
| `pi.events` bus | `pi.events` bus (sin cambio) | Mismo bus de Pi |
| `createAgentSession` del SDK | `createAgentSession` del SDK (sin cambio) | Mismo SDK |

## Plan por fases

| Fase | Entregable | Gate |
| --- | --- | --- |
| **0** | ADR-0022 (este doc) | ✅ Firmado |
| **1** | Factory + 3 tools (`Agent`, `get_subagent_result`, `steer_subagent`) + `general-purpose` | El modelo puede spawnar `general-purpose` en background y recibir resultado |
| **2** | Custom agents: descubre `.md` de `.frida/agents/` + `~/.frida/global/agents/` | Spawnar un agente de frida-pipeline (ej. `codebase-locator`) |
| **3** | Defaults `Explore` + `Plan` + concurrency queue + group join | Background agents con notificaciones agrupadas |
| **4** | Settings (`subagents.json`) + graceful max_turns + `/agents` command | `/agents` muestra tipos disponibles; max_turns con wrap-up |
| **5** | Worktree isolation + persistent memory + skill preloading | `isolation: worktree` commitea a branch; `memory: project` escribe MEMORY.md |
| **6** | UI: widget React (fridaWeb) con agentes activos + FleetView simplificado | Widget muestra agentes corriendo en el webview |
| **7** | Release: vsix 0.3.0, `docs/tools/frida-subagents.md`, CHANGELOG | Pruebas E2E verdes |

## Sinergia con frida-pipeline

```
frida-pipeline (ADR-0021):
  - Sincroniza 15 agentes .md a ~/.frida/global/agents/
  - Sincroniza 27 skills a ~/.frida/skills/
  - Aporta hooks (guidance, git-context, skill-bracket, pipeline-pointer)
  - Aporta 3 workflows (build, vet, polish)

frida-subagents (este ADR):
  - Descubre los 15 agentes de ~/.frida/global/agents/
  - Descubre agentes de .frida/agents/ (proyecto)
  - Registra el tool Agent para que el modelo los spawn
  - NO duplica la sincronización — frida-pipeline es dueño de eso
```

**Orden de registro (load-bearing):** frida-subagents debe registrarse
**DESPUÉS** de frida-pipeline en `pi-session.ts`, para que los agentes ya
estén sincronizados al discovery. Si frida-pipeline no está presente,
frida-subagents funciona con sólo los 3 defaults embebidos.

## ADRs que referencia (no reabre)

- **ADR-0001** (disuasivo): los sub-agentes heredan el `ApprovalBridge`
  compartido; los gates aplican a las sesiones hijas.
- **ADR-0005** (descubrimiento abierto): código propio en `src/`, 0 deps npm.
- **ADR-0006** (`hasUI`): los 3 tools son del modelo (no slash commands).
  `/agents` es slash command.
- **ADR-0010** (agentDir): `~/.frida` + `~/.frida/global/agents/`.
- **ADR-0011** (extension-ui-context): UI en fridaWeb vía `WebBridge`.
- **ADR-0012** (frida-webview): widget React con `mountPersistent`.
- **ADR-0016** (frida-permission-system): gates aplican a sesiones hijas.
- **ADR-0017/0018/0019** (providers/models): model fuzzy resolution opera
  sobre el catálogo canónico; model scope enforcement opcional.
- **ADR-0020** (frida-workflow): patrón de sesión-hija via `spawnChild`;
  frida-subagents usa `createAgentSession` directamente (no `spawnChild`).
- **ADR-0021** (frida-pipeline): frida-subagents **consume** los agentes y
  skills que frida-pipeline sincroniza. No duplica la sincronización.

## Punto frágil en bump de Pi

- **`createAgentSession` API**: pi-subagents comenta que Pi 0.80.8 cambió
  `modelRegistry` por `modelRuntime` en las opciones de `createAgentSession`.
  Frida usa la misma versión del SDK → mismo workaround (pasar ambos).
- **`ExtensionContext.modelRegistry`**: la facade que expone el context. Si
  Pi cambia esta interfaz, la resolución de modelos fuzzy se rompe.
- **`defineTool` + `pi.registerTool`**: si Pi cambia la API de registro de
  tools, los 3 tools dejan de funcionar.
- **`SessionManager.inMemory()`**: si Pi elimina o cambia este constructor,
  las sesiones no-persistentes fallan.
- **`session.bindExtensions()`**: necesario para que los hooks de extensión
  disparen en la sesión hija. Si Pi cambia este método, las hijas no
  inicializan correctamente.

## Coexistencia con `pi-subagents`

Si un usuario carga **ambos** paquetes en la misma sesión Pi:

- **Tools duplicados**: tanto pi-subagents como frida-subagents registran
  `Agent`, `get_subagent_result`, `steer_subagent`. Pi tomará el último
  registrado. **Recomendación:** no cargar ambos simultáneamente. Si se
  necesitan ambos, deshabilitar los tools de uno via `extensions: false`
  en el agente.
- **Agent discovery solapado**: pi-subagents lee `~/.pi/agent/agents/`;
  frida-subagents lee `~/.frida/global/agents/`. Sin colisión (paths
  distintos), pero el mismo agente `.md` podría estar en ambos si el
  usuario lo copia.
- **Eventos `pi.events`**: ambos emiten `subagents:*`. Un listener de
  pi-subagents recibiría eventos de frida-subagents y viceversa. Los
  `subagents:rpc:*` son mutualmente excluyentes — sólo uno debe responder.

**Documentar en `README.md`:** "Si usas también `pi-subagents`, no cargues
ambos en la misma sesión — los tools `Agent` colisionan. Usa
frida-subagents si estás en Frida; pi-subagents si estás en el CLI pi."
