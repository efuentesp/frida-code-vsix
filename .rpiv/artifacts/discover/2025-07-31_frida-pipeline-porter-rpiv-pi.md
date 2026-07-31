# Análisis: porte de la funcionalidad `rpiv-pi` → `frida-code`

> **Estado:** ✅ descubrimiento cerrado — `status: ready`.
> Decisiones abiertas **resueltas** (ver §5). Próximo paso: **ADR-0021** +
> spike de Fase 1 (esqueleto + banner + detección de siblings).
>
> **Fuentes consultadas (in-repo):**
>
> - `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/{README,package,docs}/*`
> - `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-{args,workflow,todo,ask-user-question,advisor,web-tools,i18n}/*`
> - `src/extension.ts`, `src/tools/frida-{workflow,args,context,permission-system,agent-browser}/*`
> - `docs/adr/0020-frida-workflow-porte-nativo.md`, `docs/frida-workflow-design.md`
> - `docs/tools/{frida-workflow,frida-args}.md`
>
> **Convenciones del repo:** todas las conversaciones / creación / edición de
> archivos en español de México (`AGENTS.md`).

---

## 1. Resumen ejecutivo

`rpiv-pi` es un **paquete orquestador puro** sobre Pi Agent: registra **cero
tools** propios, pero aporta 27 skills, 15 subagentes, 3 workflows `/wf`
(`build`/`vet`/`polish`), hooks de sesión (guidance + git-context), un dock de
"lanes" con progreso en vivo, un picker de modelos en cascada, y un sistema de
artefactos `.rpiv/artifacts/` que se revisan entre etapas. Todo eso delegando
las capacidades a **paquetes hermanos** (`rpiv-workflow`, `rpiv-args`,
`rpiv-todo`, `rpiv-ask-user-question`, `rpiv-advisor`, `rpiv-web-tools`,
`rpiv-i18n`, `rpiv-warp`).

`frida-code` ya porta **cinco** de esos paquetes hermanos como extensiones
nativas embebidas (`frida-workflow`, `frida-args`, `frida-context`,
`frida-permission-system`, `frida-agent-browser`). Lo que **no** existe aún es
el **equivalente Frida del orquestador `rpiv-pi`** — el pegamento que ata todo
eso, expone las skills, sirve los workflows pre-construidos, inyecta guidance
y contexto de git, y muestra un dock de progreso en el webview.

**El patrón ya está en el repo** (ADR-0020): porte nativo, 0 dependencias npm
nuevas, reusa el SDK de Pi ya embebido en Frida. El trabajo pendiente es
**horizontal** (cubrir el resto de las capacidades `rpiv-*`) y luego el
**vertical** (un orquestador `frida-pipeline` que las ate).

---

## 2. Inventario de capacidades de `rpiv-pi`

### 2.1 Lo que el paquete `rpiv-pi` registra en Pi

| Categoría | Elemento | Mecanismo |
| --- | --- | --- |
| **Extensión** | `extensions/rpiv-core/` (52 archivos TS) | Una sola extensión, índice `index.ts` es un *table of contents* que llama 12 registradores |
| **Skills** | 27 directorios bajo `skills/` | Manifiesto `pi.skills: ["./skills"]` — Pi los descubre como SKILL.md con frontmatter |
| **Agentes** | 15 archivos `.md` bajo `agents/` | **NO** vía manifiesto — se copian a `<agent dir>/agents/` en cada `session_start` con sha256 por archivo |
| **Workflows** | 3 (`build`/`vet`/`polish`) | Registrados programáticamente en `rpiv-workflow` via `registerBuiltIns()` (no en disco) |
| **Slash cmds** | `/rpiv-setup`, `/rpiv-update-agents`, `/rpiv-models`, `/lanes` | `pi.registerCommand` |
| **Flags** | `--rpiv-debug` | `pi.registerFlag` |
| **Hotkey** | `ctrl+q` (reconfigurable via `RPIV_LANES_HOTKEY`) | `pi.registerHotkey` (o se omite si la env var es `off`) |
| **Session hooks** | `session_start`, `session_compact`, `session_shutdown`, `tool_call`, `before_agent_start`, `input`, `agent_end` | `pi.on(...)` — siempre en ese orden; algunos *root-gated* (no se registran en sesiones hijas) |

