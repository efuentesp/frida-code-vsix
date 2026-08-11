# Porte nativo de `pi-goal` como extensión `frida-goal` (no workflow)

**Estado:** aceptado (issue #20).

## Contexto

[`@narumitw/pi-goal`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal)
convierte a Pi en un **agente autónomo orientado a objetivos**: el usuario da `/goal <objetivo>` y el
**agente principal de su sesión** continúa trabajando turn tras turn hasta completar
(`goal_complete`), bloquearse de verdad (`goal_blocked`), esperar un evento externo (`goal_wait`),
o agotar un guard de seguridad (25 respuestas / no-progreso / budget de tokens).

La característica decisiva es que pi-goal **no es una orquestación procedural**: es una **extensión
reactiva del lifecycle del host**. Su mecanismo se apoya en primitivas que ningún workflow aislado
tiene:

- Escucha eventos del host: `before_agent_start`, `agent_start`, `turn_end`, `agent_end`,
  **`agent_settled`** (el *idle boundary*) y compaction.
- Chequea `ctx.isIdle()` + ausencia de mensajes pendientes.
- **Inyecta un prompt de continuación en la sesión principal** (`sendUserMessage`) sólo cuando el
  agente está *settled*, tras drenar retries, compaction, steering y follow-ups.
- Mantiene **estado persistente por sesión** (thread-owned, modelo Codex):
  `active`/`paused`/`blocked`/`usage_limited`/`budget_limited`/`complete`/`waiting`.
- Registra **tools terminales** en la sesión principal (`goal_complete`, `goal_blocked`,
  `goal_wait`), con guards sutiles: stale-turn guard (`goal_id` rotado), single-flight dispatcher,
  clasificación de errores de provider, compaction-safe.
- Ofrece UX: comando `/goal`, menú TUI state-aware, statusline, cola ordenada experimental, RPC
  sobre `pi.events` para extensiones hermanas.

Frida ya dispone de `frida-extensible-workflows` (ADR-0028): un runtime procedural de workflows que
ejecuta scripts JS en un **child worker aislado (VM sandbox)**, terminantes (`agent()`→…→`return`).
La pregunta de diseño es si pi-goal se emula ampliando ese runtime o si se porta como extensión
nativa.

## Decisión

**D1 — Extensión nativa `frida-goal`, no workflow.** Se porte `pi-goal` como un módulo nativo
`src/tools/frida-goal/` con su propia máquina de estado reactiva, **acoplada al lifecycle del
host**. No se reutiliza el runtime de `frida-extensible-workflows`: su VM sandbox aislada no expone
ni los eventos del host ni la inyección en la sesión principal que pi-goal requiere por definición.

**D2 — Prerequisito: reemitir `agent_settled` / `agent_end`.** Estos eventos los provee el SDK
(`@earendil-works/pi-coding-agent` `0.81.1` ≥ `0.80.6`, mínimo declarado por pi-goal), pero la capa
de eventos de Frida **no los propaga hoy** (sí reemite `turn_end`, `compaction_start/end`,
`cancel_compaction`). Habilitarlos es trabajo de integración en `extension.ts` / `pi-session.ts`,
no bloqueante. Sin `agent_settled`, la continuación segura (drenar retries/compaction/steering) no
es fiable.

**D3 — Alcance (MVP + fase 2).** *MVP:* comando `/goal <objetivo>` (+ `status`/`pause`/`resume`/
`clear`/`edit`), continuation loop reactivo, tools `goal_complete` + `goal_blocked` con validación,
estados básicos (`active`/`paused`/`blocked`/`complete`), guards (25-turn / no-progreso / budget de
tokens), token accounting de la sesión principal, persistencia thread-owned compaction-safe y status
bar. *Fase 2 (fuera del MVP):* `goal_wait`, cola ordenada experimental, RPC para extensiones
hermanas, tool-visibility `after-first-goal`.

**D4 — Adaptación de UI al shell de VS Code.** El menú TUI de pi-goal y su statusline se trasladan
a superficies de VS Code: **QuickPick/panel** para el gestor de estado y la confirmación de acciones
destructivas, y **status bar** para el estado compacto (`active 3m · automatic 12/25`, etc.). No se
porta el TUI de pi.

**D5 — Cero conflicto.** La superficie que `frida-goal` registra (tools `goal_complete`/
`goal_blocked`/`goal_wait` + comando `/goal`) es **nueva**, no duplicada: ningún módulo de Frida la
reclama hoy. A diferencia del caso de `pi-dynamic-workflows` (ADR-0030), donde el riesgo de
conflicto era un *tool `workflow` duplicado*, aquí no hay colisión posible.

### Capacidades de Frida hoy vs. lo que falta

| Pieza que pi-goal necesita | Frida |
| --- | --- |
| Inyectar en sesión principal | ✅ `pi.sendUserMessage(prompt, {deliverAs:"followUp"})` — ya lo usa `frida-git-sync` |
| `turn_end`, `compaction_start/end`, `cancel_compaction` | ✅ ya reemitidos |
| `session.isIdle()` | ✅ disponible |
| Registro de tools / persistencia | ✅ |
| **`agent_settled` / `agent_end`** | ⚠️ el SDK los provee; falta reemitirlos (D2) |

## Alternativas consideradas

- **A — Workflow que emula pi-goal sobre `frida-extensible-workflows`.** Un script procedural con un
  loop `while(!done){ agent(...) }`. **Descartada** por *mismatch arquitectónico* total: cada
  `agent()` es un subagente nuevo sin memoria de la conversación principal; el worker aislado no
  recibe `agent_settled`/`turn_end` ni puede inyectar en la sesión del usuario; no puede registrar
  tools terminales ni escuchar eventos externos (`goal_wait`); su panel es genérico, no el gestor de
  goal. El resultado sería una caricatura sin lo esencial de pi-goal.

- **Contraste con ADR-0030.** Allí las features de `pi-dynamic-workflows` son **procedurales**
  (patrones sobre `agent()`/`parallel()`) → se amplían como **capa de patrones** sobre el runtime
  existente. Aquí las features son **reactivas al lifecycle** → no son procedurales → exigen una
  **extensión nativa**. Por eso la conclusión es la inversa, y en ambos casos **sin producir
  conflictos** entre módulos.

## Consecuencias

**Positivas**

- **Fidelidad**: porta la máquina de estado reactiva completa, integrada con la sesión principal.
- **Reutiliza** piezas ya presentes en Frida (`sendUserMessage`, `turn_end`, compaction, `isIdle`).
- **Sin conflicto**: superficie nueva, no duplicada (D5).
- **Patrón Frida**: sigue la línea de portear paquetes pi como módulos nativos
  (`frida-worktree`, `frida-extensible-workflows`, `frida-supi-web`, …).

**Negativas**

- **Porte sustancial**: ~3 160 LOC de src + 20 archivos de test. Sistema sutil (stale-turn guard,
  single-flight, clasificación de errores, compaction-safe).
- **Prerequisito D2**: exige exponer `agent_settled`/`agent_end` antes del MVP.
- **Mantenimiento**: seguir el upstream de `@narumitw/pi-goal` (versiona rápido).
- **Adaptación UI**: traducir el TUI/statusline de pi a QuickPick/panel/status bar de VS Code.

## Referencias

- Issue **#20** (este trabajo).
- ADR-0030 — contraste: patrones *procedurales* → capa sobre workflows (caso inverso al de aquí).
- ADR-0028 — `frida-extensible-workflows` (runtime procedural que aquí **no** se reutiliza).
- Upstream: <https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal>.
