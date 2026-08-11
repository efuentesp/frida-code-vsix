# `frida-sdlc-loop`: Loop Engineering como arquitectura de referencia (composición)

**Estado:** aceptado (ADR de referencia; sin issue de implementación propia).
**Habilitado por:** #13 (worktree), #24 (background-tasks), #18 (token consumption).
**Optimizado por:** #20 (frida-goal, reactivo). **Observable vía:** #7 (panel).

## Contexto

*Loop Engineering* (video *What is Loop Engineering? A Practical Example in Codex*, DevExpert,
youtube `jkJaXP-hYx8`) **no es una herramienta ni un algoritmo — es una arquitectura de referencia**:
un bucle autónomo del SDLC donde agentes se coordinan de extremo a extremo. La tesis del video:
*"la teoría es simple, pero la práctica exige una arquitectura robusta de hilos de ejecución"*.

Sus **6 componentes**:

1. **Manager (Chief of Staff) thread** — orquestador con estado: descompone el proyecto en tareas,
   controla dependencias encadenadas, despacha workers, mantiene el estado del proyecto.
2. **Git Worktrees (aislamiento)** — cada worker desarrolla en su propio worktree → paralelismo sin
   conflictos.
3. **Workers autónomos + auto-PR** — cada worker implementa y crea un Pull Request a GitHub.
4. **PR Reviewer autónomo (heartbeats)** — revisor con latidos periódicos (polling) que
   revisa/aprueba/mergea.
5. **Resolución de conflictos + dependencias encadenadas** — si el PR B depende del A y A se mergea,
   B se rebasesa automáticamente.
6. **Human-in-the-loop** — validación humana en puntos clave (no autonomía total).

**Mapeo verificado contra el código de Frida** (`frida-extensible-workflows`, `frida-worktree`,
`frida-git-sync`, `gh` CLI v2.83.2):

- El runtime de workflows **ya registra** `workflow`, `workflow_status`, `workflow_stop`,
  `workflow_respond` (checkpoints), `workflow_retry`, `workflow_resume`, con `RunStore` que persiste
  estado a disco y soporte de worktree isolation (`WorktreeReference`, `parentRunId`,
  `createSpawnerForCwd`).
  *(Nota: el header comment de `index.ts` dice "sin background/checkpoints/retry/resume aún" — está
  desactualizado; el código ya los implementa. Corregir ese comentario es trabajo menor, fuera de este
  ADR.)*
- **Resultado del mapeo: 4 de 6 componentes listos; 1 parcial (manager always-on); 1 gap mayor
  (reviewer heartbeat). Frida está ~70% del camino.**

## Decisión

**D1 — Arquitectura de referencia, NO extensión nativa.** Loop Engineering es una **COMPOSICIÓN** que
reusa primitivas existentes + planeadas. Cero código nativo nuevo; el único deliverable nuevo sería una
**plantilla de catálogo** (`sdlc-loop`) que ensambla el bucle. Igual que #19 (capa de patrones sobre
workflows), no duplica el runtime: lo consume.

**D2 — Tres niveles de madurez**, cada uno factible sin re-arquitectura:

- **Nivel 1 — MVP one-shot (hoy, por feature).** Un workflow que ejecuta UN ciclo completo por
  invocación: `descomponer → parallel(workers, isolation:worktree) → cada worker gh pr create →
  review agent → checkpoint(human-gate) → merge aprobados + rebase dependientes`. Disparo manual;
  `workflow_resume` retoma si se interrumpe. **Requiere #13 validado.** Todo lo demás ya existe.
- **Nivel 2 — Loop continuo.** + **#24** (background-tasks = persistencia/heartbeat → manager always-on
  - reviewer con latidos) + **#18** (budget preciso para frenar el loop) + **#7** (observabilidad del
  loop). Sin #24 no hay loop continuo.
- **Nivel 3 — Loop reactivo (opcional).** + **#20** (frida-goal, `agent_settled`) → event-driven en vez
  de polling. Más eficiente. Prereq: exponer `agent_settled`/`agent_end` en el event layer.

**D3 — Mapeo de componentes LE → primitivas Frida:**