### 2.2 Las 27 skills (cuatro cohortes)

**Intent + research (4):** `discover`, `research`, `explore`, `slice`
**Design (4):** `design`, `design-slice`, `design-review`, `synthesize`
**Planning (5):** `plan`, `blueprint`, `elaborate`, `revise`, `amend`
**Execution + verification (6):** `implement`, `validate`, `code-review`,
`architecture-review`, `grade`, `commit`
**Repo utilities (8):** `pr-triage`, `create-handoff`, `resume-handoff`,
`annotate-guidance`, `annotate-inline`, `migrate-to-guidance`, `changelog`,
`frontend-design`

**Convención común** que **debe replicarse en Frida**:

- Frontmatter con `contract: { produces, consumes }` (typed I/O) — el runner
  rutea salida → entrada sin nombrar paths.
- `disable-model-invocation: true` en 18 de 27; el modelo NO las invoca por sí
  mismo, sólo se llaman via `/skill:` o como etapa de workflow.
- `argument-hint:` + `shell-timeout:` (gates de seguridad de la skill).
- Cada skill escribe a un bucket bajo `.rpiv/artifacts/`: `discover/`, `research/`,
  `solutions/`, `slices/`, `designs/`, `plans/`, `subplans/`, `elaborations/`,
  `verdicts/`, `reviews/`, `validation/`, `architecture-reviews/`, `triage/`,
  `handoffs/`.
- Las 27 comparten helpers en `skills/_shared/*.mjs` (scripts Node
  determinísticos que invocan via `` !`node …` ``).

### 2.3 Los 15 subagentes (perfiles `.md`)

**Codebase (6):** `codebase-locator`, `codebase-analyzer`,
`codebase-pattern-finder`, `integration-scanner`, `scope-tracer`,
`precedent-locator`.
**Review/verificación (6):** `claim-verifier`, `diff-auditor`,
`peer-comparator`, `slice-verifier`, `artifact-code-reviewer`,
`artifact-coverage-reviewer`.
**Artefactos + web (3):** `artifacts-locator`, `artifacts-analyzer`,
`web-search-researcher`.

Se copian a `~/.pi/agent/agents/` (global) y se gestionan con un manifiesto
`.rpiv-managed.json` que respeta ediciones del usuario. En Frida el
equivalente natural sería copiarlos a `<frida.agentDir>/agents/` (ADR-0010
define ese directorio propio).

### 2.4 Los 3 workflows pre-construidos

| Workflow | Cadena de etapas | Cuándo usarlo |
| --- | --- | --- |
| `build` | `goal → research → slice → slice gate (+ fix loop) → design-slice (parallel fanout) → design-review → synthesize → plan gate → elaborate (parallel fanout) → re-grade → implement → validate → commit` | Brief de feature desde cero. 3 gates automáticos + 1 checkpoint humano. |
| `vet` | `code-review → (blueprint → implement → validate → loop) | commit` | Auditar cambios existentes (tuyos o de un PR). |
| `polish` | `architecture-review → blueprint (per phase) → implement → validate → code-review → (blueprint loop | commit)` | Refactor basado en review arquitectónico. |

`build` es el **workflow insignia**: captura el brief como `goal/`, lo slice,
diseña cada slice en paralelo, checkpoint de interfaces, sintetiza
jerárquicamente, gradea el plan antes y después de elaborar, implementa,
valida, commitea. La **cadena** está descrita en
`~/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/extensions/rpiv-core/built-in-workflows.ts`
(201 KB — la friolera de detalle declarativo).

### 2.5 Hooks de sesión (la "magia" invisible)

