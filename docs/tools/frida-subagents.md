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

## Arquitectura

```text
src/tools/frida-subagents/
├── index.ts            # createFridaSubagents() factory + 3 tools
├── types.ts            # AgentConfig, AgentRecord, SpawnOptions
├── default-agents.ts   # 3 defaults (general-purpose, Explore, Plan)
├── custom-agents.ts    # descubre .md de .frida/agents/ + global
├── agent-runner.ts     # createAgentSession + ejecución + extracción resultado
└── agent-manager.ts    # registro de agentes (register/get/update/list)
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
