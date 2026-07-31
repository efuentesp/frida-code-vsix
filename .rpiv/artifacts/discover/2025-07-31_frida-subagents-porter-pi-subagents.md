# Descubrimiento: Porte de `@tintinweb/pi-subagents` como `frida-subagents`

**Fecha:** 2025-07-31  
**Estado:** ready  
**Autor:** Edgar F. Fuentes Perea  
**Origina:** `@tintinweb/pi-subagents` v0.14.3 (MIT, tintinweb)  
**Referencia:** ADR-0021 (frida-pipeline), ADR-0020 (frida-workflow)

---

## 1. Resumen ejecutivo

`pi-subagents` es la extensión más rica del ecosistema Pi: aporta **sub-agentes
autónomos estilo Claude Code** — agentes que corren en sesiones hijas aisladas,
cada una con su propio modelo, system prompt, tools y nivel de thinking. El
agente padre los invoca via el tool `Agent`, recibe resultados cuando terminan,
y puede **sterearlos** (inyectar mensajes) mid-run.

Frida ya tiene dos mecanismos de sesión-hija:

- **frida-workflow** despacha stages en sesiones hijas (`spawnChild`), pero el
  orquestador (el grafo) controla el flujo — el agente no decide cuándo spawnar.
- **frida-pipeline** aporta 15 perfiles de subagente `.md` y los sincroniza al
  agentDir, pero no registra el tool `Agent` que les da vida.

**La brecha:** sin `frida-subagents`, el modelo no puede decidir autónomamente
"necesito spawnar un codebase-locator para buscar X" — tiene que hacerlo todo
en la sesión principal, o el usuario tiene que invocar `/skill:` manualmente.

`frida-subagents` cierra esa brecha: registra los 3 tools (`Agent`,
`get_subagent_result`, `steer_subagent`), descubre los agentes de
`frida-pipeline`, y deja que el modelo los use cuando lo considere necesario.

---

## 2. Funcionalidad de pi-subagents

### 2.1 Los 3 tools

| Tool | Qué hace | Bloquea |
| --- | --- | --- |
| `Agent` | Spawnea un subagente con prompt, tipo, modelo, tools. `run_in_background: true` → no bloquea | Sí (foreground) / No (background) |
| `get_subagent_result` | Consulta estado + resultado de un agente background. `wait: true` → bloquea hasta terminar | Opcional |
| `steer_subagent` | Inyecta un mensaje en un agente en ejecución (redirige tras el tool actual) | No |

### 2.2 Tipos de agente

**Defaults embebidos (3):**

| Tipo | Tools | Modelo | Prompt mode | Descripción |
| --- | --- | --- | --- | --- |
| `general-purpose` | todos | hereda | `append` (gemelo del padre) | Hereda el system prompt del padre + reglas |
| `Explore` | read, bash, grep, find, ls | haiku (fallback: hereda) | `replace` | Exploración rápida read-only |
| `Plan` | read, bash, grep, find, ls | hereda | `replace` | Arquitecto de planificación read-only |

**Custom (`.md` con frontmatter YAML):**

Descubrimiento en 3 niveles (prioridad alta gana):

1. `.pi/agents/<name>.md` (proyecto, autoritativo)
2. `.agents/agents/<name>.md` (workspace compartido)
3. `~/.pi/agent/agents/<name>.md` (global)

Frontmatter: `description`, `tools`, `model`, `thinking`, `max_turns`,
`prompt_mode` (replace/append), `inherit_context`, `run_in_background`,
`isolation: worktree`, `memory`, `skills`, `disallowed_tools`, etc.

### 2.3 Concurrencia y lifecycle

- **Cola de concurrencia**: máx 4 agentes background simultáneos (configurable).
  Exceso → cola automática.
- **Notificaciones de completación**: al terminar, el resultado se inyecta en la
  conversación del padre como mensaje `<task-notification>`.
- **Group join** (smart/async/group): múltiples spawns en el mismo turno se
  consolidan en una notificación agrupada.
- **Graceful max_turns**: aviso "wrap up" 5 turnos antes del abort duro.

### 2.4 Features avanzadas

| Feature | Valor |
| --- | --- |
| Mid-run steering | `steer_subagent` inyecta mensajes sin reiniciar |
| Session resume | `resume: <agentId>` continúa una sesión completada |
| Git worktree isolation | `isolation: worktree` corre en copia aislada, auto-commits al terminar |
| Persistent memory | `memory: project/local/user` — archivos MEMORY.md por scope |
| Skill preloading | `skills: name1, name2` inyecta SKILL.md en el prompt del agente |
| Scheduling | `schedule: cron/interval/one-shot` dispara agentes programados |
| Model scope enforcement | Valida que los modelos estén en el allowlist de pi |
| Cross-extension RPC | Otras extensiones pueden spawnar via `pi.events` |
| Output transcripts | Streaming JSONL por agente |
| Custom tool descriptions | full/compact/custom para controlar tokens del tool spec |