1. **Guidance injection** — En cada `read`/`edit`/`write`, `rpiv-pi` camina
   del project root al directorio del archivo; en cada nivel, elige el
   primero que exista de `AGENTS.md` > `CLAUDE.md` > `.rpiv/guidance/<sub>/architecture.md`.
   Nivel 0 se salta `AGENTS.md`/`CLAUDE.md` (Pi ya los inyecta). Inyecta
   como mensaje oculto con `customType: "rpiv-guidance"`. Deduplicado por
   path en un `Set` en proceso, limpiado en `session_start`/`session_compact`/`session_shutdown`.
2. **Git context** — Branch + short commit + user se inyectan en
   `session_start`, re-inyectan tras `session_compact`, y en
   `before_agent_start` sólo si cambiaron. Un bash que mutea git invalida
   el cache. `customType: "rpiv-git-context"`. Si git falla, salta la
   inyección silenciosamente.
3. **Pipeline pointer** — 18 skills tienen `disable-model-invocation: true`,
   así que el modelo no las ve en su lista. Un índice de ~120 tokens de
   los stages se inyecta en `session_start` para que el modelo sepa que
   existen y pueda sugerir una.
4. **Skill bracket** — Intercepta `/skill:<name> <args>` y aplica override
   de modelo/esfuerzo (lee `~/.config/rpiv-pi/models.json`).

### 2.6 Acoplamiento entre hermanos (siblings)

`rpiv-pi` **no importa estáticamente** a sus hermanos. La presencia se
detecta por regex case-insensitive sobre `packages[]` en
`<agent dir>/settings.json`. Solo dos hermanos se importan dinámicamente
en runtime, ambos detrás de guards "module-not-found" para degradar
silenciosamente: `rpiv-workflow` (workflows built-in, execution host,
skill-contracts) y `rpiv-warp` (badge "Blocked" en preguntas parqueadas,
totalmente opt-in).

Esto es **clave** para el porte: la Frida-pipeline debe detectar
`frida-workflow`/`frida-args`/`frida-context`/etc. por presencia y
degradar silenciosamente si falta alguno.

### 2.7 Orden de registro

Load-bearing. Los hooks de sesión, `/rpiv-update-agents` y `/rpiv-setup`
se registran **incondicionalmente y primero** para que un install limpio
sin hermanos aún muestre el banner de "missing siblings" y pueda
auto-instalarse. Los tres registradores que dependen de `rpiv-workflow`
van en cadena **estricta** (no concurrentes) para evitar una race con
jiti donde el barrel de rpiv-workflow se importa a medio inicializar y
los getters leen submódulos no evaluados.

---

## 3. Estado actual en `frida-code`

### 3.1 Lo que ya está portado (5 extensiones nativas)

| Extensión Frida | Equivalente rpiv | Estado | ADR |
| --- | --- | --- | --- |
| `frida-workflow` | `rpiv-workflow` | ✅ Motor completo (Fases 0–8, 243 tests) | ADR-0020 |
| `frida-args` | `rpiv-args` | ✅ Porte completo | (D33) |
| `frida-context` | `rpiv-todo` (vecino) | ✅ Snapshot de presión de contexto | ADR-0015 |
| `frida-permission-system` | `rpiv-ask-user-question` (vecino) | ✅ Gates + approval bridge | ADR-0016 |
| `frida-agent-browser` | `rpiv-web-tools` (vecino) | ✅ Browser automation con fridaWeb | (D30) |

**Patrón común (D14/D15/D27/D28):** porte nativo, 0 dependencias npm nuevas,
reusa SDK de Pi embebido. Cada puerto se documenta en `docs/tools/*.md` con
un doc por extensión.

### 3.2 Lo que falta para llegar a paridad con `rpiv-pi`

