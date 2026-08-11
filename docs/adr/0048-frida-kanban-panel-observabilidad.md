# `frida-kanban`: panel Kanban de observabilidad

**Estado:** aceptado (#36). No bloqueado.

## Contexto

La "Kanban queue" del modelo *Agentic Engineering* (video *"FORGET Loop Engineering"*, IndyDevDan,
youtube `VQy50fuxI34`) requiere visibilidad del flujo scout→plan→build→test como un board.
`pi-kanban` (NikiforovAll) resuelve esto, pero como **dashboard web externo** (Vitepress + web app)
que no encaja en el webview React de Frida. Frida construye su panel nativo, **reusando la capa de
datos** de pi-kanban.

## Decisión

**D1 — Nueva extensión independiente (panel de rendering, read-only).** Agrega跨-subsistemas (todos +
subagent-sessions + workflow-runs) en columnas. Ningún subsistema actual posee esa vista unificada
(el WorkflowPanel muestra progreso de runs; ApprovalCard muestra aprobaciones — ninguno muestra el
board de tickets).

**D2 — Extraer de `pi-kanban` la capa de datos y parsers** (NO la web UI):

- `lib/pi-parsers.js` (1155 LOC) — parsea estado (sessions/todos/subagents) al data model del board.
  **Directamente portable.**
- `lib/task-store.js` (152 LOC) — modelo del task store.
- `lib/git-branch.js` — parsing de branch (asociación ticket↔columna↔worktree).
- `extensions/kanban.ts` (519 LOC) — patrones de comando (session open/pin/sticky-pin/link-doc).

**D3 — Frida-original:** el componente board en **React** (webview de Frida) y la integración con los
**stores de Frida** (workflow store de `frida-extensible-workflows`, subagent store de
`frida-subagents`). La web UI de pi-kanban (Vitepress) se descarta.

**D4 — NO es orquestador.** Es **observabilidad** read-only. La cola duradera es **#24**
`frida-background-tasks`. Distinto del WorkflowPanel (progreso de run, no board).

**D5 — Cero conflicto.** Read-only aggregation. Peer (lectura): `frida-subagents`,
`frida-extensible-workflows`, todos. Hoja del grafo (sin dependencias futuras).

## Alternativas consideradas

- **A — Portear `pi-kanban` directo (dashboard web).** Descartado: es web app externa (Vitepress); no
  encaja en el webview React de Frida. Se extrae la **capa de datos**, no la UI.
- **B — Plegar en el WorkflowPanel.** Descartado: el WorkflowPanel muestra progreso de runs; el
  Kanban es un board de tickets跨-subsistemas — responsabilidad distinta.

## Consecuencias

**Positivas**

- Visibilidad unificada del flujo de fábrica (todos + subagents + runs).
- Reusa la capa de datos de `pi-kanban` (1155+152 LOC de parsers) — no se inventa de cero.

**Negativas**

- Prioridad media (observabilidad, no habilitador crítico).
- Depende de que `frida-subagents` + `frida-extensible-workflows` expongan estado legible.

## Referencias

- Issue **#36**.
- Origen conceptual: video *"FORGET Loop Engineering"* (IndyDevDan, youtube `VQy50fuxI34`).
- **Extraíble de:** `pi-kanban` (NikiforovAll, MIT, `lib/pi-parsers.js` 1155 LOC +
  `lib/task-store.js` 152 LOC + `extensions/kanban.ts` 519 LOC).
- Peer (datos): `frida-subagents` · `frida-extensible-workflows` · todos.
- Distinto de: **#24** (cola duradera) · WorkflowPanel (progreso de run).