---

## 3. Valor para un usuario de Frida

### 3.1 Lo que Frida tiene hoy (sin frida-subagents)

- **frida-pipeline** aporta 27 skills y 15 perfiles de agente `.md`, pero el
  modelo **no puede spawnarlos autónomamente**. Las skills se invocan via
  `/skill:<name>` (acción humana) o via workflows (grafo pre-definido).
- **frida-workflow** puede spawnar sesiones hijas, pero el **grafo** decide
  cuándo y cómo — el modelo no tiene agencia sobre el despacho.

### 3.2 Lo que frida-subagents añade

- **Agencia del modelo**: el modelo decide "necesito un codebase-locator para
  encontrar X" y lo spawn en background, mientras continúa trabajando. Antes
  tenía que buscar manualmente o pedirle al usuario que corriera `/skill:`.
- **Paralelismo real**: múltiples agentes corriendo concurrentemente
  (codebase-analyzer + integration-scanner en paralelo) con notificaciones
  agrupadas al terminar.
- **Aislamiento**: cada agente tiene su propio contexto, tools y modelo — un
  `Explore` con haiku no contamina el contexto del padre con sonnet.
- **Reutilización de los 15 agentes de frida-pipeline**: los perfiles `.md` que
  ya se sincronizan a `~/.frida/global/agents/` quedan disponibles como tipos
  de subagente sin configuración adicional.

### 3.3 Sinergia con frida-pipeline

```
frida-pipeline: define QUÉ agentes existen (15 perfiles .md + 27 skills)
frida-subagents: define CÓMO el modelo los invoca (tool Agent + lifecycle)
```

Juntos: el modelo puede spawnar `codebase-locator`, `claim-verifier`,
`diff-auditor`, etc. como sub-agentes autónomos, cada uno con su modelo
optimizado (haiku para exploración, sonnet para análisis profundo).

---

## 4. Diseño interno de pi-subagents

### 4.1 Arquitectura

```
src/ (8431 líneas totales)
├── index.ts              (2399) Entry: defineTool × 3 + registerCommand + session hooks
├── agent-runner.ts       (1014) createAgentSession + tools scoping + graceful max_turns
├── agent-manager.ts       (631) Concurrency queue + lifecycle + completion notifications
├── types.ts               (208) AgentConfig, AgentRecord, ScheduledSubagent
├── custom-agents.ts       (167) loadCustomAgents: descubre .md de 3 locations
├── default-agents.ts      (126) 3 defaults embebidos (general-purpose, Explore, Plan)
├── agent-types.ts         (189) Registry unificado: defaults + custom + tool resolution
├── settings.ts            (288) subagents.json (global + project)
├── prompts.ts              (—) Config-driven system prompt builder
├── context.ts              (—) buildParentContext (fork conversación padre)
├── memory.ts              (179) MEMORY.md + scopes project/local/user
├── worktree.ts            (191) git worktree create/cleanup/prune
├── schedule.ts            (365) cron/interval/one-shot scheduler
├── schedule-store.ts      (153) Persistencia session-scoped con PID lock
├── group-join.ts          (141) Batched notifications con timeout
├── cross-extension-rpc.ts (122) RPC via pi.events (spawn/stop/ping)
├── enabled-models.ts      (180) Model scope enforcement
├── output-file.ts         (110) Streaming JSONL transcripts
├── skill-loader.ts         (—) Skill preloading desde 5 roots
├── env.ts                  (—) Git/platform detection
└── ui/
    ├── agent-widget.ts        (566) Widget persistente TUI (Ink)
    ├── fleet-list.ts          (380) FleetView navegable TUI
    └── conversation-viewer.ts (362) Overlay de conversación live
```

### 4.2 APIs del SDK de Pi que usa

| API | Uso |
| --- | --- |
| `createAgentSession(opts)` | Crea sesión hija con model, tools, settings, agentDir propios |
| `defineTool({name, description, parameters, execute})` | Define los 3 tools |
| `pi.registerTool(tool)` | Registra los tools en la sesión |
| `pi.registerCommand(name, opts)` | Registra `/agents` |
| `pi.on("session_start", handler)` | Lifecycle: reset state |
| `pi.on("session_shutdown", handler)` | Lifecycle: cleanup |
| `SessionManager.inMemory(cwd)` | Sesión no persistente (default) |
| `SessionManager.create(cwd, dir)` | Sesión persistente |
| `DefaultResourceLoader` | Loader de recursos para la sesión hija |
| `SettingsManager.create(cwd, agentDir)` | Settings de la sesión hija |
| `parseFrontmatter(content)` | Parse YAML frontmatter de .md |
| `getAgentDir()` | Path del agentDir (~/.pi) |