| Capacidad de rpiv-pi | Estado en Frida | Brecha |
| --- | --- | --- |
| 27 skills (SKILL.md) | ❌ No existe `.frida/skills/` | Crear 27 SKILL.md, adaptados a Frida (idioma: español; citan herramientas Frida, no `pi`) |
| 15 subagentes (`.md`) | ❌ No existe `<frida.agentDir>/agents/` | Crear 15 perfiles `.md`, copiar a `<frida.agentDir>/agents/` con sync de sha256 |
| 3 workflows pre-construidos | ❌ No existen como configs en `dist/frida-workflow.js` | Crear 3 configs (`build.ts`, `vet.ts`, `polish.ts`), registrarlos en `load/layers.ts` como built-ins |
| Guidance injection (AGENTS.md/CLAUDE.md/architecture.md) | ⚠️ Parcial — el resource loader de Pi ya carga `AGENTS.md`/`CLAUDE.md` del cwd; falta el walk per-depth | Crear `extensions/frida-guidance/` que extienda con el walk recursivo + el `<sub>/architecture.md` |
| Git context injection | ❌ No existe | Crear `extensions/frida-git-context/` (mismo patrón) |
| Pipeline pointer (~120 tokens) | ❌ No existe | Bloque de system prompt inyectado en session_start con índice de skills |
| Skill bracket (`/skill:` → override) | ❌ No existe (Frida ya tiene `/skill:` nativo del SDK; falta el override de modelo) | Crear `extensions/frida-skill-bracket/` que lee `models.json` (si existe) |
| Models config picker (`/rpiv-models`) | ❌ No existe (Frida tiene `frida.setKey` y `frida.activeModel` pero no un cascade picker) | Crear comando con UI en fridaWeb; schema en `frida-config` (no existe aún) |
| Lane dock (progreso en vivo) | ⚠️ `frida-workflow` ya tiene `WorkflowPanel` + `lifecycle.ts` (12 hooks) + `store.ts` reactivo | Reusar el panel como "lane" del orquestador; añadir banner de "siblings missing" |
| Setup command (`/rpiv-setup`) | ❌ No existe | Como Frida no instala paquetes npm (todo embebido), el equivalente es **validar que las 5 extensiones están montadas** y dar un botón "reiniciar y re-montar" |
| `--rpiv-debug` flag | ❌ No existe (Frida tiene su propio `--frida-debug` si existe) | Reusar el patrón |
| Artifact buckets `.rpiv/artifacts/` | ❌ No existe (carpeta vacía) | Crear helper que resuelva `.frida/artifacts/` (espejo del namespace Frida) |
| Banner al iniciar (missing siblings) | ❌ No existe | Banner de bienvenida en fridaWeb al activar la extensión |

### 3.3 Lo que **no** se debería portar (decisiones del repo)

- **`rpiv-i18n`** (TUI strings) — Frida no es TUI, es webview; ya tiene su
  propio manejo i18n via `frida.webviewI18n` (no implementado pero reservado).
- **`rpiv-warp`** (badge "Blocked") — depende de TUI, irrelevante.
- **Lane dock estilo Ink TUI** — Frida ya tiene un patrón equivalente:
  `WorkflowPanel` con `useSyncExternalStore`. No replicar el dock de rpiv,
  **reusar** `WorkflowPanel` y `frida.lifecycle` que ya están en
  `frida-workflow`.

---

## 4. Diseño propuesto: el orquestador Frida

### 4.1 Nombre tentativo

`frida-pipeline` (espejo de `rpiv-pi`). Siguiente ADR después de
ADR-0020 (frida-workflow). Cita D33 (frida-args), D30 (frida-agent-browser),
D28 (frida-context), D27 (frida-permission-system), ADR-0010 (frida.agentDir).

### 4.2 Estructura de carpetas

