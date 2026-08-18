# frida-aidd — metodología AiDD (BMAD) como skill pack + patrón de workflow

> **Estado:** Lote 1 implementado — **fase plan** (issue #38, ADR-0050 piezas 1,
> 2 y 8-parcial). Para el uso diario ver
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

## Fase 2 (Lote 2 pendiente)

Las piezas 3-7 del ADR: `aidd-ship` (loop determinista por historia: dev →
verify → review acotado → commit orquestador), `sprint-status.yaml` con writer
único never-regress, **lie-detector** (diff real vs. claims contra commit
baseline), **frozen-spec** (bloqueo del spec aprobado vía permission system),
**deferred-work** y **sweep**. TEA (#41) y CIS (#40) se montan como fases
inyectadas sobre este mismo meta-workflow (patrón del plugin `tea` de
bmad-loop, verificado en la investigación).

## Pruebas

`test/frida-aidd/` — 18 tests:

- `resolver.test.ts` (5): precedencia 3-capas, ignorar stages desconocidos,
  JSON inválido aborta.
- `pattern.test.ts` (9): validación de args, script generado (cadena, 3
  checkpoints, fan-out, prompts interpolados), registro runtime sobre el motor
  (find/catálogo/idempotencia/pisado de estático).
- `e2e.test.ts` (3): workflow completo sobre el motor real con spawner mock —
  cadena + checkpoints aprobados, checkpoint rechazado detiene, `review=auto`
  sin checkpoints. Anclas únicas por encabezado de skill (el prompt de
  architecture menciona "PRD" — mismas colisiones de matching que los bridges
  del lote2 de #19).

## Atribución

Adaptación de [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
(MIT) — skills `bmad-product-brief`, `bmad-prd`, `bmad-architecture`,
`bmad-create-epics-and-stories`, `bmad-spec` y agentes analyst/PM/architect.
Conceptos portados, texto propio; atribución preservada aquí y en `skills.ts`.