### 4.3 Flujo de un spawn (Agent tool)

```
1. Modelo llama Agent({subagent_type: "Explore", prompt: "...", run_in_background: true})
2. agent-runner.resolveAgentConfig("Explore") → busca en defaults + custom
3. agent-runner.runAgent(config, prompt, options):
   a. Resuelve modelo (fuzzy match contra modelRegistry)
   b. Construye system prompt (replace o append)
   c. Crea SessionManager (inMemory o create)
   d. createAgentSession({model, tools, settingsManager, ...})
   e. session.bindExtensions() — inicializa extensiones de la hija
   f. session.subscribe() — escucha turn_end para max_turns
   g. session.run(prompt) — ejecuta el prompt
4. agent-manager.register(record) — registra en la cola de concurrencia
5. Si background: retorna {agent_id} inmediatamente
   Si foreground: bloquea hasta completar, retorna resultado inline
6. Al completar: notification se inyecta en la conversación del padre
```

---

## 5. Estrategia de porte a Frida

### 5.1 Patrón: porte nativo (igual que frida-pipeline)

- **0 dependencias npm nuevas** — `croner` y `nanoid` son las únicas deps de
  pi-subagents. Para Frida:
  - `croner` (scheduling) → **Fase posterior** (o `node-cron` ya bundled).
    La Fase 1 del porte NO incluye scheduling.
  - `nanoid` → usar `crypto.randomUUID()` (Node built-in, mismo propósito).
- **typebox** ya es dependencia de Frida (para schemas de tools).
- **SDK de Pi** ya embebido (createAgentSession, defineTool, etc.).

### 5.2 Adaptaciones vs pi-subagents

| pi-subagents | frida-subagents | Razón |
| --- | --- | --- |
| `.pi/agents/` (proyecto) | `.frida/agents/` (proyecto) | Namespace Frida |
| `~/.pi/agent/agents/` (global) | `~/.frida/global/agents/` (global, D2 ADR-0021) | frida-pipeline ya sincroniza aquí |
| `.agents/agents/` (workspace) | **No** (Frida no usa .agents/) | Simplificación |
| TUI Ink widgets (agent-widget, fleet-list, conversation-viewer) | React via `fridaWebMount` (fridaWeb) | Frida es webview, no TUI |
| `/agents` (Pi TUI menu) | `/agents` (slash command en Frida chat) | Frida slash commands |
| `subagents.json` en `.pi/` | `subagents.json` en `.frida/` | Namespace Frida |
| `pi.events` RPC | `pi.sendMessage` con customType `frida-subagents-rpc` | Frida pattern |
| Scheduling (croner) | **No** en Fase 1 | Reducción de scope |
| Model scope enforcement | **Referencia** ADR-0017/0018/0019 | Ya documentado |

### 5.3 Coexistencia con frida-pipeline

```
frida-pipeline:
  - Sincroniza 15 agentes .md a ~/.frida/global/agents/
  - Sincroniza 27 skills a ~/.frida/skills/
  - Aporta hooks (guidance, git-context, skill-bracket, etc.)

frida-subagents:
  - Descubre agentes de ~/.frida/global/agents/ (los de frida-pipeline)
  - Descubre agentes de .frida/agents/ (proyecto)
  - Registra el tool Agent para que el modelo los spawn
  - NO duplica la sincronización — frida-pipeline es dueño de eso
```

**Sin colisión:** frida-pipeline sincroniza, frida-subagents consume.
Si pi-subagents también está instalado, los customType son distintos
(`frida-subagents-*` vs `subagents:*`).

### 5.4 Layout propuesto

```
src/tools/frida-subagents/
├── index.ts              # createFridaSubagents() factory: registra 3 tools + /agents
├── types.ts              # AgentConfig, AgentRecord (tipos centrales)
├── agent-runner.ts       # createAgentSession + tools scoping + max_turns
├── agent-manager.ts      # Concurrency queue + lifecycle + notifications
├── custom-agents.ts      # Descubre .md de .frida/agents/ + ~/.frida/global/agents/
├── default-agents.ts     # 3 defaults (general-purpose, Explore, Plan)
├── agent-types.ts        # Registry unificado + tool resolution
├── settings.ts           # subagents.json (.frida/ + ~/.frida/)
├── prompts.ts            # System prompt builder (replace/append)
├── context.ts            # buildParentContext (fork conversación)
├── output-file.ts        # Streaming JSONL transcripts
└── panel.tsx             # Widget React (fridaWeb) — agentes activos
```