```
src/tools/frida-pipeline/
├── index.ts                  # createPipelineExtension(pi) — registro principal
├── siblings.ts               # detección de extensiones hermanas (espejo de rpiv-core/siblings.ts)
├── session-hooks.ts          # guidance + git-context + pipeline pointer
├── guidance.ts               # walk recursivo de AGENTS.md / CLAUDE.md / architecture.md
├── git-context.ts            # git rev-parse + user.name → customType: "frida-git-context"
├── pipeline-pointer.ts       # índice de skills para session_start
├── skill-bracket.ts          # override de modelo en /skill: (lee frida.models.json)
├── models-config.ts          # schema + cascade picker
├── models-picker-ui.tsx      # UI fridaWeb para /frida-models
├── banner.ts                 # banner de "siblings OK / missing" al iniciar
├── setup-command.ts          # /frida-setup (valida montajes + ofrece "reiniciar")
├── setup-preview-ui.tsx      # preview de cambios antes de aplicar
├── agents-sync.ts            # copia 15 .md a <frida.agentDir>/agents/ con sha256
├── workflows/                # los 3 built-in
│   ├── build.ts              # cadena: discover → research → slice → design-slice[] → design-review → synthesize → plan → elaborate[] → implement → validate → commit
│   ├── vet.ts                # cadena: code-review → (blueprint → implement → validate → loop) | commit
│   └── polish.ts             # cadena: architecture-review → blueprint (per phase) → implement → validate → code-review → (blueprint loop | commit)
├── skills/                   # 27 SKILL.md (espejo de rpiv-pi/skills/)
│   ├── _shared/              # scripts Node determinísticos (now.mjs, git-changes.mjs, etc.)
│   ├── discover/SKILL.md
│   ├── research/SKILL.md
│   ├── ... (los 27)
└── agents/                   # 15 .md (espejo de rpiv-pi/agents/)
    ├── codebase-locator.md
    ├── ... (los 15)
```

### 4.3 Manifiesto `package.json` de la extensión

```json
"contributes": {
  "frida.extensions": [{
    "id": "frida-pipeline",
    "main": "./dist/tools/frida-pipeline/index.js",
    "commands": [
      "/frida-setup", "/frida-models", "/frida-update-agents",
      "/frida-lanes"  // equivalencia con /lanes; reusa WorkflowPanel + lifecycle
    ],
    "skills": ["./skills"],          // 27 SKILL.md
    "agents": ["./agents"],          // 15 .md (manejados por agents-sync, no por el manifiesto)
    "dependsOn": [                    // detección de hermanas (siblings)
      "frida-workflow", "frida-args", "frida-context",
      "frida-permission-system", "frida-agent-browser"
    ]
  }]
}
```

### 4.4 Detección de hermanas (siblings) — el patrón crítico

Igual que rpiv-pi: **regex case-insensitive** sobre las extensiones
registradas en el `ExtensionContext` que Frida expone a su `defaultAgentDir`.
No se hace import estático; los `await import(...)` van detrás de guards
"module-not-found". El orden de registro es load-bearing: lo incondicional
primero (session hooks, `/frida-update-agents`, `/frida-setup`, banner),
lo dependiente de hermanas al final y en cadena estricta.

### 4.5 Adaptaciones necesarias vs `rpiv-pi`

1. **Sin Ink TUI** — el dock de lanes es el `WorkflowPanel` de Frida
   (existente en `frida-workflow/lifecycle.ts` + `store.ts` +
   `WorkflowPanel.tsx`). `frida-pipeline` reusa esos hooks, no los
   duplica.
2. **Sin `~/.pi/agent/` global** — Frida usa `<frida.agentDir>` (ADR-0010)
   por workspace, no global. **Decisión abierta:** ¿los 15 agentes
   deben ser globales (compartidos entre proyectos) o por workspace?
   rpiv-pi los hace globales. Recomiendo **global** para paridad, con
   `<frida.agentDir>/../global/agents/` como ubicación.
3. **Sin bash watchdog equivalente a `RPIV_BASH_TIMEOUT_MS`** — Frida ya
   tiene su propio gate de aprobación (`frida-permission-system`), así
   que el `bash-timeout.ts` de rpiv-pi no aplica (el gate pausa el
   comando pidiendo aprobación humana, no hay wall-clock duro).
