# `frida-subagents`

> **Estado:** ✅ **v0.3.0 — Release completo** · [ADR-0022](../adr/0022-frida-subagents-porter-pi-subagents.md) · [análisis](../../.rpiv/artifacts/discover/2025-07-31_frida-subagents-porter-pi-subagents.md)

Sub-agentes autónomos estilo Claude Code. El modelo puede spawnar especialistas
que corren en sesiones hijas aisladas, cada una con su propio modelo, tools y
system prompt.

## ¿Qué es?

`frida-subagents` registra 3 tools del modelo (`Agent`, `get_subagent_result`,
`steer_subagent`) que permiten al agente padre despachar sub-agentes
autónomos. Cada subagente corre en una sesión de Pi aislada (via
`createAgentSession`), con su propio contexto, tools y modelo.

**Sinergia con frida-pipeline:** frida-pipeline define 15 perfiles de agente
`.md` y los sincroniza a `~/.frida/global/agents/`. frida-subagents los
descubre y los pone a disposición del modelo via el tool `Agent`.

## ¿Cuándo usarla?

Cuando el modelo necesita:

- **Paralelizar** trabajo independiente (buscar en múltiples áreas a la vez).
- **Proteger el contexto** del padre de resultados excesivos.
- **Usar especialistas** con tools o modelos optimizados (haiku para
  exploración, sonnet para análisis).

## Uso

El modelo invoca los tools directamente (no son slash commands):

```
Agent({
  subagent_type: "general-purpose",
  prompt: "Find all files that handle authentication",
  description: "Find auth files",
  run_in_background: true,
})
```

Foreground bloquea hasta completar; background devuelve un ID y notifica al
terminar.

## Agentes disponibles

**Defaults (3):**

| Tipo | Tools | Modelo | Descripción |
| --- | --- | --- | --- |
| `general-purpose` | todos | hereda | Gemelo del padre (hereda system prompt) |
| `Explore` | read, bash, grep, find, ls | rápido | Exploración read-only |
| `Plan` | read, bash, grep, find, ls | hereda | Arquitecto read-only |

**Custom:** `.md` con frontmatter en `.frida/agents/` (proyecto) o
`~/.frida/global/agents/` (global). Los 15 agentes de frida-pipeline están
disponibles automáticamente.

## Aislamiento en worktree (`isolation: worktree`)

Un agente con `isolation: worktree` (frontmatter) corre en una **copia aislada
del repo** (git worktree *detached* en `~/.frida/worktrees/<id>`), de modo que
su trabajo no toca el working tree actual. El ciclo de vida del worktree:

1. **Creación** — worktree *detached* en `HEAD`, preservando el subdirectorio si
   el agente se lanzó desde un cwd profundo de un monorepo (`workPath`).
2. **Al completar** (`cleanupWorktree`) — siempre **elimina el worktree**:
   - **Con cambios** → commitea (`pi-agent: <descripción>`), crea el branch
     `pi-agent-<id>` (con sufijo anti-colisión `-<timestamp>` si ya existe) y
     elimina el worktree. El **branch persiste** en el repo para revisión/merge.
   - **Sin cambios** → elimina el worktree sin dejar branch.
3. **Crash recovery** — al iniciar/cerrar sesión, `pruneAllWorktrees()` hace
   `git worktree prune` de los repos donde se crearon worktrees, para limpiar
   worktrees huérfanos de agentes interrumpidos antes de su cleanup.

> **Nota:** versiones previas del porte **no eliminaban el worktree** al
> completar (`cleanupWorktree` solo commiteaba), así que cada ejecución con
> aislamiento dejaba un directorio huérfano en `~/.frida/worktrees/`. El ciclo
> actual replica el comportamiento de `pi-subagents` y limpia tanto en
> foreground como en background y en el path de error/abort.

## Panel de subagentes (widget footer)

Mientras corren subagentes, un panel en el **footer** del webview muestra cada
agente con **progreso en vivo** (paridad con el panel "above editor" de
`pi-subagents`):

```text
● Agents (2 running)
  ⠼ codebase-analyzer  Analizar internals · ↻17 · 48 tools · 87.1k tok · 184s
    ⎿  reading 3 files…
  ⠼ codebase-analyzer  Extraer patrón · ↻14 · 32 tools · 73.5k tok · 184s
    ⎿  editing…
```

- **Stats**: `↻turnos≤max` · `N tools` · `N.Nk tok` · `elapsed`.
- **Activity line** (`⎿`): qué hace AHORA el subagente — `reading`,
  `editing 3 files`, `searching`, `thinking…` o un preview de su texto.
- **Foreground + background**: el progreso se refleja para todos los agentes
  (antes solo el foreground tenía vistazo en vivo).
- **Auto-hide**: el panel desaparece cuando no hay agentes; los completados se
  podan a los 10 s.

El flujo: cada sesión hija se suscribe vía `subscribeAgentProgress`
(`agent-runner.ts`), que alimenta un `activity-tracker` y, en cada cambio
(throttle ~6/s), actualiza `agentWidgetStore` — el store reactivo que lee
`AgentWidget.tsx`. El `details` `subagent_progress` también viaja al webview
para un futuro render rico de la tarjeta inline del tool `Agent`.

## Arquitectura

```text
src/tools/frida-subagents/
├── index.ts            # createFridaSubagents() factory + 3 tools
├── types.ts            # AgentConfig, AgentRecord, SpawnOptions
├── default-agents.ts   # 3 defaults (general-purpose, Explore, Plan)
├── custom-agents.ts    # descubre .md de .frida/agents/ + global
├── agent-runner.ts     # createAgentSession + ejecución + subscribeAgentProgress
├── agent-manager.ts    # registro de agentes + cola concurrencia + lifecycle worktrees (prune)
├── activity-tracker.ts # tracker de actividad en vivo (tools, turnos, tokens) + describeActivity
├── AgentWidget.tsx     # panel React del footer (fridaWeb) con progreso en vivo
├── store.ts            # agentWidgetStore reactivo (useSyncExternalStore)
├── panel.ts            # montaje idempotente del widget en el footer
└── worktree.ts         # git worktree create/cleanup/prune (aislamiento por agente)
```

## Estado y madurez

| Fase | Entregable | Estado |
| --- | --- | --- |
| 0 | ADR-0022 firmado | ✅ |
| 1 | Factory + 3 tools + general-purpose | ✅ |
| 2 | Custom agents + registry + tool scoping | ✅ |
| 3 | Concurrency queue + group join + notifications | ✅ |
| 4 | Settings + graceful max_turns + `/agents` | ✅ |
| 5 | Worktree isolation + memory + skill preloading | ✅ |
| 6 | UI widget React fridaWeb | ✅ |
| **7** | **Release 0.3.0 (vsix + CHANGELOG)** | **✅ (este doc)** |