| Componente Loop Engineering | Primitiva Frida | Estado |
| --- | --- | --- |
| Manager thread (estado + dependencias) | `frida-extensible-workflows` (orquestador, `blockedBy`, `RunStore`, retry/resume) + **#24** (always-on) + opc. **#20** | 🟡 parcial |
| Worktree isolation | `frida-worktree` **#13** + runtime `WorktreeReference`/`parentRunId`/`createSpawnerForCwd` | 🟢 listo |
| Workers paralelos + auto-PR | `parallel(agent, isolation:worktree)` + **`gh` CLI vía bash** | 🟢 listo |
| PR Reviewer (heartbeat) | `agent` con patrón `code-review` (**#19**) + **#24** (latidos) | 🔴 gap (#24) |
| Conflictos + dependencias encadenadas | bash git (rebase/merge) + `blockedBy` + skill `resolving-merge-conflicts` | 🟢 listo |
| Human-in-the-loop | `workflow_respond` / `resolveCheckpoint` | 🟢 listo |
| Budget del loop (transversal) | `validateBudget` + **#18** (precisión subagentes) | 🟡 parcial |
| Observabilidad (transversal) | panel del workflow (**#7**, intermitente) | 🟡 parcial |

**D4 — Primitiva de PR: `gh` CLI vía bash, NO extensión nativa.** `gh` v2.83.2 ya expone
`pr create`/`review`/`merge`. Envolverlo como extensión sería redundante con bash. `frida-git-sync`
**se mantiene scoped a sincronización de config** (multi-device) — no asume operaciones generales de PR.

**D5 — Anti-redundancia.** Cero solapamiento con extensiones planeadas: consume **#13, #18, #19, #20,
# 24, #7** como piezas ensambladas. El único output nuevo es la plantilla `sdlc-loop` + este ADR.

**D6 — Cadena de dependencia y cuello de botella.**

```
#13 (worktree, validar) ─┐
#7  (panel) ─────────────┤
#18 (token consumption) ──┤──► Loop Engineering Nivel 2
#24 (background-tasks) ───┘        │  ← #24 es el cuello de botella
#20 (goal, opcional) ─────────────┴──► Nivel 3 (reactivo)
```

**#24 es el cuello de botella**: sin un proceso duradero independiente del editor, no hay loop
continuo ni reviewer con latidos. #18 y #7 son calidad/coste. #20 es optimización (reactivo vs
polling). #13 es prereq del Nivel 1.

## Alternativas consideradas

- **A — Extensión nativa nueva `frida-loop-engineering`.** Descartado: duplicaría orquestador + worktree
  - git; redundante con `frida-extensible-workflows`. Violentaría el principio de no-redundancia.
- **B — Portar un framework externo de "agent loop".** Descartado: Frida ya tiene el runtime de
  workflows; un framework externo pelearía con él y con su telemetría/checkpoints/budget.
- **C — GitHub Actions como reviewer heartbeat (sin #24).** Descartado como solución única: Frida corre
  local; Actions no tiene acceso al estado/orquestador local. Puede **complementar** (webhooks →
  trigger de un workflow), pero no reemplazar la capa duradera local de #24.

## Consecuencias

**Positivas**

- ~70% listo hoy; el MVP (Nivel 1) es factible con sólo validar #13.
- Reusa primitivas existentes (orquestador, worktree, git, checkpoints, budget) — sin re-arquitectura.
- Observable vía panel (#7) y gobernable vía checkpoints nativos (`workflow_respond`).
- Escalable por niveles: one-shot → continuo → reactivo, sin descartar trabajo previo.

**Negativas**

- Depende de 4 issues para el Nivel 2: #13 (validar), **#24 (crítico)**, #18, #7.
- Budget impreciso hasta #18 (tokens de subagentes no contabilizados) → el loop podría quemar la cuenta
  sin freno real.
- Loop one-shot hasta que #24 aterrice; no es "always-on" hasta entonces.
- El header comment desactualizado de `frida-extensible-workflows/index.ts` debe corregirse (trabajo
  menor, fuera del alcance de este ADR).

## Referencias

- Video fuente: *What is Loop Engineering? A Practical Example in Codex* (DevExpert,
  youtube `jkJaXP-hYx8`).
- Composición de: `frida-extensible-workflows` · `frida-worktree` (**#13**) · `gh` CLI · checkpoints
  (`workflow_respond`) · **#18** (token consumption) · **#19** (ADR-0030, patrón code-review) ·
  **#20** (ADR-0031, frida-goal) · **#24** (ADR-0035, frida-background-tasks) · **#7** (panel).
- Skill relevante: `resolving-merge-conflicts` (resolución de conflictos del componente 5).