4. **`AGENTS.md` ya existe en el repo** — Frida (igual que Pi) ya lo
   inyecta en el system prompt. El walk per-depth de guidance.ts debe
   respetar eso y empezar por debajo del nivel 0 para `AGENTS.md`/
   `CLAUDE.md`, pero checar `.rpiv/guidance/<sub>/architecture.md` (o
   equivalente Frida: `.frida/guidance/<sub>/architecture.md`) en
   todos los niveles.
5. **Idiomas** — todas las skills deben escribirse en español de México
   (convención `AGENTS.md` del repo). Los scripts `_shared/*.mjs`
   también.
6. **`customType` prefix** — usar `frida-guidance`, `frida-git-context`,
   `frida-pipeline-pointer` (en vez de `rpiv-*`) para no colisionar
   si un usuario carga también rpiv-pi en su sesión.
7. **Artefactos** — usar `.frida/artifacts/` (no `.rpiv/`) como raíz
   para evitar colisión con rpiv-pi si coexisten.

### 4.6 Riesgos y orden recomendado

**Riesgos principales:**

- **Disco:** 27 skills × ~10 KB + 15 agentes × ~5 KB = ~350 KB de docs.
  Trivial.
- **Complejidad del orquestador:** el `index.ts` de `rpiv-pi` tiene
  6.6 KB pero coordina 12 registradores; el de Frida debería ser
  similar en tamaño. La complejidad está en los archivos que llama.
- **Pruebas:** rpiv-pi tiene `scripts/*.test.ts` excluidos del
  `files:` del package.json. Frida tiene `vitest`; replicar.
- **Coexistencia con rpiv-pi:** si un usuario carga ambos (no debería,
  pero podría), los `customType` distintos y la detección de siblings
  separada lo manejan. **Documentarlo explícitamente.**

**Orden recomendado para implementación (gates por fase):**

| Fase | Entregable | Gate |
| --- | --- | --- |
| **0. Spike** | Decidir nombre final (`frida-pipeline` vs `frida-orchestrator`), ubicación de agentes, ubicación de artefactos | ADR-0021 firmado |
| **1. Esqueleto** | `extensions/frida-pipeline/index.ts` mínimo (sólo banner + setup-cmd) + detección de siblings | Banner muestra "OK" / "missing X" correctamente |
| **2. Guidance + git-context** | Walk recursivo + inyección oculta + script git-context.mjs | Un test end-to-end: editar un archivo bajo `src/tools/frida-permission-system/` y verificar que la guidance de la carpeta llega al modelo |
| **3. Skill bracket + models picker** | `/frida-models` con cascade picker + lectura/escritura de `frida.models.json` | Cambiar modelo por skill via comando y verificar override |
| **4. Pipeline pointer** | Bloque de 120 tokens en session_start con índice de skills | Inicia sesión, ve pointer en `--frida-debug` |
| **5. Agents sync** | 15 .md + sha256 manifest + `/frida-update-agents` | Modifica un agente a mano, corre update, ve banner de "pending" |
| **6. Skills (3 primer lote)** | `discover` + `research` + `code-review` (las 3 más autosuficientes) | Cada una produce el artefacto esperado en `.frida/artifacts/` |
| **7. Skills (lote 2)** | `design`, `design-slice`, `design-review`, `synthesize`, `plan`, `blueprint`, `elaborate`, `revise` | workflow `build` corre end-to-end sin humanos |
| **8. Skills (lote 3)** | `implement`, `validate`, `slice`, `explore`, `grade`, `amend`, `commit` | workflow `build` hace loop grade→elaborate correctamente |
| **9. Skills (lote 4: repo utilities)** | `pr-triage`, `create-handoff`, `resume-handoff`, `annotate-guidance`, `annotate-inline`, `migrate-to-guidance`, `changelog`, `architecture-review`, `frontend-design` | Las 8 standalone corren sin errores |
| **10. Workflows built-in** | `build.ts`, `vet.ts`, `polish.ts` registrados en `frida-workflow/load/layers.ts` | `/wf build "<feature>"` corre completo |
| **11. Release** | vsix 0.2.0, doc en `docs/tools/frida-pipeline.md`, ADR-0021 cerrado, CHANGELOG | Pruebas E2E verdes |

