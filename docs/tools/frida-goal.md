# frida-goal — agente autónomo orientado a objetivos

> **Estado:** MVP implementado (issue #20, ADR-0031 fase 1). Porte nativo de
> [`@narumitw/pi-goal`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal).
> Para el uso diario ver [how-to-frida-goal.md](../how-to-frida-goal.md).

## Qué es (y qué no es)

`frida-goal` convierte a Frida en un **agente autónomo orientado a objetivos**: el
usuario da `/goal <objetivo>` y el **agente principal de la sesión** sigue trabajando
turn tras turn hasta completar (`goal_complete`), bloquearse de verdad
(`goal_blocked`), o agotar un guard de seguridad.

**No es un workflow** (ADR-0031 D1): es una **extensión reactiva del lifecycle**. Un
workflow de `frida-extensible-workflows` corre en un child worker aislado y lanza
sub-agentes amnésicos; frida-goal **inyecta continuaciones en la sesión principal**,
conservando todo el contexto acumulado. Ancho (fan-out) vs. profundo (loop
persistente).

## Arquitectura

```text
src/tools/frida-goal/
  state.ts       modelo ActiveGoal + guards puros (sin efectos, testeables)
  prompts.ts     prompts inyectados (porte del upstream, sin wait/queue)
  command.ts     parser de /goal (start/status/pause/resume/clear/edit + --tokens)
  persistence.ts estado thread-owned vía appendEntry (entrada custom de la sesión)
  runtime.ts     GoalRuntime: listeners del lifecycle + guards + inyección
  tools.ts       goal_complete / goal_blocked (con validación)
  index.ts       factory canónica + comando /goal
```

### El loop de continuación

1. `/goal <objetivo>` → runtime crea el `ActiveGoal`, persiste y envía el prompt
   inicial con marker `frida-goal-prompt:<goal_id>`.
2. El modelo trabaja (tools, bash — **todo pasa por el gate de permisos normal**).
3. `agent_end` (sin error ni guard disparado) → programa continuación
   (`pending = {goalId, marker: "goalId#N"}`).
4. `agent_settled` + `ctx.isIdle()` + sin pendientes → **único punto de inyección**:
   `pi.sendUserMessage(buildContinuePrompt(...))` con marker
   `frida-goal-continuation:goalId#N`.
5. `before_agent_start` clasifica el run por su marker (manual vs. automático) e
   inyecta `buildGoalSystemPrompt` al system prompt del run.
6. Se repite hasta `goal_complete` / `goal_blocked` / guard.

### Guards de seguridad

| Guard | Qué hace | Constante |
| --- | --- | --- |
| Cap de continuaciones | `automaticModelTurns ≥ 25` → pausa con aviso (sólo cuenta runs automáticos; el prompt inicial y tus mensajes no consumen) | `MAX_AUTOMATIC_MODEL_TURNS` |
| No-progreso | 3 outputs automáticos consecutivos con el MISMO fingerprint (sha256 del texto visible, NFKC/whitespace-insensible) y sin tool calls → pausa | `MAX_TOOL_FREE_REPEATS` |
| Budget de tokens | `tokensUsed ≥ tokenBudget` → pausa (`--tokens 100k` al lanzar) | — |
| Stale-turn | `goal_id` rotado en cada goal: las tools rechazan ids viejos | `newGoalId()` |
| Blocked con conteo | `goal_blocked` exige la misma razón ≥3 turnos + evidencia concreta | `MIN_BLOCKED_TURNS` |
| Input del usuario | Cualquier mensaje tuyo esteriliza la continuación pendiente y reinicia el epoch de seguridad (tú mandas) | — |
| Error de provider | abort → paused · quota/429 → paused · red/timeout → el host reintenta · otro error → blocked | `classifyAssistantError` |
| Single-flight | Nunca dos continuaciones en vuelo; `agent_settled` extra no re-inyecta | `pending` + `dispatching` |

### Persistencia

El estado vive como **entrada custom al final de la rama de la sesión**
(`appendEntry("frida-goal-state", {goal})`) — igual que el upstream. Consecuencias:
sobrevive reload de ventana y compaction (la entrada viaja en el árbol de la sesión),
y cambiar de sesión/fork restaura el estado de esa rama. `complete` es terminal: no
se restaura.

### Integración con Frida

- **Factory** `createFridaGoal(cb)` registrada en `pi-session.ts`
  (`extensionFactories`), siempre activa. NO se registra en las sesiones hijas de
  workflows (`createChildSession` lista curada — una hija no debe auto-continuarse).
- **Chip 🎯 del footer** (WorkspaceBar): el host publica
  `post({type:"goal_state", goal})` vía `onGoalState`; tinte por estado (azul
  activo, amarillo pausado/bloqueado, verde completo) + tooltip con objetivo,
  avance (`auto N/25`) y motivo del paro. `webview_ready` re-envía el último
  snapshot cacheado.
- **Avisos** (`onGoalNotify`) → panel de info del webview.
- Los prerequisitos del issue ya existían: `agent_settled`/`agent_end` llegan a las
  extensiones vía `pi.on` (el reemisado del host no es necesario para esto).

## Diferencias vs. el upstream (MVP)

| Upstream `pi-goal` | Frida MVP | Fase 2 |
| --- | --- | --- |
| 7 estados (+queued/usage_limited/budget_limited/waiting) | 4: active/paused/blocked/complete (los límites pausan con `pausedReason`) | — |
| `goal_wait` (espera de evento externo con deadline) | ❌ no portado | ✅ |
| Cola ordenada experimental (`/goal add`…) | ❌ (el upstream también la removió) | — |
| Tool-policy / tool-visibility dinámicos | ❌ tools siempre registrados | ✅ |
| Budget wrap-up (turno de cierre custom) | ❌ el budget pausa directo | ✅ |
| Menú TUI + statusline | QuickPick del SDK + chip 🎯 del footer (D4) | — |
| RPC para extensiones hermanas | ❌ | ✅ |
| Recovery de provider_retry/compaction como estados | clasificación de error simplificada (`classifyAssistantError`) | — |

## Pruebas

`test/frida-goal/` — 32 tests:

- `goal-core.test.ts` (21): parser de /goal (subcomandos, comillas, `--tokens`
  N/Nk/Nm, marcadores prohibidos), guards puros (fingerprint, no-progreso,
  clasificación de errores, restauración), prompts (markers extraíbles, trust
  boundary, escape) y persistencia (round-trip, complete no se restaura).
- `goal-runtime.test.ts` (11): flujo reactivo completo con mock `pi` — inyección
  single-flight en settled, host ocupado retiene, input esteriliza, tools con
  goal_id stale, cap 25, budget, error→blocked/abort→paused, resume con epoch
  limpio, restauración por session_start.