### 5.5 Registro en pi-session.ts

```ts
{
  name: "frida-subagents",
  factory: createFridaSubagents(),
}
```

La factory registra los 3 tools via `pi.registerTool(defineTool(...))`.

---

## 6. Decisiones abiertas

| ID | Decisión | Opciones | Recomendación |
| --- | --- | --- | --- |
| D1 | **Nombre** | `frida-subagents` / `frida-agents` | `frida-subagents` (espejo de pi-subagents) |
| D2 | **Scheduling** | Incluir en Fase 1 / Diferir | Diferir (reduce scope, `croner` es dep nueva) |
| D3 | **Git worktree** | Incluir en Fase 1 / Diferir | Incluir (191 líneas, sin deps nuevas) |
| D4 | **Persistent memory** | Incluir / Diferir | Incluir (179 líneas, sin deps) |
| D5 | **UI widget** | React fridaWeb / Sólo notificaciones chat | React fridaWeb (paridad con pi-subagents) |
| D6 | **Defaults** | Heredar 3 de pi-subagents / Reescribir para Frida | Heredar (general-purpose, Explore, Plan) |
| D7 | **Cross-extension RPC** | pi.events / pi.sendMessage | pi.events (mismo bus de Pi, ya disponible) |
| D8 | **Agent discovery** | `.frida/agents/` + `~/.frida/global/agents/` | Sí (frida-pipeline ya sincroniza al global) |
| D9 | **Skill preloading** | Incluir / Diferir | Incluir (frida-pipeline ya sincroniza skills) |
| D10 | **Model fuzzy resolution** | Portear de pi-subagents / Simplificar | Portear (valor alto, ~80 líneas) |

---

## 7. Plan por fases propuesto

| Fase | Entregable | Gate |
| --- | --- | --- |
| 0 | ADR-0022 + este descubrimiento | Firmado |
| 1 | Esqueleto: factory + 3 tools (Agent, get_subagent_result, steer_subagent) | El modelo puede spawnar `general-purpose` y recibir resultado |
| 2 | Custom agents: descubre .md de `.frida/agents/` + `~/.frida/global/agents/` | Spawnar un agente de frida-pipeline (codebase-locator) |
| 3 | Defaults: Explore + Plan + concurrency queue | Background agents con notificaciones |
| 4 | Settings + graceful max_turns + steer | `/agents` command + max_turns con wrap-up |
| 5 | Worktree isolation + persistent memory + skill preloading | `isolation: worktree` commitea a branch |
| 6 | UI: widget React (fridaWeb) + panel de agentes activos | Widget muestra agentes corriendo en el webview |
| 7 | Release 0.3.0 (vsix + CHANGELOG + E2E) | Pruebas E2E verdes |

---

## 8. Riesgos

- **`createAgentSession` API drift**: pi-subagents comenta que Pi 0.80.8 cambió
  `modelRegistry` por `modelRuntime`. Frida usa la misma versión del SDK →
  mismo workaround.
- **Tools scoping**: pi-subagents tiene lógica compleja para filtrar tools por
  agente (ext: selectors, extensions allowlist, etc.). La Fase 1 puede simplificar
  a "todos los built-ins o un subconjunto fijo" y añadir el scoping completo en
  Fases posteriores.
- **UI TUI → webview**: los widgets de Ink (566+380+362 = 1308 líneas) son la
  parte más compleja de portear. La Fase 1 puede postergar la UI y usar sólo
  notificaciones en el chat (post).
- **Performance**: cada subagente crea una sesión completa de Pi. En
  concurrencia 4, son 4 sesiones simultáneas. Frida ya maneja esto con
  frida-workflow, pero hay que verificar que el extension host no se sature.

---

## 9. Conclusión

`frida-subagents` es el complemento natural de `frida-pipeline`: el pipeline
define los agentes, subagents les da vida al registrar el tool `Agent`. El porte
es viable con el patrón nativo (0 deps npm nuevas, SDK ya embebido). Las 8431
líneas de pi-subagents se reducen a ~3000-4000 en Frida (sin TUI Ink, sin
scheduling en Fase 1, sin .agents/ workspace).

El valor es alto: permite que el modelo decida autónomamente cuándo despachar
especialistas, en paralelo, con modelos optimizados — el patrón que hace que
Claude Code sea productivo.
