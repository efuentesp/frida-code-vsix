# frida-aidd — metodología AiDD (BMAD) como skill pack + patrón de workflow

> **Estado:** Lotes 1+2 implementados — **fase plan** (`aidd-plan`) y **fase
> ship** (`aidd-ship`) (issue #38, ADR-0050 piezas 1-8). Para el uso diario ver
> [how-to-frida-workflows.md](../how-to-frida-workflows.md) (patrón
> `aidd-plan`).

## Qué es (y qué no es)

`frida-aidd` porta la metodología **AiDD** (Agile AI-Driven Development,
[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD), MIT) a Frida como
**composición de extensiones existentes**: no es una extensión horizontal nueva,
sino un **skill pack + patrón de workflow** sobre `frida-extensible-workflows`
(ADR-0050 D1/D2). El hallazgo central de la investigación: el loop determinista
de bmad-loop es el modelo creator-verifier del motor de workflows, y todo el
impuesto del orquestador externo (TMux, pane-scraping, adapters) no aplica
porque Frida **es** el harness.

**No es**: envoltura de bmad-loop (inviable: drivar CLIs vía TMux), ni sólo los
prompts sin loop (degradaría a "vibe coding con prompts buenos").

## Lote 1 — fase plan

`workflow({ name: "aidd-plan", args: { idea: "..." } })` corre la cadena de
planificación BMAD adaptada:

```text
brief → prd → architecture → epics-and-stories → spec (fan-out por historia)
```

- Cada stage es un **sub-agente desechable** con el prompt de su skill y las
  tools completas: **escribe su artefacto markdown a disco**
  (`docs/aidd/planning/`) y devuelve un resumen corto.
- **Cadena de custodia por filesystem**: el stage *N+1* lee los artefactos del
  *N* — si un agente no escribió, el siguiente falla ruidosamente, no
  silenciosamente.
- **Checkpoints entre stages** (`review: "manual"`, default): el workflow pausa
  para que revises/edites el artefacto y apruebes continuar; rechazar detiene.
  Con `review: "auto"` corre sin pausas.
- **Spec = fan-out paralelo**: un extractor (outputSchema) lee las historias de
  `epics-and-stories.md` y cada historia recibe su spec en su propio agente
  (`spec-E1-S1.md`, …) — el kernel de 5 campos: Why, Capabilities,
  Constraints, Non-goals, Success signal.

| Arg | Tipo | Default |
| --- | --- | --- |
| `idea` | string (req) | — |
| `project` | string | `"project"` |
| `language` | string | el idioma de la idea |
| `review` | `"manual" \| "auto"` | `"manual"` |

## Estructura

```text
src/tools/frida-aidd/
  skills.ts    skill pack bundled: prompts por stage (adaptación BMAD MIT) +
               AIDD_PLAN_STAGES + helpers de contexto runtime
  resolver.ts  customización 3-capas: defaults → equipo (.frida/aidd/) →
               usuario (~/.frida/aidd/) — stages.json { stages: { prd: "..." } }
  workflow.ts  generateAiddPlanWorkflow: interpola los prompts resueltos en el
               script declarativo (cadena + checkpoints + fan-out)
  index.ts     factory createFridaAidd: registra el patrón en runtime
               (registerBuiltinPattern) — el cwd se resuelve lazy en resolve()
```

### Adaptación vs. espejo (ADR-0050 D2)

Los skills upstream son interactivos (coach con entrevistas) con maquinaria
`customize.toml`/uv. Aquí cada skill es un prompt **headless** para sesión
desechable: las preguntas abiertas van *dentro* del artefacto (sección
open-questions), lo no fundamentado se taggea `[ASSUMPTION]`. Conceptos portados
con fidelidad: brief honesto y right-sized, FRs verificables, **architecture
spine** (sólo invariantes; lo demás es `[SEED]`), historias como cortes
verticales con ACs verificables, spec-kernel de 5 campos.

### Registro en runtime (pieza 8)

El motor expone `registerBuiltinPattern()` (`builtin-patterns.ts`): patrones
registrados en runtime por otras extensiones, consumidos vía
`findBuiltinPattern`/`builtinPatternsCatalog` (aparecen en
`workflow_catalog`). La dirección de dependencia queda consumidor → motor:
`frida-aidd` importa del motor, nunca al revés. `resolve(args, ctx)` recibe el
`{ cwd }` de la sesión para resolver los overrides de equipo por proyecto.

## Customización 3-capas (pieza 2)

Cada layer puede reemplazar el prompt completo de un stage; gana la más
profunda. Un JSON inválido aborta el resolve — nunca se corre un prompt a
medias sin saberlo.

| Capa | Ruta | Ámbito |
| --- | --- | --- |
| defaults | `skills.ts` (bundled) | todos los proyectos |
| equipo | `.frida/aidd/stages.json` | el repositorio |
| usuario | `~/.frida/aidd/stages.json` | todas las sesiones |

```json
{ "stages": { "prd": "# PRD — variante del equipo\n..." } }
```

## Lote 2 — fase ship (aidd-ship)

`workflow({ name: "aidd-ship", args: { review: "auto" } })` corre el **loop
determinista por historia** (el corazón de AiDD — el motor de bmad-loop
adaptado al sandbox de workflows):

```text
bootstrap → por cada historia pending:
  dev desechable (escribe código, reclama filesTouched)
  → lie-detector: diff REAL vs claims (commit baseline)
  → frozen-spec: hash del spec no puede moverse
  → review acotado (1 fix round) → verify determinista (comandos del spec)
  → commit del ORQUESTADOR → sprint-status: done
→ sweep del deferred ledger (empaqueta lo resolvible → mini-stories)
```

| Pieza ADR | Implementación |
| --- | --- |
| **5. sprint-status** | `docs/aidd/sprint-status.yaml` con **único writer** (el script orquestador) y transiciones **never-regress** (`done` terminal; `blocked`/`deferred` sólo re-entran como `pending` explícito). Los agentes LLM jamás lo escriben (el prompt del dev lo prohíbe) |
| **7. lie-detector** | Registra `git rev-parse HEAD` al iniciar la historia; tras el dev, contrasta `filesTouched` reclamados contra `git diff --name-only` + untracked — un claim sin diff dispara rework y, si persiste, `blocked` |
| **6. frozen-spec** | El hash (`git hash-object`) del spec se captura al iniciar y se re-verifica antes del commit: si el dev lo editó, la historia se bloquea (detección determinista; el bloqueo preventivo vía permission-system queda como hardening futuro) |
| **3. deferred-work** | El dev reporta impedimentos no bloqueantes (`deferred[]` en su salida estructurada) → el orquestador los apunta en `docs/aidd/deferred-ledger.json` y la historia continúa |
| **4. sweep** | Al cerrar el sprint, un agente de triage lee el ledger y empaqueta lo resolvible en mini-stories (`SW1-1…`) con spec propio; el loop las ejecuta igual (máx. `maxSweeps`, default 2) y cierra las entradas resueltas |
| **8. commit del orquestador** | El commit lo hace el **script** (`git add -A && git commit -m "feat(aidd): E1-S1 — …"`), nunca el LLM; con `review: "manual"` (default) hay un checkpoint antes de cada commit |

| Arg | Tipo | Default |
| --- | --- | --- |
| `sprint` | string | `"1"` (sólo en bootstrap) |
| `review` | `"manual" \| "auto"` | `"manual"` (checkpoint pre-commit) |
| `maxSweeps` | 0-5 | 2 |

**Sin `sprint-status.yaml`**, hace bootstrap: un extractor lee los artefactos
de `aidd-plan` (epics-and-stories + specs) y siembra el estado inicial. Con
`review: "manual"`, cada commit pide aprobación vía checkpoint; `held`
(checkpoint rechazado) deja la historia `blocked` con razón explícita para que
el usuario decida. Reintentar una historia bloqueada: corrige y re-ejecuta
(`blocked → pending` es la única re-entrada). TEA (#41) y CIS (#40) se montan
como fases inyectadas sobre este mismo meta-workflow (patrón del plugin `tea`
de bmad-loop, verificado en la investigación).

**Requisito**: repositorio git (baseline/diff/commit). Los archivos de estado
(`sprint-status.yaml`, `deferred-ledger.json`, `verify-commands.json`) viajan
commiteados — el estado del sprint es auditable en la historia del repo.

## Pruebas

`test/frida-aidd/` — 35 tests:

- `resolver.test.ts` (5): precedencia 3-capas, ignorar stages desconocidos,
  JSON inválido aborta.
- `pattern.test.ts` (9): validación de args, script generado (cadena, 3
  checkpoints, fan-out, prompts interpolados), registro runtime sobre el motor
  (find/catálogo/idempotencia/pisado de estático).
- `e2e.test.ts` (3): workflow plan completo sobre el motor real con spawner
  mock — cadena + checkpoints aprobados, checkpoint rechazado detiene,
  `review=auto` sin checkpoints. Anclas únicas por encabezado de skill (el
  prompt de architecture menciona "PRD" — mismas colisiones de matching que
  los bridges del lote2 de #19).
- `sprint-status.test.ts` (9): la lib corre en un **vm real** (mismo régimen
  que el sandbox) — parse/round-trip, rechazos (status ilegal, sin title/spec,
  indentación, vacío, `#` inicial, saltos), tabla never-regress EXACTA (36
  pares), applyTransition inmutable + resets, compila sin codeGeneration.
- `ship.test.ts` (8): validación args + registro por factory (ambos patrones)
  - **e2e con git real** en tmpdir — happy path (dev escribe archivo real →
  lie-detector ok → review → verify → checkpoint → commit real del
  orquestador en `git log`), dev mentiroso reclama archivo sin diff →
  `blocked` con razón lie-detector y **sin commit** (HEAD no se movió),
  bootstrap idempotente (segunda corrida sin historias no llama agentes) y
  parse-guard del script generado en el parser del motor.

## Atribución

Adaptación de [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
(MIT) — skills `bmad-product-brief`, `bmad-prd`, `bmad-architecture`,
`bmad-create-epics-and-stories`, `bmad-spec` y agentes analyst/PM/architect.
Conceptos portados, texto propio; atribución preservada aquí y en `skills.ts`.
