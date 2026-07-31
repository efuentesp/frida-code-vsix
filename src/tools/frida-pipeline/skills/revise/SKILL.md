---
name: revise
description: Actualiza quirúrgicamente un plan de implementación existente en .frida/artifacts/plans/ basado en feedback de revisión, descubrimientos mid-implementación, o nuevas restricciones, preservando estructura y calidad en vez de reescribir. Úsala cuando el usuario quiera ajustar un plan tras feedback de code-review, haya golpeado un blocker mid-implement, el scope cambió, o pida "revisar el plan".
argument-hint: "[plan-path | --plans <path> --reviews <path>] [feedback]"
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: plan
    data:
      type: object
      properties:
        status:
          enum: [in-progress, in-review, ready]
  consumes:
    reads:
      plans: {}
      reviews: {}
---

# Revise

Actualiza un plan existente quirúrgicamente. No reescribe — preserva estructura.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Leer plan + feedback → 2. Identificar cambios → 3. Aplicar quirúrgicamente → 4. Escribir

## Pasos

### Paso 1: Leer plan + feedback

- **Plan**: lee el plan existente (`.frida/artifacts/plans/*.md`) completo.
- **Feedback**: puede ser texto libre del usuario, o un path a un review (`.frida/artifacts/reviews/*.md`).
- Si es `--reviews <path>`: lee el review y extrae blockers/concerns.

### Paso 2: Identificar cambios

Mapea cada item de feedback a una sección del plan:

- **Blocker** (del review): debe arreglarse — reescribe la fase afectada.
- **Concern**: debería arreglarse — ajusta la fase.
- **Scope change**: añade/remueve fases según el nuevo scope.
- **Mid-implement discovery**: ajusta las fases posteriores.

### Paso 3: Aplicar quirúrgicamente

Edita el plan in-place:

- **NO reescribas todo el plan** — sólo las secciones afectadas.
- Preserva la estructura existente (phases, success criteria).
- Propaga cambios a fases dependientes (si una fase cambia sus interfaces, las dependientes deben actualizarse).
- Actualiza `phase_count` si añades/remueves fases.

### Paso 4: Escribir

Usa el Edit tool para modificar el plan existente. Actualiza `status: ready` y `last_updated`.

```
Plan revisado:
`.frida/artifacts/plans/<existente>.md`

{N} cambios aplicados, {M} fases afectadas.

**Siguiente paso:** /skill:implement o /skill:code-review
```

## Notas

- **Quirúrgico**: cambios mínimos, preserva estructura.
- **Propagación**: un cambio de interface se propaga a fases dependientes.
- **Feedback de review**: usa `--reviews` para consumir un code-review.
- **No reescribe**: si el plan necesita un rediseño completo, usa design + plan de nuevo.