---

## 5. Decisiones resueltas (firmadas para ADR-0021)

| # | Decisión | Justificación |
| --- | --- | --- |
| D1 | **Nombre: `frida-pipeline`** | Espejo de `rpiv-pi`; usuarios que conocen rpiv lo identifican al instante. |
| D2 | **Agentes globales** (`<frida.agentDir>/../global/agents/`) | Paridad con `rpiv-pi`. La mayoría son "codebase-specialists" agnósticos al proyecto; un workspace chico hereda los mismos 15 perfiles sin duplicar. |
| D3 | **Artefactos en `.frida/artifacts/`** (no `.rpiv/`) | Separación de namespaces; evita colisión si rpiv-pi y frida-pipeline coexisten en la misma sesión Pi. |
| D4 | **Workflows built-in en TS** (cargados con jiti) | Patrón de `frida-workflow` (ADR-0020); el mismo motor los descubre, valida y ejecuta. |
| D5 | **Skills embebidas** en `src/tools/frida-pipeline/skills/` | Igual que `rpiv-pi` las embarca; la extensión es autosuficiente al instalar (no requiere poblar `.frida/skills/` manualmente). |
| D6 | **`code-review` se reescribe para Frida** | Customizar al dominio Frida/Softtek (citando `docs/adr/`, `docs/tools/`, etc., no docs rpiv-agnósticas). |
| D7 | **No duplicar ADRs; referenciar** | ADR-0010 (agentDir), ADR-0015 (context), ADR-0016 (permission), ADR-0020 (workflow), ADR-0014 (todo-web), ADR-0011 (extension-ui-context), ADR-0012 (frida-webview), ADR-0017/0018/0019 (providers/models) — `frida-pipeline` los **cita**, no los reescribe. |

---

## 6. Próximos pasos concretos

1. ✅ **Revisar este doc** y firmar la Fase 0 (decisiones abiertas
   resueltas).
2. ⏭ **Crear `docs/adr/0021-frida-pipeline-porter-rpiv-pi.md`** con las
   decisiones D1–D7 firmadas.
3. ⏭ **Spike técnico de Fase 1** (esqueleto + banner + detección de
   siblings) antes de comprometerse a las 27 skills.
4. ⏭ **Programar el trabajo** por fases, validando cada gate antes de
   avanzar.

---

## 7. Referencias

- `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/README.md` — descripción
  comercial del paquete.
- `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/docs/architecture.md` —
  arquitectura interna (lo que registra, hooks, sibling coupling).
- `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/docs/skills.md` — las
  27 skills, sus contratos, y a qué artefacto escriben.
- `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/docs/workflows.md` —
  los 3 workflows `build`/`vet`/`polish` con su cadena de etapas.
- `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/docs/agents.md` — los
  15 subagentes y el mecanismo de sync con sha256.
- `docs/adr/0020-frida-workflow-porte-nativo.md` — el ADR existente que
  define el patrón de porte nativo a seguir.
- `docs/frida-workflow-design.md` — el diseño que ya está siguiendo
  `frida-workflow` (243 tests, motor completo).
- `src/tools/frida-workflow/host.ts` — el cruce con el SDK de Pi; dónde
  `frida-pipeline` debe apoyarse para `spawnChild` de etapas.
- `src/tools/frida-workflow/lifecycle.ts` + `store.ts` + `WorkflowPanel.tsx` —
  la infraestructura de "lane dock" que ya existe y se debe **reusar**.
- `docs/tools/{frida-workflow,frida-args}.md` — el formato de doc de
  extensión que se debe seguir.
