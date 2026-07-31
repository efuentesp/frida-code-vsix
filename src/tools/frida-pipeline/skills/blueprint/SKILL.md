---
name: blueprint
description: Planifica features complejas descomponiéndolas en slices verticales (un slice = una fase) con micro-checkpoints del desarrollador entre fases, produciendo un plan fase-por-fase implement-ready en .frida/artifacts/plans/. Úsala para features multi-componente que tocan 6+ archivos cuando la revisión iterativa entre slices es valiosa. Puede consumir un research/solutions o correr standalone con descripción libre.
argument-hint: "[path a research o descripción libre de la feature]"
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: plan
    data:
      type: object
      required: [phases, phase_count]
      properties:
        status:
          enum: [in-progress, in-review, ready]
        phase_count:
          type: integer
          minimum: 1
          maximum: 32
        phases:
          type: array
          minItems: 1
          maxItems: 32
---

# Blueprint

Planifica con slices verticales y micro-checkpoints entre fases. Alternativa a plan cuando la revisión iterativa importa.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Input → 2. Decidir slices → 3. Micro-checkpoint por slice → 4. Plan fase-por-fase → 5. Escribir

## Pasos

### Paso 1: Input

- **Path a research/solutions**: léelo completo como contexto.
- **Descripción libre**: Úsala como feature description. Despacha codebase-locator para sondear.
- **Sin argumento**: pide al usuario qué feature planificar.

### Paso 2: Decidir slices

Descompone la feature en slices verticales (un slice = una unidad end-to-end):

1. Identifica los slices en orden de dependencia.
2. Por cada slice: título, descripción, archivos, interfaces.
3. Ordena por dependencia.

### Paso 3: Micro-checkpoint por slice

Por cada slice, presenta un resumen al desarrollador via `ask_user_question`:

- Qué hace el slice.
- Qué archivos toca.
- Qué decide (patrón, seam, etc.).
- "¿Aceptas este slice o quieres ajustar?"

El desarrollador puede ajustar el slice antes de continuar al siguiente.

### Paso 4: Plan fase-por-fase

Convierte los slices aceptados en fases:

1. Una fase por slice aceptado.
2. Success criteria por fase (observables).
3. Archivos por fase.

### Paso 5: Escribir plan

Filename: `.frida/artifacts/plans/<slug>_<topic>.md`. Frontmatter `status: ready`, `phase_count: N`.

```
Blueprint completado:
`.frida/artifacts/plans/<slug>_<topic>.md`

{N} fases con micro-checkpoints.

**Siguiente paso:** /skill:implement
```

## Notas

- **Micro-checkpoints**: el desarrollador revisa CADA slice antes de pasar al siguiente.
- **Slices verticales**: cada slice cruza todas las capas.
- **Alternativa a plan**: usa blueprint cuando la iteración importa; plan cuando basta un desglose directo.
